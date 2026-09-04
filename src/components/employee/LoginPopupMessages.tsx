import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertTriangle, Bell, Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Employee, MessageWithRecipient } from '../../types';
import { useResponsive } from '../../lib/useResponsive';
import { sanitizeHTML } from '../../lib/sanitizeHTML';
import { useLanguage } from '../../lib/i18n';

interface LoginPopupMessagesProps {
  employee: Employee;
  onClose: () => void;
}

export default function LoginPopupMessages({ employee, onClose }: LoginPopupMessagesProps) {
  const [messages, setMessages] = useState<MessageWithRecipient[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const { isMobile, isDesktop } = useResponsive();
  const { t } = useLanguage();

  useEffect(() => {
    loadLoginPopupMessages();
  }, [employee.id]);

  useEffect(() => {
    const scrollY = window.scrollY;
    const body = document.body;
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.overflow = 'hidden';
    return () => {
      body.style.position = '';
      body.style.top = '';
      body.style.left = '';
      body.style.right = '';
      body.style.overflow = '';
      window.scrollTo(0, scrollY);
    };
  }, []);

  const loadLoginPopupMessages = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('message_recipients')
        .select(`
          id,
          message_id,
          recipient_id,
          is_read,
          read_at,
          is_shown,
          shown_at,
          created_at,
          messages!inner (
            id,
            sender_username,
            title,
            content,
            message_type,
            priority,
            created_at
          )
        `)
        .eq('recipient_id', employee.id)
        .eq('is_shown', false)
        .eq('messages.message_type', 'login_popup')
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) throw error;

      setMessages(data || []);
    } catch (error) {
      console.error('Error loading login popup messages:', error);
    } finally {
      setLoading(false);
    }
  };

  const markCurrentAsShown = async () => {
    if (messages.length === 0 || !messages[currentIndex]) return;

    const msg = messages[currentIndex];

    try {
      await supabase
        .from('message_recipients')
        .update({
          is_shown: true,
          shown_at: new Date().toISOString(),
          is_read: true,
          read_at: new Date().toISOString()
        })
        .eq('message_id', msg.message_id)
        .eq('recipient_id', employee.id);
    } catch (error) {
      console.error('Error marking message as shown:', error);
    }
  };

  const handleNext = async () => {
    await markCurrentAsShown();

    if (currentIndex < messages.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      onClose();
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const handleClose = async () => {
    for (const msg of messages) {
      try {
        await supabase
          .from('message_recipients')
          .update({
            is_shown: true,
            shown_at: new Date().toISOString()
          })
          .eq('message_id', msg.message_id)
          .eq('recipient_id', employee.id);
      } catch (error) {
        console.error('Error marking message as shown:', error);
      }
    }
    onClose();
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-500/10 border border-red-200 rounded-full">
            <AlertTriangle className="w-3 h-3 text-red-500" />
            <span className="text-xs font-semibold text-red-600 uppercase">Urgent</span>
          </span>
        );
      case 'high':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-orange-500/10 border border-orange-200 rounded-full">
            <span className="text-xs font-semibold text-orange-600 uppercase">High</span>
          </span>
        );
      default:
        return null;
    }
  };

  const useFullscreen = !isDesktop;

  const content = (() => {
    if (loading) {
      return (
        <div
          className="fixed inset-0 bg-slate-900/50 flex items-center justify-center"
          style={{ zIndex: 10100, touchAction: 'none', overscrollBehavior: 'contain' }}
        >
          <div className="text-center">
            <div className="w-14 h-14 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-white text-base font-medium">Loading...</p>
          </div>
        </div>
      );
    }

    if (messages.length === 0) {
      return null;
    }

    const currentMessage = messages[currentIndex];

    if (useFullscreen) {
      return (
        <>
          <div
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm"
            style={{ zIndex: 10100 }}
          />
          <div
            className="fixed inset-0 flex flex-col"
            style={{
              zIndex: 10101,
              touchAction: 'none',
              overscrollBehavior: 'contain',
              animation: 'fadeIn 0.2s ease-out'
            }}
          >
            <div className="absolute inset-0 bg-[#f0f5ff]" />

            {/* Blue gradient header */}
            <div
              className="relative flex-shrink-0 bg-gradient-to-br from-blue-600 via-blue-700 to-blue-800 px-5 py-5 shadow-lg"
              style={{ paddingTop: isMobile ? 'calc(env(safe-area-inset-top, 0px) + 20px)' : undefined }}
            >
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(255,255,255,0.1)_0%,_transparent_60%)]" />
              <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 sm:w-11 sm:h-11 bg-white/15 rounded-xl flex items-center justify-center backdrop-blur-sm border border-white/20">
                    <Bell className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white">{t.loginPopup.notification}</h2>
                    <p className="text-blue-100 text-xs mt-0.5">
                      {currentIndex + 1} {t.loginPopup.of} {messages.length}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleClose}
                  className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/15 hover:bg-white/25 backdrop-blur-sm transition-colors text-white active:scale-95"
                  style={{ WebkitTapHighlightColor: 'transparent' }}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Page indicator dots */}
              {messages.length > 1 && (
                <div className="relative flex items-center gap-1.5 mt-4">
                  {messages.map((_, idx) => (
                    <div
                      key={idx}
                      className={`h-1 rounded-full transition-all duration-300 ${
                        idx === currentIndex
                          ? 'w-8 bg-white'
                          : idx < currentIndex
                          ? 'w-4 bg-white/50'
                          : 'w-4 bg-white/25'
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Content area */}
            <div className="relative flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
              <div className="px-5 py-5">
                <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm shadow-blue-900/5 overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-blue-50/50 to-transparent">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-lg font-bold text-slate-900 leading-snug break-words">
                        {currentMessage.messages.title}
                      </h3>
                      {getPriorityBadge(currentMessage.messages.priority)}
                    </div>
                    <div className="flex items-center gap-1.5 mt-2.5 text-slate-500">
                      <Clock className="w-3.5 h-3.5" />
                      <span className="text-xs">{new Date(currentMessage.messages.created_at).toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="px-5 py-5">
                    <div
                      className="prose prose-sm max-w-none leading-relaxed break-words message-content-dark"
                      dangerouslySetInnerHTML={{ __html: sanitizeHTML(currentMessage.messages.content, {
                        allowedAttributes: ['href', 'src', 'alt', 'title', 'class', 'target', 'rel', 'width', 'height', 'style', 'size']
                      }) }}
                      style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Footer with navigation */}
            <div className="relative flex-shrink-0 px-5 py-4 bg-white border-t border-slate-200/80 shadow-[0_-4px_12px_rgba(0,0,0,0.03)]"
              style={{ paddingBottom: isMobile ? 'calc(env(safe-area-inset-bottom, 0px) + 16px)' : undefined }}
            >
              {messages.length > 1 ? (
                <div className="flex items-center gap-3">
                  <button
                    onClick={handlePrevious}
                    disabled={currentIndex === 0}
                    className="flex-1 min-h-[44px] h-12 flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium disabled:opacity-40 disabled:cursor-not-allowed active:bg-slate-50 transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>{t.loginPopup.prev}</span>
                  </button>
                  <button
                    onClick={handleNext}
                    className="flex-[2] min-h-[44px] h-12 flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold shadow-md shadow-blue-500/25 active:from-blue-700 active:to-blue-800 transition-all"
                  >
                    <span>{currentIndex < messages.length - 1 ? t.loginPopup.next : t.loginPopup.done}</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleClose}
                  className="w-full min-h-[44px] h-12 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold shadow-md shadow-blue-500/25 active:from-blue-700 active:to-blue-800 transition-all"
                >
                  <span>{t.loginPopup.gotIt}</span>
                </button>
              )}
            </div>
          </div>
        </>
      );
    }

    // Desktop layout
    return (
      <>
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm"
          style={{ zIndex: 10100 }}
          onClick={handleClose}
        />

        {/* Decorative orbs */}
        <div className="fixed top-1/3 left-1/3 w-[500px] h-[500px] bg-blue-400/10 rounded-full blur-3xl pointer-events-none" style={{ zIndex: 10100 }} />
        <div className="fixed bottom-1/3 right-1/3 w-[400px] h-[400px] bg-sky-300/10 rounded-full blur-3xl pointer-events-none" style={{ zIndex: 10100 }} />

        {/* Modal container */}
        <div
          className="fixed inset-0 flex items-center justify-center p-6 pointer-events-none"
          style={{ zIndex: 10101 }}
        >
          <div
            className="relative w-full max-w-2xl max-h-[85vh] flex flex-col pointer-events-auto"
            style={{ animation: 'fadeIn 0.25s ease-out' }}
          >
            <div className="relative bg-white rounded-3xl shadow-2xl shadow-blue-900/15 border border-slate-200/60 overflow-hidden flex flex-col max-h-[85vh]">

              {/* Blue gradient header */}
              <div className="relative flex-shrink-0 bg-gradient-to-br from-blue-600 via-blue-700 to-blue-800 px-8 py-7">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(255,255,255,0.12)_0%,_transparent_50%)]" />
                <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

                <div className="relative flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 sm:w-11 sm:h-11 bg-white/15 rounded-2xl flex items-center justify-center backdrop-blur-sm border border-white/20 shadow-lg shadow-blue-900/20">
                      <Bell className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-white tracking-tight">
                        {t.loginPopup.notification}
                      </h2>
                      <p className="text-blue-100 text-sm mt-0.5">
                        {messages.length} {t.loginPopup.newMessages}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={handleClose}
                    className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/15 hover:bg-white/25 backdrop-blur-sm transition-colors text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Page indicator */}
                {messages.length > 1 && (
                  <div className="relative flex items-center gap-1.5 mt-5">
                    {messages.map((_, idx) => (
                      <div
                        key={idx}
                        className={`h-1 rounded-full transition-all duration-300 ${
                          idx === currentIndex
                            ? 'w-8 bg-white'
                            : idx < currentIndex
                            ? 'w-4 bg-white/50'
                            : 'w-4 bg-white/25'
                        }`}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Message content area */}
              <div className="flex-1 overflow-y-auto">
                <div className="px-8 py-7">
                  <div className="flex items-start justify-between gap-4 mb-5">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-xl font-bold text-slate-900 leading-snug break-words">
                        {currentMessage.messages.title}
                      </h3>
                      <div className="flex items-center gap-2 mt-2.5">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span className="text-sm text-slate-500">
                          {new Date(currentMessage.messages.created_at).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    {getPriorityBadge(currentMessage.messages.priority)}
                  </div>

                  <div className="h-px bg-gradient-to-r from-blue-100 via-slate-200 to-transparent mb-6" />

                  <div
                    className="prose prose-base max-w-none leading-relaxed break-words message-content-dark [&_img]:rounded-xl [&_img]:shadow-md [&_img]:border [&_img]:border-slate-200"
                    dangerouslySetInnerHTML={{ __html: sanitizeHTML(currentMessage.messages.content, {
                      allowedAttributes: ['href', 'src', 'alt', 'title', 'class', 'target', 'rel', 'width', 'height', 'style', 'size']
                    }) }}
                    style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="flex-shrink-0 px-8 py-5 border-t border-slate-100 bg-gradient-to-r from-slate-50/80 to-blue-50/30">
                <div className="flex items-center justify-between">
                  {messages.length > 1 ? (
                    <>
                      <button
                        onClick={handlePrevious}
                        disabled={currentIndex === 0}
                        className="min-h-[44px] flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium text-sm hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
                      >
                        <ChevronLeft className="w-4 h-4" />
                        <span>{t.loginPopup.prev}</span>
                      </button>

                      <span className="text-sm text-slate-400 font-medium">
                        {currentIndex + 1} {t.loginPopup.of} {messages.length}
                      </span>

                      <button
                        onClick={handleNext}
                        className="min-h-[44px] flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold text-sm hover:from-blue-700 hover:to-blue-800 transition-all shadow-md shadow-blue-500/20 hover:shadow-lg hover:shadow-blue-500/30"
                      >
                        <span>{currentIndex < messages.length - 1 ? t.loginPopup.next : t.loginPopup.done}</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={handleClose}
                      className="w-full min-h-[44px] flex items-center justify-center gap-2 px-8 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold hover:from-blue-700 hover:to-blue-800 transition-all shadow-md shadow-blue-500/20 hover:shadow-lg hover:shadow-blue-500/30"
                    >
                      <span>{t.loginPopup.gotIt}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  })();

  if (!content) return null;

  return createPortal(content, document.body);
}
