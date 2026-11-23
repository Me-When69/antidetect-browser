# Báo cáo Kiểm toán Phụ thuộc (`npm audit`) — PHA 1.1

**Thời điểm kiểm toán:** 2026-11-23 (`v0.2.0`, trước nâng cấp PHA 1)  
**Ngưỡng mục tiêu CI:** **0 lỗ hổng `high` hoặc `critical` ở `dependencies` (`npm audit --omit=dev`)**; ghi nhận & xử lý dần `devDependencies`.

---

## 1. Phụ thuộc Production (`npm audit --omit=dev`)

**Tổng:** `6 moderate` | `0 high` | `0 critical`

| Gói                                                 | Mức độ   | Phạm vi                     | Đường dẫn phụ thuộc                               | Có bản vá không               | Phá tương thích?                        | Kế hoạch xử lý                                                                                                                                                         |
| :-------------------------------------------------- | :------- | :-------------------------- | :------------------------------------------------ | :---------------------------- | :-------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `archiver` (`7.0.1`)                                | Moderate | `dependencies` (direct)     | `archiver -> archiver-utils -> glob -> minimatch` | Có (`archiver@8.0.0`)         | **Có** (phá `archiver-zip-encrypted@2`) | **PHA 1.4:** Gỡ bỏ hoàn toàn `archiver` + `archiver-zip-encrypted`, thay bằng định dạng `.facet-eml` AES-256-GCM dùng `node:crypto` + `node:zlib` (0 phụ thuộc ngoài). |
| `archiver-zip-encrypted` (`2.0.0`)                  | Moderate | `dependencies` (direct)     | `archiver-zip-encrypted -> archiver`              | Không có bản cho `archiver@8` | **Có**                                  | **PHA 1.4:** Gỡ bỏ cùng `archiver`, giữ bộ giải mã đọc tương thích ngược file `.zip` cũ.                                                                               |
| `archiver-utils`, `zip-stream`, `glob`, `minimatch` | Moderate | `dependencies` (transitive) | Kéo theo bởi `archiver@7`                         | Tự hết khi gỡ `archiver@7`    | Không                                   | **PHA 1.4:** Tự động loại bỏ sạch sau khi gỡ `archiver` → **`npm audit --omit=dev` đạt 0 lỗ hổng**.                                                                    |

---

## 2. Phụ thuộc Phát triển (`devDependencies` trong `npm audit`)

**Tổng toàn bộ (prod + dev):** `2 critical` | `2 high` | `18 moderate` (`total: 22`)

| Gói                                                                         | Mức độ       | Phạm vi                          | Đường dẫn phụ thuộc                                     | Có bản vá không                 | Phá tương thích?                                     | Kế hoạch xử lý                                                                                                                                                    |
| :-------------------------------------------------------------------------- | :----------- | :------------------------------- | :------------------------------------------------------ | :------------------------------ | :--------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vitest` (`3.2.7`) & `tinypool`                                             | **Critical** | `devDependencies` (direct/trans) | `vitest -> tinypool` / `@vitest/mocker`                 | Có (`vitest@4/5`)               | **Có** (major bump)                                  | **PHA 1.5:** Nâng `vitest` + `@vitest/coverage-v8` lên bản đã vá, chạy lại toàn bộ unit + integration test.                                                       |
| `electron` (`36.9.5`) & `extract-zip`                                       | **High**     | `devDependencies` (direct/trans) | `electron -> extract-zip`                               | Có (`electron@45.4.1`)          | **Có** (EOL 36 -> 45, Node 24, ABI `better-sqlite3`) | **PHA 1.6:** Nâng trên nhánh riêng `chore/electron-upgrade`, rà soát breaking changes, rebuild `better-sqlite3`, bật Electron Fuses, kiểm tra E2E & bản đóng gói. |
| `@vitest/coverage-v8`, `test-exclude`                                       | Moderate     | `devDependencies`                | `@vitest/coverage-v8 -> test-exclude -> glob/minimatch` | Có (cùng `vitest`)              | **Có**                                               | **PHA 1.5:** Nâng đồng bộ cùng `vitest`.                                                                                                                          |
| `drizzle-kit` & `esbuild`                                                   | Moderate     | `devDependencies`                | `drizzle-kit -> @esbuild-kit/* -> esbuild@0.24`         | Chỉ có bản downgrade            | **Có**                                               | Ghi nhận (chỉ là CLI dev không dùng ở runtime; theo dõi bản `drizzle-kit` mới bỏ `@esbuild-kit`).                                                                 |
| `electron-builder`, `app-builder-lib`, `@electron/universal`, `dmg-builder` | Moderate     | `devDependencies`                | `electron-builder -> app-builder-lib -> minimatch`      | Chờ upstream `electron-builder` | Không ảnh hưởng runtime                              | Ghi nhận (chỉ chạy lúc đóng gói build, không đóng gói vào app).                                                                                                   |

---

## 3. Kết quả Sau PHA 1 (2026-11-23 — Nhánh `chore/electron-upgrade`)

| Phạm vi kiểm tra                        | Trước PHA 1 (`v0.2.0`)                              | Sau PHA 1                                                     | Trạng thái                                         |
| :-------------------------------------- | :-------------------------------------------------- | :------------------------------------------------------------ | :------------------------------------------------- |
| **`npm audit --omit=dev`** (Production) | `6 moderate` (`0 high`, `0 critical`)               | **`0 total`** (`0 critical`, `0 high`, `0 moderate`, `0 low`) | **ĐẠT** (gỡ `archiver` + `archiver-zip-encrypted`) |
| **`npm audit`** (Toàn bộ prod + dev)    | `2 critical`, `2 high`, `18 moderate` (`total: 22`) | **`0 critical`, `0 high`**, `10 moderate` (`total: 10`)       | **ĐẠT** (nâng `vitest@5.1.1` & `electron@45.4.1`)  |

- **10 moderate còn lại** chỉ nằm trong `devDependencies` (`drizzle-kit` và `electron-builder`), không được đóng gói vào ứng dụng production và được theo dõi định kỳ bởi Dependabot (`.github/dependabot.yml`).
