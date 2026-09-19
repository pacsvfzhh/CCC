import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Bell, Eye, AlertCircle, CheckCircle, Clock, Zap, Shield, Radio, ChevronRight, MailOpen, Sparkles, Gift, Wallet } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Employee, MessageWithRecipient } from '../../types';
import { useResponsive } from '../../lib/useResponsive';
import { useLanguage } from '../../lib/i18n/context';
import QuickCopyRichContent from './QuickCopyRichContent';

interface MessageCenterProps {
  employee: Employee;
  onClose: () => void;
}

export default function MessageCenter({ employee, onClose }: MessageCenterProps) {
  const { t, dateLocale } = useLanguage();
  const [messages, setMessages] = useState<MessageWithRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread' | 'login' | 'realtime'>('all');
  const [selectedMessage, setSelectedMessage] = useState<MessageWithRecipient | null>(null);
  const { isDesktop } = useResponsive();
  const loadMessagesRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    void loadMessagesRef.current?.();
  }, [employee.id, filter]);

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

  const loadMessages = async () => {
    setLoading(true);
    try {
      let query = supabase
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
        .order('created_at', { ascending: false })
        .limit(50);

      if (filter === 'unread') {
        query = query.eq('is_read', false);
      } else if (filter === 'login') {
        query = query.eq('messages.message_type', 'login_popup');
      } else if (filter === 'realtime') {
        query = query.eq('messages.message_type', 'realtime');
      }

      const { data, error } = await query;
      if (error) throw error;
      setMessages(data || []);
    } catch (error) {
      console.error('Error loading messages:', error);
    } finally {
      setLoading(false);
    }
  };
  loadMessagesRef.current = loadMessages;

  const markAsRead = async (messageId: string) => {
    try {
      const { error } = await supabase
        .from('message_recipients')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('message_id', messageId)
        .eq('recipient_id', employee.id);
      if (error) throw error;
      setMessages(prev =>
        prev.map(msg =>
          msg.message_id === messageId
            ? { ...msg, is_read: true, read_at: new Date().toISOString() }
            : msg
        )
      );
    } catch (error) {
      console.error('Error marking message as read:', error);
    }
  };

  const openMessage = (msg: MessageWithRecipient) => {
    setSelectedMessage(msg);
    if (!msg.is_read) {
      markAsRead(msg.message_id);
    }
  };

  const getPriorityIcon = (priority: string, className: string) => {
    switch (priority) {
      case 'urgent': return <AlertCircle className={className} />;
      case 'high': return <Zap className={className} />;
      case 'normal': return <Shield className={className} />;
      default: return <Radio className={className} />;
    }
  };

  const getCardStyle = (priority: string, messageType: string, isUnread: boolean, index: number, isReward: boolean) => {
    if (isReward) {
      return isUnread
        ? {
            card: 'bg-gradient-to-br from-amber-100 via-yellow-50 to-orange-50 ring-2 ring-amber-300 shadow-xl shadow-amber-200/60',
            iconBg: 'bg-gradient-to-br from-amber-400 via-yellow-400 to-orange-400',
            iconText: 'text-amber-950',
            accent: 'from-amber-500 via-yellow-400 to-orange-400',
            patternColor: 'border-amber-400',
            dotColor: 'bg-amber-500',
          }
        : {
            card: 'bg-gradient-to-br from-amber-50/90 to-white ring-1 ring-amber-200 shadow-sm',
            iconBg: 'bg-amber-100',
            iconText: 'text-amber-600',
            accent: 'from-amber-300 via-yellow-200 to-orange-200',
            patternColor: 'border-amber-200',
            dotColor: 'bg-amber-300',
          };
    }
    if (isUnread) {
      if (priority === 'urgent') {
        return {
          card: 'bg-gradient-to-br from-rose-100 via-rose-50 to-orange-50 ring-2 ring-rose-300 shadow-lg shadow-rose-200/60',
          iconBg: 'bg-gradient-to-br from-rose-500 to-orange-500',
          iconText: 'text-white',
          accent: 'from-rose-500 via-red-400 to-orange-400',
          patternColor: 'border-rose-300',
          dotColor: 'bg-rose-500',
        };
      }
      if (priority === 'high') {
        return {
          card: 'bg-gradient-to-br from-amber-100 via-amber-50 to-yellow-50 ring-2 ring-amber-300 shadow-lg shadow-amber-200/60',
          iconBg: 'bg-gradient-to-br from-amber-500 to-yellow-500',
          iconText: 'text-white',
          accent: 'from-amber-500 via-yellow-400 to-orange-300',
          patternColor: 'border-amber-300',
          dotColor: 'bg-amber-500',
        };
      }
      if (messageType === 'realtime') {
        return {
          card: 'bg-gradient-to-br from-teal-100 via-teal-50 to-cyan-50 ring-2 ring-teal-300 shadow-lg shadow-teal-200/60',
          iconBg: 'bg-gradient-to-br from-teal-500 to-cyan-500',
          iconText: 'text-white',
          accent: 'from-teal-500 via-cyan-400 to-blue-400',
          patternColor: 'border-teal-300',
          dotColor: 'bg-teal-500',
        };
      }
      // Default unread (login or normal)
      const variants = [
        {
          card: 'bg-gradient-to-br from-blue-100 via-blue-50 to-sky-50 ring-2 ring-blue-300 shadow-lg shadow-blue-200/60',
          iconBg: 'bg-gradient-to-br from-blue-500 to-sky-500',
          iconText: 'text-white',
          accent: 'from-blue-500 via-sky-400 to-cyan-400',
          patternColor: 'border-blue-300',
          dotColor: 'bg-blue-500',
        },
        {
          card: 'bg-gradient-to-br from-blue-100 via-sky-50 to-cyan-50 ring-2 ring-blue-300 shadow-lg shadow-blue-200/60',
          iconBg: 'bg-gradient-to-br from-blue-600 to-sky-500',
          iconText: 'text-white',
          accent: 'from-blue-600 via-sky-400 to-cyan-400',
          patternColor: 'border-blue-300',
          dotColor: 'bg-blue-600',
        },
      ];
      return variants[index % 2];
    }

    // Read messages - muted, clearly different from unread
    return {
      card: 'bg-white/80 ring-1 ring-slate-200/60 shadow-sm',
      iconBg: 'bg-slate-100',
      iconText: 'text-slate-400',
      accent: 'from-slate-200 via-slate-200 to-slate-100',
      patternColor: 'border-slate-200',
      dotColor: 'bg-slate-300',
    };
  };

  const unreadCount = messages.filter(m => !m.is_read).length;

  const sortedMessages = [...messages].sort((a, b) => {
    if (!a.is_read && b.is_read) return -1;
    if (a.is_read && !b.is_read) return 1;
    return new Date(b.messages.created_at || 0).getTime() - new Date(a.messages.created_at || 0).getTime();
  });

  const formatRelativeTime = (dateStr: string) => {
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t.messages.justNow;
    if (diffMins < 60) return `${diffMins}${t.messages.minsAgo}`;
    if (diffHours < 24) return `${diffHours}${t.messages.hoursAgo}`;
    if (diffDays < 7) return `${diffDays}${t.messages.daysAgo}`;
    return date.toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' });
  };

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/50"
        style={{ touchAction: 'none', overscrollBehavior: 'contain', animation: 'fadeIn 0.2s ease-out', zIndex: 10000 }}
        onClick={onClose}
      />

      {/* Message Center Panel - full screen on mobile/tablet with solid background */}
      <div
        className="fixed inset-0 lg:inset-auto lg:top-0 lg:right-0 lg:h-full lg:w-full lg:max-w-2xl overflow-hidden flex flex-col"
        style={{ animation: 'slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1)', zIndex: 10001 }}
      >
        {/* SOLID opaque background - not transparent */}
        <div className="absolute inset-0 bg-[#f0f5ff]" />
        {/* Subtle decorative background pattern */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[30%] -right-20 w-80 h-80 bg-blue-100/40 rounded-full blur-3xl" />
          <div className="absolute bottom-[20%] -left-20 w-64 h-64 bg-cyan-100/30 rounded-full blur-3xl" />
        </div>

        {/* Header */}
        <div className="relative flex-shrink-0 overflow-hidden">
          {/* Solid header background */}
          <div className="absolute inset-0 bg-gradient-to-br from-blue-600 via-blue-500 to-cyan-500" />

          {/* Decorative geometric shapes */}
          <div className="absolute top-0 right-0 w-64 h-64 opacity-[0.08]">
            <div className="absolute top-4 right-4 w-32 h-32 border-2 border-white rounded-3xl rotate-12" />
            <div className="absolute top-12 right-12 w-24 h-24 border-2 border-white rounded-2xl -rotate-6" />
            <div className="absolute top-2 right-32 w-16 h-16 border-2 border-white rounded-xl rotate-45" />
          </div>
          <div className="absolute -bottom-6 -left-6 w-32 h-32 bg-white/[0.06] rounded-full" />
          <div className="absolute top-1/2 left-1/3 w-2 h-2 bg-cyan-300/30 rounded-full" />
          <div className="absolute top-4 left-2/3 w-1.5 h-1.5 bg-white/20 rounded-full" />

          <div
            className="relative px-4 py-3 lg:px-5 lg:py-4"
            style={{ paddingTop: !isDesktop ? 'calc(env(safe-area-inset-top, 0px) + 12px)' : undefined }}
          >
            <div className="flex items-center gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="relative flex-shrink-0">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/25 bg-white/15 shadow-lg backdrop-blur-sm sm:h-10 sm:w-10">
                    <Bell className="w-5 h-5 text-white" />
                  </div>
                  {unreadCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-[20px] px-1 bg-white text-blue-600 text-[10px] font-black rounded-full flex items-center justify-center shadow-lg ring-2 ring-blue-500">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold tracking-tight text-white lg:text-2xl">
                    {t.messages.title}
                  </h2>
                  <p className="mt-0.5 text-sm font-medium text-blue-100/90">
                    {unreadCount > 0 ? `${unreadCount} ${t.messages.newMessages}` : t.messages.gotIt}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-white backdrop-blur-sm transition-colors hover:bg-white/25 active:scale-95"
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                <X className="w-4 h-4" strokeWidth={2.5} />
              </button>
            </div>

            {/* Filter tabs - underline style */}
            <div className="relative mt-2 border-b border-white/15">
              {[
                { id: 'all', label: t.messages.title },
                { id: 'unread', label: t.messages.unread },
                { id: 'login', label: t.messages.notification },
                { id: 'realtime', label: t.messages.typeLive }
              ].map(f => {
                const isActive = filter === f.id;
                return (
                  <button
                    key={f.id}
                    onClick={() => setFilter(f.id as typeof filter)}
                    className={`msg-force-transition relative flex-1 pb-1.5 text-[11px] transition-all duration-200 ${
                      isActive
                        ? 'text-white font-semibold'
                        : 'text-white/50 font-medium'
                    }`}
                    style={{ WebkitTapHighlightColor: 'transparent' }}
                  >
                    <span className="truncate">{f.label}</span>
                    {isActive && (
                      <span className="absolute bottom-0 left-1/2 h-[2px] w-5 -translate-x-1/2 rounded-full bg-white" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Message List */}
        <div className="relative flex-1 overflow-y-auto">
          <div className="px-4 lg:px-6 py-4 pb-8 space-y-3">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="text-center">
                  <div className="relative w-16 h-16 mx-auto mb-5">
                    <div className="absolute inset-0 border-[3px] border-blue-100 rounded-full" />
                    <div className="absolute inset-0 border-[3px] border-blue-500 border-t-transparent rounded-full submit-anim-spin-slow" />
                    <div className="absolute inset-2 border-[3px] border-cyan-200 border-b-transparent rounded-full submit-anim-spin-reverse" />
                  </div>
                  <p className="text-blue-800 font-semibold text-sm">{t.messages.loading}</p>
                </div>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex items-center justify-center py-20">
                <div className="text-center px-6">
                  <div className="relative mx-auto mb-6 w-28 h-28">
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-100 to-cyan-100 rounded-3xl rotate-3 border border-blue-200" />
                    <div className="absolute inset-0 bg-white rounded-3xl -rotate-1 border border-blue-100 shadow-lg shadow-blue-50 flex items-center justify-center">
                      <MailOpen className="w-12 h-12 text-blue-300" />
                    </div>
                    <div className="absolute -top-2 -right-2 w-9 h-9 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-200">
                      <CheckCircle className="w-5 h-5 text-white" />
                    </div>
                    <div className="absolute -bottom-1 -left-1 w-6 h-6 bg-cyan-100 rounded-lg border border-cyan-200" />
                  </div>
                  <p className="text-slate-800 text-lg font-bold mb-1.5">{t.messages.noMessages}</p>
                  <p className="text-slate-400 text-sm">{t.messages.emptyDesc}</p>
                </div>
              </div>
            ) : (
              sortedMessages.map((msg, index) => {
                const isUnread = !msg.is_read;
                const isReward = msg.messages.notification_category === 'performance_reward';
                const style = getCardStyle(msg.messages.priority, msg.messages.message_type, isUnread, index, isReward);
                return (
                  <div
                    key={msg.id}
                    onClick={() => openMessage(msg)}
                    className="group relative cursor-pointer msg-force-transition msg-fade-in active:scale-[0.98]"
                    style={{ animationDelay: `${index * 0.04}s` }}
                  >
                    {/* Card */}
                    <div className={`relative rounded-2xl overflow-hidden msg-force-transition hover:-translate-y-0.5 hover:shadow-xl ${style.card}`}>
                      {/* Left accent bar */}
                      <div className={`absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-b ${style.accent} rounded-l-2xl`} />

                      {/* Decorative pattern blocks */}
                      <div className="absolute top-0 right-0 w-32 h-full overflow-hidden pointer-events-none opacity-[0.07]">
                        <div className={`absolute top-3 right-3 w-16 h-16 border-2 ${style.patternColor} rounded-2xl rotate-12`} />
                        <div className={`absolute bottom-2 right-8 w-10 h-10 border-2 ${style.patternColor} rounded-lg -rotate-6`} />
                        <div className={`absolute top-1/2 right-2 w-6 h-6 border-2 ${style.patternColor} rounded-full`} />
                      </div>

                      {/* Color accent corner block for unread */}
                      {isUnread && (
                        <div className="absolute top-0 right-0 w-20 h-20 overflow-hidden pointer-events-none">
                          <div className={`absolute -top-10 -right-10 w-20 h-20 bg-gradient-to-bl ${style.accent} opacity-[0.12] rounded-full`} />
                        </div>
                      )}

                      <div className="relative p-4 lg:p-5 pl-5 lg:pl-6">
                        <div className="flex items-start gap-3.5">
                          {/* Priority icon with colored background */}
                          <div className={`flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center shadow-sm ${style.iconBg}`}>
                            {isReward
                              ? <Gift className={`h-5 w-5 ${style.iconText}`} />
                              : getPriorityIcon(msg.messages.priority, `w-5 h-5 ${style.iconText}`)}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            {/* Title row */}
                            <div className="flex items-start justify-between gap-2 mb-1.5">
                              <h3 className={`font-semibold text-[15px] leading-snug line-clamp-1 ${
                                isUnread ? 'text-slate-900' : 'text-slate-600'
                              }`}>
                                {msg.messages.title}
                              </h3>
                              <span className={`text-[11px] font-medium whitespace-nowrap flex-shrink-0 mt-0.5 ${
                                isUnread ? 'text-blue-600' : 'text-slate-400'
                              }`}>
                                {formatRelativeTime(msg.messages.created_at || '')}
                              </span>
                            </div>

                            {isReward && (
                              <div className="mb-2 flex flex-wrap items-center gap-2">
                                <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-200/60 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-amber-800">
                                  <Sparkles className="h-3 w-3" /> {t.messages.rewardTitle}
                                </span>
                                <span className="text-sm font-black text-amber-700">
                                  +{Number(msg.messages.reward_amount || 0).toFixed(2)} {msg.messages.reward_currency}
                                </span>
                              </div>
                            )}

                            {/* Preview */}
                            <p className={`text-sm line-clamp-2 leading-relaxed mb-3 ${
                              isUnread ? 'text-slate-600' : 'text-slate-400'
                            }`}>
                              {msg.messages.content.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()}
                            </p>

                            {/* Bottom meta row */}
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className={`inline-flex items-center gap-1 text-[10px] px-2.5 py-0.5 rounded-md font-bold uppercase tracking-wider ${
                                  msg.messages.message_type === 'login_popup'
                                    ? 'bg-sky-100 text-sky-700 ring-1 ring-sky-200/80'
                                    : 'bg-teal-100 text-teal-700 ring-1 ring-teal-200/80'
                                }`}>
                                  {msg.messages.message_type === 'login_popup' ? t.messages.typeLogin : t.messages.typeLive}
                                </span>
                                <span className={`inline-flex items-center gap-1 text-[10px] px-2.5 py-0.5 rounded-md font-bold uppercase tracking-wider ${
                                  msg.messages.priority === 'urgent'
                                    ? 'bg-rose-100 text-rose-700 ring-1 ring-rose-200/80'
                                    : msg.messages.priority === 'high'
                                      ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-200/80'
                                      : 'bg-blue-100 text-blue-700 ring-1 ring-blue-200/80'
                                }`}>
                                  {msg.messages.priority === 'urgent' ? t.messages.priorityUrgent : msg.messages.priority === 'high' ? t.messages.priorityHigh : msg.messages.priority === 'normal' ? t.messages.priorityNormal : t.messages.priorityLow}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                {msg.is_read ? (
                                  <div className="flex items-center gap-1 text-slate-400">
                                    <Eye className="w-3.5 h-3.5" />
                                    <span className="text-[10px] font-medium hidden sm:inline">{t.messages.read}</span>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1 text-blue-600 group-hover:text-blue-700">
                                    <span className="text-[10px] font-bold hidden sm:inline">{t.messages.close}</span>
                                    <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Unread dot */}
                          {isUnread && (
                            <div className="absolute top-4 right-4">
                              <div className="relative">
                                <div className={`w-2.5 h-2.5 ${style.dotColor} rounded-full`} />
                                <div className={`absolute inset-0 w-2.5 h-2.5 ${style.dotColor} rounded-full msg-anim-ping opacity-75`} />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Message Detail Modal - full screen on all devices, solid background */}
      {selectedMessage && (
        <>
          <div
            className="fixed inset-0 bg-slate-900/50"
            style={{ zIndex: 10002, touchAction: 'none', overscrollBehavior: 'contain', animation: 'fadeIn 0.15s ease-out' }}
            onClick={() => setSelectedMessage(null)}
          />
          {/* Centering wrapper for desktop (uses flexbox, no transform conflicts) */}
          <div
            className="fixed inset-0 flex items-center justify-center pointer-events-none"
            style={{ zIndex: 10003 }}
          >
          <div
            className={`
              relative overflow-hidden flex flex-col pointer-events-auto bg-[#f0f5ff]
              w-full h-full
              ${isDesktop ? 'lg:w-full lg:max-w-2xl lg:h-[82vh] lg:rounded-3xl lg:shadow-2xl' : ''}
            `}
            style={{
              animation: isDesktop ? 'fadeIn 0.2s ease-out' : 'slideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
          >
            {/* Detail Header */}
            <div className="relative flex-shrink-0 overflow-hidden">
              <div className={`absolute inset-0 bg-gradient-to-br ${selectedMessage.messages.notification_category === 'performance_reward' ? 'from-amber-500 via-yellow-500 to-orange-500' : 'from-blue-600 via-blue-500 to-cyan-500'}`} />

              {/* Decorative elements */}
              <div className="absolute top-0 right-0 w-48 h-48 opacity-[0.06]">
                <div className="absolute top-6 right-6 w-24 h-24 border-2 border-white rounded-2xl rotate-12" />
                <div className="absolute top-2 right-28 w-14 h-14 border-2 border-white rounded-xl -rotate-6" />
              </div>
              <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/[0.04] rounded-full translate-y-1/2 -translate-x-1/3" />

              <div
                className="relative px-4 py-2.5 lg:px-6 lg:py-3"
                style={{
                  paddingTop: !isDesktop ? 'calc(env(safe-area-inset-top, 0px) + 8px)' : undefined
                }}
              >
                {/* Close button */}
                <div className="mb-1.5 flex items-center justify-end">
                  <button
                    onClick={() => setSelectedMessage(null)}
                    aria-label={t.messages.close}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg backdrop-blur-sm transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 ${selectedMessage.messages.notification_category === 'performance_reward' ? 'border border-amber-950/20 bg-amber-950/15 text-amber-950 hover:bg-amber-950/25 focus-visible:ring-amber-950/35' : 'bg-white/15 text-white hover:bg-white/25 focus-visible:ring-white/60'}`}
                    style={{ WebkitTapHighlightColor: 'transparent' }}
                  >
                    <X className="h-4 w-4" strokeWidth={2.5} />
                  </button>
                </div>

                {/* Title section */}
                <div className="flex items-start gap-2.5">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border backdrop-blur-sm sm:h-10 sm:w-10 ${selectedMessage.messages.notification_category === 'performance_reward' ? 'border-amber-950/20 bg-amber-950/15 text-amber-950 shadow-sm shadow-amber-950/10' : 'border-white/20 bg-white/15'}`}>
                    {selectedMessage.messages.notification_category === 'performance_reward'
                      ? <Gift className="h-5 w-5" strokeWidth={2} />
                      : getPriorityIcon(selectedMessage.messages.priority, 'h-5 w-5 text-white')}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className={`mb-1 break-words text-lg font-bold leading-tight lg:text-xl ${selectedMessage.messages.notification_category === 'performance_reward' ? 'text-amber-950' : 'text-white'}`}>
                      {selectedMessage.messages.title}
                    </h3>
                    <div className={`flex flex-wrap items-center gap-2 text-sm font-medium ${selectedMessage.messages.notification_category === 'performance_reward' ? 'text-amber-950/75' : 'text-blue-100/90'}`}>
                      <div className="flex items-center gap-1.5">
                        <Clock className={`h-3.5 w-3.5 ${selectedMessage.messages.notification_category === 'performance_reward' ? 'text-amber-950/70' : 'text-cyan-200'}`} />
                        <span>
                          {new Date(selectedMessage.messages.created_at || 0).toLocaleDateString(dateLocale, { year: 'numeric', month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                      <span className={selectedMessage.messages.notification_category === 'performance_reward' ? 'text-amber-950/30' : 'text-white/20'}>|</span>
                      <span>
                        {new Date(selectedMessage.messages.created_at || 0).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Tags */}
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider lg:text-[10px] ${selectedMessage.messages.notification_category === 'performance_reward' ? 'border-amber-950/25 bg-amber-950/15 text-amber-950' : selectedMessage.messages.message_type === 'login_popup' ? 'border-white/20 bg-white/15 text-sky-100' : 'border-white/20 bg-white/15 text-cyan-100'}`}>
                    {selectedMessage.messages.message_type === 'login_popup' ? t.messages.loginNotification : t.messages.liveMessage}
                  </span>
                  <span className={`rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider lg:text-[10px] ${selectedMessage.messages.notification_category === 'performance_reward' ? 'border-orange-800/25 bg-orange-800/20 text-orange-950' : 'border-white/15 bg-white/15 text-white'}`}>
                    {selectedMessage.messages.priority === 'urgent' ? t.messages.priorityUrgent : selectedMessage.messages.priority === 'high' ? t.messages.priorityHigh : selectedMessage.messages.priority === 'normal' ? t.messages.priorityNormal : t.messages.priorityLow} {t.messages.priority}
                  </span>
                </div>
              </div>
            </div>

            {/* Detail Content */}
            <div
              className="relative flex min-h-0 flex-1 overflow-hidden p-0"
              style={{
                minHeight: 0,
                WebkitOverflowScrolling: 'touch'
              } as React.CSSProperties}
            >
              {/* Content card */}
              <div className={`relative flex min-h-0 flex-1 flex-col overflow-hidden border ${selectedMessage.messages.notification_category === 'performance_reward' ? 'border-amber-200/90 bg-gradient-to-b from-amber-100 via-orange-50 to-amber-100/75' : 'border-blue-200/80 bg-gradient-to-b from-blue-100/80 via-sky-50 to-blue-100/55'}`}>
                {/* Top accent line */}
                <div className={`absolute left-6 right-6 top-0 h-[2px] rounded-full bg-gradient-to-r from-transparent to-transparent ${selectedMessage.messages.notification_category === 'performance_reward' ? 'via-amber-400' : 'via-blue-300'}`} />

                {selectedMessage.messages.notification_category === 'performance_reward' && (
                  <div className="shrink-0 border-b border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-4 lg:px-7">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-black text-amber-800">{t.messages.rewardBonusLabel}</p>
                        <p className="mt-0.5 text-[10px] font-black uppercase tracking-[0.16em] text-amber-600">{t.messages.rewardWalletLabel}</p>
                      </div>
                      <p className="shrink-0 text-2xl font-black text-amber-700">+{Number(selectedMessage.messages.reward_amount || 0).toFixed(2)} <span className="text-base">{selectedMessage.messages.reward_currency}</span></p>
                    </div>
                    <div className="mt-3 flex items-center gap-2 border-t border-amber-200/80 pt-3">
                      <Wallet className="h-4 w-4 shrink-0 text-emerald-600" />
                      <p className="text-xs font-semibold leading-5 text-emerald-700">{t.messages.rewardAddedMessage}</p>
                    </div>
                  </div>
                )}

                <div className={`min-h-0 flex-1 overflow-y-auto p-4 lg:p-5 scrollbar-thin ${selectedMessage.messages.notification_category === 'performance_reward' ? 'scrollbar-track-amber-950/30 scrollbar-thumb-amber-500/40 hover:scrollbar-thumb-amber-400/60' : ''}`}>
                  <QuickCopyRichContent
                    html={selectedMessage.messages.content}
                    copyLabel={t.messages.quickCopy}
                    copiedLabel={t.messages.copied}
                    className="prose prose-sm lg:prose-base max-w-none leading-relaxed [&_a]:!text-blue-600 [&_a]:underline [&_img]:!rounded-xl [&_img]:!shadow-md [&_blockquote]:!border-l-blue-400 [&_blockquote]:!bg-blue-50/50 [&_blockquote]:!p-4 [&_blockquote]:!rounded-r-lg [&_h1]:!text-slate-900 [&_h2]:!text-slate-800 [&_h3]:!text-slate-700 [&_p]:!text-slate-700 [&_li]:!text-slate-700 message-content-dark"
                    style={{ wordBreak: 'break-word', overflowWrap: 'break-word', color: '#1e293b' }}
                  />
                </div>
              </div>
            </div>

            {/* Detail Footer */}
            <div className="relative flex-shrink-0 bg-white border-t border-blue-100 p-4 lg:p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {selectedMessage.is_read ? (
                    <>
                      <div className="flex items-center justify-center w-9 h-9 bg-emerald-50 rounded-xl ring-1 ring-emerald-200">
                        <CheckCircle className="w-4 h-4 text-emerald-600" />
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">{t.messages.read}</p>
                        <p className="text-sm text-slate-700 font-semibold">{new Date(selectedMessage.read_at!).toLocaleDateString(dateLocale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-center w-9 h-9 bg-blue-50 rounded-xl ring-1 ring-blue-200">
                        <Sparkles className="w-4 h-4 text-blue-600" />
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">{t.messages.notification}</p>
                        <p className="text-sm text-blue-700 font-semibold">{t.messages.markAsRead}</p>
                      </div>
                    </>
                  )}
                </div>
                <button
                  onClick={() => setSelectedMessage(null)}
                  className="min-h-[44px] px-6 py-2.5 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white rounded-xl font-semibold text-sm transition-all shadow-lg shadow-blue-500/20 active:scale-95"
                >
                  {t.messages.close}
                </button>
              </div>
            </div>
          </div>
          </div>
        </>
      )}
    </>,
    document.body
  );
}
