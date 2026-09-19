import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Bell, Clock, ChevronRight, Gift, Wallet } from 'lucide-react';
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
  const { t, dateLocale } = useLanguage();
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
            className="fixed inset-0 bg-slate-900/50"
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

            {/* Detail Header */}
            <div className="relative flex-shrink-0 overflow-hidden">
              <div className={`absolute inset-0 bg-gradient-to-br ${isReward ? 'from-amber-500 via-yellow-500 to-orange-500' : 'from-blue-600 via-blue-500 to-cyan-500'}`} />
              <div className="absolute top-0 right-0 h-48 w-48 opacity-[0.06]">
                <div className="absolute top-6 right-6 h-24 w-24 rotate-12 rounded-2xl border-2 border-white" />
                <div className="absolute top-2 right-28 h-14 w-14 -rotate-6 rounded-xl border-2 border-white" />
              </div>
              <div className="absolute bottom-0 left-0 h-24 w-24 -translate-x-1/3 translate-y-1/2 rounded-full bg-white/[0.04]" />

              <div
                className="relative px-4 pb-3 pt-7 lg:px-6 lg:pb-3 lg:pt-7"
                style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)' }}
              >
                <button
                  onClick={handleClose}
                  aria-label={t.messages.close}
                  className={`notification-panel-close absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-lg backdrop-blur-sm transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 ${isReward ? 'border border-amber-950/20 bg-amber-950/15 text-amber-950 hover:bg-amber-950/25 focus-visible:ring-amber-950/35' : 'bg-white/15 text-white hover:bg-white/25 focus-visible:ring-white/60'}`}
                  style={{ WebkitTapHighlightColor: 'transparent' }}
                >
                  <X className="h-5 w-5" strokeWidth={2.5} />
                </button>

                <div className="mb-3 flex items-center gap-2 pr-10">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isReward ? 'bg-amber-950/70' : 'bg-cyan-200'}`} />
                  <p className={`text-sm font-black uppercase tracking-[0.16em] ${isReward ? 'text-amber-950/80' : 'text-cyan-100'}`}>
                    {t.messages.loginNotification}
                  </p>
                </div>

                <div className="flex items-start gap-2.5 pr-10">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border backdrop-blur-sm sm:h-10 sm:w-10 ${isReward ? 'border-amber-950/20 bg-amber-950/15 text-amber-950 shadow-sm shadow-amber-950/10' : 'border-white/20 bg-white/15'}`}>
                    {isReward ? <Gift className="h-5 w-5" strokeWidth={2} /> : <Bell className="h-5 w-5 text-white" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className={`mb-1 break-words text-lg font-bold leading-tight ${isReward ? 'text-amber-950' : 'text-white'}`}>
                      {currentMessage.messages.title}
                    </h3>
                    <div className={`flex flex-wrap items-center gap-2 text-sm font-medium ${isReward ? 'text-amber-950/75' : 'text-blue-100/90'}`}>
                      <div className="flex items-center gap-1.5">
                        <Clock className={`h-3.5 w-3.5 ${isReward ? 'text-amber-950/70' : 'text-cyan-200'}`} />
                        <span>{new Date(currentMessage.messages.created_at || 0).toLocaleDateString(dateLocale, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                      </div>
                      <span className={isReward ? 'text-amber-950/30' : 'text-white/20'}>|</span>
                      <span>{new Date(currentMessage.messages.created_at || 0).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5 pr-10">
                  <span className={`rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${isReward ? 'border-orange-800/25 bg-orange-800/20 text-orange-950' : 'border-white/15 bg-white/15 text-white'}`}>
                    {currentMessage.messages.priority === 'urgent' ? t.messages.priorityUrgent : currentMessage.messages.priority === 'high' ? t.messages.priorityHigh : currentMessage.messages.priority === 'normal' ? t.messages.priorityNormal : t.messages.priorityLow} {t.messages.priority}
                  </span>
                </div>
              </div>
            </div>

            {/* Detail Content */}
            <div className="relative flex min-h-0 flex-1 overflow-hidden p-0" style={{ minHeight: 0, WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
              <div className={`relative flex min-h-0 flex-1 flex-col overflow-hidden border ${isReward ? 'border-amber-200/90 bg-gradient-to-b from-amber-100 via-orange-50 to-amber-100/75' : 'border-blue-200/80 bg-gradient-to-b from-blue-100/80 via-sky-50 to-blue-100/55'}`}>
                <div className={`absolute left-6 right-6 top-0 h-[2px] rounded-full bg-gradient-to-r from-transparent to-transparent ${isReward ? 'via-amber-400' : 'via-blue-300'}`} />

                {isReward && (
                  <div className="shrink-0 border-b border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-4">
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

                <div className={`min-h-0 flex-1 overflow-y-auto p-4 ${isReward ? 'reward-notification-scrollbar' : 'scrollbar-thin'}`}>
                  <QuickCopyRichContent
                    html={currentMessage.messages.content}
                    copyLabel={t.messages.quickCopy}
                    copiedLabel={t.messages.copied}
                    className="prose prose-sm max-w-none leading-relaxed [&_a]:!text-blue-600 [&_a]:underline [&_img]:!rounded-xl [&_img]:!shadow-md [&_blockquote]:!border-l-blue-400 [&_blockquote]:!bg-blue-50/50 [&_blockquote]:!p-4 [&_blockquote]:!rounded-r-lg [&_h1]:!text-slate-900 [&_h2]:!text-slate-800 [&_h3]:!text-slate-700 [&_p]:!text-slate-700 [&_li]:!text-slate-700 message-content-dark"
                    style={{ wordBreak: 'break-word', overflowWrap: 'break-word', color: '#1e293b' }}
                  />
                </div>
              </div>
            </div>

            {/* Footer with navigation */}
            <div
              className={`relative flex-shrink-0 border-t px-5 py-4 shadow-[0_-10px_24px_rgba(15,23,42,0.08)] backdrop-blur-sm ${isReward ? 'border-amber-200/80 bg-amber-50/90 shadow-amber-900/10' : 'border-slate-200/70 bg-white/95'}`}
              style={{ paddingBottom: isMobile ? 'calc(env(safe-area-inset-bottom, 0px) + 16px)' : undefined }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ${isReward ? 'bg-amber-100 text-amber-700 ring-amber-200' : 'bg-blue-50 text-blue-600 ring-blue-200'}`}>
                    {isReward ? <Gift className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0">
                    <p className={`truncate text-[10px] font-bold uppercase tracking-[0.14em] ${isReward ? 'text-amber-700' : 'text-slate-400'}`}>
                      {messages.length > 1 ? `${currentIndex + 1} ${t.loginPopup.of} ${messages.length}` : t.loginPopup.notification}
                    </p>
                    <p className={`mt-1 truncate text-sm font-semibold ${isReward ? 'text-amber-900' : 'text-slate-700'}`}>
                      {currentIndex < messages.length - 1 ? t.loginPopup.next : t.loginPopup.gotIt}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={handleClose}
                    aria-label={t.messages.close}
                    title={t.messages.close}
                    className={`notification-panel-close flex h-8 w-8 items-center justify-center rounded-xl border transition-colors active:scale-95 ${isReward ? 'border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-200' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'}`}
                  >
                    <X className="h-4 w-4" strokeWidth={2.5} />
                  </button>
                  <button
                    onClick={handleNext}
                    className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all active:scale-[0.98] ${isReward ? 'bg-gradient-to-r from-amber-500 via-yellow-500 to-orange-500 text-amber-950 shadow-md shadow-amber-500/25 active:from-amber-600 active:via-yellow-600 active:to-orange-600' : 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md shadow-blue-500/25 active:from-blue-700 active:to-blue-800'}`}
                  >
                    <span>{messages.length > 1 && currentIndex < messages.length - 1 ? t.loginPopup.next : messages.length > 1 ? t.loginPopup.done : t.loginPopup.gotIt}</span>
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      );
    }

    // Desktop layout
    return (
      <>
        <div
          className="fixed inset-0 bg-slate-900/50"
          style={{ zIndex: 10100 }}
          onClick={handleClose}
        />


        {/* Modal container */}
        <div
          className="fixed inset-0 flex items-center justify-center p-6 pointer-events-none"
          style={{ zIndex: 10101 }}
        >
          <div
            className="relative w-full max-w-2xl max-h-[85vh] flex flex-col pointer-events-auto"
            style={{ animation: 'fadeIn 0.25s ease-out' }}
          >
            <div className="relative overflow-hidden flex flex-col pointer-events-auto bg-[#f0f5ff] w-full h-full lg:w-full lg:max-w-2xl lg:h-[82vh] lg:rounded-3xl lg:shadow-2xl">

              {/* Blue gradient header */}
              <div className="relative flex-shrink-0 overflow-hidden">
                <div className={`absolute inset-0 bg-gradient-to-br ${isReward ? 'from-amber-500 via-yellow-500 to-orange-500' : 'from-blue-600 via-blue-500 to-cyan-500'}`} />
                <div className="absolute top-0 right-0 h-48 w-48 opacity-[0.06]">
                  <div className="absolute top-6 right-6 h-24 w-24 rotate-12 rounded-2xl border-2 border-white" />
                  <div className="absolute top-2 right-28 h-14 w-14 -rotate-6 rounded-xl border-2 border-white" />
                </div>
                <div className="absolute bottom-0 left-0 h-24 w-24 -translate-x-1/3 translate-y-1/2 rounded-full bg-white/[0.04]" />

                <div className="relative px-4 pb-3 pt-7 lg:px-6 lg:pb-3 lg:pt-7">
                  <div className="mb-3 flex items-center gap-2 pr-10">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isReward ? 'bg-amber-950/70' : 'bg-cyan-200'}`} />
                    <p className={`text-sm font-black uppercase tracking-[0.16em] ${isReward ? 'text-amber-950/80' : 'text-cyan-100'}`}>
                      {t.messages.loginNotification}
                    </p>
                  </div>

                  <div className="flex items-start gap-2.5 pr-10">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border backdrop-blur-sm sm:h-10 sm:w-10 ${isReward ? 'border-amber-950/20 bg-amber-950/15 text-amber-950 shadow-sm shadow-amber-950/10' : 'border-white/20 bg-white/15'}`}>
                      {isReward ? <Gift className="h-5 w-5 text-amber-950" /> : <Bell className="w-5 w-5 text-white" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className={`mb-1 break-words text-lg font-bold leading-tight lg:text-xl ${isReward ? 'text-amber-950' : 'text-white'}`}>
                        {currentMessage.messages.title}
                      </h3>
                      <div className={`flex flex-wrap items-center gap-2 text-sm font-medium ${isReward ? 'text-amber-950/75' : 'text-blue-100/90'}`}>
                        <div className="flex items-center gap-1.5">
                          <Clock className={`h-3.5 w-3.5 ${isReward ? 'text-amber-950/70' : 'text-cyan-200'}`} />
                          <span>{new Date(currentMessage.messages.created_at || 0).toLocaleDateString(dateLocale, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                        </div>
                        <span className={isReward ? 'text-amber-950/30' : 'text-white/20'}>|</span>
                        <span>{new Date(currentMessage.messages.created_at || 0).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={handleClose}
                    className={`notification-panel-close absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-lg backdrop-blur-sm transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 lg:right-6 lg:top-5 ${isReward ? 'border border-amber-950/20 bg-amber-950/15 text-amber-950 hover:bg-amber-950/25 focus-visible:ring-amber-950/35' : 'bg-white/15 text-white hover:bg-white/25 focus-visible:ring-white/60'}`}
                  >
                    <X className="h-5 w-5" strokeWidth={2.5} />
                  </button>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5 pr-10">
                  <span className={`rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider lg:text-[10px] ${isReward ? 'border-orange-800/25 bg-orange-800/20 text-orange-950' : 'border-white/15 bg-white/15 text-white'}`}>
                    {currentMessage.messages.priority === 'urgent' ? t.messages.priorityUrgent : currentMessage.messages.priority === 'high' ? t.messages.priorityHigh : currentMessage.messages.priority === 'normal' ? t.messages.priorityNormal : t.messages.priorityLow} {t.messages.priority}
                  </span>
                </div>
              </div>

              {/* Detail Content */}
              <div className="relative flex min-h-0 flex-1 overflow-hidden p-0" style={{ minHeight: 0, WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
                <div className={`relative flex min-h-0 flex-1 flex-col overflow-hidden border ${isReward ? 'border-amber-200/90 bg-gradient-to-b from-amber-100 via-orange-50 to-amber-100/75' : 'border-blue-200/80 bg-gradient-to-b from-blue-100/80 via-sky-50 to-blue-100/55'}`}>
                  <div className={`absolute left-6 right-6 top-0 h-[2px] rounded-full bg-gradient-to-r from-transparent to-transparent ${isReward ? 'via-amber-400' : 'via-blue-300'}`} />

                  {isReward && (
                    <div className="shrink-0 border-b border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-4 lg:px-7">
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

                  <div className={`min-h-0 flex-1 overflow-y-auto p-4 lg:p-5 ${isReward ? 'reward-notification-scrollbar' : 'scrollbar-thin'}`}>
                    <QuickCopyRichContent
                      html={currentMessage.messages.content}
                      copyLabel={t.messages.quickCopy}
                      copiedLabel={t.messages.copied}
                      className="prose prose-sm lg:prose-base max-w-none leading-relaxed [&_a]:!text-blue-600 [&_a]:underline [&_img]:!rounded-xl [&_img]:!shadow-md [&_blockquote]:!border-l-blue-400 [&_blockquote]:!bg-blue-50/50 [&_blockquote]:!p-4 [&_blockquote]:!rounded-r-lg [&_h1]:!text-slate-900 [&_h2]:!text-slate-800 [&_h3]:!text-slate-700 [&_p]:!text-slate-700 [&_li]:!text-slate-700 message-content-dark"
                      style={{ wordBreak: 'break-word', overflowWrap: 'break-word', color: '#1e293b' }}
                    />
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className={`flex-shrink-0 border-t px-8 py-5 shadow-[0_-10px_24px_rgba(15,23,42,0.08)] ${isReward ? 'border-amber-200/80 bg-gradient-to-r from-amber-50 via-yellow-50 to-orange-50' : 'border-slate-200/70 bg-gradient-to-r from-white via-slate-50/95 to-blue-50/60'}`}>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ${isReward ? 'bg-amber-100 text-amber-700 ring-amber-200' : 'bg-blue-50 text-blue-600 ring-blue-200'}`}>
                    {isReward ? <Gift className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0">
                    <p className={`truncate text-[10px] font-bold uppercase tracking-[0.14em] ${isReward ? 'text-amber-700' : 'text-slate-400'}`}>
                      {messages.length > 1 ? `${currentIndex + 1} ${t.loginPopup.of} ${messages.length}` : t.loginPopup.notification}
                    </p>
                    <p className={`mt-1 truncate text-sm font-semibold ${isReward ? 'text-amber-900' : 'text-slate-700'}`}>
                      {currentIndex < messages.length - 1 ? t.loginPopup.next : t.loginPopup.gotIt}
                    </p>
                  </div>
                </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={handleClose}
                      aria-label={t.messages.close}
                      title={t.messages.close}
                      className={`notification-panel-close flex h-8 w-8 items-center justify-center rounded-xl border transition-colors active:scale-95 ${isReward ? 'border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-200' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'}`}
                    >
                      <X className="h-4 w-4" strokeWidth={2.5} />
                    </button>
                    <button
                      onClick={handleNext}
                      className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold transition-all active:scale-[0.98] ${isReward ? 'bg-gradient-to-r from-amber-500 via-yellow-500 to-orange-500 text-amber-950 shadow-md shadow-amber-500/25 hover:from-amber-600 hover:via-yellow-600 hover:to-orange-600 hover:shadow-lg hover:shadow-amber-500/35' : 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md shadow-blue-500/20 hover:from-blue-700 hover:to-blue-800 hover:shadow-lg hover:shadow-blue-500/30'}`}
                    >
                      <span>{messages.length > 1 && currentIndex < messages.length - 1 ? t.loginPopup.next : messages.length > 1 ? t.loginPopup.done : t.loginPopup.gotIt}</span>
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
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
