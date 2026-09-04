import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Package, Wallet, BarChart3, LogOut, User, Zap, PackageSearch, X, Lock, ChevronDown } from 'lucide-react';
import { Employee } from '../../types';
import { logout } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { useCompanyName } from '../../lib/useCompanyName';
import { useResponsive } from '../../lib/useResponsive';
import { tabSessionManager } from '../../lib/TabSessionManager';
import { useLanguage } from '../../lib/i18n';
import type { Language } from '../../lib/i18n';
import LanguageSwitcher, { LanguageModal } from '../LanguageSwitcher';
import SessionExpiredModal from './SessionExpiredModal';

const AnnouncementBoard = lazy(() => import('./AnnouncementBoard'));
const OrderSubmission = lazy(() => import('./OrderSubmission'));
const OrderList = lazy(() => import('./OrderList'));
const WalletOverview = lazy(() => import('./WalletOverview'));
const DailyStatistics = lazy(() => import('./DailyStatistics'));
const MessageCenter = lazy(() => import('./MessageCenter'));
const LoginPopupMessages = lazy(() => import('./LoginPopupMessages'));
const OrderDispatch = lazy(() => import('./OrderDispatch'));
const CustomerServiceChat = lazy(() => import('./CustomerServiceChat'));
const PasswordChange = lazy(() => import('./PasswordChange'));

interface EmployeeDashboardProps {
  employee: Employee;
}

export default function EmployeeDashboard({ employee: initialEmployee }: EmployeeDashboardProps) {
  const [employee, setEmployee] = useState<Employee>(initialEmployee);
  const [activeTab, setActiveTab] = useState<'announcements' | 'orders' | 'wallet' | 'statistics' | 'dispatch'>('announcements');
  const [loadedTabs, setLoadedTabs] = useState<Set<string>>(new Set(['announcements']));
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showMessageCenter, setShowMessageCenter] = useState(false);
  const [showLoginPopup, setShowLoginPopup] = useState(false);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const [hasNewMessage, setHasNewMessage] = useState(false);
  const [hasNewOrder, setHasNewOrder] = useState(false);
  const [hasOrderTimeout, setHasOrderTimeout] = useState(false);
  const [showMessageToast, setShowMessageToast] = useState(false);
  const [latestMessage, setLatestMessage] = useState<{ title: string; content: string; priority: string } | null>(null);
  const [audioContextReady, setAudioContextReady] = useState(false);
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [showSessionExpired, setShowSessionExpired] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [showWithdrawalHistory, setShowWithdrawalHistory] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const { companyName } = useCompanyName(employee.created_by);
  const { isMobile, isTablet } = useResponsive();
  const { t, language, setLanguage } = useLanguage();

  // Trigger auto messages for all eligible customers on login
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: customers } = await supabase
          .from('simulated_customers')
          .select('id')
          .eq('auto_messages_enabled', true)
          .eq('is_active', true)
          .eq('admin_id', employee.created_by);
        if (cancelled || !customers || customers.length === 0) return;

        const customerIds = customers.map((c: any) => c.id);

        const [autoMsgsRes, logsRes] = await Promise.all([
          supabase
            .from('customer_auto_messages')
            .select('id, customer_id, content_type, title, subtitle, is_enabled')
            .in('customer_id', customerIds)
            .eq('is_enabled', true)
            .order('sort_order', { ascending: true }),
          supabase
            .from('customer_auto_message_logs')
            .select('auto_message_id')
            .in('customer_id', customerIds)
            .eq('employee_id', employee.id),
        ]);
        if (cancelled) return;

        const sentIds = new Set((logsRes.data || []).map((l: any) => l.auto_message_id));
        const unsent = (autoMsgsRes.data || []).filter((m: any) => !sentIds.has(m.id));
        if (unsent.length === 0) return;

        const unsentIds = unsent.map((m: any) => m.id);
        const { data: fullMsgs } = await supabase
          .from('customer_auto_messages')
          .select('*')
          .in('id', unsentIds);
        if (cancelled || !fullMsgs || fullMsgs.length === 0) return;

        const fullMsgMap = new Map(fullMsgs.map((m: any) => [m.id, m]));


        const baseTime = Date.now();
        const conversationPayloads = unsent.map((msg: any, idx: number) => {
          const full = fullMsgMap.get(msg.id) || msg;
          const isRichCard = full.content_type === 'rich_card';
          const payload: any = {
            customer_id: full.customer_id,
            employee_id: employee.id,
            sender_type: 'customer',
            message_content: isRichCard ? (full.title || 'Rich Card') : full.content,
            message_type: isRichCard ? 'rich_card' : 'text',
            created_at: new Date(baseTime + idx).toISOString(),
          };
          if (full.title) payload.title = full.title;
          if (full.subtitle) payload.subtitle = full.subtitle;
          if (isRichCard) payload.source_auto_message_id = full.id;
          return payload;
        });

        const logPayloads = unsent.map((msg: any) => ({
          customer_id: msg.customer_id,
          employee_id: employee.id,
          auto_message_id: msg.id,
        }));

        await Promise.all([
          supabase.from('customer_employee_conversations').insert(conversationPayloads),
          supabase.from('customer_auto_message_logs').insert(logPayloads),
        ]);
      } catch (err) {
        console.error('Dashboard auto-message trigger error:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [employee.id]);

  // Real-time sync employee data (especially is_verified status and session token)
  useEffect(() => {
    console.log('[EmployeeDashboard] Setting up real-time sync for employee data');

    // Get current session token from sessionStorage
    const auth = sessionStorage.getItem('quantum_trader_auth');
    const currentSessionToken = auth ? JSON.parse(auth).sessionToken : null;

    // Subscribe to changes in the users table for this employee
    const channel = supabase
      .channel(`employee-${employee.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'users',
          filter: `id=eq.${employee.id}`
        },
        (payload) => {
          console.log('[EmployeeDashboard] Employee data updated:', payload.new);
          const updatedEmployee = payload.new as Employee;

          // Check if session token has changed (another login kicked us out)
          if (currentSessionToken && updatedEmployee.current_session_token !== currentSessionToken) {
            console.log('[EmployeeDashboard] Session token changed - another login detected!');
            console.log('Old token:', currentSessionToken);
            console.log('New token:', updatedEmployee.current_session_token);

            // Show session expired modal and logout
            setShowSessionExpired(true);
            return;
          }

          // Update state
          setEmployee(updatedEmployee);

          // Update sessionStorage
          const auth = sessionStorage.getItem('quantum_trader_auth');
          if (auth) {
            const authData = JSON.parse(auth);
            authData.user = updatedEmployee;
            sessionStorage.setItem('quantum_trader_auth', JSON.stringify(authData));
            console.log('[EmployeeDashboard] Updated sessionStorage with new employee data');
          }
        }
      )
      .subscribe();

    // Cleanup
    return () => {
      console.log('[EmployeeDashboard] Cleaning up real-time subscription');
      supabase.removeChannel(channel);
    };
  }, [employee.id]);

  // Initialize tab session tracking
  useEffect(() => {
    const handleSessionExpired = () => {
      console.log('[EmployeeDashboard] Session expired, showing modal');
      setShowSessionExpired(true);
    };

    // Start tracking this tab's session
    tabSessionManager.startSession(employee.id, handleSessionExpired);

    // Cleanup on unmount
    return () => {
      // Don't broadcast on unmount, just cleanup
      tabSessionManager.stopSession(false);
    };
  }, [employee.id]);

  // Handle session expired modal close
  const handleSessionExpiredClose = async () => {
    setShowSessionExpired(false);
    // Pass false to indicate this is NOT user-initiated logout (kicked out by another tab)
    await logout(false);
  };

  // Initialize audio context on first user interaction
  useEffect(() => {
    const initAudioContext = () => {
      if (!audioContextReady) {
        try {
          const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
          audioContext.resume().then(() => {
            setAudioContextReady(true);
            console.log('Audio context initialized and ready');
          });
        } catch (error) {
          console.error('Error initializing audio context:', error);
        }
      }
    };

    // Listen for any user interaction to initialize audio
    const events = ['click', 'touchstart', 'keydown'];
    events.forEach(event => {
      document.addEventListener(event, initAudioContext, { once: true });
    });

    return () => {
      events.forEach(event => {
        document.removeEventListener(event, initAudioContext);
      });
    };
  }, [audioContextReady]);

  // Handle click outside user menu to close it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    };

    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showUserMenu]);

  const handleOrderStatusChange = (newOrder: boolean, timeout: boolean) => {
    setHasNewOrder(newOrder);
    setHasOrderTimeout(timeout);
  };

  const tabs = [
    { id: 'announcements' as const, label: t.nav.announcements, mobileLabel: t.nav.announcementsMobile, icon: Bell },
    { id: 'dispatch' as const, label: t.nav.orderAssignment, mobileLabel: t.nav.orderAssignmentMobile, icon: PackageSearch },
    { id: 'orders' as const, label: t.nav.orders, mobileLabel: t.nav.ordersMobile, icon: Package },
    { id: 'statistics' as const, label: t.nav.dailyStatistics, mobileLabel: t.nav.dailyStatisticsMobile, icon: BarChart3 },
    { id: 'wallet' as const, label: t.nav.wallet, mobileLabel: t.nav.walletMobile, icon: Wallet },
  ];

  // Mark tab as loaded when it becomes active
  useEffect(() => {
    // If tab is already loaded, don't show transition
    if (loadedTabs.has(activeTab)) {
      return;
    }

    // Show transition only for tabs that haven't been loaded yet
    setIsTransitioning(true);
    const timer = setTimeout(() => {
      setLoadedTabs(prev => new Set([...prev, activeTab]));
      setIsTransitioning(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [activeTab, loadedTabs]);

  // Load unread message count
  useEffect(() => {
    // Load data asynchronously without blocking render
    loadUnreadCount();
    checkLoginPopupMessages();

    // Subscribe to new messages
    const channel = supabase
      .channel('employee_new_messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'message_recipients',
          filter: `recipient_id=eq.${employee.id}`
        },
        async () => {
          loadUnreadCount();

          const { data: latest } = await supabase
            .from('message_recipients')
            .select('id, messages!inner(message_type)')
            .eq('recipient_id', employee.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (latest?.messages?.message_type === 'login_popup') return;

          playNotificationSound();
          setHasNewMessage(true);
          await loadLatestMessage();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'message_recipients',
          filter: `recipient_id=eq.${employee.id}`
        },
        () => {
          loadUnreadCount();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [employee.id]);



  const playNotificationSound = () => {
    // Create a pleasant notification sound with two tones
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

      // Resume audio context if suspended (browser autoplay policy)
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }

      // First tone (higher pitch)
      const oscillator1 = audioContext.createOscillator();
      const gainNode1 = audioContext.createGain();

      oscillator1.connect(gainNode1);
      gainNode1.connect(audioContext.destination);

      oscillator1.frequency.value = 880; // A5 note
      oscillator1.type = 'sine';

      gainNode1.gain.setValueAtTime(0, audioContext.currentTime);
      gainNode1.gain.linearRampToValueAtTime(0.15, audioContext.currentTime + 0.05);
      gainNode1.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

      oscillator1.start(audioContext.currentTime);
      oscillator1.stop(audioContext.currentTime + 0.3);

      // Second tone (lower pitch) - plays after first
      const oscillator2 = audioContext.createOscillator();
      const gainNode2 = audioContext.createGain();

      oscillator2.connect(gainNode2);
      gainNode2.connect(audioContext.destination);

      oscillator2.frequency.value = 660; // E5 note
      oscillator2.type = 'sine';

      gainNode2.gain.setValueAtTime(0, audioContext.currentTime + 0.15);
      gainNode2.gain.linearRampToValueAtTime(0.15, audioContext.currentTime + 0.2);
      gainNode2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

      oscillator2.start(audioContext.currentTime + 0.15);
      oscillator2.stop(audioContext.currentTime + 0.5);

      console.log('Notification sound played successfully');
    } catch (error) {
      console.error('Error playing notification sound:', error);
    }
  };

  const loadUnreadCount = async () => {
    try {
      const { count, error } = await supabase
        .from('message_recipients')
        .select('*', { count: 'exact', head: true })
        .eq('recipient_id', employee.id)
        .eq('is_read', false);

      if (!error && count !== null) {
        setUnreadMessageCount(count);
      }
    } catch (error) {
      console.error('Error loading unread count:', error);
    }
  };

  const checkLoginPopupMessages = async () => {
    try {
      const { data, error } = await supabase
        .from('message_recipients')
        .select('id, messages!inner(message_type)')
        .eq('recipient_id', employee.id)
        .eq('is_shown', false)
        .eq('messages.message_type', 'login_popup')
        .limit(1);

      if (!error && data && data.length > 0) {
        setShowLoginPopup(true);
      }
    } catch (error) {
      console.error('Error checking login popup messages:', error);
    }
  };

  const loadLatestMessage = async () => {
    try {
      const { data, error } = await supabase
        .from('message_recipients')
        .select(`
          id,
          messages!inner (
            title,
            content,
            priority
          )
        `)
        .eq('recipient_id', employee.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        setLatestMessage({
          title: data.messages.title,
          content: data.messages.content,
          priority: data.messages.priority,
        });
        setShowMessageToast(true);

        setTimeout(() => {
          setShowMessageToast(false);
        }, 10000);
      }
    } catch (error) {
      console.error('Error loading latest message:', error);
    }
  };

  return (
    <div className={`min-h-screen relative nav-root-padding employee-shell`} style={{ background: '#f8fafc' }}>
      {/* Fixed Background Layer */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-blue-50/60"></div>
        {!isMobile && !isTablet && (
          <>
            <div className="absolute top-0 right-0 w-[50%] h-[50%] bg-gradient-to-bl from-blue-50/50 via-transparent to-transparent"></div>
            <div className="absolute bottom-0 left-0 w-[40%] h-[40%] bg-gradient-to-tr from-slate-100/60 via-transparent to-transparent"></div>
            <div className="absolute top-[20%] right-[15%] w-[500px] h-[500px] bg-blue-50/40 rounded-full blur-[150px]"></div>
            <div className="absolute bottom-[20%] left-[10%] w-[400px] h-[400px] bg-sky-50/30 rounded-full blur-[130px]"></div>

            {/* Decorative color blocks - desktop */}
            <div className="absolute top-[12%] left-[5%] w-24 h-24 bg-gradient-to-br from-blue-100/60 to-cyan-100/40 rounded-2xl rotate-12 opacity-60"></div>
            <div className="absolute top-[8%] right-[8%] w-16 h-16 bg-gradient-to-br from-sky-100/70 to-blue-100/50 rounded-xl -rotate-6 opacity-50"></div>
            <div className="absolute top-[35%] right-[5%] w-20 h-20 bg-gradient-to-br from-cyan-100/50 to-teal-100/30 rounded-2xl rotate-45 opacity-40"></div>
            <div className="absolute bottom-[30%] left-[3%] w-14 h-14 bg-gradient-to-br from-blue-100/60 to-sky-100/40 rounded-lg rotate-12 opacity-50"></div>
            <div className="absolute bottom-[15%] right-[12%] w-28 h-28 bg-gradient-to-br from-sky-50/80 to-cyan-50/60 rounded-3xl -rotate-12 opacity-40"></div>
            <div className="absolute top-[55%] left-[8%] w-10 h-10 bg-gradient-to-br from-teal-100/50 to-cyan-100/30 rounded-lg rotate-45 opacity-60"></div>
            <div className="absolute bottom-[40%] right-[20%] w-12 h-12 bg-gradient-to-br from-blue-100/40 to-sky-100/30 rounded-xl rotate-6 opacity-45"></div>

            {/* Geometric line patterns */}
            <svg className="absolute inset-0 w-full h-full opacity-[0.025]" xmlns="http://www.w3.org/2000/svg">
              <pattern id="bg-dots-desktop" x="0" y="0" width="48" height="48" patternUnits="userSpaceOnUse">
                <circle cx="24" cy="24" r="1.5" fill="#3b82f6" />
              </pattern>
              <rect width="100%" height="100%" fill="url(#bg-dots-desktop)" />
            </svg>

            {/* Decorative border lines */}
            <div className="absolute top-[25%] left-0 right-0 h-px opacity-[0.04]" style={{ background: 'linear-gradient(90deg, transparent, #3b82f6 30%, #06b6d4 70%, transparent)' }}></div>
            <div className="absolute top-[65%] left-0 right-0 h-px opacity-[0.03]" style={{ background: 'linear-gradient(90deg, transparent, #0ea5e9 20%, #3b82f6 80%, transparent)' }}></div>
          </>
        )}
        {(isMobile || isTablet) && (
          <>
            <div className="absolute top-0 right-0 w-[60%] h-[30%] bg-gradient-to-bl from-blue-50/40 via-transparent to-transparent"></div>
            <div className="absolute bottom-[10%] left-0 w-[50%] h-[30%] bg-gradient-to-tr from-slate-50/60 via-transparent to-transparent"></div>

            {/* Decorative color blocks - mobile/tablet */}
            <div className="absolute top-[15%] right-[5%] w-14 h-14 bg-gradient-to-br from-blue-100/50 to-sky-100/30 rounded-xl rotate-12 opacity-50"></div>
            <div className="absolute top-[40%] left-[3%] w-10 h-10 bg-gradient-to-br from-cyan-100/40 to-teal-100/20 rounded-lg -rotate-6 opacity-45"></div>
            <div className="absolute bottom-[25%] right-[8%] w-16 h-16 bg-gradient-to-br from-sky-100/50 to-blue-100/30 rounded-2xl rotate-45 opacity-35"></div>
            <div className="absolute bottom-[45%] left-[6%] w-8 h-8 bg-gradient-to-br from-blue-100/40 to-cyan-100/20 rounded-md rotate-12 opacity-40"></div>

            {/* Subtle dot pattern - mobile */}
            <svg className="absolute inset-0 w-full h-full opacity-[0.02]" xmlns="http://www.w3.org/2000/svg">
              <pattern id="bg-dots-mobile" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
                <circle cx="20" cy="20" r="1" fill="#3b82f6" />
              </pattern>
              <rect width="100%" height="100%" fill="url(#bg-dots-mobile)" />
            </svg>
          </>
        )}
        {/* Subtle grid - hidden on mobile for performance */}
        {!isMobile && (
          <div className="absolute inset-0 opacity-[0.02]" style={{
            backgroundImage: `
              linear-gradient(to right, #94a3b8 1px, transparent 1px),
              linear-gradient(to bottom, #94a3b8 1px, transparent 1px)
            `,
            backgroundSize: '60px 60px'
          }} />
        )}
      </div>

      {createPortal(
        <header
          className={`employee-header transition-transform duration-300 ${showWithdrawalHistory && isMobile ? '-translate-y-full' : 'translate-y-0'}`}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            paddingTop: 'env(safe-area-inset-top)',
            background: isMobile
              ? 'linear-gradient(135deg, #1e40af 0%, #2563eb 50%, #3b82f6 100%)'
              : 'linear-gradient(135deg, #1e40af 0%, #2563eb 40%, #3b82f6 80%, #2563eb 100%)',
            boxShadow: '0 4px 20px -2px rgba(37, 99, 235, 0.25), 0 1px 3px rgba(0, 0, 0, 0.08)',
          }}
        >
          <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.1) 0%, transparent 50%, rgba(0,0,0,0.05) 100%)'
          }}>
            {/* Geometric decorative blocks in header */}
            <div className="absolute top-2 right-[15%] w-8 h-8 border-2 border-white/[0.08] rounded-lg rotate-12"></div>
            <div className="absolute top-1 right-[30%] w-5 h-5 border-2 border-white/[0.06] rounded-md -rotate-6"></div>
            <div className="absolute bottom-1 left-[20%] w-6 h-6 border-2 border-cyan-200/[0.08] rounded-lg rotate-45"></div>
            <div className="absolute top-3 left-[40%] w-4 h-4 bg-white/[0.04] rounded-full"></div>
            <div className="absolute bottom-2 right-[45%] w-3 h-3 bg-cyan-200/[0.06] rounded-full"></div>
            <div className="absolute top-1/2 left-[60%] w-10 h-10 border border-white/[0.05] rounded-xl rotate-12 -translate-y-1/2"></div>
            {/* Accent line */}
            <div className="absolute top-0 left-[10%] right-[10%] h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-200/20 to-transparent"></div>
          <div className={`max-w-7xl mx-auto relative ${isMobile ? 'px-2 xs:px-3 py-2' : isTablet ? 'px-5 py-3' : 'px-8 py-3.5'}`}>
            <div className="flex justify-between items-center gap-2">
              <div className="flex-1 min-w-0 flex items-center gap-2">
                <div className={`${isMobile ? 'w-8 h-8 rounded-lg' : isTablet ? 'w-9 h-9 rounded-xl' : 'w-10 h-10 rounded-xl'} bg-white/95 flex items-center justify-center shadow-sm flex-shrink-0`}>
                  <Zap className={`${isMobile ? 'w-4 h-4' : isTablet ? 'w-[18px] h-[18px]' : 'w-5 h-5'} text-blue-600`} fill="currentColor" />
                </div>
                <div className="flex-1 min-w-0" style={{ maxWidth: isMobile ? 'calc(100vw - 140px)' : undefined }}>
                  <h1 className={`${isMobile ? 'text-[15px]' : isTablet ? 'text-lg' : 'text-2xl'} font-bold text-white truncate tracking-tight leading-tight`}>
                    {companyName}
                  </h1>
                  <div className="flex items-center gap-1.5 mt-px">
                    <div className="w-1.5 h-1.5 bg-emerald-300 rounded-full animate-pulse flex-shrink-0"></div>
                    <span className={`${isMobile ? 'text-[11px]' : 'text-xs'} text-blue-100/90 font-medium truncate`}>{employee.username}</span>
                  </div>
                </div>
              </div>
              <div className={`flex items-center ${isMobile ? 'gap-1.5' : isTablet ? 'gap-2' : 'gap-3'}`}>
                {/* Message Center Button */}
                <div className="relative">
                  <button
                    onClick={() => {
                      setShowMessageCenter(true);
                      setHasNewMessage(false);
                      setShowMessageToast(false);
                    }}
                    className={`relative rounded-lg transition-all duration-200 group ${
                      unreadMessageCount > 0
                        ? 'bg-amber-400/20 hover:bg-amber-400/30'
                        : 'bg-white/10 hover:bg-white/20'
                    }`}
                    style={{
                      width: isMobile ? '34px' : '36px',
                      height: isMobile ? '34px' : '36px',
                      padding: '0',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      position: 'relative',
                      border: unreadMessageCount > 0 ? '1px solid rgba(251, 191, 36, 0.4)' : '1px solid rgba(255,255,255,0.2)'
                    }}
                  >
                  {/* Bell icon with breathing pulse when unread */}
                  <div className={`z-10 relative ${unreadMessageCount > 0 ? 'animate-bell-pulse keep-animation' : ''}`}>
                    <Bell
                      className={`w-[18px] h-[18px] sm:w-5 sm:h-5 flex-shrink-0 keep-animation ${
                        unreadMessageCount > 0 ? 'animate-bell-ring text-amber-300' : 'text-white'
                      }`}
                      strokeWidth={2.2}
                      fill={unreadMessageCount > 0 ? 'currentColor' : 'none'}
                    />
                  </div>

                  {/* Unread count badge */}
                  {unreadMessageCount > 0 && (
                    <div
                      className={`absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center border-2 border-white z-20 keep-animation ${hasNewMessage ? 'animate-badge-bounce' : ''}`}
                      style={{ willChange: hasNewMessage ? 'transform' : 'auto' }}
                    >
                      {unreadMessageCount > 99 ? '99+' : unreadMessageCount}
                    </div>
                  )}
                  </button>

                  {/* New Message Toast Popup - Mobile Optimized */}
                  {showMessageToast && latestMessage && (
                    <div className="absolute top-full right-0 mt-2 w-[min(calc(100vw-2rem),320px)] z-50 animate-slide-in-down" style={{ maxWidth: 'min(calc(100vw - 2rem), 320px)' }}>
                      {/* Arrow */}
                      <div className="absolute -top-[6px] right-3 w-3 h-3 transform rotate-45 bg-emerald-600 border border-emerald-400/30 border-b-0 border-r-0"></div>

                      <div className="relative rounded-2xl overflow-hidden shadow-2xl ring-1 ring-emerald-400/40 border border-emerald-500/20" style={{ background: 'linear-gradient(135deg, #059669 0%, #0d9488 50%, #0891b2 100%)', WebkitTextSizeAdjust: '100%' }}>
                        {/* Decorative patterns - hidden on very narrow screens */}
                        <div className="hidden sm:block absolute top-0 right-0 w-20 h-20 rounded-full bg-teal-300 opacity-15 -translate-y-8 translate-x-6"></div>
                        <div className="hidden sm:block absolute bottom-0 left-0 w-14 h-14 rounded-full bg-emerald-300 opacity-10 translate-y-5 -translate-x-5"></div>
                        <div className="hidden sm:block absolute top-1/2 right-8 w-6 h-6 rotate-45 bg-white opacity-[0.07]"></div>
                        <div className="hidden sm:block absolute bottom-6 right-16 w-4 h-4 rounded-full bg-cyan-200 opacity-15"></div>

                        {/* Top accent line */}
                        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, transparent, #6ee7b7, #a7f3d0, #6ee7b7, transparent)' }} />

                        {/* Content */}
                        <div
                          onClick={() => { setShowMessageToast(false); setShowMessageCenter(true); }}
                          className="relative px-3 sm:px-4 pt-3 sm:pt-3.5 pb-3 sm:pb-3.5 cursor-pointer touch-manipulation"
                          style={{ WebkitTapHighlightColor: 'transparent' }}
                        >
                          {/* Header row */}
                          <div className="flex items-center gap-2 sm:gap-2.5 mb-2 sm:mb-2.5">
                            <div className="relative flex-shrink-0">
                              <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-white/15 border border-white/20 ring-1 ring-white/10 shadow-inner">
                                <Bell className="w-4.5 h-4.5 text-white" strokeWidth={2.2} />
                              </div>
                              <div className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center bg-white shadow-md">
                                <span className="text-[7px] font-black leading-none text-emerald-600">1</span>
                              </div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="text-[9px] font-bold uppercase tracking-[0.12em] block mb-0.5 text-emerald-200">{t.header.newMessage}</span>
                              <h3 className="font-bold text-[13px] leading-tight truncate text-white">
                                {latestMessage.title}
                              </h3>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); setShowMessageToast(false); }}
                              className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 active:scale-90 transition-all"
                              style={{ WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation', minWidth: '32px', minHeight: '32px' }}
                            >
                              <X className="w-3.5 h-3.5 text-white/80" strokeWidth={2.5} />
                            </button>
                          </div>

                          {/* Body */}
                          <div className="ml-[44px] sm:ml-[46px] p-2 sm:p-2.5 rounded-lg bg-white/10 border border-white/10 backdrop-blur-sm mb-2.5 sm:mb-3">
                            <p className="text-[12px] line-clamp-2 leading-[1.5] text-white/85">
                              {latestMessage.content.replace(/<[^>]*>/g, '').slice(0, 80)}
                            </p>
                          </div>

                          {/* Footer */}
                          <div className="flex items-center justify-between ml-[44px] sm:ml-[46px]">
                            <span className="text-[10px] font-medium text-white/50 truncate mr-2">
                              {latestMessage.priority === 'urgent' ? t.header.urgent :
                               latestMessage.priority === 'high' ? t.header.highPriority : t.header.normal}
                            </span>
                            <div className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all active:scale-95 hover:scale-105 bg-white text-emerald-700 shadow-md">
                              <span className="text-[10px] font-bold">{t.header.view}</span>
                              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                            </div>
                          </div>
                        </div>

                        {/* Progress bar */}
                        <div className="h-[2px] bg-black/10">
                          <div className="h-full animate-shrink-width" style={{ background: 'linear-gradient(90deg, #6ee7b7, #a7f3d0, #ffffff)' }} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Desktop: Language Switcher, Change Password & Logout Buttons */}
                {!isMobile && !isTablet && (
                <div className="flex items-center gap-2">
                  <LanguageSwitcher variant="desktop" />

                  <button
                    onClick={() => setShowPasswordChange(true)}
                    className="px-3.5 py-2 rounded-lg bg-white/15 hover:bg-white/25 active:bg-white/30 text-white transition-all border border-white/20"
                  >
                    <div className="flex items-center gap-2">
                      <Lock className="w-3.5 h-3.5" strokeWidth={2.5} />
                      <span className="text-xs font-medium">{t.header.password}</span>
                    </div>
                  </button>

                  <button
                    onClick={logout}
                    className="px-3.5 py-2 rounded-lg bg-white/15 hover:bg-red-500/80 active:bg-red-600/80 text-white transition-all border border-white/20 hover:border-red-400/50"
                  >
                    <div className="flex items-center gap-2">
                      <LogOut className="w-3.5 h-3.5" strokeWidth={2.5} />
                      <span className="text-xs font-medium">{t.header.logout}</span>
                    </div>
                  </button>
                </div>
                )}

                {/* Mobile & Tablet: User Menu Dropdown */}
                {(isMobile || isTablet) && (
                <div className="relative" ref={userMenuRef}>
                  <button
                    onClick={() => setShowUserMenu(!showUserMenu)}
                    className="relative rounded-lg bg-white/10 hover:bg-white/20 active:bg-white/30 transition-colors group"
                    style={{
                      minWidth: isMobile ? '44px' : '50px',
                      height: isMobile ? '34px' : '36px',
                      padding: '0 8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      position: 'relative',
                      border: '1px solid rgba(255,255,255,0.2)'
                    }}
                  >
                    <div className="flex items-center gap-1 sm:gap-1.5 relative z-10">
                      <User className="w-[18px] h-[18px] sm:w-5 sm:h-5 flex-shrink-0 text-white" strokeWidth={2.2} />
                      <ChevronDown className={`w-3 h-3 sm:w-3.5 sm:h-3.5 flex-shrink-0 text-white/70 transition-transform duration-200 ${showUserMenu ? 'rotate-180' : ''}`} />
                    </div>
                  </button>

                  {/* Dropdown Menu */}
                  {showUserMenu && (
                    <div className="absolute top-full right-0 mt-3 w-64 z-50 animate-[menuAppear_0.15s_ease-out]">
                      <div className="relative bg-white rounded-2xl shadow-2xl shadow-slate-900/20 border border-slate-300 ring-1 ring-slate-200/50 overflow-hidden">
                        {/* User Info Header */}
                        <div className="relative px-5 py-4 bg-gradient-to-br from-blue-600 via-blue-700 to-blue-800 overflow-hidden">
                          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(255,255,255,0.1)_0%,_transparent_60%)]" />
                          <div className="relative flex items-center gap-3">
                            <div className="w-10 h-10 bg-white/15 rounded-xl flex items-center justify-center backdrop-blur-sm border border-white/20">
                              <User className="w-5 h-5 text-white" />
                            </div>
                            <div>
                              <span className="text-sm font-bold text-white block">{employee.username}</span>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <div className="w-1.5 h-1.5 bg-green-400 rounded-full shadow-sm shadow-green-400/50" />
                                <span className="text-xs text-blue-100">{t.header.online}</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Menu Items */}
                        <div className="relative p-2">
                          <LanguageSwitcher variant="mobile" onOpenModal={() => {
                            setShowUserMenu(false);
                            setShowLanguageModal(true);
                          }} />

                          <button
                            onClick={() => {
                              setShowUserMenu(false);
                              setShowPasswordChange(true);
                            }}
                            className="w-full px-4 py-3 flex items-center gap-3 rounded-xl hover:bg-blue-50 transition-all duration-200 group"
                          >
                            <div className="w-8 h-8 bg-blue-50 group-hover:bg-blue-100 rounded-lg flex items-center justify-center transition-colors">
                              <Lock className="w-4 h-4 text-blue-600" />
                            </div>
                            <span className="text-sm font-medium text-slate-700 group-hover:text-slate-900 transition-colors">{t.header.changePassword}</span>
                          </button>

                          <button
                            onClick={() => {
                              setShowUserMenu(false);
                              logout();
                            }}
                            className="w-full px-4 py-3 flex items-center gap-3 rounded-xl hover:bg-red-50 transition-all duration-200 group"
                          >
                            <div className="w-8 h-8 bg-slate-50 group-hover:bg-red-100 rounded-lg flex items-center justify-center transition-colors">
                              <LogOut className="w-4 h-4 text-slate-400 group-hover:text-red-500 transition-colors" />
                            </div>
                            <span className="text-sm font-medium text-slate-700 group-hover:text-red-600 transition-colors">{t.header.logout}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                )}
              </div>
            </div>
          </div>
        </header>,
        document.body
      )}

      <div className="nav-content-pt relative">
        <div className={`max-w-7xl mx-auto ${isMobile ? 'px-3 py-0 pb-2' : isTablet ? 'px-5 py-4 pb-4' : 'px-8 py-6 pb-6'}`}>
          {/* Navigation Tabs - Desktop: controlled by raw CSS media query */}
          <div className="nav-desktop relative mb-8">
            <div className="relative bg-white rounded-2xl p-1.5 shadow-sm border border-slate-200/80">
              <div className="flex">
                {tabs.map((tab, index) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  const isDispatchTab = tab.id === 'dispatch';
                  const showNewOrderEffect = isDispatchTab && hasNewOrder;
                  const showTimeoutEffect = isDispatchTab && hasOrderTimeout;
                  const isLast = index === tabs.length - 1;

                  return (
                    <div key={tab.id} className="flex-1 flex items-center min-w-0">
                      <button
                        onClick={() => setActiveTab(tab.id)}
                        className={`group relative w-full flex items-center justify-center gap-2 px-3 lg:px-6 py-3 rounded-xl font-semibold transition-all duration-200 overflow-hidden ${
                          isActive
                            ? 'text-white'
                            : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {/* New Order Effect */}
                        {showNewOrderEffect && (
                          <>
                            <div className="absolute inset-0 bg-gradient-to-r from-amber-500 to-orange-500 rounded-xl animate-pulse"></div>
                            <div className="absolute inset-0">
                              {[...Array(8)].map((_, i) => (
                                <div
                                  key={i}
                                  className="absolute w-2 h-2 bg-white rounded-full"
                                  style={{
                                    left: `${(i * 12.5)}%`,
                                    animation: `bubble-float ${2 + i * 0.2}s ease-in-out ${i * 0.3}s infinite`
                                  }}
                                />
                              ))}
                            </div>
                          </>
                        )}

                        {/* Timeout Effect */}
                        {showTimeoutEffect && !showNewOrderEffect && (
                          <>
                            <div className="absolute inset-0 bg-gradient-to-r from-rose-600 to-red-600 rounded-xl animate-pulse-urgent"></div>
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer-urgent"></div>
                          </>
                        )}

                        {/* Active background - blue gradient */}
                        {isActive && !showNewOrderEffect && !showTimeoutEffect && (
                          <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-blue-500 rounded-xl shadow-md shadow-blue-500/20"></div>
                        )}

                        {/* Icon */}
                        <div className="relative z-10">
                          <Icon className="w-[18px] h-[18px]" />
                        </div>

                        {/* Label */}
                        <span className="relative z-10 text-sm truncate">
                          {tab.label}
                        </span>
                      </button>
                      {/* Divider line */}
                      {!isLast && !isActive && (
                        <div className="w-px h-5 bg-slate-200 flex-shrink-0"></div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div></div>}>
          <div className="space-y-3 sm:space-y-6">
            <div style={{ display: activeTab === 'announcements' ? 'block' : 'none' }}>
              {loadedTabs.has('announcements') ? (
                <AnnouncementBoard userId={employee.id} />
              ) : isTransitioning ? (
                <div className="flex items-center justify-center py-20">
                  <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : null}
            </div>
            <div style={{ display: activeTab === 'dispatch' ? 'block' : 'none' }} className="pb-8">
              {loadedTabs.has('dispatch') ? (
                <OrderDispatch employee={employee} onStatusChange={handleOrderStatusChange} onNavigateToOrders={() => {
                  setActiveTab('orders');
                  setLoadedTabs(prev => new Set([...prev, 'orders']));
                }} />
              ) : isTransitioning ? (
                <div className="flex items-center justify-center py-20">
                  <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : null}
            </div>
            <div className="space-y-4 sm:space-y-6 pb-8" style={{ display: activeTab === 'orders' ? 'block' : 'none' }}>
              {loadedTabs.has('orders') ? (
                <>
                  <OrderSubmission employeeId={employee.id} adminId={employee.created_by} onNavigateToDispatch={() => {
                    setActiveTab('dispatch');
                    setLoadedTabs(prev => new Set([...prev, 'dispatch']));
                  }} />
                  <OrderList employeeId={employee.id} />
                </>
              ) : isTransitioning ? (
                <div className="flex items-center justify-center py-20">
                  <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : null}
            </div>
            <div className="pb-8" style={{ display: activeTab === 'wallet' ? 'block' : 'none' }}>
              {loadedTabs.has('wallet') ? (
                <WalletOverview
                  employeeId={employee.id}
                  employee={employee}
                  onWithdrawalHistoryChange={setShowWithdrawalHistory}
                />
              ) : isTransitioning ? (
                <div className="flex items-center justify-center py-20">
                  <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : null}
            </div>
            <div className="pb-8" style={{ display: activeTab === 'statistics' ? 'block' : 'none' }}>
              {loadedTabs.has('statistics') ? (
                <DailyStatistics employeeId={employee.id} />
              ) : isTransitioning ? (
                <div className="flex items-center justify-center py-20">
                  <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : null}
            </div>
          </div>
          </Suspense>
        </div>

        </div>

      {/* Bottom Navigation - portaled to document.body */}
      {createPortal(
      <nav className="nav-mobile safe-area-pb employee-nav" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9998 }}>
        <div className="absolute inset-0 bg-white border-t border-slate-200/60"
          style={{ boxShadow: '0 -1px 12px rgba(0,0,0,0.04)' }}
        ></div>

        {/* Navigation Items */}
        <div className={`relative flex px-2 sm:px-4 pt-2 sm:pt-2.5 pb-1.5 sm:pb-2`}>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            const isDispatchTab = tab.id === 'dispatch';
            const showNewOrderEffect = isDispatchTab && hasNewOrder;
            const showTimeoutEffect = isDispatchTab && hasOrderTimeout;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="relative flex-1 flex flex-col items-center justify-center py-1 transition-all duration-200 active:scale-95"
                style={{ WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation', minWidth: '44px' }}
              >
                {/* Active pill background */}
                {isActive && !showNewOrderEffect && !showTimeoutEffect && (
                  <div className="absolute inset-x-2 inset-y-0.5 bg-blue-50/80 rounded-xl transition-all duration-300"></div>
                )}

                {/* Special Effect Backgrounds */}
                {showNewOrderEffect && (
                  <div className="absolute inset-x-2 inset-y-0.5 bg-gradient-to-b from-amber-50 to-amber-100/80 rounded-xl border border-amber-200/40 animate-pulse"></div>
                )}
                {showTimeoutEffect && !showNewOrderEffect && (
                  <div className="absolute inset-x-2 inset-y-0.5 bg-gradient-to-b from-red-50 to-red-100/80 rounded-xl border border-red-200/40 animate-pulse"></div>
                )}

                {/* Icon */}
                <div className="relative z-10 mb-0.5">
                  <Icon className={`w-5 h-5 transition-all duration-200 ${
                    isActive
                      ? 'text-blue-600'
                      : showNewOrderEffect
                        ? 'text-amber-600'
                        : showTimeoutEffect
                          ? 'text-red-600'
                          : 'text-slate-400'
                  }`} strokeWidth={isActive ? 2.3 : 1.7} fill={isActive ? 'currentColor' : 'none'} style={{ opacity: isActive ? 1 : 0.85 }} />

                  {isDispatchTab && (hasNewOrder || hasOrderTimeout) && (
                    <div className={`absolute -top-0.5 -right-1 w-2 h-2 rounded-full animate-pulse ring-2 ring-white ${
                      hasOrderTimeout ? 'bg-red-500' : 'bg-amber-500'
                    }`} />
                  )}
                </div>

                {/* Label */}
                <span className={`relative z-10 text-[10px] xs:text-[11px] text-center leading-tight tracking-tight ${
                  isActive
                    ? 'text-blue-600 font-bold'
                    : showNewOrderEffect
                      ? 'text-amber-600 font-medium'
                      : showTimeoutEffect
                        ? 'text-red-600 font-medium'
                        : 'text-slate-400 font-medium'
                }`}>
                  {isMobile ? tab.mobileLabel : tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>,
      document.body
      )}

      {/* Password Change Modal */}
      {showPasswordChange && (
        <PasswordChange
          employeeId={employee.id}
          onClose={() => setShowPasswordChange(false)}
          onLogout={logout}
        />
      )}

      {/* Language Selection Modal */}
      {showLanguageModal && (
        <LanguageModal
          currentLanguage={language}
          onConfirm={(code: Language) => {
            setLanguage(code);
            setShowLanguageModal(false);
          }}
          onClose={() => setShowLanguageModal(false)}
          t={t}
        />
      )}

      <style>{`
        /* CRITICAL: Navigation visibility - raw CSS, no Tailwind dependency */
        .nav-desktop { display: none; }
        .nav-mobile { display: block; }
        .nav-root-padding { padding-bottom: calc(72px + env(safe-area-inset-bottom, 0px)); }
        .nav-content-pt { padding-top: 56px; }

        /* Force fixed positioning for header and nav - cannot be overridden */
        .employee-header {
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          z-index: 9999 !important;
        }
        .employee-nav {
          position: fixed !important;
          bottom: 0 !important;
          left: 0 !important;
          right: 0 !important;
          z-index: 9998 !important;
        }

        /* Tablet/mobile: use dvh-based layout to prevent address bar jitter */
        @supports (height: 100dvh) {
          .employee-shell {
            min-height: 100dvh;
          }
        }

        /* Ensure fixed nav stays in its own compositing layer on iOS */
        .employee-nav {
          -webkit-transform: translate3d(0,0,0);
          transform: translate3d(0,0,0);
        }

        @media (min-width: 600px) {
          .nav-content-pt { padding-top: 64px; }
        }

        @media (min-width: 1025px) {
          .nav-desktop { display: block !important; }
          .nav-mobile { display: none !important; }
          .nav-root-padding { padding-bottom: 0; }
          .nav-content-pt { padding-top: 72px; }
        }

        @keyframes shimmer-slide {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(200%);
          }
        }

        .animate-shimmer-slide {
          animation: shimmer-slide 3s ease-in-out infinite;
        }

        @keyframes float-horizontal {
          0% {
            transform: translateX(-20px);
            opacity: 0;
          }
          10% {
            opacity: 1;
          }
          90% {
            opacity: 1;
          }
          100% {
            transform: translateX(calc(100vw + 20px));
            opacity: 0;
          }
        }

        @keyframes pulse-glow {
          0%, 100% {
            opacity: 0.3;
          }
          50% {
            opacity: 0.8;
          }
        }

        .animate-pulse-glow {
          animation: pulse-glow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }

        @keyframes border-flow {
          0%, 100% {
            opacity: 0.5;
          }
          50% {
            opacity: 1;
          }
        }

        .animate-border-flow {
          animation: border-flow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }

        @keyframes float {
          0%, 100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-3px);
          }
        }

        .animate-float {
          animation: float 3s ease-in-out infinite;
        }

        .animate-pulse-slow {
          animation: pulse-slow 3s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }

        @keyframes pulse-slow {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.7;
          }
        }

        .delay-150 {
          animation-delay: 150ms;
        }

        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }

        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }

        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }

        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }

        @keyframes slideInDown {
          from {
            transform: translateY(-10px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }

        @keyframes shrinkWidth {
          from {
            width: 100%;
          }
          to {
            width: 0%;
          }
        }

        .animate-slide-in-down {
          animation: slideInDown 0.4s ease-out;
        }

        .animate-shrink-width {
          animation: shrinkWidth 10s linear;
        }

      `}</style>

      {/* Message Center */}
      {showMessageCenter && (
        <MessageCenter
          employee={employee}
          onClose={() => {
            setShowMessageCenter(false);
            loadUnreadCount();
          }}
        />
      )}

      {/* Login Popup Messages */}
      {showLoginPopup && (
        <LoginPopupMessages
          employee={employee}
          onClose={() => {
            setShowLoginPopup(false);
            loadUnreadCount();
          }}
        />
      )}

      {/* Customer Service Chat Widget */}
      <CustomerServiceChat employeeId={employee.id} />

      {/* Session Expired Modal */}
      <SessionExpiredModal
        isOpen={showSessionExpired}
        onClose={handleSessionExpiredClose}
      />
    </div>
  );
}
