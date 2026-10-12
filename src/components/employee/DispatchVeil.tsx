import { useId } from 'react';
import DispatchShip from './DispatchShip';

interface DispatchVeilProps {
  phase: 'in' | 'out';
  label: string;
}

// segments must be a multiple of 4 so the -50% loop lands on a whole wave period.
const waveCurve = (baseline: number, crest: number, segments: number) => {
  const step = 400 / segments;
  let d = `M0 ${baseline} Q${step / 2} ${crest} ${step} ${baseline}`;
  for (let x = step * 2; x <= 400; x += step) d += ` T${x} ${baseline}`;
  return d;
};

const WAVE_LAYERS = [
  { key: 'back', baseline: 16, crest: 3, top: '#bae6fd', bottom: '#7dd3fc', topOpacity: 0.55, bottomOpacity: 0.05 },
  { key: 'mid', baseline: 22, crest: 10, top: '#7dd3fc', bottom: '#38bdf8', topOpacity: 0.5, bottomOpacity: 0.06 },
  { key: 'front', baseline: 28, crest: 15, top: '#38bdf8', bottom: '#2563eb', topOpacity: 0.55, bottomOpacity: 0.08 },
] as const;

// Each count must be a multiple of 4 so the -50% loop lands on a whole wave period.
export function DispatchWaves({ className = '', layers = [4, 8, 4] }: { className?: string; layers?: [number, number, number] }) {
  const uid = useId().replace(/:/g, '');
  return (
    <div className={`dispatch-veil-sea ${className}`} aria-hidden="true">
      {WAVE_LAYERS.map((layer, i) => {
        const curve = waveCurve(layer.baseline, layer.crest, layers[i]);
        const gradientId = `${uid}-wave-${layer.key}`;
        return (
          <svg key={layer.key} className={`dispatch-veil-wave dispatch-veil-wave-${layer.key}`} viewBox="0 0 400 40" preserveAspectRatio="none">
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={layer.top} stopOpacity={layer.topOpacity} />
                <stop offset="1" stopColor={layer.bottom} stopOpacity={layer.bottomOpacity} />
              </linearGradient>
            </defs>
            <path d={`${curve} V40 H0Z`} fill={`url(#${gradientId})`} />
            {layer.key === 'front' && (
              <path d={curve} fill="none" stroke="#ffffff" strokeOpacity="0.7" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            )}
          </svg>
        );
      })}
    </div>
  );
}

export default function DispatchVeil({ phase, label }: DispatchVeilProps) {
  return (
    <div className={`dispatch-veil ${phase === 'in' ? 'dispatch-veil-in' : 'dispatch-veil-out'}`} aria-hidden="true">
      <span className="dispatch-veil-blob dispatch-veil-blob-1" />
      <span className="dispatch-veil-blob dispatch-veil-blob-2" />
      <span className="dispatch-veil-blob dispatch-veil-blob-3" />
      <span className="dispatch-veil-sweep" />

      <div className="dispatch-veil-stage">
        <DispatchShip idPrefix="dispatch-veil" className="dispatch-veil-ship" />
        <DispatchWaves />
        <div className="dispatch-veil-caption">
          <span className="dispatch-veil-label">{label}</span>
          <span className="dispatch-veil-track"><span className="dispatch-veil-bar" /></span>
        </div>
      </div>
    </div>
  );
}
