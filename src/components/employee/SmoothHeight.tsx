import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface SmoothHeightProps {
  animate: boolean;
  className?: string;
  duration?: number;
  children: ReactNode;
}

export default function SmoothHeight({ animate, className = '', duration = 650, children }: SmoothHeightProps) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!animate || !el) {
      setHeight(null);
      return;
    }
    setHeight(el.offsetHeight);
    const observer = new ResizeObserver(() => {
      const next = el.offsetHeight;
      if (next > 0) setHeight(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [animate]);

  return (
    <div
      className={className}
      style={height !== null ? {
        height,
        overflow: 'hidden',
        transition: `height ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`,
      } : undefined}
    >
      <div ref={innerRef} className={className}>{children}</div>
    </div>
  );
}
