import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Tag } from 'lucide-react';

type MetadataKind = 'tag' | 'note';
type MetadataTheme = 'orange' | 'emerald';

interface EmployeeMetadataPopoverProps {
  kind: MetadataKind;
  theme: MetadataTheme;
  values?: string[];
  value?: string;
  selected?: boolean;
  className?: string;
}

const POPOVER_WIDTH = 230;
const POPOVER_HEIGHT = 130;
const VIEWPORT_GUTTER = 12;

export default function EmployeeMetadataPopover({
  kind,
  theme,
  values = [],
  value = '',
  selected = false,
  className = '',
}: EmployeeMetadataPopoverProps) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  const preview = values.length > 0
    ? `${values[0]}${values.length > 1 ? ` +${values.length - 1}` : ''}`
    : value.trim() || (kind === 'tag' ? 'No tag' : 'No note');
  const details = values.length > 0
    ? values.join(' · ')
    : value.trim() || (kind === 'tag' ? 'No tags assigned' : 'No note added');
  const isTag = kind === 'tag';

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const left = Math.max(
      VIEWPORT_GUTTER,
      Math.min(
        rect.right + 10,
        window.innerWidth - POPOVER_WIDTH - VIEWPORT_GUTTER
      )
    );
    const top = Math.max(
      VIEWPORT_GUTTER,
      Math.min(
        rect.top,
        window.innerHeight - POPOVER_HEIGHT - VIEWPORT_GUTTER
      )
    );

    setPosition({ left, top });
  }, []);

  const cancelClose = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const showPopover = () => {
    cancelClose();
    updatePosition();
    setOpen(true);
  };

  const hidePopover = () => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => setOpen(false), 100);
  };

  useEffect(() => {
    if (!open) return;

    const syncPosition = () => updatePosition();
    window.addEventListener('resize', syncPosition);
    window.addEventListener('scroll', syncPosition, true);

    return () => {
      window.removeEventListener('resize', syncPosition);
      window.removeEventListener('scroll', syncPosition, true);
    };
  }, [open, updatePosition]);

  return (
    <>
      <span className={`group relative min-w-0 ${className}`}>
        <span
          ref={triggerRef}
          tabIndex={0}
          onMouseEnter={showPopover}
          onMouseLeave={hidePopover}
          onFocus={showPopover}
          onBlur={hidePopover}
          className={`flex min-w-0 max-w-full items-center gap-1 truncate text-[9px] font-medium outline-none ${
            selected
              ? 'text-white/85'
              : isTag
                ? theme === 'orange' ? 'text-orange-200/70' : 'text-emerald-200/70'
                : 'text-slate-300/65'
          }`}
        >
          {isTag ? (
            <Tag className="h-2.5 w-2.5 shrink-0 opacity-75" />
          ) : (
            <FileText className="h-2.5 w-2.5 shrink-0 opacity-70" />
          )}
          <span className="truncate">{isTag ? 'Tag' : 'Note'}: {preview}</span>
        </span>
      </span>
      {open && createPortal(
        <div
          role="tooltip"
          className={`fixed z-[10000] w-[230px] rounded-xl border-2 bg-[#020617] p-3 text-[11px] font-medium leading-5 text-white shadow-2xl shadow-black/80 ring-2 ${
            isTag
              ? theme === 'orange'
                ? 'border-orange-300 ring-orange-500/40'
                : 'border-emerald-300 ring-emerald-500/40'
              : 'border-slate-300 ring-slate-500/50'
          }`}
          onMouseEnter={showPopover}
          onMouseLeave={hidePopover}
          style={{
            left: position.left,
            top: position.top,
            backgroundColor: '#020617',
            opacity: 1,
            isolation: 'isolate',
            mixBlendMode: 'normal',
          }}
        >
          <div className={`mb-1 font-bold uppercase tracking-wider ${
            isTag
              ? theme === 'orange' ? 'text-orange-300' : 'text-emerald-300'
              : 'text-slate-300'
          }`}>
            {isTag ? 'Tags' : 'Note'}
          </div>
          <div className="break-words text-white">{details}</div>
        </div>,
        document.body
      )}
    </>
  );
}
