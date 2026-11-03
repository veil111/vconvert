// Small formatting and URL helpers shared by the rest of the app.

function isUrl(text) {
  try {
    const u = new URL(text);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isSoundCloud(url) {
  try {
    return /(^|\.)soundcloud\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

// tiktok.com, www.tiktok.com, m.tiktok.com, and short links like vm.tiktok.com / vt.tiktok.com
// (yt-dlp follows short links to the real video itself).
function isTikTok(url) {
  try {
    return /(^|\.)tiktok\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

// Makes text safe to use as a Windows file or folder name, at most `maxLength` characters.
function safeFileName(text, maxLength) {
  let name = text
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ') // characters Windows doesn't allow in names
    .replace(/\s+/g, ' ')
    .trim();
  if (name.length > maxLength) {
    name = name.slice(0, maxLength);
    const lastSpace = name.lastIndexOf(' ');
    if (lastSpace > maxLength * 0.6) name = name.slice(0, lastSpace); // don't cut a word in half
  }
  name = name.replace(/[\s.]+$/, ''); // Windows also doesn't allow names ending in a dot or space
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name)) name = `_${name}`; // names Windows reserves
  return name;
}

// Longest TikTok name parts, in characters, so the full path stays under Windows' 260-character limit.
const TIKTOK_TITLE_MAX = 60;
const TIKTOK_UPLOADER_MAX = 40;
const TIKTOK_FALLBACK_MAX = 80;

// TikTok captions are often long, empty, or full of hashtags and emoji, so file names use a cleaned
// version: "Title (Uploader)", or "Uploader - videoID" when nothing is left of the caption.
// Returns { folder, file } (file has no extension).
function tiktokNames(info) {
  const uploader = safeFileName(info.uploader || info.channel || 'TikTok', TIKTOK_UPLOADER_MAX);
  const title = safeFileName((info.title || info.description || '')
    .replace(/#\S+/g, ' ') // hashtags
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u200d\ufe0f\u20e3]/gu, ' ') // emoji
    .replace(/\s+/g, ' ')
    .replace(/^[\s\p{P}]+|[\s,;:|\-–—]+$/gu, ''), TIKTOK_TITLE_MAX); // leftover punctuation at either end
  if (!title) {
    const fallback = safeFileName(`${uploader} - ${info.id}`, TIKTOK_FALLBACK_MAX);
    return { folder: fallback, file: fallback };
  }
  return { folder: title, file: `${title} (${uploader})` };
}

function heightLabel(h) {
  if (h >= 4320) return `${h}p (8K)`;
  if (h >= 2160) return `${h}p (4K)`;
  if (h >= 1440) return `${h}p (2K)`;
  return `${h}p`;
}

function formatBytes(bytes) {
  if (!bytes) return 'unknown';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return 'unknown';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function formatDate(yyyymmdd) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(yyyymmdd || '');
  return m ? `${m[1]}-${m[2]}-${m[3]}` : 'unknown';
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

module.exports = {
  isUrl, isSoundCloud, isTikTok, tiktokNames, heightLabel, formatBytes, formatDuration, formatDate, truncate,
};
