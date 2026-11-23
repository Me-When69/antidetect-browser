# Facet

**Mỗi hồ sơ, một danh tính riêng.** *(English: [README.md](README.md))*

Facet là ứng dụng desktop **mã nguồn mở, phi thương mại, lưu dữ liệu hoàn toàn cục bộ** để quản lý nhiều hồ sơ trình duyệt cô lập — xây dựng bằng **Electron, React, TypeScript, SQLite và playwright-core**. Không có máy chủ trung gian, không tài khoản, không thu thập telemetry.

## Tính năng chính
- **Quản lý hồ sơ cô lập**: Mỗi hồ sơ có thư mục `userDataDir` riêng, hỗ trợ thư mục, thẻ, màu nhãn, ngày hết hạn, Thùng rác khôi phục, tạo/cập nhật hàng loạt, nhập CSV và nhập/xuất Cookie (JSON, Netscape).
- **Proxy đa giao thức & Cầu nối cục bộ**: Hỗ trợ HTTP, HTTPS, SOCKS4/4a, SOCKS5/5h (tự chạy cầu nối cục bộ cho SOCKS5 có mật khẩu trên Chromium), SSH tunnel, chuỗi proxy tối đa 3 chặng, hỗ trợ IPv6 & kiểm tra rò rỉ, và tùy chọn tải `sing-box` chính thức cho Shadowsocks/VMess/VLESS/Trojan.
- **Tự khớp múi giờ/vị trí & Kiểm tra nhất quán**: Tự khớp múi giờ IANA, ngôn ngữ, Accept-Language và tọa độ theo IP proxy qua CDP; bảng kiểm tra nhất quán thời gian thực kèm nút **Sửa tự động**.
- **47 thiết bị giả lập & Quản lý nhiều phiên bản trình duyệt**: Hỗ trợ Windows, macOS, Linux, Android (CDP mobile/touch) và iOS. Phiên bản trong UA và Client Hints luôn khớp đúng nhân thật đang chạy; tải/xóa nhiều phiên bản Chrome for Testing và cảnh báo hạ phiên bản.
- **Cấu hình nâng cao & Preset**: Chỉnh từng tín hiệu (`Thật` / `Nhiễu` / `Tắt`), giả lập Media Devices theo seed, dọn dữ liệu khi đóng, chỉnh kích thước cửa sổ, chặn băng thông (ảnh, media, font ngoài, quảng cáo, tracker), 4 preset sẵn (*Cân bằng*, *Bảo mật tối đa*, *Tiết kiệm băng thông*, *Thử nghiệm*) và lưu preset riêng.
- **Local REST API**: Chỉ lắng nghe `127.0.0.1` kèm API key để kết nối Playwright, Puppeteer hoặc Selenium qua `wsEndpoint`.
- **Kho Tài khoản Gmail mã hóa**: Lưu cục bộ trong `vault.db` theo mô hình phong bì AES-256-GCM + AAD (`scrypt`), mã 2FA TOTP (`otplib`), tự xóa clipboard sau 20 giây, kiểm tra bảo mật, cấp quyền Gmail API OAuth2 PKCE (`gmail.readonly` mặc định, tùy chọn `gmail.modify`, **không bao giờ `gmail.send`**), sao lưu `.eml` dạng `.zip` mã hóa AES-256, liên kết với hồ sơ trình duyệt và nhập từ kho Python cũ. Xem [docs/VAULT.md](docs/VAULT.md), [docs/GMAIL_SETUP.md](docs/GMAIL_SETUP.md), [docs/ACCEPTABLE_USE.md](docs/ACCEPTABLE_USE.md) và [CONTRIBUTING.md](CONTRIBUTING.md).

## Cài đặt & Kiểm tra Checksum
Tải bộ cài tương ứng hệ điều hành tại [GitHub Releases](https://github.com/Me-When69/antidetect-browser/releases).

> **Lưu ý bản cài chưa ký mã:** Bản cài mã nguồn mở chưa có chứng chỉ ký mã thương mại nên **Windows SmartScreen** hoặc **macOS Gatekeeper** có thể cảnh báo. Hãy luôn đối chiếu mã SHA-256 với file `SHA256SUMS.txt` đính kèm trước khi chạy:
> ```powershell
> Get-FileHash .\Facet-Setup-0.1.0.exe -Algorithm SHA256
> ```

## Phát triển & Kiểm thử
```bash
npm install
npm run dev                # Chạy chế độ phát triển
npm run validate:devices   # Kiểm tra lược đồ 47 thiết bị
npm run typecheck          # Kiểm tra TypeScript strict
npm run lint               # Kiểm tra ESLint
npm run test               # Unit test (Vitest)
npm run test:integration   # Integration test trên Chrome thật
npm run build              # Build production
npm run perf:budget        # Kiểm tra ngân sách dung lượng bundle
npm run dist:win           # Đóng gói bộ cài Windows (.exe)
```

## Giới hạn đã biết
- **Giả lập chỉ là lớp thông tin trình duyệt báo cáo**, không thay đổi GPU vật lý hay font hệ thống của máy chủ. Các hệ thống chống bot mạnh vẫn có thể phát hiện giả lập chéo hệ điều hành hoặc giả lập di động trên máy tính.
- **Mức độ tin cậy**: Desktop trùng hệ điều hành máy chủ = **Cao**; Desktop khác OS & Android CDP = **Trung bình**; iOS trên Chromium = **Thấp**.
- **Bảo trì**: Dự án được duy trì theo khả năng của cộng đồng.

## Sử dụng có trách nhiệm
Facet được phát triển cho **kiểm thử QA, kiểm tra đa vùng/đa ngôn ngữ, nghiên cứu quyền riêng tư và quản lý nhiều tài khoản hợp lệ của chính bạn**. Không dùng cho gian lận, spam, tấn công hoặc vi phạm điều khoản dịch vụ bên thứ ba. Dự án không xây dựng và không nhận đóng góp giải/vượt CAPTCHA hay tạo tài khoản hàng loạt. Phát hành theo giấy phép [Apache License 2.0](LICENSE) trên cơ sở "nguyên trạng", không bảo hành.
