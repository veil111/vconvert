// Settings: defaults, plus anything saved in config.json (which is git-ignored).

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

// The user's real Downloads folder (the one browsers use). On Windows it can be moved, so read
// its location from the registry; otherwise fall back to ~/Downloads. Runs in the background
// (resolves with the folder), so it can happen at the same time as the other startup checks.
function systemDownloadsDir() {
  const fallback = path.join(os.homedir(), 'Downloads');
  if (process.platform !== 'win32') return Promise.resolve(fallback);
  return new Promise((resolve) => {
    execFile('reg', ['query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
      '/v', '{374DE290-123F-4565-9164-39C4925E467B}'], (err, stdout) => {
      const m = !err && stdout.match(/REG_(?:EXPAND_)?SZ\s+(.+)/);
      if (!m) return resolve(fallback);
      resolve(m[1].trim().replace(/%([^%]+)%/g, (all, name) => process.env[name] ?? all));
    });
  });
}

const DEFAULTS = {
  downloadDir: null, // null = the system Downloads folder (see systemDownloadsDir)
  audioFormat: 'mp3', // one of formats.AUDIO_FORMATS ids
  audioQuality: '0', // default MP3 quality, one of formats.MP3_QUALITIES values
  videoFormat: 'mp4', // one of formats.VIDEO_FORMATS ids
  cookiesFromBrowser: null, // e.g. "firefox": used automatically for age-restricted videos
  checkForUpdates: true,
};

function readConfigFile() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`Ignoring unreadable config.json: ${err.message}`);
    return {};
  }
}

// Saved settings on top of the defaults. downloadDir is null when no folder is saved.
function loadConfig() {
  return { ...DEFAULTS, ...readConfigFile() };
}

function saveConfigValue(key, value) {
  const current = readConfigFile();
  current[key] = value;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(current, null, 2) + '\n');
}

module.exports = { loadConfig, saveConfigValue, systemDownloadsDir };
