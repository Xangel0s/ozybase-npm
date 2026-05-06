# ozybase

OzyBase npm CLI bootstraps a one-time project connection and native MCP setup for local workspaces.

## Quick Start

Run inside your project terminal:

```bash
npx ozybase connect --url https://YOUR_DOMAIN/api/project/mcp
```

The CLI will:

- detect the project root,
- show a terminal summary,
- open the browser for explicit approval,
- persist the local connection state,
- leave the IDE ready to use MCP by `stdio`.

## Commands

### `ozybase connect`

Creates the first workspace connection.

```bash
npx ozybase connect --url https://YOUR_DOMAIN/api/project/mcp
```

Useful flags:

- `--name ozybase`: MCP server name.
- `--api-key-env OZYBASE_API_KEY`: environment variable used for local auth.
- `--dashboard-url https://app.example.com`: browser approval target.
- `--yes`: skip browser approval for trusted automation.
- `--dry-run`: show what would change without writing files.
- `--json`: print machine-readable output.
- `--force`: replace invalid state JSON.

### `ozybase doctor`

Validates the local setup.

```bash
npx ozybase doctor --connect
```

Checks include:

- packaged native binary exists,
- workspace root detection,
- local connection state is valid,
- `OZYBASE_API_KEY` is available in the current environment,
- with `--connect`, a minimal MCP handshake is sent to `/api/project/mcp`.

### `ozybase repair`

Rebuilds the local connection state.

```bash
npx ozybase repair --url https://YOUR_DOMAIN/api/project/mcp
```

## Browser Confirmation

The confirmation screen is served from `127.0.0.1` and shows the exact endpoint, workspace, and local state that will be written.

## Native Passthrough

Any command not handled by the npm wrapper is passed to the packaged native binary.

```bash
npx ozybase mcp serve --url https://YOUR_DOMAIN/api/project/mcp
npx ozybase version
```

## Security

- Do not hardcode service keys in repository files.
- Prefer `OZYBASE_API_KEY` from the editor/process environment.
- Review generated local state before sharing a repository.
