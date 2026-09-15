import { Apple, ChevronDown, HelpCircle, Monitor, Smartphone, Tablet } from 'lucide-react';
import { resolveLoginDeviceInfo } from '../../lib/deviceInfo';

interface LoginDeviceSummaryProps {
  deviceInfo?: unknown;
  userAgent?: string | null;
  compact?: boolean;
  systemOnly?: boolean;
  inlineUserAgent?: boolean;
  auditTone?: 'login' | 'logout';
}

const osLabels = {
  android: 'Android',
  ios: 'iOS / iPadOS',
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  chromeos: 'ChromeOS',
  unknown: 'Unknown OS',
} as const;

const browserLabels = {
  chrome: 'Chrome',
  safari: 'Safari',
  edge: 'Edge',
  firefox: 'Firefox',
  webview: 'WebView',
  opera: 'Opera',
  samsung: 'Samsung Internet',
  other: 'Other browser',
  unknown: 'Unknown browser',
} as const;

const osStyles = {
  android: 'border-yellow-400/30 bg-yellow-500/10 text-yellow-200',
  ios: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
  windows: 'border-blue-400/30 bg-blue-500/10 text-blue-200',
  macos: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
  linux: 'border-amber-400/30 bg-amber-500/10 text-amber-200',
  chromeos: 'border-rose-400/30 bg-rose-500/10 text-rose-200',
  unknown: 'border-slate-500/30 bg-slate-500/10 text-slate-300',
} as const;

const formatValue = (label: string, version: string | null) => version ? `${label} ${version}` : label;

export default function LoginDeviceSummary({
  deviceInfo,
  userAgent,
  compact = false,
  systemOnly = false,
  inlineUserAgent = false,
  auditTone = 'login',
}: LoginDeviceSummaryProps) {
  const info = resolveLoginDeviceInfo(deviceInfo, userAgent);
  const auditTextClass = auditTone === 'logout' ? 'text-orange-200/75' : 'text-emerald-200/75';
  const details = [
    osLabels[info.os_family],
    ...(!systemOnly ? [formatValue(browserLabels[info.browser_family], info.browser_version)] : []),
  ];
  const SystemIcon = info.os_family === 'ios' || info.os_family === 'macos'
    ? Apple
    : info.os_family === 'android'
      ? info.device_type === 'tablet' ? Tablet : Smartphone
      : info.os_family === 'unknown'
        ? HelpCircle
        : Monitor;

  if (systemOnly) {
    return (
      <span
        className={`inline-flex items-center whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${osStyles[info.os_family]}`}
        title={osLabels[info.os_family]}
        aria-label={osLabels[info.os_family]}
      >
        {osLabels[info.os_family]}
      </span>
    );
  }

  return (
    <div className={compact && inlineUserAgent
      ? 'flex min-w-[360px] max-w-[640px] items-center gap-2'
      : compact
        ? 'min-w-[190px] max-w-[280px]'
        : 'min-w-[240px]'}>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${osStyles[info.os_family]}`}>
          <SystemIcon className="h-3 w-3" aria-hidden="true" />
          {osLabels[info.os_family]}
        </span>
        <span className="inline-flex items-center rounded-md border border-violet-400/25 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-200">
          {formatValue(browserLabels[info.browser_family], info.browser_version)}
        </span>
      </div>
      {!compact && (
        <div className="mt-1 text-[10px] text-slate-500">{details.join(' · ')}</div>
      )}
      {inlineUserAgent && userAgent && !systemOnly ? (
        <span
          className={`min-w-0 truncate font-mono text-[9px] ${auditTextClass}`}
          title={userAgent}
        >
          <span className="mr-1 font-sans font-bold uppercase tracking-[0.12em] opacity-70">UA</span>
          {userAgent}
        </span>
      ) : userAgent && !systemOnly ? (
        <details className="group mt-2 max-w-full">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[10px] font-semibold text-slate-500 transition-colors hover:text-cyan-300">
            <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
            <span>User-Agent</span>
            <span className="font-normal text-slate-600">· raw audit evidence</span>
          </summary>
          <div className="mt-2 w-full max-w-[420px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.14)]">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2">
              <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Browser signature
              </span>
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[9px] font-semibold text-slate-500">Read only</span>
            </div>
            <p className="max-h-28 overflow-y-auto break-words bg-white p-3 font-mono text-[10px] leading-relaxed text-slate-600">
              {userAgent}
            </p>
          </div>
        </details>
      ) : null}
    </div>
  );
}
