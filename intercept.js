// intercept.js
// Runs in the page's own JavaScript world ("MAIN") at document_start in every frame, before
// the player's scripts, to capture what the isolated content script cannot see:
//   - the videomanifest URL and the X-SPOPacToken header the player sends with it,
//   - the Authorization bearer the player sends to SharePoint's /_api/v... endpoints,
//   - transcript metadata responses,
//   - the page globals g_fileInfo and g_streamBootstrapContent (the decryption key).
// Captures go to content.js with window.postMessage. Requests the player makes from a Web
// Worker never pass through here; background.js sees those through chrome.webRequest.
//
// The approach follows ms-teams-sharepoint-downloader by Brendan Gooden
// (https://github.com/brendangooden/ms-teams-sharepoint-downloader),
// MIT License, Copyright (c) 2025 Brendan Gooden. See THIRD_PARTY_NOTICES.md.
(function () {
  'use strict';

  const SOURCE = 'spvd-intercept';
  const SHAREPOINT_HOST = /(\.sharepoint\.com|\.sharepoint\.com\.mcas\.ms|\.sharepoint\.us|\.sharepoint-mil\.us)$/i;
  const last = {};

  function post(kind, data) {
    last[kind] = data;
    window.postMessage({ source: SOURCE, kind: kind, data: data }, '*');
  }

  function absolute(url) {
    try {
      return new URL(String(url), location.href);
    } catch (e) {
      return null;
    }
  }

  function isTranscriptMetadata(url) {
    return /transcripts/i.test(url.pathname + url.search) &&
      !/\/content\b|\/cdnmedia\//i.test(url.pathname);
  }

  // Look at an outgoing request. header(name) returns a request header (lower-case name).
  function onRequest(url, method, header) {
    if (method !== 'GET') return;
    if (/\/videomanifest$/i.test(url.pathname) && !/tempauth/i.test(url.search)) {
      post('manifest', { url: url.href, token: header('x-spopactoken') || null });
    }
    if (/\/_api\/v[0-9.]+\//i.test(url.pathname) && SHAREPOINT_HOST.test(url.hostname)) {
      const authorization = header('authorization');
      if (authorization && /^Bearer\s/i.test(authorization) && authorization !== last.bearer) {
        post('bearer', authorization);
      }
    }
  }

  function onTranscriptMetadata(data) {
    const pick = list => list.find(t => t && t.isDefault) || list[0];
    let transcript = null;
    if (data && data.media && Array.isArray(data.media.transcripts) && data.media.transcripts.length) {
      transcript = pick(data.media.transcripts);
    } else if (data && Array.isArray(data.value) && data.value.length) {
      transcript = pick(data.value);
    } else if (data && data.temporaryDownloadUrl) {
      transcript = data;
    }
    if (transcript && typeof transcript.temporaryDownloadUrl === 'string') {
      post('transcript', {
        temporaryDownloadUrl: transcript.temporaryDownloadUrl,
        displayName: transcript.displayName || null,
        languageTag: transcript.languageTag || null
      });
    }
  }

  function headerFrom(headers, name) {
    if (!headers) return null;
    try {
      if (typeof headers.get === 'function') return headers.get(name);
      if (Array.isArray(headers)) {
        const pair = headers.find(p => p && String(p[0]).toLowerCase() === name);
        return pair ? pair[1] : null;
      }
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === name) return headers[key];
      }
    } catch (e) { /* unusual headers object */ }
    return null;
  }

  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    let url = null;
    try {
      const request = input instanceof Request ? input : null;
      url = absolute(request ? request.url : input);
      const method = String((init && init.method) || (request && request.method) || 'GET').toUpperCase();
      if (url) {
        onRequest(url, method, name =>
          headerFrom(init && init.headers, name) || (request ? request.headers.get(name) : null));
      }
    } catch (e) { /* never break the page's request */ }
    const result = originalFetch.apply(this, arguments);
    if (url && isTranscriptMetadata(url)) {
      result.then(response => response.clone().json()).then(onTranscriptMetadata, () => {});
    }
    return result;
  };

  const requests = new WeakMap();
  const xhr = XMLHttpRequest.prototype;
  const originalOpen = xhr.open;
  const originalSetRequestHeader = xhr.setRequestHeader;
  const originalSend = xhr.send;
  xhr.open = function (method, url) {
    requests.set(this, { method: String(method).toUpperCase(), url: absolute(url), headers: {} });
    return originalOpen.apply(this, arguments);
  };
  xhr.setRequestHeader = function (name, value) {
    const request = requests.get(this);
    if (request) request.headers[String(name).toLowerCase()] = String(value);
    return originalSetRequestHeader.apply(this, arguments);
  };
  xhr.send = function () {
    const request = requests.get(this);
    if (request && request.url) {
      try {
        onRequest(request.url, request.method, name => request.headers[name] || null);
        if (isTranscriptMetadata(request.url)) {
          this.addEventListener('load', function () {
            try {
              onTranscriptMetadata(this.responseType === 'json' ? this.response : JSON.parse(this.responseText));
            } catch (e) { /* not JSON */ }
          });
        }
      } catch (e) { /* never break the page's request */ }
    }
    return originalSend.apply(this, arguments);
  };

  // Page globals. g_fileInfo exists once the viewer page has loaded; the decryption key in
  // g_streamBootstrapContent appears once playback starts.
  function readGlobals() {
    const info = window.g_fileInfo;
    if (info && typeof info === 'object') {
      const text = value => (typeof value === 'string' ? value : null);
      const fileInfo = {
        spItemUrl: text(info['.spItemUrl']),
        hasTranscripts: typeof info.hasTranscripts === 'boolean' ? info.hasTranscripts : null,
        name: text(info.name),
        displayName: text(info.displayName),
        downloadUrl: text(info.downloadUrl) || text(info['.downloadUrl'])
      };
      if (JSON.stringify(fileInfo) !== JSON.stringify(last.fileInfo)) post('fileInfo', fileInfo);
    }
    const config = window.g_streamBootstrapContent && window.g_streamBootstrapContent.dashConfig;
    const key = config && config.cdnDecryptionKey;
    if (key && key.valid !== false && key.keyBuffer && key.keyBuffer.length === 16 &&
        key.iv && key.iv.length === 16) {
      const decryptionKey = { key: Array.from(key.keyBuffer), iv: Array.from(key.iv) };
      if (JSON.stringify(decryptionKey) !== JSON.stringify(last.key)) post('key', decryptionKey);
    }
  }

  // Poll the globals for a while after the page loads and after playback starts.
  let pollUntil = 0;
  let poller = null;
  function pollGlobals(ms) {
    pollUntil = Math.max(pollUntil, Date.now() + ms);
    if (poller) return;
    poller = setInterval(() => {
      readGlobals();
      if (Date.now() > pollUntil) {
        clearInterval(poller);
        poller = null;
      }
    }, 1000);
  }
  pollGlobals(120000);
  document.addEventListener('play', () => pollGlobals(60000), true);

  // content.js loads after this script and may miss the first messages, so it asks for
  // everything again when it is ready and before it starts a download.
  window.addEventListener('message', event => {
    if (event.source !== window || !event.data || event.data.source !== 'spvd-content' ||
        event.data.kind !== 'refresh') {
      return;
    }
    readGlobals();
    for (const kind of Object.keys(last)) {
      window.postMessage({ source: SOURCE, kind: kind, data: last[kind] }, '*');
    }
  });
})();
