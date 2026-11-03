// Everything that runs yt-dlp: looking up info, size estimates, downloading with a progress bar,
// moving finished files into place without overwriting, and the info .txt.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { friendlyError } = require('./errors');
const { Progress } = require('./progress');
const F = require('./formats');
const { formatBytes, formatDate, formatDuration, heightLabel, isSoundCloud } = require('./util');

// One folder per item, named after the video/track (or the set, for sets).
// Files are named "Title (Uploader).ext", e.g. "rica - wait4u (OG) (soyrica).mp3".
// Lengths are capped so the full path stays under Windows' 260-character limit.
const OUTPUT_TEMPLATE = path.join('%(playlist_title,title).80B', '%(title).120B (%(uploader,channel|Unknown).40B).%(ext)s');
const LOOKUPS_AT_ONCE = 4;

const cookieArgs = (browser) => (browser ? ['--cookies-from-browser', browser] : []);

// Runs yt-dlp and collects its output. Resolves with { code, stdout, stderr }.
function run(args, onStdoutLine) {
  return new Promise((resolve) => {
    const child = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let partial = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (!onStdoutLine) return (stdout += chunk);
      const lines = (partial + chunk).split(/\r?\n/);
      partial = lines.pop();
      lines.forEach(onStdoutLine);
    });
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: `ERROR: Could not start yt-dlp: ${err.message}` }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function isLive(info) {
  return info.is_live || info.live_status === 'is_live' || info.live_status === 'is_upcoming';
}

// Looks up a link once and saves the info to a temp file, so size estimates and the download
// reuse it instead of asking the site again. Resolves with an item, or { error }.
async function fetchInfo(url, cookies) {
  const r = await run(['-J', '--no-playlist', '--flat-playlist', '--no-warnings', ...cookieArgs(cookies), url]);
  if (r.code !== 0) return { error: friendlyError(r.stderr) };
  let info;
  try {
    info = JSON.parse(r.stdout);
  } catch {
    return { error: { kind: 'other', message: 'yt-dlp returned info that could not be read.' } };
  }
  if (isLive(info)) {
    return { error: { kind: 'live', message: 'This is a live stream or upcoming premiere. Try again after it ends.' } };
  }
  const file = path.join(os.tmpdir(), `vconverter-info-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, r.stdout);
  return { url, info, file, cookies, isPlaylist: info._type === 'playlist' };
}

// Looks up several links in parallel (a few at a time). Results are in the same order as `urls`.
async function fetchAll(urls, cookies, onEach) {
  const results = new Array(urls.length);
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      results[i] = await fetchInfo(urls[i], cookies);
      onEach?.();
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOOKUPS_AT_ONCE, urls.length) }, worker));
  return results;
}

function removeItemFiles(item) {
  fs.rmSync(item.file, { force: true });
}

// Works out the video size at every available height of a format, with one yt-dlp call per item
// that picks the same formats it would download. Items are done in parallel and cached.
async function loadVideoSizes(items, vf) {
  await Promise.all(items.map(async (item) => {
    item.videoSizes ??= {};
    if (item.videoSizes[vf.id] || item.isPlaylist) return;
    const heights = F.videoHeights(item.info, vf);
    const keys = heights.length ? heights : [null];
    const r = await run(['--load-info-json', item.file, '-f', keys.map((h) => `(${F.videoSelector(vf, h)})`).join(','),
      '--no-warnings', '--print', '%(filesize,filesize_approx)s']);
    const lines = r.stdout.trim().split(/\r?\n/);
    const sizes = new Map(keys.map((h, i) => [h, parseInt(lines[i], 10) || 0]));
    if (heights.length) sizes.set(null, sizes.get(heights[0]));
    item.videoSizes[vf.id] = sizes;
  }));
}

// Size from loadVideoSizes (0 if unknown). A height the video doesn't have uses the next lower one,
// like yt-dlp does.
function videoSize(item, vf, maxHeight) {
  const sizes = item.videoSizes?.[vf.id];
  if (!sizes) return 0;
  if (sizes.has(maxHeight)) return sizes.get(maxHeight);
  const lower = F.videoHeights(item.info, vf).find((h) => h <= maxHeight);
  return sizes.get(lower ?? null) || 0;
}

function kindsFor(mode) {
  return mode === 'both' ? ['audio', 'video'] : [mode];
}

function kindLabel(kind, opts) {
  if (kind === 'audio') return F.findAudio(opts.audioFormat).label;
  if (kind === 'video') return F.findVideo(opts.videoFormat).container.toUpperCase();
  return 'Thumbnail';
}

// Estimated size of each file an item will produce, e.g. { audio: 9.6e6, video: 129e6 }. 0 = unknown.
// Call loadVideoSizes first when video is wanted.
function estimateItem(item, opts) {
  const sizes = {};
  for (const kind of kindsFor(opts.mode)) {
    if (item.isPlaylist) sizes[kind] = 0;
    else if (kind === 'audio') sizes.audio = F.audioSize(item.info, F.findAudio(opts.audioFormat), opts.audioQuality);
    else if (kind === 'video') sizes.video = videoSize(item, F.findVideo(opts.videoFormat), opts.maxHeight);
    else sizes.thumbnail = 150e3;
  }
  return sizes;
}

function buildArgs(item, kind, opts, tempDir, saveThumb) {
  const args = ['--no-playlist', '-o', path.join(tempDir.replace(/%/g, '%%'), OUTPUT_TEMPLATE), ...cookieArgs(item.cookies)];
  if (kind === 'thumbnail') return [...args, '--skip-download', '--write-thumbnail', '--convert-thumbnails', 'jpg'];
  if (saveThumb) args.push('--write-thumbnail', '--convert-thumbnails', 'jpg');
  if (kind === 'audio') {
    const af = F.findAudio(opts.audioFormat);
    const tags = !opts.keepDetails
      ? ['--postprocessor-args', 'ExtractAudio:-map_metadata -1'] // plain file with no tags or cover art
      : ['--embed-metadata', ...(af.noCoverArt ? [] : ['--embed-thumbnail'])];
    return [...args, '-f', af.select || 'ba/b', '-x', '--audio-format', af.id,
      ...(af.id === 'mp3' ? ['--audio-quality', opts.audioQuality] : []), ...tags];
  }
  const vf = F.findVideo(opts.videoFormat);
  // --remux-video makes audio-only sources (SoundCloud's .m4a) end up in the chosen container too.
  return [...args, '-f', F.videoSelector(vf, opts.maxHeight), '--merge-output-format', vf.container,
    '--remux-video', vf.container, '--embed-metadata'];
}

const PROGRESS_ARGS = ['-q', '--progress', '--newline', '--no-warnings',
  '--progress-template', 'download:VCPROG %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s %(info.vcodec)s',
  '--progress-template', 'postprocess:VCPP %(progress.status)s %(progress.postprocessor)s'];

// Runs one download with a progress bar. Resolves with null on success, or a friendly error.
async function runWithProgress(args, label, isVideo) {
  const progress = new Progress(label);
  const num = (v) => (v && v !== 'NA' ? parseFloat(v) : 0);
  const r = await run([...PROGRESS_ARGS, ...args], (line) => {
    const p = line.split(' ');
    if (p[0] === 'VCPROG') {
      const part = isVideo ? (p[6] && p[6] !== 'none' && p[6] !== 'NA' ? 'video' : 'audio') : '';
      progress.update({ downloaded: num(p[1]), total: num(p[2]) || num(p[3]), speed: num(p[4]), eta: num(p[5]), part });
    } else if (p[0] === 'VCPP' && p[1] === 'started') {
      progress.stage(p[2]);
    }
  });
  progress.finish();
  return r.code === 0 ? null : friendlyError(r.stderr);
}

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(full, base) : [{ src: full, rel: path.relative(base, full) }];
  });
}

function moveFile(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.copyFileSync(src, dest); // temp folder is on another drive
    fs.unlinkSync(src);
  }
}

// Moves finished files into the download folder. Files that share a name ("Song.mp3" + "Song.jpg")
// stay together, and if any of their names is taken they all become "Song (2)" etc., so nothing
// is ever overwritten. Returns { files, renamed, bases } (bases = full paths without extension).
function moveIntoPlace(found, destRoot, extraEndings) {
  const groups = new Map();
  for (const f of found) {
    const ext = path.extname(f.rel);
    const key = f.rel.slice(0, -ext.length || undefined);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...f, ext });
  }
  const files = [];
  const bases = [];
  let renamed = false;
  for (const [key, group] of groups) {
    const folder = path.join(destRoot, path.dirname(key));
    const stem = path.basename(key);
    fs.mkdirSync(folder, { recursive: true });
    const endings = [...group.map((f) => f.ext), ...extraEndings];
    let n = 1;
    const nameFor = (k) => (k === 1 ? stem : `${stem} (${k})`);
    while (endings.some((e) => fs.existsSync(path.join(folder, nameFor(n) + e)))) n++;
    renamed ||= n > 1;
    bases.push(path.join(folder, nameFor(n)));
    for (const f of group) {
      const dest = path.join(folder, nameFor(n) + f.ext);
      moveFile(f.src, dest);
      files.push(dest);
    }
  }
  return { files, renamed, bases };
}

// SoundCloud has no video, so this turns a sound-only video file into one whose picture is the
// cover art: a single still frame per second, which is tiny and quick to encode. Returns true on success.
function addCoverPicture(videoPath, imagePath) {
  const out = videoPath.replace(/(\.[^.\\/]+)$/, '.cover$1');
  return new Promise((resolve) => {
    const child = spawn('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-framerate', '1', '-i', imagePath, '-i', videoPath,
      '-map', '0:v', '-map', '1:a', '-map_metadata', '1', '-c:v', 'libx264', '-tune', 'stillimage', '-pix_fmt', 'yuv420p',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:a', 'copy', '-shortest',
    ...(out.endsWith('.mp4') ? ['-movflags', '+faststart'] : []), out],
    { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', (code) => {
      if (code === 0) fs.renameSync(out, videoPath);
      else fs.rmSync(out, { force: true });
      resolve(code === 0);
    });
  });
}

// Adds the cover art picture to every video file from a SoundCloud run (one per track for sets).
async function addCoverPictures(tempDir, container, keepThumb) {
  const files = listFiles(tempDir);
  for (const video of files.filter((f) => f.rel.endsWith(`.${container}`))) {
    const image = video.src.slice(0, -container.length) + 'jpg';
    if (!fs.existsSync(image)) continue;
    console.log('  Adding the cover art as the video picture...');
    if (!(await addCoverPicture(video.src, image))) console.log('  Couldn\'t add the cover art, so this video file has sound only.');
    if (!keepThumb) fs.rmSync(image, { force: true });
  }
}

// Downloads one queue item in every requested kind. Resolves with { ok, files, error, renamed }.
async function downloadItem(item, opts, cfg) {
  const kinds = opts.mode === 'thumbnail' ? ['thumbnail'] : kindsFor(opts.mode);
  // Each kind downloads into its own empty temp folder, so yt-dlp never sees (or touches) files
  // in the download folder, and the audio and video runs can't mix up each other's files.
  const tempDirs = [];
  try {
    for (const [i, kind] of kinds.entries()) {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vconverter-'));
      tempDirs.push(tempDir);
      // The thumbnail is saved by the last run, so an audio file's cover-art step can't remove it.
      const keepThumb = opts.saveThumb && i === kinds.length - 1;
      const coverPicture = kind === 'video' && opts.coverPicture && isSoundCloud(item.url) && opts.videoFormat !== 'webm';
      const args = buildArgs(item, kind, opts, tempDir, keepThumb || coverPicture);
      const label = kindLabel(kind, opts);
      let error = await runWithProgress([...args, ...(item.isPlaylist ? [item.url] : ['--load-info-json', item.file])], label, kind === 'video');
      if (error && !item.isPlaylist && ['outdated', 'other'].includes(error.kind)) {
        // The saved download links expire after a few hours, so retry once with a fresh lookup.
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.mkdirSync(tempDir);
        error = await runWithProgress([...args, item.url], label, kind === 'video');
      }
      if (error) return { ok: false, files: [], error };
      if (coverPicture) await addCoverPictures(tempDir, F.findVideo(opts.videoFormat).container, keepThumb);
    }
    const found = tempDirs.flatMap((d) => listFiles(d)).filter((f) => !/\.(part|ytdl|temp)$/i.test(f.rel));
    if (!found.length) return { ok: false, files: [], error: { kind: 'other', message: 'yt-dlp finished but produced no file.' } };
    const extra = opts.saveInfo && !item.isPlaylist ? [' - info.txt'] : [];
    const { files, renamed, bases } = moveIntoPlace(found, cfg.downloadDir, extra);
    if (extra.length) files.push(writeInfoTxt(item.info, files, opts, bases[0]));
    return { ok: true, files, renamed };
  } finally {
    for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true });
  }
}

function describeChoice(kind, opts) {
  if (kind === 'audio') {
    const af = F.findAudio(opts.audioFormat);
    return `Audio (${af.label}${af.id === 'mp3' ? `, ${F.mp3Label(opts.audioQuality)}` : ''})`;
  }
  if (kind === 'video') {
    const vf = F.findVideo(opts.videoFormat);
    return `Video (${vf.label}, ${opts.maxHeight ? `up to ${heightLabel(opts.maxHeight)}` : 'best quality'})`;
  }
  return 'Thumbnail';
}

// Writes "<name> - info.txt" next to the downloaded file(s).
function writeInfoTxt(info, files, opts, base) {
  const kinds = opts.mode === 'thumbnail' ? ['thumbnail'] : kindsFor(opts.mode);
  const lines = [
    ['Title', info.title],
    ['Uploader', info.uploader || info.channel],
    ['Artist', info.artist],
    ['Uploader page', info.uploader_url || info.channel_url],
    ['Upload date', formatDate(info.upload_date)],
    ['Length', formatDuration(info.duration)],
    ['Views', info.view_count?.toLocaleString('en-US')],
    ['Likes', info.like_count?.toLocaleString('en-US')],
    ['Genre', info.genre],
    ['Downloaded as', kinds.map((k) => describeChoice(k, opts)).join(' + ')],
    ...files.map((f) => ['File', `${path.basename(f)} (${formatBytes(fs.statSync(f).size)})`]),
    ['Downloaded on', new Date().toLocaleString()],
    ['Source', info.webpage_url],
  ].filter(([, v]) => v !== undefined && v !== null && v !== '');
  const width = Math.max(...lines.map(([k]) => k.length)) + 2;
  let text = lines.map(([k, v]) => `${(k + ':').padEnd(width)}${v}`).join('\n') + '\n';
  if (info.description) text += `\nDescription:\n${info.description.trim()}\n`;
  const txtPath = `${base} - info.txt`;
  fs.writeFileSync(txtPath, text);
  return txtPath;
}

module.exports = {
  fetchInfo, fetchAll, removeItemFiles, loadVideoSizes, videoSize, estimateItem, kindLabel, downloadItem,
};
