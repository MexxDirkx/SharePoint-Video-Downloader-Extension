// content.js
// Runs in every frame of SharePoint and Teams pages, in the extension's isolated world.
//  - Collects what intercept.js (the page's own world) and the page's Resource Timing reveal
//    about the video, its transcript and the file, and reports it to background.js.
//  - Handles the popup's requests: read the manifest, download the transcript, download the
//    video. Downloads run here, in the page, so they continue when the popup closes.
(function () {
  'use strict';

  const captured = { fileInfo: null, manifest: null, transcode: null, key: null, bearer: null, transcript: null };
  let lastReport = '';
  let reportTimer = null;
  let job = null;

  function send(message) {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage(message, response => {
          void chrome.runtime.lastError;
          resolve(response);
        });
      } catch (e) {
        resolve(undefined); // extension was reloaded; this script is orphaned
      }
    });
  }

  function report() {
    clearTimeout(reportTimer);
    reportTimer = setTimeout(() => {
      const frame = {
        url: location.href,
        fileInfo: captured.fileInfo,
        manifest: captured.manifest,
        transcode: captured.transcode,
        hasKey: !!captured.key
      };
      const text = JSON.stringify(frame);
      if (text !== lastReport) {
        lastReport = text;
        send({ type: 'capture', frame });
      }
    }, 100);
  }

  function onManifestUrl(url, token) {
    const trimmed = VideoCommands.trimManifestUrl(url);
    const previous = captured.manifest;
    if (previous && previous.url === trimmed && (previous.token || !token)) return;
    captured.manifest = { url: trimmed, token: token || null, at: previous && previous.url === trimmed ? previous.at : Date.now() };
    report();
  }

  // Messages from intercept.js
  window.addEventListener('message', event => {
    if (event.source !== window || !event.data || event.data.source !== 'spvd-intercept') return;
    const data = event.data.data;
    const isText = value => typeof value === 'string' && value.length > 0;
    switch (event.data.kind) {
      case 'manifest':
        if (data && isText(data.url)) onManifestUrl(data.url, isText(data.token) ? data.token : null);
        break;
      case 'bearer':
        if (isText(data)) captured.bearer = data;
        break;
      case 'transcript':
        if (data && isText(data.temporaryDownloadUrl)) captured.transcript = data;
        break;
      case 'fileInfo':
        if (data && typeof data === 'object') {
          captured.fileInfo = data;
          report();
        }
        break;
      case 'key':
        if (data && Array.isArray(data.key) && data.key.length === 16 && Array.isArray(data.iv) && data.iv.length === 16) {
          captured.key = data;
          report();
        }
        break;
    }
  });

  function refreshFromPage() {
    window.postMessage({ source: 'spvd-content', kind: 'refresh' }, '*');
    return new Promise(resolve => setTimeout(resolve, 200));
  }

  // Requests the page made, including ones the Resource Timing buffer dropped when full.
  function onResource(url) {
    if (VideoMedia.isTranscodeUrl(url)) {
      captured.transcode = VideoMedia.addTranscodeUrl(captured.transcode, url);
      report();
    } else if (/\/videomanifest\?/i.test(url) && !/tempauth/i.test(url)) {
      onManifestUrl(url, null);
    }
  }
  try {
    new PerformanceObserver(list => list.getEntries().forEach(entry => onResource(entry.name)))
      .observe({ type: 'resource', buffered: true });
  } catch (e) { /* no PerformanceObserver; intercept.js and background.js still capture */ }

  send({ type: 'frame-start' });
  report();
  refreshFromPage();

  // ---------------------------------------------------------------------------------------
  // Requests from the popup

  const handlers = { fetchManifest, transcript, downloadVideo, cancel };

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const handler = handlers[request && request.action];
    if (!handler) return;
    handler(request).then(sendResponse, error => sendResponse({ error: error.message || String(error) }));
    return true;
  });

  async function tabState() {
    const response = await send({ type: 'get-state' });
    return (response && response.state) || { frames: {}, net: {} };
  }

  // The manifest is fetched like the player does: with its X-SPOPacToken, without cookies.
  async function fetchManifestText(url, token) {
    const response = await fetch(url, { credentials: 'omit', headers: token ? { 'x-spopactoken': token } : {} });
    if (!response.ok) {
      throw new Error('Reading the manifest failed: HTTP ' + response.status +
        (response.status === 401 ? ' (the access token was missing or has expired; reload the page and play the video again)' : ''));
    }
    return response.text();
  }

  async function fetchManifest(request) {
    return { manifest: await fetchManifestText(request.url, request.token) };
  }

  function newestManifest(state) {
    const candidates = [captured.manifest, state.net && state.net.manifest].filter(Boolean)
      .sort((a, b) => (b.at || 0) - (a.at || 0));
    const manifest = candidates[0];
    if (manifest && !manifest.token) {
      const withToken = candidates.find(m => m.url === manifest.url && m.token);
      if (withToken) return Object.assign({}, manifest, { token: withToken.token });
    }
    return manifest || null;
  }

  function transcodeSession(state) {
    return [state.net && state.net.transcode, captured.transcode]
      .find(session => VideoMedia.transcodeTrackReady(session, 'video')) || null;
  }

  // Transcript: find it through SharePoint's API, then fetch it as JSON.
  async function transcript(request) {
    await refreshFromPage();
    if (captured.fileInfo && captured.fileInfo.hasTranscripts === false) return { none: true };
    let found = captured.transcript;
    if (!found) {
      const state = await tabState();
      const manifest = newestManifest(state);
      const session = transcodeSession(state);
      const context = VideoMedia.transcriptContext({
        spItemUrl: captured.fileInfo && captured.fileInfo.spItemUrl,
        transcodeUrl: session && session.tracks.video.initUrl,
        manifestUrl: manifest && manifest.url,
        pathname: location.pathname
      });
      if (!context) {
        return { error: 'Could not tell which file this video is. Reload the page, start the video and try again.' };
      }
      const headers = { Accept: 'application/json' };
      if (captured.bearer) headers.Authorization = captured.bearer;
      let status = 0;
      for (const url of VideoMedia.transcriptMetadataUrls(location.origin, context)) {
        const response = await fetch(url, { credentials: 'include', headers });
        status = response.status;
        if (!response.ok) continue;
        const result = VideoMedia.transcriptFromMetadata(await response.json());
        if (result.none) return { none: true };
        found = result.transcript;
        break;
      }
      if (!found) return { error: 'Could not look up the transcript' + (status ? ' (HTTP ' + status + ')' : '') + '.' };
    }
    const response = await fetch(VideoMedia.transcriptJsonUrl(found.temporaryDownloadUrl, location.hostname));
    if (!response.ok) return { error: 'Downloading the transcript failed: HTTP ' + response.status };
    const json = await response.json();
    const text = request.format === 'vtt' ? VideoMedia.toVtt(json) : VideoMedia.toSrt(json);
    return { text, entries: ((json && json.entries) || []).length };
  }

  // ---------------------------------------------------------------------------------------
  // Video

  async function cancel() {
    if (job) job.controller.abort();
    return { ok: true };
  }

  async function downloadVideo(request) {
    if (job) return { error: 'A download is already running on this page.' };
    const controller = new AbortController();
    const panel = VideoDownloader.createPanel(request.baseName);
    let lastSent = 0;
    const status = (state, text, extra, force) => {
      panel.status(text, state === 'error');
      const now = Date.now();
      if (force || now - lastSent > 400) {
        lastSent = now;
        send({ type: 'job', job: Object.assign({ state, text }, extra) });
      }
    };
    job = { controller };
    panel.onClose(() => controller.abort());
    const cancelButton = panel.button('Cancel', () => controller.abort(), true);

    runVideoJob(request, controller.signal, panel, status).then(result => {
      cancelButton.remove();
      status('done', result.text, { files: result.files, muxCommand: result.muxCommand || null }, true);
    }, error => {
      cancelButton.remove();
      panel.progress(null);
      if (error.name === 'AbortError') {
        status('cancelled', 'Download cancelled.', {}, true);
      } else {
        status('error', error.message, {}, true);
      }
    }).finally(() => {
      job = null;
    });
    return { started: true };
  }

  async function runVideoJob(request, signal, panel, status) {
    status('running', 'Looking for the original file...');
    const original = await tryOriginalFile(request.baseName, signal);
    if (original) {
      panel.button('Download again', () => clickDownload(original.url, original.filename));
      return { text: 'Downloading the original file. Your browser shows its progress.', files: [{ filename: original.filename }] };
    }

    await refreshFromPage();
    const tracks = await videoTracks(await tabState(), signal, status);
    const separate = tracks.length > 1;
    const names = { video: request.baseName + (separate ? '.video.mp4' : '.mp4'), audio: request.baseName + '.audio.m4a' };

    let directory = null;
    if (request.saveMode === 'folder' && typeof window.showDirectoryPicker === 'function' && window === window.top) {
      directory = await chooseFolder(panel, status, signal);
    }
    for (const track of tracks) {
      track.sink = directory ? await VideoDownloader.fileSink(directory, names[track.type]) :
        VideoDownloader.blobSink(names[track.type], track.type === 'audio' ? 'audio/mp4' : 'video/mp4');
    }

    const label = tracks.map(t => t.type + (t.height ? ' ' + t.width + 'x' + t.height : '')).join(' and ');
    const files = await VideoDownloader.downloadTracks(tracks, signal, (done, total, note) => {
      panel.progress(done / total);
      status('running', note || 'Downloading ' + label + ': ' + done + ' of ' + total + ' parts...', { done, total });
    });
    panel.progress(null);

    const sizes = files.map(f => f.filename + ' (' + VideoDownloader.formatSize(f.size) + ')').join(', ');
    if (!directory) {
      for (const file of files) {
        panel.button('Save ' + file.filename, () => VideoDownloader.saveBlob(file.blob, file.filename));
      }
    }
    if (separate) {
      panel.code(request.muxCommand);
      panel.button('Copy ffmpeg command', () => navigator.clipboard.writeText(request.muxCommand).catch(() => {}), true);
    }
    const muxNote = separate ? ' To combine video and audio into one file, run the ffmpeg command below in the folder with the files.' : '';
    return {
      text: (directory ? 'Saved ' + sizes + ' in the folder you chose.' :
        'Downloaded ' + sizes + '. Use the Save buttons in the panel on the page to store them.') + muxNote,
      files: summary(files),
      muxCommand: separate ? request.muxCommand : null
    };
  }

  function summary(files) {
    return files.map(file => ({ filename: file.filename, size: file.size }));
  }

  // The folder picker needs a click on the page itself.
  function chooseFolder(panel, status, signal) {
    status('waiting', 'Choose the folder to save the video in.', {}, true);
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })), { once: true });
      const choose = panel.button('Choose folder...', async () => {
        try {
          const directory = await window.showDirectoryPicker({ id: 'spvd', mode: 'readwrite' });
          choose.remove();
          later.remove();
          resolve(directory);
        } catch (e) {
          if (e.name !== 'AbortError') reject(e);
        }
      });
      const later = panel.button('Keep in browser instead', () => {
        choose.remove();
        later.remove();
        resolve(null);
      }, true);
    });
  }

  function clickDownload(url, filename) {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    (document.body || document.documentElement).appendChild(link);
    link.click();
    link.remove();
  }

  // When the owner allows downloads, the original file is the best copy. View-only files
  // answer with an error page, which the first bytes give away.
  async function tryOriginalFile(baseName, signal) {
    const name = captured.fileInfo && (captured.fileInfo.name || '');
    for (const url of VideoMedia.originalFileUrls(captured.fileInfo, location.href)) {
      let response;
      try {
        response = await fetch(url, { credentials: 'include', headers: { Range: 'bytes=0-15' }, signal });
      } catch (e) {
        if (signal.aborted) throw e;
        continue;
      }
      let bytes = [];
      if (response.ok && response.body) {
        const reader = response.body.getReader();
        const chunk = await reader.read();
        reader.cancel().catch(() => {});
        bytes = Array.from((chunk.value || []).slice(0, 16));
      }
      if (response.ok && VideoMedia.looksLikeVideo(response.headers.get('content-type'), bytes)) {
        const extension = (/\.[a-z0-9]{2,4}$/i.exec(name || new URL(url).pathname) || ['.mp4'])[0];
        const filename = baseName + extension;
        clickDownload(url, filename);
        return { url, filename };
      }
    }
    return null;
  }

  async function waitFor(check, ms) {
    for (const end = Date.now() + ms; Date.now() < end;) {
      const value = await check();
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return check();
  }

  // What to download, from the newest manifest or else the oneDrive.transcode session.
  async function videoTracks(state, signal, status) {
    const manifest = newestManifest(state);
    if (manifest) {
      status('running', 'Reading the video manifest...');
      const text = await fetchManifestText(manifest.url, manifest.token);
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      if (doc.getElementsByTagName('parsererror').length) throw new Error('The manifest could not be read.');
      const plan = VideoMedia.dashDownloadPlan(doc, manifest.url);
      if (plan.protection.kind === 'drm') {
        throw new Error('This video is protected with ' + plan.protection.name + ' DRM. It can only be played in the browser; it cannot be downloaded.');
      }
      if (plan.protection.kind === 'unknown') {
        throw new Error('This video uses a protection scheme the extension cannot decrypt (' + plan.protection.name + ').');
      }
      for (const track of plan.tracks) {
        track.requestInit = requestInit(track.initUrl || track.segments[0], manifest.token);
        if (track.encryption) {
          Object.assign(track, await seaKey(track.encryption, manifest.token, signal));
          track.encryption = 'always';
        } else {
          track.encryption = 'none';
        }
      }
      return plan.tracks;
    }

    let session = transcodeSession(state);
    if (session) {
      if (!VideoMedia.transcodeTrackReady(session, 'audio')) {
        status('running', 'Waiting for the audio track...');
        const withAudio = await waitFor(async () => {
          const next = transcodeSession(await tabState());
          return VideoMedia.transcodeTrackReady(next, 'audio') ? next : null;
        }, 5000);
        session = withAudio || session;
      }
      if (!captured.key) {
        await waitFor(async () => {
          await refreshFromPage();
          return captured.key;
        }, 5000);
      }
      const key = captured.key && await VideoDownloader.importKey(captured.key.key);
      return VideoMedia.transcodeTracks(session).map(track => Object.assign(track, {
        encryption: 'detect',
        key,
        iv: captured.key && new Uint8Array(captured.key.iv)
      }));
    }
    throw new Error('No video stream has been seen on this page yet. Play the video for a few seconds, then try again.');
  }

  // Requests to the *.svc.ms media service need the player's X-SPOPacToken; requests to
  // SharePoint itself need the sign-in cookies.
  function requestInit(url, token) {
    return /\.svc\.ms$/i.test(new URL(url).hostname) ?
      { credentials: 'omit', headers: token ? { 'x-spopactoken': token } : {} } :
      { credentials: 'include' };
  }

  // DASH-SEA: one AES-128 key per track, from the key URL in the manifest.
  async function seaKey(encryption, token, signal) {
    const response = await VideoDownloader.fetchWithRetry(encryption.keyUrl, requestInit(encryption.keyUrl, token), signal, () => {});
    if (!response.ok) throw new Error('Getting the decryption key failed: HTTP ' + response.status);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== 16) throw new Error('The decryption key has an unexpected size.');
    return { key: await VideoDownloader.importKey(bytes), iv: new Uint8Array(encryption.iv) };
  }
})();
