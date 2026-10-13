const path = require('path');

const exe = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
const icon = path.join(__dirname, 'icon.ico');

async function main() {
  const { rcedit } = await import('rcedit');
  await rcedit(exe, {
    icon,
    'version-string': {
      FileDescription: 'Notification Dashboard',
      ProductName: 'Notification Dashboard',
      OriginalFilename: 'Notification Dashboard.exe',
      CompanyName: 'Notification Dashboard',
    },
  });
  console.log(`Branded ${exe}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
