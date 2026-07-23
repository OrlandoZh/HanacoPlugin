# Obsidian Connector

This OpenHanako plugin exposes Obsidian vault operations through a REST-first connector.

Use `obsidian_rest` as the primary tool inside OpenHanako/HanaAgent. It talks to the Obsidian Local REST API plugin and avoids the native Obsidian CLI path that can crash with `SIGSEGV` in agent sandboxes.

The legacy `obsidian_cli` tool is still included for diagnosis and non-sandbox fallback use, but it should not be the default path for agent vault operations.

## Tools

### `obsidian_rest`

Primary connector for Obsidian Local REST API:

- `diagnose`
- `read`, `readJson`, `list`
- `create`, `update`, `append`, `patch`, `delete`
- `move`
- `searchSimple`

Write operations require `confirmWrite: true`. `move` uses Local REST API `MOVE /vault/*`, which goes through Obsidian's file manager and updates internal links.

Example tool inputs:

```json
{ "action": "diagnose" }
```

```json
{ "action": "read", "path": "笔记库导航.md" }
```

```json
{
  "action": "move",
  "path": "001 常用工具/Clash.md",
  "destinationPath": "R-角色/工具箱/Clash.md",
  "confirmWrite": true
}
```

```json
{
  "action": "searchSimple",
  "query": "project",
  "contextLength": 80
}
```

## Configuration

The connector defaults to:

- `https://127.0.0.1:27124`
- fallback `http://127.0.0.1:27123`
- `restTransport: "auto"`: native Node HTTP first, then controlled `curl` fallback if local networking is blocked by the runtime

API key lookup order:

1. Plugin setting `restApiKey`
2. Environment variable `OBSIDIAN_REST_API_KEY`
3. Plugin setting `restApiKeyFile`
4. Environment variable `OBSIDIAN_REST_API_KEY_FILE`
5. `defaultVaultPath/.obsidian/plugins/obsidian-local-rest-api/data.json`
6. `OBSIDIAN_VAULT_PATH/.obsidian/plugins/obsidian-local-rest-api/data.json`
7. Best-effort discovery under common local vault parents such as `~/Documents` and `~/Obsidian`

`restRejectUnauthorized` defaults to `false` because Obsidian Local REST API uses a self-signed certificate by default.

### `obsidian_cli`

Legacy diagnostic fallback for the native Obsidian CLI. It auto-detects the CLI path in this order:

1. Plugin setting `obsidianBinaryPath`
2. Environment variable `OBSIDIAN_CLI_PATH`
3. The OpenHanako host process `PATH`
4. Common OS install locations

Use `command: "diagnose"` to see which path was selected. Avoid using this as the primary agent path in HanaAgent because the native Obsidian CLI may fail with `SIGSEGV` under sandboxed execution.
