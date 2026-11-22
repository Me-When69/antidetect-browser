# Antidetect Browser

Ứng dụng desktop quản lý nhiều hồ sơ trình duyệt cô lập (isolated browser profiles) dành cho agency, QA/testing và thương mại điện tử. Giao diện dark theme trực quan, hỗ trợ **Chrome (CDP)** và **Firefox (Camoufox)**, quản lý proxy có mật khẩu, tự khớp múi giờ/vị trí theo IP và bộ kiểm tra nhất quán dấu vân tay theo thời gian thực.

---

## Tính năng chính

- **Cô lập hồ sơ hoàn toàn:** Mỗi hồ sơ có thư mục `user-data-dir` riêng (`data/profiles/<id>`), tách biệt 100% cookie, localStorage và phiên đăng nhập.
- **Hỗ trợ 2 nhân trình duyệt:**
  - **ChromeDriver (Playwright + CDP):** Ghi đè timezone, locale, geolocation, `Accept-Language` ở tầng CDP và mở `wsEndpoint` cho automation.
  - **CamoufoxDriver (Firefox):** Truyền cấu hình fingerprint qua API của Camoufox (tự fallback sang Playwright Firefox nếu chưa cài binary Camoufox).
- **Quản lý Proxy toàn diện:**
  - Hỗ trợ `HTTP`, `HTTPS`, `SOCKS5` có hoặc không có `user:pass` (tự tạo tunnel cục bộ qua `proxy-chain`).
  - Dán nhanh dạng `host:port:user:pass` hoặc URL, lưu kho proxy, mã hóa mật khẩu bằng Electron `safeStorage`.
  - Kiểm tra IP đầu ra, quốc gia, thành phố, múi giờ và độ trễ trực tiếp trong form.
- **Fingerprint nhất quán & chống rò rỉ:**
  - 36 cấu hình thiết bị thật (Windows / macOS / Linux) khớp đồng bộ UA, OS, Client Hints, GPU WebGL, độ phân giải, RAM/CPU và danh sách font.
  - Nhiễu Canvas & Audio theo seed cố định cho từng hồ sơ, bảo vệ `Function.prototype.toString` dạng `[native code]`.
  - 3 chế độ WebRTC: `Replace` (ẩn IP nội bộ), `Disable`, `Real`.
- **Kiểm tra "Danh tính này có phù hợp không":** Chấm điểm nhất quán (0–100), cảnh báo lệch UA/GPU/Fonts/WebRTC/Timezone so với IP và nút **Sửa tự động**.
- **Quản lý hàng loạt & Cookie:** Chạy/dừng/gán thư mục/xóa hàng loạt, tạo nhanh N hồ sơ kèm danh sách proxy, Import/Export cookie chuẩn **JSON** và **Netscape**.
- **Local REST API (`127.0.0.1`):** Điều khiển mở/đóng hồ sơ bằng script Playwright hoặc Puppeteer qua API key.
- **Đa ngôn ngữ & Sao lưu:** Hỗ trợ Tiếng Việt / English, sao lưu/khôi phục JSON và xuất log hỗ trợ.

---

## Yêu cầu hệ thống

- **Node.js** >= 20 (khuyến nghị LTS 22 hoặc 24)
- **Git**
- Đã cài sẵn **Google Chrome** hoặc **Microsoft Edge** (hoặc tải Chromium qua `npx playwright-core install chromium`)

---

## Cài đặt & Chạy ứng dụng

```bash
# 1. Clone dự án
git clone https://github.com/Me-When69/antidetect-browser.git
cd antidetect-browser

# 2. Cài thư viện
npm install

# 3. Chạy chế độ phát triển (mở cửa sổ Electron)
npm run dev
```

> **Lưu ý khi chạy lần đầu trên Windows/macOS:** Nếu Electron báo lỗi ABI của native module `better-sqlite3` (do phiên bản Node trên máy khác phiên bản Node tích hợp trong Electron), chạy lệnh sau rồi `npm run dev` lại:
> ```bash
> npx @electron/rebuild -f -w better-sqlite3
> ```

---

## Hướng dẫn sử dụng ứng dụng

### 1. Tạo và chạy hồ sơ mới
1. Nhấn **+ Hồ sơ mới** trên thanh sidebar bên trái.
2. **Danh tính:** Nhập tên (hoặc bấm **Ngẫu nhiên**), chọn thư mục, trạng thái và thẻ.
3. **Môi trường:** Chọn nền tảng (**Windows / macOS / Linux**) và trình duyệt (**Chrome** hoặc **Firefox Camoufox**). Hệ thống tự sinh cấu hình thiết bị nhất quán. Bạn có thể bấm **Lấy dấu vân tay mới** bất kỳ lúc nào.
4. **Proxy:** Chọn proxy từ kho hoặc dán nhanh dạng `host:port:user:pass` rồi nhấn **Áp dụng**.
5. **Kiểm tra danh tính (panel bên phải):**
   - Nhấn **Kiểm tra IP đầu ra** để xem IP, quốc gia, múi giờ và độ trễ.
   - Nếu có cảnh báo màu đỏ/vàng (ví dụ: WebRTC đang để `Real` khi có proxy, hoặc múi giờ lệch IP), nhấn **Sửa tự động** để đồng bộ lại toàn bộ.
6. Nhấn **Tạo** để lưu hoặc **Tạo và chạy** để mở trình duyệt ngay.

### 2. Quản lý Kho Proxy & Thư mục
- Vào mục **Proxy** để thêm hàng loạt proxy dùng chung, kiểm tra sống/chết và độ trễ trước khi gán cho hồ sơ.
- Vào mục **Thư mục** để gom nhóm hồ sơ theo dự án/khách hàng và lọc nhanh trên bảng **Tất cả hồ sơ**.

### 3. Tạo hàng loạt & Quản lý Cookie
- Tại trang **Tất cả hồ sơ**, bấm **Tạo hàng loạt** để tạo nhanh 1–200 hồ sơ theo mẫu và dán danh sách proxy (mỗi dòng 1 proxy).
- Tích chọn nhiều dòng trên bảng để hiện thanh công cụ **Chạy đã chọn / Dừng đã chọn / Gán thư mục / Xóa đã chọn**.
- Bấm biểu tượng **Cookie** trên từng dòng để **Nhập** hoặc **Xuất** cookie dạng `JSON` hoặc `Netscape`.

### 4. Sử dụng Local REST API (Automation)
1. Vào **Cài đặt → Local REST API (127.0.0.1)**, bật API và sao chép **API Key**.
2. Xem tài liệu chi tiết tại [docs/LOCAL_API.md](docs/LOCAL_API.md).
3. Chạy thử script mẫu kết nối Playwright:
   ```powershell
   $env:API_KEY="ad_your_api_key"
   $env:PROFILE_ID="uuid-cua-ho-so"
   node examples/playwright-connect.mjs
   ```

### 5. Dùng nhân Firefox / Camoufox
- Khi tạo hồ sơ, chọn trình duyệt **Firefox (Camoufox)**.
- Nếu bạn đã tải binary Camoufox riêng, vào **Cài đặt → Đường dẫn trình duyệt tùy chọn** và dán đường dẫn tới `camoufox.exe`. Nếu để trống, ứng dụng sẽ tự dùng Firefox của Playwright (cài bằng `npx playwright-core install firefox`).

### 6. Sao lưu, Khôi phục & Hỗ trợ
- Vào **Cài đặt → Sao lưu & Hỗ trợ**:
  - **Xuất sao lưu JSON:** Lưu toàn bộ hồ sơ, thư mục, thẻ và kho proxy ra file `.json`.
  - **Khôi phục từ JSON:** Nhập lại dữ liệu trên máy mới.
  - **Xuất log hỗ trợ:** Tải file log hoạt động để kiểm tra lỗi.

---

## Đóng gói bộ cài & Kiểm thử

```bash
# Kiểm tra TypeScript strict
npm run typecheck

# Kiểm tra ESLint
npm run lint

# Chạy bộ unit test (Vitest)
npm run test

# Build production
npm run build

# Đóng gói installer Windows (.exe NSIS)
npm run dist:win

# Đóng gói installer macOS (.dmg)
npm run dist:mac
```

---

## Cấu trúc thư mục

```text
antidetect-browser/
├─ electron/
│  ├─ main.ts                   # Cửa sổ Electron & đăng ký IPC handlers
│  ├─ preload.ts                # Bridge IPC an toàn (contextIsolation)
│  ├─ db/                       # SQLite (better-sqlite3) + Drizzle schema
│  └─ services/
│     ├─ profileService.ts      # CRUD profile, folder, tag, bulk, backup
│     ├─ proxyService.ts        # Kho proxy, proxy-chain, kiểm tra IP/geo
│     ├─ launcher.ts            # Quản lý tiến trình & cookie
│     ├─ localApi.ts            # Local REST API (127.0.0.1)
│     ├─ drivers/               # BrowserDriver, ChromeDriver, CamoufoxDriver
│     └─ fingerprint/           # presets.json (36 thiết bị), generator, injector
├─ shared/                      # Types, Zod schemas, IPC contract, Identity checker
├─ src/                         # React UI (Tailwind + shadcn/ui + Zustand + i18n)
├─ docs/                        # Tài liệu Local API
├─ examples/                    # Script mẫu Playwright & Puppeteer
└─ tests/                       # Bộ test tự động Vitest
```

---

## Contributors

- [@Me-When69](https://github.com/Me-When69)
- [@Zewieee](https://github.com/Zewieee)

## Lưu ý pháp lý

Công cụ này được thiết kế cho mục đích quản lý nhiều tài khoản hợp lệ, agency, QA và kiểm thử phần mềm. Người dùng tự chịu trách nhiệm tuân thủ điều khoản dịch vụ của các nền tảng truy cập và quy định pháp luật hiện hành.
