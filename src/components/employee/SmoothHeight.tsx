import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface SmoothHeightProps {
  animate: boolean;
  outerClassName?: string;
  innerClassName?: string;
  duration?: number;
  children: ReactNode;
}

// outerClassName may add padding (e.g. to cover content that bleeds into the parent's padding);
// the animated height includes it so nothing gets clipped.
export default function SmoothHeight({ animate, outerClassName = '', innerClassName = '', duration = 650, children }: SmoothHeightProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!animate || !outer || !inner) {
      setHeight(null);
      return;
    }
    const measure = () => {
      const style = getComputedStyle(outer);
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const next = inner.offsetHeight;
      if (next > 0) setHeight(next + padding);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [animate]);

  return (
    <div
      ref={outerRef}
      className={outerClassName}
      style={height !== null ? {
        height,
        overflow: 'hidden',
        transition: `height ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`,
      } : undefined}
    >
      <div ref={innerRef} className={innerClassName}>{children}</div>
    </div>
  );
}
