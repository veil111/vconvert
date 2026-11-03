// Checks whether yt-dlp is out of date and updates it. Sites like YouTube change often, and an old
// yt-dlp is the most common reason downloads stop working.

const { spawnSync } = require('child_process');

const UPDATE_CHECK_TIMEOUT_MS = 4000; // give up on the GitHub check after this, so startup isn't held up

function installedVersion() {
  const r = spawnSync('yt-dlp', ['--version'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

// Latest release version from GitHub, or null if offline / it takes too long.
async function latestVersion() {
  try {
    const res = await fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', {
      headers: { 'User-Agent': 'vconverter' },
      signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
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

module.exports = { latestVersion, isOlder, runUpdate };
