# Facet — Báo cáo Hiệu năng & Tối ưu (PERF.md)

## Cấu hình máy đo
- **OS / Arch**: `win32` / `x64`
- **Node.js**: `v24.13.0`
- **CPU / RAM**: 32 threads / 23.2 GB RAM
- **Script lặp lại**: `npx tsx scripts/perf/benchmark.ts` (dùng dữ liệu giả sinh tự động, 0 dữ liệu thật).

---

## Bảng so sánh Trước / Sau

| Chỉ số | Cơ sở (Bước 0) | Sau tối ưu (Bước 6) | Thay đổi |
| :--- | ---: | ---: | ---: |
| Dung lượng `dist/` (renderer tổng) | **1,393.2 KB** | _Đang cập nhật_ | — |
| Renderer main entry chunk (`index-*.js`) | **572.2 KB** | _Đang cập nhật_ | — |
| Dung lượng `dist-electron/main.js` | **712.0 KB** | _Đang cập nhật_ | — |
| Số dependency trực tiếp (`dependencies`) | **22** | _Đang cập nhật_ | — |
| `generateConsistentIdentity` (TB 100 lần) | **0.009 ms** | _Đang cập nhật_ | — |
| `checkIdentityConsistency` (TB 100 lần) | **0.007 ms** | _Đang cập nhật_ | — |
| SQLite `insert` 100 profile | **42.8 ms** | _Đang cập nhật_ | — |
| SQLite `list()` 100 profile | **12.66 ms** | _Đang cập nhật_ | — |
| SQLite `list()` 1,000 profile | **14.84 ms** | _Đang cập nhật_ | — |
| SQLite lọc + tìm kiếm + sắp xếp (1,000 profile) | **11.05 ms** | _Đang cập nhật_ | — |
| SQLite lọc theo thư mục + sắp xếp (1,000 profile) | **10.56 ms** | _Đang cập nhật_ | — |
| SQLite `bulkUpdate` 50 profile | **30.8 ms** | _Đang cập nhật_ | — |
| SQLite Query Plan (`folder_id` + `created_at`) | `SCAN profiles` + `TEMP B-TREE` | _Đang cập nhật_ | — |
| Heap sau 1,000 profile (Node) | **59.0 MB** (RSS 237 MB) | _Đang cập nhật_ | — |

---

## Top 15 gói nặng nhất trong `node_modules` (Cơ sở)
1. `electron`: 290.01 MB (dev/runtime)
2. `lucide-react`: 31.93 MB (tree-shaken trong bundle)
3. `electron-winstaller`: 30.68 MB (dev)
4. `better-sqlite3`: 26.50 MB (native runtime)
5. `typescript`: 22.53 MB (dev)
6. `playwright-core`: 13.32 MB (runtime)
7. `tsx`: 11.67 MB (dev/npx)
8. `prettier`: 10.91 MB (dev)
9. `cpu-features`: 10.29 MB (ssh2 optional)
10. `@esbuild`: 10.13 MB (dev)
11. `drizzle-orm`: 10.03 MB (runtime)
12. `drizzle-kit`: 9.79 MB (dev)
13. `ssh2`: 9.74 MB (runtime — SSH tunnel)
14. `@esbuild-kit`: 9.31 MB (dev)
15. `@babel`: 8.00 MB (dev)

---

## Cần xác nhận (không tự xóa)
- Danh sách các mục nghi ngờ (dùng động, thư mục profile/trình duyệt cũ) sẽ được liệt kê tại đây trong quá trình thực hiện Bước 1–5.
