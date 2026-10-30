// background.js
// Keeps, per tab, what the content scripts in each frame found and what this worker saw on
// the network, in chrome.storage.session (memory only, cleared when the browser closes).
// The popup asks for it with { type: 'get-state', tabId }.
//
// The network listeners only observe. They are needed because the SharePoint player fetches
// oneDrive.transcode segments, and sometimes the manifest, from a Web Worker: those requests
// show up neither in the page's Resource Timing nor in intercept.js's fetch hook.
importScripts('commands.js', 'media.js');

const PAGE_HOSTS = ['*.sharepoint.com', '*.sharepoint.com.mcas.ms', '*.sharepoint.us', '*.sharepoint-mil.us'];

const cache = new Map();
const queues = new Map();

function storageKey(tabId) {
  return 'tab:' + tabId;
}

async function load(tabId) {
  if (!cache.has(tabId)) {
    const stored = (await chrome.storage.session.get(storageKey(tabId)))[storageKey(tabId)];
    if (!cache.has(tabId)) cache.set(tabId, stored || { frames: {}, net: {}, job: null });
  }
  return cache.get(tabId);
}

// Change a tab's state; updates run one at a time per tab. change() returns false when it
// changed nothing, which skips the write.
function update(tabId, change) {
  const run = (queues.get(tabId) || Promise.resolve()).then(async () => {
    const state = await load(tabId);
    if (change(state) !== false) {
      await chrome.storage.session.set({ [storageKey(tabId)]: state });
    }
  });
  queues.set(tabId, run.catch(() => {}));
  return run;
}

function requestHeader(headers, name) {
  const header = (headers || []).find(h => h.name.toLowerCase() === name);
  return header ? header.value : null;
}

chrome.webRequest.onSendHeaders.addListener(details => {
  if (details.tabId < 0 || details.method !== 'GET' || /tempauth/i.test(details.url)) return;
  // Pages can send their own requests here, so accept only what the player would send
  const url = VideoCommands.trimManifestUrl(new URL(details.url).href);
  if (!VideoCommands.isManifestUrl(url)) return;
  let token = requestHeader(details.requestHeaders, 'x-spopactoken');
  if (!VideoCommands.isToken(token)) token = null;
  update(details.tabId, state => {
    const previous = state.net.manifest;
    if (previous && previous.url === url && (previous.token === token || !token)) return false;
    state.net.manifest = { url, token: token || (previous && previous.url === url ? previous.token : null),
      frameId: details.frameId, at: details.timeStamp || Date.now() };
  });
}, { urls: ['https://*.svc.ms/*videomanifest*'] }, ['requestHeaders', 'extraHeaders']);

chrome.webRequest.onBeforeRequest.addListener(details => {
  if (details.tabId < 0) return;
  update(details.tabId, state => {
    const before = JSON.stringify(state.net.transcode || null);
    state.net.transcode = VideoMedia.addTranscodeUrl(state.net.transcode || null, details.url);
    if (JSON.stringify(state.net.transcode) === before) return false;
    state.net.transcode.at = details.timeStamp || Date.now();
  });
}, { urls: PAGE_HOSTS.map(host => 'https://' + host + '/*oneDrive.transcode*') });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Extension pages (the popup) name the tab; content scripts only talk about their own.
  const fromExtensionPage = (sender.url || '').startsWith(chrome.runtime.getURL(''));
  const tabId = fromExtensionPage ? message.tabId : sender.tab && sender.tab.id;
  if (typeof tabId !== 'number') return;
  // Messages and network events can arrive out of order, so each frame report carries the
  // start time of its document (startedAt) and older documents are ignored.
  const startedAt = Number(message.startedAt) || 0;
  const frameId = fromExtensionPage ? message.frameId : sender.frameId;
  switch (message.type) {
    case 'frame-start':
      // A new document in a frame: forget the old one, and its download
      update(tabId, state => {
        const current = state.frames[frameId];
        if (current && current.startedAt > startedAt) return false;
        if (frameId === 0) {
          // A new page: drop what belongs to earlier documents
          state.top = startedAt;
          for (const id of Object.keys(state.frames)) {
            if (!(state.frames[id].startedAt >= startedAt)) delete state.frames[id];
          }
          for (const key of ['manifest', 'transcode']) {
            if (state.net[key] && !(state.net[key].at >= startedAt)) delete state.net[key];
          }
        }
        state.frames[frameId] = { url: sender.url, startedAt };
        if (state.job && (state.job.frameId === frameId || !state.frames[state.job.frameId])) state.job = null;
      });
      break;
    case 'frame-gone':
      // The frame's document unloaded (content script), or it stopped answering (popup)
      update(tabId, state => {
        const current = state.frames[frameId];
        if (current && !fromExtensionPage && current.startedAt !== startedAt) return false;
        delete state.frames[frameId];
        if (state.job && state.job.frameId === frameId) state.job = null;
      });
      break;
    case 'reset-tab':
      if (!fromExtensionPage) return;
      update(tabId, state => {
        state.frames = {};
        state.net = {};
        state.job = null;
        state.top = 0;
      });
      break;
    case 'capture':
      update(tabId, state => {
        const frame = VideoMedia.cleanFrame(message.frame);
        const current = state.frames[frameId];
        if (!(frame.startedAt >= (state.top || 0)) || (current && current.startedAt > frame.startedAt)) return false;
        state.frames[frameId] = frame;
      });
      break;
    case 'job':
      update(tabId, state => {
        const current = state.frames[frameId];
        if (!current || current.startedAt !== startedAt) return false;
        state.job = Object.assign({ frameId, at: Date.now() }, message.job);
      });
      break;
    case 'get-state':
      (queues.get(tabId) || Promise.resolve())
        .then(() => load(tabId))
        .then(state => sendResponse({ state, summary: VideoMedia.summarizeTab(state) }));
      return true;
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  cache.delete(tabId);
  queues.delete(tabId);
  chrome.storage.session.remove(storageKey(tabId));
});
