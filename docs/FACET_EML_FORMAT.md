# Đặc tả Định dạng Sao lưu Thư `.facet-eml` (`FACET_EML` v1)

Từ **Facet `v0.3.0`** (PHA 1.4 & PHA 1.9), tính năng sao lưu thư Gmail có mã hóa sử dụng định dạng `.facet-eml` (không phụ thuộc bên thứ ba, dùng thuần `node:crypto` + `node:zlib`) thay cho `archiver` + `archiver-zip-encrypted`.

---

## 1. Cấu trúc tệp (JSON UTF-8 Envelope)

Tệp `.facet-eml` là một đối tượng JSON UTF-8 gồm các trường sau:

```json
{
  "magic": "FACET_EML",
  "version": 1,
  "kdf": {
    "alg": "scrypt",
    "N": 32768,
    "r": 8,
    "p": 1,
    "dkLen": 32
  },
  "salt": "<base64 — 16 byte ngẫu nhiên>",
  "nonce": "<base64 — 12 byte ngẫu nhiên>",
  "tag": "<base64 — 16 byte AES-GCM Auth Tag>",
  "ciphertext": "<base64 — dữ liệu nén gzip đã mã hóa>"
}
```

---

## 2. Tham số Mật mã & Nén

| Thành phần                     | Quy cách                                                                                                                                                                                   |
| :----------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Header / Magic**             | `magic = "FACET_EML"`, `version = 1`                                                                                                                                                       |
| **KDF**                        | `crypto.scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 134217728 })` (128 MB)                                                                                              |
| **Salt**                       | `16` byte ngẫu nhiên (`crypto.randomBytes(16)`) cho mỗi bản sao lưu                                                                                                                        |
| **Thuật toán mã hóa**          | `AES-256-GCM` (`aes-256-gcm`)                                                                                                                                                              |
| **Nonce (IV)**                 | `12` byte ngẫu nhiên (`crypto.randomBytes(12)`)                                                                                                                                            |
| **AAD**                        | Chuỗi UTF-8 `"FACET_EML:v1"` (gắn chặt header và phiên bản vào thẻ xác thực)                                                                                                               |
| **Auth Tag**                   | `16` byte (`cipher.getAuthTag()`) — phát hiện mọi sửa đổi 1 bit hoặc sai mật khẩu                                                                                                          |
| **Nén**                        | `zlib.gzipSync(utf8Json, { level: 6 })` trước khi mã hóa                                                                                                                                   |
| **Cấu trúc bản rõ bên trong**  | `{ "entries": [ { "name": "<tên_file>.eml", "contentBase64": "<base64 raw RFC 5322>" } ] }`                                                                                                |
| **An toàn bộ nhớ & đường dẫn** | Khóa dẫn xuất bị xóa (`key.fill(0)`) trong khối `finally`; khi giải nén ra thư mục, mọi tên tệp được chuẩn hóa qua `path.basename` và kiểm tra containment để chặn path traversal (`../`). |

---

## 3. Tương thích với tệp `.zip` mã hóa cũ (`v0.2.0`)

- Các tệp sao lưu `.zip` mã hóa AES-256 tạo bởi **v0.2.0** (qua `archiver-zip-encrypted`) **không còn được tạo mới** và **không giải nén trực tiếp trong Facet v0.3.0** (vì đã gỡ bỏ hoàn toàn `archiver` / `archiver-zip-encrypted` để đạt 0 lỗ hổng production).
- Khi người dùng chọn một tệp `.zip` cũ, Facet nhận diện header PKZIP (`50 4B 03 04`) qua `isLegacyZipArchive()` và hiển thị thông báo rõ ràng hướng dẫn giải nén bằng **7-Zip** hoặc **WinRAR** (chuẩn WinZip AES-256 tiêu chuẩn) với mật khẩu đã đặt.
- Trong ứng dụng, người dùng có thể giải nén mọi tệp `.facet-eml` ra thư mục `.eml` qua mục **Tài khoản → Sao lưu → Giải nén sao lưu thư (.facet-eml)**.
