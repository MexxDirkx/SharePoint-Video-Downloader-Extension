// content.js
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if(request.action === "detectVideo") {
      // Find video manifest URL from network requests
      let foundUrl = null;
      
      // Check if we can access the network requests
      if(window.performance && window.performance.getEntries) {
        const entries = window.performance.getEntries();
        for(let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          if(entry.name && typeof entry.name === 'string' && 
             entry.name.includes('videomanifest?provider')) {
            foundUrl = entry.name;
            break;
          }
        }
      }
      
      // If we didn't find it, try an alternative approach
      if(!foundUrl) {
        // Look for video elements
        const videoElements = document.querySelectorAll('video');
        for(let i = 0; i < videoElements.length; i++) {
          const video = videoElements[i];
          if(video.src && video.src.includes('videomanifest')) {
            foundUrl = video.src;
            break;
          }
        }
        
        // Try to get manifest URL from any source available
        if(!foundUrl) {
          // Insert a script to watch XHR requests
          const script = document.createElement('script');
          script.textContent = `
            (function() {
              // Listen for video manifest URL
              window.addEventListener('message', function(event) {
                if(event.data && event.data.type === 'VIDEO_MANIFEST_URL') {
                  window.postMessage({type: 'VIDEO_MANIFEST_FOUND', url: event.data.url}, '*');
                }
              });
              
              // Watch for XHR requests
              const originalOpen = XMLHttpRequest.prototype.open;
              XMLHttpRequest.prototype.open = function(method, url) {
                if(url && url.includes('videomanifest?provider')) {
                  window.postMessage({type: 'VIDEO_MANIFEST_FOUND', url: url}, '*');
                }
                return originalOpen.apply(this, arguments);
              };
            })();
          `;
          
          document.head.appendChild(script);
          
          // Listen for messages from the injected script
          window.addEventListener('message', function(event) {
            if(event.data && event.data.type === 'VIDEO_MANIFEST_FOUND') {
              foundUrl = event.data.url;
              sendResponse({videoManifestUrl: foundUrl});
            }
          });
          
          // If we still don't have a URL, prompt the user to play the video
          if(!foundUrl) {
            alert('Please start playing the video to detect the URL. Then click "Detect Video" again.');
          }
        }
      }
      
      if(foundUrl) {
        sendResponse({videoManifestUrl: foundUrl});
      }
      
      // Return true to indicate we'll send a response asynchronously
      return true;
    }
  });



  chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.action === "detectTranscript") {
        let transcriptUrl = null;

        if (window.performance && window.performance.getEntries) {
            const entries = window.performance.getEntries();
            for (let i = 0; i < entries.length; i++) {
                const entry = entries[i];
                if (entry.name.includes('/streamContent?format=json')) {
                    transcriptUrl = entry.name;
                    break;
                }
            }
        }

        if (transcriptUrl) {
            fetch(transcriptUrl)
                .then(response => response.json())
                .then(data => sendResponse({ transcript: data }))
                .catch(() => sendResponse({ transcript: null }));
            return true;
        }

        sendResponse({ transcript: null });
    }
});


// Fetch the DASH manifest for the popup, which reads it to find the best quality streams.
// Fetching from the page makes the request under the page's origin, as the player does.
// No cookies are sent, so the request matches what ffmpeg does with the same URL.
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.action === "fetchManifest") {
        fetch(request.url, { credentials: 'omit' })
            .then(response => {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.text();
            })
            .then(text => sendResponse({ manifest: text }))
            .catch(error => sendResponse({ error: error.message }));
        return true;
    }
});
