import { useState, useEffect, useRef, memo, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, X, Send, Image, Star, ArrowLeft, Search, Clock, Zap, Sparkles, Shield, Award, Hexagon, Gift, ZoomIn, ZoomOut, RotateCcw, Megaphone, ChevronRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { sanitizeChatMessage, sanitizeAnnouncementContent } from '../../lib/sanitizeHTML';
import { useLanguage } from '../../lib/i18n';

// Image component with loading state
const ChatImage = memo(({
  src,
  alt,
  onClickImage,
}: {
  src: string;
  alt: string;
  onClickImage: (src: string) => void;
}) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  return (
    <div
      className="relative overflow-hidden rounded-xl"
      style={{
        width: '280px',
        height: '200px',
      }}
    >
      {/* Loading skeleton - fades out */}
      <div
        className={`absolute inset-0 bg-gray-100 flex items-center justify-center transition-opacity duration-300 ${
          imageLoaded || imageError ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        <div className="flex flex-col items-center gap-2">
          <div className="w-10 h-10 border-3 border-gray-200 border-t-blue-500 rounded-full animate-spin"></div>
          <span className="text-xs text-gray-400">Loading...</span>
        </div>
      </div>

      {/* Error state - fades in */}
      {imageError && (
        <div className="absolute inset-0 bg-gray-100 flex items-center justify-center border border-red-200">
          <div className="flex flex-col items-center gap-2 text-red-400">
            <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-xs">Load failed</span>
          </div>
        </div>
      )}

      {/* Image - fades in */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className={`w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity duration-300 shadow-lg ${
          imageLoaded ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); onClickImage(src); }}
        onLoad={() => setImageLoaded(true)}
        onError={() => setImageError(true)}
        loading="lazy"
        decoding="async"
      />
    </div>
  );
});

// Avatar component with loading state
const CustomerAvatar = memo(({
  customer,
  className = 'w-10 h-10'
}: {
  customer: Customer;
  className?: string;
}) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  return (
    <div className={`relative ${className} rounded-lg flex items-center justify-center text-base sm:text-xl overflow-hidden border-2 ${
      customer.is_super
        ? 'bg-gradient-to-br from-amber-500/40 to-orange-500/30 border-amber-400/60'
        : 'bg-gradient-to-br from-cyan-500/30 to-blue-500/30 border-cyan-400/50'
    }`}>
      {customer.custom_avatar_url ? (
        <>
          {/* Show emoji placeholder while loading */}
          {!imageLoaded && !imageError && (
            <div className="absolute inset-0 flex items-center justify-center transition-opacity duration-200">
              {customer.customer_avatar}
            </div>
          )}
          <img
            src={customer.custom_avatar_url}
            alt={customer.customer_name}
            className={`w-full h-full object-cover transition-opacity duration-200 ${
              imageLoaded ? 'opacity-100' : 'opacity-0'
            }`}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
            loading="lazy"
            decoding="async"
          />
          {/* If image fails to load, show emoji */}
          {imageError && (
            <div className="absolute inset-0 flex items-center justify-center">
              {customer.customer_avatar}
            </div>
          )}
        </>
      ) : (
        customer.customer_avatar
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  return prevProps.customer.id === nextProps.customer.id &&
         prevProps.className === nextProps.className;
});

interface Customer {
  id: string;
  customer_name: string;
  customer_id: string;
  customer_avatar: string;
  is_super?: boolean;
  super_customer_title?: string;
  badge_type?: 'diamond' | 'crown' | 'star' | 'vip' | 'premium';
  custom_avatar_url?: string;
  vip_label?: string;
  employee_pin_top?: boolean;
  employee_always_visible?: boolean;
  target_employee_id?: string | null;
  target_employee_ids?: string[] | null;
}

interface Message {
  id: string;
  customer_id: string;
  employee_id: string;
  sender_type: 'customer' | 'employee';
  message_content: string;
  message_type?: 'text' | 'image' | 'rating_request' | 'rating_result' | 'tip' | 'rich_card';
  title?: string | null;
  subtitle?: string | null;
  image_url?: string;
  rating_data?: {
    rating?: number;
    comment?: string;
    employee_id?: string;
    status?: string;
  };
  is_read: boolean;
  created_at: string;
  rich_card_content_id?: string | null;
}

interface CustomerConversation {
  customer: Customer;
  unread_count: number;
  last_message: string;
  last_message_time: string;
  last_customer_message_time?: string;
}

interface CustomerServiceChatProps {
  employeeId: string;
}

export default function CustomerServiceChat({ employeeId }: CustomerServiceChatProps) {
  const { t, dateLocale } = useLanguage();

  const [isOpen, setIsOpen] = useState(false);
  const [showConversationList, setShowConversationList] = useState(true);
  const skipListAnimationRef = useRef(false);
  const employeeAdminIdRef = useRef<string | null>(null);
  const [conversations, setConversations] = useState<CustomerConversation[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const MESSAGE_PAGE_SIZE = 50;
  const [messageInput, setMessageInput] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [serviceTicketNumber, setServiceTicketNumber] = useState<string>('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const uploadingTempIdRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const messagesCache = useRef<Map<string, Message[]>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const conversationListRef = useRef<HTMLDivElement>(null);
  const conversationListScrollRef = useRef(0);

  const animateProgressTo = (from: number, target: number, duration: number = 800) => {
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    let current = from;
    const steps = Math.max(Math.ceil(duration / 50), 1);
    const increment = (target - current) / steps;
    if (increment === 0) { setUploadProgress(target); return; }
    progressIntervalRef.current = setInterval(() => {
      current += increment;
      if ((increment > 0 && current >= target) || (increment <= 0 && current <= target)) {
        current = target;
        if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      setUploadProgress(Math.round(current));
    }, 50);
  };

  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    };
  }, []);

  const messagesContainerCallbackRef = (node: HTMLDivElement | null) => {
    if (node) {
      messagesContainerRef.current = node;
    }
  };
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [messagePopup, setMessagePopup] = useState<{ customer: Customer; message: string; time: string } | null>(null);
  const [playingSound, setPlayingSound] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [viewingRichCard, setViewingRichCard] = useState<Message | null>(null);
  const [richCardFullContent, setRichCardFullContent] = useState<string | null>(null);
  const [loadingRichCardContent, setLoadingRichCardContent] = useState(false);
  const richCardCancelRef = useRef(false);
  const richCardCacheRef = useRef<Map<string, string>>(new Map());
  const richCardPrefetchingRef = useRef<Set<string>>(new Set());

  const fetchRichCardContent = useCallback(async (contentId: string): Promise<string | null> => {
    const cached = richCardCacheRef.current.get(contentId);
    if (cached) return cached;
    try {
      const { data, error } = await supabase
        .from('rich_card_contents')
        .select('html_content')
        .eq('id', contentId)
        .maybeSingle();
      if (!error && data?.html_content) {
        richCardCacheRef.current.set(contentId, data.html_content);
        return data.html_content;
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  const fetchTemplateContentForViewer = useCallback(async (templateId: string): Promise<string | null> => {
    const cacheKey = `tpl:${templateId}`;
    const cached = richCardCacheRef.current.get(cacheKey);
    if (cached) return cached;
    try {
      const { data, error } = await supabase
        .from('cs_message_templates')
        .select('content')
        .eq('id', templateId)
        .maybeSingle();
      if (!error && data?.content) {
        richCardCacheRef.current.set(cacheKey, data.content);
        return data.content;
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  const fetchAutoMsgContentForViewer = useCallback(async (autoMsgId: string): Promise<string | null> => {
    const cacheKey = `auto:${autoMsgId}`;
    const cached = richCardCacheRef.current.get(cacheKey);
    if (cached) return cached;
    try {
      const { data, error } = await supabase
        .from('customer_auto_messages')
        .select('content')
        .eq('id', autoMsgId)
        .maybeSingle();
      if (!error && data?.content) {
        richCardCacheRef.current.set(cacheKey, data.content);
        return data.content;
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  const prefetchRichCard = useCallback((msg: Message) => {
    const anyMsg = msg as any;
    const key = anyMsg.source_template_id ? `tpl:${anyMsg.source_template_id}` :
                anyMsg.source_auto_message_id ? `auto:${anyMsg.source_auto_message_id}` :
                msg.rich_card_content_id || null;
    if (!key) return;
    if (richCardCacheRef.current.has(key)) return;
    if (richCardPrefetchingRef.current.has(key)) return;
    richCardPrefetchingRef.current.add(key);
    const p = anyMsg.source_template_id ? fetchTemplateContentForViewer(anyMsg.source_template_id) :
              anyMsg.source_auto_message_id ? fetchAutoMsgContentForViewer(anyMsg.source_auto_message_id) :
              fetchRichCardContent(key);
    p.finally(() => richCardPrefetchingRef.current.delete(key));
  }, [fetchRichCardContent, fetchTemplateContentForViewer, fetchAutoMsgContentForViewer]);

  const openRichCardViewer = useCallback(async (msg: Message) => {
    richCardCancelRef.current = false;
    setViewingRichCard(msg);

    const anyMsg = msg as any;
    const cacheKey = anyMsg.source_template_id ? `tpl:${anyMsg.source_template_id}` :
                     anyMsg.source_auto_message_id ? `auto:${anyMsg.source_auto_message_id}` :
                     msg.rich_card_content_id || null;
    if (cacheKey && richCardCacheRef.current.has(cacheKey)) {
      setRichCardFullContent(richCardCacheRef.current.get(cacheKey)!);
      setLoadingRichCardContent(false);
      return;
    }

    setRichCardFullContent(null);
    setLoadingRichCardContent(true);

    try {
      let html: string | null = null;
      if (anyMsg.source_template_id) {
        html = await fetchTemplateContentForViewer(anyMsg.source_template_id);
      } else if (anyMsg.source_auto_message_id) {
        html = await fetchAutoMsgContentForViewer(anyMsg.source_auto_message_id);
      } else if (msg.rich_card_content_id) {
        html = await fetchRichCardContent(msg.rich_card_content_id);
      } else if (msg.message_type === 'rich_card') {
        for (let i = 0; i < 2; i++) {
          if (richCardCancelRef.current) return;
          await new Promise(r => setTimeout(r, 150));
          const { data: fresh } = await supabase
            .from('customer_employee_conversations')
            .select('rich_card_content_id, source_template_id, source_auto_message_id')
            .eq('id', msg.id)
            .maybeSingle();
          if (fresh?.source_template_id) {
            html = await fetchTemplateContentForViewer(fresh.source_template_id);
            break;
          }
          if (fresh?.source_auto_message_id) {
            html = await fetchAutoMsgContentForViewer(fresh.source_auto_message_id);
            break;
          }
          if (fresh?.rich_card_content_id) {
            html = await fetchRichCardContent(fresh.rich_card_content_id);
            break;
          }
        }
      }
      if (!richCardCancelRef.current) {
        setRichCardFullContent(html || msg.message_content);
        setLoadingRichCardContent(false);
      }
    } catch {
      if (!richCardCancelRef.current) {
        setLoadingRichCardContent(false);
      }
    }
  }, [fetchRichCardContent, fetchTemplateContentForViewer, fetchAutoMsgContentForViewer]);

  const [imageZoom, setImageZoom] = useState(1);
  const [imageDrag, setImageDrag] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const popupTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [customerOnlineStatus, setCustomerOnlineStatus] = useState<Map<string, boolean>>(new Map());
  const onlineCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialLoadRef = useRef<boolean>(false);
  const shouldAutoScrollRef = useRef<boolean>(true);
  const loadOlderMessagesRef = useRef<() => void>();
  const conversationOpenedAtRef = useRef<string>('');
  const selectedCustomerRef = useRef<Customer | null>(null);
  const isOpenRef = useRef<boolean>(false);
  const justSentRef = useRef(false);
  const stableKeyMapRef = useRef<Map<string, string>>(new Map());

  // Lock body scroll when chat is open (mobile only - full-screen overlay)
  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    selectedCustomerRef.current = selectedCustomer;
  }, [selectedCustomer]);

  useEffect(() => {
    if (isOpen && window.innerWidth < 1024) {
      const scrollY = window.scrollY;

      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = '100%';
      document.body.style.overflowY = 'scroll';

      return () => {
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        document.body.style.overflowY = '';

        window.scrollTo({ top: scrollY, left: 0, behavior: 'instant' });
      };
    }
  }, [isOpen]);

  useEffect(() => {
    loadConversations();

    const channel = supabase
      .channel('customer_employee_messages')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'customer_employee_conversations',
        filter: `employee_id=eq.${employeeId}`,
      }, async (payload: any) => {
        console.log('New message INSERT event:', payload);

        loadConversations();
        if (selectedCustomerRef.current && selectedCustomerRef.current.id === payload.new.customer_id) {
          if (!isInitialLoadRef.current && !(justSentRef.current && payload.new.sender_type === 'employee')) {
            loadMessagesFromDB(isOpenRef.current);
          }
        }

        if (payload.new.message_type === 'rich_card') {
          prefetchRichCard(payload.new as any);
        }

        if (!isOpenRef.current && payload.new && payload.new.sender_type === 'customer') {
          const { data: customerData } = await supabase
            .from('simulated_customers')
            .select('*')
            .eq('id', payload.new.customer_id)
            .maybeSingle();

          if (customerData) {
            const rawContent = payload.new.message_content || t.customerService.newMessage;
            const hasEmbeddedImg = /<img\s/i.test(rawContent);
            const messageText = payload.new.message_type === 'image'
              ? '\ud83d\udcf7 Photo'
              : payload.new.message_type === 'rich_card'
              ? (payload.new.title || 'Rich Card')
              : (() => {
                  const text = rawContent
                    .replace(/<br\s*\/?>/gi, '\n')
                    .replace(/<\/(?:div|p)>/gi, '\n')
                    .replace(/<[^>]*>/g, '')
                    .replace(/\n{3,}/g, '\n\n')
                    .trim();
                  return text || (hasEmbeddedImg ? '\ud83d\udcf7 Photo' : t.customerService.newMessage);
                })();
            showMessagePopup(customerData, messageText);
          }
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'customer_employee_conversations',
        filter: `employee_id=eq.${employeeId}`,
      }, (payload: any) => {
        loadConversations();
        if (selectedCustomerRef.current && selectedCustomerRef.current.id === payload.new.customer_id) {
          if (!isInitialLoadRef.current) {
            loadMessagesFromDB(isOpenRef.current);
          }
        }
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'customer_employee_conversations',
        filter: `employee_id=eq.${employeeId}`,
      }, () => {
        loadConversations();
        if (selectedCustomerRef.current && !isInitialLoadRef.current) {
          loadMessagesFromDB();
        }
      })
      .subscribe();

    onlineCheckIntervalRef.current = setInterval(() => {
      updateOnlineStatus();
    }, 30000);

    return () => {
      supabase.removeChannel(channel);
      if (onlineCheckIntervalRef.current) {
        clearInterval(onlineCheckIntervalRef.current);
      }
    };
  }, [employeeId]);

  useEffect(() => {
    if (selectedCustomer) {
      isInitialLoadRef.current = true;
      shouldAutoScrollRef.current = true;
      conversationOpenedAtRef.current = new Date().toISOString();
      loadMessages();
    }
  }, [selectedCustomer]);

  const prevMessageCountRef = useRef(0);

  // Column-reverse layout: scrollTop=0 = bottom (latest messages visible)
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || messages.length === 0) return;

    const handleScroll = () => {
      shouldAutoScrollRef.current = container.scrollTop < 150;
      const maxScroll = container.scrollHeight - container.clientHeight;
      if (maxScroll > 0 && maxScroll - container.scrollTop < 100) {
        loadOlderMessagesRef.current?.();
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });

    const hadNewMessage = messages.length > prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;

    if (!isInitialLoadRef.current && shouldAutoScrollRef.current && hadNewMessage) {
      container.scrollTop = 0;
    }

    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [messages]);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  useEffect(() => {
    updateOnlineStatus();
  }, [conversations]);

  const scrollToBottom = () => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTop = 0;
    }
  };

  const playNotificationSound = (isSuper: boolean) => {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

    const playTone = (frequency: number, startTime: number, duration: number, volume: number) => {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.frequency.value = frequency;

      gainNode.gain.setValueAtTime(volume, startTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

      oscillator.start(startTime);
      oscillator.stop(startTime + duration);
    };

    const now = audioContext.currentTime;

    if (isSuper) {
      playTone(880, now, 0.15, 0.4);
      playTone(1108, now + 0.18, 0.15, 0.4);
      playTone(880, now + 0.36, 0.15, 0.4);
      playTone(1320, now + 0.54, 0.25, 0.45);
    } else {
      playTone(659, now, 0.12, 0.35);
      playTone(880, now + 0.15, 0.12, 0.35);
      playTone(1047, now + 0.30, 0.18, 0.38);
    }
  };

  const startContinuousSound = (isSuper: boolean) => {
    if (playingSound) return;
    setPlayingSound(true);

    const interval = setInterval(() => {
      playNotificationSound(isSuper);
    }, isSuper ? 1500 : 2000);

    if (audioRef.current) {
      clearInterval(audioRef.current as any);
    }
    audioRef.current = interval as any;
  };

  const stopContinuousSound = () => {
    setPlayingSound(false);
    if (audioRef.current) {
      clearInterval(audioRef.current as any);
      audioRef.current = null;
    }
  };

  const showMessagePopup = (customer: Customer, message: string) => {
    console.log('🎯 showMessagePopup called:', { customer: customer.customer_name, message, isSuper: customer.is_super });

    if (popupTimerRef.current) {
      clearTimeout(popupTimerRef.current);
      popupTimerRef.current = null;
    }

    setMessagePopup({
      customer,
      message,
      time: new Date().toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })
    });

    console.log('🔊 Starting continuous sound for:', customer.is_super ? 'SUPER customer' : 'regular customer');
    startContinuousSound(customer.is_super || false);
    console.log('⏰ Popup will persist until clicked');
  };

  const isCustomerOnline = (customerId: string): boolean => {
    const conv = conversations.find(c => c.customer.id === customerId);
    if (!conv || !conv.last_customer_message_time) return false;

    const lastMessageTime = new Date(conv.last_customer_message_time).getTime();
    const now = Date.now();
    const fiveMinutesInMs = 5 * 60 * 1000;

    return (now - lastMessageTime) < fiveMinutesInMs;
  };

  const updateOnlineStatus = () => {
    const newStatus = new Map<string, boolean>();
    conversations.forEach(conv => {
      newStatus.set(conv.customer.id, isCustomerOnline(conv.customer.id));
    });
    setCustomerOnlineStatus(newStatus);
  };

  const renderMessageContent = (msg: Message) => {
    if (msg.message_type === 'image' && !msg.image_url) {
      return (
        <div className="relative overflow-hidden rounded-xl" style={{ width: '280px', height: '200px' }}>
          <div className="absolute inset-0 bg-gray-100 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <div className="w-10 h-10 border-3 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
              <span className="text-xs text-gray-400">Loading...</span>
            </div>
          </div>
        </div>
      );
    }
    if (msg.message_type === 'image' && msg.image_url) {
      const isUploading = uploadingImage && uploadingTempIdRef.current === msg.id;
      return (
        <div className="relative">
          <ChatImage
            src={msg.image_url}
            alt="Shared image"
            onClickImage={isUploading ? () => {} : (url: string) => { setPreviewImage(url); setImageZoom(1); setImageDrag({ x: 0, y: 0 }); }}
          />
          {isUploading && (
            <div className="absolute inset-0 bg-black/25 backdrop-blur-[2px] flex flex-col items-center justify-center rounded-xl z-10">
              <div className="relative w-12 h-12 sm:w-14 sm:h-14">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 44 44">
                  <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2.5" />
                  <circle
                    cx="22" cy="22" r="18" fill="none" stroke="white"
                    strokeWidth="2.5"
                    strokeDasharray={`${uploadProgress * 1.13}, 113`}
                    strokeLinecap="round"
                    className="drop-shadow-sm"
                    style={{ transition: 'stroke-dasharray 0.15s ease-out' }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-white text-[11px] sm:text-xs font-bold drop-shadow-sm">{uploadProgress}%</span>
                </div>
              </div>
              <div className="text-white/70 text-[10px] font-medium mt-1.5">
                {uploadProgress < 20 ? t.customerService.preparing :
                 uploadProgress < 85 ? t.customerService.uploading :
                 uploadProgress < 100 ? t.customerService.processing : ''}
              </div>
            </div>
          )}
        </div>
      );
    }

    if (msg.message_type === 'rating_request') {
      return (
        <div className="my-2 w-[280px] sm:w-[300px]">
          <div className="relative rounded-2xl overflow-hidden shadow-lg shadow-blue-600/30 border border-blue-500/40">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-700"></div>
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.08),transparent_60%)]"></div>
            <div className="relative px-5 py-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 bg-white/20 backdrop-blur-sm rounded-lg shadow-md shadow-blue-900/30">
                    <Star className="w-4 h-4 text-white fill-white" />
                  </div>
                  <span className="text-xs font-bold text-white tracking-wide">{t.customerService.serviceRating}</span>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white/10 border border-white/20 rounded-full">
                  <div className="w-1.5 h-1.5 bg-blue-200 rounded-full animate-pulse"></div>
                  <span className="text-[10px] text-blue-100 font-semibold">{t.customerService.pending}</span>
                </div>
              </div>
              <div className="flex items-center justify-center gap-2.5 py-2">
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star key={s} className="w-6 h-6 text-white/30 fill-white/10" />
                ))}
              </div>
              <p className="text-center text-[11px] text-blue-100/70 mt-2.5 font-medium">{t.customerService.waitingFeedback}</p>
            </div>
          </div>
        </div>
      );
    }

    if (msg.message_type === 'rating_result' && msg.rating_data) {
      const { rating = 0, comment } = msg.rating_data;
      return (
        <div className="my-2 w-[280px] sm:w-[300px]">
          <div className="relative rounded-2xl overflow-hidden shadow-lg shadow-blue-600/30 border border-blue-500/40">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-700"></div>
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.08),transparent_60%)]"></div>
            <div className="relative px-5 py-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 bg-white/20 backdrop-blur-sm rounded-lg shadow-md shadow-blue-900/30">
                    <Star className="w-4 h-4 text-white fill-white" />
                  </div>
                  <span className="text-xs font-bold text-white tracking-wide">{t.customerService.serviceRating}</span>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/20 border border-emerald-400/30 rounded-full">
                  <div className="w-1.5 h-1.5 bg-emerald-300 rounded-full"></div>
                  <span className="text-[10px] text-emerald-200 font-semibold">{t.customerService.completed}</span>
                </div>
              </div>
              <div className="flex items-center justify-between py-2">
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      className={`w-6 h-6 transition-all ${
                        star <= rating
                          ? 'text-amber-300 fill-amber-300 drop-shadow-[0_0_6px_rgba(252,211,77,0.7)]'
                          : 'text-white/25 fill-white/10'
                      }`}
                    />
                  ))}
                </div>
                <span className="text-2xl font-black text-white" style={{ textShadow: '0 2px 6px rgba(0,0,0,0.3)' }}>{rating}.0</span>
              </div>
              {comment && (
                <div className="mt-3 pt-3 border-t border-white/10">
                  <p className="text-xs text-blue-100/80 leading-relaxed italic">"{comment}"</p>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    if (msg.message_type === 'rich_card') {
      return (
        <div className="my-1.5 w-[240px]">
          <button
            type="button"
            onClick={() => openRichCardViewer(msg)}
            onMouseEnter={() => prefetchRichCard(msg)}
            onTouchStart={() => prefetchRichCard(msg)}
            className="w-full text-left rounded-2xl overflow-hidden transition-all duration-250 group shadow-[0_2px_12px_rgba(37,99,246,0.15)] hover:shadow-[0_8px_24px_rgba(37,99,246,0.22)] hover:scale-[1.015]"
          >
            <div className="relative bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700 px-4 pt-4 pb-3.5">
              <div className="absolute top-0 right-0 w-20 h-20 bg-white/[0.07] rounded-full -translate-y-8 translate-x-8" />
              <div className="absolute bottom-0 left-0 w-14 h-14 bg-white/[0.05] rounded-full translate-y-6 -translate-x-6" />
              <div className="relative flex items-start gap-2.5">
                <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center">
                  <Megaphone className="w-3.5 h-3.5 text-white" />
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <span className="text-[12.5px] font-semibold text-white block truncate leading-snug">{msg.title || 'View details'}</span>
                  {msg.subtitle && <span className="text-[11px] text-blue-100/80 block truncate mt-1 leading-snug">{msg.subtitle}</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between px-4 py-2 bg-white border-t border-blue-100">
              <span className="text-[10.5px] text-blue-600 font-medium">{t.customerService.richCardNotice || 'View details'}</span>
              <ChevronRight className="w-3.5 h-3.5 text-blue-400 group-hover:text-blue-600 group-hover:translate-x-0.5 transition-all duration-200" />
            </div>
          </button>
        </div>
      );
    }

    if (msg.message_type === 'tip' && msg.rating_data) {
      const tipAmt = (msg.rating_data as any).tip_amount || 0;
      return (
        <div className="w-[240px] rounded-lg overflow-hidden shadow-xl shadow-amber-900/30">
          {/* Banknote-style card */}
          <div className="relative bg-gradient-to-br from-amber-600 via-amber-500 to-yellow-600 p-[3px]">
            {/* Inner border frame */}
            <div className="relative bg-gradient-to-br from-amber-500 via-yellow-500 to-amber-600 rounded-sm px-4 py-3 overflow-hidden">
              {/* Guilloche pattern overlay */}
              <div className="absolute inset-0 opacity-[0.08]" style={{
                backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.5) 2px, rgba(255,255,255,0.5) 3px),
                  repeating-linear-gradient(-45deg, transparent, transparent 2px, rgba(255,255,255,0.5) 2px, rgba(255,255,255,0.5) 3px)`
              }}></div>
              {/* Top ornamental line */}
              <div className="absolute top-0 left-3 right-3 h-[2px] bg-gradient-to-r from-transparent via-white/40 to-transparent"></div>
              {/* Bottom ornamental line */}
              <div className="absolute bottom-0 left-3 right-3 h-[2px] bg-gradient-to-r from-transparent via-white/40 to-transparent"></div>
              {/* Radial glow */}
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.12),transparent_70%)]"></div>

              <div className="relative">
                {/* Header row */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-1.5">
                    <Gift className="w-3.5 h-3.5 text-amber-100" />
                    <span className="text-[10px] font-bold text-amber-100 uppercase tracking-widest">{t.customerService.tip}</span>
                  </div>
                  <Sparkles className="w-3.5 h-3.5 text-yellow-200/80" />
                </div>
                {/* Main amount - very prominent */}
                <div className="flex items-center justify-center py-2">
                  <span className="text-[28px] font-black mr-0.5 bg-gradient-to-b from-yellow-100 via-white to-yellow-200 bg-clip-text text-transparent leading-none" style={{ WebkitTextStroke: '0.5px rgba(255,255,255,0.3)' }}>$</span>
                  <span className="text-[34px] font-black tracking-tight leading-none bg-gradient-to-b from-yellow-100 via-white to-yellow-200 bg-clip-text text-transparent" style={{ WebkitTextStroke: '0.5px rgba(255,255,255,0.3)', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}>{tipAmt.toFixed(2)}</span>
                </div>
                {/* Footer */}
                <div className="flex items-center justify-center mt-2 gap-2">
                  <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent to-white/30"></div>
                  <span className="text-[8px] font-bold text-white/50 uppercase tracking-[0.2em]">{t.customerService.addedToWallet}</span>
                  <div className="h-[1px] flex-1 bg-gradient-to-l from-transparent to-white/30"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    const content = msg.message_content;
    const hasHtml = /<[a-z][\s\S]*>/i.test(content);
    if (hasHtml) {
      const sanitized = sanitizeChatMessage(content);
      const hasImgTag = /<img\s/i.test(content);
      return (
        <div
          className={`text-sm leading-relaxed break-words chat-rich-content${hasImgTag ? ' [&_img]:cursor-pointer [&_img]:rounded-xl [&_img]:max-w-[280px] [&_img]:hover:opacity-90 [&_img]:transition-opacity [&_img]:shadow-lg' : ''}`}
          style={{ overflowWrap: 'anywhere' }}
          dangerouslySetInnerHTML={{ __html: sanitized }}
          onClick={(e) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'IMG') {
              e.stopPropagation();
              e.preventDefault();
              const imgSrc = (target as HTMLImageElement).src;
              if (imgSrc) {
                setPreviewImage(imgSrc);
                setImageZoom(1);
                setImageDrag({ x: 0, y: 0 });
              }
            }
          }}
        />
      );
    }
    return <div className="text-sm leading-relaxed whitespace-pre-wrap break-words" style={{ overflowWrap: 'anywhere' }}>{content}</div>;
  };

  const loadConversations = async () => {
    setLoadingConversations(true);
    try {
      if (!employeeAdminIdRef.current) {
        const { data: empData } = await supabase.from('users').select('created_by').eq('id', employeeId).maybeSingle();
        if (empData?.created_by) employeeAdminIdRef.current = empData.created_by;
      }

      let alwaysVisibleQuery = supabase
        .from('simulated_customers')
        .select('id, customer_name, customer_id, customer_avatar, is_super, super_customer_title, badge_type, custom_avatar_url, vip_label, employee_pin_top, employee_always_visible, target_employee_id, target_employee_ids')
        .eq('employee_always_visible', true)
        .eq('is_active', true);
      if (employeeAdminIdRef.current) {
        alwaysVisibleQuery = alwaysVisibleQuery.eq('admin_id', employeeAdminIdRef.current);
      }

      const [summaryResult, alwaysVisibleResult] = await Promise.all([
        supabase.rpc('get_employee_conversation_summaries', { p_employee_id: employeeId }),
        alwaysVisibleQuery
      ]);

      if (summaryResult.error) throw summaryResult.error;

      const grouped = new Map<string, CustomerConversation>();
      let totalUnread = 0;

      for (const row of summaryResult.data || []) {
        const unread = Number(row.unread_count) || 0;
        totalUnread += unread;
        grouped.set(row.customer_id, {
          customer: {
            id: row.customer_id,
            customer_name: row.customer_name,
            customer_id: row.customer_display_id,
            customer_avatar: row.customer_avatar,
            is_super: row.is_super,
            super_customer_title: row.super_customer_title,
            badge_type: row.badge_type,
            custom_avatar_url: row.custom_avatar_url,
            vip_label: row.vip_label,
            employee_pin_top: row.employee_pin_top,
            employee_always_visible: row.employee_always_visible,
            target_employee_id: row.target_employee_id,
            target_employee_ids: row.target_employee_ids,
          },
          unread_count: unread,
          last_message: row.last_message_type === 'image' ? '\ud83d\udcf7 Photo' : (row.last_message || ''),
          last_message_time: row.last_message_time,
          last_customer_message_time: row.last_customer_message_time || undefined,
        });
      }

      // Load always-visible customers that may not have messages yet
      for (const customer of alwaysVisibleResult.data || []) {
        const ids = customer.target_employee_ids;
        if (ids && ids.length > 0 && !ids.includes(employeeId)) continue;
        if (grouped.has(customer.id)) continue;
        grouped.set(customer.id, {
          customer: {
            id: customer.id,
            customer_name: customer.customer_name,
            customer_id: customer.customer_id,
            customer_avatar: customer.customer_avatar,
            is_super: customer.is_super,
            super_customer_title: customer.super_customer_title,
            badge_type: customer.badge_type,
            custom_avatar_url: customer.custom_avatar_url,
            vip_label: customer.vip_label,
            employee_pin_top: customer.employee_pin_top,
            employee_always_visible: customer.employee_always_visible,
            target_employee_id: customer.target_employee_id,
            target_employee_ids: customer.target_employee_ids,
          },
          unread_count: 0,
          last_message: '',
          last_message_time: customer.id,
        });
      }

      let conversationList = Array.from(grouped.values());

      // Filter out customers targeted to a different employee
      conversationList = conversationList.filter(conv => {
        const ids = conv.customer.target_employee_ids;
        return !ids || ids.length === 0 || ids.includes(employeeId);
      });

      conversationList.sort((a, b) => {
        // Pinned customers first
        const aPinned = a.customer.employee_pin_top ? 1 : 0;
        const bPinned = b.customer.employee_pin_top ? 1 : 0;
        if (bPinned !== aPinned) return bPinned - aPinned;
        if (b.unread_count !== a.unread_count) return b.unread_count - a.unread_count;
        return new Date(b.last_message_time).getTime() - new Date(a.last_message_time).getTime();
      });

      setConversations(conversationList);
      setUnreadCount(totalUnread);

      if (selectedCustomerRef.current) {
        const stillExists = grouped.has(selectedCustomerRef.current.id);
        if (!stillExists) {
          setSelectedCustomer(null);
          setMessages([]);
          setShowConversationList(true);
        }
      }
    } catch (error) {
      console.error('Error loading conversations:', error);
    } finally {
      setLoadingConversations(false);
    }
  };

  useEffect(() => { loadOlderMessagesRef.current = loadOlderMessages; });

  const loadMessages = async () => {
    const currentCustomer = selectedCustomerRef.current;
    if (!currentCustomer) return;

    try {
      const cachedMessages = messagesCache.current.get(currentCustomer.id);
      if (cachedMessages) {
        setHasMoreMessages(cachedMessages.length >= MESSAGE_PAGE_SIZE);
      }

      if (!cachedMessages) setLoadingMessages(true);
      await loadMessagesFromDB();
    } catch (error) {
      console.error('Error loading messages:', error);
    } finally {
      setLoadingMessages(false);
      isInitialLoadRef.current = false;
    }
  };

  const loadOlderMessages = async () => {
    const currentCustomer = selectedCustomerRef.current;
    if (!currentCustomer || loadingOlderMessages || !hasMoreMessages) return;
    if (messages.length === 0) return;

    setLoadingOlderMessages(true);
    try {
      const oldestTime = messages[0]?.created_at;
      const { data, error } = await supabase
        .from('customer_employee_conversations')
        .select('*')
        .eq('customer_id', currentCustomer.id)
        .eq('employee_id', employeeId)
        .lt('created_at', oldestTime)
        .order('created_at', { ascending: false })
        .limit(MESSAGE_PAGE_SIZE);

      if (error) throw error;
      if (data && data.length > 0) {
        const olderMessages = data.reverse();
        setMessages(prev => [...olderMessages, ...prev]);
        const cached = messagesCache.current.get(currentCustomer.id);
        if (cached) {
          messagesCache.current.set(currentCustomer.id, [...olderMessages, ...cached]);
        }
        setHasMoreMessages(data.length >= MESSAGE_PAGE_SIZE);
        for (const m of olderMessages) {
          if ((m as any).message_type === 'rich_card') {
            prefetchRichCard(m as any);
          }
        }
      } else {
        setHasMoreMessages(false);
      }
    } catch (error) {
      console.error('Error loading older messages:', error);
    } finally {
      setLoadingOlderMessages(false);
    }
  };

  const loadMessagesFromDB = async (shouldMarkRead = true) => {
    const currentCustomer = selectedCustomerRef.current;
    if (!currentCustomer) return;

    try {
      const [messagesResult, sessionResult] = await Promise.all([
        supabase
          .from('customer_employee_conversations')
          .select('*')
          .eq('customer_id', currentCustomer.id)
          .eq('employee_id', employeeId)
          .order('created_at', { ascending: false })
          .limit(MESSAGE_PAGE_SIZE),
        supabase.rpc('get_or_create_service_session', {
          p_customer_id: currentCustomer.id,
          p_employee_id: employeeId
        })
      ]);

      if (messagesResult.error) throw messagesResult.error;

      if (!messagesResult.data || messagesResult.data.length === 0) {
        setMessages([]);
        setHasMoreMessages(false);
      } else {
        const sorted = messagesResult.data.reverse();
        const prevCached = messagesCache.current.get(currentCustomer.id);
        messagesCache.current.set(currentCustomer.id, sorted);
        setHasMoreMessages(messagesResult.data.length >= MESSAGE_PAGE_SIZE);

        const prevIds = prevCached?.map((m: any) => m.id).join(',');
        const newIds = sorted.map((m: any) => m.id).join(',');
        if (prevIds !== newIds) {
          setMessages(sorted);
        }

        for (const m of sorted) {
          if ((m as any).message_type === 'rich_card') {
            prefetchRichCard(m as any);
          }
        }

        if (shouldMarkRead) {
          await markMessagesAsRead();
        }
      }

      if (sessionResult.data && sessionResult.data.length > 0) {
        setServiceTicketNumber(sessionResult.data[0].service_ticket_number);
      }
    } catch (error) {
      console.error('Error loading messages from DB:', error);
    }
  };

  const markMessagesAsRead = async () => {
    const currentCustomer = selectedCustomerRef.current;
    if (!currentCustomer) return;

    try {
      await supabase
        .from('customer_employee_conversations')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('customer_id', currentCustomer.id)
        .eq('employee_id', employeeId)
        .eq('sender_type', 'customer')
        .eq('is_read', false);

      loadConversations();
    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedCustomer) return;

    if (!file.type.startsWith('image/')) {
      setNotification({ type: 'error', text: t.customerService.selectImageError });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setNotification({ type: 'error', text: t.customerService.imageSizeError });
      return;
    }

    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = (event) => resolve(event.target?.result as string);
      reader.readAsDataURL(file);
    });

    const tempId = `temp-${Date.now()}`;
    const tempMessage: Message = {
      id: tempId,
      customer_id: selectedCustomer.id,
      employee_id: employeeId,
      sender_type: 'employee',
      message_content: '[Image]',
      message_type: 'image',
      image_url: dataUrl,
      created_at: new Date().toISOString(),
      rating_value: null,
    };

    setMessages(prev => [...prev, tempMessage]);
    scrollToBottom();
    uploadingTempIdRef.current = tempId;
    setUploadingImage(true);
    setUploadProgress(0);
    animateProgressTo(0, 20, 600);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${selectedCustomer.id}_${employeeId}_${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`;

      const startTime = Date.now();
      const { error: uploadError } = await supabase.storage
        .from('chat-images')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      animateProgressTo(20, 90, 200);
      await new Promise(r => setTimeout(r, 200));

      const { data: { publicUrl } } = supabase.storage
        .from('chat-images')
        .getPublicUrl(filePath);

      animateProgressTo(90, 100, 150);
      await new Promise(r => setTimeout(r, 150));

      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, image_url: publicUrl } : m));
      uploadingTempIdRef.current = null;
      setUploadingImage(false);
      setUploadProgress(0);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);

      justSentRef.current = true;
      setTimeout(() => { justSentRef.current = false; }, 3000);
      supabase
        .from('customer_employee_conversations')
        .insert({
          customer_id: selectedCustomer.id,
          employee_id: employeeId,
          sender_type: 'employee',
          message_content: '[Image]',
          message_type: 'image',
          image_url: publicUrl,
        })
        .select()
        .single()
        .then(({ data: newMsg, error: insertError }) => {
          if (insertError) {
            console.error('Failed to save message:', insertError);
            setMessages(prev => prev.filter(m => m.id !== tempId));
            setNotification({ type: 'error', text: t.customerService.saveImageError });
          } else if (newMsg) {
            stableKeyMapRef.current.set(newMsg.id, tempId);
            setMessages(prev => prev.map(m => m.id === tempId ? newMsg : m));
          }
        });
    } catch (error: any) {
      setNotification({ type: 'error', text: error.message || t.customerService.uploadError });
      setMessages(prev => prev.filter(m => m.id !== tempId));
      uploadingTempIdRef.current = null;
      setUploadingImage(false);
      setUploadProgress(0);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer || !messageInput.trim()) return;

    const messageContent = messageInput.trim();
    setMessageInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // Optimistically add message to UI
    const tempMessage: Message = {
      id: `temp-${Date.now()}`,
      customer_id: selectedCustomer.id,
      employee_id: employeeId,
      sender_type: 'employee',
      message_content: messageContent,
      message_type: 'text',
      is_read: true,
      created_at: new Date().toISOString(),
    };

    setMessages(prev => [...prev, tempMessage]);

    scrollToBottom();
    justSentRef.current = true;
    setTimeout(() => { justSentRef.current = false; }, 3000);

    try {
      const { data: newMsg, error } = await supabase
        .from('customer_employee_conversations')
        .insert({
          customer_id: selectedCustomer.id,
          employee_id: employeeId,
          sender_type: 'employee',
          message_content: messageContent,
          message_type: 'text',
        })
        .select()
        .single();

      if (error) {
        setMessages(prev => prev.filter(m => m.id !== tempMessage.id));
        throw error;
      }

      if (newMsg) {
        stableKeyMapRef.current.set(newMsg.id, tempMessage.id);
        setMessages(prev => prev.map(m => m.id === tempMessage.id ? newMsg : m));
        const cached = messagesCache.current.get(selectedCustomer.id);
        if (cached) {
          messagesCache.current.set(selectedCustomer.id, cached.map(m => m.id === tempMessage.id ? newMsg : m));
        }
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setMessageInput(messageContent);
    }
  };

  const handleRequestRating = async () => {
    if (!selectedCustomer) return;

    // Optimistically add rating request to UI
    const tempMessage: Message = {
      id: `temp-rating-${Date.now()}`,
      customer_id: selectedCustomer.id,
      employee_id: employeeId,
      sender_type: 'employee',
      message_content: 'Rating request',
      message_type: 'rating_request',
      rating_data: {
        employee_id: employeeId,
        status: 'pending'
      },
      is_read: false,
      created_at: new Date().toISOString(),
    };

    setMessages(prev => [...prev, tempMessage]);

    scrollToBottom();
    justSentRef.current = true;
    setTimeout(() => { justSentRef.current = false; }, 3000);

    try {
      const { data: newMsg, error } = await supabase
        .from('customer_employee_conversations')
        .insert({
          customer_id: selectedCustomer.id,
          employee_id: employeeId,
          sender_type: 'employee',
          message_type: 'rating_request',
          message_content: 'Rating request',
          rating_data: {
            employee_id: employeeId,
            status: 'pending'
          },
          is_read: false,
        })
        .select()
        .single();

      if (error) {
        setMessages(prev => prev.filter(m => m.id !== tempMessage.id));
        throw error;
      }

      setNotification({ type: 'success', text: t.customerService.ratingRequestSent });
      if (newMsg) {
        stableKeyMapRef.current.set(newMsg.id, tempMessage.id);
        setMessages(prev => prev.map(m => m.id === tempMessage.id ? newMsg : m));
        const cached = messagesCache.current.get(selectedCustomer.id);
        if (cached) {
          messagesCache.current.set(selectedCustomer.id, cached.map(m => m.id === tempMessage.id ? newMsg : m));
        }
      }
    } catch (error: any) {
      setNotification({ type: 'error', text: error.message || t.customerService.ratingRequestError });
    }
  };

  const handleSelectConversation = (customer: Customer) => {
    if (conversationListRef.current) {
      conversationListScrollRef.current = conversationListRef.current.scrollTop;
    }
    const cachedMessages = messagesCache.current.get(customer.id);
    if (cachedMessages) {
      setMessages(cachedMessages);
      setLoadingMessages(false);
    } else {
      setMessages([]);
      setLoadingMessages(true);
    }
    setSelectedCustomer(customer);
    setShowConversationList(false);
  };

  const handleBackToList = () => {
    skipListAnimationRef.current = true;
    setShowConversationList(true);
    setSelectedCustomer(null);
    setMessages([]);
    setLoadingMessages(false);
    requestAnimationFrame(() => {
      if (conversationListRef.current) {
        conversationListRef.current.scrollTop = conversationListScrollRef.current;
      }
    });
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return t.customerService.justNow;
    if (diffInSeconds < 3600) return t.customerService.minsAgo.replace('{n}', String(Math.floor(diffInSeconds / 60)));
    if (diffInSeconds < 86400) return t.customerService.hoursAgo.replace('{n}', String(Math.floor(diffInSeconds / 3600)));

    return date.toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' });
  };

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const filteredConversations = useMemo(() => conversations.filter(conv =>
    conv.customer.customer_name.toLowerCase().includes(debouncedSearchQuery.toLowerCase()) ||
    conv.customer.customer_id.toLowerCase().includes(debouncedSearchQuery.toLowerCase())
  ), [conversations, debouncedSearchQuery]);

  return (
    <>
      <style>{`
        @keyframes progress-pulse {
          0%, 100% {
            opacity: 0.6;
          }
          50% {
            opacity: 1;
          }
        }

        @keyframes shimmer-progress {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }

        @keyframes shimmer {
          0% {
            background-position: -200% 0;
          }
          100% {
            background-position: 200% 0;
          }
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes slideInRight {
          from {
            opacity: 0;
            transform: translateX(20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        /* Blockchain & Tech Animations */
        @keyframes spin-slow {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }

        @keyframes spin-reverse-slow {
          from {
            transform: rotate(360deg);
          }
          to {
            transform: rotate(0deg);
          }
        }

        @keyframes pulse-glow {
          0%, 100% {
            opacity: 0.3;
            filter: drop-shadow(0 0 2px currentColor);
          }
          50% {
            opacity: 0.8;
            filter: drop-shadow(0 0 8px currentColor);
          }
        }

        @keyframes pulse-intense {
          0%, 100% {
            opacity: 0.6;
            transform: scale(1);
          }
          50% {
            opacity: 1;
            transform: scale(1.05);
          }
        }

        @keyframes text-shimmer {
          0% {
            background-position: -200% center;
          }
          100% {
            background-position: 200% center;
          }
        }

        @keyframes loading-progress {
          0% {
            transform: translateX(-100%);
          }
          50% {
            transform: translateX(0%);
          }
          100% {
            transform: translateX(100%);
          }
        }

        @keyframes block-chain {
          0%, 100% {
            opacity: 0.2;
            transform: translateY(0) scale(0.8);
          }
          50% {
            opacity: 1;
            transform: translateY(-4px) scale(1.2);
          }
        }

        @keyframes corner-glow {
          0%, 100% {
            opacity: 0.2;
          }
          50% {
            opacity: 0.6;
          }
        }

        /* Mobile shake animation - optimized for performance */
        @keyframes shake-mobile {
          0%, 100% {
            transform: translate3d(0, 0, 0);
          }
          10%, 30%, 50%, 70%, 90% {
            transform: translate3d(-1.5px, 0, 0);
          }
          20%, 40%, 60%, 80% {
            transform: translate3d(1.5px, 0, 0);
          }
        }

        @keyframes ripple-wave {
          0% {
            transform: scale(1);
            opacity: 0.6;
          }
          100% {
            transform: scale(1.8);
            opacity: 0;
          }
        }

        @keyframes color-shift {
          0%, 100% {
            filter: hue-rotate(0deg) brightness(1);
          }
          50% {
            filter: hue-rotate(15deg) brightness(1.1);
          }
        }

        @keyframes breath-intense {
          0%, 100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.15);
          }
        }

        .animate-color-shift {
          animation: color-shift 2s ease-in-out infinite !important;
        }

        .animate-breath-intense {
          animation: breath-intense 1s ease-in-out infinite !important;
        }

        .animate-ripple-wave {
          animation: ripple-wave 1.5s ease-out infinite !important;
        }

        /* Apply shake animation when there are unread messages */
        .chat-btn-shake {
          animation: shake-desktop 1.5s ease-in-out infinite !important;
          will-change: transform;
        }

        @keyframes shake-desktop {
          0%, 100% {
            transform: scale(1) rotate(0deg);
          }
          10% {
            transform: scale(1.08) rotate(-3deg);
          }
          20% {
            transform: scale(1.08) rotate(3deg);
          }
          30% {
            transform: scale(1.08) rotate(-2deg);
          }
          40% {
            transform: scale(1.08) rotate(2deg);
          }
          50% {
            transform: scale(1) rotate(0deg);
          }
        }

        .upload-progress-bar {
          position: relative;
          overflow: hidden;
        }

        .upload-progress-bar::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.3),
            transparent
          );
          animation: shimmer-progress 1.5s infinite;
        }

        .animate-shimmer {
          animation: shimmer 2s infinite;
        }

        .animate-spin-slow {
          animation: spin-slow 4s linear infinite;
        }

        .animate-spin-reverse-slow {
          animation: spin-reverse-slow 3s linear infinite;
        }

        .animate-pulse-glow {
          animation: pulse-glow 2s ease-in-out infinite;
        }

        .animate-pulse-intense {
          animation: pulse-intense 1.5s ease-in-out infinite;
        }

        .animate-text-shimmer {
          animation: text-shimmer 3s linear infinite;
        }

        .animate-loading-progress {
          animation: loading-progress 2s ease-in-out infinite;
        }

        .animate-block-chain {
          animation: block-chain 1.2s ease-in-out infinite;
        }

        .animate-corner-glow {
          animation: corner-glow 2s ease-in-out infinite;
        }

        .shadow-glow-sm {
          box-shadow: 0 0 8px currentColor, 0 0 16px currentColor;
        }

        /* Stable scrollbar styles */
        .chat-messages-container {
          overflow-y: scroll;
          overflow-x: hidden;
          scroll-behavior: auto;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
        }

        /* Prevent layout shift during scroll */
        .chat-messages-container::-webkit-scrollbar {
          width: 8px;
        }

        .chat-messages-container::-webkit-scrollbar-track {
          background: transparent;
        }

        .chat-messages-container::-webkit-scrollbar-thumb {
          background: rgba(148, 163, 184, 0.4);
          border-radius: 4px;
        }

        .chat-messages-container::-webkit-scrollbar-thumb:hover {
          background: rgba(148, 163, 184, 0.6);
        }
      `}</style>
      {messagePopup && !isOpen && createPortal(
        <div className="fixed bottom-36 right-2 sm:right-4 md:bottom-44 lg:bottom-28 lg:right-4 z-[10001] w-[min(calc(100%-1.5rem),24rem)] animate-[slideIn_0.3s_ease-out_both] keep-animation" style={{ maxWidth: 'min(calc(100% - 1.5rem), 24rem)', WebkitTextSizeAdjust: '100%' }}>
          <div className={`relative overflow-hidden rounded-2xl shadow-2xl animate-[fadeInUp_0.4s_ease-out_both] keep-animation border ${
            messagePopup.customer.is_super
              ? 'bg-gradient-to-br from-amber-500 via-yellow-500 to-amber-600 ring-1 ring-amber-400/50 border-amber-400/30'
              : 'bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-600 ring-1 ring-blue-400/50 border-blue-400/30'
          }`}>
            {/* Decorative patterns - hidden on narrow screens */}
            <div className={`hidden sm:block absolute top-0 right-0 w-24 h-24 rounded-full opacity-20 -translate-y-8 translate-x-8 ${
              messagePopup.customer.is_super ? 'bg-yellow-300' : 'bg-blue-300'
            }`}></div>
            <div className={`hidden sm:block absolute bottom-0 left-0 w-16 h-16 rounded-full opacity-15 translate-y-6 -translate-x-6 ${
              messagePopup.customer.is_super ? 'bg-orange-400' : 'bg-indigo-300'
            }`}></div>
            <div className={`hidden sm:block absolute top-1/2 right-4 w-8 h-8 rotate-45 opacity-10 ${
              messagePopup.customer.is_super ? 'bg-white' : 'bg-white'
            }`}></div>
            <div className={`hidden sm:block absolute bottom-8 right-12 w-5 h-5 rounded-full opacity-20 ${
              messagePopup.customer.is_super ? 'bg-amber-200' : 'bg-sky-200'
            }`}></div>

            <div className="relative p-3 sm:p-4">
              <div className="flex items-start gap-2.5 sm:gap-3 mb-2.5 sm:mb-3">
                <div className={`relative flex-shrink-0 rounded-xl overflow-hidden ring-2 shadow-lg ${
                  messagePopup.customer.is_super ? 'ring-white/60' : 'ring-white/50'
                }`}>
                  <CustomerAvatar
                    customer={messagePopup.customer}
                    className="w-10 h-10 sm:w-11 sm:h-11"
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 sm:gap-2 mb-0.5">
                    <h3 className="font-bold text-sm sm:text-base text-white truncate">
                      {messagePopup.customer.customer_name}
                    </h3>
                    {messagePopup.customer.is_super && (
                      <div className="flex-shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 bg-white/25 backdrop-blur-sm border border-white/40 rounded-full">
                        <Sparkles className="w-2.5 h-2.5 text-white fill-white" />
                        <span className="text-[10px] font-bold text-white">{messagePopup.customer.vip_label || 'VIP'}</span>
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] sm:text-xs text-white/70 truncate">
                    ID: {messagePopup.customer.customer_id}
                  </p>
                </div>

                <button
                  onClick={() => {
                    setMessagePopup(null);
                    stopContinuousSound();
                  }}
                  className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-xl transition-colors active:scale-95 hover:bg-white/20 text-white/60 hover:text-white"
                  style={{ minWidth: '36px', minHeight: '36px', touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className={`p-2.5 sm:p-3 rounded-xl mb-2.5 sm:mb-3 backdrop-blur-sm overflow-hidden ${
                messagePopup.customer.is_super
                  ? 'bg-amber-700/40 border border-amber-300/30'
                  : 'bg-blue-800/40 border border-blue-300/20'
              }`}>
                {messagePopup.message.includes('\ud83d\udcf7 Photo') ? (
                  <div className="flex items-center gap-2 text-white/95">
                    <Image className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
                    <span className="text-xs sm:text-sm font-medium">Photo</span>
                  </div>
                ) : (
                  <p className="text-xs sm:text-sm leading-relaxed break-all whitespace-pre-wrap text-white/95 line-clamp-3">
                    {messagePopup.message}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[10px] sm:text-xs text-white/60 truncate min-w-0">
                  <Clock className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{messagePopup.time}</span>
                </div>

                <button
                  onClick={() => {
                    setIsOpen(true);
                    setMessagePopup(null);
                    stopContinuousSound();
                    const customer = messagePopup.customer;
                    setTimeout(() => {
                      setSelectedCustomer(customer);
                      setShowConversationList(false);
                    }, 100);
                  }}
                  className={`flex-shrink-0 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg font-semibold text-xs sm:text-sm transition-all hover:scale-105 active:scale-95 shadow-md ${
                    messagePopup.customer.is_super
                      ? 'bg-white text-amber-700 hover:bg-amber-50'
                      : 'bg-white text-blue-700 hover:bg-blue-50'
                  }`}
                  style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
                >
                  Reply Now
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {!isOpen && createPortal(
        <div className="fixed bottom-20 right-3 sm:right-4 md:bottom-28 lg:bottom-4 lg:right-4 z-[10000]">
          <button
            onClick={() => {
              setIsOpen(true);
              setMessagePopup(null);
              stopContinuousSound();
            }}
            className={`relative group active:scale-95 transition-transform keep-animation w-14 h-14 lg:w-20 lg:h-20 ${unreadCount > 0 ? 'chat-btn-shake' : ''}`}
            style={{
              padding: 0,
              background: 'none',
              border: 'none',
              outline: 'none',
              WebkitAppearance: 'none',
              appearance: 'none',
            }}
          >
            {/* Outer glow effects - Only on larger screens */}
            {unreadCount > 0 && (
              <>
                <div className="hidden sm:block absolute inset-0 rounded-full bg-gradient-to-r from-red-500 via-orange-500 to-yellow-500 blur-xl opacity-40 animate-pulse keep-animation"></div>
                <div className="hidden sm:block absolute inset-0 rounded-full animate-ripple-wave keep-animation">
                  <div className="w-full h-full rounded-full border-2 border-orange-400/60"></div>
                </div>
              </>
            )}

            {/* Main button with gradient border */}
            <div
              className={`absolute inset-0 rounded-xl lg:rounded-3xl overflow-hidden transition-all duration-300 keep-animation ${
                unreadCount > 0
                  ? 'bg-gradient-to-br from-red-500 via-orange-500 to-yellow-500 animate-color-shift'
                  : 'bg-gradient-to-br from-cyan-500 via-blue-600 to-blue-700 animate-pulse'
              }`}
            >
              <div className="absolute inset-[2px] bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950 rounded-[10px] lg:rounded-[22px] flex items-center justify-center overflow-hidden">
                <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity ${
                  unreadCount > 0
                    ? 'bg-gradient-to-br from-red-400/30 via-orange-500/40 to-yellow-500/30'
                    : 'bg-gradient-to-br from-cyan-400/20 via-blue-500/30 to-blue-500/20'
                }`}></div>

                <div className={`absolute inset-0 keep-animation ${
                  unreadCount > 0
                    ? 'bg-[radial-gradient(circle_at_50%_50%,rgba(239,68,68,0.4),transparent_70%)] animate-pulse'
                    : 'bg-[radial-gradient(circle_at_50%_50%,rgba(6,182,212,0.3),transparent_70%)]'
                }`}></div>

                <MessageCircle
                  className={`w-7 h-7 sm:w-8 sm:h-8 lg:w-11 lg:h-11 relative z-10 transition-all duration-300 keep-animation ${
                    unreadCount > 0
                      ? 'text-orange-300 drop-shadow-[0_0_6px_rgba(251,146,60,0.6)] animate-pulse'
                      : 'text-cyan-400 group-hover:text-cyan-300'
                  }`}
                  strokeWidth={2.5}
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)'
                  }}
                />

                {/* Spinning particles - Only when unread */}
                {unreadCount > 0 && (
                  <div className="absolute inset-0 hidden sm:flex items-center justify-center">
                    <div className="absolute w-full h-full animate-spin" style={{ animationDuration: '4s' }}>
                      <div className="absolute top-0 left-1/2 w-1.5 h-1.5 -ml-1 bg-yellow-400/80 rounded-full blur-sm"></div>
                      <div className="absolute bottom-0 left-1/2 w-1.5 h-1.5 -ml-1 bg-red-400/80 rounded-full blur-sm"></div>
                    </div>
                    <div className="absolute w-full h-full animate-spin" style={{ animationDuration: '3s', animationDirection: 'reverse' }}>
                      <div className="absolute left-0 top-1/2 w-1.5 h-1.5 -mt-1 bg-orange-400/80 rounded-full blur-sm"></div>
                      <div className="absolute right-0 top-1/2 w-1.5 h-1.5 -mt-1 bg-yellow-300/80 rounded-full blur-sm"></div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Unread count badge */}
            {unreadCount > 0 && (
              <div className="absolute -top-1 -right-1 sm:-top-2 sm:-right-2 flex items-center justify-center z-20">
                <div className="absolute inset-0 bg-red-500 rounded-full animate-ping keep-animation opacity-75"></div>
                <div className="absolute inset-0 bg-gradient-to-br from-red-500 via-orange-500 to-red-600 rounded-full blur-md opacity-80"></div>
                <div className="relative flex items-center justify-center min-w-[22px] sm:min-w-[28px] lg:min-w-[36px] h-[22px] sm:h-7 lg:h-9 px-1.5 sm:px-2 lg:px-3 bg-gradient-to-br from-red-500 via-orange-500 to-red-600 text-white text-[10px] sm:text-xs lg:text-sm font-black rounded-full border-2 border-white shadow-xl animate-breath-intense keep-animation">
                  <span className="relative drop-shadow-lg">{unreadCount > 99 ? '99+' : unreadCount}</span>
                </div>
              </div>
            )}

            {playingSound && (
              <div className="absolute -top-1 -left-1 lg:-top-2 lg:-left-2 w-5 h-5 lg:w-7 lg:h-7 z-20">
                <div className="absolute inset-0 bg-green-400 rounded-full animate-ping opacity-75"></div>
                <div className="absolute inset-0 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full blur-sm"></div>
                <div className="relative w-full h-full bg-gradient-to-br from-green-400 to-emerald-500 rounded-full flex items-center justify-center border-2 border-white shadow-lg">
                  <Zap className="w-2.5 h-2.5 lg:w-4 lg:h-4 text-white animate-pulse" strokeWidth={3} />
                </div>
              </div>
            )}
          </button>
        </div>,
        document.body
      )}

      {isOpen && createPortal(
        <div
          className="fixed inset-0 lg:bottom-4 lg:right-4 lg:top-auto lg:left-auto z-[10000] lg:z-50 w-full lg:w-[400px] xl:w-[460px] h-full lg:h-[600px] xl:h-[680px] lg:max-h-[calc(100vh-2rem)] bg-white lg:border lg:border-gray-200 lg:rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-[slideInRight_0.3s_ease-out_both]"
          style={{
            WebkitOverflowScrolling: 'touch',
          }}
          onTouchMove={(e) => {
            e.stopPropagation();
          }}
        >

          {showConversationList ? (
            <>
              <div className="relative z-10 flex-shrink-0 bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-700 px-4 pt-10 pb-4 lg:px-6 lg:pt-5 lg:pb-5 overflow-hidden">
                {/* Decorative elements */}
                <div className="absolute top-0 right-0 w-48 h-48 bg-white/[0.04] rounded-full -translate-y-1/2 translate-x-1/4"></div>
                <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/[0.04] rounded-full translate-y-1/2 -translate-x-1/4"></div>
                <div className="absolute top-1/3 right-1/3 w-1.5 h-1.5 bg-white/10 rounded-full"></div>

                <div className="relative flex items-center gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="relative flex-shrink-0">
                      <div className="bg-white/20 p-2.5 lg:p-3 rounded-2xl border border-white/30 shadow-lg shadow-blue-900/20">
                        <MessageCircle className="w-5 h-5 lg:w-6 lg:h-6 text-white" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-lg lg:text-xl font-bold text-white tracking-tight">
                        {t.customerService.title}
                      </h2>
                      <p className="text-xs lg:text-sm text-blue-100 mt-0.5 font-medium">
                        {t.customerService.subtitle}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsOpen(false)}
                    className="flex items-center justify-center w-9 h-9 lg:w-10 lg:h-10 rounded-xl bg-white/20 hover:bg-white/30 text-white transition-all active:scale-95 border border-white/10"
                    style={{ WebkitTapHighlightColor: 'transparent' }}
                  >
                    <X className="w-4 h-4" strokeWidth={2.5} />
                  </button>
                </div>

                <div className="relative mt-4">
                  <div className="absolute left-3 sm:left-3.5 top-1/2 -translate-y-1/2">
                    <Search className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-300" />
                  </div>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t.customerService.searchPlaceholder}
                    className="w-full pl-9 sm:pl-10 pr-9 sm:pr-10 py-2 sm:py-2.5 bg-white/15 border border-white/20 rounded-lg text-white text-xs sm:text-sm placeholder-blue-200 focus:outline-none focus:ring-2 focus:ring-white/30 focus:border-white/40 focus:bg-white/20 transition-all"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 sm:right-3.5 top-1/2 -translate-y-1/2 p-1 hover:bg-white/10 rounded-lg transition-all group"
                      aria-label="Clear search"
                    >
                      <X className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-200 group-hover:text-white transition-colors" />
                    </button>
                  )}
                </div>
              </div>

              <div
                   ref={conversationListRef}
                   className="relative flex-1 overflow-hidden overflow-y-auto"
                   style={{
                     WebkitOverflowScrolling: 'touch',
                     scrollbarWidth: 'thin',
                     scrollbarColor: 'rgba(148, 163, 184, 0.4) transparent',
                     background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 50%, #e8eef6 100%)'
                   }}>
                {filteredConversations.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center px-6">
                    <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-slate-100 to-blue-50 flex items-center justify-center mb-4 shadow-inner">
                      <MessageCircle className="w-10 h-10 text-slate-300" />
                    </div>
                    <p className="text-sm font-medium text-slate-500">{t.customerService.noConversations}</p>
                    <p className="text-xs mt-1 text-slate-400">{t.customerService.noConversationsDesc}</p>
                  </div>
                ) : (
                  <div className="p-3 sm:p-4 space-y-2 sm:space-y-2.5">
                    {filteredConversations.map((conv, index) => (
                      <button
                        key={conv.customer.id}
                        onClick={() => handleSelectConversation(conv.customer)}
                        className={`w-full rounded-2xl transition-all duration-200 hover:translate-x-0.5 active:scale-[0.98] group relative overflow-hidden ${skipListAnimationRef.current ? '' : 'animate-[fadeInUp_0.4s_ease-out_both]'} ${
                          conv.customer.is_super
                            ? conv.unread_count > 0
                              ? 'p-3.5 sm:p-4 bg-gradient-to-r from-amber-100 via-orange-50 to-amber-100 border-2 border-amber-400 hover:border-amber-500 hover:shadow-lg hover:shadow-amber-200/60 ring-1 ring-amber-300/50'
                              : 'p-3.5 sm:p-4 bg-gradient-to-r from-amber-50 via-white to-orange-50 border border-amber-200/80 hover:border-amber-300 hover:shadow-lg hover:shadow-amber-100/50'
                            : conv.unread_count > 0
                              ? 'p-3.5 sm:p-4 bg-gradient-to-r from-blue-50 via-sky-50/80 to-blue-50 border-2 border-blue-400 hover:border-blue-500 hover:shadow-lg hover:shadow-blue-200/60 ring-1 ring-blue-300/50'
                              : 'p-3.5 sm:p-4 bg-white border border-slate-200/80 hover:border-blue-200 hover:shadow-lg hover:shadow-blue-50/50'
                        }`}
                        style={skipListAnimationRef.current ? undefined : {
                          animationDelay: `${Math.min(index * 0.05, 0.4)}s`
                        }}
                      >
                        {conv.customer.is_super ? (
                          /* VIP card: 4-line vertical layout */
                          <div className="relative">
                            <div className="flex items-start gap-3 sm:gap-3.5">
                              <div className="relative flex-shrink-0">
                                {conv.customer.badge_type && (
                                  <div className="absolute -top-1.5 -left-1.5 w-5.5 h-5.5 bg-gradient-to-br from-amber-400 to-orange-500 rounded-md flex items-center justify-center shadow-sm z-10 rotate-12" style={{ width: '22px', height: '22px' }}>
                                    <span className="text-[11px]">
                                      {conv.customer.badge_type === 'diamond' ? '\ud83d\udc8e' :
                                       conv.customer.badge_type === 'crown' ? '\ud83d\udc51' :
                                       conv.customer.badge_type === 'star' ? '\u2b50' :
                                       conv.customer.badge_type === 'vip' ? '\ud83c\udfc6' : '\u2728'}
                                    </span>
                                  </div>
                                )}
                                <CustomerAvatar
                                  customer={conv.customer}
                                  className="w-11 h-11 sm:w-12 sm:h-12"
                                />
                                <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 sm:w-3.5 sm:h-3.5 rounded-full border-2 border-white transition-colors ${
                                  customerOnlineStatus.get(conv.customer.id)
                                    ? 'bg-emerald-400 shadow-sm shadow-emerald-200'
                                    : 'bg-slate-300'
                                }`}></div>
                              </div>

                              <div className="flex-1 min-w-0 text-left space-y-0.5">
                                {/* Line 1: Customer Name */}
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[15px] sm:text-base font-bold truncate text-amber-800">
                                    {conv.customer.customer_name}
                                  </span>
                                  {conv.unread_count > 0 && (
                                    <span className="flex items-center justify-center min-w-[26px] h-[26px] px-2 bg-gradient-to-r from-red-500 to-rose-500 text-white text-[11px] font-bold rounded-full shadow-md shadow-red-300/60 animate-pulse flex-shrink-0">
                                      {conv.unread_count > 9 ? '9+' : conv.unread_count}
                                    </span>
                                  )}
                                </div>

                                {/* Line 2: Title Prefix */}
                                {conv.customer.super_customer_title && (
                                  <div className="flex items-center gap-1.5">
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gradient-to-r from-amber-100 to-orange-100 border border-amber-200/80 rounded-md text-[11px] sm:text-xs font-bold text-amber-700">
                                      <Award className="w-3 h-3 flex-shrink-0" />
                                      {conv.customer.super_customer_title}
                                    </span>
                                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-500/10 border border-amber-300/40 rounded text-[10px] font-bold text-amber-600">
                                      <Sparkles className="w-2.5 h-2.5" />
                                      {conv.customer.vip_label || 'VIP'}
                                    </span>
                                  </div>
                                )}

                                {/* Line 3: Custom ID */}
                                <p className="text-[11px] sm:text-xs font-mono text-amber-600/80">
                                  # {conv.customer.customer_id}
                                </p>

                                {/* Line 4: Chat Content Preview + Time */}
                                <div className="flex items-center justify-between gap-2">
                                  {(() => {
                                    const hasImg = /<img\s/i.test(conv.last_message);
                                    const stripped = conv.last_message.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
                                    const isPhoto = conv.last_message.includes('\ud83d\udcf7 Photo') || (!stripped && hasImg);
                                    if (isPhoto && !stripped) {
                                      return (
                                        <p className="text-xs text-amber-700/60 truncate flex items-center gap-1">
                                          <Image className="w-3 h-3 flex-shrink-0" />
                                          <span>Photo</span>
                                        </p>
                                      );
                                    }
                                    const preview = stripped || '';
                                    return (
                                      <p className="text-xs text-amber-700/60 truncate">
                                        {preview.length > 40 ? `${preview.substring(0, 40)}...` : preview}
                                      </p>
                                    );
                                  })()}
                                  <div className="flex items-center gap-1 text-[10px] text-amber-500/70 font-medium flex-shrink-0">
                                    <Clock className="w-3 h-3" />
                                    {formatTime(conv.last_message_time)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : (
                          /* Regular card: compact layout */
                          <div className="relative flex items-start gap-2.5 sm:gap-3">
                            <div className="relative flex-shrink-0 mt-0.5">
                              <CustomerAvatar
                                customer={conv.customer}
                                className="w-10 h-10 sm:w-11 sm:h-11"
                              />
                              <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full border-2 border-white transition-colors ${
                                customerOnlineStatus.get(conv.customer.id)
                                  ? 'bg-emerald-400 shadow-sm shadow-emerald-200'
                                  : 'bg-slate-300'
                              }`}></div>
                            </div>

                            <div className="flex-1 min-w-0 text-left">
                              <div className="flex items-center justify-between gap-2 mb-0.5">
                                <span className="text-sm font-semibold truncate text-gray-900">
                                  {conv.customer.customer_name}
                                </span>
                                {conv.unread_count > 0 && (
                                  <span className="flex items-center justify-center min-w-[26px] h-[26px] px-2 bg-gradient-to-r from-red-500 to-rose-500 text-white text-[11px] font-bold rounded-full shadow-md shadow-red-300/60 animate-pulse flex-shrink-0">
                                    {conv.unread_count > 9 ? '9+' : conv.unread_count}
                                  </span>
                                )}
                              </div>

                              <p className="text-[10px] font-mono mb-0.5 text-gray-500">
                                # {conv.customer.customer_id}
                              </p>

                              <div className="flex items-center justify-between gap-2">
                                {(() => {
                                  const hasImg = /<img\s/i.test(conv.last_message);
                                  const stripped = conv.last_message.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
                                  const isPhoto = conv.last_message.includes('\ud83d\udcf7 Photo') || (!stripped && hasImg);
                                  if (isPhoto && !stripped) {
                                    return (
                                      <p className="text-xs text-gray-600 truncate flex items-center gap-1">
                                        <Image className="w-3 h-3 flex-shrink-0" />
                                        <span>Photo</span>
                                      </p>
                                    );
                                  }
                                  const preview = stripped || '';
                                  return (
                                    <p className="text-xs text-gray-600 truncate">
                                      {preview.length > 35 ? `${preview.substring(0, 35)}...` : preview}
                                    </p>
                                  );
                                })()}
                                <div className="flex items-center gap-1 text-[10px] text-slate-400 font-medium flex-shrink-0">
                                  <Clock className="w-3 h-3" />
                                  {formatTime(conv.last_message_time)}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className={`relative flex-shrink-0 px-4 pt-10 pb-4 lg:px-6 lg:pt-5 lg:pb-5 overflow-hidden ${
                selectedCustomer?.is_super
                  ? 'bg-gradient-to-br from-amber-500 via-amber-600 to-orange-600'
                  : 'bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-700'
              }`}>
                <div className="absolute top-0 right-0 w-48 h-48 bg-white/[0.04] rounded-full -translate-y-1/2 translate-x-1/4"></div>
                <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/[0.04] rounded-full translate-y-1/2 -translate-x-1/4"></div>
                <div className="absolute top-1/2 right-1/4 w-2 h-2 bg-white/10 rounded-full"></div>

                <div className="relative flex items-center gap-3">
                  <button
                    onClick={handleBackToList}
                    className="flex items-center justify-center w-9 h-9 lg:w-10 lg:h-10 rounded-xl bg-white/20 hover:bg-white/30 text-white transition-all active:scale-95 border border-white/10 flex-shrink-0"
                    style={{ WebkitTapHighlightColor: 'transparent' }}
                  >
                    <ArrowLeft className="w-5 h-5" strokeWidth={2.5} />
                  </button>

                  {selectedCustomer && (
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="relative flex-shrink-0">
                        <CustomerAvatar
                          customer={selectedCustomer}
                          className="w-12 h-12"
                        />

                        <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 shadow-sm transition-colors ${
                          selectedCustomer.is_super ? 'border-amber-500' : 'border-blue-500'
                        } ${
                          customerOnlineStatus.get(selectedCustomer.id)
                            ? 'bg-green-400'
                            : 'bg-gray-300'
                        }`}></div>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="text-sm sm:text-base font-bold text-white leading-snug">
                          {selectedCustomer.customer_name}
                        </div>

                        {selectedCustomer.is_super && selectedCustomer.super_customer_title ? (
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-white/20 backdrop-blur-sm border border-white/30 rounded text-[10px] sm:text-xs font-bold text-white">
                              <Award className="w-2.5 h-2.5 flex-shrink-0" />
                              <span>{selectedCustomer.super_customer_title}</span>
                            </span>
                          </div>
                        ) : !selectedCustomer.is_super && serviceTicketNumber ? (
                          <div className="text-[10px] sm:text-xs font-mono text-blue-100 flex items-center gap-1 mt-0.5 leading-tight">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-300 flex-shrink-0"></div>
                            <span>{t.customerService.ticket}: {serviceTicketNumber}</span>
                          </div>
                        ) : null}

                        <div className={`text-[10px] sm:text-xs font-mono leading-tight mt-0.5 ${
                          selectedCustomer.is_super ? 'text-amber-100' : 'text-blue-100'
                        }`}>
                          # {selectedCustomer.customer_id}
                        </div>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={handleRequestRating}
                    className="flex items-center justify-center w-9 h-9 lg:w-10 lg:h-10 rounded-xl bg-white/20 hover:bg-white/30 text-white transition-all active:scale-95 border border-white/10 flex-shrink-0"
                    title={t.customerService.requestRating}
                    style={{ WebkitTapHighlightColor: 'transparent' }}
                  >
                    <Star className="w-5 h-5" strokeWidth={2.5} />
                  </button>
                </div>
              </div>

              <div
                ref={messagesContainerCallbackRef}
                className="chat-messages-container relative flex-1 flex flex-col-reverse"
                style={{
                  scrollbarWidth: 'thin',
                  scrollbarColor: 'rgba(148, 163, 184, 0.4) transparent',
                  WebkitOverflowScrolling: 'touch',
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  background: selectedCustomer?.is_super
                    ? 'linear-gradient(160deg, #fffbeb 0%, #fef3c7 30%, #fff7ed 60%, #fffbeb 100%)'
                    : 'linear-gradient(160deg, #f0f4f8 0%, #e8eef6 30%, #eef2ff 60%, #f0f4f8 100%)'
                }}
              >
               <div className="p-2 sm:p-3 md:p-4 space-y-2 sm:space-y-3 md:space-y-4 mb-auto">
                {loadingMessages ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-10 h-10 border-3 border-gray-200 border-t-blue-500 rounded-full animate-spin"></div>
                      <span className="text-sm text-gray-400 font-medium">{t.customerService.loadingMessages}</span>
                    </div>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center animate-[fadeIn_0.5s_ease-out] px-6">
                    <div className="relative mb-6">
                      <div className={`w-24 h-24 rounded-3xl flex items-center justify-center shadow-lg ${
                        selectedCustomer?.is_super
                          ? 'bg-gradient-to-br from-amber-100 via-orange-50 to-amber-100 border border-amber-200/60'
                          : 'bg-gradient-to-br from-blue-100 via-sky-50 to-blue-100 border border-blue-200/60'
                      }`}>
                        <MessageCircle className={`w-11 h-11 ${
                          selectedCustomer?.is_super ? 'text-amber-400' : 'text-blue-400'
                        }`} strokeWidth={1.5} />
                      </div>
                      <div className={`absolute -bottom-1.5 -right-1.5 w-9 h-9 rounded-xl flex items-center justify-center shadow-md ${
                        selectedCustomer?.is_super
                          ? 'bg-gradient-to-br from-amber-400 to-orange-500'
                          : 'bg-gradient-to-br from-blue-500 to-blue-600'
                      }`}>
                        <Clock className="w-4 h-4 text-white" />
                      </div>
                    </div>
                    <p className={`text-base font-semibold ${
                      selectedCustomer?.is_super ? 'text-amber-700' : 'text-slate-600'
                    }`}>{t.customerService.noMessages}</p>
                    <p className={`text-sm mt-2 max-w-[240px] leading-relaxed ${
                      selectedCustomer?.is_super ? 'text-amber-500/70' : 'text-slate-400'
                    }`}>{t.customerService.noMessagesDesc}</p>
                    <div className="flex items-center gap-1.5 mt-5">
                      <div className={`w-2 h-2 rounded-full animate-bounce ${
                        selectedCustomer?.is_super ? 'bg-amber-300' : 'bg-blue-300'
                      }`} style={{ animationDelay: '0s' }}></div>
                      <div className={`w-2 h-2 rounded-full animate-bounce ${
                        selectedCustomer?.is_super ? 'bg-amber-400' : 'bg-blue-400'
                      }`} style={{ animationDelay: '0.15s' }}></div>
                      <div className={`w-2 h-2 rounded-full animate-bounce ${
                        selectedCustomer?.is_super ? 'bg-amber-300' : 'bg-blue-300'
                      }`} style={{ animationDelay: '0.3s' }}></div>
                    </div>
                  </div>
                ) : (
                  <>
                    {loadingOlderMessages && (
                      <div className="flex justify-center py-3">
                        <div className="w-5 h-5 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
                      </div>
                    )}
                    {messages.map((msg, index) => {
                      const stableKey = stableKeyMapRef.current.get(msg.id) || msg.id;
                      const isSwapped = stableKeyMapRef.current.has(msg.id);
                      const showEntryAnim = !isSwapped && msg.created_at > conversationOpenedAtRef.current && index >= messages.length - 3;
                      return (
                    <div
                      key={stableKey}
                      className={`flex gap-3 sm:gap-3 ${msg.sender_type === 'employee' ? 'flex-row-reverse' : 'flex-row'} ${showEntryAnim ? 'animate-[fadeInUp_0.4s_ease-out_both]' : ''}`}
                      style={showEntryAnim ? { animationDelay: `${Math.min((messages.length - index - 1) * 0.05, 0.15)}s` } : undefined}
                    >
                      <div className="flex-shrink-0">
                        {msg.sender_type === 'customer' && selectedCustomer && (
                          <div className="rounded-lg overflow-hidden">
                            <CustomerAvatar
                              customer={selectedCustomer}
                              className="w-10 h-10 sm:w-11 sm:h-11 lg:w-9 lg:h-9"
                            />
                          </div>
                        )}
                      </div>

                      <div className={`flex flex-col ${msg.sender_type === 'employee' ? 'items-end' : 'items-start'} max-w-[75%] sm:max-w-[75%] md:max-w-[70%] min-w-0`}>
                        <div className={`text-[10px] sm:text-xs font-semibold mb-0.5 ${
                          msg.sender_type === 'employee'
                            ? 'text-blue-600'
                            : selectedCustomer?.is_super
                              ? 'text-amber-700'
                              : 'text-gray-700'
                        }`}>
                          {msg.sender_type === 'employee' ? t.customerService.you : selectedCustomer?.customer_name}
                        </div>
                        {(msg.message_type === 'tip' || msg.message_type === 'rating_request' || msg.message_type === 'rating_result' || msg.message_type === 'rich_card') ? (
                          <>
                            {renderMessageContent(msg)}
                          </>
                        ) : msg.message_type === 'image' && msg.image_url ? (
                          <div className="rounded-2xl overflow-hidden shadow-md">
                            {renderMessageContent(msg)}
                          </div>
                        ) : (
                        <div
                          className={`relative px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-2xl text-sm sm:text-[15px] leading-relaxed ${
                            msg.sender_type === 'employee'
                              ? 'bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-tr-md shadow-md shadow-blue-600/20'
                              : selectedCustomer?.is_super
                                ? 'bg-gradient-to-br from-white to-amber-50/80 text-gray-900 rounded-tl-md border border-amber-200/60 shadow-md shadow-amber-100/30'
                                : 'bg-white text-gray-900 rounded-tl-md border border-slate-200/80 shadow-md shadow-slate-100/50'
                          }`}
                        >
                          <div className="relative z-10">
                            {renderMessageContent(msg)}
                          </div>
                        </div>
                        )}
                        <div className="text-[10px] sm:text-[11px] mt-0.5 sm:mt-1 text-gray-400">
                          {new Date(msg.created_at).toLocaleString(dateLocale, {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false,
                          })}
                        </div>
                      </div>
                    </div>
                  ); })}


                  </>
                )}
               </div>
              </div>

              <form onSubmit={handleSendMessage} className="relative p-3 sm:p-3 md:p-4 pb-5 sm:pb-3 md:pb-4 border-t border-gray-200 bg-white">
                <div className="flex gap-2 sm:gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageSelect}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingImage}
                    className="self-end flex-shrink-0 relative px-3 sm:px-3.5 py-2.5 sm:py-3 min-h-[44px] bg-gray-100 hover:bg-gray-200 active:bg-gray-300 disabled:bg-blue-50 text-gray-500 hover:text-gray-700 rounded-lg transition-all active:scale-95 overflow-hidden"
                    title={t.customerService.uploadImage}
                  >
                    {uploadingImage ? (
                      <div className="flex items-center gap-1.5">
                        <div className="w-5 h-5 relative">
                          <svg className="w-5 h-5 -rotate-90" viewBox="0 0 20 20">
                            <circle cx="10" cy="10" r="8" fill="none" stroke="#dbeafe" strokeWidth="2" />
                            <circle cx="10" cy="10" r="8" fill="none" stroke="#3b82f6" strokeWidth="2"
                              strokeDasharray={`${uploadProgress * 0.5}, 50`} strokeLinecap="round"
                              style={{ transition: 'stroke-dasharray 0.15s ease-out' }} />
                          </svg>
                        </div>
                        <span className="text-[11px] font-semibold text-blue-600 hidden sm:inline">{uploadProgress}%</span>
                      </div>
                    ) : (
                      <Image className="w-5 h-5" strokeWidth={2} />
                    )}
                  </button>
                  <textarea
                    ref={textareaRef}
                    value={messageInput}
                    onChange={(e) => {
                      setMessageInput(e.target.value);
                      const el = e.target;
                      el.style.height = 'auto';
                      const lineHeight = 20;
                      const maxHeight = lineHeight * 10 + 24;
                      el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (messageInput.trim()) {
                          handleSendMessage(e as unknown as React.FormEvent);
                        }
                      }
                    }}
                    placeholder={t.customerService.typeMessage}
                    rows={1}
                    className="chat-textarea-scroll flex-1 px-3 sm:px-4 py-2.5 sm:py-3 bg-gray-100 border border-gray-200 rounded-xl text-gray-900 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 focus:bg-white placeholder-gray-400 transition-all resize-none leading-5"
                    autoComplete="off"
                    style={{ maxHeight: '224px' }}
                  />
                  <button
                    type="submit"
                    disabled={!messageInput.trim()}
                    className="self-end px-4 sm:px-6 py-2.5 sm:py-3 min-h-[44px] min-w-[56px] sm:min-w-[72px] bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium shadow-sm group active:scale-95"
                  >
                    <Send className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" strokeWidth={2} />
                    <span className="hidden sm:inline text-sm font-semibold">Send</span>
                  </button>
                </div>
              </form>
            </>
          )}
        </div>,
        document.body
      )}

      {notification && (
        <div className="fixed top-3 right-3 sm:top-6 sm:right-6 z-[60] animate-slide-in-right max-w-[calc(100%-1.5rem)] sm:max-w-none">
          <div className={`px-4 sm:px-6 py-3 sm:py-4 rounded-xl shadow-lg border ${
            notification.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}>
            <div className="flex items-center gap-2 sm:gap-3">
              {notification.type === 'success' ? (
                <div className="flex-shrink-0 w-5 h-5 sm:w-6 sm:h-6 bg-emerald-100 rounded-full flex items-center justify-center">
                  <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
              ) : (
                <div className="flex-shrink-0 w-5 h-5 sm:w-6 sm:h-6 bg-red-100 rounded-full flex items-center justify-center">
                  <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
              )}
              <p className="font-medium text-sm sm:text-base">{notification.text}</p>
            </div>
          </div>
        </div>
      )}
      {previewImage && createPortal(
        <div
          className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) { setPreviewImage(null); setImageZoom(1); setImageDrag({ x: 0, y: 0 }); } }}
        >
          <div className="absolute top-3 right-3 sm:top-5 sm:right-5 flex items-center gap-2 z-10">
            <button
              onClick={() => setImageZoom(z => Math.max(0.5, z - 0.25))}
              className="p-2 sm:p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <ZoomOut className="w-5 h-5" />
            </button>
            <span className="text-white/70 text-xs font-mono min-w-[3rem] text-center">{Math.round(imageZoom * 100)}%</span>
            <button
              onClick={() => setImageZoom(z => Math.min(5, z + 0.25))}
              className="p-2 sm:p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <ZoomIn className="w-5 h-5" />
            </button>
            <button
              onClick={() => { setImageZoom(1); setImageDrag({ x: 0, y: 0 }); }}
              className="p-2 sm:p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <RotateCcw className="w-5 h-5" />
            </button>
            <button
              onClick={() => { setPreviewImage(null); setImageZoom(1); setImageDrag({ x: 0, y: 0 }); }}
              className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div
            className="w-full h-full flex items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing"
            onMouseDown={(e) => { setIsDragging(true); dragStartRef.current = { x: e.clientX, y: e.clientY, ox: imageDrag.x, oy: imageDrag.y }; }}
            onMouseMove={(e) => { if (!isDragging) return; setImageDrag({ x: dragStartRef.current.ox + e.clientX - dragStartRef.current.x, y: dragStartRef.current.oy + e.clientY - dragStartRef.current.y }); }}
            onMouseUp={() => setIsDragging(false)}
            onMouseLeave={() => setIsDragging(false)}
            onTouchStart={(e) => { const t = e.touches[0]; setIsDragging(true); dragStartRef.current = { x: t.clientX, y: t.clientY, ox: imageDrag.x, oy: imageDrag.y }; }}
            onTouchMove={(e) => { if (!isDragging) return; const t = e.touches[0]; setImageDrag({ x: dragStartRef.current.ox + t.clientX - dragStartRef.current.x, y: dragStartRef.current.oy + t.clientY - dragStartRef.current.y }); }}
            onTouchEnd={() => setIsDragging(false)}
          >
            <img
              src={previewImage}
              alt="Preview"
              className="max-w-[95vw] max-h-[90vh] sm:max-w-[85vw] sm:max-h-[85vh] object-contain select-none"
              style={{
                transform: `scale(${imageZoom}) translate(${imageDrag.x / imageZoom}px, ${imageDrag.y / imageZoom}px)`,
                transition: isDragging ? 'none' : 'transform 0.2s ease-out',
              }}
              draggable={false}
            />
          </div>
        </div>,
        document.body
      )}
      {viewingRichCard && createPortal(
        <div
          className="fixed inset-0 z-[10000] flex items-stretch justify-stretch p-0 xl:items-center xl:justify-center xl:p-6 overflow-hidden touch-none"
          onClick={() => { richCardCancelRef.current = true; setViewingRichCard(null); }}
          style={{ background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', animation: 'fadeIn 0.2s ease-out', WebkitTapHighlightColor: 'transparent', overscrollBehavior: 'contain' }}
        >
          <div
            className="relative w-full h-full xl:max-w-3xl xl:max-h-[85vh] xl:w-[680px] xl:h-auto bg-white rounded-none xl:rounded-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
            style={{ animation: 'scaleIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)', boxShadow: '0 25px 60px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255,255,255,0.1)' }}
          >
            <div
              className="relative flex-shrink-0 overflow-hidden"
              className="relative flex-shrink-0 overflow-hidden px-5 pb-5 bg-gradient-to-br from-[#1e40af] via-[#2563eb] to-[#1d4ed8]"
              style={{ paddingTop: 'calc(env(safe-area-inset-top) + 16px)' }}
            >
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/5 rounded-full blur-2xl"></div>
                <div className="absolute -bottom-8 -left-8 w-32 h-32 bg-blue-300/10 rounded-full blur-xl"></div>
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>
                <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)', backgroundSize: '32px 32px' }}></div>
              </div>
              <button
                onClick={() => { richCardCancelRef.current = true; setViewingRichCard(null); }}
                className="absolute top-3 right-3 z-20 flex items-center justify-center w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 active:bg-white/30 border border-white/20 transition-all active:scale-90"
                style={{ touchAction: 'manipulation', top: 'calc(env(safe-area-inset-top) + 12px)' }}
              >
                <X className="w-4 h-4 text-white" />
              </button>
              <div className="relative z-10">
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white/15 rounded-full border border-white/20 w-fit mb-3">
                  <Clock className="w-3 h-3 text-blue-100" />
                  <span className="text-[10px] sm:text-xs text-blue-50 font-medium">
                    {new Date(viewingRichCard.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 p-2.5 bg-white/15 backdrop-blur-sm rounded-xl border border-white/20 shadow-lg shadow-blue-900/20">
                    <Megaphone className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1 pr-8">
                    <h2 className="text-lg sm:text-xl font-bold text-white leading-snug break-words">{viewingRichCard.title || t.customerService.richCardNotice || 'View details'}</h2>
                    {viewingRichCard.subtitle && <p className="text-sm text-blue-100/80 mt-1 break-words">{viewingRichCard.subtitle}</p>}
                  </div>
                </div>
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-blue-400/30 via-blue-300/50 to-blue-400/30"></div>
            </div>
            <div
              className="relative flex-1 overflow-y-auto min-h-0 hide-scrollbar"
              style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', msOverflowStyle: 'none', padding: '20px' }}
            >
              {loadingRichCardContent ? (
                <div className="flex flex-col items-center justify-center" style={{ minHeight: '40vh', animation: 'fadeIn 0.3s ease-out' }}>
                  <div className="relative mb-6">
                    <div className="w-14 h-14 rounded-full border-4 border-blue-100" style={{ animation: 'pulse 2s ease-in-out infinite' }}></div>
                    <div className="absolute inset-0 w-14 h-14 rounded-full border-4 border-transparent border-t-blue-500 border-r-blue-400 animate-spin"></div>
                    <div className="absolute inset-2 w-10 h-10 rounded-full border-4 border-transparent border-b-blue-300 border-l-blue-200" style={{ animation: 'spin 1.2s linear infinite reverse' }}></div>
                  </div>
                  <div className="w-40 h-1.5 bg-blue-100 rounded-full overflow-hidden mb-3">
                    <div className="h-full w-full bg-gradient-to-r from-blue-400 via-blue-500 to-blue-400 rounded-full" style={{ backgroundSize: '200% 100%', animation: 'shimmer 1.5s ease-in-out infinite' }}></div>
                  </div>
                  <div className="flex items-center gap-1 text-blue-500">
                    <span className="text-sm font-medium">Loading content</span>
                    <span className="flex gap-0.5">
                      <span className="w-1 h-1 bg-blue-400 rounded-full" style={{ animation: 'bounce 1.4s ease-in-out infinite' }}></span>
                      <span className="w-1 h-1 bg-blue-400 rounded-full" style={{ animation: 'bounce 1.4s ease-in-out infinite 0.2s' }}></span>
                      <span className="w-1 h-1 bg-blue-400 rounded-full" style={{ animation: 'bounce 1.4s ease-in-out infinite 0.4s' }}></span>
                    </span>
                  </div>
                </div>
              ) : (
                <div
                  className="announcement-content mobile-content text-[15px] leading-[1.75] text-gray-700"
                  dangerouslySetInnerHTML={{ __html: sanitizeAnnouncementContent(richCardFullContent || '') }}
                />
              )}
            </div>
            <div
              className="relative flex-shrink-0 border-t border-slate-100 bg-slate-50/80"
              className="relative flex-shrink-0 border-t border-slate-100 bg-slate-50/80 pt-3 px-5"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
            >
              <button
                onClick={() => { richCardCancelRef.current = true; setViewingRichCard(null); }}
                className="w-full px-5 py-3 min-h-[44px] bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 active:from-blue-800 active:to-blue-700 text-white font-semibold text-sm rounded-xl transition-all duration-200 shadow-md shadow-blue-600/20 hover:shadow-lg hover:shadow-blue-600/30 active:scale-[0.98]"
              >
                {t.announcements?.close || 'Close'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
