#!/usr/bin/env node
// vconverter: local terminal app that downloads audio/video with yt-dlp + FFmpeg.
// Personal use only. No dependencies beyond Node.js, yt-dlp and ffmpeg on PATH.

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig, saveConfigValue, systemDownloadsDir } = require('./lib/config');
const F = require('./lib/formats');
const Y = require('./lib/ytdlp');
const { latestVersion, isOlder, runUpdate } = require('./lib/update');
const { pickFolder } = require('./lib/picker');
const { Prompter } = require('./lib/prompts');
const { isUrl, heightLabel, formatBytes, formatDuration, truncate } = require('./lib/util');

const BROWSERS = [
  { id: 'firefox', label: 'Firefox', note: 'most reliable' },
  { id: 'chrome', label: 'Chrome', note: 'close Chrome completely first' },
  { id: 'edge', label: 'Edge', note: 'close Edge completely first' },
  { id: 'brave', label: 'Brave', note: 'close Brave completely first' },
];
const COMMON_HEIGHTS = [2160, 1440, 1080, 720, 480, 360]; // offered for playlists, whose videos aren't looked up one by one
const ESTIMATE_TITLE_WIDTH = 60; // characters of each title shown in the size list
const SUMMARY_TITLE_WIDTH = 70; // characters of each title/link shown in the final summary

// Runs `cmd arg` and resolves with its output, or null if it isn't installed.
const versionOf = (cmd, arg) => new Promise((resolve) => {
  execFile(cmd, [arg], (err, stdout) => resolve(err ? null : stdout.trim()));
});

// Checks that yt-dlp and FFmpeg are installed (both at once). Returns yt-dlp's version.
async function checkTools() {
  const [ytdlp, ffmpeg] = await Promise.all([versionOf('yt-dlp', '--version'), versionOf('ffmpeg', '-version')]);
  const missing = [!ytdlp && 'yt-dlp', !ffmpeg && 'ffmpeg'].filter(Boolean);
  if (missing.length) {
    console.error(`Missing: ${missing.join(', ')}`);
    console.error(`Install with: scoop install ${missing.join(' ')}`);
    process.exit(1);
  }
  return ytdlp;
}

function itemTitle(item) {
  const { info } = item;
  if (item.isPlaylist) return `${info.title} (set/playlist, ${(info.entries || []).length} items)`;
  if (item.names) return item.names.file; // TikTok: the cleaned-up name its files will get
  return `${info.title} (${info.uploader || info.channel || 'unknown'})`;
}

function clearLine() {
  if (process.stdout.isTTY) process.stdout.write('\r\x1b[K');
  else process.stdout.write('\n');
}

const wants = (opts) => ({ audio: ['audio', 'both'].includes(opts.mode), video: ['video', 'both'].includes(opts.mode) });
const sum = (list) => list.reduce((a, b) => a + b, 0);

// Which sites are in the queue. `site` is 'tiktok' or 'soundcloud' (see item.site in lib/ytdlp.js).
const allOn = (items, site) => items.every((i) => i.site === site);
const anyOn = (items, site) => items.some((i) => i.site === site);

// Starts a site-only question with "For TikTok links: " when the queue also has other sites.
const SITE_NAMES = { tiktok: 'TikTok', soundcloud: 'SoundCloud' };
const forLinks = (items, site) => (allOn(items, site) ? '' : `For ${SITE_NAMES[site]} links: `);

// A format's note in the menus: its TikTok-specific note when the whole queue is TikTok.
const formatNote = (f, items) => (allOn(items, 'tiktok') && f.tiktokNote ? f.tiktokNote : f.note);

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
  items.forEach((item, i) => console.log(`  ${i + 1}. ${truncate(itemTitle(item), ESTIMATE_TITLE_WIDTH)}: ${describeSizes(perItem[i], opts)}`));
  const known = perItem.flatMap((s) => Object.values(s));
  const total = sum(known);
  const unknown = known.some((n) => !n);
  console.log(`  Total: ${total ? `about ${formatBytes(total)}${unknown ? ' + unknown' : ''}` : 'unknown'}`);
}

// ---------- Questions ----------

async function offerUpdate(p, message) {
  console.log(message);
  const yes = await p.yesNo('Update yt-dlp now?', true);
  return yes ? runUpdate() : false;
}

function useFolder(dir) {
  const cleaned = dir.replace(/^["']|["']$/g, '').replace(/^~(?=$|[\\/])/, os.homedir());
  // Only full paths, so a stray word doesn't create a folder wherever the terminal happens to be.
  if (!path.isAbsolute(cleaned)) throw new Error('use a full path, like C:\\Users\\you\\Music');
  const resolved = path.resolve(cleaned);
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

// Asks where to save, defaulting to the configured folder. Returns the folder, or null to quit.
async function askDownloadDir(p, cfg) {
  for (;;) {
    console.log(`Downloads will be saved to: ${cfg.downloadDir}`);
    const answer = await p.ask('[Enter] Use this folder  [c] Choose a different folder  [q] Quit: ');
    if (answer === null || answer.toLowerCase() === 'q') return null;
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

// Offers to use a browser's sign-in for age-restricted videos. `siteName` is e.g. "YouTube".
// Returns a browser id, null to skip, or undefined if input ended.
async function askCookies(p, session, siteName) {
  console.log(`  vconverter can use your browser's ${siteName} sign-in (its cookies) to get it.`);
  console.log(`  You need to be signed in to ${siteName} in that browser. The cookies stay on this computer`);
  console.log(`  and are only sent to ${siteName}.`);
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
  const results = await Y.fetchAll(urls, () => {
    checked++;
    if (process.stdout.isTTY) showChecked();
  });
  clearLine();
  for (const [i, url] of urls.entries()) {
    const tag = `[${i + 1}/${urls.length}]`;
    let item = results[i];
    if (item.error && ['age', 'bot'].includes(item.error.kind)) {
      // Lookups that failed have no item.site yet, so work it out from the link.
      const siteName = SITE_NAMES[Y.siteOf(url)] || 'YouTube';
      console.log(`${tag} ${item.error.message}`);
      const browser = session.cookies || (await askCookies(p, session, siteName));
      if (browser === undefined) return undefined;
      if (browser) {
        console.log(`${tag} Trying again with your ${BROWSERS.find((b) => b.id === browser)?.label || browser} sign-in...`);
        item = await Y.fetchInfo(url, browser);
        if (item.error?.kind === 'cookies') session.cookies = null; // ask again next time
        if (item.error && ['age', 'bot'].includes(item.error.kind)) {
          item.error.message = `Still blocked with your browser's sign-in. Make sure you're signed in to ${siteName} there (and for Chrome/Edge, that the browser is fully closed).`;
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

// TikTok only: the audio as heard in the video, or TikTok's full sound file. Returns false if input ended.
async function chooseTikTokSound(p, items, opts) {
  const choice = await p.choose(`${forLinks(items, 'tiktok')}Which audio?`, [
    { id: false, label: 'Audio from the video', note: 'exactly what you hear in the TikTok, same length' },
    { id: true, label: 'Full sound', note: 'TikTok\'s own sound file, often longer (e.g. more of the song); size unknown' },
  ], opts.tiktokFullSound ? 1 : 0);
  if (!choice) return false;
  opts.tiktokFullSound = choice.id;
  return true;
}

// Audio format, then MP3 bitrate. Returns false if input ended.
async function chooseAudio(p, items, opts) {
  // TikTok's full sound file has no known length, so it's left out of the sizes.
  const sized = items.filter((i) => !i.isPlaylist && !(opts.tiktokFullSound && i.site === 'tiktok'));
  const sizeFor = (af, q) => sum(sized.map((i) => F.audioSize(i.info, af, q))) || undefined;
  const af = await p.choose(`Audio format (estimated size${items.length > 1 ? ' for all' : ''}):`,
    F.AUDIO_FORMATS.map((f) => ({ ...f, note: formatNote(f, items), size: sizeFor(f, opts.audioQuality) })),
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
  await Y.loadVideoSizes(known);
  clearLine();
  // TikTok has no WebM videos, so WebM isn't offered when the queue has TikTok links.
  const formats = F.VIDEO_FORMATS.filter((f) => !(anyOn(items, 'tiktok') && f.id === 'webm'));
  const vf = await p.choose(`Video format (estimated size at best quality${items.length > 1 ? ', for all' : ''}):`,
    formats.map((f) => ({
      ...f,
      note: formatNote(f, items),
      size: sum(known.map((i) => Y.videoSize(i, f, null))) || undefined,
    })),
    Math.max(0, formats.findIndex((f) => f.id === opts.videoFormat)));
  if (!vf) return false;
  opts.videoFormat = vf.id;

  const videos = known.filter((i) => i.site !== 'soundcloud');
  let heights = [...new Set(videos.flatMap((i) => Y.videoHeights(i, vf)))].sort((a, b) => b - a);
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

// TikTok only: with or without TikTok's watermark. Returns false if input ended.
async function chooseWatermark(p, items, opts) {
  const choice = await p.choose(`${forLinks(items, 'tiktok')}Watermark:`, [
    { id: false, label: 'Without watermark', note: '' },
    { id: true, label: 'With watermark',
      note: 'why lol' },
  ], opts.watermark ? 1 : 0);
  if (!choice) return false;
  opts.watermark = choice.id;
  return true;
}

// All the audio questions: TikTok's "which audio?", then format and bitrate. Returns false if input ended.
async function askAudioChoices(p, items, opts) {
  if (anyOn(items, 'tiktok') && !(await chooseTikTokSound(p, items, opts))) return false;
  return chooseAudio(p, items, opts);
}

// All the video questions: format and quality, then TikTok's watermark. Returns false if input ended.
async function askVideoChoices(p, items, opts) {
  if (!(await chooseVideo(p, items, opts))) return false;
  if (anyOn(items, 'tiktok')) return chooseWatermark(p, items, opts);
  return true;
}

// Asks a yes/no question and saves the answer as opts[key]. Returns false if input ended.
async function askYesNoInto(p, opts, key, question, defaultYes) {
  const answer = await p.yesNo(question, defaultYes);
  if (answer === null) return false;
  opts[key] = answer;
  return true;
}

// The yes/no extras: details inside the audio, SoundCloud cover picture, thumbnail .jpg, info .txt.
// Returns false if input ended.
async function askExtras(p, items, opts) {
  if (wants(opts).audio && !(await askYesNoInto(p, opts, 'keepDetails',
    'Put the thumbnail and details (title, artist, date) inside the audio file? "n" = plain audio file only', true))) return false;
  // WebM is left out: SoundCloud's audio doesn't fit in it well.
  if (wants(opts).video && anyOn(items, 'soundcloud') && opts.videoFormat !== 'webm' && !(await askYesNoInto(p, opts, 'coverPicture',
    `${forLinks(items, 'soundcloud')}Show the cover art as the picture in the video file? "n" = video file with sound only`, true))) return false;
  if (opts.mode !== 'thumbnail' && !(await askYesNoInto(p, opts, 'saveThumb',
    'Also save the thumbnail as a .jpg?', false))) return false;
  if (items.some((i) => !i.isPlaylist) && !(await askYesNoInto(p, opts, 'saveInfo',
    'Also save an info .txt (upload date, uploader, length, size, ...)?', false))) return false;
  return true;
}

const START_OVER = 'start over';

// Shows the estimate and lets the user change things until they're happy with it. Returns the
// options to download with, null if cancelled, START_OVER, or undefined if input ended.
async function confirmOptions(p, items, opts) {
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
    if (key === 'o') return START_OVER;
    if (key === 'v' && wants(opts).video) {
      if (!(await askVideoChoices(p, items, opts))) return undefined;
    } else if (key === 'a' && wants(opts).audio) {
      if (!(await askAudioChoices(p, items, opts))) return undefined;
    } else if (!key) {
      return opts;
    }
  }
}

// All options for the queue. Returns options, null if cancelled, or undefined if input ended.
async function askOptions(p, items, cfg) {
  const what = await p.choose('What do you want to download?', [
    { id: 'audio', label: 'Audio only' },
    { id: 'video', label: 'Video' },
    { id: 'both', label: 'Both audio + video' },
    { id: 'thumbnail', label: 'Thumbnail only (.jpg)' },
  ]);
  if (!what) return undefined;
  const opts = {
    mode: what.id, audioFormat: cfg.audioFormat, audioQuality: cfg.audioQuality, videoFormat: cfg.videoFormat,
    maxHeight: null, keepDetails: true, coverPicture: false, watermark: false, tiktokFullSound: false,
    saveThumb: false, saveInfo: false,
  };
  if (wants(opts).audio && !(await askAudioChoices(p, items, opts))) return undefined;
  if (wants(opts).video && !(await askVideoChoices(p, items, opts))) return undefined;
  console.log('');
  if (!(await askExtras(p, items, opts))) return undefined;
  const result = await confirmOptions(p, items, opts);
  return result === START_OVER ? askOptions(p, items, cfg) : result;
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
    for (const f of failed) console.log(`  ✖ ${truncate(f.title, SUMMARY_TITLE_WIDTH)}\n      ${f.error.message}`);
  }
  console.log('');
}

// ---------- Modes ----------

// After the folder question: if GitHub has a newer yt-dlp, offers to update. The check started at
// launch, so it's usually finished by now. Returns false if input ended.
async function offerStartupUpdate(p, ytdlpVersion, latest) {
  if (!latest) return true;
  process.stdout.write('Checking for yt-dlp updates...');
  const newest = await latest;
  clearLine();
  if (newest && isOlder(ytdlpVersion, newest)) {
    console.log('');
    await offerUpdate(p, `A newer yt-dlp is available (${ytdlpVersion} -> ${newest}).\n` +
      'YouTube, SoundCloud and TikTok change often, and an old yt-dlp is the most common reason downloads fail.');
    if (p.closed) return false;
  }
  return true;
}

// If some downloads failed because yt-dlp looks out of date, offers to update it and try them again.
async function offerUpdateAndRetry(p, results, opts, cfg) {
  const outdated = results.filter((r) => !r.ok && r.error.kind === 'outdated');
  if (!outdated.length) return;
  if (!(await offerUpdate(p, 'Some downloads failed in a way that usually means yt-dlp needs an update.'))) return;
  const retry = await p.yesNo(`Try the ${outdated.length} failed download(s) again?`, true);
  if (!retry) return;
  const again = (await Promise.all(outdated.map((r) => Y.fetchInfo(r.item.url, r.item.cookies)))).filter((it) => !it.error);
  printSummary(await downloadQueue(again, opts, cfg), [], cfg);
  again.forEach(Y.removeItemFiles);
}

// One round: ask for links, look them up, ask the options, download. Returns false to quit.
async function runQueue(p, cfg, session) {
  console.log('');
  const urls = await askQueue(p);
  if (!urls) return false;
  const looked = await lookUp(urls, session, p);
  if (!looked) return false;
  const { items, failed } = looked;
  if (!items.length) {
    printSummary([], failed, cfg);
    return true;
  }
  try {
    const opts = await askOptions(p, items, cfg);
    if (opts === undefined) return false;
    if (opts === null) {
      console.log('Cancelled.');
      return true;
    }
    const results = await downloadQueue(items, opts, cfg);
    printSummary(results, failed, cfg);
    await offerUpdateAndRetry(p, results, opts, cfg);
    return true;
  } finally {
    items.forEach(Y.removeItemFiles); // the saved info files aren't needed after this round
  }
}

async function interactive(cfg, ytdlpVersion, latest) {
  const p = new Prompter();
  console.log('vconverter - youtube/soundcloud/tiktok downloader\n');
  // The folder question comes first so a slow update check never holds up the start.
  const dir = await askDownloadDir(p, cfg);
  if (!dir) return p.close();
  cfg.downloadDir = dir;
  if (!(await offerStartupUpdate(p, ytdlpVersion, latest))) return;
  const session = { cookies: cfg.cookiesFromBrowser };
  let keepGoing = true;
  while (keepGoing) keepGoing = await runQueue(p, cfg, session);
  p.close();
}

async function main() {
  const cfg = loadConfig();
  // The slower startup checks all run at the same time: the GitHub update check (which nothing
  // waits for until after the first question), the installed tools, and the Windows Downloads
  // folder (only needed when no folder is saved).
  const latest = cfg.checkForUpdates ? latestVersion() : null;
  const [ytdlpVersion, downloadsDir] = await Promise.all([checkTools(), cfg.downloadDir ? null : systemDownloadsDir()]);
  cfg.downloadDir ??= downloadsDir;
  await interactive(cfg, ytdlpVersion, latest);
}

main();
