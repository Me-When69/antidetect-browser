import type { Platform, Profile } from '@shared/types';
import type { ResolvedGeo } from '../drivers/BrowserDriver';

function getNavigatorPlatform(platform: Platform): string {
  switch (platform) {
    case 'windows':
      return 'Win32';
    case 'macos':
      return 'MacIntel';
    case 'linux':
      return 'Linux x86_64';
  }
}

function getUaPlatformName(platform: Platform): string {
  switch (platform) {
    case 'windows':
      return 'Windows';
    case 'macos':
      return 'macOS';
    case 'linux':
      return 'Linux';
  }
}

export function buildFingerprintInitScript(profile: Profile, resolvedGeo?: ResolvedGeo): string {
  const majorVersion = profile.browserVersion.split('.')[0] ?? '131';
  const navPlatform = getNavigatorPlatform(profile.platform);
  const uaPlatform = getUaPlatformName(profile.platform);

  const config = {
    platform: navPlatform,
    uaPlatform,
    osVersion: profile.osVersion,
    browserVersion: profile.browserVersion,
    majorVersion,
    cores: profile.fingerprint.hardware.cores,
    memory: profile.fingerprint.hardware.memory,
    screen: profile.fingerprint.screen,
    webgl: profile.fingerprint.webgl,
    canvasNoiseSeed: profile.fingerprint.canvasNoiseSeed,
    audioNoiseSeed: profile.fingerprint.audioNoiseSeed,
    fonts: profile.fingerprint.fonts,
    webrtc: profile.fingerprint.webrtc,
    language: resolvedGeo?.language || profile.geo.language || 'en-US',
    timezone: resolvedGeo?.timezone || profile.geo.timezone || '',
  };

  return `(() => {
    const cfg = ${JSON.stringify(config)};

    // Preserve native-looking Function.prototype.toString for overridden functions
    const nativeToString = Function.prototype.toString;
    const maskedFns = new WeakMap();
    const maskAsNative = (fn, name) => {
      maskedFns.set(fn, 'function ' + (name || fn.name || '') + '() { [native code] }');
      return fn;
    };
    const wrappedToString = function toString() {
      if (maskedFns.has(this)) {
        return maskedFns.get(this);
      }
      return nativeToString.call(this);
    };
    maskedFns.set(wrappedToString, 'function toString() { [native code] }');
    Object.defineProperty(Function.prototype, 'toString', {
      value: wrappedToString,
      configurable: true,
      writable: true,
    });

    const defineGetter = (target, prop, getter) => {
      try {
        Object.defineProperty(target, prop, {
          get: maskAsNative(getter, 'get ' + prop),
          configurable: true,
        });
      } catch {}
    };

    // Deterministic PRNG (Mulberry32)
    const createRng = (seed) => {
      let a = seed >>> 0;
      return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };

    // Navigator overrides
    defineGetter(Navigator.prototype, 'hardwareConcurrency', () => cfg.cores);
    defineGetter(Navigator.prototype, 'deviceMemory', () => cfg.memory);
    defineGetter(Navigator.prototype, 'platform', () => cfg.platform);
    defineGetter(Navigator.prototype, 'webdriver', () => false);

    if (cfg.language) {
      const baseLang = cfg.language.split('-')[0] || 'en';
      const langs = cfg.language === baseLang ? [cfg.language] : [cfg.language, baseLang];
      defineGetter(Navigator.prototype, 'language', () => cfg.language);
      defineGetter(Navigator.prototype, 'languages', () => Object.freeze([...langs]));
    }

    // Ensure Intl.DateTimeFormat().resolvedOptions().timeZone matches across main frame & iframes
    if (cfg.timezone && typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
      const origResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
      Intl.DateTimeFormat.prototype.resolvedOptions = maskAsNative(function resolvedOptions() {
        const opts = origResolvedOptions.call(this);
        return Object.assign({}, opts, { timeZone: cfg.timezone });
      }, 'resolvedOptions');
    }

    // Client Hints (navigator.userAgentData)
    const brands = [
      { brand: 'Google Chrome', version: cfg.majorVersion },
      { brand: 'Chromium', version: cfg.majorVersion },
      { brand: 'Not_A Brand', version: '24' },
    ];
    const uaData = {
      brands,
      mobile: false,
      platform: cfg.uaPlatform,
      getHighEntropyValues: maskAsNative(async (hints) => {
        const result = {
          brands,
          mobile: false,
          platform: cfg.uaPlatform,
        };
        if (Array.isArray(hints)) {
          if (hints.includes('platformVersion')) result.platformVersion = cfg.osVersion.includes('11') ? '15.0.0' : '10.0.0';
          if (hints.includes('architecture')) result.architecture = cfg.uaPlatform === 'macOS' ? 'arm' : 'x86';
          if (hints.includes('bitness')) result.bitness = '64';
          if (hints.includes('uaFullVersion')) result.uaFullVersion = cfg.browserVersion;
          if (hints.includes('fullVersionList')) {
            result.fullVersionList = brands.map((b) => ({ brand: b.brand, version: cfg.browserVersion }));
          }
        }
        return result;
      }, 'getHighEntropyValues'),
      toJSON: maskAsNative(() => ({ brands, mobile: false, platform: cfg.uaPlatform }), 'toJSON'),
    };
    defineGetter(Navigator.prototype, 'userAgentData', () => uaData);

    // Screen & DPR overrides
    defineGetter(Screen.prototype, 'width', () => cfg.screen.width);
    defineGetter(Screen.prototype, 'height', () => cfg.screen.height);
    defineGetter(Screen.prototype, 'availWidth', () => cfg.screen.width);
    defineGetter(Screen.prototype, 'availHeight', () => Math.max(200, cfg.screen.height - 40));
    defineGetter(Screen.prototype, 'colorDepth', () => 24);
    defineGetter(Screen.prototype, 'pixelDepth', () => 24);
    defineGetter(window, 'devicePixelRatio', () => cfg.screen.dpr);

    // WebGL vendor & renderer
    const patchWebGL = (proto) => {
      if (!proto || !proto.getParameter) return;
      const origGetParameter = proto.getParameter;
      proto.getParameter = maskAsNative(function getParameter(param) {
        if (param === 37445 && cfg.webgl.vendor) return cfg.webgl.vendor;
        if (param === 37446 && cfg.webgl.renderer) return cfg.webgl.renderer;
        return origGetParameter.call(this, param);
      }, 'getParameter');
    };
    if (typeof WebGLRenderingContext !== 'undefined') patchWebGL(WebGLRenderingContext.prototype);
    if (typeof WebGL2RenderingContext !== 'undefined') patchWebGL(WebGL2RenderingContext.prototype);

    // Deterministic Canvas 2D noise
    if (typeof HTMLCanvasElement !== 'undefined' && cfg.canvasNoiseSeed) {
      const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      const applyCanvasNoise = (data) => {
        const rng = createRng(cfg.canvasNoiseSeed);
        const step = Math.max(4, Math.floor(data.length / 64));
        for (let i = 0; i < data.length; i += step) {
          const delta = rng() > 0.5 ? 1 : -1;
          data[i] = Math.max(0, Math.min(255, data[i] + delta));
        }
      };

      CanvasRenderingContext2D.prototype.getImageData = maskAsNative(function getImageData(x, y, w, h) {
        const img = origGetImageData.call(this, x, y, w, h);
        applyCanvasNoise(img.data);
        return img;
      }, 'getImageData');

      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = maskAsNative(function toDataURL(...args) {
        try {
          const ctx = this.getContext('2d');
          if (ctx && this.width > 0 && this.height > 0 && this.width * this.height <= 400000) {
            const img = origGetImageData.call(ctx, 0, 0, this.width, this.height);
            applyCanvasNoise(img.data);
            ctx.putImageData(img, 0, 0);
          }
        } catch {}
        return origToDataURL.apply(this, args);
      }, 'toDataURL');
    }

    // Deterministic AudioContext noise
    if (typeof AudioBuffer !== 'undefined' && cfg.audioNoiseSeed) {
      const origGetChannelData = AudioBuffer.prototype.getChannelData;
      AudioBuffer.prototype.getChannelData = maskAsNative(function getChannelData(channel) {
        const data = origGetChannelData.call(this, channel);
        const rng = createRng(cfg.audioNoiseSeed + channel);
        for (let i = 0; i < data.length; i += 100) {
          data[i] = data[i] + (rng() - 0.5) * 1e-7;
        }
        return data;
      }, 'getChannelData');
    }

    // WebRTC protection
    if (cfg.webrtc === 'disable') {
      const blocked = maskAsNative(function RTCPeerConnection() {
        throw new DOMException('WebRTC is disabled by profile policy', 'NotAllowedError');
      }, 'RTCPeerConnection');
      try {
        window.RTCPeerConnection = blocked;
        window.webkitRTCPeerConnection = blocked;
      } catch {}
    } else if (cfg.webrtc === 'replace' && typeof window.RTCPeerConnection === 'function') {
      const OrigRTC = window.RTCPeerConnection;
      const WrappedRTC = maskAsNative(function RTCPeerConnection(rtcConfig, constraints) {
        const safeConfig = Object.assign({}, rtcConfig || {}, { iceTransportPolicy: 'relay' });
        const pc = new OrigRTC(safeConfig, constraints);
        const origAddEventListener = pc.addEventListener.bind(pc);
        pc.addEventListener = maskAsNative(function addEventListener(type, listener, options) {
          if (type === 'icecandidate' && typeof listener === 'function') {
            const filtered = function (ev) {
              if (ev && ev.candidate && typeof ev.candidate.candidate === 'string') {
                if (/typ host|192\\.168\\.|10\\.|172\\.(1[6-9]|2\\d|3[01])\\./i.test(ev.candidate.candidate)) {
                  return;
                }
              }
              return listener.call(this, ev);
            };
            return origAddEventListener(type, filtered, options);
          }
          return origAddEventListener(type, listener, options);
        }, 'addEventListener');
        return pc;
      }, 'RTCPeerConnection');
      WrappedRTC.prototype = OrigRTC.prototype;
      window.RTCPeerConnection = WrappedRTC;
    }
  })();`;
}
