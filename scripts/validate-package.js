const fs = require('fs');
const path = require('path');

const pkgDir = path.resolve(__dirname, '..');
const required = [
  'bin/ozybase-win-x64.exe',
  'bin/ozybase-linux-x64',
  'bin/ozybase-darwin-x64',
  'bin/ozybase-darwin-arm64'
];

const missing = required.filter((file) => !fs.existsSync(path.join(pkgDir, file)));
if (missing.length > 0) {
  console.error('[prepack] Missing binaries:');
  missing.forEach((f) => console.error(` - ${f}`));
  console.error('[prepack] Run: npm run build:binaries:all');
  process.exit(1);
}

console.log('[prepack] Binary bundle looks complete.');
