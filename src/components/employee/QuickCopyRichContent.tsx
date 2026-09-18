import { useEffect, useMemo, useRef } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import { sanitizeHTML } from '../../lib/sanitizeHTML';

interface QuickCopyRichContentProps {
  html: string;
  copyLabel: string;
  copiedLabel: string;
  className?: string;
  style?: CSSProperties;
}

const allowedAttributes = [
  'href',
  'src',
  'alt',
  'title',
  'class',
  'target',
  'rel',
  'width',
  'height',
  'style',
  'size',
];

async function copyText(text: string) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the browser-compatible copy path.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();

  if (!copied) throw new Error('Clipboard copy failed.');
}

export default function QuickCopyRichContent({
  html,
  copyLabel,
  copiedLabel,
  className = '',
  style,
}: QuickCopyRichContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const resetTimerRef = useRef<number | null>(null);
  const sanitizedHtml = useMemo(
    () => sanitizeHTML(html, { allowedAttributes }),
    [html],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.querySelectorAll('button.message-quick-copy-button').forEach(button => button.remove());
    container.querySelectorAll<HTMLElement>('span.message-quick-copy').forEach((marker, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'message-quick-copy-button';
      button.dataset.quickCopyIndex = String(index);
      button.textContent = copyLabel;
      button.setAttribute('aria-label', copyLabel);
      button.title = copyLabel;
      marker.insertAdjacentElement('afterend', button);
    });

    return () => {
      container.querySelectorAll('button.message-quick-copy-button').forEach(button => button.remove());
    };
  }, [copyLabel, sanitizedHtml]);

  useEffect(() => () => {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
  }, []);

  const handleClick = async (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest<HTMLButtonElement>('button.message-quick-copy-button');
    const container = containerRef.current;
    if (!button || !container || !container.contains(button)) return;

    const index = Number(button.dataset.quickCopyIndex);
    const marker = container.querySelectorAll<HTMLElement>('span.message-quick-copy')[index];
    const text = marker?.textContent;
    if (!text) return;

    event.preventDefault();
    event.stopPropagation();

    try {
      await copyText(text);
      container.querySelectorAll<HTMLButtonElement>('button.message-quick-copy-button').forEach(copyButton => {
        copyButton.textContent = copyLabel;
      });
      button.textContent = copiedLabel;

      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = window.setTimeout(() => {
        if (button.isConnected) button.textContent = copyLabel;
        resetTimerRef.current = null;
      }, 1800);
    } catch (error) {
      console.error('Unable to copy notification text:', error);
    }
  };

  return (
    <>
      <style>{`
        .quick-copy-rich-content .message-quick-copy {
          border-radius: 0.25rem;
          background: rgba(224, 242, 254, 0.9);
          box-shadow: inset 0 -2px 0 rgba(14, 165, 233, 0.55);
          padding: 0 0.125rem;
        }
        .quick-copy-rich-content .message-quick-copy-button {
          display: inline-flex;
          min-height: 1.75rem;
          align-items: center;
          justify-content: center;
          margin: 0.125rem 0.25rem 0.125rem 0.5rem;
          border: 1px solid rgb(125 211 252);
          border-radius: 0.5rem;
          background: rgb(240 249 255);
          padding: 0.25rem 0.625rem;
          color: rgb(3 105 161);
          font-size: 0.75rem;
          font-weight: 700;
          line-height: 1rem;
          vertical-align: middle;
          cursor: pointer;
          transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease, transform 150ms ease;
        }
        .quick-copy-rich-content .message-quick-copy-button:hover {
          border-color: rgb(14 165 233);
          background: rgb(224 242 254);
          color: rgb(7 89 133);
        }
        .quick-copy-rich-content .message-quick-copy-button:active {
          transform: scale(0.97);
        }
        .quick-copy-rich-content .message-quick-copy-button:focus-visible {
          outline: 2px solid rgb(14 165 233);
          outline-offset: 2px;
        }
      `}</style>
      <div
        ref={containerRef}
        className={`quick-copy-rich-content ${className}`}
        dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
        onClick={handleClick}
        style={style}
      />
    </>
  );
}
