import path from 'node:path';
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses';

/**
 * electron-builder afterPack hook: hardens the packaged production executable
 * with Electron Fuses without affecting dev builds or unpackaged Playwright E2E.
 */
export default async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const productName = packager.appInfo.productFilename;

  let executablePath;
  if (electronPlatformName === 'win32') {
    executablePath = path.join(appOutDir, `${productName}.exe`);
  } else if (electronPlatformName === 'darwin') {
    executablePath = path.join(appOutDir, `${productName}.app`);
  } else {
    executablePath = path.join(appOutDir, productName);
  }

  console.log(`[apply-fuses] Flipping production Electron Fuses on: ${executablePath}`);
  await flipFuses(executablePath, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
}
