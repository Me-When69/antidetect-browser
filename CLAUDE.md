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
