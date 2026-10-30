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

  // Build every command the popup offers from the trimmed manifest URL.
  //   options: { filename, ffmpegPath, ytdlpPath, downloadFolder, cookiesBrowser, shell }
  function buildCommands(url, options) {
    const shell = options.shell;
    const command = (program, args) =>
      [formatProgram(program, shell)].concat(args.map(arg => quoteArg(arg, shell))).join(' ');
    const ffmpeg = options.ffmpegPath || 'ffmpeg';
    const output = joinPath(options.downloadFolder, options.filename, shell);

    const ytdlpArgs = [];
    if (options.cookiesBrowser && options.cookiesBrowser !== 'none') {
      ytdlpArgs.push('--cookies-from-browser', options.cookiesBrowser);
    }
    if (options.ffmpegPath) {
      ytdlpArgs.push('--ffmpeg-location', options.ffmpegPath);
    }
    // "bv*+ba/b": best video plus best audio, else the best single file. "%" is escaped
    // because -o is an output template.
    ytdlpArgs.push('-f', 'bv*+ba/b', '--merge-output-format', 'mp4',
      '-o', output.replace(/%/g, '%%'), url);

    return {
      ffmpeg: command(ffmpeg, ['-i', url, '-c', 'copy', output]),
      ffmpegBest: command(ffmpeg, ['-i', url, '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', output]),
      ffprobe: command(ffprobePathFor(options.ffmpegPath), ['-i', url, '-show_streams']),
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
    buildCommands
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.VideoCommands = api;
  }
})(this);
