# Nhật ký Nâng cấp Electron `36.9.5` → `45.4.1` (PHA 1.6)

**Nhánh thực hiện:** `chore/electron-upgrade` (tag quay lui: `v0.2.0`)  
**Mục tiêu:** `electron@45.4.1` (Node `24`, Chromium `156`, hỗ trợ chính thức đến **27/04/2027**).

---

## 1. Rà soát API Electron bị ảnh hưởng (Electron 37 → 45)

Đã quét toàn bộ thư mục `electron/` bằng `git grep`:

- **API sử dụng:** `app.getPath`, `app.getName`, `app.getVersion`, `app.isPackaged`, `app.whenReady`, `BrowserWindow`, `webContents.send`, `webContents.setWindowOpenHandler`, `webContents.on('will-navigate')`, `session.defaultSession.webRequest.onHeadersReceived`, `ipcMain.handle`, `safeStorage`, `clipboard`, `shell.openExternal`, `dialog.showOpenDialog`.
- **API cũ / đã loại bỏ (`remote`, `new-window`, `nativeWindowOpen`, `webviewTag`, `ipcRenderer.sendSync`, `session.setPermissionCheckHandler` cũ):** **0 kết quả** — không có mã nguồn nào bị ảnh hưởng bởi các breaking changes loại bỏ API từ Electron 37 → 45.
- **API thay đổi gặp thực tế khi nâng cấp lên Electron 45:** `clipboard.readText()` trả về `Promise<string>` thay vì `string` đồng bộ → đã cập nhật `ClipboardAdapter` trong `electron/services/vault/clipboardGuard.ts` hỗ trợ cả `string | Promise<string>`.
- **Native module (`better-sqlite3@13.2.0`):** Kiểm tra prebuild / `@electron/rebuild` cho ABI Electron 45 (Node 24) trong bước `npm run dist:win`.
- **Playwright E2E (`_electron.launch`):** Chạy trên bản không đóng gói (chưa bật Fuses); kiểm tra tương thích `playwright-core@1.65.1` với Electron 45.

## 2. Electron Fuses cho bản đóng gói Production (`scripts/apply-fuses.mjs`)

Áp dụng trong hook `afterPack` của `electron-builder.yml` (chỉ tác động bản đóng gói `release/`, không ảnh hưởng dev & Playwright E2E):

- `RunAsNode`: `false` (chặn chạy binary Electron như Node CLI)
- `EnableCookieEncryption`: `true`
- `EnableNodeOptionsEnvironmentVariable`: `false` (chặn tiêm biến `NODE_OPTIONS`)
- `EnableNodeCliInspectArguments`: `false` (chặn `--inspect` / `--inspect-brk`)
- `EnableEmbeddedAsarIntegrityValidation`: `true` (xác thực toàn vẹn `app.asar`)
- `OnlyLoadAppFromAsar`: `true` (chỉ nạp mã nguồn từ `app.asar`)

## 3. Kết quả kiểm thử sau nâng cấp

- **Typecheck & Lint:** PASS (0 lỗi, 0 cảnh báo)
- **Unit tests:** 78/78 PASS
- **Integration tests:** PASS (bao gồm SQLite, Gmail Vault/API mock, IPv6 Pool)
- **Playwright Electron 45.4.1 E2E:** 3/3 PASS (36.7s)
- **Đóng gói `npm run dist:win` + Electron Fuses:**
  - `@electron/rebuild` tự động rebuild `better-sqlite3@13.2.0` cho ABI Electron 45.4.1 (Node 24) thành công.
  - `scripts/apply-fuses.mjs` đã áp dụng đủ 6 Fuses lên `release/win-unpacked/Facet.exe`.
  - Smoke test chạy trực tiếp `release/win-unpacked/Facet.exe`: tiến trình sống ổn định sau 4s (`exitCode` rỗng, không crash khi bật `OnlyLoadAppFromAsar` và `EnableEmbeddedAsarIntegrityValidation`).
  - Tạo thành công bộ cài `release/Facet Setup 0.2.0.exe`.
- **Kiểm tra lỗ hổng sau nâng cấp:**
  - `npm audit --omit=dev`: **0 lỗ hổng** (0 critical, 0 high, 0 moderate, 0 low).
  - `npm audit` (toàn bộ): **0 critical, 0 high**, 10 moderate (chỉ nằm trong `devDependencies`: `drizzle-kit` và `electron-builder`).
