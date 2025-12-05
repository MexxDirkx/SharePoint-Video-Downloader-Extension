# SharePoint Video Downloader Extension

A browser extension to download videos from SharePoint and Microsoft Streams.

## Features

- Detect videos on SharePoint and Microsoft Streams pages
- Generate FFmpeg commands for downloading
- Copy video manifest URL directly
- Generate ffprobe command to analyze available streams
- Support for high-quality downloads with stream selection
- Download video transcripts as SRT files
- Configurable FFmpeg path and download folder

## Installation

### Prerequisites

1. **FFmpeg** - Required to download videos
   - **Windows**: Download from [ffmpeg.org](https://ffmpeg.org/download.html) or install via:
     ```
     winget install ffmpeg
     ```
   - **macOS**: Install via Homebrew:
     ```
     brew install ffmpeg
     ```
   - **Linux**: Install via package manager:
     ```
     sudo apt install ffmpeg
     ```

### Install the Extension

#### Chrome
1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top right corner)
4. Click **Load unpacked**
5. Select the folder containing this extension
6. The extension icon should appear in your toolbar

#### Microsoft Edge
1. Download or clone this repository
2. Open Edge and navigate to `edge://extensions/`
3. Enable **Developer mode** (toggle in the left sidebar)
4. Click **Load unpacked**
5. Select the folder containing this extension
6. The extension icon should appear in your toolbar

#### Firefox
1. Download or clone this repository
2. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on**
4. Select the `manifest.json` file from the extension folder
5. Note: Firefox requires reloading the extension after each browser restart

## Usage

1. Navigate to a SharePoint or Microsoft Streams page containing a video
2. **Start playing the video** (this is required to detect the video URL)
3. Click on the extension icon in your toolbar
4. Click **Detect Video**
5. Choose your download method:

### Download Methods

#### Quick Download (Default Quality)
- Click **Generate FFmpeg Command** to get a basic download command
- Note: This may download the lowest quality stream by default

#### Best Quality Download (Recommended)
- Click **Copy Best Quality Command** to get a command that automatically selects the highest quality video and audio streams

#### Manual Quality Selection
1. Click **Copy ffprobe Command** to analyze available streams
2. Run the ffprobe command in your terminal to see all available streams
3. Click **Copy Manifest URL** to get the raw video URL
4. Use FFmpeg with `-map` flags to select specific streams:
   ```
   ffmpeg -i "MANIFEST_URL" -map 0:v:0 -map 0:a:0 -c copy output.mp4
   ```
   Replace the stream indices based on ffprobe output

### Download Transcript
- If the video has a transcript/captions, click **Download Transcript** to save it as an SRT file

## Settings

Click **Settings** in the extension popup to configure:
- **Path to FFmpeg**: Full path to ffmpeg executable (e.g., `C:\ffmpeg\bin\ffmpeg.exe`)
- **Download folder**: Where to save downloaded videos (e.g., `C:\Downloads`)

## Troubleshooting

### "No video detected"
- Make sure you're on a SharePoint or Streams video page
- Start playing the video before clicking "Detect Video"
- Try refreshing the page and playing the video again

### Video downloads at low quality
- Use the **Copy Best Quality Command** button instead of the basic command
- Or use ffprobe to manually select the highest quality streams

### FFmpeg not found
- Make sure FFmpeg is installed and added to your system PATH
- Or specify the full path to FFmpeg in the extension settings

## Technical Notes

SharePoint video manifests contain multiple quality streams. By default, FFmpeg selects the first available stream which is often the lowest quality. This extension provides options to:
- Automatically select the best quality streams
- Analyze available streams with ffprobe
- Manually specify which streams to download

## License

MIT License

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.
