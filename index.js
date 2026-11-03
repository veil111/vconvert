#!/usr/bin/env node
// vconverter: local terminal app that downloads audio/video with yt-dlp + FFmpeg.
// Personal use only. No dependencies beyond Node.js, yt-dlp and ffmpeg on PATH.

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig, saveConfigValue } = require('./lib/config');
const F = require('./lib/formats');
const Y = require('./lib/ytdlp');
const { checkForUpdate, runUpdate } = require('./lib/update');
const { pickFolder } = require('./lib/picker');
const { Prompter } = require('./lib/prompts');
const { isUrl, isSoundCloud, heightLabel, formatBytes, formatDuration, truncate } = require('./lib/util');

const BROWSERS = [
  { id: 'firefox', label: 'Firefox', note: 'most reliable' },
  { id: 'chrome', label: 'Chrome', note: 'close Chrome completely first' },
  { id: 'edge', label: 'Edge', note: 'close Edge completely first' },
  { id: 'brave', label: 'Brave', note: 'close Brave completely first' },
];
const COMMON_HEIGHTS = [2160, 1440, 1080, 720, 480, 360];

function hasTool(cmd, arg) {
  const r = spawnSync(cmd, [arg], { stdio: 'ignore' });
  return !r.error && r.status === 0;
}

function checkTools() {
  const missing = [];
  if (!hasTool('yt-dlp', '--version')) missing.push('yt-dlp');
  if (!hasTool('ffmpeg', '-version')) missing.push('ffmpeg');
  if (missing.length) {
    console.error(`Missing: ${missing.join(', ')}`);
    console.error(`Install with: scoop install ${missing.join(' ')}`);
    process.exit(1);
  }
}

function itemTitle(item) {
  const { info } = item;
  if (item.isPlaylist) return `${info.title} (set/playlist, ${(info.entries || []).length} items)`;
  return `${info.title} (${info.uploader || info.channel || 'unknown'})`;
}

function clearLine() {
  if (process.stdout.isTTY) process.stdout.write('\r\x1b[K');
  else process.stdout.write('\n');
}

const wants = (opts) => ({ audio: ['audio', 'both'].includes(opts.mode), video: ['video', 'both'].includes(opts.mode) });
const sum = (list) => list.reduce((a, b) => a + b, 0);

// "about 19.8 MB (MP3 9.6 MB + MP4 10.2 MB)". Sizes of 0 are unknown.
function describeSizes(sizes, opts) {
  const parts = Object.entries(sizes);
  if (!parts.length || parts.some(([, n]) => !n)) return 'unknown';
  const total = sum(parts.map(([, n]) => n));
  if (parts.length === 1) return `about ${formatBytes(total)}`;
  return `about ${formatBytes(total)} (${parts.map(([k, n]) => `${Y.kindLabel(k, opts)} ${formatBytes(n)}`).join(' + ')})`;
}

function printEstimate(items, opts) {
  const perItem = items.map((item) => Y.estimateItem(item, opts));
  if (items.length === 1) {
    console.log(`\nEstimated size: ${describeSizes(perItem[0], opts)}`);
    return;
  }
  console.log('\nEstimated sizes:');
  items.forEach((item, i) => console.log(`  ${i + 1}. ${truncate(itemTitle(item), 60)}: ${describeSizes(perItem[i], opts)}`));
  const known = perItem.flatMap((s) => Object.values(s));
  const total = sum(known);
  const unknown = known.some((n) => !n);
  console.log(`  Total: ${total ? `about ${formatBytes(total)}${unknown ? ' + unknown' : ''}` : 'unknown'}`);
}

// ---------- Questions ----------

async function offerUpdate(p, reason) {
  if (reason) console.log(reason);
  else {
    process.stdout.write('Checking for yt-dlp updates...');
    const update = await checkForUpdate();
    clearLine();
    if (!update) return false;
    console.log(`A newer yt-dlp is available (${update.installed} -> ${update.latest}).`);
    console.log('YouTube and SoundCloud change often, and an old yt-dlp is the most common reason downloads fail.');
  }
  const yes = await p.yesNo('Update yt-dlp now?', true);
  return yes ? runUpdate() : false;
}

function useFolder(dir) {
  const resolved = path.resolve(dir.replace(/^["']|["']$/g, '').replace(/^~(?=$|[\\/])/, os.homedir()));
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

// Asks where to save, defaulting to the configured folder. Returns the folder, or null to quit.
async function askDownloadDir(p, cfg) {
  for (;;) {
    console.log(`Downloads will be saved to: ${cfg.downloadDir}`);
    const answer = await p.ask('[Enter] Use this folder  [c] Choose a different folder: ');
    if (answer === null) return null;
    if (!answer) return cfg.downloadDir;
    let chosen = answer;
    if (answer.toLowerCase() === 'c') {
      console.log('Opening the folder window... (if you don\'t see it, check the taskbar)');
      chosen = pickFolder(cfg.downloadDir);
      if (chosen === null) {
        console.log('No folder chosen.\n');
        continue;
      }
      if (chosen === undefined) {
        console.log('Couldn\'t open the folder window, so paste the folder path instead.');
        chosen = await p.ask('Folder path: ');
        if (chosen === null) return null;
        if (!chosen) continue;
      }
    }
    let dir;
    try {
      dir = useFolder(chosen);
    } catch (err) {
      console.log(`Can't use that folder (${err.message}).\n`);
      continue;
    }
    console.log(`Saving to: ${dir}`);
    const remember = await p.yesNo('Remember this folder for next time?', false);
    if (remember === null) return null;
    if (remember) saveConfigValue('downloadDir', dir);
    return dir;
  }
}

// Collects links until the user presses Enter on an empty line. Returns the URLs, or null to quit.
async function askQueue(p) {
  const urls = [];
  console.log('Paste one or more links. You can paste several at once (one per line, or separated by spaces).');
  for (;;) {
    const prompt = urls.length
      ? `Add more links, or press Enter to start (${urls.length} in queue): `
      : 'Link(s) (q = quit): ';
    const lines = await p.askLines(prompt);
    if (lines === null) return urls.length ? urls : null;
    const tokens = lines.join(' ').split(/\s+/).filter(Boolean);
    if (!tokens.length) {
      if (urls.length) return urls;
      continue;
    }
    if (!urls.length && tokens.length === 1 && tokens[0].toLowerCase() === 'q') return null;
    for (const t of tokens) {
      if (!isUrl(t)) console.log(`  Not a link, skipped: ${t}`);
      else if (urls.includes(t)) console.log(`  Already in the queue: ${t}`);
      else urls.push(t);
    }
  }
}

// Offers to use a browser's sign-in for age-restricted videos. Returns a browser id, null to skip,
// or undefined if input ended.
async function askCookies(p, session) {
  console.log('  vconverter can use your browser\'s YouTube sign-in (its cookies) to get it.');
  console.log('  You need to be signed in to YouTube in that browser. The cookies stay on this computer');
  console.log('  and are only sent to YouTube.');
  const choice = await p.choose('Use the sign-in from which browser?',
    [...BROWSERS, { id: null, label: 'No thanks, skip this video' }], 0);
  if (choice === undefined) return undefined;
  if (!choice.id) return null;
  session.cookies = choice.id;
  const remember = await p.yesNo(`Remember ${choice.label} for age-restricted videos next time?`, false);
  if (remember === null) return undefined;
  if (remember) saveConfigValue('cookiesFromBrowser', choice.id);
  return choice.id;
}

// Looks up every link. Returns { items, failed }, or undefined if input ended.
async function lookUp(urls, session, p) {
  const items = [];
  const failed = [];
  let checked = 0;
  const showChecked = () => process.stdout.write(`\rChecking ${urls.length} link(s)... ${checked}/${urls.length}`);
  console.log('');
  showChecked();
  // Look everything up in parallel without cookies first; cookies are only used where needed.
  const results = await Y.fetchAll(urls, null, () => {
    checked++;
    if (process.stdout.isTTY) showChecked();
  });
  clearLine();
  for (const [i, url] of urls.entries()) {
    const tag = `[${i + 1}/${urls.length}]`;
    let item = results[i];
    if (item.error && ['age', 'bot'].includes(item.error.kind)) {
      console.log(`${tag} ${item.error.message}`);
      const browser = session.cookies || (await askCookies(p, session));
      if (browser === undefined) return undefined;
      if (browser) {
        console.log(`${tag} Trying again with your ${BROWSERS.find((b) => b.id === browser)?.label || browser} sign-in...`);
        item = await Y.fetchInfo(url, browser);
        if (item.error?.kind === 'cookies') session.cookies = null; // ask again next time
        if (item.error && ['age', 'bot'].includes(item.error.kind)) {
          item.error.message = 'Still blocked with your browser\'s sign-in. Make sure you\'re signed in to YouTube there (and for Chrome/Edge, that the browser is fully closed).';
        }
      } else {
        item.error.message += ' Skipped.';
      }
    }
    if (item.error) {
      console.log(`${tag} ✖ ${item.error.message}`);
      failed.push({ title: url, error: item.error });
      continue;
    }
    console.log(`${tag} ✔ ${itemTitle(item)}${item.isPlaylist ? '' : `, ${formatDuration(item.info.duration)}`}`);
    items.push(item);
  }
  return { items, failed };
}

// Audio format, then MP3 bitrate. Returns false if input ended.
async function chooseAudio(p, items, opts) {
  const sizeFor = (af, q) => sum(items.filter((i) => !i.isPlaylist).map((i) => F.audioSize(i.info, af, q))) || undefined;
  const af = await p.choose(`Audio format (estimated size${items.length > 1 ? ' for all' : ''}):`,
    F.AUDIO_FORMATS.map((f) => ({ ...f, size: sizeFor(f, opts.audioQuality) })),
    Math.max(0, F.AUDIO_FORMATS.findIndex((f) => f.id === opts.audioFormat)));
  if (!af) return false;
  opts.audioFormat = af.id;
  if (af.id !== 'mp3') return true;
  const q = await p.choose('MP3 quality:',
    F.MP3_QUALITIES.map((m) => ({ ...m, size: sizeFor(af, m.value) })),
    Math.max(0, F.MP3_QUALITIES.findIndex((m) => m.value === opts.audioQuality)));
  if (!q) return false;
  opts.audioQuality = q.value;
  return true;
}

// Video format, then quality with sizes. Returns false if input ended.
async function chooseVideo(p, items, opts) {
  const known = items.filter((i) => !i.isPlaylist);
  process.stdout.write('Estimating sizes...');
  await Promise.all(F.VIDEO_FORMATS.map((f) => Y.loadVideoSizes(known, f)));
  clearLine();
  const vf = await p.choose(`Video format (estimated size at best quality${items.length > 1 ? ', for all' : ''}):`,
    F.VIDEO_FORMATS.map((f) => ({ ...f, size: sum(known.map((i) => Y.videoSize(i, f, null))) || undefined })),
    Math.max(0, F.VIDEO_FORMATS.findIndex((f) => f.id === opts.videoFormat)));
  if (!vf) return false;
  opts.videoFormat = vf.id;

  const videos = known.filter((i) => !isSoundCloud(i.url));
  let heights = [...new Set(videos.flatMap((i) => F.videoHeights(i.info, vf)))].sort((a, b) => b - a);
  const sized = heights.length > 0;
  if (!heights.length && items.some((i) => i.isPlaylist)) heights = COMMON_HEIGHTS;
  if (!heights.length) {
    opts.maxHeight = null; // SoundCloud only: there's no video quality to pick
    return true;
  }
  const choices = heights.map((h, i) => ({
    value: h,
    label: heightLabel(h),
    size: sized ? sum(videos.map((item) => Y.videoSize(item, vf, h))) || undefined : undefined,
    note: i === 0 ? 'best' : '',
  }));
  const title = items.length > 1
    ? 'Video quality (size for all; videos without that quality use the next lower one):'
    : 'Video quality:';
  const current = Math.max(0, heights.indexOf(opts.maxHeight));
  const q = await p.choose(title, choices, current);
  if (!q) return false;
  opts.maxHeight = q.value;
  return true;
}

// All options for the queue. Returns options, null if cancelled, or undefined if input ended.
async function askOptions(p, items, cfg) {
  const allSoundCloud = items.every((i) => isSoundCloud(i.url));
  const anySoundCloud = items.some((i) => isSoundCloud(i.url));
  const what = await p.choose('What do you want to download?', [
    { id: 'audio', label: 'Audio only' },
    { id: 'video', label: 'Video' },
    { id: 'both', label: 'Both audio + video' },
    { id: 'thumbnail', label: 'Thumbnail only (.jpg)' },
  ]);
  if (!what) return undefined;
  const opts = {
    mode: what.id, audioFormat: cfg.audioFormat, audioQuality: cfg.audioQuality, videoFormat: cfg.videoFormat,
    maxHeight: null, keepDetails: true, coverPicture: false, saveThumb: false, saveInfo: false,
  };
  if (wants(opts).audio && !(await chooseAudio(p, items, opts))) return undefined;
  if (wants(opts).video && !(await chooseVideo(p, items, opts))) return undefined;
  console.log('');
  if (wants(opts).audio && anySoundCloud) {
    opts.keepDetails = await p.yesNo(
      'Keep the original details (title, artist, date, cover art) inside the audio file? "n" = plain file', true);
    if (opts.keepDetails === null) return undefined;
  }
  // WebM is left out: SoundCloud's audio doesn't fit in it well.
  if (wants(opts).video && anySoundCloud && opts.videoFormat !== 'webm') {
    opts.coverPicture = await p.yesNo(
      `${allSoundCloud ? '' : 'For SoundCloud links: '}Show the cover art as the picture in the video file? "n" = video file with sound only`, true);
    if (opts.coverPicture === null) return undefined;
  }
  if (opts.mode !== 'thumbnail') {
    opts.saveThumb = await p.yesNo('Also save the thumbnail as a .jpg?', false);
    if (opts.saveThumb === null) return undefined;
  }
  if (items.some((i) => !i.isPlaylist)) {
    opts.saveInfo = await p.yesNo('Also save an info .txt (upload date, uploader, length, size, ...)?', false);
    if (opts.saveInfo === null) return undefined;
  }

  // Show the estimate and let the user change things until they're happy with it.
  for (;;) {
    printEstimate(items, opts);
    const menu = ['[Enter] Download'];
    if (wants(opts).video) menu.push('[v] Change video');
    if (wants(opts).audio) menu.push('[a] Change audio');
    menu.push('[o] Start over', '[x] Cancel');
    const answer = await p.ask(`${menu.join('  ')}: `);
    if (answer === null) return undefined;
    const key = answer.toLowerCase();
    if (key === 'x') return null;
    if (key === 'o') return askOptions(p, items, cfg);
    if (key === 'v' && wants(opts).video) {
      if (!(await chooseVideo(p, items, opts))) return undefined;
    } else if (key === 'a' && wants(opts).audio) {
      if (!(await chooseAudio(p, items, opts))) return undefined;
    } else if (!key) {
      return opts;
    }
  }
}

// ---------- Downloading ----------

async function downloadQueue(items, opts, cfg) {
  const results = [];
  for (const [i, item] of items.entries()) {
    console.log(`\n[${i + 1}/${items.length}] ${itemTitle(item)}`);
    const r = await Y.downloadItem(item, opts, cfg);
    if (r.ok) {
      if (r.renamed) console.log('  A file with this name already exists, so this was saved as a new copy instead.');
      for (const f of r.files) console.log(`  ✔ ${path.basename(f)}`);
      if (!r.files.length) console.log('  ✔ Done');
    } else {
      console.log(`  ✖ ${r.error.message}`);
    }
    results.push({ item, title: itemTitle(item), ...r });
  }
  return results;
}

function printSummary(results, failedLookups, cfg) {
  const ok = results.filter((r) => r.ok);
  const failed = [...failedLookups, ...results.filter((r) => !r.ok)];
  const total = ok.length + failed.length;
  console.log(`\nFinished: ${ok.length} of ${total} downloaded${ok.length ? ` to ${cfg.downloadDir}` : ''}.`);
  if (failed.length) {
    console.log('Not downloaded:');
    for (const f of failed) console.log(`  ✖ ${truncate(f.title, 70)}\n      ${f.error.message}`);
  }
  console.log('');
}

// ---------- Modes ----------

async function interactive(cfg) {
  const p = new Prompter();
  console.log('vconverter - youtube/soundcloud downloader)\n');
  if (cfg.checkForUpdates) {
    await offerUpdate(p);
    if (p.closed) return;
  }
  const dir = await askDownloadDir(p, cfg);
  if (!dir) return p.close();
  cfg.downloadDir = dir;
  const session = { cookies: cfg.cookiesFromBrowser };

  for (;;) {
    console.log('');
    const urls = await askQueue(p);
    if (!urls) break;
    const looked = await lookUp(urls, session, p);
    if (!looked) break;
    const { items, failed } = looked;
    const cleanup = () => items.forEach(Y.removeItemFiles);
    if (!items.length) {
      printSummary([], failed, cfg);
      continue;
    }
    const opts = await askOptions(p, items, cfg);
    if (opts === undefined) {
      cleanup();
      break;
    }
    if (opts === null) {
      console.log('Cancelled.');
      cleanup();
      continue;
    }
    let results = await downloadQueue(items, opts, cfg);
    printSummary(results, failed, cfg);

    const outdated = results.filter((r) => !r.ok && r.error.kind === 'outdated');
    if (outdated.length && (await offerUpdate(p, 'Some downloads failed in a way that usually means yt-dlp needs an update.'))) {
      const retry = await p.yesNo(`Try the ${outdated.length} failed download(s) again?`, true);
      if (retry) {
        const again = (await Promise.all(outdated.map((r) => Y.fetchInfo(r.item.url, r.item.cookies)))).filter((it) => !it.error);
        results = await downloadQueue(again, opts, cfg);
        printSummary(results, [], cfg);
        again.forEach(Y.removeItemFiles);
      }
    }
    cleanup();
  }
  p.close();
}

async function main() {
  checkTools();
  await interactive(loadConfig());
}

main();
