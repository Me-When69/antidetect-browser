# Changelog

All notable changes to **Facet** are documented in this file.

## [v0.3.0] - 2026-11-23

### Added

- **Safe Rename & Crash-Safe Data Migration (PHA 0b / 1.9.1)**: Renamed package to `facet` / `productName: Facet` with idempotent, per-file SHA-256 verified one-time migration (`electron/services/dataMigration.ts`, `docs/DATA_MIGRATION.md`) preserving legacy `antidetect-app` userData intact, plus `SecretService` legacy storage fallback (`reencryptIfLegacy`).
- **Default Encrypted Profile Backups (PHA 1.2)**: Added `FACET_BKP` v1 (`AES-256-GCM + scrypt N=32768 + AAD`) default encryption for profile backup export/import, optional proxy credential stripping, and backward-compatible legacy plaintext JSON import.
- **Gmail OAuth Token Revocation (PHA 1.3)**: Added one-click OAuth revocation (`GMAIL_REVOKE`) calling Google's revoke endpoint while always deleting local tokens in `vault.db` even when offline.
- **In-App `.facet-eml` Extractor & Format Spec (PHA 1.9.3)**: Added `docs/FACET_EML_FORMAT.md` and "Giải nén sao lưu thư (.facet-eml)" UI/IPC (`GMAIL_EXTRACT_ARCHIVE`) with path-traversal sanitization.
- **CI, Supply Chain & Static Hardening (PHA 0 / 1.7 / 1.8 / 1.9.2)**: Added `.github/dependabot.yml`, `.github/workflows/codeql.yml`, SHA-pinned GitHub Actions, `npm audit --omit=dev --audit-level=high` CI gate, `npm run check:paths`, `npm run check:secrets`, `npm run check:static` (forbidding `ELECTRON_RUN_AS_NODE` / `child_process.fork`), `scripts/smoke-packaged.mjs`, `SECURITY_REVIEW.md`, and `docs/MAINTENANCE.md`.

### Changed

- **Electron 45.4.1 & Vitest 5.1.1 (PHA 1.5 / 1.6)**: Upgraded Electron from EOL `36.9.5` to `45.4.1` (Node 24, Chromium 156, supported until 2027-04-27) and `vitest` / `@vitest/coverage-v8` to `5.1.1`; updated `ClipboardGuard` for Electron 45 async `clipboard.readText()`.
- **BrowserInstaller Utility Process (PHA 1.9.2)**: Replaced `spawn(process.execPath, ..., { ELECTRON_RUN_AS_NODE: '1' })` with Electron `utilityProcess.fork` for full compatibility with `RunAsNode=false` Fuse, and fixed `electron-builder.yml` exclusion glob (`!docs/**` instead of `!**/docs/**`) so `googleapis` loads cleanly inside `app.asar`.
- **Coverage Floor (PHA 1.9.4)**: Enforced `46.12%` statement coverage floor in `vitest.config.ts` and expanded unit suite to 88 tests (`46.20%` statements).

### Security

- **0 Production Vulnerabilities (PHA 1.4)**: Replaced `archiver` + `archiver-zip-encrypted` with zero-dependency `.facet-eml` (`node:crypto` AES-256-GCM + `node:zlib` gzip + `scrypt`), bringing `npm audit --omit=dev` to **0 vulnerabilities** and total `npm audit` to **0 critical, 0 high**.
- **Production Electron Fuses (PHA 1.6)**: Enabled all 6 production Fuses via `scripts/apply-fuses.mjs` (`RunAsNode=false`, `EnableCookieEncryption=true`, `EnableNodeOptionsEnvironmentVariable=false`, `EnableNodeCliInspectArguments=false`, `EnableEmbeddedAsarIntegrityValidation=true`, `OnlyLoadAppFromAsar=true`).

### Breaking

- **Legacy `.zip` Email Archives (`v0.2.0`)**: Encrypted `.zip` email archives created in `v0.2.0` (via `archiver-zip-encrypted`) are no longer created or extracted directly inside Facet `v0.3.0`. Selecting a legacy `.zip` file shows a clear notice guiding users to extract it with **7-Zip** or **WinRAR** using the original password; new encrypted backups use `.facet-eml` and can be extracted directly inside Facet.
- **Node.js Engine**: Minimum `engines.node` raised from `>=20.0.0` to `>=22.0.0` (CI runs Node 24 matching Electron 45).
- **macOS / Linux `safeStorage` Note**: On Windows (DPAPI), `v0.2.0` proxy passwords decrypt automatically after the rename to `Facet`. macOS Keychain and Linux `libsecret` have not yet been verified on physical hardware; see `docs/DATA_MIGRATION.md` for recommended backup/re-import steps.

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
