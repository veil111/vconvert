# vconverter

A local terminal app that downloads YouTube and SoundCloud audio and video. It uses yt-dlp to download and FFmpeg to convert. 

## Setup (first time only)

### 1. Install Node.js
vconverter is built with Node.js, so you need it to run the app. [nodejs.org](https://nodejs.org) The default options are fine.

### 2. Install Scoop (through powershell or terminal)
Scoop is a free tool that installs the other two programs vconverter needs.
```
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```
```
Invoke-RestMethod -Uri https://get.scoop.sh | Invoke-Expression
```
### 3. Install yt-dlp and FFmpeg
yt-dlp downloads the videos, and FFmpeg converts them to MP3, MP4 and other formats.
```
scoop install ffmpeg yt-dlp
```

### 4. Running the program
1. Download and extract the zip.
2. Open the vconverter folder. You should see files like `index.js` and `package.json`.
3. Click the **address bar** at the top of the File Explorer window (where the folder path is shown), type `powershell`, and press **Enter**. 
4. Type this and press Enter:

   ```
   npm link
   ```

   To undo:

   ```
   npm unlink -g vconverter
   ```

   If you move or rename the folder, run `npm link` again from the new location.

5. vconverter will now run from anywhere with the command

```
vconverter
```

## Settings
Your saved choices live in `config.json` in this folder. Delete it to reset everything.
