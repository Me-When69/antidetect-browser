# Third-Party Licenses

Facet is licensed under the **Apache License 2.0**. Below are the licenses of direct runtime dependencies and optional external tools downloaded by the user.

## Direct Runtime Dependencies (Bundled)

| Package | License | Notes |
| :--- | :--- | :--- |
| `electron` | MIT | Desktop shell |
| `react`, `react-dom` | MIT | Renderer UI |
| `playwright-core` | Apache-2.0 | Browser automation & CDP |
| `@puppeteer/browsers` | Apache-2.0 | Official Chrome for Testing downloader |
| `better-sqlite3` | MIT | Local SQLite database |
| `drizzle-orm` | Apache-2.0 | Type-safe SQLite ORM |
| `zod` | MIT | Schema & IPC validation |
| `zustand` | MIT | Renderer state management |
| `react-hook-form`, `@hookform/resolvers` | MIT | Form management |
| `@tanstack/react-virtual` | MIT | Virtualized table rendering |
| `lucide-react` | ISC | SVG icons |
| `@fontsource/inter`, `@fontsource/space-grotesk` | SIL OFL-1.1 | Bundled offline UI fonts |
| `https-proxy-agent`, `socks-proxy-agent`, `socks`, `proxy-chain` | MIT / Apache-2.0 | Local proxy bridge & checks |
| `ssh2` | MIT | SSH SOCKS5 tunnel |
| `tz-lookup` | MIT | Offline coordinate-to-timezone lookup |

## Optional External Binaries (NOT Bundled — Downloaded On-Demand by User)

Facet **does not bundle or redistribute** the following binaries. Users may optionally download them from their official upstream releases directly onto their local machine:

- **Chrome for Testing** (Google): downloaded on-demand from official Google endpoints into the user's local `userData/browsers` directory.
- **Playwright Firefox / Camoufox**: MPL-2.0 (downloaded on-demand).
- **sing-box**: GPL-3.0 with additional terms (downloaded on-demand from official GitHub Releases by the user; executed as a separate child process, never linked or bundled).
- **xray-core**: MPL-2.0 (optional external child process).
