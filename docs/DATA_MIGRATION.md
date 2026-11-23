# Di chuyển dữ liệu khi đổi tên gói sang **Facet** (PHA 0b)

## 1. Đường dẫn `userData` trước và sau khi đổi tên

- **Trước (`package.json` `name: "antidetect-app"`):**
  - Windows: `%APPDATA%\antidetect-app`
  - macOS: `~/Library/Application Support/antidetect-app`
  - Linux: `~/.config/antidetect-app`
- **Sau (`package.json` `name: "facet"`, `productName: "Facet"`):**
  - Windows: `%APPDATA%\Facet`
  - macOS: `~/Library/Application Support/Facet`
  - Linux: `~/.config/Facet`

## 2. Cơ chế di chuyển một lần an toàn (`electron/services/dataMigration.ts`)

Ngay khi Facet khởi động (trước khi mở SQLite hoặc tạo `BrowserWindow`), `migrateLegacyUserDataIfNeeded()` thực hiện:

1. Kiểm tra nếu thư mục `userData` cũ (`antidetect-app`) tồn tại và thư mục mới (`Facet`) chưa có tệp đánh dấu `.facet-migration-v1.json`.
2. Sao chép các mục: `data/` (gồm `antidetect.db`, `profiles/`, `logs/`), `vault.db` (+ `-wal`/`-shm`), `browsers/`, `cores/`, `bridge-pids.json`.
3. Mỗi tệp đều được sao chép sang tệp tạm, **kiểm tra khớp mã băm SHA-256** rồi mới đổi tên nguyên tử. Nếu bị ngắt giữa chừng (mất điện / tắt nóng), lần mở lại sẽ tự bỏ qua tệp đã khớp và sửa lại tệp lỗi.
4. **Không xóa thư mục cũ** — người dùng có thể tự xóa `%APPDATA%\antidetect-app` sau khi đã xác nhận toàn bộ hồ sơ, proxy và vault hoạt động bình thường.

## 3. Tương thích `safeStorage`, `vault.db`, `appId` và Local API

- **Windows (`safeStorage` / DPAPI):** Khóa DPAPI gắn với tài khoản Windows hiện tại (không gắn theo tên app), nên mật khẩu proxy đã mã hóa giải mã bình thường ngay sau khi nâng cấp.
- **macOS Keychain & Linux `libsecret`:** `safeStorage` gắn với tên ứng dụng — khi nâng cấp trên macOS/Linux từ bản `antidetect-app`, nếu mật khẩu proxy cũ không giải mã được do đổi tên Keychain entry, người dùng có thể nhập lại mật khẩu proxy hoặc giữ `userData` cũ cho đến khi hỗ trợ đọc Keychain cũ được bổ sung.
- **Kho Gmail (`vault.db`):** Dẫn xuất khóa từ Master Password (`scrypt`), hoàn toàn độc lập với tên app trên mọi hệ điều hành.
- **`appId` trong `electron-builder.yml`:** Giữ nguyên `dev.facet.browser` (đã dùng từ `v0.1.0` & `v0.2.0`) để không làm đứt chuỗi cài đặt/cập nhật của NSIS và `electron-updater`.
- **Local REST API:** Giữ nguyên chuỗi `service: 'antidetect-local-api'` trong `/health` để tương thích ngược với các script tự động hóa hiện có.
