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

module.exports = { isUrl, isSoundCloud, heightLabel, formatBytes, formatDuration, formatDate, truncate };
