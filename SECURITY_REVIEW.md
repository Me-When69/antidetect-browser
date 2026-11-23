# Báo cáo Rà soát Bảo mật — Facet (Sau PHA 0b & PHA 1)

**Ngày rà soát:** 2026-11-23  
**Nhánh:** `chore/electron-upgrade` (trên nền tag `v0.2.0`)  
**Runtime:** Electron `45.4.1` (Node `24`, Chromium `156`, hỗ trợ đến `27/04/2027`)

---

## 1. Tóm tắt Kết quả Kiểm toán Tự động

| Hạng mục kiểm tra                       | Kết quả                | Chi tiết                                                                                                          |
| :-------------------------------------- | :--------------------- | :---------------------------------------------------------------------------------------------------------------- |
| `npm audit --omit=dev`                  | **PASS (0 lỗ hổng)**   | `0 critical`, `0 high`, `0 moderate`, `0 low`                                                                     |
| `npm audit` (gồm `devDependencies`)     | **0 critical, 0 high** | Còn `10 moderate` chỉ nằm trong công cụ build/dev (`drizzle-kit`, `electron-builder`), không đóng gói vào runtime |
| `diagnostics/static-scan.mjs`           | **PASS**               | `anyUsageCount: 0`, `tsIgnoreCount: 0`, `mainIpcRawHandleCount: 0`                                                |
| `npm run check:paths` & `check:secrets` | **PASS**               | 0 đường dẫn cá nhân, 0 bí mật lộ trong repo (quét 189+ file)                                                      |
| Unit / Integration / E2E Tests          | **PASS**               | `78/78` unit (16 file), `13/13` integration (9 file), `3/3` Electron 45 E2E                                       |
| Packaged Smoke Test (Electron Fuses)    | **PASS**               | `release/win-unpacked/Facet.exe` chạy ổn định với đủ 6 Fuses bật                                                  |

---

## 2. Lớp Bảo vệ Runtime Electron & IPC

- **Electron 45.4.1** thay thế Electron `36.9.5` (đã EOL từ 27/10/2025).
- **Production Electron Fuses (`scripts/apply-fuses.mjs`):**
  - `RunAsNode = false`
  - `EnableCookieEncryption = true`
  - `EnableNodeOptionsEnvironmentVariable = false`
  - `EnableNodeCliInspectArguments = false`
  - `EnableEmbeddedAsarIntegrityValidation = true`
  - `OnlyLoadAppFromAsar = true`
- **BrowserWindow Hardening (`electron/main.ts`):**
  - `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
  - Header `Content-Security-Policy` nghiêm ngặt trên bản production
  - `will-navigate` chặn điều hướng ra ngoài origin ứng dụng
  - `setWindowOpenHandler` từ chối mọi popup `window.open`
- **IPC Security (`electron/services/ipcSecurity.ts`):**
  - `0` kênh `ipcMain.handle` thô; mọi kênh IPC đều kiểm tra trusted sender frame và xác thực payload bằng **Zod**.

---

## 3. Mật mã & Dữ liệu Nhạy cảm

- **Kho tài khoản mã hóa (`userData/vault.db`):**
  - Tách biệt hoàn toàn khỏi `antidetect.db` và không bao giờ nằm trong bản sao lưu hồ sơ.
  - Mã hóa phong bì (envelope): DEK 32-byte ngẫu nhiên bọc bằng KEK dẫn xuất từ master password qua `scrypt` (`N=32768`, `r=8`, `p=1`, `maxmem=128MB`); từng trường nhạy cảm mã hóa **AES-256-GCM + AAD** (`table:rowId:column`).
  - Khóa lũy tiến sau 5 lần nhập sai mật khẩu, tự động khóa & xóa DEK khỏi RAM (`Buffer.fill(0)`), clipboard tự xóa sau 20 giây (đã tương thích `Promise<string>` trên Electron 45).
- **Sao lưu hồ sơ mã hóa mặc định (`electron/services/backupCrypto.ts` — PHA 1.2):**
  - Định dạng `FACET_BKP` v1: AES-256-GCM + `scrypt` (`N=32768`, `maxmem=128MB`) + AAD `FACET_BKP:v1`.
  - Bật mã hóa **mặc định** khi xuất sao lưu; tùy chọn loại bỏ mật khẩu proxy (`excludeProxyCredentials`); cảnh báo rõ ràng nếu người dùng chủ động tắt mã hóa; vẫn tương thích ngược khi nhập file JSON cũ (đã xác thực Zod).
- **Sao lưu thư Gmail `.facet-eml` (`electron/services/gmail/emlArchive.ts` — PHA 1.4):**
  - Thay thế hoàn toàn `archiver@7` + `archiver-zip-encrypted@2` (giảm 52 gói phụ thuộc).
  - Định dạng `FACET_EML` v1 dùng thuần `node:crypto` + `node:zlib` (AES-256-GCM + gzip + `scrypt` `N=32768` + AAD `FACET_EML:v1`), giữ bộ nhận diện file `.zip` cũ (`isLegacyZipArchive`).
- **Thu hồi quyền Gmail OAuth (`electron/services/gmail/oauthService.ts` — PHA 1.3):**
  - Nút **Thu hồi** gọi endpoint `oauth2.googleapis.com/revoke` của Google và luôn xóa token cục bộ trong `vault.db` ngay cả khi ngoại tuyến hoặc token đã hết hạn.
  - Giữ nguyên giới hạn scope: mặc định `gmail.readonly`, opt-in `gmail.modify`, **tuyệt đối không có `gmail.send`**.

---

## 4. Mạng cục bộ, Local API & Kho IPv6

- **LocalApiServer (`electron/services/localApi.ts`):**
  - Chỉ lắng nghe `127.0.0.1`, xác thực API key bằng `crypto.timingSafeEqual`, kiểm tra `Host`/`Origin` chống DNS rebinding, giới hạn tốc độ 60 req/phút, và che `proxy.password` trong mọi phản hồi.
- **Kho IPv6 cục bộ (`electron/services/ipv6pool/`):**
  - Chỉ chấp nhận dải unicast toàn cục `2000::/3` tiền tố `/64`; bắt buộc kiểm tra định tuyến trước khi gán.
  - Không chạy cả ứng dụng với quyền quản trị; nâng quyền UAC theo lô `netsh` với tham số đã xác thực chặt; chỉ lắng nghe `127.0.0.1` có mật khẩu ngẫu nhiên; **kill switch** chặn rơi về IPv4 thật; tự dọn địa chỉ khi thoát.
- **Lọc log (`electron/services/logger.ts`):**
  - Tự động che mật khẩu, token, khóa API, URL chứa thông tin đăng nhập trước khi ghi ra file log xoay vòng.

---

## 5. Di chuyển Dữ liệu An toàn (`antidetect-app` → `Facet`)

- `electron/services/dataMigration.ts` chạy 1 lần lúc khởi động: sao chép dữ liệu từ `userData` cũ sang `Facet` qua thư mục tạm, đối chiếu SHA-256 từng file, đổi tên nguyên tử, và **không bao giờ xóa thư mục cũ** để đảm bảo khả năng quay lui 100%.

---

## 6. Chuỗi cung ứng & Rủi ro còn lại

- **Đã thiết lập (PHA 1.7):** Dependabot (hàng tuần cho `npm` và `github-actions`), CodeQL (`javascript-typescript`), ghim commit SHA cho toàn bộ GitHub Actions, cổng CI `npm audit --omit=dev --audit-level=high`, và `docs/MAINTENANCE.md`.
- **Rủi ro còn lại (mức thấp/trung bình, đã kiểm soát):**
  1. `10 moderate` trong `devDependencies` (`drizzle-kit`, `electron-builder`) — không chạy ở runtime, theo dõi qua Dependabot.
  2. Binary Windows chưa có chữ ký số thương mại (Authenticode) — Windows SmartScreen có thể cảnh báo khi cài từ nguồn ngoài; kiểm tra bằng `SHA256SUMS.txt`.
  3. Cần bật thủ công **Secret scanning**, **Push protection**, **Dependabot alerts** và **Branch protection** trong cài đặt repository trên GitHub.
