import DispatchShip from './DispatchShip';

interface DispatchVeilProps {
  phase: 'in' | 'out';
  label: string;
}

// segments must be a multiple of 4 so the -50% loop lands on a whole wave period.
const wavePath = (baseline: number, crest: number, segments: number) => {
  const step = 400 / segments;
  let d = `M0 ${baseline} Q${step / 2} ${crest} ${step} ${baseline}`;
  for (let x = step * 2; x <= 400; x += step) d += ` T${x} ${baseline}`;
  return `${d} V40 H0Z`;
};

export function DispatchWaves({ className = '', segments = 4 }: { className?: string; segments?: number }) {
  return (
    <div className={`dispatch-veil-sea ${className}`} aria-hidden="true">
      <svg className="dispatch-veil-wave dispatch-veil-wave-back" viewBox="0 0 400 40" preserveAspectRatio="none">
        <path d={wavePath(20, 8, segments)} fill="#7dd3fc" fillOpacity="0.35" />
      </svg>
      <svg className="dispatch-veil-wave dispatch-veil-wave-front" viewBox="0 0 400 40" preserveAspectRatio="none">
        <path d={wavePath(22, 12, segments)} fill="#38bdf8" fillOpacity="0.4" />
      </svg>
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
