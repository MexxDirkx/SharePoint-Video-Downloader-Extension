// downloader.js
// Downloads a video's tracks segment by segment inside the page (content script), decrypts
// them when needed, and writes each track to its own file. Shows its progress in a small
// panel on the page, so it keeps going after the popup closes.
//
// The retry policy and the segment pool follow ms-teams-sharepoint-downloader by Brendan
// Gooden (https://github.com/brendangooden/ms-teams-sharepoint-downloader),
// MIT License, Copyright (c) 2025 Brendan Gooden. See THIRD_PARTY_NOTICES.md.
(function (root) {
  'use strict';

  const CONCURRENCY = 4;
  const MAX_ATTEMPTS = 8;
  // Parts can arrive out of order; when they are written to a file, no more than this many
  // past the next one to write are fetched, so a part being retried doesn't let the rest
  // pile up in memory.
  const AHEAD = 2 * CONCURRENCY;

  function cancelled() {
    return Object.assign(new Error('Download cancelled'), { name: 'AbortError' });
  }

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(cancelled());
      const timer = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(cancelled());
      }, { once: true });
    });
  }

  // fetch() that retries timeouts, throttling and server errors, honouring Retry-After.
  async function fetchWithRetry(url, init, signal, onRetry) {
    for (let attempt = 1; ; attempt++) {
      let response = null;
      let error = null;
      try {
        response = await fetch(url, Object.assign({ signal }, init));
      } catch (e) {
        if (signal.aborted) throw cancelled();
        error = e;
      }
      if (response && !VideoMedia.isRetriableStatus(response.status)) return response;
      if (attempt >= MAX_ATTEMPTS) {
        if (response) return response;
        throw error;
      }
      const delay = VideoMedia.retryDelayMs(attempt, response && response.headers.get('Retry-After'));
      onRetry(response ? 'HTTP ' + response.status : 'a network error', delay);
      await sleep(delay, signal);
    }
  }

  // Keeps a track as a list of Blobs, which Chrome moves out of the page's memory (to disk
  // for large videos). Saved with a download link when finished.
  function blobSink(filename, type) {
    const parts = [];
    let size = 0;
    return {
      filename,
      room() {
        return Promise.resolve();
      },
      put(index, buffer) {
        parts[index] = new Blob([buffer]);
        size += buffer.byteLength;
      },
      async finish() {
        return { filename, size, blob: new Blob(parts, { type }) };
      },
      abort() {
        parts.length = 0;
      }
    };
  }

  // A file name in the folder that isn't taken yet: "name.ext", "name (1).ext", ...
  async function freeName(directory, filename) {
    const dot = filename.lastIndexOf('.');
    const base = dot > 0 ? filename.slice(0, dot) : filename;
    const extension = dot > 0 ? filename.slice(dot) : '';
    for (let i = 0; i < 1000; i++) {
      const name = i ? base + ' (' + i + ')' + extension : filename;
      try {
        await directory.getFileHandle(name);
      } catch (e) {
        if (e.name === 'NotFoundError') return name;
        if (e.name !== 'TypeMismatchError') throw e; // a folder with that name
      }
    }
    throw new Error('The folder already has too many files named ' + filename);
  }

  // Streams a track, in order, to a new file in a folder the user picked. A download that
  // fails or is cancelled leaves no file behind.
  async function fileSink(directory, wantedName) {
    const filename = await freeName(directory, wantedName);
    const handle = await directory.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    const pending = new Map();
    let waiting = [];
    let next = 0;
    let size = 0;
    let aborted = false;
    let writing = Promise.resolve();
    const wake = () => {
      const ready = waiting.filter(w => aborted || w.index < next + AHEAD);
      waiting = waiting.filter(w => !ready.includes(w));
      ready.forEach(w => (aborted ? w.reject(cancelled()) : w.resolve()));
    };
    return {
      filename,
      // Resolves when part `index` may be fetched
      room(index) {
        if (index < next + AHEAD) return Promise.resolve();
        return new Promise((resolve, reject) => waiting.push({ index, resolve, reject }));
      },
      put(index, buffer) {
        pending.set(index, buffer);
        writing = writing.then(async () => {
          while (pending.has(next)) {
            const data = pending.get(next);
            pending.delete(next++);
            await writable.write(data);
            size += data.byteLength;
            wake();
          }
        });
        return writing;
      },
      async finish() {
        await writing;
        await writable.close();
        return { filename, size, saved: true };
      },
      async abort() {
        aborted = true;
        pending.clear();
        wake();
        await writing.catch(() => {});
        await writable.abort().catch(() => {});
        await directory.removeEntry(filename).catch(() => {});
      }
    };
  }

  function boxType(buffer) {
    return buffer.byteLength >= 8 ? String.fromCharCode.apply(null, new Uint8Array(buffer, 4, 4)) : '';
  }

  function isPlainMp4(buffer) {
    return boxType(buffer) === 'ftyp';
  }

  // Boxes an MP4 file or fragmented-MP4 segment can start with. Anything else, such as an
  // HTML error page served with status 200, is not video.
  const FIRST_BOXES = ['ftyp', 'styp', 'moof', 'sidx', 'emsg', 'prft', 'moov', 'mdat', 'free', 'skip', 'uuid'];

  // Download every track: [{ type, initUrl, segments, requestInit, encryption, key, iv, sink }].
  // encryption: 'always' (decrypt every part with key/iv), 'detect' (decrypt only if the
  // first part is not a plain MP4 header) or 'none'. onProgress(done, total, note) reports
  // progress. Each track's first part is fetched before the rest so 'detect' can decide.
  async function downloadTracks(tracks, signal, onProgress) {
    const firsts = [];
    const jobs = [];
    for (const track of tracks) {
      const urls = (track.initUrl ? [track.initUrl] : []).concat(track.segments);
      urls.forEach((url, index) => (index ? jobs : firsts).push({ track, url, index }));
    }
    const total = firsts.length + jobs.length;
    let done = 0;
    const onRetry = (reason, delay) => onProgress(done, total,
      'The server is busy (' + reason + '), retrying in ' + Math.round(delay / 1000) + 's...');

    async function fetchPart(job) {
      const response = await fetchWithRetry(job.url, job.track.requestInit || { credentials: 'include' }, signal, onRetry);
      if (!response.ok) {
        throw new Error('Downloading part ' + (job.index + 1) + ' of the ' + job.track.type +
          ' failed: HTTP ' + response.status + (VideoMedia.isRetriableStatus(response.status) ?
          ' (still failing after ' + MAX_ATTEMPTS + ' attempts; try again in a few minutes)' : ''));
      }
      let buffer = await response.arrayBuffer();
      const track = job.track;
      if (job.index === 0 && track.encryption === 'detect') {
        track.encryption = isPlainMp4(buffer) ? 'none' : 'always';
      }
      const part = 'Part ' + (job.index + 1) + ' of the ' + track.type;
      if (track.encryption === 'always') {
        if (!track.key) throw new Error('The ' + track.type + ' is encrypted and no decryption key was found');
        try {
          buffer = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: track.iv }, track.key, buffer);
        } catch (e) {
          throw new Error(part + ' could not be decrypted: the key doesn\'t match. Reload the page, play the video and try again.');
        }
      }
      if (!FIRST_BOXES.includes(boxType(buffer))) {
        throw new Error(part + ' is not video data' + (track.encryption === 'always' ?
          ' after decryption (wrong key?)' : ' (the server sent something else, such as an error page)') + '.');
      }
      if (signal.aborted) throw cancelled();
      await track.sink.put(job.index, buffer);
      onProgress(++done, total, '');
    }

    onProgress(0, total, '');
    let nextJob = 0;
    let failed = false;
    async function worker() {
      while (!failed && nextJob < jobs.length) {
        const job = jobs[nextJob++];
        try {
          await job.track.sink.room(job.index);
          await fetchPart(job);
        } catch (e) {
          failed = true;
          throw e;
        }
      }
    }
    try {
      await Promise.all(firsts.map(fetchPart));
      const workers = [];
      for (let i = 0; i < CONCURRENCY; i++) workers.push(worker());
      await Promise.all(workers);
    } catch (e) {
      failed = true;
      await Promise.all(tracks.map(track => track.sink.abort()));
      throw signal.aborted ? cancelled() : e;
    }
    const files = [];
    for (const track of tracks) files.push(await track.sink.finish());
    return files;
  }

  function importKey(bytes) {
    return crypto.subtle.importKey('raw', new Uint8Array(bytes), { name: 'AES-CBC' }, false, ['decrypt']);
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    (document.body || document.documentElement).appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function formatSize(bytes) {
    return bytes >= 1e9 ? (bytes / 1e9).toFixed(2) + ' GB' : (bytes / 1e6).toFixed(1) + ' MB';
  }

  // ---------------------------------------------------------------------------------------
  // Progress panel. Lives in a shadow root and styles itself with a constructed stylesheet,
  // so the page's styles and Content-Security-Policy don't get in the way.

  const PANEL_CSS = `
    :host { all: initial; }
    .panel { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: 340px;
      max-width: calc(100vw - 32px); box-sizing: border-box; padding: 12px 14px; border-radius: 8px;
      background: #fff; color: #222; border: 1px solid #c8c8c8; box-shadow: 0 4px 16px rgba(0,0,0,.2);
      font: 13px/1.4 "Segoe UI", Arial, sans-serif; }
    .title { font-weight: 600; color: #0078d4; margin-bottom: 4px; padding-right: 20px; }
    .name { font-weight: 600; word-break: break-all; margin-bottom: 6px; }
    .close { position: absolute; top: 6px; right: 8px; border: 0; background: none; font-size: 18px;
      cursor: pointer; color: #666; }
    .bar { height: 6px; background: #e5e5e5; border-radius: 3px; overflow: hidden; margin: 8px 0; }
    .bar > div { height: 100%; width: 0; background: #0078d4; transition: width .2s; }
    .error { color: #a4262c; }
    .buttons { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    button.action { background: #0078d4; color: #fff; border: 0; border-radius: 4px; padding: 6px 10px;
      font: inherit; cursor: pointer; }
    button.secondary { background: #6c757d; }
    pre { white-space: pre-wrap; word-break: break-all; background: #f5f5f5; border: 1px solid #ddd;
      border-radius: 4px; padding: 6px; font: 11px/1.4 Consolas, monospace; margin: 8px 0 0; }
    .hidden { display: none; }
  `;

  function createPanel(title) {
    const old = document.getElementById('spvd-panel');
    if (old) old.remove();
    const host = document.createElement('div');
    host.id = 'spvd-panel';
    const shadow = host.attachShadow({ mode: 'closed' });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(PANEL_CSS);
      shadow.adoptedStyleSheets = [sheet];
    } catch (e) {
      const style = document.createElement('style');
      style.textContent = PANEL_CSS;
      shadow.appendChild(style);
    }
    const panel = document.createElement('div');
    panel.className = 'panel';
    const make = (tag, className, text) => {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text) element.textContent = text;
      panel.appendChild(element);
      return element;
    };
    const close = make('button', 'close', '\u00d7');
    close.title = 'Close';
    make('div', 'title', 'SharePoint Video Downloader');
    make('div', 'name', title);
    const status = make('div', '', '');
    const bar = make('div', 'bar hidden');
    const fill = document.createElement('div');
    bar.appendChild(fill);
    const buttons = make('div', 'buttons');
    const code = make('pre', 'hidden');
    shadow.appendChild(panel);
    (document.body || document.documentElement).appendChild(host);

    let onClose = null;
    close.addEventListener('click', () => {
      if (onClose) onClose();
      host.remove();
    });
    return {
      status(text, isError) {
        status.textContent = text;
        status.className = isError ? 'error' : '';
      },
      progress(fraction) {
        bar.classList.toggle('hidden', fraction === null);
        fill.style.width = Math.round((fraction || 0) * 100) + '%';
      },
      button(label, onClick, secondary) {
        const button = document.createElement('button');
        button.className = 'action' + (secondary ? ' secondary' : '');
        button.textContent = label;
        button.addEventListener('click', onClick);
        buttons.appendChild(button);
        return button;
      },
      clearButtons() {
        buttons.textContent = '';
      },
      code(text) {
        code.textContent = text || '';
        code.classList.toggle('hidden', !text);
      },
      onClose(callback) {
        onClose = callback;
      }
    };
  }

  root.VideoDownloader = {
    fetchWithRetry,
    downloadTracks,
    importKey,
    blobSink,
    fileSink,
    saveBlob,
    formatSize,
    createPanel
  };
})(this);
