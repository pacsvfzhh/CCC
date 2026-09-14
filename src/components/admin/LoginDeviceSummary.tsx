import { ChevronDown, Globe2 } from 'lucide-react';
import { resolveLoginDeviceInfo } from '../../lib/deviceInfo';

interface LoginDeviceSummaryProps {
  deviceInfo?: unknown;
  userAgent?: string | null;
  compact?: boolean;
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

const formatValue = (label: string, version: string | null) => version ? `${label} ${version}` : label;

export default function LoginDeviceSummary({ deviceInfo, userAgent, compact = false }: LoginDeviceSummaryProps) {
  const info = resolveLoginDeviceInfo(deviceInfo, userAgent);
  const details = [
    osLabels[info.os_family],
    formatValue(browserLabels[info.browser_family], info.browser_version),
  ];

  return (
    <div className={compact ? 'min-w-[190px] max-w-[280px]' : 'min-w-[240px]'}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-md border border-cyan-400/25 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-200">
          <Globe2 className="h-3 w-3" />
          {osLabels[info.os_family]}
        </span>
        <span className="inline-flex items-center rounded-md border border-violet-400/25 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-200">
          {formatValue(browserLabels[info.browser_family], info.browser_version)}
        </span>
      </div>
      {!compact && (
        <div className="mt-1 text-[10px] text-slate-500">{details.join(' · ')}</div>
      )}
      {userAgent && (
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
      )}
    </div>
  );
}
