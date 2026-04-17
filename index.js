#!/usr/bin/env node
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function resolveBinaryName() {
  const platform = os.platform();
  const arch = os.arch();

  if (platform === 'win32') {
    if (arch !== 'x64') {
      throw new Error(`Unsupported architecture on Windows: ${arch}. Expected x64.`);
    }
    return 'ozybase-win-x64.exe';
  }

  if (platform === 'linux') {
    if (arch !== 'x64') {
      throw new Error(`Unsupported architecture on Linux: ${arch}. Expected x64.`);
    }
    return 'ozybase-linux-x64';
  }

  if (platform === 'darwin') {
    if (arch === 'arm64') {
      return 'ozybase-darwin-arm64';
    }
    if (arch === 'x64') {
      return 'ozybase-darwin-x64';
    }
    throw new Error(`Unsupported architecture on macOS: ${arch}.`);
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

function run() {
  const binaryName = resolveBinaryName();
  const binaryPath = path.join(__dirname, 'bin', binaryName);

  if (!fs.existsSync(binaryPath)) {
    console.error(`[ozybase] Missing binary: ${binaryName}`);
    console.error('[ozybase] Rebuild binaries before publishing (see packaging/npm/ozybase/README.md).');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const child = spawn(binaryPath, args, {
    stdio: 'inherit',
    windowsHide: true,
  });

  child.on('error', (err) => {
    console.error(`[ozybase] Failed to launch binary: ${err.message}`);
    process.exit(1);
  });

  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  signals.forEach((signal) => {
    process.on(signal, () => {
      if (!child.killed) {
        try {
          child.kill(signal);
        } catch (_) {
          // ignore signal forwarding errors
        }
      }
    });
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

run();
