import type { BrowserType } from './types';

/**
 * Capability matrix documenting which advanced settings apply to Chromium vs Firefox.
 * UI hides options that are not supported by the selected browser engine.
 */
export interface BrowserCapabilitySupport {
  disableGoogleSync: boolean;
  chromeExtensions: boolean;
  windowPosition: boolean;
  hardwareAcceleration: boolean;
  doNotTrack: boolean;
  notifications: boolean;
  geolocationPrompt: boolean;
  disableAutofill: boolean;
  batterySignal: boolean;
  clientHints: boolean;
}

export function getBrowserCapabilities(browser: BrowserType): BrowserCapabilitySupport {
  if (browser === 'firefox') {
    return {
      disableGoogleSync: false,
      chromeExtensions: false,
      windowPosition: false,
      hardwareAcceleration: true,
      doNotTrack: true,
      notifications: true,
      geolocationPrompt: true,
      disableAutofill: true,
      batterySignal: false,
      clientHints: false,
    };
  }
  return {
    disableGoogleSync: true,
    chromeExtensions: true,
    windowPosition: true,
    hardwareAcceleration: true,
    doNotTrack: true,
    notifications: true,
    geolocationPrompt: true,
    disableAutofill: true,
    batterySignal: true,
    clientHints: true,
  };
}
