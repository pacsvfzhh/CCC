export type DeviceOsFamily = 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'chromeos' | 'unknown';
export type DeviceType = 'phone' | 'tablet' | 'desktop' | 'unknown';
export type BrowserFamily = 'chrome' | 'safari' | 'edge' | 'firefox' | 'webview' | 'opera' | 'samsung' | 'other' | 'unknown';
export type DeviceInfoSource = 'client_hints' | 'user_agent' | 'fallback';

export interface LoginDeviceInfo {
  os_family: DeviceOsFamily;
  os_version: string | null;
  device_type: DeviceType;
  device_model: string | null;
  browser_family: BrowserFamily;
  browser_version: string | null;
  source: DeviceInfoSource;
}

interface UserAgentDataLike {
  brands?: Array<{ brand: string; version: string }>;
  mobile?: boolean;
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{
    brands?: Array<{ brand: string; version: string }>;
    mobile?: boolean;
    model?: string;
    platform?: string;
  }>;
}

interface DeviceParseHints {
  brands?: Array<{ brand: string; version: string }>;
  mobile?: boolean;
  model?: string;
  platform?: string;
  navigatorPlatform?: string;
  maxTouchPoints?: number;
  screenWidth?: number;
  fromClientHints?: boolean;
}

const OS_FAMILIES: DeviceOsFamily[] = ['android', 'ios', 'windows', 'macos', 'linux', 'chromeos', 'unknown'];
const DEVICE_TYPES: DeviceType[] = ['phone', 'tablet', 'desktop', 'unknown'];
const BROWSER_FAMILIES: BrowserFamily[] = ['chrome', 'safari', 'edge', 'firefox', 'webview', 'opera', 'samsung', 'other', 'unknown'];
const INFO_SOURCES: DeviceInfoSource[] = ['client_hints', 'user_agent', 'fallback'];

const firstMatch = (userAgent: string, pattern: RegExp) => userAgent.match(pattern)?.[1] || null;

const isKnownValue = <T extends string>(value: unknown, values: readonly T[]): value is T => (
  typeof value === 'string' && values.includes(value as T)
);

const cleanModel = (value: string | undefined | null) => {
  if (!value) return null;
  const model = value
    .replace(/\s+Build\/[^;)]+/i, '')
    .replace(/^Build\/.*$/i, '')
    .trim();
  if (!model || /^(?:k|wv|mobile|tablet|phone|en[-_]\w+|[a-z]{2}[-_]\w{2})$/i.test(model)) return null;
  return model.length <= 80 ? model : model.slice(0, 80);
};

const parseOs = (userAgent: string, hints: DeviceParseHints): DeviceOsFamily => {
  const platform = hints.platform?.toLowerCase();
  const isDesktopModeIpad = hints.navigatorPlatform === 'MacIntel'
    && (hints.maxTouchPoints || 0) > 1
    && (hints.screenWidth === undefined || hints.screenWidth <= 1366);

  if (/Android/i.test(userAgent) || platform === 'android') return 'android';
  if (/iPhone|iPad|iPod/i.test(userAgent) || isDesktopModeIpad) return 'ios';
  if (/CrOS/i.test(userAgent) || platform === 'chrome os') return 'chromeos';
  if (/Windows NT/i.test(userAgent) || platform?.startsWith('win')) return 'windows';
  if (/Mac OS X/i.test(userAgent) || platform?.startsWith('mac')) return 'macos';
  if (/Linux/i.test(userAgent) || platform?.includes('linux')) return 'linux';
  return 'unknown';
};

const parseBrowser = (userAgent: string, hints: DeviceParseHints) => {
  const edgeVersion = firstMatch(userAgent, /(?:Edg|EdgA|EdgiOS)\/([\d.]+)/i);
  if (edgeVersion) return { family: 'edge' as const, version: edgeVersion };

  const operaVersion = firstMatch(userAgent, /OPR\/([\d.]+)/i);
  if (operaVersion) return { family: 'opera' as const, version: operaVersion };

  const samsungVersion = firstMatch(userAgent, /SamsungBrowser\/([\d.]+)/i);
  if (samsungVersion) return { family: 'samsung' as const, version: samsungVersion };

  const firefoxVersion = firstMatch(userAgent, /(?:Firefox|FxiOS)\/([\d.]+)/i);
  if (firefoxVersion) return { family: 'firefox' as const, version: firefoxVersion };

  if (/(?:;\s*wv\)|\bwv\b)/i.test(userAgent)) {
    return { family: 'webview' as const, version: firstMatch(userAgent, /;\s*Version\/([\d.]+)/i) };
  }

  const chromeVersion = firstMatch(userAgent, /(?:Chrome|CriOS)\/([\d.]+)/i);
  if (chromeVersion) return { family: 'chrome' as const, version: chromeVersion };

  const safariVersion = firstMatch(userAgent, /Version\/([\d.]+).*Safari\//i);
  if (safariVersion) return { family: 'safari' as const, version: safariVersion };

  const hintedBrand = hints.brands?.find(({ brand }) => /edge/i.test(brand))
    || hints.brands?.find(({ brand }) => /opera/i.test(brand))
    || hints.brands?.find(({ brand }) => /chrome|chromium/i.test(brand));
  if (hintedBrand) {
    const brand = hintedBrand.brand.toLowerCase();
    return {
      family: /edge/.test(brand) ? 'edge' as const : /opera/.test(brand) ? 'opera' as const : 'chrome' as const,
      version: hintedBrand.version || null,
    };
  }

  if (userAgent) return { family: 'other' as const, version: null };
  return { family: 'unknown' as const, version: null };
};

const parseDeviceType = (userAgent: string, osFamily: DeviceOsFamily, hints: DeviceParseHints): DeviceType => {
  const isIpad = /iPad/i.test(userAgent) || (
    osFamily === 'ios'
    && hints.navigatorPlatform === 'MacIntel'
    && (hints.maxTouchPoints || 0) > 1
  );
  if (isIpad || /Android/i.test(userAgent) && !/Mobile/i.test(userAgent)) return 'tablet';
  if (/iPhone|iPod|Mobile/i.test(userAgent) || hints.mobile === true) return 'phone';
  if (osFamily !== 'unknown') return 'desktop';
  return 'unknown';
};

const parseAndroidModel = (userAgent: string) => {
  const androidModel = userAgent.match(/Android[^;)]*;\s*([^;)]+?)(?:\s+Build\/[^;)]+)?(?:;|\))/i)?.[1];
  return cleanModel(androidModel);
};

export function parseLoginDeviceInfo(
  userAgent: string | null | undefined,
  hints: DeviceParseHints = {},
): LoginDeviceInfo {
  const normalizedUserAgent = typeof userAgent === 'string' ? userAgent : '';
  const os = parseOs(normalizedUserAgent, hints);
  const browser = parseBrowser(normalizedUserAgent, hints);
  const model = cleanModel(hints.model) || parseAndroidModel(normalizedUserAgent);

  return {
    os_family: os,
    os_version: null,
    device_type: parseDeviceType(normalizedUserAgent, os, hints),
    device_model: model,
    browser_family: browser.family,
    browser_version: browser.version,
    source: hints.fromClientHints ? 'client_hints' : normalizedUserAgent ? 'user_agent' : 'fallback',
  };
}

export async function collectLoginDeviceInfo(): Promise<LoginDeviceInfo> {
  if (typeof navigator === 'undefined') return parseLoginDeviceInfo(null);

  const navigatorWithHints = navigator as Navigator & { userAgentData?: UserAgentDataLike };
  const userAgentData = navigatorWithHints.userAgentData;
  let highEntropyValues: Awaited<ReturnType<NonNullable<UserAgentDataLike['getHighEntropyValues']>>> | undefined;

  if (userAgentData?.getHighEntropyValues) {
    try {
      highEntropyValues = await userAgentData.getHighEntropyValues([
        'model',
        'platform',
      ]);
    } catch {
      highEntropyValues = undefined;
    }
  }

  const hasClientHints = Boolean(userAgentData || highEntropyValues);
  return parseLoginDeviceInfo(navigator.userAgent, {
    brands: highEntropyValues?.brands || userAgentData?.brands,
    mobile: highEntropyValues?.mobile ?? userAgentData?.mobile,
    model: highEntropyValues?.model,
    platform: highEntropyValues?.platform || userAgentData?.platform,
    navigatorPlatform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    screenWidth: typeof window !== 'undefined' ? window.screen.width : undefined,
    fromClientHints: hasClientHints,
  });
}

export function resolveLoginDeviceInfo(value: unknown, userAgent: string | null | undefined): LoginDeviceInfo {
  const fallback = parseLoginDeviceInfo(userAgent);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;

  const stored = value as Record<string, unknown>;
  const storedOsFamily = isKnownValue(stored.os_family, OS_FAMILIES) ? stored.os_family : fallback.os_family;
  return {
    os_family: storedOsFamily,
    os_version: null,
    device_type: isKnownValue(stored.device_type, DEVICE_TYPES) ? stored.device_type : fallback.device_type,
    device_model: typeof stored.device_model === 'string'
      ? cleanModel(stored.device_model) || fallback.device_model
      : fallback.device_model,
    browser_family: isKnownValue(stored.browser_family, BROWSER_FAMILIES) ? stored.browser_family : fallback.browser_family,
    browser_version: typeof stored.browser_version === 'string' ? stored.browser_version : fallback.browser_version,
    source: isKnownValue(stored.source, INFO_SOURCES) ? stored.source : fallback.source,
  };
}
