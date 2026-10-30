document.addEventListener('DOMContentLoaded', function() {
    const detectButton = document.getElementById('detect-video');
    const copyCommandButton = document.getElementById('copy-command');
    const copyBestQualityButton = document.getElementById('copy-best-quality');
    const copyYtdlpButton = document.getElementById('copy-ytdlp-command');
    const copyManifestUrlButton = document.getElementById('copy-manifest-url');
    const copyFfprobeButton = document.getElementById('copy-ffprobe');
    const filenameInput = document.getElementById('filename');
    const videoInfo = document.getElementById('video-info');
    const commandSection = document.getElementById('command-section');
    const ffmpegCommand = document.getElementById('ffmpeg-command');
    const commandNote = document.getElementById('command-note');
    const copyToClipboard = document.getElementById('copy-to-clipboard');
    const statusDiv = document.getElementById('status');
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
    const manualTip = document.getElementById('manual-tip');

    const SETTINGS = ['ytdlpPath', 'ffmpegPath', 'downloadFolder', 'shell', 'cookiesBrowser'];
    const detectedShell = VideoCommands.detectShell(
      (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform);
    const detectedBrowser = VideoCommands.detectBrowser({
      userAgent: navigator.userAgent,
      brands: navigator.userAgentData && navigator.userAgentData.brands,
      isBrave: !!navigator.brave
    });

    let videoUrl = null;
    // Resolves to {streams, error} once the manifest of the detected video has been read
    let streamsPromise = null;
    let statusTimer = null;

    shellSelect.options[0].textContent = 'Auto-detect (' + VideoCommands.SHELLS[detectedShell] + ')';
    cookiesBrowserSelect.options[0].textContent = 'Auto-detect (' +
      cookiesBrowserSelect.querySelector('option[value="' + detectedBrowser + '"]').textContent + ')';

    // Load saved settings
    chrome.storage.local.get(SETTINGS, function(result) {
      if(result.ytdlpPath) ytdlpPathInput.value = result.ytdlpPath;
      if(result.ffmpegPath) ffmpegPathInput.value = result.ffmpegPath;
      if(result.downloadFolder) downloadFolderInput.value = result.downloadFolder;
      shellSelect.value = result.shell || 'auto';
      cookiesBrowserSelect.value = result.cookiesBrowser || 'auto';
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

    // Detect video from current tab and get page title
    detectButton.addEventListener('click', function() {
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        chrome.tabs.sendMessage(tabs[0].id, {action: "detectVideo"}, function(response) {
          if(response && response.videoManifestUrl) {
            videoUrl = VideoCommands.trimManifestUrl(response.videoManifestUrl);
            // Read the stream list now so "Best Quality" is ready when clicked
            streamsPromise = loadStreams(tabs[0].id, videoUrl);
            videoInfo.classList.remove('hidden');

            // Get the title of the current tab's page
            const pageTitle = tabs[0].title || 'video';  // Default to 'video' if no title is available
            filenameInput.value = pageTitle; // Set filename to the page title

            showStatus('Video detected successfully!', true);
          } else {
            showStatus('No video detected. Make sure you are on a page with a SharePoint or Streams video and start playing it first.', false, 0);
          }
        });
      });
    });

    // Generate basic FFmpeg command
    copyCommandButton.addEventListener('click', function() {
      if(!requireVideo()) return;
      withCommands(function(commands, shellName) {
        showCommand(commands.ffmpeg, 'ffmpeg chooses the streams: the highest resolution video, but not necessarily the best audio. ' +
          formattedFor(shellName));
      });
    });

    // Generate best quality FFmpeg command
    copyBestQualityButton.addEventListener('click', function() {
      if(!requireVideo()) return;
      showStatus('Reading the list of streams...', true, 0);
      streamsPromise.then(function(result) {
        withCommands(function(commands, shellName) {
          showStatus('', true);
          showCommand(commands.ffmpegBest, describeSelection(result) + ' ' + formattedFor(shellName));
        }, result.streams);
      });
    });

    // Generate yt-dlp command
    copyYtdlpButton.addEventListener('click', function() {
      if(!requireVideo()) return;
      withCommands(function(commands, shellName) {
        showCommand(commands.ytdlp, 'yt-dlp picks the best video and audio by itself. It needs ffmpeg installed to merge them. ' +
          formattedFor(shellName));
      });
    });

    // Copy manifest URL
    copyManifestUrlButton.addEventListener('click', function() {
      if(!requireVideo()) return;
      navigator.clipboard.writeText(videoUrl).then(() => {
        showStatus('Manifest URL copied to clipboard!', true);
      });
    });

    // Copy ffprobe command
    copyFfprobeButton.addEventListener('click', function() {
      if(!requireVideo()) return;
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

    function requireVideo() {
      if(!videoUrl) showStatus('No video URL detected.', false, 0);
      return !!videoUrl;
    }

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

    // Ask the content script to fetch the manifest, then pick the best streams from it
    function loadStreams(tabId, url) {
      return new Promise(function(resolve) {
        chrome.tabs.sendMessage(tabId, {action: 'fetchManifest', url: url}, function(response) {
          if(chrome.runtime.lastError || !response) {
            resolve({streams: null, error: 'the page did not respond'});
          } else if(response.error) {
            resolve({streams: null, error: response.error});
          } else {
            const streams = VideoCommands.streamsFromManifest(response.manifest, new DOMParser());
            resolve({streams: streams, error: streams ? null : 'unexpected manifest format'});
          }
        });
      });
    }

    // Build all commands for the detected video with the saved settings. streams are the
    // best streams found in the manifest, used by the Best Quality command.
    function withCommands(callback, streams) {
      chrome.storage.local.get(SETTINGS, function(result) {
        const shell = result.shell && result.shell !== 'auto' ? result.shell : detectedShell;
        const cookiesBrowser = result.cookiesBrowser && result.cookiesBrowser !== 'auto' ?
          result.cookiesBrowser : detectedBrowser;
        const commands = VideoCommands.buildCommands(videoUrl, {
          filename: VideoCommands.sanitizeFilename(filenameInput.value) || 'video.mp4',
          ffmpegPath: result.ffmpegPath,
          ytdlpPath: result.ytdlpPath,
          downloadFolder: result.downloadFolder,
          shell: shell,
          cookiesBrowser: cookiesBrowser
        }, streams || null);
        callback(commands, VideoCommands.SHELLS[shell]);
      });
    }

    function describeSelection(result) {
      if(!result.streams) {
        return 'Could not read the list of streams (' + result.error + '), so ffmpeg chooses: ' +
          'the highest resolution video, but not necessarily the best audio. ' +
          'Try the yt-dlp command, or ffprobe to choose streams yourself.';
      }
      const streams = result.streams;
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









  const downloadTranscriptButton = document.getElementById('download-transcript');
const statusDiv = document.getElementById('status');
let transcriptData = null;

// Detect transcript from content script
chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    chrome.tabs.sendMessage(tabs[0].id, { action: "detectTranscript" }, function (response) {
        if (response && response.transcript) {
            transcriptData = response.transcript;
            downloadTranscriptButton.disabled = false;
            statusDiv.textContent = 'Transcript detected!';
            statusDiv.style.backgroundColor = '#d4edda';
            setTimeout(() => {
                statusDiv.textContent = '';
                statusDiv.style.backgroundColor = 'transparent';
            }, 2000);
        } else {
            statusDiv.textContent = 'No transcript detected.';
            statusDiv.style.backgroundColor = '#f8d7da';
        }
    });
});


// Function to format time from "00:00:00.2800000" to "00:00:00,280"
function formatSRTTime(time) {
    let parts = time.split('.')[0].split(':'); // Extract HH:MM:SS
    let milliseconds = time.split('.')[1]?.slice(0, 3) || "000"; // Take only the first three digits
    return `${parts[0]}:${parts[1]}:${parts[2]},${milliseconds}`;
}

// Convert transcript JSON to SRT format
function convertToSRT(transcriptJson) {
    return transcriptJson.entries.map((entry, index) => {
        const start = formatSRTTime(entry.startOffset);
        const end = formatSRTTime(entry.endOffset);
        return `${index + 1}\n${start} --> ${end}\n${entry.text}\n`;
    }).join("\n");
}

// Download the transcript as an SRT file
downloadTranscriptButton.addEventListener('click', function () {
    if (!transcriptData) return;

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        let pageTitle = tabs[0].title || 'video';  // Default to 'video' if no title is found
        let transcriptFilename = pageTitle.replace('.mp4', '') + ".srt";  // Replace .mp4 with .srt

        const srtContent = convertToSRT(transcriptData);
        const blob = new Blob([srtContent], { type: "text/plain" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = transcriptFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    });
});
