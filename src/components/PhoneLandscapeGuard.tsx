import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Smartphone } from 'lucide-react';
import { useLanguage } from '../lib/i18n/context';

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

// Covers the page while a phone is held sideways; the page underneath keeps running and resumes as it was.
export default function PhoneLandscapeGuard({ notice }: { notice?: string | null }) {
  const blocked = usePhoneLandscape();
  const { t } = useLanguage();

  useEffect(() => {
    if (!blocked) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) active.blur();
  }, [blocked]);

  if (!blocked) return null;

  return createPortal(
    <div
      className="phone-landscape-guard fixed inset-0 flex items-center justify-center bg-gradient-to-br from-blue-800 via-blue-600 to-sky-500 text-center text-white"
      style={{
        zIndex: 2147483000,
        touchAction: 'none',
        paddingLeft: 'max(24px, env(safe-area-inset-left))',
        paddingRight: 'max(24px, env(safe-area-inset-right))',
      }}
    >
      {/* role="dialog" sits on the inner box: global CSS caps [role="dialog"] heights on short screens. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="phone-landscape-title"
        aria-describedby="phone-landscape-message"
        className="flex w-full max-w-[460px] flex-col items-center"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/30 bg-white/15">
          <Smartphone aria-hidden="true" className="phone-landscape-icon keep-animation h-9 w-9" strokeWidth={1.8} />
        </div>
        <h2 id="phone-landscape-title" className="mt-4 text-[20px] font-bold leading-tight">{t.orientation.title}</h2>
        <p id="phone-landscape-message" className="mt-2 text-[14px] leading-snug text-blue-50">{t.orientation.message}</p>
        {notice && (
          <p role="status" className="mt-4 rounded-xl bg-amber-300 px-4 py-2 text-[14px] font-semibold leading-snug text-amber-950 shadow-lg">
            {notice}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
