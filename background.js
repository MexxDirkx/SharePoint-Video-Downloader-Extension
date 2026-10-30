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
      frameId: details.frameId, at: Date.now() };
  });
}, { urls: ['https://*.svc.ms/*videomanifest*'] }, ['requestHeaders', 'extraHeaders']);

chrome.webRequest.onBeforeRequest.addListener(details => {
  if (details.tabId < 0) return;
  update(details.tabId, state => {
    const before = JSON.stringify(state.net.transcode || null);
    state.net.transcode = VideoMedia.addTranscodeUrl(state.net.transcode || null, details.url);
    if (JSON.stringify(state.net.transcode) === before) return false;
  });
}, { urls: PAGE_HOSTS.map(host => 'https://' + host + '/*oneDrive.transcode*') });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Extension pages (the popup) name the tab; content scripts only talk about their own.
  const fromExtensionPage = (sender.url || '').startsWith(chrome.runtime.getURL(''));
  const tabId = fromExtensionPage ? message.tabId : sender.tab && sender.tab.id;
  if (typeof tabId !== 'number') return;
  switch (message.type) {
    case 'frame-start':
      // A new document in a frame: forget what was captured for the old one.
      update(tabId, state => {
        if (sender.frameId === 0) {
          state.frames = {};
          state.net = {};
          state.job = null;
        } else {
          delete state.frames[sender.frameId];
        }
      });
      break;
    case 'capture':
      update(tabId, state => {
        state.frames[sender.frameId] = VideoMedia.cleanFrame(message.frame);
      });
      break;
    case 'job':
      update(tabId, state => {
        state.job = Object.assign({ frameId: sender.frameId, at: Date.now() }, message.job);
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
