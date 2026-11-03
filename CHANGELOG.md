# Changelog

## v1.0.0 (2026-11-03)

First release.

### Downloading
- Download YouTube and SoundCloud links as audio, video, both, or just the thumbnail.
- Queue: paste several links at once (one per line or separated by spaces). They're looked up in parallel and downloaded one after another.
- SoundCloud sets and YouTube playlists download every track. A video link with `&list=...` downloads only that video.
- Progress bar for each item, with speed and time remaining, plus a summary at the end of what worked and what didn't.

### Formats and quality
- Audio formats: MP3, M4A (AAC), Opus, FLAC, WAV.
- MP3 bitrates: 320 kbps, V0 (~245 kbps, recommended), 192 kbps, 128 kbps.
- Video formats: MP4 (best quality), MP4 maximum compatibility (H.264), MKV, WebM.
- Video quality list with only the qualities each video actually has, up to 4K/8K.
- Estimated size shown for every format and quality option, plus a per-item and total estimate before downloading. Quality and format can be changed before confirming.
- SoundCloud video: choose whether the video file shows the cover art as its picture, or has sound only.
- SoundCloud audio: choose whether to keep the original details (title, artist, date, cover art) inside the file, or make a plain file.

### Files
- Saves to your Windows Downloads folder by default, or pick another folder with the Windows folder picker. The choice can be remembered.
- Each item gets its own folder. Files are named `Title (Uploader)`.
- Optional thumbnail `.jpg` and info `.txt` (uploader, upload date, length, views, file size, description, ...).
- Existing files are never overwritten. Duplicates are saved as `Name (2)` and so on. Unfinished downloads stay in a temp folder until they're done.

### Errors and updates
- Plain-language messages for private, deleted, members-only and region-locked videos, bad links, unsupported sites, DRM, no internet and a full disk.
- Age-restricted videos: explains why, and offers to use your browser's YouTube sign-in (Firefox, Chrome, Edge or Brave), or to skip.
- Checks for a newer yt-dlp at start and offers to update. If downloads fail because yt-dlp is out of date, it offers to update and retry them.
- Live streams and upcoming premieres are refused with a clear message.

### Setup
- `npm start` to run from the folder, or `npm link` once to run `vconverter` from anywhere.
- Saved choices live in `config.json` (not uploaded to GitHub).
