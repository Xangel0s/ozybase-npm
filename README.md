# ozybase (npm wrapper)

Paquete npm para distribuir el binario de OzyBase como comando `ozybase` y habilitar MCP STDIO:

```bash
ozybase mcp bridge --url https://TU_DOMINIO/api/project/mcp
```

## Estructura

- `index.js`: wrapper cross-platform que ejecuta el binario correcto.
- `bin/`: binarios empaquetados por OS/arquitectura.
- `scripts/build-binaries.js`: compila binarios multi-plataforma desde el código Go.

## Binarios incluidos

Este paquete se publica con binarios precompilados:
- `bin/ozybase-win-x64.exe`
- `bin/ozybase-linux-x64`
- `bin/ozybase-darwin-x64`
- `bin/ozybase-darwin-arm64`

## Verificar paquete antes de publicar

```bash
npm run pack:dry
```

## Publicar a npm

```bash
npm login
npm publish
```

## Uso en Antigravity/Cursor/Windsurf

```json
{
  "mcpServers": {
    "ozybase": {
      "command": "npx",
      "args": [
        "-y",
        "ozybase",
        "mcp",
        "bridge",
        "--url",
        "https://TU_DOMINIO/api/project/mcp"
      ],
      "env": {
        "OZYBASE_API_KEY": "TU_SERVICE_ROLE_KEY"
      }
    }
  }
}
```

## Seguridad

- Nunca hardcodees `service_role` dentro de scripts/archivos del repo.
- Usa `env` (`OZYBASE_API_KEY`) en configuración MCP.
