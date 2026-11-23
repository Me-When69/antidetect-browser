# Changelog

All notable changes to **Facet** are documented in this file.

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
