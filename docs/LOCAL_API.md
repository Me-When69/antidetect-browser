# Local REST API Documentation

Antidetect Browser exposes a local-only HTTP REST API bound strictly to `127.0.0.1` (default port `36912`).

## Authentication

Include your API Key (found in **Cài đặt / Settings → Local REST API**) in every request using either header:

- `x-api-key: <API_KEY>`
- `Authorization: Bearer <API_KEY>`

## Endpoints

### `GET /health`

Check server status (no auth required).

### `GET /profiles`

Returns all profiles with their current `running` state.

### `POST /profiles`

Create a new profile with auto-generated consistent fingerprint. Optional JSON body fields: `name`, `platform` (`windows|macos|linux`), `browser` (`chrome|firefox`), `proxy`, `geo`, `tags`, `notes`.

### `POST /profiles/:id/start`

Launches the profile and returns its CDP WebSocket endpoint:

```json
{
  "profileId": "uuid",
  "running": true,
  "wsEndpoint": "ws://127.0.0.1:54321/devtools/browser/..."
}
```

### `POST /profiles/:id/stop`

Stops the running profile and cleans up any local proxy tunnel.
