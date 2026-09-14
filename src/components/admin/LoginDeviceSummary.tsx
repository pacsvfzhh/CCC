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
        <details className="group mt-1.5 max-w-full">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-[10px] font-medium text-slate-500 transition-colors hover:text-slate-300">
            <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
            User-Agent
          </summary>
          <p className="mt-1 max-w-[420px] break-words rounded-md border border-slate-700/70 bg-slate-950/70 p-1.5 font-mono text-[9px] leading-relaxed text-slate-500">
            {userAgent}
          </p>
        </details>
      )}
    </div>
  );
}
