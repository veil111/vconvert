// Opens the Windows "choose a folder" window.

const { spawnSync } = require('child_process');

const SCRIPT = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Choose where vconverter saves your downloads'
$dialog.ShowNewFolderButton = $true
$dialog.SelectedPath = $env:VCONVERTER_START_DIR
if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.SelectedPath }
`;

// Returns the chosen folder, null if the window was cancelled, or undefined if it couldn't open.
function pickFolder(startDir) {
  if (process.platform !== 'win32') return undefined;
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
  const r = spawnSync('powershell', ['-NoProfile', '-STA', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8',
    env: { ...process.env, VCONVERTER_START_DIR: startDir },
  });
  if (r.error || r.status !== 0) return undefined;
  return r.stdout.trim() || null;
}

module.exports = { pickFolder };
