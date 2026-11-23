# Facet — Báo cáo Hiệu năng & Tối ưu (PERF.md)

## Cấu hình máy đo

- **OS / Arch**: `win32` / `x64`
- **Node.js**: `v24.13.0`
- **CPU / RAM**: 32 threads / 23.2 GB RAM
- **Script lặp lại**: `npx tsx scripts/perf/benchmark.ts` (dùng dữ liệu giả sinh tự động, 0 dữ liệu thật).
- **Kiểm tra ngân sách hiệu năng**: `npm run perf:budget` (`scripts/perf/check-budget.mjs`).

---

## Bảng so sánh Trước / Sau

| Chỉ số                                            |                  Cơ sở (Bước 0) |                                              Sau tối ưu (Bước 6) |                    Cải thiện |
| :------------------------------------------------ | ------------------------------: | ---------------------------------------------------------------: | ---------------------------: |
| Dung lượng `dist/` (renderer tổng)                |                  **1,393.2 KB** |                                                     **914.6 KB** |       **-34.4% (-478.6 KB)** |
| Renderer entry chunk (`index-*.js`)               |                    **572.2 KB** |                                                     **151.0 KB** |       **-73.6% (-421.2 KB)** |
| Dung lượng `dist-electron/main.js`                |                    **712.0 KB** |                                                     **569.4 KB** |       **-20.0% (-142.6 KB)** |
| Số dependency trực tiếp (`dependencies`)          |                          **22** |                              **23** (+`@tanstack/react-virtual`) |            +1 (4 KB gzipped) |
| `generateConsistentIdentity` (TB 100 lần)         |                    **0.009 ms** |                                                     **0.006 ms** |                   **-33.3%** |
| `checkIdentityConsistency` (TB 100 lần)           |                    **0.007 ms** |                                                     **0.005 ms** |                   **-28.6%** |
| SQLite `list()` 100 profile                       |                    **12.66 ms** |                                                      **4.40 ms** |  **-65.2% (2.9× nhanh hơn)** |
| SQLite `list()` 1,000 profile                     |                    **14.84 ms** |                                                     **11.72 ms** |                   **-21.0%** |
| SQLite lọc + tìm kiếm + sắp xếp (1,000 profile)   |                    **11.05 ms** |                                                      **5.35 ms** |  **-51.6% (2.1× nhanh hơn)** |
| SQLite lọc theo thư mục + sắp xếp (1,000 profile) |                    **10.56 ms** |                                                      **4.81 ms** |  **-54.5% (2.2× nhanh hơn)** |
| SQLite `bulkUpdate` 50 profile                    |                     **30.8 ms** |                                                      **20.8 ms** |                   **-32.5%** |
| SQLite Query Plan (`folder_id` + `created_at`)    | `SCAN profiles` + `TEMP B-TREE` | `SEARCH profiles USING INDEX idx_profiles_active_folder_created` | **0 full scan, 0 temp sort** |
| Heap sau 1,000 profile (Node)                     |      **59.0 MB** (RSS 237.0 MB) |                                       **45.1 MB** (RSS 233.4 MB) |              **-23.6% heap** |
| `detectExecutableVersion` (lần mở thứ 2+)         |    ~1,100 ms (spawn PowerShell) |                           **< 0.1 ms** (cache theo `path:mtime`) |      **>-1,000 ms / lần mở** |

---

## Tối ưu mang lại cải thiện lớn nhất

1. **Subset font cục bộ (`latin` + `vietnamese`)** (Bước 1): cắt giảm **~478 KB** font cyrillic/greek/latin-ext không dùng khỏi `dist/`.
2. **Code splitting theo trang (`React.lazy`) + tách vendor chunks** (Bước 2): cắt giảm entry `index.js` từ **572.2 KB → 151.0 KB (-73.6%)**, trang phụ tải lười khi mở.
3. **5 Index SQLite + WAL/NORMAL/MEMORY + đẩy lọc/sắp xếp xuống SQL + transaction** (Bước 4): bỏ hoàn toàn `SCAN profiles` và `TEMP B-TREE`, tăng tốc truy vấn lọc/tìm kiếm **2.1–2.9×**.
4. **Ảo hóa bảng hồ sơ (`@tanstack/react-virtual`) + debounce tìm kiếm 200ms + `useDeferredValue`** (Bước 3): 1,000+ hàng chỉ mount ~15–20 hàng DOM hiển thị.
5. **Cache `detectExecutableVersion` + hàng đợi `bulkStart` theo lô 3 profile** (Bước 5): tiết kiệm ~1.1 giây mỗi lần khởi chạy trình duyệt trên Windows.

---

## Xác nhận kiểm thử & đối chiếu Detector (Bước 6)

- `npm run test` (Unit): **10/10 file, 50/50 test xanh**.
- Integration trên Chrome thật (`geo-apply.test.ts`, `device-emulation.test.ts`, `advanced-config.test.ts`): **3/3 file, 4/4 test xanh** — xác nhận kết quả fingerprint, geo, Client Hints, iframe/Worker và chế độ real/noise/off không thay đổi sau tối ưu.

---

## Cần xác nhận (KHÔNG tự xóa)

1. `tests/app.test.ts` và `tests/proxy-geo.test.ts`: 2 file test cũ ở thư mục gốc `tests/` có phần trùng với bộ `tests/unit/` hiện tại. Chưa xóa — chờ bạn xác nhận xem có muốn giữ hay gộp.
2. `examples/puppeteer-connect.mjs`: script ví dụ có import `puppeteer-core` (không nằm trong `package.json`, chỉ dùng làm mẫu kết nối từ bên ngoài). Chưa xóa.
3. Thư mục `data/profiles/*` và các bản trình duyệt đã tải của bạn: tuyệt đối giữ nguyên; app cung cấp sẵn IPC `profiles:cleanCache` để bạn dọn cache an toàn khi cần mà không đụng cookie/localStorage.
