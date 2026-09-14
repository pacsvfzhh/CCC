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
    platformVersion?: string;
  }>;
}

interface DeviceParseHints {
  brands?: Array<{ brand: string; version: string }>;
  mobile?: boolean;
  model?: string;
  platform?: string;
  platformVersion?: string;
  navigatorPlatform?: string;
  maxTouchPoints?: number;
  screenWidth?: number;
  fromClientHints?: boolean;
}

const OS_FAMILIES: DeviceOsFamily[] = ['android', 'ios', 'windows', 'macos', 'linux', 'chromeos', 'unknown'];
const DEVICE_TYPES: DeviceType[] = ['phone', 'tablet', 'desktop', 'unknown'];
const BROWSER_FAMILIES: BrowserFamily[] = ['chrome', 'safari', 'edge', 'firefox', 'webview', 'opera', 'samsung', 'other', 'unknown'];
const INFO_SOURCES: DeviceInfoSource[] = ['client_hints', 'user_agent', 'fallback'];

const normalizeVersion = (value: string | undefined | null) => {
  if (!value) return null;
  const normalized = value.replace(/_/g, '.').trim();
  return normalized || null;
};

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
  if (!model || /^(?:wv|mobile|tablet|phone|en[-_]\w+|[a-z]{2}[-_]\w{2})$/i.test(model)) return null;
  return model.length <= 80 ? model : model.slice(0, 80);
};

const parseOs = (userAgent: string, hints: DeviceParseHints) => {
  const androidVersion = firstMatch(userAgent, /Android[\s/]+([\d.]+)/i) || (
    hints.platform?.toLowerCase() === 'android' ? normalizeVersion(hints.platformVersion) : null
  );
  if (androidVersion || /Android/i.test(userAgent) || hints.platform?.toLowerCase() === 'android') {
    return { family: 'android' as const, version: androidVersion };
  }

  const iosVersion = firstMatch(userAgent, /(?:iPhone OS|CPU OS)\s*([\d_]+)/i);
  const isDesktopModeIpad = hints.navigatorPlatform === 'MacIntel'
    && (hints.maxTouchPoints || 0) > 1
    && (hints.screenWidth === undefined || hints.screenWidth <= 1366);
  if (iosVersion || /iPhone|iPad|iPod/i.test(userAgent) || isDesktopModeIpad) {
    return { family: 'ios' as const, version: normalizeVersion(iosVersion || hints.platformVersion) };
  }

  const chromeOsVersion = firstMatch(userAgent, /CrOS [^\s;)]+\s([\d.]+)/i);
  if (chromeOsVersion || hints.platform?.toLowerCase() === 'chrome os' || /CrOS/i.test(userAgent)) {
    return { family: 'chromeos' as const, version: chromeOsVersion || normalizeVersion(hints.platformVersion) };
  }

  const windowsVersion = firstMatch(userAgent, /Windows NT\s([\d.]+)/i);
  if (windowsVersion || hints.platform?.toLowerCase().startsWith('win')) {
    return { family: 'windows' as const, version: windowsVersion || normalizeVersion(hints.platformVersion) };
  }

  const macVersion = firstMatch(userAgent, /Mac OS X\s*([\d_.]+)/i);
  if (macVersion || hints.platform?.toLowerCase().startsWith('mac')) {
    return { family: 'macos' as const, version: normalizeVersion(macVersion || hints.platformVersion) };
  }

  const isLinux = /Linux/i.test(userAgent);
  if (isLinux || hints.platform?.toLowerCase().includes('linux')) {
    return { family: 'linux' as const, version: null };
  }

  return { family: 'unknown' as const, version: null };
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
    os_family: os.family,
    os_version: os.version,
    device_type: parseDeviceType(normalizedUserAgent, os.family, hints),
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
        'platformVersion',
        'fullVersionList',
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
    platformVersion: highEntropyValues?.platformVersion,
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
  return {
    os_family: isKnownValue(stored.os_family, OS_FAMILIES) ? stored.os_family : fallback.os_family,
    os_version: typeof stored.os_version === 'string' ? stored.os_version : fallback.os_version,
    device_type: isKnownValue(stored.device_type, DEVICE_TYPES) ? stored.device_type : fallback.device_type,
    device_model: typeof stored.device_model === 'string' ? stored.device_model : fallback.device_model,
    browser_family: isKnownValue(stored.browser_family, BROWSER_FAMILIES) ? stored.browser_family : fallback.browser_family,
    browser_version: typeof stored.browser_version === 'string' ? stored.browser_version : fallback.browser_version,
    source: isKnownValue(stored.source, INFO_SOURCES) ? stored.source : fallback.source,
  };
}
