# Lịch trình Bảo trì & Nâng cấp Phụ thuộc — Facet

Tài liệu này quy định quy trình bảo trì định kỳ cho Electron, Node.js, Playwright và chuỗi cung ứng phụ thuộc của Facet để không bao giờ rơi lại vào trạng thái chạy runtime hết hạn hỗ trợ (EOL).

---

## 1. Chu kỳ hỗ trợ Electron

- **Chu kỳ phát hành:** Electron phát hành phiên bản chính (major) mới khoảng **mỗi 8 tuần** (bám sát chu kỳ Chromium).
- **Chính sách hỗ trợ:** Đội ngũ Electron chỉ duy trì bản vá bảo mật cho **3 phiên bản chính mới nhất** (tương đương ~6 tháng hỗ trợ cho mỗi major).
- **Trạng thái hiện tại:** `electron@45.4.1` (Node 24, Chromium 156 — hỗ trợ đến **27/04/2027**).
- **Nguyên tắc:** Lên lịch nâng cấp Electron **ít nhất 1 lần mỗi 2–3 tháng**, không để chậm quá 2 major so với bản stable mới nhất.

---

## 2. Quy trình nâng cấp Electron (Checklist bắt buộc)

1. Tạo nhánh riêng `chore/electron-upgrade-vXX` và gắn tag an toàn trước khi đổi.
2. Đọc _Breaking Changes_ từ phiên bản hiện tại đến phiên bản đích tại `https://www.electronjs.org/docs/latest/breaking-changes`.
3. Quét mã nguồn `electron/` để tìm API đã bị thay đổi/loại bỏ.
4. Cập nhật `electron` trong `package.json` và cài lại (`npm install`).
5. Kiểm tra `scripts/apply-fuses.mjs` xem có thay đổi gì trong `@electron/fuses` không.
6. Chạy đầy đủ bộ kiểm thử:
   - `npm run check:paths && npm run check:secrets`
   - `npm run typecheck && npm run lint && npm run format:check`
   - `npm run test && npm run test:integration && npm run test:e2e`
   - `npm run dist:win` (xác minh `@electron/rebuild` cho `better-sqlite3` và chạy thử `release/win-unpacked/Facet.exe` đã bật Fuses).
7. Cập nhật `docs/ELECTRON_UPGRADE.md` và `CHANGELOG.md`.

---

## 3. Tự động hóa & Giám sát Chuỗi cung ứng

- **Dependabot (`.github/dependabot.yml`):** Quét hàng tuần (thứ Hai) cho cả `npm` và `github-actions`.
- **CodeQL (`.github/workflows/codeql.yml`):** Quét tĩnh mã JavaScript/TypeScript mỗi khi push/PR vào `main` và định kỳ hàng tuần.
- **CI Audit Gate (`.github/workflows/ci.yml`):** Bắt buộc `npm audit --omit=dev --audit-level=high` phải xanh trên mọi PR; **không** chạy `npm audit fix --force` mù quáng.
- **Pin SHA cho GitHub Actions:** Mọi action bên thứ ba trong `.github/workflows/` được ghim theo commit SHA 40 ký tự kèm comment phiên bản (ví dụ `# v4.4.0`). Khi Dependabot tạo PR cập nhật SHA, kiểm tra release notes trước khi merge.
- **Playwright:** Khóa cứng cùng phiên bản chính xác cho `playwright-core` và `@playwright/test` (không dùng `^`).

---

## 4. Cấu hình bảo mật trên GitHub Repository (thủ công)

Các mục cần bật trực tiếp trong **GitHub Repo Settings → Code security**:

- [ ] **Dependabot alerts** & **Dependabot security updates**
- [ ] **Secret scanning** & **Push protection**
- [ ] **Branch protection** cho nhánh `main` (yêu cầu CI `verify` và `CodeQL` xanh trước khi merge)
