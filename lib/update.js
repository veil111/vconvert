// Checks whether yt-dlp is out of date and updates it. Sites like YouTube change often, and an old
// yt-dlp is the most common reason downloads stop working.

const { spawnSync } = require('child_process');

function installedVersion() {
  const r = spawnSync('yt-dlp', ['--version'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

// Latest release version from GitHub, or null if offline / it takes too long.
async function latestVersion() {
  try {
    const res = await fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', {
      headers: { 'User-Agent': 'vconverter' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return (await res.json()).tag_name || null;
  } catch {
    return null;
  }
}

// Versions look like "2026.10.26" or "2026.10.26.1".
function isOlder(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0);
  }
  return false;
}

// Returns { installed, latest } when an update is available, otherwise null.
async function checkForUpdate() {
  const installed = installedVersion();
  const latest = await latestVersion();
  if (!installed || !latest || !isOlder(installed, latest)) return null;
  return { installed, latest };
}

function installedWithScoop() {
  const r = spawnSync('where', ['yt-dlp'], { encoding: 'utf8' });
  return /[\\/]scoop[\\/]/i.test(r.stdout || '');
}

function updateCommand() {
  return installedWithScoop() ? 'scoop update yt-dlp' : 'yt-dlp -U';
}

// Runs the update, showing its output. Returns true on success.
function runUpdate() {
  const cmd = updateCommand();
  console.log(`\nRunning: ${cmd}\n`);
  const r = spawnSync(cmd, { stdio: 'inherit', shell: true });
  const ok = r.status === 0;
  console.log(ok ? `\nyt-dlp is now version ${installedVersion()}.\n` : '\nThe update failed. Try running the command above yourself.\n');
  return ok;
}

module.exports = { checkForUpdate, runUpdate };
