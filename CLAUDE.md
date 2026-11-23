Dự án: ứng dụng desktop quản lý nhiều hồ sơ trình duyệt cô lập cho agency, QA, TMĐT.
Stack: Electron + Vite + React + TypeScript + Tailwind + shadcn/ui + SQLite (better-sqlite3, Drizzle) + playwright-core.
Quy tắc:

- TypeScript strict, không dùng any.
- Mọi giao tiếp UI <-> main process qua IPC có type, định nghĩa trong shared/ipc.ts.
- Mỗi profile có thư mục dữ liệu riêng data/profiles/<id>.
- Fingerprint phải NHẤT QUÁN: UA, platform, GPU, độ phân giải, fonts, ngôn ngữ, múi giờ phải khớp nhau và khớp IP proxy.
- Không hardcode secret. Mật khẩu proxy mã hóa bằng Electron safeStorage.
- Mỗi bước: chạy được, có test cơ bản, commit nhỏ.
- Giao diện tiếng Việt, tách chuỗi vào i18n để thêm tiếng Anh sau.
- Không thêm tính năng ngoài yêu cầu của bước hiện tại.

Quy tắc hiệu năng:
- Tách trang phụ bằng `React.lazy` + `Suspense`, không dồn toàn bộ trang vào entry chunk.
- Danh sách dài (bảng hồ sơ) phải ảo hóa (`@tanstack/react-virtual`); không dùng polling, gộp sự kiện trạng thái theo lô.
- Truy vấn SQLite lọc/sắp xếp phải chạy ở SQL có index và bọc thao tác hàng loạt trong transaction.
- Font cục bộ chỉ nạp subset `latin` + `vietnamese`; không đóng gói sẵn binary trình duyệt hay lõi proxy.
- Kiểm tra ngân sách bundle bằng `npm run perf:budget`.

Quy tắc Kho tài khoản & Gmail API:
- Dữ liệu nhạy cảm (password, totp, recovery, notes, OAuth token, Google credentials.json) mã hóa AES-256-GCM + AAD trong `userData/vault.db` tách biệt với `antidetect.db`.
- Renderer KHÔNG BAO GIỜ nhận mật khẩu chữ rõ, khóa bí mật TOTP hoặc refresh token trong luồng thường; mọi IPC xác thực bằng Zod và kiểm tra sender frame.
- Chỉ xin scope `gmail.readonly` (mặc định) hoặc `gmail.modify` (opt-in). TUYỆT ĐỐI không thêm `gmail.send`, không tự động đăng nhập Google, không tạo tài khoản hàng loạt, không giải CAPTCHA.
