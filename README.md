# ozybase

OzyBase npm CLI distributes the native OzyBase binary and bootstraps MCP editor integration for local workspaces.

It can be used directly with `npx`:

```bash
npx ozybase init --url https://YOUR_DOMAIN/api/project/mcp --skills
```

## What It Does

- Runs the packaged native `ozybase` binary for normal CLI commands.
- Creates or updates workspace MCP configuration.
- Auto-detects whether the workspace uses `servers` or `mcpServers`.
- Scaffolds `.agents/skills` when requested.
- Provides `doctor` and `repair` helpers for setup validation.

## Quick Start

Set your API key in the environment used by your editor:

```bash
export OZYBASE_API_KEY="YOUR_SERVICE_ROLE_KEY"
```

On Windows PowerShell:

```powershell
$env:OZYBASE_API_KEY="YOUR_SERVICE_ROLE_KEY"
```

Then run inside your project workspace:

```bash
npx ozybase init --url https://YOUR_DOMAIN/api/project/mcp --skills
```

This opens a local browser confirmation page before writing anything. After approval, it updates `.vscode/mcp.json` without deleting existing MCP servers.

## Commands

### `ozybase init`

Creates or updates MCP configuration for the current workspace.

```bash
npx ozybase init --url https://YOUR_DOMAIN/api/project/mcp
```

By default, `init` starts a temporary confirmation page on `127.0.0.1` and opens your browser. The page shows the MCP origin, protocol, workspace path, config file, MCP block, bridge command, and security warnings before you approve.

Useful flags:

- `--skills`: scaffold `.agents/skills`.
- `--editor auto|vscode|cursor|windsurf|antigravity`: choose config shape. Default is `auto`.
- `--name ozybase`: MCP server name. Default is `ozybase`.
- `--header apikey`: auth header used by the bridge. Default is `apikey`.
- `--api-key-env OZYBASE_API_KEY`: environment variable referenced by the config.
- `--yes`: skip browser confirmation. Use only in CI or trusted automation.
- `--dry-run`: show what would change without writing files.
- `--json`: print machine-readable output.
- `--force`: replace invalid config JSON or overwrite scaffolded skill files.

Auto detection order:

1. Existing `.vscode/mcp.json` entry containing `servers.ozybase`.
2. Existing `.vscode/mcp.json` entry containing `mcpServers.ozybase`.
3. Existing `servers` or `mcpServers` block.
4. Workspace hints such as `.cursor` or `.windsurf`.
5. Fallback to `servers`.

### `ozybase doctor`

Validates the local setup.

```bash
npx ozybase doctor
```

Checks include:

- packaged native binary exists,
- workspace root detection,
- `.vscode/mcp.json` exists and is valid JSON,
- `ozybase` MCP entry exists,
- `.agents/skills` exists,
- `OZYBASE_API_KEY` is available in the current environment.

Use JSON output for automation:

```bash
npx ozybase doctor --json
```

### `ozybase repair`

Recreates or normalizes MCP configuration and scaffolds skills.

```bash
npx ozybase repair --url https://YOUR_DOMAIN/api/project/mcp --skills
```

Like `init`, `repair` requires browser confirmation unless `--yes` is provided.

## Browser Confirmation

The confirmation screen is intentionally explicit, similar to modern hosted platform CLIs:

- It is served only from `127.0.0.1` for the current CLI process.
- It displays the exact MCP domain and bridge command that will be configured.
- It warns when the endpoint is not HTTPS, except for localhost development.
- It warns when the path does not look like `/api/project/mcp`.
- It does not receive or store your `service_role` key.

For trusted non-interactive environments:

```bash
npx ozybase init --url https://YOUR_DOMAIN/api/project/mcp --skills --yes
```

### Native Passthrough

Any command not handled by the npm wrapper is passed to the packaged native binary:

```bash
npx ozybase mcp bridge --url https://YOUR_DOMAIN/api/project/mcp
npx ozybase version
```

## Generated MCP Config

Default output uses `npx` so editors can launch the bridge without a global install:

```json
{
  "servers": {
    "ozybase": {
      "command": "npx",
      "args": [
        "-y",
        "ozybase",
        "mcp",
        "bridge",
        "--url",
        "https://YOUR_DOMAIN/api/project/mcp"
      ],
      "env": {
        "OZYBASE_API_KEY": "${env:OZYBASE_API_KEY}"
      }
    }
  }
}
```

Some clients use `mcpServers` instead of `servers`; `init` detects and preserves the existing shape automatically.

## Package Structure

- `index.js`: cross-platform wrapper, MCP bootstrapper, doctor, and repair commands.
- `bin/`: packaged native binaries by OS/architecture.
- `scripts/build-binaries.js`: builds native binaries from the Go source tree.
- `scripts/validate-package.js`: validates required binaries before packaging.

## Included Binaries

- `bin/ozybase-win-x64.exe`
- `bin/ozybase-linux-x64`
- `bin/ozybase-darwin-x64`
- `bin/ozybase-darwin-arm64`

## Verify Before Publishing

```bash
npm run pack:dry
```

## Publish

```bash
npm login
npm publish
```

## Security

- Do not hardcode `service_role` keys in repository files.
- Prefer `OZYBASE_API_KEY` from the editor/process environment.
- Review `.vscode/mcp.json` before committing it to a public repository.
