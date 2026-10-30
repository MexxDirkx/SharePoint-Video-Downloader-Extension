// commands.js
// Builds the ffmpeg / ffprobe / yt-dlp commands shown in the popup from the detected
// videomanifest URL. Pure functions only (no chrome.* or page DOM), so the logic can be
// tested with node: `require('./commands.js')`.
(function (root) {
  'use strict';

  const MANIFEST_SUFFIX = 'index&format=dash';

  // Cut the videomanifest URL right after "index&format=dash"; the parameters after it
  // are only used by the web player.
  function trimManifestUrl(url) {
    const pos = url.indexOf(MANIFEST_SUFFIX);
    return pos === -1 ? url : url.substring(0, pos + MANIFEST_SUFFIX.length);
  }

  // Turn a page title into an .mp4 filename. Besides the characters Windows forbids, this
  // replaces "%" (expanded by cmd.exe and by yt-dlp's output template) and control characters.
  function sanitizeFilename(filename) {
    if (!filename) return '';
    let sanitized = filename.trim().replace(/[\u0000-\u001f<>:"/\\|?*%]/g, '_');
    if (!sanitized) return '';
    if (!sanitized.toLowerCase().endsWith('.mp4')) {
      sanitized += '.mp4';
    }
    return sanitized;
  }

  // Shells the commands can be formatted for.
  const SHELLS = {
    powershell: 'PowerShell',
    cmd: 'Command Prompt',
    posix: 'bash / zsh'
  };

  function detectShell(platform) {
    return /^win/i.test(platform || '') ? 'powershell' : 'posix';
  }

  // Browser for yt-dlp's --cookies-from-browser, guessed from the browser running the popup.
  function detectBrowser(info) {
    const brands = (info.brands || []).map(b => b.brand);
    const ua = info.userAgent || '';
    if (info.isBrave || brands.includes('Brave')) return 'brave';
    if (brands.includes('Microsoft Edge') || /\bEdg\//.test(ua)) return 'edge';
    if (brands.includes('Opera') || /\bOPR\//.test(ua)) return 'opera';
    if (/\bFirefox\//.test(ua)) return 'firefox';
    return 'chrome';
  }

  // Quote one argument so the shell passes it to the program unchanged.
  //   posix:      single quotes, ' becomes '\''. Double quotes are not safe: bash and zsh
  //               expand "!" in them, and SharePoint drive ids in the URL start with "b!".
  //   powershell: single quotes, quote characters doubled. PowerShell also treats the
  //               typographic quotes U+2018..U+201B as single quotes.
  //   cmd:        double quotes, the only quoting cmd.exe has. URLs and sanitized
  //               filenames never contain a double quote.
  function quoteArg(arg, shell) {
    arg = String(arg);
    if (shell === 'posix') {
      if (/^[A-Za-z0-9_.\/:-]+$/.test(arg)) return arg;
      return "'" + arg.replace(/'/g, "'\\''") + "'";
    }
    if (/^[A-Za-z0-9_.\/:\\-]+$/.test(arg)) return arg;
    if (shell === 'cmd') return '"' + arg.replace(/"/g, '') + '"';
    return "'" + arg.replace(/['\u2018-\u201b]/g, '$&$&') + "'";
  }

  // The program at the start of a command line. PowerShell reads a quoted first word as a
  // string, so a quoted path needs the call operator "&" to run.
  function formatProgram(path, shell) {
    const quoted = quoteArg(path, shell);
    return shell === 'powershell' && quoted !== path ? '& ' + quoted : quoted;
  }

  function joinPath(folder, filename, shell) {
    if (!folder) return filename;
    const separator = shell === 'posix' ? '/' : '\\';
    return folder.replace(/[\\\/]+$/, '') + separator + filename;
  }

  // ffprobe ships next to ffmpeg, so derive its path from a configured ffmpeg path.
  function ffprobePathFor(ffmpegPath) {
    if (!ffmpegPath || !/ffmpeg(\.exe)?$/i.test(ffmpegPath)) return 'ffprobe';
    return ffmpegPath.replace(/ffmpeg(\.exe)?$/i, (match, ext) => 'ffprobe' + (ext || ''));
  }

  function childElements(element, name) {
    return Array.prototype.filter.call(element.childNodes,
      node => node.nodeType === 1 && node.localName === name);
  }

  // Media type of an MPD element, decided the way ffmpeg's DASH demuxer does it: by
  // "video", "audio" or "text" in contentType, overridden by a match in mimeType.
  function mediaType(element) {
    if (!element) return null;
    let type = null;
    for (const attribute of ['contentType', 'mimeType']) {
      const value = (element.getAttribute(attribute) || '').toLowerCase();
      if (value.includes('video')) type = 'video';
      else if (value.includes('audio')) type = 'audio';
      else if (value.includes('text')) type = 'text';
    }
    return type;
  }

  // Attributes like width or bandwidth may sit on the Representation or its AdaptationSet.
  function numberAttribute(representation, adaptationSet, name) {
    const value = representation.getAttribute(name) || adaptationSet.getAttribute(name);
    return parseInt(value, 10) || 0;
  }

  function highest(items, compare) {
    return items.reduce((best, item) => (compare(item, best) > 0 ? item : best));
  }

  // The video and audio Representations of a parsed DASH manifest, each list in ffmpeg's
  // stream order. ffmpeg's DASH demuxer creates one stream per Representation: all video
  // Representations first, then all audio ones, each in manifest order. So the n-th video
  // Representation is "0:v:n" whatever order the AdaptationSets are in.
  // Returns null when the manifest is not something we can map reliably.
  function representationsByType(doc) {
    const mpd = doc && doc.documentElement;
    if (!mpd || mpd.localName !== 'MPD') return null;
    // With several Periods ffmpeg picks one by duration; SharePoint manifests have one.
    const periods = childElements(mpd, 'Period');
    if (periods.length !== 1) return null;

    const videos = [];
    const audios = [];
    for (const adaptationSet of childElements(periods[0], 'AdaptationSet')) {
      const contentComponent = childElements(adaptationSet, 'ContentComponent')[0];
      for (const representation of childElements(adaptationSet, 'Representation')) {
        const type = mediaType(representation) || mediaType(contentComponent) ||
          mediaType(adaptationSet);
        const list = type === 'video' ? videos : type === 'audio' ? audios : null;
        if (!list) continue;
        list.push({
          index: list.length,
          id: representation.getAttribute('id') || '',
          bandwidth: numberAttribute(representation, adaptationSet, 'bandwidth'),
          width: numberAttribute(representation, adaptationSet, 'width'),
          height: numberAttribute(representation, adaptationSet, 'height'),
          element: representation,
          adaptationSet: adaptationSet
        });
      }
    }
    return { videos, audios };
  }

  // Highest resolution (then bandwidth) for video, highest bandwidth for audio.
  function bestRepresentation(list, type) {
    if (!list.length) return null;
    return type === 'video' ?
      highest(list, (a, b) => a.width * a.height - b.width * b.height || a.bandwidth - b.bandwidth) :
      highest(list, (a, b) => a.bandwidth - b.bandwidth);
  }

  // Find the best video and audio Representation and their ffmpeg stream specifiers.
  function selectBestStreams(doc) {
    const representations = representationsByType(doc);
    if (!representations || !representations.videos.length) return null;
    const describe = (rep, letter) => rep && {
      specifier: '0:' + letter + ':' + rep.index,
      index: rep.index,
      id: rep.id,
      bandwidth: rep.bandwidth,
      width: rep.width,
      height: rep.height
    };
    return {
      video: describe(bestRepresentation(representations.videos, 'video'), 'v'),
      audio: describe(bestRepresentation(representations.audios, 'audio'), 'a'),
      videoCount: representations.videos.length,
      audioCount: representations.audios.length
    };
  }

  // Parse manifest text with the given DOMParser and select the best streams.
  function streamsFromManifest(text, domParser) {
    let doc;
    try {
      doc = domParser.parseFromString(text, 'application/xml');
    } catch (e) {
      return null;
    }
    if (!doc || doc.getElementsByTagName('parsererror').length) return null;
    return selectBestStreams(doc);
  }

  function commandLine(program, args, shell) {
    return [formatProgram(program, shell)].concat(args.map(arg => quoteArg(arg, shell))).join(' ');
  }

  // Build every command the popup offers from the trimmed manifest URL.
  //   options: { filename, ffmpegPath, ytdlpPath, downloadFolder, cookiesBrowser, shell, token }
  //   streams: result of selectBestStreams(), or null if the manifest could not be read
  // token is the player's X-SPOPacToken; the media service answers 401 without it.
  function buildCommands(url, options, streams) {
    const shell = options.shell;
    const command = (program, args) => commandLine(program, args, shell);
    const ffmpeg = options.ffmpegPath || 'ffmpeg';
    const output = joinPath(options.downloadFolder, options.filename, shell);
    // ffmpeg adds the CRLF that ends a -headers value itself (with a warning)
    const input = (options.token ? ['-headers', 'X-SPOPacToken: ' + options.token] : []).concat('-i', url);

    // Without -map ffmpeg picks the highest-resolution video, but for audio the first stream
    // with the most channels, which on SharePoint is the lowest bitrate.
    const bestMaps = [];
    if (streams) {
      bestMaps.push('-map', streams.video.specifier);
      if (streams.audio) bestMaps.push('-map', streams.audio.specifier);
    }

    const ytdlpArgs = [];
    if (options.cookiesBrowser && options.cookiesBrowser !== 'none') {
      ytdlpArgs.push('--cookies-from-browser', options.cookiesBrowser);
    }
    if (options.ffmpegPath) {
      ytdlpArgs.push('--ffmpeg-location', options.ffmpegPath);
    }
    if (options.token) {
      ytdlpArgs.push('--add-header', 'X-SPOPacToken:' + options.token);
    }
    // "bv*+ba/b": best video plus best audio, else the best single file. "%" is escaped
    // because -o is an output template.
    ytdlpArgs.push('-f', 'bv*+ba/b', '--merge-output-format', 'mp4',
      '-o', output.replace(/%/g, '%%'), url);

    return {
      ffmpeg: command(ffmpeg, input.concat('-c', 'copy', output)),
      ffmpegBest: command(ffmpeg, input.concat(bestMaps, '-c', 'copy', output)),
      ffprobe: command(ffprobePathFor(options.ffmpegPath), input.concat('-show_streams')),
      ytdlp: command(options.ytdlpPath || 'yt-dlp', ytdlpArgs)
    };
  }

  const api = {
    SHELLS,
    trimManifestUrl,
    sanitizeFilename,
    detectShell,
    detectBrowser,
    quoteArg,
    formatProgram,
    joinPath,
    ffprobePathFor,
    representationsByType,
    bestRepresentation,
    selectBestStreams,
    streamsFromManifest,
    buildCommands
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.VideoCommands = api;
  }
})(this);
