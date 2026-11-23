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

## 3. Hai quyết định kiến trúc quan trọng khi đổi tên (PHA 0b & PHA 1.9)

### (a) Quyết định `appId` trong `electron-builder.yml` & Khả năng cập nhật từ `v0.2.0` → `v0.3.0`

- **Quyết định:** **GIỮ NGUYÊN** `appId: dev.facet.browser` và `productName: Facet` (không đổi giữa `v0.1.0`, `v0.2.0` và `v0.3.0`).
- **Phân tích cấu hình & khả năng cập nhật:**
  - Trong `electron-builder.yml`, hiện **chưa cấu hình `electron-updater` / `publish`**; Facet phát hành bộ cài đặt qua GitHub Releases (`Facet Setup <version>.exe` + `SHA256SUMS.txt`).
  - Với NSIS trên Windows, `appId: dev.facet.browser` quyết định khóa định danh gỡ cài đặt (`Uninstall`) và vị trí nâng cấp đè. Vì `appId` và `productName` giữ nguyên giữa `v0.2.0` và `v0.3.0`, cài `Facet Setup 0.3.0.exe` sẽ **cập nhật trực tiếp đè lên bản `v0.2.0`** mà không tạo hai mục trùng lặp trong Windows Apps & Features.
  - Khi bổ sung `electron-updater` trong tương lai (Backlog), việc giữ nguyên `appId: dev.facet.browser` đảm bảo chuỗi tự cập nhật không bị đứt gãy.

### (b) Quyết định `safeStorage` (mã hóa mật khẩu proxy) sau khi đổi tên gói

- **Windows (DPAPI — đã kiểm chứng):** DPAPI mã hóa theo tài khoản người dùng Windows hiện tại (`CryptProtectData`), **không** gắn với tên app hay `package.json name`. Mật khẩu proxy mã hóa ở `v0.2.0` giải mã trực tiếp ở `v0.3.0` mà không cần nhập lại.
- **macOS (Keychain) & Linux (`libsecret` / `kwallet`):** **Chưa kiểm chứng thực tế trên macOS/Linux** (môi trường phát triển & kiểm thử hiện tại là Windows 11). Trên macOS Keychain và Linux `libsecret`, Electron `safeStorage` gắn khóa với tên ứng dụng (`app.getName()`), nên bản ghi `enc:` tạo dưới tên cũ `antidetect-app` có thể không giải mã được trực tiếp bằng khóa dưới tên mới `Facet`.
- **Đường chuyển đổi đã chuẩn bị (`electron/services/secretService.ts`):**
  - `SecretService` hỗ trợ tham số `legacyStorage?: SafeStorageLike` làm đường dự phòng khi `storage.decryptString()` báo lỗi trên bản ghi `enc:` cũ, cùng phương thức `reencryptIfLegacy(stored)` để mã hóa lại bằng khóa `Facet` mới (đã có unit test kiểm chứng trong `tests/unit/dataMigration.test.ts`).
  - Khuyến nghị khi nâng cấp trên macOS/Linux trước khi có kiểm chứng thực tế trên phần cứng thật: xuất bản sao lưu hồ sơ mã hóa (`.facet-backup`) từ `v0.2.0` trước khi cài `v0.3.0`, sau đó nhập lại trên `v0.3.0` để toàn bộ mật khẩu proxy được mã hóa lại dưới khóa Keychain/`libsecret` mới của `Facet`.
- **Kho Gmail (`vault.db`):** Dẫn xuất khóa từ Master Password (`scrypt`), hoàn toàn độc lập với `safeStorage` và tên app trên mọi hệ điều hành.
- **Local REST API:** Giữ nguyên chuỗi `service: 'antidetect-local-api'` trong `/health` để tương thích ngược với các script tự động hóa hiện có.
