# SharePoint Video Downloader Extension

A browser extension that downloads videos and their transcripts from SharePoint, OneDrive and Teams recordings, including view-only videos that SharePoint streams in encrypted form. The download and decryption happen in your browser with your own sign-in; nothing is sent anywhere else.

## Features

- Downloads the original file when the owner allows downloading
- Otherwise downloads the stream the player uses, in the best quality, and decrypts it in the browser
- Saves transcripts as SRT or WebVTT subtitles (with speaker names in WebVTT)
- Works on SharePoint and OneDrive pages and on recordings embedded in Teams
- Shows its progress in a small panel on the page, so you can close the popup while it runs
- For unencrypted videos: ffmpeg, yt-dlp and ffprobe commands under *Advanced*, quoted correctly for PowerShell, Command Prompt or bash/zsh

## Requirements

- **Google Chrome, Microsoft Edge, Brave** or another Chromium-based browser, version 111 or newer
- **ffmpeg** (optional). Videos usually download as two files, video and audio. ffmpeg combines them into one MP4 in a second, without re-encoding. It's also needed for the command-line options under *Advanced*, together with **yt-dlp**.

### Installing ffmpeg and yt-dlp

**Windows** (winget is included in Windows 10 and 11):

```
winget install --id Gyan.FFmpeg -e
winget install --id yt-dlp.yt-dlp -e
```

Open a new terminal window afterwards so it finds the new programs. If you use Scoop or Chocolatey instead: `scoop install ffmpeg yt-dlp` or `choco install ffmpeg yt-dlp`. You can also download [ffmpeg](https://ffmpeg.org/download.html) and [yt-dlp](https://github.com/yt-dlp/yt-dlp/releases/latest) manually and enter their paths in the extension's Settings.

**macOS** ([Homebrew](https://brew.sh)):

```
brew install ffmpeg yt-dlp
```

**Linux**: install ffmpeg with your package manager, for example `sudo apt install ffmpeg` on Debian and Ubuntu. Distribution packages of yt-dlp are often out of date, so install it with `pipx install yt-dlp` or download the `yt-dlp` binary from its [releases page](https://github.com/yt-dlp/yt-dlp/releases/latest).

Check that they work with `ffmpeg -version` and `yt-dlp --version`.

## Installation

The extension is not in the Chrome Web Store or Edge Add-ons store, so you load it as an "unpacked" extension:

1. **Get the files.** Either [download the ZIP](https://github.com/MexxDirkx/SharePoint-Video-Downloader-Extension/archive/refs/heads/main.zip) and extract it, or clone the repository:
   ```
   git clone https://github.com/MexxDirkx/SharePoint-Video-Downloader-Extension.git
   ```
   Put the folder somewhere permanent. The browser loads the extension from it every time it starts, so don't delete it.
2. **Open the extensions page**: type `chrome://extensions` (Chrome), `edge://extensions` (Edge) or `brave://extensions` (Brave) in the address bar.
3. **Turn on Developer mode**: the switch is in the top right corner in Chrome and Brave, and in the left sidebar in Edge.
4. Click **Load unpacked** and select the folder that contains `manifest.json`. After extracting the ZIP this is the `SharePoint-Video-Downloader-Extension-main` folder.
5. **Pin the extension**: click the Extensions button (puzzle piece) in the toolbar and pin *SharePoint Video Downloader* so its icon is always visible.
6. **Reload any SharePoint or Teams tabs** that were already open. The extension only sees pages loaded after it was installed.

**Updating:** replace the files in the folder with the new version (or run `git pull`), click the reload button on the extension's card on the extensions page, and reload your SharePoint and Teams tabs.

### Firefox (untested)

The extension is made for Chromium-based browsers and has not been tested in Firefox. To try it: open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on** and select `manifest.json`. Firefox removes temporary add-ons when it restarts.

## Usage

1. Open the video on SharePoint, OneDrive or in Teams and **let it play for a few seconds**. The extension picks up the video stream and its decryption key from the player.
2. Click the extension icon. The popup says whether it found the video and fills in a file name; change it if you like.
3. Click **Download Video**. A panel appears in the bottom right corner of the page:
   - If the owner allows downloading, the original file downloads right away through your browser.
   - Otherwise the extension downloads the best quality video and audio, decrypting them if needed, and shows its progress. When it's done, click **Save** for each file. You can close the popup in the meantime, but keep the tab open.
4. The video and audio come as two files, `<name>.video.mp4` and `<name>.audio.m4a`. To combine them into one MP4, run the ffmpeg command shown in the panel and in the popup, in the folder where you saved the files:
   ```
   ffmpeg -i 'Name.video.mp4' -i 'Name.audio.m4a' -map 0:v -map 1:a -c copy 'Name.mp4'
   ```
   Both files also play on their own, for example in VLC.

For long videos, choose **Settings → Save downloaded videos → Write straight to a folder I choose**. The panel then asks for a folder and writes the files there while downloading, instead of keeping them in the browser until you click Save. This works when the video page is open on its own, not when it's embedded in Teams.

### Transcripts

Click **Transcript (SRT)** or **Transcript (VTT)**. The buttons are disabled when SharePoint says the video has no transcript. SRT works in most video players; WebVTT also keeps the speaker names.

### Advanced: command-line tools

Older SharePoint videos, which aren't encrypted, can also be downloaded with ffmpeg or yt-dlp. Open **Advanced: command-line tools** in the popup. The extension checks the video first and only shows the commands when they can work; otherwise it explains why not.

The commands include a temporary access token (the `X-SPOPacToken` header), so run them soon and don't share them. Choose your terminal under **Settings → Format commands for**, because PowerShell, Command Prompt and bash/zsh need different quoting.

- **Best Quality Command**: ffmpeg with the highest resolution video and highest bitrate audio. The note under the command shows what was picked.
- **Generate yt-dlp Command**: yt-dlp picks the best video and audio by itself and merges them.
- **Generate FFmpeg Command**: lets ffmpeg choose the streams, which can give the lowest bitrate audio.
- **Copy ffprobe Command** / **Copy Manifest URL**: to choose streams yourself. ffprobe lists them as `Stream #0:3: Video: h264 ..., 1920x1080`; pass the numbers to ffmpeg with `-map 0:3 -map 0:5`.

## Settings

- **Save downloaded videos**: keep them in the browser until you click Save (default), or write them straight to a folder you choose.
- **Path to FFmpeg / Path to yt-dlp**: leave these empty if the programs are on your PATH. Otherwise enter the full path, e.g. `C:\ffmpeg\bin\ffmpeg.exe`.
- **Download folder for command-line tools**: where the commands under *Advanced* save the video.
- **Format commands for**: PowerShell, Command Prompt or bash/zsh (macOS, Linux, WSL). *Auto-detect* chooses PowerShell on Windows and bash/zsh elsewhere.
- **yt-dlp: use cookies from browser**: adds yt-dlp's `--cookies-from-browser`. *None* by default, because the token in the command is what the media service checks.

## Troubleshooting

### Installing the extension

- **"Manifest file is missing or unreadable"**: you selected the wrong folder. Select the folder that directly contains `manifest.json`; after extracting a ZIP it is often one level deeper.
- **No Developer mode switch or Load unpacked button, or "blocked by your administrator"**: your organization's browser policy doesn't allow unpacked extensions. Only your IT department can change that.
- **The icon isn't in the toolbar**: pin it from the Extensions (puzzle piece) menu.

### Finding the video

- **"Open a video on SharePoint, OneDrive or Teams"** while you are on one: reload the page. Pages that were open before the extension was installed or updated don't have it yet.
- **"No video stream seen yet"**: start the video and let it play a few seconds, then open the popup again.
- **"Let it play a few more seconds so the extension can get its decryption key"**: the player hands out the key shortly after playback starts. Keep it playing a little longer.

### Downloading

- **"This video is protected with Widevine / PlayReady / FairPlay DRM"**: such videos can only be played in the browser. Nothing can download them.
- **HTTP 401 or 403 while downloading**: the player's access token expires after a while. Reload the page, play the video for a few seconds and try again.
- **"The server is busy, retrying..."**: SharePoint throttles fast downloads. The extension waits and tries again automatically, up to eight attempts per part.
- **The browser asks whether the site may download multiple files**: allow it. Each Save button is a separate download.
- **Save does nothing in Teams**: open the recording in SharePoint or OneDrive (*Open in browser*) and download it there.
- **The browser runs out of memory on a very long video**: use *Write straight to a folder I choose* in Settings.

### Command-line tools

- **`ffmpeg` / `yt-dlp` is not recognized, or "command not found"**: the program isn't installed or isn't on your PATH. Open a new terminal after installing, or enter the full path in Settings.
- **`Server returned 401 Unauthorized`**: the command has no access token or the token expired. Commands from older versions of this extension lack the token. Generate the command again.
- **ffmpeg says `Error when loading first fragment` or `Invalid data`, or yt-dlp says the video is `DRM protected`**: the video is encrypted, or its parts are only served to your signed-in browser. Use **Download Video** instead.
- **bash says `event not found`, or Command Prompt says `'inputFormat' is not recognized as an internal or external command`**: the command was formatted for a different terminal. Choose yours under **Format commands for** in Settings.

## How it works

In 2026 Microsoft changed how SharePoint delivers video, which broke command-line downloads:

1. **Tokens instead of signed URLs.** The video manifest (`videomanifest` on `*.svc.ms`) used to work with its URL alone. It now also needs an `X-SPOPacToken` header from the player; without it, the server answers *401 Unauthorized*.
2. **Encrypted segments served by SharePoint.** The manifest now points at segments on your SharePoint site, which only your signed-in browser can fetch. The segments are encrypted with AES-128 (DASH-SEA); the key comes from the media service with the same token.
3. **A new streaming format.** Many videos no longer use a manifest at all. The player fetches `oneDrive.transcode` segments from a background worker and gets the AES key from the page.

So the extension works inside the browser. A small script in the page records the manifest request with its token, the page's file information, and the decryption key. The extension's background worker sees the player's requests, including those from the worker. When you click **Download Video**, the extension tries the original file first. If that isn't allowed, it downloads the best quality video and audio segment by segment from the page itself, four at a time, retrying when SharePoint throttles, and decrypts them with the player's key. It doesn't decrypt or work around real DRM (Widevine, PlayReady, FairPlay).

Transcripts come from SharePoint's API for the video file (`/_api/v2.1/drives/.../items/...`), which returns a temporary link to the transcript as JSON.

## Credits

The handling of the 2026 SharePoint changes builds on research and code from [ms-teams-sharepoint-downloader](https://github.com/brendangooden/ms-teams-sharepoint-downloader) by Brendan Gooden (MIT License). Thank you! See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

MIT License

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.
