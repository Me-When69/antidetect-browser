# Danh sách kiểm tra thủ công (Manual QA Checklist)

Chạy lại danh sách này sau mỗi lần chỉnh sửa phần **Fingerprint**, **Proxy**, **Geo/CDP**, hoặc **BrowserDriver**.

> **Lưu ý:** Không đưa các trang công khai bên thứ ba vào bộ test tự động CI; chỉ dùng chúng để nghiệm thu thủ công tại đây.

| STT | Nhóm kiểm tra | Trang kiểm tra | Bước thực hiện | Kết quả mong đợi | Kết quả thực tế | Đạt / Không đạt |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **BrowserLeaks — IP** | `https://browserleaks.com/ip` | Mở hồ sơ có proxy (HTTP/SOCKS5) với `geo.mode = auto`, truy cập trang. | IP đầu ra, quốc gia, thành phố, ISP khớp 100% với proxy; không lộ IP thật của máy. | | [ ] Đạt / [ ] Không đạt |
| 2 | **BrowserLeaks — WebRTC** | `https://browserleaks.com/webrtc` | Mở hồ sơ có proxy với `webrtc = replace` và thử lại với `webrtc = disable`. | Mục Local IP không hiện địa chỉ LAN (`192.168.x.x`, `10.x.x.x`); Public IP không lộ IP thật của máy. | | [ ] Đạt / [ ] Không đạt |
| 3 | **BrowserLeaks — JavaScript** | `https://browserleaks.com/javascript` | Kiểm tra `navigator.userAgent`, `platform`, `hardwareConcurrency`, `deviceMemory`, `language`, `screen`, `Intl.DateTimeFormat().resolvedOptions().timeZone`. | Toàn bộ giá trị khớp đúng cấu hình hồ sơ và múi giờ IP proxy; `navigator.webdriver = false`. | | [ ] Đạt / [ ] Không đạt |
| 4 | **BrowserLeaks — Canvas** | `https://browserleaks.com/canvas` | Mở cùng 1 hồ sơ 2 lần liên tiếp (ghi lại Signature/Hash); sau đó mở hồ sơ thứ 2. | Cùng 1 hồ sơ mở lại cho **cùng** hash; 2 hồ sơ khác nhau cho hash **khác nhau**; không báo dấu vết override bất thường. | | [ ] Đạt / [ ] Không đạt |
| 5 | **BrowserLeaks — WebGL** | `https://browserleaks.com/webgl` | Kiểm tra `Unmasked Vendor` và `Unmasked Renderer`. | Khớp cấu hình hồ sơ; hồ sơ Windows không có GPU Apple/Mesa, macOS không có Direct3D11. | | [ ] Đạt / [ ] Không đạt |
| 6 | **BrowserLeaks — Fonts** | `https://browserleaks.com/fonts` | Kiểm tra danh sách font được phát hiện. | Chỉ chứa font phù hợp hệ điều hành của hồ sơ (không có font macOS trên Windows và ngược lại). | | [ ] Đạt / [ ] Không đạt |
| 7 | **CreepJS** | `https://abrahamjuliot.github.io/creepjs/` | Mở hồ sơ và chờ trang chấm điểm hoàn tất (khoảng 10–15 giây). | Không có cờ `lies` về `Function.prototype.toString`, timezone, screen hoặc WebGL; điểm nhất quán ổn định giữa các lần mở cùng hồ sơ. | | [ ] Đạt / [ ] Không đạt |
| 8 | **Pixelscan** | `https://pixelscan.net/` | Mở hồ sơ có proxy thật và kiểm tra báo cáo tổng hợp. | Múi giờ, vị trí, User-Agent, nền tảng nhất quán; không báo lỗi lệch IP/timezone hoặc dấu hiệu automation. | | [ ] Đạt / [ ] Không đạt |
| 9 | **IPv6 Test** | `https://ipv6-test.com/` | Thử 2 hồ sơ: (a) Proxy IPv4 + `ipv6Policy = block`; (b) Proxy IPv6 + `ipv6Policy = proxy-only`. | (a) Không lộ địa chỉ IPv6 thật của máy (IPv6 Not supported); (b) Hiển thị đúng địa chỉ IPv6 của proxy. | | [ ] Đạt / [ ] Không đạt |
| 10 | **DNS Leak Test** | `https://www.dnsleaktest.com/` (Extended test) | Mở hồ sơ có proxy (đặc biệt SOCKS5) và chạy Extended Test. | Danh sách DNS resolver khớp khu vực của proxy, không xuất hiện DNS của nhà mạng ISP thật trên máy. | | [ ] Đạt / [ ] Không đạt |
| 11 | **Cô lập phiên (Multi-account)** | Bất kỳ web có đăng nhập | Mở 2 hồ sơ cùng lúc, đăng nhập 2 tài khoản khác nhau; đóng cả 2 rồi mở lại. | 2 tài khoản không lẫn phiên nhau; sau khi mở lại cả 2 vẫn giữ nguyên trạng thái đăng nhập. | | [ ] Đạt / [ ] Không đạt |
| 12 | **Lỗi proxy & Fallback** | Form / Bảng hồ sơ | Đặt proxy sai port (`127.0.0.1:1`) với `geo.mode = auto` rồi bấm **Chạy**. | Trình duyệt không mở; hiển thị lỗi tiếng Việt rõ ràng kèm nút **Mở bằng cấu hình geo đã lưu lần trước** và **Hủy**. | | [ ] Đạt / [ ] Không đạt |
