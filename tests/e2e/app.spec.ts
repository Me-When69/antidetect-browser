import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

async function launchTestApp(): Promise<{
  app: ElectronApplication;
  page: Page;
  dataDir: string;
}> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-e2e-'));
  const app = await electron.launch({
    args: [path.resolve('dist-electron/main.js')],
    env: {
      ...process.env,
      ANTIDETECT_DATA_DIR: dataDir,
      NODE_ENV: 'production',
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page, dataDir };
}

test.describe('E2E: Luồng người dùng trên giao diện Electron', () => {
  test('tạo profile mới qua form, nhân bản, sửa, chạy/dừng và xóa profile', async () => {
    const { app, page, dataDir } = await launchTestApp();
    try {
      // 1. Open New Profile form
      await page.getByRole('button', { name: /Hồ sơ mới/i }).first().click();
      await expect(page.getByText('Danh tính này có phù hợp không')).toBeVisible();

      // Fill profile name & set manual geo so no external network needed
      const nameInput = page.locator('#sec-identity input').first();
      await nameInput.fill('E2E Profile Alpha');
      await page.getByRole('button', { name: 'Nhập tay' }).click();

      // Save profile
      await page.getByRole('button', { name: /^Tạo$/ }).click();
      await expect(page.getByText('E2E Profile Alpha', { exact: true })).toBeVisible();

      // 2. Duplicate profile
      await page.getByTitle('Nhân bản').first().click();
      await expect(page.getByText('E2E Profile Alpha (Copy)', { exact: true })).toBeVisible();

      // 3. Start & Stop profile (real Chrome window)
      await page.getByRole('button', { name: /^Chạy$/ }).first().click();
      await expect(page.getByText('Đang chạy').first()).toBeVisible({ timeout: 20_000 });

      await page.getByRole('button', { name: /^Dừng$/ }).first().click();
      await expect(page.getByText('Đã dừng').first()).toBeVisible({ timeout: 10_000 });

      // 4. Delete profile (moves to Trash)
      await page.getByTitle('Xóa').first().click();
      await page.getByRole('button', { name: /Thùng rác/i }).click();
      await expect(page.getByText(/E2E Profile Alpha/)).toBeVisible();
    } finally {
      await app.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('cảnh báo Danh tính này có phù hợp không và nút Sửa tự động hoạt động đúng', async () => {
    const { app, page, dataDir } = await launchTestApp();
    try {
      await page.getByRole('button', { name: /Hồ sơ mới/i }).first().click();

      // Paste a proxy via quick-paste input
      const quickProxyInput = page.locator('#sec-proxy input[placeholder*="host:port"]');
      await quickProxyInput.fill('127.0.0.1:8080:usr:pwd');
      await page.locator('#sec-proxy').getByRole('button', { name: 'Áp dụng' }).click();

      // Deliberately set WebRTC to 'real' with proxy enabled -> triggers error warning
      await page.locator('#sec-fingerprint select').selectOption('real');
      await expect(page.getByText(/WebRTC đang ở chế độ Real/i)).toBeVisible();

      // Click Auto Fix -> warning disappears
      await page.getByRole('button', { name: 'Sửa tự động' }).click();
      await expect(page.getByText('Cấu hình nhất quán, chưa phát hiện xung đột.')).toBeVisible();
    } finally {
      await app.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('nhập proxy sai (port từ chối kết nối) với geo auto: hiện lỗi tiếng Việt và không mở trình duyệt', async () => {
    const { app, page, dataDir } = await launchTestApp();
    try {
      await page.getByRole('button', { name: /Hồ sơ mới/i }).first().click();
      await page.locator('#sec-identity input').first().fill('Broken Proxy Profile');

      const quickProxyInput = page.locator('#sec-proxy input[placeholder*="host:port"]');
      await quickProxyInput.fill('127.0.0.1:1');
      await page.locator('#sec-proxy').getByRole('button', { name: 'Áp dụng' }).click();

      await page.getByRole('button', { name: /^Tạo$/ }).click();
      await expect(page.getByText('Broken Proxy Profile', { exact: true })).toBeVisible();

      await page.getByRole('button', { name: /^Chạy$/ }).first().click();
      await expect(page.getByText(/Không thể kiểm tra proxy/i)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/Proxy từ chối kết nối/i)).toBeVisible();
      await expect(
        page.getByRole('button', { name: /Mở bằng cấu hình geo đã lưu lần trước/i }),
      ).toBeVisible();
    } finally {
      await app.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
