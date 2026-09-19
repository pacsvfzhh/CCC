import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertTriangle, Bell, Clock, ChevronLeft, ChevronRight, Gift, Wallet } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Employee, MessageWithRecipient } from '../../types';
import { useResponsive } from '../../lib/useResponsive';
import { useLanguage } from '../../lib/i18n/context';
import QuickCopyRichContent from './QuickCopyRichContent';

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
  const loadLoginPopupMessagesRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    void loadLoginPopupMessagesRef.current?.();
  }, [employee.id]);

  useLayoutEffect(() => {
    const scrollY = window.scrollY;
    const body = document.body;
    const previousStyles = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      overflow: body.style.overflow,
      paddingRight: body.style.paddingRight,
    };

    if (isDesktop) {
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      body.style.overflow = 'hidden';
      if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
    } else {
      body.style.position = 'fixed';
      body.style.top = `-${scrollY}px`;
      body.style.left = '0';
      body.style.right = '0';
      body.style.overflow = 'hidden';
    }

    return () => {
      Object.assign(body.style, previousStyles);
      if (!isDesktop) window.scrollTo(0, scrollY);
    };
  }, [isDesktop]);

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
            notification_category,
            reward_amount,
            reward_currency,
            automation_execution_id,
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
  loadLoginPopupMessagesRef.current = loadLoginPopupMessages;

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
    const isReward = currentMessage.messages.notification_category === 'performance_reward';

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
              className={`relative flex-shrink-0 bg-gradient-to-br px-4 py-3 shadow-lg sm:px-5 sm:py-3.5 ${isReward ? 'from-amber-500 via-yellow-500 to-orange-500' : 'from-blue-600 via-blue-700 to-blue-800'}`}
              style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
            >
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(255,255,255,0.1)_0%,_transparent_60%)]" />
              <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg border backdrop-blur-sm sm:h-10 sm:w-10 ${isReward ? 'border-amber-900/15 bg-amber-950/10' : 'border-white/20 bg-white/15'}`}>
                    {isReward ? <Gift className="h-5 w-5 text-amber-950" /> : <Bell className="w-5 h-5 text-white" />}
                  </div>
                  <div>
                    <h2 className={`text-lg font-bold leading-tight sm:text-xl ${isReward ? 'text-amber-950' : 'text-white'}`}>{isReward ? t.messages.rewardTitle : t.loginPopup.notification}</h2>
                    <p className={`mt-0 text-xs ${isReward ? 'text-amber-950/70' : 'text-blue-100'}`}>
                      {currentIndex + 1} {t.loginPopup.of} {messages.length}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleClose}
                  className={`notification-panel-close flex h-8 w-8 items-center justify-center rounded-lg backdrop-blur-sm transition-colors active:scale-95 ${isReward ? 'bg-amber-950/10 text-amber-950 hover:bg-amber-950/15' : 'bg-white/15 text-white hover:bg-white/25'}`}
                  style={{ WebkitTapHighlightColor: 'transparent' }}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Page indicator dots */}
              {messages.length > 1 && (
                <div className="relative mt-3 flex items-center gap-1">
                  {messages.map((_, idx) => (
                    <div
                      key={idx}
                      className={`h-1 rounded-full transition-all duration-300 ${
                        idx === currentIndex
                          ? `w-8 ${isReward ? 'bg-amber-950/80' : 'bg-white'}`
                          : idx < currentIndex
                          ? `w-4 ${isReward ? 'bg-amber-950/35' : 'bg-white/50'}`
                          : `w-4 ${isReward ? 'bg-amber-950/20' : 'bg-white/25'}`
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Content area */}
            <div className={`relative flex-1 overflow-y-auto ${isReward ? 'reward-notification-scrollbar' : 'scrollbar-thin'}`} style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
              <div className="px-5 py-5">
                <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm shadow-blue-900/5 overflow-hidden">
                  {isReward && (
                    <div className="border-b border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-5 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-black text-amber-800">{t.messages.rewardBonusLabel}</p>
                          <p className="mt-0.5 text-[10px] font-black uppercase tracking-[0.16em] text-amber-600">{t.messages.rewardWalletLabel}</p>
                        </div>
                        <p className="shrink-0 text-2xl font-black text-amber-700">+{Number(currentMessage.messages.reward_amount || 0).toFixed(2)} <span className="text-base">{currentMessage.messages.reward_currency}</span></p>
                      </div>
                      <div className="mt-3 flex items-center gap-2 border-t border-amber-200/80 pt-3">
                        <Wallet className="h-4 w-4 shrink-0 text-emerald-600" />
                        <p className="text-xs font-semibold leading-5 text-emerald-700">{t.messages.rewardAddedMessage}</p>
                      </div>
                    </div>
                  )}
                  <div className={`px-5 py-4 border-b border-slate-100 bg-gradient-to-r ${isReward ? 'from-amber-50/60 to-transparent' : 'from-blue-50/50 to-transparent'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-lg font-bold text-slate-900 leading-snug break-words">
                        {currentMessage.messages.title}
                      </h3>
                      {getPriorityBadge(currentMessage.messages.priority)}
                    </div>
                    <div className="flex items-center gap-1.5 mt-2.5 text-slate-500">
                      <Clock className="w-3.5 h-3.5" />
                      <span className="text-xs">{new Date(currentMessage.messages.created_at || 0).toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="px-5 py-5">
                    <QuickCopyRichContent
                      html={currentMessage.messages.content}
                      copyLabel={t.messages.quickCopy}
                      copiedLabel={t.messages.copied}
                      className="prose prose-sm max-w-none leading-relaxed break-words message-content-dark"
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
                    className={`flex-[2] min-h-[44px] h-12 flex items-center justify-center gap-1.5 rounded-xl font-semibold transition-all ${isReward ? 'bg-gradient-to-r from-amber-500 via-yellow-500 to-orange-500 text-amber-950 shadow-md shadow-amber-500/25 active:from-amber-600 active:via-yellow-600 active:to-orange-600' : 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-blue-500/25 active:from-blue-700 active:to-blue-800'}`}
                  >
                    <span>{currentIndex < messages.length - 1 ? t.loginPopup.next : t.loginPopup.done}</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleClose}
                  className={`w-full min-h-[44px] h-12 flex items-center justify-center gap-2 rounded-xl font-semibold transition-all ${isReward ? 'bg-gradient-to-r from-amber-500 via-yellow-500 to-orange-500 text-amber-950 shadow-md shadow-amber-500/25 active:from-amber-600 active:via-yellow-600 active:to-orange-600' : 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-blue-500/25 active:from-blue-700 active:to-blue-800'}`}
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
              <div className={`relative flex-shrink-0 bg-gradient-to-br px-6 py-4 lg:px-7 ${isReward ? 'from-amber-500 via-yellow-500 to-orange-500' : 'from-blue-600 via-blue-700 to-blue-800'}`}>
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(255,255,255,0.12)_0%,_transparent_50%)]" />
                <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

                <div className="relative flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-xl border shadow-lg sm:h-10 sm:w-10 ${isReward ? 'border-amber-900/15 bg-amber-950/10' : 'border-white/20 bg-white/15 shadow-blue-900/20'}`}>
                      {isReward ? <Gift className="h-5 w-5 text-amber-950" /> : <Bell className="w-5 w-5 text-white" />}
                    </div>
                    <div>
                      <h2 className={`text-xl font-bold leading-tight tracking-tight lg:text-2xl ${isReward ? 'text-amber-950' : 'text-white'}`}>
                        {isReward ? t.messages.rewardTitle : t.loginPopup.notification}
                      </h2>
                      <p className={`mt-0 text-sm ${isReward ? 'text-amber-950/70' : 'text-blue-100'}`}>
                        {messages.length} {t.loginPopup.newMessages}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={handleClose}
                    className={`notification-panel-close flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${isReward ? 'bg-amber-950/10 text-amber-950 hover:bg-amber-950/15' : 'bg-white/15 text-white hover:bg-white/25'}`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Page indicator */}
                {messages.length > 1 && (
                  <div className="relative mt-3 flex items-center gap-1">
                    {messages.map((_, idx) => (
                      <div
                        key={idx}
                        className={`h-1 rounded-full transition-all duration-300 ${
                        idx === currentIndex
                          ? `w-8 ${isReward ? 'bg-amber-950/80' : 'bg-white'}`
                          : idx < currentIndex
                          ? `w-4 ${isReward ? 'bg-amber-950/35' : 'bg-white/50'}`
                          : `w-4 ${isReward ? 'bg-amber-950/20' : 'bg-white/25'}`
                      }`}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Message content area */}
              <div className={`flex-1 overflow-y-auto ${isReward ? 'reward-notification-scrollbar' : 'scrollbar-thin'}`}>
                <div className="px-8 py-7">
                  <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-blue-900/5">
                    {isReward && (
                      <div className="border-b border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-5 py-4 lg:px-7">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-black text-amber-800">{t.messages.rewardBonusLabel}</p>
                            <p className="mt-0.5 text-[10px] font-black uppercase tracking-[0.16em] text-amber-600">{t.messages.rewardWalletLabel}</p>
                          </div>
                          <p className="shrink-0 text-2xl font-black text-amber-700">+{Number(currentMessage.messages.reward_amount || 0).toFixed(2)} <span className="text-base">{currentMessage.messages.reward_currency}</span></p>
                        </div>
                        <div className="mt-3 flex items-center gap-2 border-t border-amber-200/80 pt-3">
                          <Wallet className="h-4 w-4 shrink-0 text-emerald-600" />
                          <p className="text-xs font-semibold leading-5 text-emerald-700">{t.messages.rewardAddedMessage}</p>
                        </div>
                      </div>
                    )}
                    <div className={`px-5 py-4 lg:px-7 ${isReward ? 'bg-gradient-to-r from-amber-50/60 to-transparent' : 'bg-white'}`}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <h3 className="text-xl font-bold leading-snug text-slate-900 break-words">
                            {currentMessage.messages.title}
                          </h3>
                          <div className="mt-2.5 flex items-center gap-2">
                            <Clock className="h-3.5 w-3.5 text-slate-400" />
                            <span className="text-sm text-slate-500">
                              {new Date(currentMessage.messages.created_at || 0).toLocaleString()}
                            </span>
                          </div>
                        </div>
                        {getPriorityBadge(currentMessage.messages.priority)}
                      </div>
                      <div className={`mt-4 h-px bg-gradient-to-r from-transparent to-transparent ${isReward ? 'via-orange-200' : 'via-slate-200'}`} />
                    </div>
                    <div className="px-5 py-5 lg:px-7">
                      <QuickCopyRichContent
                        html={currentMessage.messages.content}
                        copyLabel={t.messages.quickCopy}
                        copiedLabel={t.messages.copied}
                        className="prose prose-base max-w-none leading-relaxed break-words message-content-dark [&_img]:rounded-xl [&_img]:shadow-md [&_img]:border [&_img]:border-slate-200"
                        style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}
                      />
                    </div>
                  </div>
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
                        className={`min-h-[44px] flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-sm transition-all ${isReward ? 'bg-gradient-to-r from-amber-500 via-yellow-500 to-orange-500 text-amber-950 shadow-md shadow-amber-500/25 hover:from-amber-600 hover:via-yellow-600 hover:to-orange-600 hover:shadow-lg hover:shadow-amber-500/35' : 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md shadow-blue-500/20 hover:from-blue-700 hover:to-blue-800 hover:shadow-lg hover:shadow-blue-500/30'}`}
                      >
                        <span>{currentIndex < messages.length - 1 ? t.loginPopup.next : t.loginPopup.done}</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={handleClose}
                      className={`w-full min-h-[44px] flex items-center justify-center gap-2 px-8 py-3 rounded-xl font-semibold transition-all ${isReward ? 'bg-gradient-to-r from-amber-500 via-yellow-500 to-orange-500 text-amber-950 shadow-md shadow-amber-500/25 hover:from-amber-600 hover:via-yellow-600 hover:to-orange-600 hover:shadow-lg hover:shadow-amber-500/35' : 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md shadow-blue-500/20 hover:from-blue-700 hover:to-blue-800 hover:shadow-lg hover:shadow-blue-500/30'}`}
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
