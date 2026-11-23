# Changelog

All notable changes to **Facet** are documented in this file.

## [Unreleased]

### Added

- **PHA 0 Repo Hygiene & Baseline**: Added `docs/BASELINE.md`, `.gitleaks.toml`, `scripts/check-personal-paths.mjs` (`npm run check:paths`), `scripts/check-secrets.mjs` (`npm run check:secrets`), hardened `.gitignore`, and wired path/secret/format checks into CI.

## [v0.2.0] - 2026-11-23

### Added

- **Encrypted Gmail Accounts Vault**: Local `vault.db` with envelope AES-256-GCM + AAD encryption (`scrypt`), progressive lockout after 5 wrong attempts, auto-lock & DEK zeroization, RFC 6238 2FA TOTP (`otplib`), 20-second auto-clearing clipboard, 7-rule security audit, official Gmail API OAuth2 PKCE (`gmail.readonly` default, opt-in `gmail.modify`, strictly no `gmail.send`), AES-256 encrypted `.zip` email backup, profile-account linking (`profile_accounts`), and read-only importer for legacy Python/Fernet vaults.
- **Local IPv6 Pool (Windows)**: Global Unicast (`2000::/3`) `/64` prefix detection & mandatory routing verification, on-demand UAC `netsh` batch assignment (`store=active skipassource=true`) with DAD check, local authenticated `127.0.0.1` HTTP CONNECT listeners with AAAA-only kill switch, fixed per-profile IPv6 mapping, manual & rate-limited scheduled rotation (min 10 minutes, off by default), live/dead health checks, and automatic cleanup on exit.

### Security & Stability

- Prevented path traversal in `ProfileService.getProfileDir` (`E-001`).
- Enforced trusted IPC sender frame checks and Zod input validation across all 63 main-process IPC handlers (`E-002`).
- Added production `Content-Security-Policy` header, `will-navigate` origin guard, and `setWindowOpenHandler` popup denial on `BrowserWindow` (`E-003`).
- Hardened `LocalApiServer` with `Host`/`Origin` DNS-rebinding checks, `crypto.timingSafeEqual`, sliding-window rate limiting, and `proxy.password` redaction (`E-004`).
- Added clear Vietnamese diagnostics for Firefox `exitCode=0` and Chrome `ERR_PROXY_CONNECTION_FAILED` / `ERR_TUNNEL_CONNECTION_FAILED` / `ERR_QUIC_PROTOCOL_ERROR` (`E-005`).
- Enforced `DEFAULT_MAX_CONCURRENT_PROFILES = 10` in `ProfileLauncher.start()` (`E-006`) and Zod validation in `ProfileService.importBackup` (`E-008`).

## [v0.1.0] - 2026-11-23

### Added

- **Facet Open-Source Identity**: Custom 3-face hexagon SVG logo, dark & light design tokens (WCAG 2.1 ≥ 4.5:1 contrast), bundled offline **Space Grotesk** and **Inter** fonts (`latin` + `vietnamese`), and app icons (`svg`, `png`, `ico`).
- **Isolated Browser Profiles**: Create, edit, duplicate, soft-delete (Trash), bulk create/update, folders, tags, notes, color labels, expiry dates, and JSON/Netscape cookie import & export.
- **Multi-Protocol Proxy & Local Bridge**: HTTP, HTTPS, SOCKS4/4a, SOCKS5/5h (authenticated SOCKS5 via local bridge), SSH tunnel (`ssh2`), multi-hop chains (up to 3 hops), and optional on-demand `sing-box` support for Shadowsocks/VMess/VLESS/Trojan.
- **IPv6 & Auto-Geo Matching**: Multi-API proxy check (`ipapi.co`, `ip-api.com`, `ipwho.is`), IPv4/IPv6 detection, IPv6 leak check, and automatic timezone/locale/geolocation synchronization via CDP.
- **Emulated Devices & Multi-Version Browser Manager**: 47 realistic device presets across Windows, macOS, Linux, Android, and iOS; real-engine version enforcement; Chrome for Testing multi-version downloader with progress/cancel/delete and downgrade protection.
- **Advanced Profile Configuration & Presets**: Per-signal modes (`real`/`noise`/`off`) for Canvas, WebGL, Audio, ClientRects, Fonts, SpeechVoices, Battery, Port Scan Protect; deterministic Media Devices; `dataOnClose`; window sizing; bandwidth blocking & static cache; 4 built-in presets + custom preset saving.
- **Performance & Reliability**: Route code splitting (`React.lazy`), `@tanstack/react-virtual` table virtualization, SQLite WAL + 5 indexes + bulk transactions, `detectExecutableVersion` caching, log rotation with secret redaction, and `npm run perf:budget`.
- **Local REST API**: Localhost-only (`127.0.0.1`) API with generated API key for Playwright/Puppeteer/Selenium automation.
