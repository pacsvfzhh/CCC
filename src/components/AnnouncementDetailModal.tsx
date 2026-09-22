import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Calendar, Pin, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { marked } from 'marked';
import { sanitizeAnnouncementContent } from '../lib/sanitizeHTML';

marked.setOptions({ breaks: true, gfm: true });

interface AnnouncementDetailModalProps {
  title: string;
  content: string;
  publishAt: string;
  isPinned: boolean;
  onClose: () => void;
  CategoryIcon?: LucideIcon;
  dateLocale?: string;
  pinnedLabel?: string;
  closeLabel?: string;
  contentLoading?: boolean;
  isMobileDevice?: boolean;
  isIOS?: boolean;
}

export default function AnnouncementDetailModal({
  title,
  content,
  publishAt,
  isPinned,
  onClose,
  CategoryIcon = Bell,
  dateLocale,
  pinnedLabel = 'Pinned',
  closeLabel = 'Close',
  contentLoading = false,
  isMobileDevice = typeof window !== 'undefined' && window.innerWidth < 600,
  isIOS = false,
}: AnnouncementDetailModalProps) {
  const sanitizedContent = useMemo(() => {
    if (!content) return '';
    const rendered = content.trim().startsWith('<') ? content : marked(content);
    return sanitizeAnnouncementContent(typeof rendered === 'string' ? rendered : '');
  }, [content]);

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex touch-none items-stretch justify-stretch overflow-hidden p-0 xl:items-center xl:justify-center xl:p-6"
      onClick={onClose}
      style={{
        background: isMobileDevice ? 'rgba(15, 23, 42, 0.7)' : 'rgba(15, 23, 42, 0.6)',
        backdropFilter: isMobileDevice ? 'none' : 'blur(4px)',
        WebkitBackdropFilter: isMobileDevice ? 'none' : 'blur(4px)',
        animation: isIOS ? 'none' : 'announcement-detail-fade 0.2s ease-out',
        willChange: isIOS ? 'auto' : 'opacity',
        WebkitTapHighlightColor: 'transparent',
        overscrollBehavior: 'contain',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="announcement-detail-title"
        className="relative flex h-full w-full flex-col overflow-hidden rounded-none bg-white xl:h-auto xl:max-h-[85vh] xl:w-[680px] xl:max-w-3xl xl:rounded-2xl"
        onClick={event => event.stopPropagation()}
        style={{
          animation: isMobileDevice ? 'none' : 'announcement-detail-scale 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
          boxShadow: isMobileDevice ? 'none' : '0 25px 60px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255,255,255,0.1)',
        }}
      >
        <div
          className="relative shrink-0 overflow-hidden"
          style={{
            paddingTop: isMobileDevice ? 'calc(env(safe-area-inset-top) + 16px)' : '24px',
            paddingBottom: '20px',
            paddingLeft: '20px',
            paddingRight: '20px',
            background: 'linear-gradient(135deg, #1e40af 0%, #2563eb 40%, #3b82f6 70%, #1d4ed8 100%)',
          }}
        >
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/5 blur-2xl" />
            <div className="absolute -bottom-8 -left-8 h-32 w-32 rounded-full bg-blue-300/10 blur-xl" />
            <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            <div
              className="absolute inset-0 opacity-[0.04]"
              style={{
                backgroundImage: 'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
                backgroundSize: '32px 32px',
              }}
            />
          </div>

          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm transition-colors hover:bg-white/25 active:scale-90 active:bg-white/30"
            style={{
              touchAction: 'manipulation',
              top: isMobileDevice ? 'calc(env(safe-area-inset-top) + 12px)' : '16px',
            }}
            aria-label={closeLabel}
          >
            <X className="h-4 w-4 text-white" />
          </button>

          <div className="relative z-10">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {isPinned && (
                <div className="flex items-center gap-1 rounded-full bg-amber-500 px-2.5 py-1 shadow-sm shadow-amber-700/30">
                  <Pin className="h-3 w-3 fill-white text-white" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-white">{pinnedLabel}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 rounded-full border border-white/20 bg-white/15 px-2.5 py-1">
                <Calendar className="h-3 w-3 text-blue-100" />
                <span className="text-[10px] font-medium text-blue-50 sm:text-xs">
                  {new Date(publishAt).toLocaleDateString(dateLocale, {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="shrink-0 rounded-xl border border-white/20 bg-white/15 p-2.5 shadow-lg shadow-blue-900/20 backdrop-blur-sm">
                <CategoryIcon className="h-6 w-6 text-white" />
              </div>
              <h2 id="announcement-detail-title" className="break-words pr-8 text-lg font-bold leading-snug text-white sm:text-xl">
                {title}
              </h2>
            </div>
          </div>

          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-blue-400/30 via-blue-300/50 to-blue-400/30" />
        </div>

        <div
          className="announcement-detail-scroll relative min-h-0 flex-1 overflow-y-auto"
          style={{
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            padding: isMobileDevice ? '16px' : '24px',
          }}
        >
          <div className="relative" style={{ minHeight: contentLoading ? '60vh' : 'auto' }}>
            {contentLoading ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="relative mb-8">
                  <div className="h-16 w-16 rounded-full border-4 border-blue-100 [animation:announcement-detail-pulse_2s_ease-in-out_infinite]" />
                  <div className="absolute inset-0 h-16 w-16 rounded-full border-4 border-transparent border-r-blue-400 border-t-blue-500 [animation:announcement-detail-spin_.8s_linear_infinite]" />
                </div>
                <div className="mb-4 h-1.5 w-48 overflow-hidden rounded-full bg-blue-100">
                  <div className="h-full rounded-full bg-gradient-to-r from-blue-400 via-blue-500 to-blue-400 [animation:announcement-detail-progress_1.5s_ease-in-out_infinite]" />
                </div>
                <span className="text-base font-medium text-blue-500">Loading content</span>
              </div>
            ) : (
              <div
                className="announcement-detail-content relative"
                style={{ fontSize: '15px', lineHeight: '1.75', color: '#374151' }}
                dangerouslySetInnerHTML={{ __html: sanitizedContent }}
              />
            )}
          </div>
        </div>

        <div
          className="relative hidden min-h-[68px] shrink-0 border-t border-slate-100 bg-slate-50/80 sm:flex"
          style={{
            paddingTop: '12px',
            paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)',
            paddingLeft: '20px',
            paddingRight: '20px',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            className="relative min-h-[44px] w-full rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-5 py-3 text-sm font-semibold text-white shadow-md shadow-blue-600/20 transition-all duration-200 hover:from-blue-700 hover:to-blue-600 hover:shadow-lg hover:shadow-blue-600/30 active:scale-[0.98] active:from-blue-800 active:to-blue-700"
            style={{ touchAction: 'manipulation' }}
          >
            {closeLabel}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes announcement-detail-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes announcement-detail-scale { from { opacity: 0; transform: scale(.95); } to { opacity: 1; transform: scale(1); } }
        @keyframes announcement-detail-spin { to { transform: rotate(360deg); } }
        @keyframes announcement-detail-pulse { 50% { transform: scale(1.08); opacity: .65; } }
        @keyframes announcement-detail-progress { 0% { transform: translateX(-100%); } 50% { transform: translateX(0); } 100% { transform: translateX(100%); } }
        .announcement-detail-scroll::-webkit-scrollbar { display: none; }
        .announcement-detail-content { overflow-x: hidden; overflow-wrap: break-word; word-break: break-word; }
        .announcement-detail-content h1,
        .announcement-detail-content h2,
        .announcement-detail-content h3,
        .announcement-detail-content h4 { color: #111827; font-weight: 700; margin-top: 1.5em; margin-bottom: .5em; }
        .announcement-detail-content h1 { font-size: 1.5rem; line-height: 1.3; }
        .announcement-detail-content h2 { font-size: 1.25rem; line-height: 1.35; }
        .announcement-detail-content h3 { font-size: 1.125rem; line-height: 1.4; }
        .announcement-detail-content h4 { font-size: 1rem; line-height: 1.4; }
        .announcement-detail-content > *:first-child { margin-top: 0; }
        .announcement-detail-content > *:last-child { margin-bottom: 0; }
        .announcement-detail-content p { margin: 0 0 1em; color: #374151; }
        .announcement-detail-content ul,
        .announcement-detail-content ol { margin: .5em 0 1em; padding-left: 1.5em; }
        .announcement-detail-content ul { list-style: disc; }
        .announcement-detail-content ol { list-style: decimal; }
        .announcement-detail-content li { margin-bottom: .375em; color: #374151; }
        .announcement-detail-content strong,
        .announcement-detail-content b { color: #111827; font-weight: 700; }
        .announcement-detail-content a { color: #2563eb; text-decoration: none; border-bottom: 1px solid rgba(37,99,235,.3); }
        .announcement-detail-content blockquote { margin: 1em 0; padding: .75em 1em; border-left: 3px solid #3b82f6; border-radius: 0 .375rem .375rem 0; background: #f8fafc; color: #4b5563; }
        .announcement-detail-content hr { margin: 1.5em 0; border: 0; height: 1px; background: #e5e7eb; }
        .announcement-detail-content table { display: block; width: 100%; max-width: 100%; margin: 1rem 0; overflow-x: auto; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: .5rem; }
        .announcement-detail-content th,
        .announcement-detail-content td { padding: .625rem .75rem; border-bottom: 1px solid #f3f4f6; text-align: left; }
        .announcement-detail-content th { background: #f9fafb; color: #374151; font-size: 12px; font-weight: 600; }
        .announcement-detail-content img { display: block; max-width: 100%; height: auto; margin: 1rem 0; border: 1px solid #e2e8f0; border-radius: .75rem; background: #f8fafc; box-shadow: 0 4px 8px rgba(0,0,0,.08); }
        .announcement-detail-content .video-wrapper { display: block !important; width: fit-content !important; max-width: 100% !important; margin: 1rem auto !important; }
        .announcement-detail-content video { display: block; width: 100%; max-width: min(800px, 100%); height: auto; border: 1px solid #e2e8f0; border-radius: .75rem; background: #0f172a; object-fit: contain; box-shadow: 0 4px 12px rgba(0,0,0,.1); }
        @media (max-width: 639px) {
          .announcement-detail-content { padding: 0 4px; font-size: 15px !important; line-height: 1.75 !important; letter-spacing: .01em; }
          .announcement-detail-content h1 { font-size: 1.375rem; }
          .announcement-detail-content h2 { font-size: 1.2rem; }
          .announcement-detail-content h3 { font-size: 1.075rem; }
          .announcement-detail-content p { margin-bottom: 1rem; font-size: 15px; line-height: 1.75; }
          .announcement-detail-content blockquote { padding: .75rem 1rem; font-size: 14px; }
          .announcement-detail-content table { display: block; width: 100%; overflow-x: auto; font-size: 13px; }
          .announcement-detail-content .video-wrapper { width: 100% !important; margin: 1.5rem 0 !important; }
        }
      `}</style>
    </div>,
    document.body,
  );
}
