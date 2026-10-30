# SharePoint Video Downloader Extension

A browser extension that finds the video stream on a SharePoint or Microsoft Stream page and gives you a ready-to-run **ffmpeg** or **yt-dlp** command to download it. It can also save the video's transcript as an SRT file.

The extension does not download the video itself: you copy the command it generates and run it in a terminal.

## Features

- Detects the video on SharePoint and Microsoft Stream pages
- **Best Quality** ffmpeg command: reads the video's list of streams and picks the highest resolution video and the best audio
- **yt-dlp** command, which picks the best streams by itself
- Copy the manifest URL or an ffprobe command to choose streams yourself
- Commands are quoted correctly for PowerShell, Command Prompt or bash/zsh
- Download video transcripts as SRT files
- Configurable ffmpeg and yt-dlp paths and download folder

## Requirements

- **Google Chrome, Microsoft Edge, Brave** or another Chromium-based browser
- **ffmpeg** for the ffmpeg and ffprobe commands, and/or **yt-dlp** for the yt-dlp command. yt-dlp needs ffmpeg as well to merge video and audio, so installing both is simplest.

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

**Updating:** replace the files in the folder with the new version (or run `git pull`), then click the reload button on the extension's card on the extensions page.

### Firefox (untested)

The extension is made for Chromium-based browsers and has not been tested in Firefox. To try it: open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on** and select `manifest.json`. Firefox removes temporary add-ons when it restarts.

## Usage

1. Open the SharePoint or Stream page with the video and **start playing the video**. The extension finds the video stream among the page's network requests, which only exist once the video plays.
2. Click the extension icon, then **Detect Video**. The filename is filled in from the page title; change it if you like.
3. Choose a command:

   | Button | What you get |
   | --- | --- |
   | **Best Quality Command** | An ffmpeg command for the highest resolution video and the highest bitrate audio. The note below the command shows what was picked. |
   | **Generate yt-dlp Command** | A yt-dlp command. yt-dlp picks the best video and audio by itself and merges them into an MP4. |
   | **Generate FFmpeg Command** | An ffmpeg command that lets ffmpeg choose: the highest resolution video, but not necessarily the best audio. |
   | **Copy ffprobe Command**, **Copy Manifest URL** | For choosing the streams yourself, see below. |

4. Click **Copy to Clipboard**, paste the command into a terminal and press Enter.

Run the command soon after detecting the video: the URL contains a temporary access token that expires. For the same reason, **don't share the command or the URL** with others, because the token gives access to the video.

### Choosing streams yourself

1. Click **Copy ffprobe Command** and run it. Among its output is a list of streams such as `Stream #0:3: Video: h264 ..., 1920x1080` and `Stream #0:5: Audio: aac ...`.
2. Click **Copy Manifest URL** and run ffmpeg with the stream numbers you want after `-map`:
   ```
   ffmpeg -i 'MANIFEST_URL' -map 0:3 -map 0:5 -c copy output.mp4
   ```
   Use single quotes around the URL in PowerShell, bash and zsh, and double quotes in Command Prompt.

### Transcripts

If the video has a transcript, click **Download Transcript** to save it as an SRT subtitle file.

## Settings

Click **Settings** in the popup:

- **Path to FFmpeg / Path to yt-dlp**: leave these empty if the programs are on your PATH (which is the case after installing them as described above). Otherwise enter the full path, e.g. `C:\ffmpeg\bin\ffmpeg.exe`. ffprobe is expected in the same folder as ffmpeg.
- **Download folder**: where the video is saved. If empty, it's saved in the terminal's current folder.
- **Format commands for**: the terminal you run the commands in: PowerShell, Command Prompt, or bash/zsh (macOS, Linux and WSL). Each quotes text differently, so a command made for one may fail in another. *Auto-detect* chooses PowerShell on Windows and bash/zsh elsewhere.
- **yt-dlp: use cookies from browser**: the browser yt-dlp reads your sign-in cookies from (its `--cookies-from-browser` option). *Auto-detect* uses the browser the extension runs in; *None* leaves the option out.

## Troubleshooting

### Installing the extension

- **"Manifest file is missing or unreadable"**: you selected the wrong folder. Select the folder that directly contains `manifest.json`; after extracting a ZIP it is often one level deeper.
- **No Developer mode switch or Load unpacked button, or "blocked by your administrator"**: your organization's browser policy doesn't allow unpacked extensions. Only your IT department can change that.
- **The icon isn't in the toolbar**: pin it from the Extensions (puzzle piece) menu.

### Detecting the video

- **"No video detected"**: make sure you're on the page with the video and that it is playing, then click **Detect Video** again. If it still fails, reload the page, play the video and try again.

### Running the command

- **`ffmpeg` / `yt-dlp` is not recognized, or "command not found"**: the program isn't installed or isn't on your PATH. Open a new terminal after installing, or enter the full path in Settings.
- **bash says `event not found`, or Command Prompt says `'inputFormat' is not recognized as an internal or external command`**: the command was formatted for a different terminal. Choose your terminal under **Format commands for** in Settings and generate the command again.
- **yt-dlp can't read the browser's cookies** (e.g. `Could not copy Chrome cookie database` or `Failed to decrypt with DPAPI`): on Windows, yt-dlp often can't read the cookies of Chrome or Edge while the browser is running. Close the browser and run the command again, or set the cookies setting to *None*: the URL already contains an access token, so cookies may not be needed.
- **The video is in low quality**: use **Best Quality Command** or the yt-dlp command. The note below the Best Quality command shows the resolution it picked; if it says the list of streams could not be read, use the yt-dlp command or choose the streams yourself.

## How it works

The video player on SharePoint plays a DASH stream described by a *manifest*. The extension finds the manifest's `videomanifest` URL among the page's network requests and removes the player-only parameters from the end. ffmpeg and yt-dlp can download the video from that URL.

The manifest lists every quality level of the video and the audio, lowest quality first. ffmpeg turns each one into a separate stream: first all video streams, then all audio streams, in manifest order. Without `-map` options, ffmpeg picks the video stream with the highest resolution, but the first audio stream, which is the lowest bitrate. Mapping `0:v:0` and `0:a:0` would pick the lowest quality of both.

For the Best Quality command, the extension therefore fetches the manifest from the page, finds the highest resolution video and the highest bitrate audio, and selects them with `-map 0:v:N -map 0:a:M`. If the manifest can't be read, the command leaves out `-map` and the note under the command says so.

yt-dlp reads the manifest itself; `-f "bv*+ba/b"` tells it to take the best video and the best audio and merge them.

## License

MIT License

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.
