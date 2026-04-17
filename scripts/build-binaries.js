const { spawnSync } = require('child_process');
const path = require('path');

const pkgDir = __dirname ? path.resolve(__dirname, '..') : process.cwd();
const rootDir = path.resolve(pkgDir, '..', '..', '..');

const targets = [
  { goos: 'windows', goarch: 'amd64', out: 'ozybase-win-x64.exe' },
  { goos: 'linux', goarch: 'amd64', out: 'ozybase-linux-x64' },
  { goos: 'darwin', goarch: 'amd64', out: 'ozybase-darwin-x64' },
  { goos: 'darwin', goarch: 'arm64', out: 'ozybase-darwin-arm64' }
];

for (const target of targets) {
  const outPath = path.join(pkgDir, 'bin', target.out);
  console.log(`[build] ${target.goos}/${target.goarch} -> ${outPath}`);

  const result = spawnSync('go', ['build', '-o', outPath, './cmd/ozybase'], {
    cwd: rootDir,
    env: {
      ...process.env,
      GOOS: target.goos,
      GOARCH: target.goarch
    },
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
