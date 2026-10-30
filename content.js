// content.js
// Runs in every frame of SharePoint and Teams pages, in the extension's isolated world.
//  - Collects what intercept.js (the page's own world) and the page's Resource Timing reveal
//    about the video, its transcript and the file, and reports it to background.js.
//  - Handles the popup's requests: read the manifest, download the transcript.
(function () {
  'use strict';

  const captured = { fileInfo: null, manifest: null, transcode: null, key: null, bearer: null, transcript: null };
  let lastReport = '';
  let reportTimer = null;

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

  const handlers = { fetchManifest, transcript };

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
})();
