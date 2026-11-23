# Facet — Backlog (Ngoài phạm vi phiên bản hiện tại)

Các hạng mục hợp lệ nhưng nằm ngoài phạm vi triển khai hiện tại của module **Tài khoản Gmail**:

1. **Tùy chọn Argon2id gốc (native):** Hỗ trợ chuyển đổi KDF từ `scrypt` sang `@node-rs/argon2` khi cung cấp bản build prebuilt ổn định đa nền tảng Windows/macOS/Linux.
2. **Thu hồi token OAuth trực tiếp:** Thêm nút gọi endpoint `https://oauth2.googleapis.com/revoke` khi người dùng muốn ngắt kết nối một tài khoản khỏi Google ngay trong app.
3. **Xem nội dung thư đầy đủ trong iframe cô lập:** Cho phép mở chi tiết nội dung HTML/text của một thư trong modal sandboxed (chặn script & tracking pixel) mà vẫn chỉ giữ trong RAM.
4. **Hàng đợi sao lưu nhiều tài khoản:** Sao lưu tuần tự nhiều tài khoản Gmail trong một lần bấm.
5. **Xuất/Nhập kho mã hóa giữa các máy:** Tính năng xuất bản sao lưu `vault.db` riêng có kiểm tra checksum và xác nhận mật khẩu chính.
6. **Kho IPv6 cục bộ trên Linux và macOS:** Triển khai `CommandRunner` dùng `ip -6 addr add/del` (Linux, qua `pkexec`/`sudo`) và `ifconfig inet6 alias/-alias` (macOS).
7. **Listener SOCKS5 cục bộ cho Kho IPv6:** Bổ sung chế độ SOCKS5 auth cục bộ trên `127.0.0.1` bên cạnh HTTP CONNECT hiện có.
