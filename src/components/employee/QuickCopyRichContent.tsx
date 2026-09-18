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

const quickCopyGroupPrefix = 'message-quick-copy-group-';
const blockTags = new Set([
  'ADDRESS',
  'BLOCKQUOTE',
  'DIV',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'P',
  'PRE',
  'TD',
  'TH',
]);

function getMarkerGroupKey(marker: HTMLElement, index: number) {
  const groupClass = Array.from(marker.classList)
    .find(className => className.startsWith(quickCopyGroupPrefix));
  return groupClass || `message-quick-copy-single-${index}`;
}

function collectMarkerGroups(container: HTMLElement) {
  const groups = new Map<string, HTMLElement[]>();
  container.querySelectorAll<HTMLElement>('span.message-quick-copy').forEach((marker, index) => {
    const key = getMarkerGroupKey(marker, index);
    const group = groups.get(key);
    if (group) {
      group.push(marker);
    } else {
      groups.set(key, [marker]);
    }
  });
  return Array.from(groups.values());
}

function getBlockAncestor(marker: HTMLElement, container: HTMLElement) {
  let current = marker.parentElement;
  while (current && current !== container) {
    if (blockTags.has(current.tagName)) return current;
    current = current.parentElement;
  }
  return container;
}

function getMarkerText(marker: HTMLElement) {
  const clone = marker.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('br').forEach(lineBreak => lineBreak.replaceWith('\n'));
  return clone.textContent || '';
}

function getGroupText(markers: HTMLElement[], container: HTMLElement) {
  let text = '';
  let previousBlock: HTMLElement | null = null;

  markers.forEach(marker => {
    const block = getBlockAncestor(marker, container);
    if (previousBlock && block !== previousBlock) text += '\n\n';
    text += getMarkerText(marker);
    previousBlock = block;
  });

  return text;
}

function setButtonLabel(button: HTMLButtonElement, label: string) {
  button.textContent = label;
  button.setAttribute('aria-label', label);
  button.title = label;
}

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

    container.querySelectorAll<HTMLImageElement>('img').forEach(image => {
      image.loading = 'lazy';
      image.decoding = 'async';
    });
    container.querySelectorAll('button.message-quick-copy-button').forEach(button => button.remove());
    const insertionAnchors = new Map<HTMLElement, Element>();
    collectMarkerGroups(container).forEach((markers, index) => {
      const lastMarker = markers[markers.length - 1];
      if (!lastMarker) return;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'message-quick-copy-button';
      button.dataset.quickCopyIndex = String(index);
      button.setAttribute('aria-live', 'polite');
      setButtonLabel(button, copyLabel);

      const block = getBlockAncestor(lastMarker, container);
      if (block === container) {
        container.appendChild(button);
        return;
      }

      const insertionAnchor = insertionAnchors.get(block) || block;
      insertionAnchor.insertAdjacentElement('afterend', button);
      insertionAnchors.set(block, button);
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
    const markers = collectMarkerGroups(container)[index];
    if (!markers) return;

    const text = getGroupText(markers, container);
    if (!text) return;

    event.preventDefault();
    event.stopPropagation();

    try {
      await copyText(text);
      container.querySelectorAll<HTMLButtonElement>('button.message-quick-copy-button').forEach(copyButton => {
        setButtonLabel(copyButton, copyLabel);
      });
      setButtonLabel(button, copiedLabel);

      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = window.setTimeout(() => {
        if (button.isConnected) setButtonLabel(button, copyLabel);
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
        .quick-copy-rich-content > * {
          content-visibility: auto;
          contain-intrinsic-size: auto 1.5rem;
        }
        .quick-copy-rich-content .message-quick-copy-button {
          display: flex;
          width: fit-content;
          min-height: 1.75rem;
          align-items: center;
          justify-content: center;
          margin: 0.375rem 0 0.25rem;
          border: 1px solid rgb(125 211 252);
          border-radius: 0.5rem;
          background: rgb(240 249 255);
          padding: 0.25rem 0.625rem;
          color: rgb(3 105 161);
          font-size: 0.75rem;
          font-weight: 700;
          line-height: 1rem;
          vertical-align: middle;
          font-style: normal;
          text-decoration: none;
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
