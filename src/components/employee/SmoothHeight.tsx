import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface SmoothHeightProps {
  enabled: boolean;
  className?: string;
  duration?: number;
  children: ReactNode;
}

export default function SmoothHeight({ enabled, className = '', duration = 650, children }: SmoothHeightProps) {
  const innerRef = useRef<HTMLDivElement>(null);
  const lastHeightRef = useRef<number | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [animating, setAnimating] = useState(false);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!enabled || !el) {
      lastHeightRef.current = null;
      setHeight(null);
      setAnimating(false);
      return;
    }
    const observer = new ResizeObserver(() => {
      const next = el.offsetHeight;
      const prev = lastHeightRef.current;
      lastHeightRef.current = next;
      if (prev !== null && Math.abs(prev - next) > 2) setAnimating(true);
      setHeight(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled]);

  const active = enabled && height !== null;

  return (
    <div
      className={className}
      style={active ? {
        height,
        transition: `height ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`,
        overflow: animating ? 'hidden' : undefined,
      } : undefined}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === 'height') setAnimating(false);
      }}
    >
      <div ref={innerRef} className={className}>{children}</div>
    </div>
  );
}
