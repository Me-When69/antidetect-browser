# Đường cơ sở Dự án Facet (PHA 0 Baseline)

**Thời điểm đo:** 2026-11-23 (`v0.2.0`, commit nền `52174cd`)  
**Môi trường đo:** Windows 11 (`10.0.22631`), Node `v24.13.0`, npm `11.6.2`, Electron `36.9.5`, `playwright-core@1.65.1`

---

## 1. Kết quả kiểm thử & độ phủ cơ sở

| Bộ kiểm thử         | Lệnh                       | Kết quả                               | Ghi chú                                           |
| :------------------ | :------------------------- | :------------------------------------ | :------------------------------------------------ |
| TypeScript strict   | `npm run typecheck`        | **PASS** (0 lỗi)                      | 0 `any`, 0 `@ts-ignore`                           |
| ESLint              | `npm run lint`             | **PASS** (0 lỗi)                      |                                                   |
| Prettier            | `npm run format:check`     | **PASS** (0 lỗi)                      |                                                   |
| Personal path guard | `npm run check:paths`      | **PASS** (0 vi phạm)                  | Chặn `file:///`, `C:\Users\`, `/Users/`, `/home/` |
| Secret scan         | `npm run check:secrets`    | **PASS** (0 vi phạm)                  | Kèm cấu hình `.gitleaks.toml`                     |
| Unit tests          | `npm run test:coverage`    | **PASS** (14/14 file, **73/73 test**) | Stmts `46.12%`, Branch `60.41%`, Funcs `61.82%`   |
| Integration tests   | `npm run test:integration` | **PASS** (9/9 file, **12/12 test**)   | Chrome thật + mock local, 0 mạng ngoài            |
| Electron E2E tests  | `npm run test:e2e`         | **PASS** (1/1 file, **3/3 test**)     | `11.8s`                                           |

### Điểm yếu độ phủ cần ưu tiên ở PHA 2

- `electron/services/fingerprint/injector.ts`: `2.38%` stmts
- `electron/services/proxyBridge.ts`: `18.09%` stmts
- `electron/services/browserManager.ts`: `17.93%` stmts
- `electron/services/dataCleaner.ts`: `37.33%` stmts
- `electron/services/launcher.ts`: `47.62%` stmts

---

## 2. Ngân sách dung lượng & hiệu năng (`npm run perf:budget`)

| Thành phần                             |  Hiện tại  |  Ngân sách   | Trạng thái |
| :------------------------------------- | :--------: | :----------: | :--------: |
| `dist/` (tổng renderer + font)         | `982.9 KB` | `<= 1100 KB` |  **PASS**  |
| Entry chunk (`dist/assets/index-*.js`) | `155.0 KB` | `<= 220 KB`  |  **PASS**  |
| Main bundle (`dist-electron/main.js`)  | `556.3 KB` | `<= 650 KB`  |  **PASS**  |

---

## 3. Kiểm toán phụ thuộc & bí mật

- **`npm audit`:** `22` lỗ hổng (`2 critical`, `2 high`, `18 moderate`) — toàn bộ các bản vá còn lại đều là nâng cấp major có breaking change (`electron@45`, `vitest@5`, `archiver@8`, `drizzle-kit`), sẽ xử lý từng gói một ở **PHA 1**.
- **Quét lịch sử git & mã nguồn:** 0 bí mật lộ trong 30 commit gần nhất và toàn bộ file tracked.
- **`.gitignore` & `.gitleaks.toml`:** Đã khóa `vault*`, `credentials.json`, `token*`, `*.db`, `*.db-*`, `*.sqlite*`, `*.eml`, `data/profiles/`, `data/logs/`, `.env*`.

---

## 4. Danh sách đồng bộ nhận diện sang **Facet**

Các vị trí hiện còn chuỗi `antidetect-browser` hoặc `antidetect-app` (chưa tự đổi URL repo vì tên repo trên GitHub do chủ sở hữu đổi):

1. **Tên repo GitHub (chủ sở hữu tự đổi trong GitHub Settings → Repository name):**
   - `Me-When69/antidetect-browser` → đề xuất `Me-When69/facet` _(GitHub tự động chuyển hướng mọi liên kết cũ sang tên mới)_.
2. **Các vị trí cập nhật sau khi đổi tên repo trên GitHub:**
   - `package.json`: `"name": "antidetect-app"` → `"facet"`, `"repository.url": "https://github.com/Me-When69/facet.git"`
   - `README.md` dòng 20 & `README.vi.md` dòng 20: liên kết GitHub Releases
   - `electron/services/localApi.ts` dòng 78: `service: 'antidetect-local-api'` (giữ tương thích ngược nếu script ngoài đang kiểm tra, chỉ đổi khi ra major/minor có thông báo).
