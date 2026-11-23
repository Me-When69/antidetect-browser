# Facet

**Each profile, its own identity.** _(Tiếng Việt: [README.vi.md](README.vi.md))_

Facet is an open-source, local-first desktop application for managing isolated browser profiles — built with **Electron, React, TypeScript, SQLite, and playwright-core**. No backend, no account, no telemetry: all profile data, encrypted credentials, and browser directories stay on your machine.

## Key Features

- **Isolated Profiles**: Dedicated `userDataDir` per profile, folders, tags, color labels, expiry dates, Trash recovery, bulk create/update, CSV import, and JSON/Netscape cookie import/export.
- **Multi-Protocol Proxy Engine**: HTTP, HTTPS, SOCKS4/4a, SOCKS5/5h (with local bridge for authenticated SOCKS5 in Chromium), SSH tunnels, proxy chains (up to 3 hops), IPv6 support & leak check, plus optional on-demand `sing-box` core for Shadowsocks/VMess/VLESS/Trojan.
- **Auto-Geo & Consistency Checker**: Automatic timezone, locale, Accept-Language, and geolocation matching from proxy exit IP, paired with real-time identity consistency checks and one-click Auto-Fix.
- **47 Emulated Device Presets & Multi-Version Browser Manager**: Windows, macOS, Linux, Android (CDP mobile/touch emulation), and iOS presets. UA and Client Hints always match the real running engine version; download and manage multiple Chrome for Testing versions with downgrade protection.
- **Advanced Controls & Presets**: Per-signal controls (`real` / `noise` / `off`), deterministic Media Devices, `dataOnClose` cleanup, window sizing, bandwidth blocking (images, media, external fonts, ads, trackers), and 4 built-in presets (_Balanced_, _Max Privacy_, _Low Bandwidth_, _Test Real_) + custom presets.
- **Local Automation API**: Localhost-only (`127.0.0.1`) REST API with API key returning CDP `wsEndpoint` for Playwright, Puppeteer, or Selenium.
- **Encrypted Gmail Accounts Vault**: Local `vault.db` with envelope AES-256-GCM + AAD encryption (`scrypt`), 2FA TOTP (`otplib`), 20-second auto-clearing clipboard, security audit, official Gmail API OAuth2 PKCE (`gmail.readonly` default, opt-in `gmail.modify`, **never `gmail.send`**), AES-256 encrypted `.zip` email backup, profile-account linking, and legacy Python/Fernet vault import. See [docs/VAULT.md](docs/VAULT.md), [docs/GMAIL_SETUP.md](docs/GMAIL_SETUP.md), [docs/ACCEPTABLE_USE.md](docs/ACCEPTABLE_USE.md), and [CONTRIBUTING.md](CONTRIBUTING.md).
- **Local IPv6 Pool (Windows)**: Assign Global Unicast (`2000::/3`) `/64` addresses you own via on-demand UAC `netsh` batches (`store=active skipassource=true`), mandatory routing verification, fixed per-profile authenticated `127.0.0.1` HTTP CONNECT listeners with AAAA-only kill switch, live/dead health checks, and automatic cleanup on exit. See [docs/IPV6_POOL.md](docs/IPV6_POOL.md).

## Installation & Verification

Download the installer for your OS from [GitHub Releases](https://github.com/Me-When69/antidetect-browser/releases).

> **Unsigned Binary Notice:** Community builds are currently not code-signed, so **Windows SmartScreen** or **macOS Gatekeeper** may show a warning. Always verify the SHA-256 checksum against `SHA256SUMS.txt` attached to the release before running:
>
> ```powershell
> Get-FileHash .\Facet-Setup-0.1.0.exe -Algorithm SHA256
> ```

## Development

```bash
npm install
npm run dev
```

### Build & Tests

```bash
npm run validate:devices   # Validate 47 device presets
npm run typecheck          # TypeScript strict check
npm run lint               # ESLint
npm run test               # Unit tests (Vitest)
npm run test:integration   # Real-Chrome integration tests
npm run build              # Production bundle
npm run perf:budget        # Check bundle size budgets
npm run dist:win           # Build Windows NSIS installer
```

## Known Limitations

- **Emulation is a browser-level layer, not real hardware.** Canvas/WebGL rendering, physical GPU characteristics, and host OS fonts still originate from your host machine. Strong anti-bot or fingerprinting systems may still detect cross-OS or mobile emulation on desktop.
- **Confidence levels**: Same-OS desktop = **High**; Cross-OS desktop & Android CDP = **Medium**; iOS on Chromium = **Low**.
- **Maintenance**: Maintained on a best-effort basis.

## Responsible Use

Facet is built for **QA testing, localization verification, privacy research, and managing your own legitimate accounts**. Do not use Facet for fraud, spam, abuse, or violating third-party terms of service. We do not build or accept contributions for CAPTCHA solving/bypassing or automated bulk account creation. Provided **"AS IS"** without warranty under the [Apache License 2.0](LICENSE).
