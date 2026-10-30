// media.js
// Pure helpers for finding and downloading SharePoint videos and transcripts: DASH manifest
// download plans (including DASH-SEA encryption), oneDrive.transcode sessions, transcript
// metadata and subtitle formats, retry timing. No chrome.* or network access here, so the
// logic can be tested with node: `require('./media.js')`.
//
// The DASH-SEA handling, the oneDrive.transcode segment enumeration and the transcript API
// calls follow ms-teams-sharepoint-downloader by Brendan Gooden
// (https://github.com/brendangooden/ms-teams-sharepoint-downloader),
// MIT License, Copyright (c) 2025 Brendan Gooden. See THIRD_PARTY_NOTICES.md.
(function (root) {
  'use strict';

  const VideoCommands = typeof module !== 'undefined' && module.exports ?
    require('./commands.js') : root.VideoCommands;

  // ---------------------------------------------------------------------------------------
  // DASH manifests

  const SEA_SCHEME = 'urn:mpeg:dash:sea:2012';
  const HARD_DRM = {
    'edef8ba9-79d6-4ace-a3c8-27dcd51d21ed': 'Widevine',
    '9a04f079-9840-4286-ab92-e65be0885f95': 'PlayReady',
    '94ce86fb-07ff-4f43-adb8-93d2fa968ca2': 'FairPlay'
  };

  function childElements(element, name) {
    return Array.prototype.filter.call(element.childNodes,
      node => node.nodeType === 1 && node.localName === name);
  }

  function descendants(element, name) {
    return Array.from(element.getElementsByTagNameNS('*', name));
  }

  // Protection declared in a manifest: { kind: 'none' | 'sea' | 'drm' | 'unknown', name }.
  // 'sea' (DASH-SEA, AES-128-CBC with a key fetched over HTTPS) can be decrypted here;
  // Widevine, PlayReady and FairPlay ('drm') need the browser's DRM module.
  function manifestProtection(doc) {
    const schemes = descendants(doc.documentElement, 'ContentProtection')
      .map(element => (element.getAttribute('schemeIdUri') || '').toLowerCase());
    for (const scheme of schemes) {
      const uuid = Object.keys(HARD_DRM).find(id => scheme.includes(id));
      if (uuid) return { kind: 'drm', name: HARD_DRM[uuid] };
    }
    if (schemes.includes(SEA_SCHEME)) return { kind: 'sea', name: 'DASH-SEA (AES-128-CBC)' };
    if (schemes.length) return { kind: 'unknown', name: schemes[0] };
    return { kind: 'none', name: '' };
  }

  // ISO 8601 duration such as "PT1H2M3.5S" in seconds.
  function parseDuration(value) {
    const match = /^P(?:([\d.]+)D)?(?:T(?:([\d.]+)H)?(?:([\d.]+)M)?(?:([\d.]+)S)?)?$/.exec(value || '');
    if (!match) return 0;
    const [days, hours, minutes, seconds] = match.slice(1).map(v => parseFloat(v || '0'));
    return ((days * 24 + hours) * 60 + minutes) * 60 + seconds;
  }

  // Fill in $RepresentationID$, $Number$, $Bandwidth$ and $Time$ (with optional %0Nd width).
  function expandTemplate(template, values) {
    return template.replace(/\$(RepresentationID|Number|Bandwidth|Time|)(?:%0(\d+)d)?\$/g,
      (match, name, width) => name ? String(values[name]).padStart(width ? +width : 0, '0') : '$');
  }

  function httpsUrl(url, base) {
    const resolved = new URL(url, base);
    if (resolved.protocol !== 'https:') throw new Error('Unexpected URL in manifest: ' + resolved.href);
    return resolved.href;
  }

  // SegmentTemplate attributes and timeline, inherited Period > AdaptationSet > Representation.
  function segmentTemplate(levels) {
    let attributes = null;
    let timeline = null;
    for (const level of levels) {
      const template = childElements(level, 'SegmentTemplate')[0];
      if (!template) continue;
      attributes = attributes || {};
      for (const attribute of Array.from(template.attributes)) {
        attributes[attribute.name] = attribute.value;
      }
      timeline = childElements(template, 'SegmentTimeline')[0] || timeline;
    }
    return attributes && { attributes, timeline };
  }

  function seaEncryption(levels, base) {
    let protection = null;
    for (const level of levels) {
      protection = childElements(level, 'ContentProtection')
        .find(element => element.getAttribute('schemeIdUri') === SEA_SCHEME) || protection;
    }
    if (!protection) return null;
    const encryption = descendants(protection, 'SegmentEncryption')[0];
    const periods = descendants(protection, 'CryptoPeriod');
    const scheme = encryption ? encryption.getAttribute('schemeIdUri') || '' : '';
    const keyUri = periods.length === 1 ? periods[0].getAttribute('keyUriTemplate') || '' : '';
    const iv = periods.length === 1 ? periods[0].getAttribute('IV') || '' : '';
    if (!/aes128-cbc/i.test(scheme) || !keyUri || keyUri.includes('$') ||
        !/^(0x)?[0-9a-f]{32}$/i.test(iv)) {
      throw new Error('This video uses an encryption layout the extension does not support');
    }
    return { keyUrl: httpsUrl(keyUri, base), iv: hexBytes(iv.replace(/^0x/i, '')) };
  }

  function hexBytes(hex) {
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16));
    return bytes;
  }

  // Segment URLs of one Representation: { initUrl, segments, encryption }.
  function representationTrack(representation, manifestUrl) {
    const set = representation.adaptationSet;
    const period = set.parentNode;
    const levels = [period, set, representation.element];

    let base = manifestUrl;
    for (const level of [period.parentNode].concat(levels)) {
      const baseUrl = childElements(level, 'BaseURL')[0];
      if (baseUrl && baseUrl.textContent.trim()) base = httpsUrl(baseUrl.textContent.trim(), base);
    }

    const values = { RepresentationID: representation.id, Bandwidth: representation.bandwidth };
    const template = segmentTemplate(levels);
    let initUrl = null;
    const segments = [];
    if (template) {
      const attributes = template.attributes;
      const startNumber = parseInt(attributes.startNumber || '1', 10);
      if (!attributes.media) throw new Error('The manifest has no segment URL template');
      const media = (number, time) =>
        httpsUrl(expandTemplate(attributes.media, Object.assign({ Number: number, Time: time }, values)), base);
      if (attributes.initialization) {
        initUrl = httpsUrl(expandTemplate(attributes.initialization,
          Object.assign({ Number: startNumber, Time: 0 }, values)), base);
      }
      const timescale = parseInt(attributes.timescale || '1', 10);
      const periodSeconds = parseDuration(period.getAttribute('duration')) ||
        parseDuration(period.parentNode.getAttribute('mediaPresentationDuration'));
      if (template.timeline) {
        let time = 0;
        let number = startNumber;
        const end = periodSeconds * timescale;
        for (const s of childElements(template.timeline, 'S')) {
          if (s.getAttribute('t') !== null) time = parseInt(s.getAttribute('t'), 10);
          const duration = parseInt(s.getAttribute('d') || '0', 10);
          const repeat = parseInt(s.getAttribute('r') || '0', 10);
          if (!(duration > 0)) continue;
          // r="-1" repeats until the end of the Period
          for (let i = 0; repeat < 0 ? time < end : i <= repeat; i++) {
            segments.push(media(number++, time));
            time += duration;
          }
        }
      } else {
        const duration = parseInt(attributes.duration || '0', 10);
        if (!(duration > 0) || !(periodSeconds > 0)) throw new Error('Cannot work out the segments of this video');
        const count = Math.ceil(periodSeconds * timescale / duration);
        for (let i = 0; i < count; i++) segments.push(media(startNumber + i, i * duration));
      }
    } else if (levels.some(level => childElements(level, 'SegmentList').length)) {
      throw new Error('This video uses a segment list, which the extension does not support');
    } else {
      segments.push(base); // one file, possibly with a SegmentBase index
    }
    return { initUrl, segments, encryption: seaEncryption(levels, base) };
  }

  // What to download for the best video and audio of a manifest:
  //   { protection, tracks: [{ type, initUrl, segments, encryption, width, height, bandwidth }] }
  // encryption is null or { keyUrl, iv: [16 bytes] } (DASH-SEA, AES-128-CBC).
  function dashDownloadPlan(doc, manifestUrl) {
    const representations = VideoCommands.representationsByType(doc);
    if (!representations || !representations.videos.length) {
      throw new Error('No video stream found in the manifest');
    }
    const protection = manifestProtection(doc);
    const tracks = [];
    for (const type of ['video', 'audio']) {
      const best = VideoCommands.bestRepresentation(representations[type + 's'], type);
      if (!best) continue;
      tracks.push(Object.assign({
        type,
        width: best.width,
        height: best.height,
        bandwidth: best.bandwidth
      }, representationTrack(best, manifestUrl)));
    }
    return { protection, tracks };
  }

  // ---------------------------------------------------------------------------------------
  // oneDrive.transcode sessions
  //
  // Newer SharePoint players stream from the tenant's own host:
  //   /_api_cached/v2.1/drives/<d>/items/<i>/oneDrive.transcode?...&part=initsegment|mediasegment
  //     &track=video|audio&quality=vcopy|audcopy&segmentTime=..&wsd=..&ppd=..&ppst=..
  // Media segment URLs differ only in segmentTime, which steps by wsd from ppst up to ppd.
  // A session keeps one init URL and one sample media URL per track, which is enough to
  // list every segment.

  const TRANSCODE_PATH = /\/oneDrive\.transcode$/i;

  function isTranscodeUrl(url) {
    try {
      return TRANSCODE_PATH.test(new URL(url).pathname);
    } catch (e) {
      return false;
    }
  }

  // Add a captured oneDrive.transcode URL to a session. Returns the (possibly new) session:
  // { item, tracks: { video: { quality, initUrl, sampleUrl, wsd, ppd, ppst }, audio: {...} } }
  function addTranscodeUrl(session, url) {
    if (!isTranscodeUrl(url)) return session;
    const parsed = new URL(url);
    const item = parsed.origin + parsed.pathname;
    if (!session || session.item !== item) session = { item, tracks: {} };
    const query = parsed.searchParams;
    const part = query.get('part');
    if (part !== 'initsegment' && part !== 'mediasegment') return session;

    const name = query.get('track') || 'video';
    const quality = query.get('quality') || '';
    let track = session.tracks[name];
    // Prefer the original-quality copy ("vcopy", "audcopy") over other renditions
    if (!track || (track.quality !== quality && /copy$/i.test(quality) && !/copy$/i.test(track.quality))) {
      track = session.tracks[name] = { quality, initUrl: null, sampleUrl: null };
    }
    if (track.quality !== quality) return session;
    if (part === 'initsegment') track.initUrl = track.initUrl || url;
    if (part === 'mediasegment') track.sampleUrl = track.sampleUrl || url;
    for (const key of ['wsd', 'ppd', 'ppst']) {
      if (track[key] == null && query.get(key) != null) track[key] = query.get(key);
    }
    return session;
  }

  function transcodeTrackReady(session, name) {
    const track = session && session.tracks[name];
    return !!(track && track.initUrl && track.sampleUrl && Number(track.wsd) > 0 && Number(track.ppd) > 0);
  }

  function decimals(value) {
    const match = /\.(\d+)$/.exec(String(value));
    return match ? match[1].length : 0;
  }

  // Download plan for a session: [{ type, initUrl, segments }]. One segment past the end
  // returns HTTP 500, so the count must be exact.
  function transcodeTracks(session) {
    const tracks = [];
    for (const type of ['video', 'audio']) {
      if (!transcodeTrackReady(session, type)) continue;
      const track = session.tracks[type];
      const wsd = Number(track.wsd);
      const ppst = Number(track.ppst || 0);
      const ratio = (Number(track.ppd) - ppst) / wsd;
      const count = Math.abs(ratio - Math.round(ratio)) < 1e-6 ? Math.round(ratio) : Math.ceil(ratio);
      const places = Math.max(decimals(track.wsd), decimals(track.ppst || 0));
      const segments = [];
      for (let i = 0; i < count; i++) {
        // Replace only segmentTime so the signed query string stays byte-for-byte the same
        const time = (ppst + i * wsd).toFixed(places);
        segments.push(track.sampleUrl.replace(/([?&]segmentTime=)[^&]*/, '$1' + time));
      }
      tracks.push({ type, initUrl: track.initUrl, segments });
    }
    return tracks;
  }

  // ---------------------------------------------------------------------------------------
  // Transcripts

  const SP_ITEM_PATH = /^(\/(?:personal|sites|teams)\/[^/]+)\/_api\/v[0-9.]+\/drives\/([^/]+)\/items\/([^/?]+)/;

  // Site path, drive id and item id of the video, from the first source that has them:
  // g_fileInfo's .spItemUrl, a oneDrive.transcode URL, the manifest's docid, the page path.
  function transcriptContext(sources) {
    const context = { sitePath: null, driveId: null, itemId: null };
    const fill = (sitePath, driveId, itemId) => {
      if (context.sitePath === null && sitePath !== undefined) context.sitePath = sitePath;
      if (!context.driveId && driveId) {
        context.driveId = driveId;
        context.itemId = itemId;
      }
    };
    const fromItemUrl = url => {
      try {
        const match = SP_ITEM_PATH.exec(new URL(url).pathname);
        if (match) fill(match[1], match[2], match[3]);
      } catch (e) { /* not a URL */ }
    };
    if (sources.spItemUrl) fromItemUrl(sources.spItemUrl);
    if (sources.transcodeUrl) {
      const match = /\/drives\/([^/]+)\/items\/([^/?]+)\//.exec(sources.transcodeUrl);
      if (match) fill(undefined, match[1], match[2]);
    }
    if (sources.manifestUrl) {
      try {
        const docid = new URL(sources.manifestUrl).searchParams.get('docid');
        if (docid) fromItemUrl(docid);
      } catch (e) { /* not a URL */ }
    }
    if (context.sitePath === null) {
      const match = /^\/(?:personal|sites|teams)\/[^/]+/.exec(sources.pathname || '');
      context.sitePath = match ? match[0] : '';
    }
    return context.driveId ? context : null;
  }

  // The item-with-expand call the player makes, then the transcripts collection.
  function transcriptMetadataUrls(origin, context) {
    const base = origin + context.sitePath + '/_api/v2.1/drives/' + context.driveId +
      '/items/' + context.itemId;
    return [
      base + '?select=media%2Ftranscripts%2CaudioTracks&%24expand=media%2Ftranscripts%2Cmedia%2FaudioTracks',
      base + '/media/transcripts'
    ];
  }

  // Transcript metadata comes as { media: { transcripts: [...] } }, { value: [...] } or a
  // single transcript object. Returns { transcript, none } where none means the response
  // says there definitely is no transcript.
  function transcriptFromMetadata(data) {
    const pick = list => list.find(t => t && t.isDefault) || list[0];
    if (data && data.media && Array.isArray(data.media.transcripts) && data.media.transcripts.length) {
      return { transcript: pick(data.media.transcripts), none: false };
    }
    if (data && Array.isArray(data.value) && data.value.length) {
      return { transcript: pick(data.value), none: false };
    }
    if (data && data.temporaryDownloadUrl) return { transcript: data, none: false };
    const none = !!data && ((data.media && !(data.media.transcripts || []).length) ||
      (Array.isArray(data.value) && !data.value.length));
    return { transcript: null, none };
  }

  // URL of the transcript as JSON. Behind Defender for Cloud Apps (MCAS) the page runs on
  // <tenant>.sharepoint.com.mcas.ms, so the download has to go through that host too.
  function transcriptJsonUrl(temporaryDownloadUrl, pageHostname) {
    const url = new URL(temporaryDownloadUrl + (temporaryDownloadUrl.includes('?') ? '&' : '?') + 'format=json');
    if (/\.mcas\.ms$/i.test(pageHostname || '') && !/\.mcas\.ms$/i.test(url.hostname)) {
      url.hostname += '.mcas.ms';
    }
    return url.href;
  }

  // "HH:MM:SS.fffffff" (optionally "d.HH:MM:SS...") in milliseconds
  function offsetMs(offset) {
    const match = /^(?:(\d+)\.)?(\d+):(\d+):(\d+)(?:\.(\d+))?$/.exec(String(offset || '').trim());
    if (!match) return 0;
    const [days, hours, minutes, seconds] = match.slice(1, 5).map(v => parseInt(v || '0', 10));
    const ms = Math.round(parseFloat('0.' + (match[5] || '0')) * 1000);
    return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000 + ms;
  }

  function clock(ms, separator) {
    const pad = (n, w) => String(n).padStart(w, '0');
    return pad(Math.floor(ms / 3600000), 2) + ':' + pad(Math.floor(ms / 60000) % 60, 2) + ':' +
      pad(Math.floor(ms / 1000) % 60, 2) + separator + pad(ms % 1000, 3);
  }

  function transcriptEntries(json) {
    return ((json && json.entries) || []).filter(entry => entry && entry.text);
  }

  function toSrt(json) {
    return transcriptEntries(json).map((entry, i) =>
      (i + 1) + '\n' + clock(offsetMs(entry.startOffset), ',') + ' --> ' +
      clock(offsetMs(entry.endOffset), ',') + '\n' + entry.text + '\n').join('\n');
  }

  function toVtt(json) {
    const escape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return 'WEBVTT\n\n' + transcriptEntries(json).map((entry, i) =>
      (i + 1) + '\n' + clock(offsetMs(entry.startOffset), '.') + ' --> ' +
      clock(offsetMs(entry.endOffset), '.') + '\n' +
      (entry.speakerDisplayName ? '<v ' + escape(entry.speakerDisplayName) + '>' : '') +
      escape(entry.text) + '\n').join('\n');
  }

  // ---------------------------------------------------------------------------------------
  // Downloads

  // HTTP statuses worth retrying: timeouts, throttling, and the 409/5xx the transcode
  // endpoint returns while it prepares a segment.
  function isRetriableStatus(status) {
    return status === 408 || status === 409 || status === 429 || (status >= 500 && status <= 599);
  }

  // Wait before retry number `attempt` (1-based): Retry-After seconds if given, else
  // exponential backoff from 1s, capped at 30s.
  function retryDelayMs(attempt, retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    const ms = seconds > 0 ? seconds * 1000 : 1000 * Math.pow(2, attempt - 1);
    return Math.min(ms, 30000);
  }

  // Same-origin URLs that may serve the original file: g_fileInfo's downloadUrl, and for
  // stream.aspx?id=<server-relative path> the file path with ?download=1.
  function originalFileUrls(fileInfo, pageUrl) {
    const page = new URL(pageUrl);
    const urls = [];
    if (fileInfo && fileInfo.downloadUrl) {
      try {
        urls.push(new URL(fileInfo.downloadUrl, page).href);
      } catch (e) { /* not a URL */ }
    }
    const id = page.searchParams.get('id');
    if (/\/stream\.aspx$/i.test(page.pathname) && id && id.startsWith('/')) {
      urls.push(page.origin + id.split('/').map(encodeURIComponent).join('/') + '?download=1');
    }
    return urls.filter((url, i) => new URL(url).origin === page.origin && urls.indexOf(url) === i);
  }

  // Whether a response is the video itself rather than an error or sign-in page.
  function looksLikeVideo(contentType, firstBytes) {
    const type = (contentType || '').toLowerCase();
    if (/text\/|json|xml/.test(type)) return false;
    const bytes = firstBytes || [];
    const ascii = String.fromCharCode.apply(null, Array.from(bytes.slice(4, 8)));
    const ebml = bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
    return ascii === 'ftyp' || ebml || /^(video|audio)\//.test(type);
  }

  // Filename base (no extension) from a video title.
  function fileBaseName(title) {
    const name = String(title || '').trim().replace(/\.(mp4|m4v|mov|mkv|webm|avi|wmv)$/i, '');
    return VideoCommands.sanitizeFilename(name || 'video').replace(/\.mp4$/i, '');
  }

  // ---------------------------------------------------------------------------------------
  // Tab state
  //
  // The background worker keeps, per tab, what each frame's content script captured
  // (frames[frameId]) and what it saw on the network itself (net). Decide which frame
  // handles the video and the transcript.

  const SHAREPOINT_HOST = /(\.sharepoint\.com|\.sharepoint\.com\.mcas\.ms|\.sharepoint\.us|\.sharepoint-mil\.us)$/i;

  // A manifest capture with a well-formed URL and token, or null.
  function cleanManifest(manifest) {
    if (!manifest || !VideoCommands.isManifestUrl(manifest.url)) return null;
    return Object.assign({}, manifest, { token: VideoCommands.isToken(manifest.token) ? manifest.token : null });
  }

  // What a content script reported for its frame, with page-supplied values checked again.
  function cleanFrame(frame) {
    return Object.assign({}, frame, { manifest: cleanManifest(frame && frame.manifest) });
  }

  function summarizeTab(state) {
    const frames = Object.keys((state && state.frames) || {}).map(id =>
      Object.assign({ frameId: Number(id) }, state.frames[id]));
    const net = (state && state.net) || {};
    const hostOf = frame => { try { return new URL(frame.url).hostname; } catch (e) { return ''; } };
    const spFrames = frames.filter(frame => SHAREPOINT_HOST.test(hostOf(frame)));
    const contextFrame = spFrames.find(frame => frame.fileInfo && frame.fileInfo.spItemUrl) ||
      spFrames.find(frame => frame.fileInfo) || spFrames[0] || null;

    // The manifest request the background worker saw on the network; what frames report
    // (which a page script can fake) only when there is none, newest first.
    const manifests = frames.map(frame => cleanManifest(frame.manifest) && Object.assign({ frameId: frame.frameId }, cleanManifest(frame.manifest)))
      .filter(Boolean)
      .sort((a, b) => (b.at || 0) - (a.at || 0));
    if (cleanManifest(net.manifest)) manifests.unshift(cleanManifest(net.manifest));
    let manifest = manifests[0] || null;
    if (manifest && !manifest.token) {
      const withToken = manifests.find(m => m.url === manifest.url && m.token);
      if (withToken) manifest = Object.assign({}, manifest, { token: withToken.token });
    }

    let transcode = net.transcode || null;
    for (const frame of frames) {
      if (!transcode || !transcodeTrackReady(transcode, 'video')) transcode = frame.transcode || transcode;
    }
    if (transcode && !transcodeTrackReady(transcode, 'video')) transcode = null;

    let video = null;
    if (manifest) {
      const frame = frames.find(f => f.frameId === manifest.frameId) || contextFrame;
      video = { kind: 'manifest', frameId: frame ? frame.frameId : 0, manifestUrl: manifest.url, token: manifest.token || null };
    } else if (transcode) {
      const origin = new URL(transcode.item).origin;
      const sameOrigin = frames.filter(frame => { try { return new URL(frame.url).origin === origin; } catch (e) { return false; } });
      const frame = sameOrigin.find(f => f.hasKey) || sameOrigin[0];
      video = { kind: 'transcode', frameId: frame ? frame.frameId : null, hasKey: !!(frame && frame.hasKey),
        hasAudio: transcodeTrackReady(transcode, 'audio'), transcode };
    }

    const fileInfo = contextFrame && contextFrame.fileInfo;
    const name = fileInfo && (fileInfo.displayName || fileInfo.name);
    return {
      video,
      // Frame that can try the original file and does the in-page work when no stream was seen
      pageFrameId: video && video.frameId !== null ? video.frameId : contextFrame ? contextFrame.frameId : null,
      transcriptFrameId: contextFrame ? contextFrame.frameId : video ? video.frameId : null,
      hasTranscripts: fileInfo ? fileInfo.hasTranscripts : undefined,
      title: name || null
    };
  }

  const api = {
    manifestProtection,
    parseDuration,
    expandTemplate,
    dashDownloadPlan,
    isTranscodeUrl,
    addTranscodeUrl,
    transcodeTrackReady,
    transcodeTracks,
    transcriptContext,
    transcriptMetadataUrls,
    transcriptFromMetadata,
    transcriptJsonUrl,
    offsetMs,
    toSrt,
    toVtt,
    isRetriableStatus,
    retryDelayMs,
    originalFileUrls,
    looksLikeVideo,
    fileBaseName,
    cleanFrame,
    summarizeTab
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.VideoMedia = api;
  }
})(this);
