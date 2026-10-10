import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlarmClock, BellRing, Check, Smartphone } from 'lucide-react';
import { useLanguage } from '../lib/i18n/context';

export interface PhoneLandscapeNotice {
  message: string;
  tone: 'order' | 'urgent';
}

// Phones only: touch is the primary input and the screen's short side is under 600 CSS px (tablets start at 600).
function isPhone() {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return coarse && Math.min(window.screen.width, window.screen.height) < 600;
}

// Uses the device orientation rather than the viewport shape: an on-screen keyboard can make a portrait viewport wider than tall.
function isLandscape() {
  const type = window.screen.orientation?.type;
  if (type) return type.startsWith('landscape');
  const legacyAngle = (window as Window & { orientation?: number }).orientation;
  if (typeof legacyAngle === 'number') return Math.abs(legacyAngle) === 90;
  return window.matchMedia?.('(orientation: landscape)').matches ?? false;
}

function usePhoneLandscape() {
  const [blocked, setBlocked] = useState(() => isPhone() && isLandscape());

  useEffect(() => {
    let timer = 0;
    const update = () => setBlocked(isPhone() && isLandscape());
    // iOS may report the new orientation slightly after the event fires.
    const handleChange = () => {
      update();
      window.clearTimeout(timer);
      timer = window.setTimeout(update, 350);
    };
    const orientation = window.screen.orientation;
    orientation?.addEventListener?.('change', handleChange);
    window.addEventListener('orientationchange', handleChange);
    window.addEventListener('resize', handleChange);
    return () => {
      window.clearTimeout(timer);
      orientation?.removeEventListener?.('change', handleChange);
      window.removeEventListener('orientationchange', handleChange);
      window.removeEventListener('resize', handleChange);
    };
  }, []);

  return blocked;
}

const SPARK_PATH = 'M12 0C12.9 7.4 16.6 11.1 24 12C16.6 12.9 12.9 16.6 12 24C11.1 16.6 7.4 12.9 0 12C7.4 11.1 11.1 7.4 12 0Z';
const SHAPES = [1, 2, 3, 4, 5, 6];

// Covers the page while a phone is held sideways; the page underneath keeps running and resumes as it was.
export default function PhoneLandscapeGuard({ notice }: { notice?: PhoneLandscapeNotice | null }) {
  const blocked = usePhoneLandscape();
  const { t } = useLanguage();
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!blocked) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) active.blur();
  }, [blocked]);

  // When the card is taller than the screen (very short viewports, enlarged system text), drop the badge, then the
  // explanation, so the title and any order notice stay visible.
  useLayoutEffect(() => {
    const card = cardRef.current;
    const guard = card?.parentElement;
    if (!blocked || !card || !guard) return;
    const fit = () => {
      const style = getComputedStyle(guard);
      const room = guard.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      for (let level = 0; level <= 2; level += 1) {
        card.dataset.fit = String(level);
        if (card.offsetHeight <= room) break;
      }
    };
    fit();
    void document.fonts?.ready.then(fit);
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [blocked, notice?.message, t]);

  if (!blocked) return null;

  const NoticeIcon = notice?.tone === 'urgent' ? AlarmClock : BellRing;

  return createPortal(
    <div className="phone-landscape-guard">
      <div className="plg-bg" aria-hidden="true">
        <div className="plg-blob plg-blob--a" />
        <div className="plg-blob plg-blob--b" />
        <div className="plg-dots" />
        <div className="plg-lane plg-lane--top" />
        <div className="plg-lane plg-lane--bottom" />
        {SHAPES.map(n => <div key={n} className={`plg-shape plg-shape--${n}`} />)}
        <div className="plg-vignette" />
      </div>

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="phone-landscape-title"
        aria-describedby="phone-landscape-message"
        className="plg-card"
        ref={cardRef}
      >
        <div className="plg-visual" aria-hidden="true">
          <div className="plg-halo" />
          <div className="plg-pulse" />
          <div className="plg-pulse plg-pulse--late" />
          <div className="plg-track" />
          <svg className="plg-rings" viewBox="0 0 100 100">
            <path className="plg-arc" pathLength={100} d="M10.1 31.4A44 44 0 0 1 89.9 31.4" />
            <path className="plg-arc plg-arc--back" pathLength={100} d="M89.9 68.6A44 44 0 0 1 10.1 68.6" />
            <path className="plg-head" d="M85 30.4L91.6 35L92.2 27" />
            <path className="plg-head plg-head--back" d="M15 69.6L8.4 65L7.8 73" />
          </svg>
          <svg className="plg-spark plg-spark--a" viewBox="0 0 24 24"><path d={SPARK_PATH} /></svg>
          <svg className="plg-spark plg-spark--b" viewBox="0 0 24 24"><path d={SPARK_PATH} /></svg>
          <div className="plg-phone">
            <div className="plg-screen">
              <span className="plg-island" />
              <span className="plg-mini-header">
                <span className="plg-mini-logo" />
                <span className="plg-mini-title" />
              </span>
              <span className="plg-mini-cards">
                <span className="plg-mini-card" />
                <span className="plg-mini-card" />
                <span className="plg-mini-card" />
              </span>
              <span className="plg-mini-nav">
                <span />
                <span />
                <span />
                <span />
              </span>
            </div>
            <span className="plg-check"><Check strokeWidth={3.5} /></span>
          </div>
        </div>

        <div className="plg-copy">
          <span className="plg-badge plg-rise">
            <Smartphone aria-hidden="true" strokeWidth={2.4} />
            {t.orientation.badge}
          </span>
          <h2 id="phone-landscape-title" className="plg-title plg-rise">{t.orientation.title}</h2>
          <p id="phone-landscape-message" className="plg-message plg-rise">{t.orientation.message}</p>
          {notice && (
            <p role="status" className={`plg-notice plg-notice--${notice.tone} plg-rise`}>
              <span className="plg-notice-icon" aria-hidden="true"><NoticeIcon strokeWidth={2.4} /></span>
              <span className="plg-notice-text">{notice.message}</span>
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
