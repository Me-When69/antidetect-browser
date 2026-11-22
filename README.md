# Antidetect Browser

A desktop application for managing multiple isolated browser profiles built for agencies, QA testing, and e-commerce teams. Features a dark-themed UI, **Chrome (CDP)** and **Firefox (Camoufox)** drivers, authenticated proxy management, automatic IP-matched geolocation/timezone overrides, and a real-time fingerprint consistency checker.

---

## Key Features

- **Strict Profile Isolation:** Every profile runs with its own `user-data-dir` (`data/profiles/<id>`), keeping cookies, localStorage, and login sessions completely separated.
- **Dual Browser Drivers:**
  - **ChromeDriver (Playwright + CDP):** Overrides timezone, locale, geolocation, and `Accept-Language` via CDP and exposes a live `wsEndpoint` for automation.
  - **CamoufoxDriver (Firefox):** Passes fingerprint configuration through Camoufox's API (automatically falls back to Playwright Firefox if a custom Camoufox binary is not configured).
- **Full Proxy Management:**
  - Supports `HTTP`, `HTTPS`, and `SOCKS5` proxies with or without authentication (automatically spins up a local tunnel via `proxy-chain` for `user:pass` proxies).
  - Quick paste (`host:port:user:pass` or URL), reusable Proxy Vault, and encrypted password storage via Electron `safeStorage`.
  - Live exit IP, country, city, timezone, and latency check directly inside the profile form.
- **Consistent Fingerprinting & Leak Protection:**
  - 36 realistic device presets (Windows / macOS / Linux) keeping User-Agent, OS, Client Hints, WebGL GPU, screen resolution, CPU/RAM, and OS fonts aligned.
  - Deterministic per-profile Canvas & Audio noise seeds with native-looking `Function.prototype.toString` masking (`[native code]`).
  - Three WebRTC modes: `Replace` (hides local IP), `Disable`, and `Real`.
- **Real-Time Identity Consistency Checker:** Scores profile consistency (0–100), flags mismatches (UA/OS, GPU/OS, Fonts/OS, WebRTC `Real` with proxy, Timezone/Language vs. exit IP), and provides one-click **Auto Fix**.
- **Bulk Management & Cookies:** Bulk start, stop, folder assignment, and deletion; batch-create 1–200 profiles with pasted proxy lists; import/export cookies in **JSON** and **Netscape** formats.
- **Local REST API (`127.0.0.1`):** Automate profile lifecycle with Playwright or Puppeteer using an API key.
- **i18n & Backup:** Built-in Vietnamese / English UI toggle, JSON backup/restore, and support log export.

---

## Prerequisites

- **Node.js** >= 20 (LTS 22 or 24 recommended)
- **Git**
- **Google Chrome** or **Microsoft Edge** installed locally (or download Chromium via `npx playwright-core install chromium`)

---

## Installation & Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/Me-When69/antidetect-browser.git
cd antidetect-browser

# 2. Install dependencies
npm install

# 3. Launch in development mode
npm run dev
```

> **Note for first-time launch:** If Electron reports a native module ABI mismatch for `better-sqlite3` (when your system Node version differs from Electron's embedded Node), run:
> ```bash
> npx @electron/rebuild -f -w better-sqlite3
> ```
> Then run `npm run dev` again.

---

## Usage Guide

### 1. Create & Launch a Profile
1. Click **+ New Profile** in the left sidebar.
2. **Identity:** Enter a profile name (or click **Random**), assign a folder, status, and tags.
3. **Environment:** Pick a platform (**Windows / macOS / Linux**) and browser (**Chrome** or **Firefox Camoufox**). A consistent device preset is generated automatically, or click **New Fingerprint** anytime.
4. **Proxy:** Pick from your Proxy Vault or paste `host:port:user:pass` into the quick-paste box and click **Apply**.
5. **Identity Check (right panel):**
   - Click **Check Exit IP** to verify IP, location, timezone, and latency.
   - If any warnings appear (e.g., WebRTC set to `Real` while using a proxy, or timezone mismatch), click **Auto Fix** to align everything automatically.
6. Click **Create** to save, or **Create & Run** to launch immediately.

### 2. Proxy Vault & Folders
- Open **Proxies** to store shared proxies, test live IP/latency, and reuse them across profiles.
- Open **Folders** to organize profiles by project or client and filter them quickly from **All Profiles**.

### 3. Bulk Operations & Cookies
- On **All Profiles**, click **Bulk Create** to generate 1–200 profiles from a template and paste one proxy per line.
- Select multiple rows to reveal the bulk toolbar (**Start Selected / Stop Selected / Assign Folder / Delete Selected**).
- Click the **Cookie** icon on any profile row to import or export cookies in `JSON` or `Netscape` format.

### 4. Local REST API (Automation)
1. Go to **Settings → Local REST API (127.0.0.1)**, enable the API, and copy your **API Key**.
2. Full endpoint documentation is available in [docs/LOCAL_API.md](docs/LOCAL_API.md).
3. Run the included Playwright example:
   ```powershell
   $env:API_KEY="ad_your_api_key"
   $env:PROFILE_ID="your-profile-uuid"
   node examples/playwright-connect.mjs
   ```

### 5. Firefox / Camoufox Driver
- Select **Firefox (Camoufox)** when creating a profile.
- If you have a standalone Camoufox binary, set its path under **Settings → Custom Browser Binaries**. Otherwise, it automatically falls back to Playwright's Firefox (`npx playwright-core install firefox`).

### 6. Backup, Restore & Support Logs
- Go to **Settings → Backup & Support**:
  - **Export JSON Backup:** Save all profiles, folders, tags, and proxies to a `.json` file.
  - **Import JSON Backup:** Restore data on another machine.
  - **Export Support Logs:** Download recent application logs for troubleshooting.

---

## Testing & Packaging

```bash
# TypeScript strict typecheck
npm run typecheck

# ESLint check
npm run lint

# Run unit tests (Vitest)
npm run test

# Production build
npm run build

# Build Windows installer (.exe NSIS)
npm run dist:win

# Build macOS installer (.dmg)
npm run dist:mac
```

---

## Project Structure

```text
antidetect-browser/
├─ electron/
│  ├─ main.ts                   # Electron window & IPC handler registration
│  ├─ preload.ts                # Typed contextIsolation IPC bridge
│  ├─ db/                       # SQLite (better-sqlite3) + Drizzle schema
│  └─ services/
│     ├─ profileService.ts      # Profile, folder, tag, bulk & backup CRUD
│     ├─ proxyService.ts        # Proxy vault, proxy-chain & IP/geo checks
│     ├─ launcher.ts            # Process lifecycle & cookie management
│     ├─ localApi.ts            # Local REST API server (127.0.0.1)
│     ├─ drivers/               # BrowserDriver, ChromeDriver, CamoufoxDriver
│     └─ fingerprint/           # presets.json (36 devices), generator, injector
├─ shared/                      # Types, Zod schemas, IPC contract & identity checker
├─ src/                         # React UI (Tailwind + shadcn/ui + Zustand + i18n)
├─ docs/                        # Local REST API reference
├─ examples/                    # Playwright & Puppeteer connection scripts
└─ tests/                       # Vitest automated test suite
```

---

## Contributors

- [@Me-When69](https://github.com/Me-When69)
- [@Zewieee](https://github.com/Zewieee)

## Legal Notice

This tool is intended for legitimate multi-account management, agency workflows, QA, and software testing. Users are responsible for complying with applicable laws and the terms of service of any platform they access.
