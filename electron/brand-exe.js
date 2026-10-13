const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const exe = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
const icon = path.join(__dirname, 'icon.ico');
const stampPath = path.join(__dirname, '.brand-stamp');

function stampValue() {
  const iconStat = fs.statSync(icon);
  const electronVersion = require('../node_modules/electron/package.json').version;
  return `${electronVersion}:${iconStat.size}:${Math.round(iconStat.mtimeMs)}`;
}

function fileDescription() {
  const script = `[System.Diagnostics.FileVersionInfo]::GetVersionInfo(${JSON.stringify(exe)}).FileDescription`;
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim();
}

async function main() {
  const stamp = stampValue();
  if (fs.existsSync(stampPath) && fs.readFileSync(stampPath, 'utf8') === stamp) return;

  const { rcedit } = await import('rcedit');
  try {
    await rcedit(exe, {
      icon,
      'version-string': {
        FileDescription: 'Notification Dashboard',
        ProductName: 'Notification Dashboard',
        OriginalFilename: 'Notification Dashboard.exe',
        CompanyName: 'Notification Dashboard',
      },
    });
  } catch (err) {
    const message = String(err.message || err);
    const locked = /unable to commit changes|being used by another process|ebusy|eperm/i.test(message);
    if (locked && fileDescription() === 'Notification Dashboard') return;
    if (locked) {
      throw new Error('Close Notification Dashboard, then run npm run electron again. electron.exe is open, so its icon cannot be updated.');
    }
    throw err;
  }

  fs.writeFileSync(stampPath, stamp);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
