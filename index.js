#!/usr/bin/env node
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');

const DEFAULT_SERVER_NAME = 'ozybase';
const DEFAULT_MCP_URL = 'https://YOUR_DOMAIN/api/project/mcp';
const DEFAULT_API_KEY_ENV = 'OZYBASE_API_KEY';
const DEFAULT_MCP_TOKEN_ENV = 'OZYBASE_MCP_TOKEN';
const USE_COLOR = process.stdout.isTTY && process.env.NO_COLOR !== '1';
const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

function color(style, value) {
  if (!USE_COLOR) {
    return String(value);
  }
  return `${ANSI[style] || ''}${value}${ANSI.reset}`;
}

function printBanner() {
  console.log('  OOOOO   ZZZZZ   Y   Y   BBBB    AAA    SSSS   EEEEE');
  console.log('  O   O      Z    Y Y     B   B  A   A  S      E');
  console.log('  O   O     Z      Y      BBBB   AAAAA   SSS   EEEE');
  console.log('  O   O    Z       Y      B   B  A   A      S  E');
  console.log('  OOOOO   ZZZZZ    Y      BBBB   A   A  SSSS   EEEEE');
  console.log('');
}

function printHeader() {
  printBanner();
  console.log('');
}

function printPanel(title, rows = [], footer = '') {
  const safeRows = rows.map(([label, value]) => [String(label), String(value ?? '')]);
  const width = Math.max(62, title.length + 4, ...safeRows.map(([label, value]) => label.length + value.length + 7));
  const line = '-'.repeat(width);
  console.log(color('gray', line));
  console.log(`${color('bold', title)}`);
  console.log(color('gray', line));
  for (const [label, value] of safeRows) {
    console.log(`${color('gray', label.padEnd(20))} ${value}`);
  }
  if (footer) {
    console.log(color('gray', line));
    console.log(footer);
  }
  console.log(color('gray', line));
}

function statusLabel(ok) {
  return ok ? color('green', 'OK ') : color('red', 'ERR');
}

function printError(error) {
  console.error(`${color('red', 'OzyBase error')} ${error.message}`);
}

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

function resolveBinaryPath() {
  const binaryName = resolveBinaryName();
  const binaryPath = path.join(__dirname, 'bin', binaryName);

  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Missing binary: ${binaryName}`);
  }

  return binaryPath;
}

function parseOptions(args, schema = {}) {
  const options = { _: [] };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') {
      options._.push(...args.slice(i + 1));
      break;
    }
    if (!arg.startsWith('--')) {
      options._.push(arg);
      continue;
    }

    const eq = arg.indexOf('=');
    const key = arg.slice(2, eq === -1 ? undefined : eq);
    const expectsValue = schema[key] === 'value';

    if (eq !== -1) {
      options[key] = arg.slice(eq + 1);
      continue;
    }
    if (expectsValue) {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for --${key}`);
      }
      options[key] = value;
      i += 1;
      continue;
    }
    options[key] = true;
  }

  return options;
}

function printUsage() {
  printHeader();
  printPanel('Usage', [
    ['connect', 'ozybase connect --url <mcp-url> [--yes]'],
    ['doctor', 'ozybase doctor [--connect] [--json]'],
    ['repair', 'ozybase repair --url <mcp-url> [--yes]'],
    ['native', 'ozybase <native-command> [...args]'],
  ], color('gray', 'Unknown commands are passed to the packaged native OzyBase binary.'));
  printPanel('Examples', [
    ['safe setup', 'npx ozybase connect --url https://example.com/api/project/mcp'],
    ['CI setup', 'npx ozybase connect --url https://example.com/api/project/mcp --yes'],
    ['diagnose', 'npx ozybase doctor --connect'],
    ['native MCP', 'npx ozybase mcp serve --url https://example.com/api/project/mcp'],
  ]);
}

function findWorkspaceRoot(startDir = process.cwd(), explicit = false) {
  let current = path.resolve(startDir);

  if (explicit) {
    return current;
  }

  while (true) {
    if (
      fs.existsSync(path.join(current, '.git')) ||
      fs.existsSync(path.join(current, 'package.json')) ||
      fs.existsSync(path.join(current, '.vscode')) ||
      fs.existsSync(path.join(current, '.cursor')) ||
      fs.existsSync(path.join(current, '.windsurf'))
    ) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDir);
    }
    current = parent;
  }
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return { exists: false, data: {}, error: null };
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return { exists: true, data: raw.trim() ? JSON.parse(raw) : {}, error: null };
  } catch (error) {
    return { exists: true, data: null, error };
  }
}

function writeJsonStable(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function analyzeMcpUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (error) {
    throw new Error(`Invalid --url: ${rawUrl}`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Invalid --url: only http and https MCP endpoints are supported');
  }

  const host = parsed.hostname.toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const isSecure = parsed.protocol === 'https:' || isLocal;

  return {
    url: parsed.toString(),
    origin: parsed.origin,
    protocol: parsed.protocol.replace(':', ''),
    host: parsed.host,
    path: parsed.pathname,
    isLocal,
    isSecure,
    warnings: [
      ...(!isSecure ? ['This endpoint is not HTTPS. Only use HTTP for localhost development.'] : []),
      ...(!parsed.pathname.endsWith('/api/project/mcp') ? ['The path does not end with /api/project/mcp. Verify this is the intended OzyBase MCP endpoint.'] : []),
    ],
  };
}

function openBrowser(url) {
  const platform = os.platform();
  let command;
  let args;

  if (platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return true;
  } catch (_) {
    return false;
  }
}

function renderConfirmationPage(summary, token) {
  const warnings = summary.urlInfo.warnings.length > 0
    ? summary.urlInfo.warnings.map((warning) => `<div class="warning">${escapeHtml(warning)}</div>`).join('')
    : '<div class="ok">No endpoint warnings detected.</div>';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Confirm OzyBase MCP Setup</title>
  <style>
    :root {
      color-scheme: dark;
      --color-primary: #FEFE00;
      --color-primary-foreground: #000000;
      --color-background: #09090b;
      --color-surface: #09090b;
      --color-muted: #18181b;
      --color-accent: #27272a;
      --color-border: #27272a;
      --color-muted-foreground: #71717a;
      --color-foreground: #fafafa;
      --radius-lg: 0.5rem;
      --radius-md: 0.375rem;
      --radius-sm: 0.25rem;
    }
    @keyframes ozy-dialog-in {
      from { opacity: 0; transform: translate3d(0, 18px, 0) scale(0.96); }
      to { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
    }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--color-background);
      color: var(--color-foreground);
      font-family: "Inter", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      display: grid;
      place-items: center;
      padding: 32px;
    }
    main {
      width: min(720px, 100%);
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
      overflow: hidden;
      position: relative;
      animation: ozy-dialog-in 200ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    main::before {
      content: "";
      position: absolute;
      left: 2rem;
      right: 2rem;
      top: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(254, 254, 0, 0.58), transparent);
      opacity: 0.85;
      pointer-events: none;
    }
    header {
      padding: 32px;
      border-bottom: 1px solid var(--color-border);
    }
    h1 { margin: 0 0 8px; font-size: 24px; font-weight: 600; letter-spacing: -0.02em; }
    p { color: var(--color-muted-foreground); line-height: 1.5; margin: 0; font-size: 14px; }
    section { padding: 32px; display: grid; gap: 16px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .card { border: 1px solid var(--color-border); background: var(--color-muted); border-radius: var(--radius-md); padding: 16px; }
    .label { color: var(--color-muted-foreground); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; font-weight: 500; }
    .value { color: var(--color-foreground); font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace; font-size: 13px; overflow-wrap: anywhere; }
    .warning { padding: 14px 16px; border: 1px solid rgba(239, 68, 68, 0.2); background: rgba(239, 68, 68, 0.1); color: #fca5a5; border-radius: var(--radius-md); font-size: 14px; }
    .ok { padding: 14px 16px; border: 1px solid rgba(34, 197, 94, 0.2); background: rgba(34, 197, 94, 0.1); color: #86efac; border-radius: var(--radius-md); font-size: 14px; }
    .actions { display: flex; gap: 12px; justify-content: flex-end; padding: 0 32px 24px; }
    button { border: 1px solid transparent; border-radius: var(--radius-md); padding: 10px 16px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s ease; }
    .approve { background-color: var(--color-primary); color: var(--color-primary-foreground); }
    .approve:hover { opacity: 0.9; }
    .reject { background-color: transparent; border: 1px solid var(--color-border); color: var(--color-foreground); }
    .reject:hover { background-color: var(--color-muted); }
    .fineprint { font-size: 12px; color: var(--color-muted-foreground); padding: 0 32px 32px; }
    @media (max-width: 600px) { body { padding: 16px; } .grid { grid-template-columns: 1fr; } header, section, .actions, .fineprint { padding-left: 20px; padding-right: 20px; } main::before { left: 1rem; right: 1rem; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div style="display: flex; align-items: center; margin-bottom: 8px;">
        <img src="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/4QC8RXhpZgAASUkqAAgAAAAGABIBAwABAAAAAQAAABoBBQABAAAAVgAAABsBBQABAAAAXgAAACgBAwABAAAAAgAAABMCAwABAAAAAQAAAGmHBAABAAAAZgAAAAAAAABgAAAAAQAAAGAAAAABAAAABgAAkAcABAAAADAyMTABkQcABAAAAAECAwAAoAcABAAAADAxMDABoAMAAQAAAP//AAACoAMAAQAAAPQBAAADoAMAAQAAAPQBAAAAAAAA/+EOzWh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8APD94cGFja2V0IGJlZ2luPSfvu78nIGlkPSdXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQnPz4KPHg6eG1wbWV0YSB4bWxuczp4PSdhZG9iZTpuczptZXRhLyc+CjxyZGY6UkRGIHhtbG5zOnJkZj0naHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyc+CgogPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9JycKICB4bWxuczpBdHRyaWI9J2h0dHA6Ly9ucy5hdHRyaWJ1dGlvbi5jb20vYWRzLzEuMC8nPgogIDxBdHRyaWI6QWRzPgogICA8cmRmOlNlcT4KICAgIDxyZGY6bGkgcmRmOnBhcnNlVHlwZT0nUmVzb3VyY2UnPgogICAgIDxBdHRyaWI6Q3JlYXRlZD4yMDI2LTAxLTI1PC9BdHRyaWI6Q3JlYXRlZD4KICAgICA8QXR0cmliOkRhdGE+eyZxdW90O2RvYyZxdW90OzomcXVvdDtEQUdfZGliMzd6SSZxdW90OywmcXVvdDt1c2VyJnF1b3Q7OiZxdW90O1VBR3hMamRCa0U0JnF1b3Q7LCZxdW90O2JyYW5kJnF1b3Q7OiZxdW90O0JBR3hMa0JIN093JnF1b3Q7fTwvQXR0cmliOkRhdGE+CiAgICAgPEF0dHJpYjpFeHRJZD5hMTdhNzk5OC1lNzMzLTQyOTQtOTI0My05MDlhM2YzZjllODE8L0F0dHJpYjpFeHRJZD4KICAgICA8QXR0cmliOkZiSWQ+NTI1MjY1OTE0MTc5NTgwPC9BdHRyaWI6RmJJZD4KICAgICA8QXR0cmliOlRvdWNoVHlwZT4yPC9BdHRyaWI6VG91Y2hUeXBlPgogICAgPC9yZGY6bGk+CiAgIDwvcmRmOlNlcT4KICA8L0F0dHJpYjpBZHM+CiA8L3JkZjpEZXNjcmlwdGlvbj4KCiA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0nJwogIHhtbG5zOmRjPSdodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyc+CiAgPGRjOnRpdGxlPgogICA8cmRmOkFsdD4KICAgIDxyZGY6bGkgeG1sOmxhbmc9J3gtZGVmYXVsdCc+Rk96eWJhc2Vsb2dvIC0gMTwvcmRmOmxpPgogICA8L3JkZjpBbHQ+CiAgPC9kYzp0aXRsZT4KIDwvcmRmOkRlc2NyaXB0aW9uPgoKIDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PScnCiAgeG1sbnM6cGRmPSdodHRwOi8vbnMuYWRvYmUuY29tL3BkZi8xLjMvJz4KICA8cGRmOkF1dGhvcj5LZXZpbiBLZXZpbnNzPC9wZGY6QXV0aG9yPgogPC9yZGY6RGVzY3JpcHRpb24+CgogPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9JycKICB4bWxuczp4bXA9J2h0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8nPgogIDx4bXA6Q3JlYXRvclRvb2w+Q2FudmEgKFJlbmRlcmVyKSBkb2M9REFHX2RpYjM3ekkgdXNlcj1VQUd4TGpkQmtFNCBicmFuZD1CQUd4TGtCSDdPdzwveG1wOkNyZWF0b3JUb29sPgogPC9yZGY6RGVzY3JpcHRpb24+CjwvcmRmOlJERj4KPC94OnhtcG1ldGE+CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCjw/eHBhY2tldCBlbmQ9J3cnPz7/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAH0AfQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldY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UAGKKWkJoAKDRSUALRRRmgApabR3oAWgdaAOaWgAJ4ptBooAKKKKACiiigAooooAKKKKAFooFFACGgUvak70ALQaKKAEopTQBQAUdqKWgBKDS0lABRRSigBKKWigBDSUtAoAKKXFJQAZoNFFAAOlFFFABSjmkooAQ9aKWloATFIadSHmgBM80tJ3paACjvS0UAJSUpooASloxS0AJSCnEU3pQAtFIKWgAFBoFLQA2ilo60AFFFFAC0lFJQAtFFFACikJpRRigBtFFFABRRRQAUUUUAFFFFABRRRQAtFKaTNABSUUlADqBSZzSigAooooAKM0ZooAKKKKAFoNJRQAUCigUALS0hooAKSik70ALRRRQAUUdqB0oAKKKM0ALijFANBoAM0lJRQADrS0gpaAClzSUUAFLSUUAGaXNJS0ABpKKKADFLRSUAL2pAeaM0lADs5opKKAFNJRRQAUCkpRQAtFJRmgBaQmikoAKKKKACiiigAooooAKKKKACiiigBTSUUUAJRRRQAop1FFACUlFFAAaKKKAFo70UUAHaiiigAFJRRQAZoFFFABQKKKAFoNFFACdqKKKAFooooATNKDRRQAhooooAUUlFFABR3oooAUUUUUAJmjNFFACiloooAQ0hoooABSiiigAoNFFAB2puaKKAFooooAWkoooAX0pKKKACiiigAooooAKKKKACiiigAooooA/9k=" alt="OzyBase Logo" style="height: 32px; width: 32px; border-radius: 6px; margin-right: 12px;" />
        <h1 style="margin: 0;">Confirm OzyBase MCP setup</h1>
      </div>
      <p>Review the endpoint and local files before this CLI configures your editor. Only approve domains you control or trust.</p>
    </header>
    <section>
      <div class="grid">
        <div class="card"><div class="label">MCP origin</div><div class="value">${escapeHtml(summary.urlInfo.origin)}</div></div>
        <div class="card"><div class="label">Protocol</div><div class="value">${escapeHtml(summary.urlInfo.protocol)}${summary.urlInfo.isSecure ? ' (secure)' : ' (not secure)'}</div></div>
        <div class="card"><div class="label">Workspace</div><div class="value">${escapeHtml(summary.workspaceRoot)}</div></div>
        <div class="card"><div class="label">MCP config</div><div class="value">${escapeHtml(summary.configPath)}</div></div>
        <div class="card"><div class="label">Config block</div><div class="value">${escapeHtml(summary.blockName)}.${escapeHtml(summary.serverName)}</div></div>
        <div class="card"><div class="label">API key source</div><div class="value">${escapeHtml(summary.apiKeyEnv)} from env</div></div>
      </div>
      <div class="card"><div class="label">MCP command</div><div class="value">npx -y ozybase mcp serve --url ${escapeHtml(summary.urlInfo.url)}</div></div>
      <div>${warnings}</div>
    </section>
    <div class="actions">
      <form method="post" action="/reject?token=${encodeURIComponent(token)}"><button class="reject" type="submit">Cancel</button></form>
      <form method="post" action="/approve?token=${encodeURIComponent(token)}"><button class="approve" type="submit">Approve MCP Setup</button></form>
    </div>
    <div class="fineprint">This local confirmation page is served from 127.0.0.1 and only controls the CLI process currently waiting in your terminal. It does not send your service_role key to npm or to this page.</div>
  </main>
</body>
</html>`;
}

function waitForBrowserConfirmation(summary) {
  if (process.env.CI) {
    throw new Error('Refusing interactive MCP setup in CI. Re-run with --yes if this is intentional.');
  }

  return new Promise((resolve, reject) => {
    const token = crypto.randomBytes(18).toString('hex');
    const timeout = setTimeout(() => {
      server.close(() => reject(new Error('MCP setup confirmation timed out.')));
    }, 10 * 60 * 1000);

    let settled = false;
    const finish = (ok, res) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
      res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>OzyBase MCP Setup</title><style>
        :root { --color-surface: #09090b; --color-border: #27272a; --color-muted: #18181b; --color-foreground: #fafafa; --color-muted-foreground: #71717a; --radius-lg: 0.5rem; }
        body { font-family: "Inter", system-ui, sans-serif; background: #09090b; color: var(--color-foreground); display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 32px; }
        main { width: min(480px, 100%); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 32px; text-align: center; position: relative; overflow: hidden; box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.5); }
        main::before { content: ""; position: absolute; left: 2rem; right: 2rem; top: 0; height: 1px; background: linear-gradient(90deg, transparent, rgba(254, 254, 0, 0.58), transparent); opacity: 0.85; pointer-events: none; }
        h1 { margin: 0 0 8px; font-size: 20px; font-weight: 600; }
        p { color: var(--color-muted-foreground); margin: 0; font-size: 14px; }
      </style></head><body><main><h1>${ok ? 'OzyBase MCP setup approved' : 'OzyBase MCP setup cancelled'}</h1><p>You can close this tab and return to your terminal.</p></main></body></html>`);
      if (ok) {
        resolve();
      } else {
        reject(new Error('MCP setup cancelled by user.'));
      }
      server.close(() => {});
    };

    const server = http.createServer((req, res) => {
      const requestUrl = new URL(req.url, 'http://127.0.0.1');
      if (requestUrl.searchParams.get('token') !== token) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
        res.end('Invalid confirmation token.');
        return;
      }
      if (req.method === 'POST' && requestUrl.pathname === '/approve') {
        finish(true, res);
        return;
      }
      if (req.method === 'POST' && requestUrl.pathname === '/reject') {
        finish(false, res);
        return;
      }
      if (req.method === 'GET' && requestUrl.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
        res.end(renderConfirmationPage(summary, token));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
      res.end('Not found.');
    });

    server.keepAliveTimeout = 1000;
    server.requestTimeout = 5000;

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const confirmUrl = `http://127.0.0.1:${address.port}/?token=${encodeURIComponent(token)}`;
      printHeader();
      printPanel('Review Before Writing', [
        ['MCP origin', summary.urlInfo.origin],
        ['Workspace', summary.workspaceRoot],
        ['Config file', summary.configPath],
        ['MCP block', `${summary.blockName}.${summary.serverName}`],
        ['API key source', `${summary.apiKeyEnv} from environment`],
      ], `${color('yellow', 'Open')} ${confirmUrl}`);
      if (!openBrowser(confirmUrl)) {
        console.log(`${color('yellow', 'Note')} Could not open a browser automatically. Open the URL above manually.`);
      }
    });
  });
}

function detectMcpBlock(config, workspaceRoot, editorOverride) {
  if (editorOverride && editorOverride !== 'auto') {
    if (editorOverride === 'vscode') {
      return 'servers';
    }
    if (['cursor', 'windsurf', 'antigravity'].includes(editorOverride)) {
      return 'mcpServers';
    }
    throw new Error(`Unsupported --editor value: ${editorOverride}`);
  }

  if (config && typeof config === 'object') {
    if (config.servers && config.servers[DEFAULT_SERVER_NAME]) {
      return 'servers';
    }
    if (config.mcpServers && config.mcpServers[DEFAULT_SERVER_NAME]) {
      return 'mcpServers';
    }
    if (config.servers && !config.mcpServers) {
      return 'servers';
    }
    if (config.mcpServers && !config.servers) {
      return 'mcpServers';
    }
  }

  if (fs.existsSync(path.join(workspaceRoot, '.cursor')) || fs.existsSync(path.join(workspaceRoot, '.windsurf'))) {
    return 'mcpServers';
  }

  return 'servers';
}

function buildMcpServer({ url, header, apiKeyEnv, token }) {
  const args = ['-y', 'ozybase', 'mcp', 'serve', '--url', url];
  if (header && header !== 'apikey') {
    args.push('--header', header);
  }

  return {
    command: 'npx',
    args,
    env: {
      [apiKeyEnv]: token || `\${env:${apiKeyEnv}}`,
    },
  };
}

function deviceEndpoint(mcpURL, suffix) {
  const parsed = new URL(mcpURL);
  return `${parsed.origin}/api/project/mcp/device/${suffix}`;
}

function extractConfiguredMcpURL(config, serverName = DEFAULT_SERVER_NAME) {
  const candidates = [config?.servers?.[serverName], config?.mcpServers?.[serverName]].filter(Boolean);
  for (const server of candidates) {
    if (!server || !Array.isArray(server.args)) {
      continue;
    }
    const urlIndex = server.args.findIndex((arg) => String(arg) === '--url');
    if (urlIndex !== -1 && server.args[urlIndex + 1]) {
      return String(server.args[urlIndex + 1]);
    }
  }
  return '';
}

function extractConfiguredMcpToken(config, serverName = DEFAULT_SERVER_NAME) {
  return extractConfiguredMcpAuth(config, serverName).token;
}

function extractConfiguredMcpAuth(config, serverName = DEFAULT_SERVER_NAME) {
  const candidates = [config?.servers?.[serverName], config?.mcpServers?.[serverName]].filter(Boolean);
  for (const server of candidates) {
    const env = server?.env && typeof server.env === 'object' ? server.env : null;
    if (!env) {
      continue;
    }
    const token = String(env[DEFAULT_MCP_TOKEN_ENV] || '').trim();
    if (token && !token.includes('${env:')) {
      return { envName: DEFAULT_MCP_TOKEN_ENV, token };
    }
    const apiKey = String(env[DEFAULT_API_KEY_ENV] || '').trim();
    if (apiKey && !apiKey.includes('${env:')) {
      return { envName: DEFAULT_API_KEY_ENV, token: apiKey };
    }
  }
  return { envName: DEFAULT_MCP_TOKEN_ENV, token: '' };
}

function requestJSON(url, { headers = {}, body, timeout = 8000 } = {}) {
  const parsed = new URL(url);
  const transport = parsed.protocol === 'https:' ? https : http;
  const payload = body ? Buffer.from(JSON.stringify(body)) : null;

  return new Promise((resolve, reject) => {
    const req = transport.request(parsed, {
      method: payload ? 'POST' : 'GET',
      headers: {
        Accept: 'application/json, text/event-stream',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) } : {}),
        ...headers,
      },
      timeout,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8').trim();
        let json = null;
        if (text) {
          try {
            json = JSON.parse(text);
          } catch (_) {
            // Keep raw text for diagnostics below.
          }
        }
        resolve({ statusCode: res.statusCode || 0, headers: res.headers, text, json });
      });
    });

    req.on('timeout', () => req.destroy(new Error(`request timed out after ${timeout}ms`)));
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function validateMcpConnection({ url, apiKey, header = 'apikey', timeout = 8000 }) {
  const checks = [];
  const clientName = 'OzyBaseNPMDoctor/1.0';
  const headers = {
    [header]: apiKey,
    'X-Client-Name': clientName,
  };

  const initializePayload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      clientInfo: { name: clientName, version: '1.0.0' },
    },
  };

  try {
    const initialize = await requestJSON(url, { headers, body: initializePayload, timeout });
    const ok = initialize.statusCode >= 200 && initialize.statusCode < 300 && initialize.json && !initialize.json.error;
    checks.push({ name: 'mcpInitialize', ok, detail: ok ? 'JSON-RPC initialize accepted' : `HTTP ${initialize.statusCode}: ${initialize.json?.error?.message || initialize.text || 'no response body'}` });
    if (!ok) {
      return { ok: false, status: 'failed', checks };
    }
  } catch (error) {
    checks.push({ name: 'mcpInitialize', ok: false, detail: error.message });
    return { ok: false, status: 'failed', checks };
  }

  const toolsPayload = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
  try {
    const tools = await requestJSON(url, { headers, body: toolsPayload, timeout });
    const pendingApproval = tools.statusCode === 403 && String(tools.json?.error?.message || '').toLowerCase().includes('pending approval');
    const ok = tools.statusCode >= 200 && tools.statusCode < 300 && tools.json && !tools.json.error;
    checks.push({
      name: 'mcpToolsList',
      ok: ok || pendingApproval,
      detail: ok
        ? `${Array.isArray(tools.json?.result?.tools) ? tools.json.result.tools.length : 0} tools available`
        : pendingApproval
          ? 'agent session registered; approval required in OzyBase'
          : `HTTP ${tools.statusCode}: ${tools.json?.error?.message || tools.text || 'no response body'}`,
    });
    if (!ok && !pendingApproval) {
      return { ok: false, status: 'failed', checks };
    }
  } catch (error) {
    checks.push({ name: 'mcpToolsList', ok: false, detail: error.message });
    return { ok: false, status: 'failed', checks };
  }

  const healthPayload = { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'system.health', arguments: {} } };
  try {
    const health = await requestJSON(url, { headers, body: healthPayload, timeout });
    const message = String(health.json?.error?.message || health.json?.error || health.text || '').toLowerCase();
    const pendingApproval = health.statusCode === 403 && (message.includes('pending approval') || message.includes('forbidden'));
    const ok = health.statusCode >= 200 && health.statusCode < 300 && health.json && !health.json.error && !health.json?.result?.isError;
    checks.push({
      name: 'mcpToolCall',
      ok: ok || pendingApproval,
      detail: ok
        ? 'system.health executed through tools/call'
        : pendingApproval
          ? 'execution requires agent approval in OzyBase'
          : `HTTP ${health.statusCode}: ${health.json?.error?.message || health.json?.error || health.text || 'no response body'}`,
    });
    return { ok: ok || pendingApproval, status: pendingApproval ? 'pending_approval' : 'connected', checks };
  } catch (error) {
    checks.push({ name: 'mcpToolCall', ok: false, detail: error.message });
    return { ok: false, status: 'failed', checks };
  }
}

function printConnectionValidation(result, apiKeyEnv) {
  printPanel('MCP Connection Validation', [
    ['Status', result.status],
    ...result.checks.map((check) => [check.name, `${check.ok ? 'OK' : 'ERR'} ${check.detail}`]),
  ], result.status === 'pending_approval'
    ? color('yellow', 'Next: approve the new MCP agent in OzyBase, then reload your editor MCP session.')
    : result.ok
      ? color('green', 'MCP backend handshake is healthy. Reload the editor if Agent Forge still shows disconnected.')
      : color('yellow', `Check ${apiKeyEnv}, backend availability, and the MCP URL.`));
}

async function authorizeMcpDevice({ urlInfo, workspaceRoot, editor, securityLevel, dashboardURL, quiet = false }) {
  const start = await requestJSON(deviceEndpoint(urlInfo.url, 'start'), {
    body: {
      workspace_path: workspaceRoot,
      mcp_url: urlInfo.url,
      dashboard_url: dashboardURL,
      client: 'ozybase-npm',
      editor,
      security_level: securityLevel || 'Restricted',
      requested_scopes: ['mcp:tools', 'mcp:skills'],
    },
    timeout: 8000,
  });
  if (start.statusCode < 200 || start.statusCode >= 300 || !start.json?.device_code) {
    throw new Error(`device authorization start failed: ${start.json?.error || start.text || `HTTP ${start.statusCode}`}`);
  }

  const deviceCode = String(start.json.device_code);
  const verificationURI = String(start.json.verification_uri || '');
  const interval = Math.max(1, Number(start.json.interval || 2));
  const expiresIn = Math.max(30, Number(start.json.expires_in || 600));
  if (!quiet) {
    printPanel('Authorize In OzyBase Dashboard', [
      ['User code', String(start.json.user_code || '')],
      ['Dashboard', verificationURI],
      ['Expires in', `${expiresIn}s`],
    ], color('yellow', 'Approve the request in your browser to issue a dedicated MCP token.'));
  }
  if (verificationURI) {
    openBrowser(verificationURI);
  }

  const deadline = Date.now() + expiresIn * 1000;
  const startedAt = Date.now();
  let attempts = 0;
  let lastNoticeAt = 0;
  if (!quiet) {
    console.log(`${color('yellow', 'Waiting')} Dashboard approval pending...`);
  }
  while (Date.now() < deadline) {
    if (attempts > 0) {
      await new Promise((resolve) => setTimeout(resolve, interval * 1000));
    }
    attempts += 1;
    const status = await requestJSON(`${deviceEndpoint(urlInfo.url, 'status')}?device_code=${encodeURIComponent(deviceCode)}`, { timeout: 8000 });
    if (status.statusCode < 200 || status.statusCode >= 300 || !status.json) {
      if (!quiet && Date.now() - lastNoticeAt >= 10000) {
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        console.log(`${color('yellow', 'Waiting')} approval pending (${elapsed}s elapsed, attempt ${attempts})`);
        lastNoticeAt = Date.now();
      }
      continue;
    }
    const state = String(status.json.status || '').toLowerCase();
    if (state === 'approved' && status.json.mcp_token) {
      if (!quiet) {
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        console.log(`${color('green', 'Approved')} MCP token issued after ${elapsed}s.`);
      }
      return {
        token: String(status.json.mcp_token),
        tokenPrefix: String(status.json.token_prefix || ''),
        apiKeyID: String(status.json.api_key_id || ''),
      };
    }
    if (state === 'rejected') {
      throw new Error('MCP authorization rejected in OzyBase dashboard');
    }
    if (state === 'expired') {
      throw new Error('MCP authorization expired before approval');
    }
    if (!quiet && Date.now() - lastNoticeAt >= 10000) {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      console.log(`${color('yellow', 'Waiting')} approval status: ${state || 'pending'} (${elapsed}s elapsed, attempt ${attempts})`);
      lastNoticeAt = Date.now();
    }
  }
  throw new Error('MCP authorization timed out before approval');
}

function mergeMcpConfig(config, blockName, serverName, serverConfig) {
  const next = config && typeof config === 'object' && !Array.isArray(config) ? { ...config } : {};
  const block = next[blockName] && typeof next[blockName] === 'object' && !Array.isArray(next[blockName])
    ? { ...next[blockName] }
    : {};

  block[serverName] = serverConfig;
  next[blockName] = block;
  return next;
}

function scaffoldSkills(workspaceRoot, force = false) {
  const skillsDir = path.join(workspaceRoot, '.agents', 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });

  const packagePath = path.join(skillsDir, 'package.json');
  if (force || !fs.existsSync(packagePath)) {
    writeJsonStable(packagePath, {
      name: 'ozybase-skills',
      version: '1.0.0',
      description: 'OzyBase MCP Skills',
      private: true,
      dependencies: {},
    });
  }

  const skillPath = path.join(skillsDir, 'hello-world.json');
  if (force || !fs.existsSync(skillPath)) {
    writeJsonStable(skillPath, {
      id: 'hello-world',
      name: 'Hello World',
      version: '1.0.0',
      description: 'A sample OzyBase skill to get started.',
      permissions: ['neural_access'],
      main: 'index.js',
    });
  }

  return skillsDir;
}

function ensureGitignoreEntry(workspaceRoot, entry) {
  const gitignorePath = path.join(workspaceRoot, '.gitignore');
  const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
  const lines = existing.split(/\r?\n/).map((line) => line.trim());
  if (lines.includes(entry)) {
    return false;
  }
  const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(gitignorePath, `${prefix}${entry}\n`, 'utf8');
  return true;
}

async function runInit(args, mode = 'init') {
  const options = parseOptions(args, {
    url: 'value',
    editor: 'value',
    name: 'value',
    header: 'value',
    'api-key-env': 'value',
    'security-level': 'value',
    'dashboard-url': 'value',
    cwd: 'value',
  });

  const url = String(options.url || '').trim();
  if (!url && !options['dry-run']) {
    throw new Error('Missing --url. Example: ozybase init --url https://YOUR_DOMAIN/api/project/mcp');
  }
  const urlInfo = analyzeMcpUrl(url || DEFAULT_MCP_URL);

  const workspaceRoot = findWorkspaceRoot(options.cwd || process.cwd(), Boolean(options.cwd));
  const configPath = path.join(workspaceRoot, '.vscode', 'mcp.json');
  const current = readJsonIfExists(configPath);
  if (current.error && !options.force) {
    throw new Error(`Invalid JSON in ${configPath}. Fix it or run with --force to replace it.`);
  }

  const serverName = String(options.name || DEFAULT_SERVER_NAME).trim() || DEFAULT_SERVER_NAME;
  const editor = String(options.editor || 'auto').trim().toLowerCase();
  const dashboardURL = String(options['dashboard-url'] || '').trim().replace(/\/+$/, '');
  const blockName = detectMcpBlock(current.data || {}, workspaceRoot, editor);
  const apiKeyEnv = String(options['api-key-env'] || (options.manual ? DEFAULT_API_KEY_ENV : DEFAULT_MCP_TOKEN_ENV)).trim() || DEFAULT_MCP_TOKEN_ENV;
  const shouldScaffoldSkills = Boolean(options.skills || mode === 'repair');

  if (options['dry-run']) {
    const payload = {
      workspaceRoot,
      configPath,
      blockName,
      serverName,
      skillsDir: shouldScaffoldSkills ? path.join(workspaceRoot, '.agents', 'skills') : null,
      confirmationRequired: !options.yes,
      deviceAuthorization: !options.manual,
      dashboardURL: dashboardURL || null,
      urlInfo,
      config: mergeMcpConfig(current.error ? {} : current.data, blockName, serverName, buildMcpServer({
        url: urlInfo.url,
        header: String(options.header || 'apikey').trim() || 'apikey',
        apiKeyEnv,
      })),
    };
    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      printHeader();
      printPanel('Planned MCP Setup', [
        ['MCP origin', urlInfo.origin],
        ['Endpoint', urlInfo.url],
        ['Workspace', workspaceRoot],
        ['Config file', configPath],
        ['MCP block', `${blockName}.${serverName}`],
        ['Skills', shouldScaffoldSkills ? payload.skillsDir : 'not requested'],
        ['Auth flow', options.manual ? 'manual env variable' : 'dashboard device authorization'],
        ['Dashboard', dashboardURL || urlInfo.origin],
        ['Confirmation', options.yes ? 'skipped with --yes' : 'browser approval required'],
      ], urlInfo.warnings.length > 0 ? color('yellow', urlInfo.warnings.join(' ')) : color('green', 'Endpoint checks passed.'));
    }
    return;
  }

  if (!options.yes) {
    await waitForBrowserConfirmation({
      workspaceRoot,
      configPath,
      blockName,
      serverName,
      apiKeyEnv,
      urlInfo,
    });
  }

  let issuedToken = '';
  let issuedTokenMeta = null;
  if (!options.manual) {
    issuedTokenMeta = await authorizeMcpDevice({
      urlInfo,
      workspaceRoot,
      editor,
      securityLevel: String(options['security-level'] || 'Restricted'),
      dashboardURL,
      quiet: Boolean(options.json),
    });
    issuedToken = issuedTokenMeta.token;
  }

  const serverConfig = buildMcpServer({
    url: urlInfo.url,
    header: String(options.header || 'apikey').trim() || 'apikey',
    apiKeyEnv,
    token: issuedToken,
  });
  const nextConfig = mergeMcpConfig(current.error ? {} : current.data, blockName, serverName, serverConfig);

  writeJsonStable(configPath, nextConfig);
  let gitignoreUpdated = false;
  if (issuedToken) {
    gitignoreUpdated = ensureGitignoreEntry(workspaceRoot, '.vscode/mcp.json');
  }
  let skillsDir = null;
  if (shouldScaffoldSkills) {
    skillsDir = scaffoldSkills(workspaceRoot, Boolean(options.force));
  }

  if (options.json) {
    console.log(JSON.stringify({ ok: true, workspaceRoot, configPath, blockName, serverName, skillsDir }, null, 2));
    return;
  }

  const apiKey = issuedToken || String(process.env[apiKeyEnv] || '').trim();
  let connectionResult = null;
  if (apiKey) {
    connectionResult = await validateMcpConnection({
      url: urlInfo.url,
      apiKey,
      header: String(options.header || 'apikey').trim() || 'apikey',
    });
  }

  printHeader();
  printPanel('Installed Configuration', [
    ['MCP origin', urlInfo.origin],
    ['Config file', configPath],
    ['Registered', `${blockName}.${serverName}`],
    ['Skills', skillsDir || 'not requested'],
    ['API key source', apiKeyEnv],
    ['MCP token', issuedTokenMeta?.tokenPrefix || (issuedToken ? 'issued' : 'not issued')],
    ['Git ignore', gitignoreUpdated ? '.vscode/mcp.json added' : issuedToken ? '.vscode/mcp.json already ignored' : 'not needed'],
  ], apiKey
    ? `${color('green', 'Next')} Reload your editor MCP session after reviewing the validation below.`
    : `${color('yellow', 'Next')} Set ${apiKeyEnv} in your editor environment, then run: npx -y ozybase@latest doctor --connect`);
  if (connectionResult) {
    printConnectionValidation(connectionResult, apiKeyEnv);
  }
}

function collectDoctorState(args) {
  const options = parseOptions(args, { cwd: 'value', url: 'value', 'api-key-env': 'value', header: 'value' });
  const workspaceRoot = findWorkspaceRoot(options.cwd || process.cwd(), Boolean(options.cwd));
  const configPath = path.join(workspaceRoot, '.vscode', 'mcp.json');
  const config = readJsonIfExists(configPath);
  const checks = [];

  try {
    const binaryPath = resolveBinaryPath();
    checks.push({ name: 'binary', ok: true, detail: binaryPath });
  } catch (error) {
    checks.push({ name: 'binary', ok: false, detail: error.message });
  }

  checks.push({ name: 'workspace', ok: true, detail: workspaceRoot });
  checks.push({ name: 'mcpConfigExists', ok: config.exists, detail: configPath });
  checks.push({ name: 'mcpConfigJson', ok: !config.error, detail: config.error ? config.error.message : 'valid JSON' });

  const data = config.error ? {} : config.data;
  const hasServers = Boolean(data && data.servers && data.servers[DEFAULT_SERVER_NAME]);
  const hasMcpServers = Boolean(data && data.mcpServers && data.mcpServers[DEFAULT_SERVER_NAME]);
  checks.push({ name: 'ozybaseMcpEntry', ok: hasServers || hasMcpServers, detail: hasServers ? 'servers.ozybase' : hasMcpServers ? 'mcpServers.ozybase' : 'missing' });

  const skillsDir = path.join(workspaceRoot, '.agents', 'skills');
  checks.push({ name: 'skillsDir', ok: fs.existsSync(skillsDir), detail: skillsDir });
  const configuredURL = config.error ? '' : extractConfiguredMcpURL(config.data, DEFAULT_SERVER_NAME);
  const configuredAuth = config.error ? { envName: DEFAULT_MCP_TOKEN_ENV, token: '' } : extractConfiguredMcpAuth(config.data, DEFAULT_SERVER_NAME);
  const apiKeyEnv = String(options['api-key-env'] || configuredAuth.envName || DEFAULT_MCP_TOKEN_ENV).trim() || DEFAULT_MCP_TOKEN_ENV;
  const configuredToken = configuredAuth.token;
  const url = String(options.url || configuredURL || '').trim();
  const hasAuth = Boolean(process.env[apiKeyEnv] || configuredToken);
  checks.push({ name: 'mcpURL', ok: Boolean(url), detail: url || 'missing' });
  checks.push({ name: apiKeyEnv, ok: hasAuth, detail: process.env[apiKeyEnv] ? 'set in environment' : configuredToken ? 'set in MCP config' : 'not set' });

  return { workspaceRoot, configPath, checks, url, apiKeyEnv, configuredToken, header: String(options.header || 'apikey').trim() || 'apikey' };
}

async function runDoctor(args) {
  const options = parseOptions(args, { cwd: 'value', url: 'value', 'api-key-env': 'value', header: 'value' });
  const state = collectDoctorState(args);
  let connectionResult = null;
  if (options.connect) {
    const apiKey = String(process.env[state.apiKeyEnv] || state.configuredToken || '').trim();
    if (state.url && apiKey) {
      connectionResult = await validateMcpConnection({ url: state.url, apiKey, header: state.header });
    } else {
      connectionResult = {
        ok: false,
        status: 'skipped',
        checks: [
          { name: 'mcpConnectReady', ok: false, detail: state.url ? `${state.apiKeyEnv} is not set` : 'MCP URL is missing' },
        ],
      };
    }
  }
  const ok = state.checks.every((check) => check.ok || check.name === state.apiKeyEnv || check.name === 'skillsDir') && (!connectionResult || connectionResult.ok);

  if (options.json) {
    console.log(JSON.stringify({ ok, ...state, connection: connectionResult }, null, 2));
  } else {
    printHeader();
    printPanel('Workspace', [
      ['Root', state.workspaceRoot],
      ['MCP config', state.configPath],
      ['MCP URL', state.url || 'missing'],
    ]);
    console.log(color('bold', 'Checks'));
    for (const check of state.checks) {
      console.log(`${statusLabel(check.ok)} ${color('gray', check.name.padEnd(18))} ${check.detail}`);
    }
    if (!process.env[state.apiKeyEnv]) {
      console.log('');
      console.log(`${color('yellow', 'Note')} ${state.apiKeyEnv} is required when the MCP bridge runs.`);
    }
    if (connectionResult) {
      console.log('');
      printConnectionValidation(connectionResult, state.apiKeyEnv);
    }
  }

  if (!ok) {
    process.exitCode = 1;
  }
}

function runBinary(args) {
  let binaryPath;
  try {
    binaryPath = resolveBinaryPath();
  } catch (error) {
    printError(error);
    console.error(`${color('gray', 'Hint')} Rebuild binaries before publishing (see README.md).`);
    process.exit(1);
  }

  const child = spawn(binaryPath, args, {
    stdio: 'inherit',
    windowsHide: true,
  });

  child.on('error', (err) => {
    printError(new Error(`Failed to launch binary: ${err.message}`));
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

async function run() {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    if (!command || command === 'help' || command === '--help' || command === '-h') {
      printUsage();
      return;
    }
    if (command === 'connect') {
      await runInit(args.slice(1));
      return;
    }
    if (command === 'init') {
      await runInit(args.slice(1));
      return;
    }
    if (command === 'repair') {
      await runInit(args.slice(1), 'repair');
      return;
    }
    if (command === 'doctor') {
      await runDoctor(args.slice(1));
      return;
    }
    if (command === 'version' || command === '--version' || command === '-v') {
      const result = spawnSync(resolveBinaryPath(), ['version'], { encoding: 'utf8' });
      if (result.error) {
        throw result.error;
      }
      process.stdout.write(result.stdout || '');
      process.stderr.write(result.stderr || '');
      process.exit(result.status ?? 0);
    }

    runBinary(args);
  } catch (error) {
    printError(error);
    process.exit(1);
  }
}

run();
