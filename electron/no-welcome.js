const fs = require('fs');
const path = require('path');

const MARKER = 'notification-dashboard-no-welcome';

const mainJs = `'use strict';
const { app } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

// ${MARKER}
// electron.exe with no app path shows the welcome window. Open this dashboard instead.
const dashboard = path.resolve(path.dirname(process.execPath), '..', '..', '..');
const child = spawn(process.execPath, [dashboard], {
  cwd: dashboard,
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
});
child.unref();
app.exit(0);
`;

const packageJson = JSON.stringify({ name: 'notification-dashboard-launcher', main: 'main.js' });

function pad4(n) {
  return (4 - (n % 4)) % 4;
}

function pickleString(value) {
  const bytes = Buffer.from(value, 'utf8');
  const pad = pad4(bytes.length);
  const payload = 4 + bytes.length + pad;
  const buf = Buffer.alloc(4 + payload);
  buf.writeUInt32LE(payload, 0);
  buf.writeUInt32LE(bytes.length, 4);
  bytes.copy(buf, 8);
  return buf;
}

function pickleUInt32(value) {
  const buf = Buffer.alloc(8);
  buf.writeUInt32LE(4, 0);
  buf.writeUInt32LE(value, 4);
  return buf;
}

function packAsar(files) {
  let offset = 0;
  const headerFiles = {};
  const blobs = [];
  for (const [name, contents] of Object.entries(files)) {
    const data = Buffer.from(contents);
    headerFiles[name] = { size: data.length, offset: String(offset) };
    blobs.push(data);
    offset += data.length;
  }
  const headerPickle = pickleString(JSON.stringify({ files: headerFiles }));
  return Buffer.concat([pickleUInt32(headerPickle.length), headerPickle, ...blobs]);
}

function hideWelcomeWindow() {
  const asarPath = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'resources', 'default_app.asar');
  let current = Buffer.alloc(0);
  try {
    current = fs.readFileSync(asarPath);
  } catch {}
  if (current.includes(MARKER)) return false;
  fs.writeFileSync(asarPath, packAsar({ 'package.json': packageJson, 'main.js': mainJs }));
  return true;
}

module.exports = { hideWelcomeWindow };

if (require.main === module) {
  hideWelcomeWindow();
  console.log('welcome window disabled');
}
