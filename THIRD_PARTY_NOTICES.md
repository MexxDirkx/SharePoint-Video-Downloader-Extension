# Third-party notices

## ms-teams-sharepoint-downloader

Parts of this extension are adapted from
[ms-teams-sharepoint-downloader](https://github.com/brendangooden/ms-teams-sharepoint-downloader)
by Brendan Gooden (version 1.7.1, commit 83664b2f):

- `intercept.js`: capturing the manifest URL with its X-SPOPacToken header, the API bearer,
  transcript metadata, `g_fileInfo` and the decryption key in `g_streamBootstrapContent`
- `media.js`: DASH-SEA key and IV handling, oneDrive.transcode segment enumeration, the
  transcript API calls and their response shapes
- `downloader.js`: the retry policy and the segment download pool

```
MIT License

Copyright (c) 2025 Brendan Gooden

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
