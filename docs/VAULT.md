# Kiến trúc bảo mật Kho tài khoản mã hóa (Facet Vault)

Module **Tài khoản Gmail** lưu toàn bộ thông tin nhạy cảm trong cơ sở dữ liệu SQLite cục bộ riêng biệt tại:

```text
<userData>/vault.db
```

Tệp `vault.db` hoàn toàn tách biệt với `antidetect.db` (dữ liệu hồ sơ trình duyệt) và **không bao giờ** được đưa vào bản sao lưu hồ sơ mặc định.

---

## 1. Mô hình mã hóa phong bì (Envelope Encryption)

1. **DEK (Data Encryption Key):** Khi khởi tạo kho lần đầu, Facet sinh ngẫu nhiên một khóa dữ liệu 32 byte bằng `crypto.randomBytes(32)`.
2. **KEK (Key Encryption Key):** Được dẫn xuất từ **Master Password** bằng `crypto.scryptSync` với muối ngẫu nhiên 16 byte và tham số mạnh:
   - `N = 32768` ($2^{15}$), `r = 8`, `p = 1`, `maxmem = 128 MiB`.
3. **Bọc DEK:** DEK được mã hóa bằng KEK (AES-256-GCM) và lưu trong bảng `meta` cùng `salt` và `kdf_params`.
4. **Canary:** Một chuỗi kiểm chứng được mã hóa bằng DEK giúp xác minh mật khẩu chính đúng hay sai ngay khi mở khóa.
5. **Đổi mật khẩu chính:** Chỉ bọc lại DEK bằng KEK mới trong một transaction SQLite nguyên tử — không cần giải mã/mã hóa lại từng dòng tài khoản.

## 2. Mã hóa từng trường dữ liệu (Field-level AES-256-GCM + AAD)

- Các trường **mã hóa bắt buộc**: `password`, `totp`, `recovery`, `notes`, OAuth `token`, và Google `credentials.json`.
- Các trường **chữ rõ để tìm kiếm**: `email`, `label`.
- Mỗi lần ghi dùng **nonce ngẫu nhiên 12 byte mới** (`crypto.randomBytes(12)`), lưu kèm authentication tag 16 byte.
- **AAD (Additional Authenticated Data):** `<table>:<rowId>:<field>` — chống tráo ciphertext giữa các dòng hoặc giữa các trường khác nhau.

## 3. Các cơ chế bảo vệ khi vận hành

- **Quyền tệp:** Trên macOS/Linux, `vault.db` được đặt quyền `0600` (chỉ chủ sở hữu đọc/ghi).
- **Chống dò mật khẩu:** Sau 5 lần nhập sai liên tiếp, áp dụng khóa tạm tăng dần (từ 5 giây lên tối đa 300 giây).
- **Tự động khóa & xóa DEK khỏi RAM:** Khi người dùng bấm Khóa, hết thời gian không thao tác (mặc định 10 phút), thu nhỏ cửa sổ (tùy chọn), hoặc thoát ứng dụng, buffer DEK được ghi đè 0 (`Buffer.fill(0)`) và giải phóng mọi OAuth client trong RAM.
- **Bảo vệ IPC & Renderer:** Renderer **không bao giờ** nhận mật khẩu chữ rõ, khóa bí mật TOTP hay OAuth refresh token trong luồng thông thường.
  - Sao chép mật khẩu / mã 2FA thực hiện hoàn toàn trong **main process** và tự xóa clipboard sau **20 giây** (chỉ xóa nếu nội dung clipboard vẫn khớp SHA-256 giá trị vừa chép).
  - Hiện mật khẩu tạm thời (10 giây) bắt buộc nhập lại **Master Password**.
- **Che dữ liệu trong log:** Mọi log tự động che mật khẩu, token, `otpauth://` và ẩn bớt email (`a***@gmail.com`).

## 4. Cảnh báo mất mật khẩu chính

> **Facet không có máy chủ đám mây và không lưu Master Password.**
> Nếu bạn quên mật khẩu chính, **không có cách nào khôi phục** dữ liệu đã mã hóa trong `vault.db`. Hãy sao lưu tệp `vault.db` định kỳ và ghi nhớ mật khẩu chính ở nơi an toàn.

## 5. Nhập dữ liệu từ kho Python cũ (`vault.db` Fernet)

Facet hỗ trợ nhập một chiều (chỉ đọc tệp cũ, không sửa tệp cũ) từ công cụ Python/PySide6 cũ dùng `Fernet + scrypt(N=16384)`:

1. Mở **Tài khoản → Cài đặt kho → Nhập từ kho Python cũ (vault.db)**.
2. Nhập mật khẩu chính của kho cũ, chọn chế độ xử lý email trùng (**Bỏ qua** hoặc **Ghi đè**), rồi chọn file `vault.db` cũ.
3. Toàn bộ tài khoản (kể cả `recovery` và `notes`) và OAuth token hợp lệ sẽ được mã hóa lại sang định dạng AES-256-GCM mới.
