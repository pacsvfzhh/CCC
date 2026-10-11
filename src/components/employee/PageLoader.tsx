import { useLanguage } from '../../lib/i18n/context';

const BLOCKS = [
  { x: '-128px', y: '-78px', size: 34, color: 'bg-blue-200/60', rot: -14, delay: 0 },
  { x: '104px', y: '-96px', size: 26, color: 'bg-cyan-200/70', rot: 12, delay: 0.4 },
  { x: '118px', y: '42px', size: 38, color: 'bg-indigo-200/50', rot: 18, delay: 0.8 },
  { x: '-112px', y: '58px', size: 24, color: 'bg-sky-200/70', rot: -8, delay: 1.2 },
  { x: '-30px', y: '-128px', size: 18, color: 'bg-blue-300/40', rot: 24, delay: 0.6 },
];

export default function PageLoader({ label }: { label?: string }) {
  const { t } = useLanguage();
  return (
    <div
      className="keep-animation flex min-h-[calc(100dvh-var(--employee-header-height,64px)-140px)] flex-col items-center justify-center lg:min-h-[calc(100dvh-300px)]"
      style={{ animation: 'emp-loader-in 360ms ease-out 120ms backwards' }}
      role="status"
      aria-live="polite"
    >
      <div className="relative flex h-40 w-40 items-center justify-center sm:h-48 sm:w-48">
        <div className="absolute h-28 w-28 rounded-full bg-gradient-to-br from-blue-100 to-cyan-100 opacity-70 blur-2xl sm:h-32 sm:w-32"></div>
        {BLOCKS.map((block, index) => (
          <div
            key={index}
            className={`keep-animation absolute rounded-lg ${block.color}`}
            style={{
              width: block.size,
              height: block.size,
              left: `calc(50% + ${block.x} - ${block.size / 2}px)`,
              top: `calc(50% + ${block.y} - ${block.size / 2}px)`,
              ['--emp-rot' as string]: `${block.rot}deg`,
              transform: `rotate(${block.rot}deg)`,
              animation: `emp-loader-block 2.6s ease-in-out ${block.delay}s infinite alternate`,
            }}
            aria-hidden="true"
          ></div>
        ))}
        <div className="relative h-16 w-16 sm:h-[72px] sm:w-[72px]">
          <div className="absolute inset-0 rounded-full border-4 border-blue-100"></div>
          <div className="keep-animation absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-blue-500 border-r-cyan-400"></div>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="keep-animation h-3 w-3 animate-pulse rounded-full bg-blue-500/80"></div>
          </div>
        </div>
      </div>
      <span className="-mt-4 text-sm font-semibold tracking-wide text-slate-500 sm:text-base">{label ?? t.common.loading}</span>
    </div>
  );
}
