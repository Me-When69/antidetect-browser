# Kho IPv6 cục bộ (Local IPv6 Pool)

Tính năng **Kho IPv6 cục bộ** cho phép bạn sử dụng một dải **IPv6 `/64` thuộc quyền sở hữu hoặc được ủy quyền hợp pháp** (trên VPS hoặc mạng nhà có Prefix Delegation) để gán địa chỉ IPv6 riêng cho từng hồ sơ trình duyệt trong Facet.

> **Lưu ý nền tảng:** Phiên bản hiện tại hỗ trợ **Windows** (`netsh interface ipv6`). Hỗ trợ Linux (`ip -6 addr`) và macOS (`ifconfig`) được ghi nhận trong [BACKLOG.md](BACKLOG.md).

---

## 1. Điều kiện cần

1. **Tiền tố IPv6 `/64` toàn cục (`2000::/3`):** Không chấp nhận link-local (`fe80::/10`), ULA (`fc00::/7`) hay loopback (`::1`). Ví dụ tài liệu: `2001:db8:abcd:1::/64`.
2. **Định tuyến cả dải `/64` về máy:** Nhà cung cấp phải định tuyến toàn bộ `/64` (hoặc bật NDP proxy / routed subnet) tới card mạng Windows của bạn.
3. **Quyền quản trị (UAC) theo từng thao tác:** Facet **không** chạy toàn bộ ứng dụng bằng quyền quản trị. Windows chỉ hỏi UAC khi thực thi lệnh `netsh` gán hoặc gỡ địa chỉ (gom tối đa 64 địa chỉ mỗi lần UAC).

---

## 2. Cách kiểm tra VPS / mạng nhà có định tuyến cả `/64` không

1. Mở **Proxy → Kho IPv6 cục bộ**.
2. Chọn **Card mạng (Interface)**, nhập tiền tố `/64` (ví dụ `2001:db8:abcd:1::/64`), tick xác nhận **"Tôi sở hữu hoặc được ủy quyền sử dụng tiền tố này"**.
3. Nhấn **Kiểm tra định tuyến**:
   - Facet sẽ tạm gán **1 địa chỉ thử** (với `store=active skipassource=true`), kết nối ra dịch vụ phản hồi IP qua IPv6 với `localAddress` gắn đúng địa chỉ thử đó, rồi gỡ địa chỉ thử ngay lập tức.
   - **Nếu IP trả về khớp địa chỉ thử:** Tiền tố `/64` đã định tuyến chuẩn và sẵn sàng dùng.
   - **Nếu không khớp hoặc hết thời gian chờ:** Nhà cung cấp có thể chỉ cấp 1 IPv6 đơn lẻ, chưa bật routed `/64`, hoặc cần cấu hình NDP/định tuyến trong bảng điều khiển VPS.

---

## 3. Vì sao mỗi hồ sơ dùng một IPv6 cố định mặc định?

- Mỗi hồ sơ được gắn ánh xạ **cố định** `profileId -> IPv6` trong SQLite và giữ nguyên qua các lần mở lại, giúp phiên đăng nhập, cookie và ngữ cảnh địa lý ổn định.
- Facet **không** hỗ trợ xoay IP theo từng request hoặc theo từng kết nối. Xoay theo hẹn giờ mặc định **TẮT** và yêu cầu tối thiểu **10 phút** giữa hai lần.
- Mỗi địa chỉ mở một HTTP CONNECT proxy cục bộ chỉ lắng nghe trên **`127.0.0.1`** (cổng ngẫu nhiên) kèm **username/password ngẫu nhiên riêng** cho từng listener.
- **Kill switch IPv6-only:** Listener tự phân giải DNS `AAAA`; nếu đích chỉ có IPv4 hoặc địa chỉ IPv6 bị gỡ giữa chừng, kết nối sẽ thất bại ngay lập tức — **không bao giờ** chuyển sang IPv4 thật của máy.

---

## 4. Giới hạn đã biết

- **Nhiều trang web chưa hỗ trợ IPv6:** Vì kill switch chặn rơi về IPv4 thật, các trang chỉ có bản ghi `A` (IPv4-only) sẽ không truy cập được khi bật Kho IPv6 cục bộ.
- **Dải IP trung tâm dữ liệu / VPS:** Nhiều dịch vụ nhận diện ASN của nhà cung cấp VPS/cloud là hạ tầng chứ không phải mạng dân cư; Facet không hứa hẹn IP "sạch".
- **Độ chính xác vị trí (GeoIP) của IPv6 thường thấp hơn IPv4:** Nên kiểm tra lại múi giờ/ngôn ngữ hoặc đặt thủ công nếu cần độ chính xác cao.

---

## 5. Hướng dẫn gỡ địa chỉ thủ công trên Windows (nếu ứng dụng gặp sự cố)

Khi thoát bình thường, Facet tự động gỡ toàn bộ địa chỉ do app gán (và mọi địa chỉ dùng `store=active` cũng tự mất sau khi khởi động lại Windows). Nếu cần gỡ thủ công bằng PowerShell (Run as Administrator):

```powershell
# 1. Xem danh sách địa chỉ IPv6 hiện có trên card mạng
netsh interface ipv6 show address

# 2. Gỡ từng địa chỉ thuộc dải /64 của bạn (thay Ethernet và địa chỉ ví dụ)
netsh interface ipv6 delete address "Ethernet" 2001:db8:abcd:1::1234 store=active
```

---

## 6. Hướng dẫn tự kiểm tra bằng tay trên Windows (PowerShell)

1. **Kiểm tra gán và tự dọn dẹp:**
   - Trong lúc Facet đang chạy với Kho IPv6, chạy `netsh interface ipv6 show address`: phải thấy các địa chỉ thuộc `/64` của bạn ở trạng thái `Preferred`.
   - Sau khi thoát Facet hoàn toàn, chạy lại `netsh interface ipv6 show address`: các địa chỉ do app gán phải không còn.
2. **Kiểm tra tách biệt và cố định theo hồ sơ:**
   - Mở `https://api64.ipify.org` hoặc `https://ipv6-test.com` trong **hai hồ sơ khác nhau** cùng chọn Proxy = **Kho IPv6 cục bộ**.
   - Hai hồ sơ phải ra hai địa chỉ IPv6 khác nhau; đóng và mở lại từng hồ sơ phải vẫn ra đúng địa chỉ IPv6 cũ của hồ sơ đó.
3. **Kiểm tra Kill Switch:**
   - Trong khi một hồ sơ đang mở, gỡ thủ công địa chỉ IPv6 của hồ sơ đó bằng `netsh interface ipv6 delete address ...` (hoặc tắt IPv6 trên card mạng).
   - Tải lại trang: trình duyệt phải báo lỗi mạng (hoặc hồ sơ tự đóng kèm cảnh báo kill switch), **không bao giờ** tự chuyển sang IP thật.
4. **Kiểm tra chống rò rỉ:**
   - Mở `https://browserleaks.com/webrtc` và trang kiểm tra DNS leak để xác nhận không lộ IP cục bộ hoặc DNS thật.
