document.addEventListener('DOMContentLoaded', function() {
    const pageStatus = document.getElementById('page-status');
    const filenameInput = document.getElementById('filename');
    const downloadSrtButton = document.getElementById('download-srt');
    const downloadVttButton = document.getElementById('download-vtt');
    const statusDiv = document.getElementById('status');
    const advanced = document.getElementById('advanced');
    const cliUnavailable = document.getElementById('cli-unavailable');
    const cliSection = document.getElementById('cli');
    const cliCaution = document.getElementById('cli-caution');
    const copyCommandButton = document.getElementById('copy-command');
    const copyBestQualityButton = document.getElementById('copy-best-quality');
    const copyYtdlpButton = document.getElementById('copy-ytdlp-command');
    const copyManifestUrlButton = document.getElementById('copy-manifest-url');
    const copyFfprobeButton = document.getElementById('copy-ffprobe');
    const commandSection = document.getElementById('command-section');
    const ffmpegCommand = document.getElementById('ffmpeg-command');
    const commandNote = document.getElementById('command-note');
    const copyToClipboard = document.getElementById('copy-to-clipboard');
    const manualTip = document.getElementById('manual-tip');
    const showSettingsBtn = document.getElementById('show-settings');
    const settingsPanel = document.getElementById('settings-panel');
    const mainPanel = document.getElementById('main-panel');
    const saveSettingsBtn = document.getElementById('save-settings');
    const backToMainBtn = document.getElementById('back-to-main');
    const ytdlpPathInput = document.getElementById('yt-dlp-path');
    const ffmpegPathInput = document.getElementById('ffmpeg-path');
    const downloadFolderInput = document.getElementById('download-folder');
    const shellSelect = document.getElementById('shell');
    const cookiesBrowserSelect = document.getElementById('cookies-browser');

    const SETTINGS = ['ytdlpPath', 'ffmpegPath', 'downloadFolder', 'shell', 'cookiesBrowser'];
    const detectedShell = VideoCommands.detectShell(
      (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform);
    const detectedBrowser = VideoCommands.detectBrowser({
      userAgent: navigator.userAgent,
      brands: navigator.userAgentData && navigator.userAgentData.brands,
      isBrave: !!navigator.brave
    });

    let tab = null;
    let summary = null;
    let filenameEdited = false;
    // Command-line view of the detected manifest: { url, token, frameId, loading, error, streams, protection, caution }
    let cli = null;
    let statusTimer = null;

    shellSelect.options[0].textContent = 'Auto-detect (' + VideoCommands.SHELLS[detectedShell] + ')';
    cookiesBrowserSelect.querySelector('option[value="auto"]').textContent = 'Auto-detect (' +
      cookiesBrowserSelect.querySelector('option[value="' + detectedBrowser + '"]').textContent + ')';

    // Load saved settings
    chrome.storage.local.get(SETTINGS, function(result) {
      if(result.ytdlpPath) ytdlpPathInput.value = result.ytdlpPath;
      if(result.ffmpegPath) ffmpegPathInput.value = result.ffmpegPath;
      if(result.downloadFolder) downloadFolderInput.value = result.downloadFolder;
      shellSelect.value = result.shell || 'auto';
      cookiesBrowserSelect.value = result.cookiesBrowser || 'none';
    });

    // Settings panel toggle
    showSettingsBtn.addEventListener('click', function() {
      mainPanel.classList.add('hidden');
      settingsPanel.classList.remove('hidden');
    });

    backToMainBtn.addEventListener('click', function() {
      settingsPanel.classList.add('hidden');
      mainPanel.classList.remove('hidden');
    });

    saveSettingsBtn.addEventListener('click', function() {
      chrome.storage.local.set({
        ytdlpPath: ytdlpPathInput.value.trim(),
        ffmpegPath: ffmpegPathInput.value.trim(),
        downloadFolder: downloadFolderInput.value.trim(),
        shell: shellSelect.value,
        cookiesBrowser: cookiesBrowserSelect.value
      }, function() {
        showStatus('Settings saved!', true);
        settingsPanel.classList.add('hidden');
        mainPanel.classList.remove('hidden');
      });
    });

    filenameInput.addEventListener('input', function() {
      filenameEdited = true;
    });

    // What the extension found in the tab, from background.js; refreshed while the popup is open
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      tab = tabs[0];
      refresh();
      setInterval(refresh, 1000);
    });

    function refresh() {
      chrome.runtime.sendMessage({type: 'get-state', tabId: tab.id}, function(response) {
        if(chrome.runtime.lastError || !response) return;
        summary = response.summary;
        render(response.state);
      });
    }

    function render(state) {
      const video = summary.video;
      if(!Object.keys(state.frames).length) {
        pageStatus.textContent = 'Open a video on SharePoint, OneDrive or Teams. If this is such a page, reload it: ' +
          'pages opened before the extension was installed or updated need a reload.';
      } else if(video) {
        pageStatus.textContent = 'Video found.';
      } else {
        pageStatus.textContent = 'No video stream seen yet: start playing the video.';
      }

      if(!filenameEdited) {
        filenameInput.value = VideoMedia.fileBaseName(summary.title || tab.title || 'video');
      }

      const noTranscript = summary.transcriptFrameId === null || summary.hasTranscripts === false;
      downloadSrtButton.disabled = noTranscript;
      downloadVttButton.disabled = noTranscript;
      downloadSrtButton.title = summary.hasTranscripts === false ? 'This video has no transcript' : '';
      downloadVttButton.title = downloadSrtButton.title;

      if(advanced.open) updateCli();
    }

    function baseName() {
      return VideoMedia.fileBaseName(filenameInput.value);
    }

    function sendToFrame(frameId, message, callback) {
      chrome.tabs.sendMessage(tab.id, message, {frameId: frameId}, function(response) {
        if(chrome.runtime.lastError || !response) {
          callback({error: 'The page did not respond. Reload the page and try again.'});
        } else {
          callback(response);
        }
      });
    }

    downloadSrtButton.addEventListener('click', function() {
      downloadTranscript('srt');
    });

    downloadVttButton.addEventListener('click', function() {
      downloadTranscript('vtt');
    });

    function downloadTranscript(format) {
      if(!summary || summary.transcriptFrameId === null) return;
      showStatus('Getting the transcript...', true, 0);
      sendToFrame(summary.transcriptFrameId, {action: 'transcript', format: format}, function(response) {
        if(response.none) {
          showStatus('This video has no transcript.', false, 0);
        } else if(response.error) {
          showStatus(response.error, false, 0);
        } else {
          saveText(response.text, baseName() + '.' + format);
          showStatus('Transcript saved (' + response.entries + ' lines).', true);
        }
      });
    }

    function saveText(text, filename) {
      const url = URL.createObjectURL(new Blob([text], {type: 'text/plain'}));
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    // ---- Advanced: command-line tools

    advanced.addEventListener('toggle', function() {
      if(advanced.open) updateCli();
    });

    // Read the detected manifest once to see whether command-line tools can work at all
    function updateCli() {
      const video = summary && summary.video;
      if(!video || video.kind !== 'manifest') {
        cli = null;
        showCliUnavailable(video ?
          'This video uses SharePoint\'s newer streaming format, which is encrypted and only works with your ' +
          'browser\'s sign-in. Command-line tools can\'t download it.' :
          'No video stream seen yet. Start playing the video.');
        return;
      }
      if(cli && cli.url === video.manifestUrl && (cli.token || !video.token)) {
        renderCli();
        return;
      }
      cli = {url: video.manifestUrl, token: video.token, loading: true};
      renderCli();
      const request = cli;
      sendToFrame(video.frameId, {action: 'fetchManifest', url: request.url, token: request.token}, function(response) {
        if(cli !== request) return;
        cli.loading = false;
        if(response.error) {
          cli.error = response.error;
        } else {
          const doc = new DOMParser().parseFromString(response.manifest, 'application/xml');
          if(doc.getElementsByTagName('parsererror').length) {
            cli.error = 'The manifest could not be read.';
          } else {
            cli.protection = VideoMedia.manifestProtection(doc);
            cli.streams = VideoCommands.selectBestStreams(doc);
            cli.caution = segmentsNeedCookies(doc, request.url);
          }
        }
        renderCli();
      });
    }

    // Since 2026 segments are usually served from SharePoint itself and need the browser's cookies
    function segmentsNeedCookies(doc, url) {
      try {
        const track = VideoMedia.dashDownloadPlan(doc, url).tracks[0];
        const host = new URL(track.initUrl || track.segments[0]).hostname;
        return /sharepoint/i.test(host);
      } catch (e) {
        return false;
      }
    }

    function showCliUnavailable(text) {
      cliUnavailable.textContent = text;
      cliUnavailable.classList.remove('hidden');
      cliSection.classList.add('hidden');
    }

    function renderCli() {
      if(cli.loading) {
        showCliUnavailable('Checking whether command-line tools can download this video...');
      } else if(cli.error) {
        showCliUnavailable('Could not read the video manifest (' + cli.error + '). Command-line tools won\'t work either.');
      } else if(cli.protection.kind !== 'none') {
        showCliUnavailable('This video is encrypted (' + cli.protection.name + '). ffmpeg and yt-dlp can\'t decrypt it ' +
          'and its segments need your browser\'s sign-in, so command-line tools can\'t download it. ' +
          (cli.protection.kind === 'sea' ? '' : 'It can only be played in the browser.'));
      } else {
        cliUnavailable.classList.add('hidden');
        cliSection.classList.remove('hidden');
        cliCaution.textContent = cli.caution ? 'The video segments are served by SharePoint and need your sign-in ' +
          'cookies, which these tools don\'t have, so they will probably fail.' : '';
      }
    }

    function cliReady() {
      if(!cli || cli.loading || cli.error) {
        showStatus('No usable manifest URL.', false, 0);
        return false;
      }
      return true;
    }

    // Generate basic FFmpeg command
    copyCommandButton.addEventListener('click', function() {
      if(!cliReady()) return;
      withCommands(function(commands, shellName) {
        showCommand(commands.ffmpeg, 'ffmpeg chooses the streams: the highest resolution video, but not necessarily the best audio. ' +
          formattedFor(shellName));
      });
    });

    // Generate best quality FFmpeg command
    copyBestQualityButton.addEventListener('click', function() {
      if(!cliReady()) return;
      withCommands(function(commands, shellName) {
        showCommand(commands.ffmpegBest, describeSelection(cli.streams) + ' ' + formattedFor(shellName));
      }, cli.streams);
    });

    // Generate yt-dlp command
    copyYtdlpButton.addEventListener('click', function() {
      if(!cliReady()) return;
      withCommands(function(commands, shellName) {
        showCommand(commands.ytdlp, 'yt-dlp picks the best video and audio by itself. It needs ffmpeg installed to merge them. ' +
          formattedFor(shellName));
      });
    });

    // Copy manifest URL
    copyManifestUrlButton.addEventListener('click', function() {
      if(!cliReady()) return;
      navigator.clipboard.writeText(cli.url).then(() => {
        showStatus('Manifest URL copied to clipboard!' + (cli.token ? ' It needs the X-SPOPacToken header, which the commands include.' : ''), true);
      });
    });

    // Copy ffprobe command
    copyFfprobeButton.addEventListener('click', function() {
      if(!cliReady()) return;
      withCommands(function(commands) {
        navigator.clipboard.writeText(commands.ffprobe).then(() => {
          showStatus('ffprobe command copied!', true);
          manualTip.style.display = 'block';
        });
      });
    });

    // Copy command to clipboard
    copyToClipboard.addEventListener('click', function() {
      const command = ffmpegCommand.textContent;
      navigator.clipboard.writeText(command).then(() => {
        showStatus('Command copied to clipboard!', true);
      });
    });

    // Show a status message; it disappears after clearAfterMs unless that is 0
    function showStatus(message, ok, clearAfterMs) {
      clearTimeout(statusTimer);
      statusDiv.textContent = message;
      statusDiv.style.backgroundColor = !message ? 'transparent' : ok ? '#d4edda' : '#f8d7da';
      if(message && clearAfterMs !== 0) {
        statusTimer = setTimeout(() => {
          statusDiv.textContent = '';
          statusDiv.style.backgroundColor = 'transparent';
        }, clearAfterMs || 2000);
      }
    }

    function showCommand(command, note) {
      ffmpegCommand.textContent = command;
      commandNote.textContent = note;
      commandSection.classList.remove('hidden');
      manualTip.style.display = 'none';
    }

    function readSettings(callback) {
      chrome.storage.local.get(SETTINGS, function(result) {
        callback({
          ffmpegPath: result.ffmpegPath,
          ytdlpPath: result.ytdlpPath,
          downloadFolder: result.downloadFolder,
          shell: result.shell && result.shell !== 'auto' ? result.shell : detectedShell,
          cookiesBrowser: result.cookiesBrowser === 'auto' ? detectedBrowser : result.cookiesBrowser || 'none'
        });
      });
    }

    // Build all commands for the detected video with the saved settings. streams are the
    // best streams found in the manifest, used by the Best Quality command.
    function withCommands(callback, streams) {
      readSettings(function(settings) {
        const commands = VideoCommands.buildCommands(cli.url, Object.assign({
          filename: VideoCommands.sanitizeFilename(filenameInput.value) || 'video.mp4',
          token: cli.token
        }, settings), streams || null);
        callback(commands, VideoCommands.SHELLS[settings.shell]);
      });
    }

    function describeSelection(streams) {
      if(!streams) {
        return 'Could not find the streams in the manifest, so ffmpeg chooses: ' +
          'the highest resolution video, but not necessarily the best audio.';
      }
      return 'Picks video ' + describeStream(streams.video) + ' (best of ' + streams.videoCount + ')' +
        (streams.audio ? ' and audio ' + describeStream(streams.audio) + ' (best of ' + streams.audioCount + ').' :
          '. No separate audio stream was found.');
    }

    function describeStream(stream) {
      const parts = [];
      if(stream.width && stream.height) parts.push(stream.width + 'x' + stream.height);
      if(stream.bandwidth) parts.push(Math.round(stream.bandwidth / 1000) + ' kbps');
      return parts.join(', ') || stream.specifier;
    }

    function formattedFor(shellName) {
      return 'Formatted for ' + shellName + '; you can change this in Settings.';
    }
  });
