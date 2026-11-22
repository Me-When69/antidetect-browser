import type { Platform, Profile } from '@shared/types';
import {
  normalizeBehavior,
  normalizeMediaDevices,
  normalizeSignals,
} from '@shared/advancedDefaults';
import type { ResolvedGeo } from '../drivers/BrowserDriver';

function getNavigatorPlatform(platform: Platform): string {
  switch (platform) {
    case 'windows':
      return 'Win32';
    case 'macos':
      return 'MacIntel';
    case 'linux':
      return 'Linux x86_64';
    case 'android':
      return 'Linux armv8l';
    case 'ios':
      return 'iPhone';
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
    case 'android':
      return 'Android';
    case 'ios':
      return 'iOS';
  }
}

export function buildFingerprintInitScript(profile: Profile, resolvedGeo?: ResolvedGeo): string {
  const majorVersion = profile.browserVersion.split('.')[0] ?? '136';
  const navPlatform = getNavigatorPlatform(profile.platform);
  const uaPlatform = getUaPlatformName(profile.platform);
  const isMobile =
    profile.fingerprint.mobile ?? (profile.platform === 'android' || profile.platform === 'ios');
  const isIos = profile.platform === 'ios';
  const exposeClientHints = !isIos && profile.browser !== 'firefox';
  const defaultPlatformVersion =
    profile.platform === 'windows'
      ? profile.osVersion.includes('11')
        ? '15.0.0'
        : '10.0.0'
      : profile.platform === 'macos'
        ? '14.5.0'
        : profile.platform === 'android'
          ? '14.0.0'
          : '6.5.0';
  const defaultArchitecture =
    profile.platform === 'macos' || profile.platform === 'android' ? 'arm' : 'x86';

  const signals = normalizeSignals(profile.fingerprint.signals);
  const mediaDevices = normalizeMediaDevices(profile.mediaDevices);
  const behavior = normalizeBehavior(profile.behavior);

  const config = {
    platform: navPlatform,
    uaPlatform,
    osVersion: profile.osVersion,
    browser: profile.browser,
    browserVersion: profile.browserVersion,
    majorVersion,
    isMobile,
    isIos,
    exposeClientHints,
    maxTouchPoints: profile.fingerprint.maxTouchPoints ?? (isMobile ? 5 : 0),
    model: profile.fingerprint.model ?? '',
    architecture: profile.fingerprint.architecture || defaultArchitecture,
    bitness: profile.fingerprint.bitness || '64',
    platformVersion: profile.fingerprint.platformVersion || defaultPlatformVersion,
    cores: profile.fingerprint.hardware.cores,
    memory: profile.fingerprint.hardware.memory,
    screen: profile.fingerprint.screen,
    webgl: profile.fingerprint.webgl,
    canvasNoiseSeed: profile.fingerprint.canvasNoiseSeed,
    audioNoiseSeed: profile.fingerprint.audioNoiseSeed,
    fonts: profile.fingerprint.fonts,
    webrtc: profile.fingerprint.webrtc,
    signals,
    mediaDevices,
    behavior,
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
    if (!cfg.exposeClientHints) {
      defineGetter(Navigator.prototype, 'userAgentData', () => undefined);
    } else {
      const brands = [
        { brand: 'Google Chrome', version: cfg.majorVersion },
        { brand: 'Chromium', version: cfg.majorVersion },
        { brand: 'Not_A Brand', version: '24' },
      ];
      const uaData = {
        brands,
        mobile: cfg.isMobile,
        platform: cfg.uaPlatform,
        getHighEntropyValues: maskAsNative(async (hints) => {
          const result = {
            brands,
            mobile: cfg.isMobile,
            platform: cfg.uaPlatform,
          };
          if (Array.isArray(hints)) {
            if (hints.includes('platformVersion')) result.platformVersion = cfg.platformVersion;
            if (hints.includes('architecture')) result.architecture = cfg.architecture;
            if (hints.includes('bitness')) result.bitness = cfg.bitness;
            if (hints.includes('model')) result.model = cfg.model;
            if (hints.includes('uaFullVersion')) result.uaFullVersion = cfg.browserVersion;
            if (hints.includes('fullVersionList')) {
              result.fullVersionList = brands.map((b) => ({
                brand: b.brand,
                version: b.brand === 'Not_A Brand' ? '24.0.0.0' : cfg.browserVersion,
              }));
            }
          }
          return result;
        }, 'getHighEntropyValues'),
        toJSON: maskAsNative(
          () => ({ brands, mobile: cfg.isMobile, platform: cfg.uaPlatform }),
          'toJSON',
        ),
      };
      defineGetter(Navigator.prototype, 'userAgentData', () => uaData);
    }

    // Touch & Mobile overrides
    defineGetter(Navigator.prototype, 'maxTouchPoints', () => cfg.maxTouchPoints);
    if (cfg.isMobile) {
      try {
        if (!('ontouchstart' in window)) {
          Object.defineProperty(window, 'ontouchstart', {
            value: null,
            writable: true,
            configurable: true,
          });
        }
      } catch {}
      defineGetter(window, 'orientation', () => 0);
      if (typeof ScreenOrientation !== 'undefined' && screen.orientation) {
        const isLandscape = cfg.screen.width > cfg.screen.height;
        defineGetter(ScreenOrientation.prototype, 'type', () =>
          isLandscape ? 'landscape-primary' : 'portrait-primary',
        );
        defineGetter(ScreenOrientation.prototype, 'angle', () => (isLandscape ? 90 : 0));
      }
      // Hide desktop-only plugins on mobile
      defineGetter(Navigator.prototype, 'plugins', () => {
        const empty = [];
        empty.item = () => null;
        empty.namedItem = () => null;
        empty.refresh = () => {};
        return empty;
      });
      // MatchMedia coarse pointer / no hover for mobile devices
      if (typeof window.matchMedia === 'function') {
        const origMatchMedia = window.matchMedia.bind(window);
        window.matchMedia = maskAsNative(function matchMedia(query) {
          const mql = origMatchMedia(query);
          const q = String(query).toLowerCase().replace(/\\s+/g, ' ').trim();
          let forced = null;
          if (q.includes('pointer: coarse') || q.includes('any-pointer: coarse')) forced = true;
          else if (q.includes('pointer: fine') || q.includes('any-pointer: fine')) forced = false;
          else if (q.includes('hover: none') || q.includes('any-hover: none')) forced = true;
          else if (q.includes('hover: hover') || q.includes('any-hover: hover')) forced = false;
          if (forced === null) return mql;
          return new Proxy(mql, {
            get(target, prop) {
              if (prop === 'matches') return forced;
              const val = target[prop];
              return typeof val === 'function' ? val.bind(target) : val;
            },
          });
        }, 'matchMedia');
      }
    }

    // Screen & DPR overrides
    defineGetter(Screen.prototype, 'width', () => cfg.screen.width);
    defineGetter(Screen.prototype, 'height', () => cfg.screen.height);
    defineGetter(Screen.prototype, 'availWidth', () => cfg.screen.width);
    defineGetter(Screen.prototype, 'availHeight', () =>
      cfg.isMobile ? cfg.screen.height : Math.max(200, cfg.screen.height - 40),
    );
    defineGetter(Screen.prototype, 'colorDepth', () => 24);
    defineGetter(Screen.prototype, 'pixelDepth', () => 24);
    defineGetter(window, 'devicePixelRatio', () => cfg.screen.dpr);

    // WebGL signal (real / noise / off) & WebGL metadata (custom / real)
    if (cfg.signals.webgl === 'off' && typeof HTMLCanvasElement !== 'undefined') {
      const origGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = maskAsNative(function getContext(type, ...rest) {
        if (type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2') {
          return null;
        }
        return origGetContext.call(this, type, ...rest);
      }, 'getContext');
    } else {
      const patchWebGL = (proto) => {
        if (!proto) return;
        if (cfg.signals.webglMetadata === 'custom' && proto.getParameter) {
          const origGetParameter = proto.getParameter;
          proto.getParameter = maskAsNative(function getParameter(param) {
            if (param === 37445 && cfg.webgl.vendor) return cfg.webgl.vendor;
            if (param === 37446 && cfg.webgl.renderer) return cfg.webgl.renderer;
            return origGetParameter.call(this, param);
          }, 'getParameter');
        }
        if (cfg.signals.webgl === 'noise' && proto.readPixels) {
          const origReadPixels = proto.readPixels;
          proto.readPixels = maskAsNative(function readPixels(x, y, w, h, format, type, pixels) {
            const res = origReadPixels.call(this, x, y, w, h, format, type, pixels);
            if (pixels && typeof pixels.length === 'number' && pixels.length > 0) {
              const rng = createRng((cfg.canvasNoiseSeed || 1) + 77);
              const step = Math.max(4, Math.floor(pixels.length / 64));
              for (let i = 0; i < pixels.length; i += step) {
                const delta = rng() > 0.5 ? 1 : -1;
                pixels[i] = Math.max(0, Math.min(255, pixels[i] + delta));
              }
            }
            return res;
          }, 'readPixels');
        }
      };
      if (typeof WebGLRenderingContext !== 'undefined') patchWebGL(WebGLRenderingContext.prototype);
      if (typeof WebGL2RenderingContext !== 'undefined') patchWebGL(WebGL2RenderingContext.prototype);
    }

    // Canvas 2D signal (real / noise / off)
    if (typeof HTMLCanvasElement !== 'undefined' && cfg.signals.canvas !== 'real') {
      const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;

      if (cfg.signals.canvas === 'off') {
        const BLANK_PNG =
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
        CanvasRenderingContext2D.prototype.getImageData = maskAsNative(function getImageData(x, y, w, h) {
          const img = origGetImageData.call(this, x, y, w, h);
          img.data.fill(0);
          return img;
        }, 'getImageData');
        HTMLCanvasElement.prototype.toDataURL = maskAsNative(function toDataURL() {
          return BLANK_PNG;
        }, 'toDataURL');
      } else if (cfg.signals.canvas === 'noise' && cfg.canvasNoiseSeed) {
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
    }

    // AudioContext signal (real / noise / off)
    if (typeof AudioBuffer !== 'undefined' && cfg.signals.audio !== 'real') {
      const origGetChannelData = AudioBuffer.prototype.getChannelData;
      if (cfg.signals.audio === 'off') {
        AudioBuffer.prototype.getChannelData = maskAsNative(function getChannelData(channel) {
          const data = origGetChannelData.call(this, channel);
          data.fill(0);
          return data;
        }, 'getChannelData');
      } else if (cfg.signals.audio === 'noise' && cfg.audioNoiseSeed) {
        AudioBuffer.prototype.getChannelData = maskAsNative(function getChannelData(channel) {
          const data = origGetChannelData.call(this, channel);
          const rng = createRng(cfg.audioNoiseSeed + channel);
          for (let i = 0; i < data.length; i += 100) {
            data[i] = data[i] + (rng() - 0.5) * 1e-7;
          }
          return data;
        }, 'getChannelData');
      }
    }

    // ClientRects deterministic sub-pixel noise
    if (cfg.signals.clientRects === 'noise' && typeof Element !== 'undefined') {
      const rectRng = createRng((cfg.canvasNoiseSeed || 1) + 313);
      const jitterX = (rectRng() - 0.5) * 0.0004;
      const jitterY = (rectRng() - 0.5) * 0.0004;
      const origElRect = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = maskAsNative(function getBoundingClientRect() {
        const r = origElRect.call(this);
        if (typeof DOMRect === 'function') {
          return new DOMRect(r.x + jitterX, r.y + jitterY, r.width + jitterX, r.height + jitterY);
        }
        return r;
      }, 'getBoundingClientRect');
    }

    // Custom Fonts check filter
    if (cfg.signals.fonts === 'custom' && typeof document !== 'undefined' && document.fonts && document.fonts.check) {
      const allowedFonts = new Set(
        (cfg.fonts || []).map((f) => String(f).toLowerCase()).concat(['serif', 'sans-serif', 'monospace', 'system-ui', 'cursive', 'fantasy']),
      );
      const origCheck = document.fonts.check.bind(document.fonts);
      document.fonts.check = maskAsNative(function check(font, text) {
        try {
          const familyPart = String(font).split(',').pop() || '';
          const cleaned = familyPart.replace(/["']/g, '').trim().split(/\\s+/).slice(-2).join(' ').toLowerCase();
          if (cleaned && !Array.from(allowedFonts).some((f) => cleaned.includes(f))) {
            return false;
          }
        } catch {}
        return origCheck(font, text);
      }, 'check');
    }

    // Speech Voices (real / custom / off)
    if (typeof window.speechSynthesis !== 'undefined' && cfg.signals.speechVoices !== 'real') {
      if (cfg.signals.speechVoices === 'off') {
        window.speechSynthesis.getVoices = maskAsNative(function getVoices() {
          return [];
        }, 'getVoices');
      } else if (cfg.signals.speechVoices === 'custom') {
        const lang = cfg.language || 'en-US';
        const voiceName =
          cfg.uaPlatform === 'macOS'
            ? 'Samantha'
            : cfg.uaPlatform === 'Linux'
              ? 'English (America)'
              : 'Microsoft David - English (United States)';
        const fakeVoices = Object.freeze([
          Object.freeze({
            default: true,
            lang,
            localService: true,
            name: voiceName,
            voiceURI: voiceName,
          }),
        ]);
        window.speechSynthesis.getVoices = maskAsNative(function getVoices() {
          return [...fakeVoices];
        }, 'getVoices');
      }
    }

    // Battery API (real / off -> neutral full battery, never throws)
    if (cfg.signals.battery === 'off' && typeof Navigator !== 'undefined') {
      const neutralBattery = Object.freeze({
        charging: true,
        chargingTime: 0,
        dischargingTime: Infinity,
        level: 1,
        onchargingchange: null,
        onchargingtimechange: null,
        ondischargingtimechange: null,
        onlevelchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      });
      Navigator.prototype.getBattery = maskAsNative(function getBattery() {
        return Promise.resolve(neutralBattery);
      }, 'getBattery');
    }

    // Localhost / Private-LAN Port Scan Protection (active on non-localhost pages)
    if (cfg.signals.portScanProtect) {
      const isPrivateHost = (h) =>
        /^(localhost|127\\.|0\\.0\\.0\\.0|\\[::1\\]|10\\.|192\\.168\\.|172\\.(1[6-9]|2\\d|3[01])\\.)/i.test(h);
      const pageIsLocal = typeof location !== 'undefined' && isPrivateHost(location.hostname || '');
      if (!pageIsLocal) {
        if (typeof window.fetch === 'function') {
          const origFetch = window.fetch.bind(window);
          window.fetch = maskAsNative(function fetch(input, init) {
            try {
              const urlStr = typeof input === 'string' ? input : input && input.url ? input.url : '';
              const parsed = new URL(urlStr, location.href);
              if (isPrivateHost(parsed.hostname)) {
                return Promise.reject(new TypeError('Failed to fetch'));
              }
            } catch {}
            return origFetch(input, init);
          }, 'fetch');
        }
        if (typeof window.WebSocket === 'function') {
          const OrigWS = window.WebSocket;
          const WrappedWS = maskAsNative(function WebSocket(url, protocols) {
            const parsed = new URL(String(url), location.href);
            if (isPrivateHost(parsed.hostname)) {
              throw new DOMException('Blocked local port scan', 'SecurityError');
            }
            return protocols !== undefined ? new OrigWS(url, protocols) : new OrigWS(url);
          }, 'WebSocket');
          WrappedWS.prototype = OrigWS.prototype;
          window.WebSocket = WrappedWS;
        }
      }
    }

    // Media Devices (real / fake with deterministic deviceId & labels per profile seed)
    if (cfg.mediaDevices && cfg.mediaDevices.mode === 'fake' && navigator.mediaDevices) {
      const mdRng = createRng((cfg.canvasNoiseSeed || 1) + 997);
      const makeHex = (len) => {
        let out = '';
        for (let i = 0; i < len; i += 1) {
          out += Math.floor(mdRng() * 16).toString(16);
        }
        return out;
      };
      const fakeList = [];
      const groupId = makeHex(64);
      for (let i = 0; i < (cfg.mediaDevices.cameras || 0); i += 1) {
        fakeList.push({
          deviceId: makeHex(64),
          kind: 'videoinput',
          label: i === 0 ? 'Integrated Webcam' : 'USB Camera #' + (i + 1),
          groupId,
          toJSON() { return { deviceId: this.deviceId, kind: this.kind, label: this.label, groupId: this.groupId }; },
        });
      }
      for (let i = 0; i < (cfg.mediaDevices.microphones || 0); i += 1) {
        fakeList.push({
          deviceId: i === 0 ? 'default' : makeHex(64),
          kind: 'audioinput',
          label: i === 0 ? 'Default - Microphone Array' : 'Microphone #' + (i + 1),
          groupId,
          toJSON() { return { deviceId: this.deviceId, kind: this.kind, label: this.label, groupId: this.groupId }; },
        });
      }
      for (let i = 0; i < (cfg.mediaDevices.speakers || 0); i += 1) {
        fakeList.push({
          deviceId: i === 0 ? 'default' : makeHex(64),
          kind: 'audiooutput',
          label: i === 0 ? 'Default - Speakers (High Definition Audio)' : 'Speakers #' + (i + 1),
          groupId,
          toJSON() { return { deviceId: this.deviceId, kind: this.kind, label: this.label, groupId: this.groupId }; },
        });
      }
      navigator.mediaDevices.enumerateDevices = maskAsNative(function enumerateDevices() {
        return Promise.resolve(fakeList.map((d) => Object.assign({}, d)));
      }, 'enumerateDevices');
    }

    // Behavior: Do Not Track & Notifications
    if (cfg.behavior && cfg.behavior.doNotTrack) {
      defineGetter(Navigator.prototype, 'doNotTrack', () => '1');
    }
    if (cfg.behavior && cfg.behavior.notifications === 'block' && typeof Notification !== 'undefined') {
      defineGetter(Notification, 'permission', () => 'denied');
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
