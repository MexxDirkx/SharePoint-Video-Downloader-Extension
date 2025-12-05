document.addEventListener('DOMContentLoaded', function() {
    const detectButton = document.getElementById('detect-video');
    const copyCommandButton = document.getElementById('copy-command');
    const copyBestQualityButton = document.getElementById('copy-best-quality');
    const copyManifestUrlButton = document.getElementById('copy-manifest-url');
    const copyFfprobeButton = document.getElementById('copy-ffprobe');
    const filenameInput = document.getElementById('filename');
    const videoInfo = document.getElementById('video-info');
    const commandSection = document.getElementById('command-section');
    const ffmpegCommand = document.getElementById('ffmpeg-command');
    const copyToClipboard = document.getElementById('copy-to-clipboard');
    const statusDiv = document.getElementById('status');
    const showSettingsBtn = document.getElementById('show-settings');
    const settingsPanel = document.getElementById('settings-panel');
    const mainPanel = document.getElementById('main-panel');
    const saveSettingsBtn = document.getElementById('save-settings');
    const backToMainBtn = document.getElementById('back-to-main');
    const ffmpegPathInput = document.getElementById('ffmpeg-path');
    const downloadFolderInput = document.getElementById('download-folder');
    const manualTip = document.getElementById('manual-tip');
  
    let videoUrl = null;
  
    // Load saved settings
    chrome.storage.local.get(['ffmpegPath', 'downloadFolder'], function(result) {
      if(result.ffmpegPath) ffmpegPathInput.value = result.ffmpegPath;
      if(result.downloadFolder) downloadFolderInput.value = result.downloadFolder;
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
        ffmpegPath: ffmpegPathInput.value,
        downloadFolder: downloadFolderInput.value
      }, function() {
        statusDiv.textContent = 'Settings saved!';
        statusDiv.style.backgroundColor = '#d4edda';
        settingsPanel.classList.add('hidden');
        mainPanel.classList.remove('hidden');
        setTimeout(() => {
          statusDiv.textContent = '';
          statusDiv.style.backgroundColor = 'transparent';
        }, 2000);
      });
    });
  
    // Detect video from current tab and get page title
    detectButton.addEventListener('click', function() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, {action: "detectVideo"}, function(response) {
        if(response && response.videoManifestUrl) {
          videoUrl = processManifestUrl(response.videoManifestUrl);
          videoInfo.classList.remove('hidden');
          
          // Get the title of the current tab's page
          const pageTitle = tabs[0].title || 'video';  // Default to 'video' if no title is available
          filenameInput.value = pageTitle; // Set filename to the page title
          
          statusDiv.textContent = 'Video detected successfully!';
          statusDiv.style.backgroundColor = '#d4edda';
          setTimeout(() => {
            statusDiv.textContent = '';
            statusDiv.style.backgroundColor = 'transparent';
          }, 2000);
        } else {
          statusDiv.textContent = 'No video detected. Make sure you are on a page with a SharePoint or Streams video and start playing it first.';
          statusDiv.style.backgroundColor = '#f8d7da';
        }
      });
    });
  });
  
  // Generate basic FFmpeg command
  copyCommandButton.addEventListener('click', function() {
    if(!videoUrl) {
      statusDiv.textContent = 'No video URL detected.';
      statusDiv.style.backgroundColor = '#f8d7da';
      return;
    }
  
    chrome.storage.local.get(['ffmpegPath', 'downloadFolder'], function(result) {
      const filename = sanitizeFilename(filenameInput.value) || 'video.mp4';
      const ffmpegPath = result.ffmpegPath || 'ffmpeg';
      const downloadFolder = result.downloadFolder || '.';
      const outputPath = downloadFolder ? `${downloadFolder}/${filename}` : filename;
      
      // Create the command (basic - may get lowest quality)
      const command = `${ffmpegPath} -i "${videoUrl}" -c copy "${outputPath}"`;
      
      // Display the command
      ffmpegCommand.textContent = command;
      commandSection.classList.remove('hidden');
      manualTip.style.display = 'none';
    });
  });

  // Generate best quality FFmpeg command
  copyBestQualityButton.addEventListener('click', function() {
    if(!videoUrl) {
      statusDiv.textContent = 'No video URL detected.';
      statusDiv.style.backgroundColor = '#f8d7da';
      return;
    }
  
    chrome.storage.local.get(['ffmpegPath', 'downloadFolder'], function(result) {
      const filename = sanitizeFilename(filenameInput.value) || 'video.mp4';
      const ffmpegPath = result.ffmpegPath || 'ffmpeg';
      const downloadFolder = result.downloadFolder || '.';
      const outputPath = downloadFolder ? `${downloadFolder}/${filename}` : filename;
      
      // Create the command - select best quality video and audio streams
      // -map 0:v:0 selects first video variant, -map 0:a:0 selects first audio variant
      // Using variant streams (v:0, a:0) lets FFmpeg pick the best quality within each type
      const command = `${ffmpegPath} -i "${videoUrl}" -map 0:v:0 -map 0:a:0 -c copy "${outputPath}"`;
      
      // Display the command
      ffmpegCommand.textContent = command;
      commandSection.classList.remove('hidden');
      manualTip.style.display = 'none';
    });
  });

  // Copy manifest URL
  copyManifestUrlButton.addEventListener('click', function() {
    if(!videoUrl) {
      statusDiv.textContent = 'No video URL detected.';
      statusDiv.style.backgroundColor = '#f8d7da';
      return;
    }
    
    navigator.clipboard.writeText(videoUrl).then(() => {
      statusDiv.textContent = 'Manifest URL copied to clipboard!';
      statusDiv.style.backgroundColor = '#d4edda';
      setTimeout(() => {
        statusDiv.textContent = '';
        statusDiv.style.backgroundColor = 'transparent';
      }, 2000);
    });
  });

  // Copy ffprobe command
  copyFfprobeButton.addEventListener('click', function() {
    if(!videoUrl) {
      statusDiv.textContent = 'No video URL detected.';
      statusDiv.style.backgroundColor = '#f8d7da';
      return;
    }
    
    const ffprobeCommand = `ffprobe -i "${videoUrl}" -show_streams`;
    
    navigator.clipboard.writeText(ffprobeCommand).then(() => {
      statusDiv.textContent = 'ffprobe command copied!';
      statusDiv.style.backgroundColor = '#d4edda';
      manualTip.style.display = 'block';
      setTimeout(() => {
        statusDiv.textContent = '';
        statusDiv.style.backgroundColor = 'transparent';
      }, 2000);
    });
  });
  
    // Copy command to clipboard
    copyToClipboard.addEventListener('click', function() {
      const command = ffmpegCommand.textContent;
      navigator.clipboard.writeText(command).then(() => {
        statusDiv.textContent = 'Command copied to clipboard!';
        statusDiv.style.backgroundColor = '#d4edda';
        setTimeout(() => {
          statusDiv.textContent = '';
          statusDiv.style.backgroundColor = 'transparent';
        }, 2000);
      });
    });
  
    // Process the manifest URL to extract the correct download URL
    function processManifestUrl(url) {
      const indexPos = url.indexOf('index&format=dash');
      if(indexPos !== -1) {
        return url.substring(0, indexPos + 'index&format=dash'.length);
      }
      return url;
    }

    // Sanitize filename to remove invalid characters
    function sanitizeFilename(filename) {
      if(!filename) return '';
      // Remove or replace invalid filename characters
      let sanitized = filename.replace(/[<>:"/\\|?*]/g, '_');
      // Ensure it ends with .mp4
      if(!sanitized.toLowerCase().endsWith('.mp4')) {
        sanitized += '.mp4';
      }
      return sanitized;
    }
  });









  const downloadTranscriptButton = document.getElementById('download-transcript');
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
