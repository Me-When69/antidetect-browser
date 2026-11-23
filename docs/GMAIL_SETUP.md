# Hướng dẫn cấu hình Google Cloud & Gmail API cho Facet

Facet sử dụng **Gmail API chính thức** thông qua OAuth 2.0 (Desktop Loopback + PKCE) bằng chính dự án Google Cloud của bạn.

> **Tại sao Facet không đóng gói sẵn `credentials.json` dùng chung?**
> - Mỗi file OAuth Desktop App có `client_id` và hạn mức quota gắn với một dự án Google Cloud cụ thể.
> - Đóng gói khóa chung vào mã nguồn mở vi phạm nguyên tắc bảo mật và khiến toàn bộ người dùng bị Google thu hồi hoặc giới hạn quota.
> - Tự tạo dự án riêng đảm bảo **dữ liệu và token của bạn chỉ kết nối trực tiếp giữa máy bạn và Google**, không qua bất kỳ máy chủ trung gian nào.

---

## Bước 1: Tạo dự án trên Google Cloud Console

1. Truy cập [Google Cloud Console](https://console.cloud.google.com/).
2. Nhấn chọn danh sách dự án ở góc trên bên trái → **New Project** (ví dụ: `Facet Gmail Personal`).
3. Chọn dự án vừa tạo.

## Bước 2: Bật Gmail API

1. Vào **APIs & Services → Library**.
2. Tìm **Gmail API** → nhấn **Enable**.

## Bước 3: Cấu hình OAuth Consent Screen

1. Vào **Google Auth Platform / APIs & Services → OAuth consent screen**.
2. Chọn **External** (nếu dùng tài khoản `@gmail.com` cá nhân) → **Create**.
3. Điền các trường bắt buộc (App name: `Facet Local`, User support email, Developer contact email) → **Save and Continue**.
4. Tại mục **Scopes**, thêm một trong hai scope (tùy nhu cầu):
   - `https://www.googleapis.com/auth/gmail.readonly` (mặc định — chỉ đọc, tìm kiếm, sao lưu `.eml`).
   - `https://www.googleapis.com/auth/gmail.modify` (tùy chọn — chỉ cần nếu bạn muốn đánh dấu đã đọc, gắn sao, lưu trữ, chuyển vào thùng rác).
   - **Không cần và không nên thêm `gmail.send`** — Facet chủ động chặn hoàn toàn phạm vi gửi thư.
5. Tại mục **Test users**, thêm các địa chỉ Gmail bạn muốn kết nối (tối đa **100 test users** ở chế độ Testing).

## Bước 4: Tạo OAuth Client ID (Desktop App)

1. Vào **APIs & Services → Credentials → + Create Credentials → OAuth client ID**.
2. Application type: chọn **Desktop app**.
3. Đặt tên (ví dụ: `Facet Desktop`) → **Create**.
4. Nhấn **Download JSON** để tải file `credentials.json`.

## Bước 5: Nhập `credentials.json` vào Facet

1. Mở Facet → mục **Tài khoản** → mở khóa kho tài khoản.
2. Nhấn **Cài đặt kho → Nhập credentials.json** và chọn file vừa tải.
3. File `credentials.json` sẽ được **mã hóa bằng AES-256-GCM** bên trong `vault.db`. Bạn có thể xóa file gốc khỏi thư mục Downloads sau khi nhập.

---

## Giới hạn của Google ở chế độ Testing (Rất quan trọng)

- **Refresh token hết hạn sau 7 ngày:** Khi ứng dụng OAuth ở trạng thái **Testing** (chưa qua quy trình Google Verification), Google tự động thu hồi refresh token sau **7 ngày**. Khi đó, Facet sẽ đánh dấu tài khoản là **Cần cấp quyền lại** — bạn chỉ cần nhấn **Cấp quyền lại** để gia hạn.
- **Tối đa 100 Test Users:** Bạn chỉ có thể cấp quyền cho những email đã thêm vào danh sách **Test users** trên Google Cloud Console.
- **Không tự động đăng nhập:** Khi cấp quyền, Facet mở **trình duyệt hệ thống mặc định** tới trang xác nhận OAuth của Google; bạn tự đăng nhập và bấm cho phép thủ công.
