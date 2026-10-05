import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { AUTH_STORAGE_KEY, getStoredAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { getTodayStartUTC } from '../../lib/dateUtils';
import { Play, Square, CheckCircle, XCircle, Clock, Package, TrendingUp, AlertTriangle, AlertCircle, Zap, Timer, FileText, ShieldAlert, CheckSquare, ChevronLeft, ChevronRight, Send } from 'lucide-react';
import { useDeviceOptimization } from '../../lib/useDeviceOptimization';
import { useResponsive } from '../../lib/useResponsive';
import { useLanguage } from '../../lib/i18n/context';
import type { Employee } from '../../types';

interface DispatchAssignment {
  id: string;
  dispatch_order_id: string | null;
  status: string;
  assigned_at: string;
  accepted_at?: string | null;
  completed_at?: string | null;
  remarks?: string | null;
  assignment_id?: string | null;
  order_submitted?: boolean;
  dispatch_session_id?: string | null;
  accept_deadline_at?: string | null;
  session_timeout_minutes?: number | null;
  session_timeout_minutes_snapshot?: number | null;
  order_content_snapshot?: string | null;
  dispatch_orders: {
    id?: string;
    order_content: string;
  };
}

interface WorkSession {
  isWorking: boolean;
  sessionId: string | null;
  startedAt: Date | null;
}

interface DispatchConfig {
  session_timeout_minutes: number;
}

interface DispatchSelection {
  sessionId: string;
  groupId: string;
  poolId: string;
  dueAt: number;
}

type RecoveryOutcome =
  | { state: 'active'; assignment: DispatchAssignment }
  | { state: 'idle' | 'ended' | 'stale' };

const PAUSED_DISPATCH_CHECK_MS = 5 * 60 * 1000;

function getOrderDispatchErrorMessage(error: unknown) {
  return error instanceof Error ? error.message :
    error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Unknown error occurred';
}

interface OrderDispatchProps {
  employee: Employee;
  onStatusChange?: (hasNewOrder: boolean, hasTimeout: boolean) => void;
  onNavigateToOrders?: () => void;
}

interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  duration?: number; // 0 = 不自动关闭
}

function generateAssignmentId(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const all = letters + digits;
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  let id = 'ASN-';
  for (let i = 0; i < 8; i++) id += all[arr[i] % all.length];
  // Guarantee at least one letter and one digit
  const hasLetter = [...id.slice(4)].some(c => letters.includes(c));
  const hasDigit = [...id.slice(4)].some(c => digits.includes(c));
  if (!hasLetter) { const pos = arr[0] % 8; id = id.slice(0, 4 + pos) + letters[arr[1] % letters.length] + id.slice(5 + pos); }
  if (!hasDigit) { const pos = arr[2] % 8; id = id.slice(0, 4 + pos) + digits[arr[3] % digits.length] + id.slice(5 + pos); }
  return id;
}

export default function OrderDispatch({ employee, onStatusChange, onNavigateToOrders }: OrderDispatchProps) {
  const [session, setSession] = useState<WorkSession>({
    isWorking: false,
    sessionId: null,
    startedAt: null,
  });
  const [currentOrder, setCurrentOrder] = useState<DispatchAssignment | null>(null);
  const [todayOrders, setTodayOrders] = useState<DispatchAssignment[]>([]);
  const [recordsPage, setRecordsPage] = useState(0);
  const RECORDS_PER_PAGE = 7;
  const [stats, setStats] = useState({
    total: 0,
    completed: 0,
    error: 0,
    timeout: 0,
  });
  const [todaySubmittedOrders, setTodaySubmittedOrders] = useState(0);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorReason, setErrorReason] = useState('');
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [config, setConfig] = useState<DispatchConfig>({ session_timeout_minutes: 10 });
  const [nextOrderTime, setNextOrderTime] = useState<Date | null>(null);
  const [showOrderDetail, setShowOrderDetail] = useState(false);
  const [hasTimeout, setHasTimeout] = useState(false);
  const [hasFiveMinuteWarning, setHasFiveMinuteWarning] = useState(false);
  const [showTimeoutAlert, setShowTimeoutAlert] = useState(false);
  const [, setTotalWorkTime] = useState(0);
  const [, setUnacceptedCount] = useState(0);
  const [showAutoStopModal, setShowAutoStopModal] = useState(false);
  const [showTimeoutStopModal, setShowTimeoutStopModal] = useState(false);
  const [selectedOrderDetail, setSelectedOrderDetail] = useState<DispatchAssignment | null>(null);
  const [showOrderDetailModal, setShowOrderDetailModal] = useState(false);
  const [showGrabFailedModal, setShowGrabFailedModal] = useState(false);
  const [showGrabSuccessAnimation, setShowGrabSuccessAnimation] = useState(false);
  const [acceptPhase, setAcceptPhase] = useState<'idle' | 'fade-out' | 'fade-in'>('idle');
  const prevOrderStatusRef = useRef<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionType, setTransitionType] = useState<'start' | 'end' | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [dispatchPause, setDispatchPause] = useState<{ type: 'unavailable' | 'error'; message: string } | null>(null);
  const [timeoutStopMinutes, setTimeoutStopMinutes] = useState(10);
  // Debounce states for preventing duplicate requests
  const [isAccepting, setIsAccepting] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [showOrderNotSubmittedModal, setShowOrderNotSubmittedModal] = useState(false);

  // Lock body scroll when Order Not Submitted modal is open
  useEffect(() => {
    if (showOrderNotSubmittedModal) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [showOrderNotSubmittedModal]);

  // Smooth phase transition when order moves from pending -> accepted
  useEffect(() => {
    const prevStatus = prevOrderStatusRef.current;
    const curStatus = currentOrder?.status ?? null;
    prevOrderStatusRef.current = curStatus;
    if (prevStatus === 'pending' && curStatus === 'accepted') {
      setAcceptPhase('fade-out');
      const t1 = setTimeout(() => setAcceptPhase('fade-in'), 350);
      const t2 = setTimeout(() => setAcceptPhase('idle'), 850);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [currentOrder?.status]);
  const [isReporting, setIsReporting] = useState(false);
  const [isStartButtonPressed, setIsStartButtonPressed] = useState(false);
  const [showStartRipple, setShowStartRipple] = useState(false);
  const [showStartSuccess, setShowStartSuccess] = useState(false);
  const [showStopSuccess, setShowStopSuccess] = useState(false);
  const [, setIsPageVisible] = useState(true);
  const [suppressAnimations, setSuppressAnimations] = useState(false);

  // Device optimization hooks
  const { isLowEnd, tier } = useDeviceOptimization();
  const { isMobile, isTablet } = useResponsive();
  const { t, dateLocale } = useLanguage();

  // Memoize performance settings based on device
  // Tablets (isTablet) should have full animations like desktop
  const performanceSettings = useMemo(() => ({
    enableAnimations: !isLowEnd && (!isMobile || isTablet || tier === 'high'),
    enableParticles: !isLowEnd && (!isMobile || isTablet),
    enableComplexGradients: !isLowEnd,
    reduceTransitions: isLowEnd || (isMobile && !isTablet),
    particleCount: isLowEnd ? 0 : (isMobile && !isTablet) ? 3 : 8,
    transitionDuration: isLowEnd ? 200 : (isMobile && !isTablet) ? 300 : 500,
  }), [isLowEnd, isMobile, isTablet, tier]);

  const dispatchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const modalContentRef = useRef<HTMLDivElement | null>(null);
  const activityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatTimerRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutCheckRef = useRef<NodeJS.Timeout | null>(null);
  const acceptTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const acceptDeadlineRef = useRef<{ orderId: string; arrivedAt: number } | null>(null);
  const processTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fiveMinuteWarningRef = useRef<NodeJS.Timeout | null>(null);
  const grabFailedTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastActivityRef = useRef<Date>(new Date());
  const pageHiddenAtRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sessionActiveRef = useRef<boolean>(false);
  const unacceptedCountRef = useRef<number>(0);
  const selectedDispatchRef = useRef<DispatchSelection | null>(null);
  const preparingDispatchRef = useRef<{ sessionId: string; generation: number } | null>(null);
  const assigningDispatchRef = useRef<{ sessionId: string; generation: number } | null>(null);
  const dispatchPausedRef = useRef(false);
  const configRef = useRef(config);
  configRef.current = config;
  const isMobileRef = useRef(isMobile);
  isMobileRef.current = isMobile;
  const startTimeoutCheckRef = useRef<(() => void) | null>(null);
  const processTimeoutInFlightRef = useRef(false);
  const startActivityMonitorRef = useRef<(() => void) | null>(null);
  const handleAcceptTimeoutRef = useRef<((assignmentId: string) => Promise<void>) | null>(null);
  const currentOrderRef = useRef<DispatchAssignment | null>(null);
  const startWorkLockRef = useRef<boolean>(false);
  const componentMountedRef = useRef(false);
  const lifecycleGenerationRef = useRef(0);
  const initialCleanupPromiseRef = useRef<Promise<void> | null>(null);
  const visibilityRestartPromiseRef = useRef<Promise<void> | null>(null);
  const restartSessionRef = useRef<(() => Promise<void>) | null>(null);
  const sendHeartbeatRef = useRef<(() => Promise<void>) | null>(null);
  const checkPendingOrderRef = useRef<(() => Promise<void>) | null>(null);
  const recoveryInFlightRef = useRef<Promise<RecoveryOutcome> | null>(null);
  const membershipRevisionRef = useRef(0);
  const membershipChangeDuringAssignmentRef = useRef(false);
  const membershipChangeHandlerRef = useRef<() => void>(() => {});

  // 通知系统
  const showNotification = (notification: Omit<Notification, 'id'>) => {
    const id = `notif-${Date.now()}-${Math.random()}`;
    const newNotif: Notification = { ...notification, id };

    setNotifications(prev => [...prev, newNotif]);

    // 自动关闭（如果设置了duration）
    if (notification.duration !== 0) {
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== id));
      }, notification.duration || 5000);
    }
  };

  const dismissNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  useEffect(() => {
    componentMountedRef.current = true;
    loadConfig();
    loadTodayOrders();
    loadTotalWorkTime();
    const previousInitialCheck = initialCleanupPromiseRef.current;
    const initialCheckPromise = (previousInitialCheck || Promise.resolve())
      .catch(error => {
        console.error('Previous pending-order check failed:', error);
      })
      .then(() => checkPendingOrderRef.current?.())
      .catch(error => {
        console.error('Initial pending-order check failed:', error);
      });
    initialCleanupPromiseRef.current = initialCheckPromise;
    void initialCheckPromise.finally(() => {
      if (initialCleanupPromiseRef.current === initialCheckPromise) {
        initialCleanupPromiseRef.current = null;
      }
    });

    // Refresh total work time every 60 seconds (cron handles stale cleanup globally)
    const workTimeInterval = setInterval(() => {
      loadTotalWorkTime();
    }, 60000);

    // Handle page close/refresh - stop work session
    const stopDispatchSessionWithBeacon = () => {
      const auth = getStoredAuth();
      const currentSessionId = sessionIdRef.current;
      if (!sessionActiveRef.current || !currentSessionId || auth?.userType !== 'employee') return;

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseKey) return;

      const payload = JSON.stringify({
        p_user_id: auth.user.id,
        p_session_token: auth.financialSessionToken,
        p_tab_id: auth.tabId,
        p_session_id: currentSessionId,
      });
      const blob = new Blob([payload], { type: 'application/json' });

      const queued = navigator.sendBeacon(
        `${supabaseUrl}/rest/v1/rpc/stop_employee_dispatch_session_secure?apikey=${supabaseKey}`,
        blob
      );
      if (!queued) {
        console.error('Failed to queue dispatch-session stop beacon.');
      }
    };

    const handleBeforeUnload = () => {
      stopDispatchSessionWithBeacon();
    };

    // Handle page visibility change - detect when user switches tabs or minimizes
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Page is now hidden - record when it was hidden
        setIsPageVisible(false);
        pageHiddenAtRef.current = Date.now();
        if (sessionActiveRef.current) {
          // Send heartbeat immediately to mark accurate last-active time.
          lastActivityRef.current = new Date();
          void sendHeartbeatRef.current?.();
        }
      } else {
        // Page is now visible again
        setIsPageVisible(true);
        const hiddenAt = pageHiddenAtRef.current;
        pageHiddenAtRef.current = null;

        if (sessionActiveRef.current && hiddenAt) {
          const gapMs = Date.now() - hiddenAt;
          const gapMinutes = gapMs / 1000 / 60;

          if (gapMinutes > 1.5) {
            // Serialize the stop/start pair so visibility and heartbeat recovery cannot race.
            void restartSessionRef.current?.();
          } else {
            // Short gap - just send heartbeat to resume tracking.
            void sendHeartbeatRef.current?.();
          }
        }

        // MOBILE OPTIMIZATION: Very brief animation suppression to prevent flash
        if (isMobileRef.current) {
          setSuppressAnimations(true);
          requestAnimationFrame(() => {
            setTimeout(() => {
              setSuppressAnimations(false);
            }, 20);
          });
        }
      }
    };

    // pagehide is more reliable than beforeunload on mobile (iOS Safari, Android Chrome)
    // Only end session if page won't be restored (e.g., tab close, not just background)
    const handlePageHide = (e: PageTransitionEvent) => {
      if (!e.persisted) stopDispatchSessionWithBeacon();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      componentMountedRef.current = false;
      lifecycleGenerationRef.current += 1;
      if (dispatchTimerRef.current) clearTimeout(dispatchTimerRef.current);
      if (activityTimerRef.current) clearInterval(activityTimerRef.current);
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
      if (timeoutCheckRef.current) clearInterval(timeoutCheckRef.current);
      if (acceptTimeoutRef.current) clearTimeout(acceptTimeoutRef.current);
      if (processTimeoutRef.current) clearTimeout(processTimeoutRef.current);
      if (fiveMinuteWarningRef.current) clearTimeout(fiveMinuteWarningRef.current);
      if (grabFailedTimerRef.current) clearTimeout(grabFailedTimerRef.current);
      clearInterval(workTimeInterval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const channel = supabase.channel(`employee-dispatch-group-${employee.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'dispatch_group_members', filter: `user_id=eq.${employee.id}`,
      }, () => membershipChangeHandlerRef.current())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [employee.id]);

  useEffect(() => {
    if (session.isWorking) {
      startActivityMonitorRef.current?.();
      startTimeoutCheckRef.current?.();
    } else {
      if (activityTimerRef.current) {
        clearInterval(activityTimerRef.current);
        activityTimerRef.current = null;
      }
      if (timeoutCheckRef.current) {
        clearInterval(timeoutCheckRef.current);
        timeoutCheckRef.current = null;
      }
    }
  }, [session.isWorking]);

  // Keep the async timer guards in sync before setting up per-order timers.
  useEffect(() => {
    currentOrderRef.current = currentOrder;
  }, [currentOrder]);

  useEffect(() => {
    if (currentOrder && currentOrder.status === 'pending') {
      if (
        !acceptDeadlineRef.current ||
        acceptDeadlineRef.current.orderId !== currentOrder.id
      ) {
        const deadline = currentOrder.accept_deadline_at
          ? new Date(currentOrder.accept_deadline_at).getTime()
          : Date.now() + 60000;
        acceptDeadlineRef.current = {
          orderId: currentOrder.id,
          arrivedAt: deadline - 60000,
        };
      }

      const elapsed = (Date.now() - acceptDeadlineRef.current.arrivedAt) / 1000;
      const remaining = Math.max(0, 60 - elapsed);

      console.log(`Current order is pending. Elapsed: ${elapsed.toFixed(0)}s, Remaining: ${remaining.toFixed(0)}s`);

      if (acceptTimeoutRef.current) {
        clearTimeout(acceptTimeoutRef.current);
      }
      acceptTimeoutRef.current = setTimeout(() => {
        void handleAcceptTimeoutRef.current?.(currentOrder.id);
      }, remaining * 1000);
    } else if (currentOrder && currentOrder.status === 'accepted') {
      // Clear accept timeout when accepted
      if (acceptTimeoutRef.current) {
        clearTimeout(acceptTimeoutRef.current);
        acceptTimeoutRef.current = null;
      }
      acceptDeadlineRef.current = null;
      startTimeoutCheckRef.current?.();
    } else {
      // Clear all timeouts when no current order
      if (acceptTimeoutRef.current) {
        clearTimeout(acceptTimeoutRef.current);
        acceptTimeoutRef.current = null;
      }
      acceptDeadlineRef.current = null;
      setHasTimeout(false);
      setHasFiveMinuteWarning(false);
      setShowTimeoutAlert(false);
      if (fiveMinuteWarningRef.current) {
        clearTimeout(fiveMinuteWarningRef.current);
        fiveMinuteWarningRef.current = null;
      }
      if (processTimeoutRef.current) {
        clearTimeout(processTimeoutRef.current);
        processTimeoutRef.current = null;
      }
    }
  }, [currentOrder]);

  useEffect(() => {
    if (onStatusChange) {
      const hasNewOrder = showOrderDetail && currentOrder?.status === 'pending';
      const showWarning = hasFiveMinuteWarning || hasTimeout;
      onStatusChange(hasNewOrder, showWarning);
    }
  }, [showOrderDetail, currentOrder, hasTimeout, hasFiveMinuteWarning, onStatusChange]);

  // iOS-compatible scroll lock when any modal is open
  useEffect(() => {
    const isAnyModalOpen = showOrderDetailModal || showErrorModal || showVerificationModal ||
                           showAutoStopModal || showTimeoutStopModal || showGrabFailedModal || showTimeoutAlert;

    if (isAnyModalOpen) {
      const scrollY = window.scrollY;
      const body = document.body;
      body.style.position = 'fixed';
      body.style.top = `-${scrollY}px`;
      body.style.left = '0';
      body.style.right = '0';
      body.style.overflow = 'hidden';

      return () => {
        const savedScrollY = parseInt(body.style.top || '0', 10) * -1;
        body.style.position = '';
        body.style.top = '';
        body.style.left = '';
        body.style.right = '';
        body.style.overflow = '';
        window.scrollTo({ top: savedScrollY, behavior: 'instant' });
      };
    }
  }, [showOrderDetailModal, showErrorModal, showVerificationModal, showAutoStopModal, showTimeoutStopModal, showGrabFailedModal, showTimeoutAlert]);

  const startTimeoutCheck = () => {
    if (timeoutCheckRef.current) {
      clearInterval(timeoutCheckRef.current);
    }
    if (fiveMinuteWarningRef.current) {
      clearTimeout(fiveMinuteWarningRef.current);
    }
    if (processTimeoutRef.current) {
      clearTimeout(processTimeoutRef.current);
    }

    const order = currentOrder;
    if (!order || order.status !== 'accepted' || !order.accepted_at || order.order_submitted) return;
    const sessionId = sessionIdRef.current;
    const generation = lifecycleGenerationRef.current;
    if (!sessionId) return;

    // Recovery retains the assignment's original group timeout snapshot.
    const timeoutMinutes = order.session_timeout_minutes ?? order.session_timeout_minutes_snapshot ?? configRef.current.session_timeout_minutes;
    const acceptedAt = new Date(order.accepted_at).getTime();
    const elapsedMs = Math.max(0, Date.now() - acceptedAt);
    // Dynamic warning time: warn 3 minutes before timeout, with minimum of 3 minutes
    // BUT: if timeout is too short, warning should be at most 60% of timeout duration
    let warningMinutes = Math.max(3, timeoutMinutes - 3);

    // Safety check: warning must be LESS than timeout (at least 1 minute before)
    if (warningMinutes >= timeoutMinutes) {
      // For very short timeouts, warn at 60% of timeout (leaving 40% remaining)
      warningMinutes = Math.max(0.5, Math.floor(timeoutMinutes * 0.6 * 10) / 10); // Round to 0.1 min
      if (warningMinutes >= timeoutMinutes - 0.5) {
        // If still too close, disable warning for very short timeouts
        warningMinutes = 0;
        console.log(`startTimeoutCheck: Timeout too short (${timeoutMinutes}min), warning disabled`);
      } else {
        console.log(`startTimeoutCheck: Timeout short (${timeoutMinutes}min), adjusted warning to ${warningMinutes}min`);
      }
    }

    const updateWarnings = () => {
      if (!sessionActiveRef.current || currentOrderRef.current?.id !== order.id) return;
      if (currentOrderRef.current.order_submitted) {
        setHasFiveMinuteWarning(false);
        setHasTimeout(false);
        return;
      }
      const minutesPassed = (Date.now() - acceptedAt) / 60000;
      setHasFiveMinuteWarning(warningMinutes > 0 && minutesPassed >= warningMinutes);
      setHasTimeout(minutesPassed >= timeoutMinutes);
    };
    updateWarnings();
    if (warningMinutes > 0 && elapsedMs < warningMinutes * 60000) {
      fiveMinuteWarningRef.current = setTimeout(updateWarnings, warningMinutes * 60000 - elapsedMs);
    }

    let failedChecks = 0;
    const checkAndStop = async () => {
      if (!isCurrentDispatch(sessionId, generation) || currentOrderRef.current?.id !== order.id ||
          processTimeoutInFlightRef.current) return;
      processTimeoutInFlightRef.current = true;
      try {
        const timedOut = await handleProcessTimeout(order.id, sessionId, generation);
        if (!timedOut || !isCurrentDispatch(sessionId, generation)) return;
        // Only a confirmed server timeout can end the local work session.
        setTimeoutStopMinutes(timeoutMinutes);
        await handleStopWork(true);
        showNotification({
          type: 'error',
          title: t.dispatch.processingEnded,
          message: `Order not completed within ${timeoutMinutes} minutes. Session has been stopped.`,
          duration: 0,
        });
      } catch (error) {
        if (isCurrentDispatch(sessionId, generation) && currentOrderRef.current?.id === order.id) {
          console.error('Could not confirm assignment timeout:', error);
          failedChecks += 1;
          const willRetry = failedChecks < 3;
          showNotification({
            type: 'error', title: 'Order Timeout Check Failed',
            message: `${getOrderDispatchErrorMessage(error)}. The order remains active. ${willRetry ? 'Checking again in 30 seconds.' : 'Automatic checks have paused; refresh or contact support if the problem persists.'}`,
            duration: willRetry ? 6000 : 0,
          });
          if (willRetry) processTimeoutRef.current = setTimeout(() => { void checkAndStop(); }, 30000);
        }
      } finally {
        processTimeoutInFlightRef.current = false;
      }
    };
    processTimeoutRef.current = setTimeout(() => { void checkAndStop(); }, Math.max(0, timeoutMinutes * 60000 - elapsedMs));

    timeoutCheckRef.current = setInterval(updateWarnings, 10000);
  };
  startTimeoutCheckRef.current = startTimeoutCheck;

  const playOrderNotificationSound = () => {
    try {
      const AudioContextConstructor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextConstructor) return;
      const audioContext = new AudioContextConstructor();

      // Create a more prominent multi-tone notification sound
      const playTone = (frequency: number, startTime: number, duration: number, volume: number = 0.3) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = frequency;
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(volume, startTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

        oscillator.start(startTime);
        oscillator.stop(startTime + duration);
      };

      // Play a distinctive 3-tone ascending notification
      const now = audioContext.currentTime;
      playTone(523.25, now, 0.15, 0.4);        // C5 - First tone
      playTone(659.25, now + 0.15, 0.15, 0.4); // E5 - Second tone
      playTone(783.99, now + 0.3, 0.25, 0.45); // G5 - Third tone (longer and louder)

    } catch (error) {
      console.error('Error playing order notification sound:', error);
    }
  };

  const stopHeartbeat = () => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  };

  const stopLocalWorkingState = (expectedSessionId: string) => {
    if (sessionIdRef.current !== expectedSessionId) return;

    lifecycleGenerationRef.current += 1;
    sessionActiveRef.current = false;
    sessionIdRef.current = null;
    stopHeartbeat();
    if (dispatchTimerRef.current) {
      clearTimeout(dispatchTimerRef.current);
      dispatchTimerRef.current = null;
    }
    selectedDispatchRef.current = null;
    dispatchPausedRef.current = false;
    if (grabFailedTimerRef.current) {
      clearTimeout(grabFailedTimerRef.current);
      grabFailedTimerRef.current = null;
      setShowGrabFailedModal(false);
    }
    if (activityTimerRef.current) {
      clearInterval(activityTimerRef.current);
      activityTimerRef.current = null;
    }
    if (acceptTimeoutRef.current) {
      clearTimeout(acceptTimeoutRef.current);
      acceptTimeoutRef.current = null;
    }
    if (processTimeoutRef.current) {
      clearTimeout(processTimeoutRef.current);
      processTimeoutRef.current = null;
    }
    if (fiveMinuteWarningRef.current) {
      clearTimeout(fiveMinuteWarningRef.current);
      fiveMinuteWarningRef.current = null;
    }
    if (timeoutCheckRef.current) {
      clearInterval(timeoutCheckRef.current);
      timeoutCheckRef.current = null;
    }

    unacceptedCountRef.current = 0;
    currentOrderRef.current = null;
    if (componentMountedRef.current) {
      setCurrentOrder(null);
      setShowOrderDetail(false);
      setSession({ isWorking: false, sessionId: null, startedAt: null });
      setUnacceptedCount(0);
      setNextOrderTime(null);
      setDispatchPause(null);
      setHasTimeout(false);
      setHasFiveMinuteWarning(false);
      setShowTimeoutAlert(false);
      onStatusChange?.(false, false);
    }
  };

  const recoverDispatchState = async (expectedSessionId: string | null, generation: number): Promise<RecoveryOutcome> => {
    const priorRecovery = recoveryInFlightRef.current;
    if (priorRecovery) {
      try { await priorRecovery; } catch { /* A fresh attempt may still succeed. */ }
    }
    const isCurrentRecovery = () => componentMountedRef.current &&
      lifecycleGenerationRef.current === generation &&
      sessionIdRef.current === expectedSessionId;
    if (!isCurrentRecovery()) return { state: 'stale' };

    const operation = (async (): Promise<RecoveryOutcome> => {
      const auth = getStoredAuth();
      if (auth?.userType !== 'employee') throw new Error('Employee session has expired. Please sign in again.');
      const { data, error } = await supabase.rpc('recover_employee_dispatch_assignment_secure', {
        p_user_id: auth.user.id,
        p_session_token: auth.financialSessionToken,
        p_tab_id: auth.tabId,
      });
      if (!isCurrentRecovery()) return { state: 'stale' };
      if (error) throw error;
      if (!data?.success) throw new Error('The dispatch server could not confirm the work session.');
      if (!data.recovered) {
        if (expectedSessionId) {
          stopLocalWorkingState(expectedSessionId);
          showNotification({
            type: 'error', title: 'Dispatch Session Ended',
            message: 'Your work session is no longer active. Start again to resume dispatch.', duration: 0,
          });
        }
        return { state: 'ended' };
      }
      if (!data.session_id || !data.started_at) throw new Error('Incomplete dispatch recovery response.');

      clearDispatchTimer();
      selectedDispatchRef.current = null;
      dispatchPausedRef.current = false;
      setDispatchPause(null);
      setNextOrderTime(null);
      if (grabFailedTimerRef.current) clearTimeout(grabFailedTimerRef.current);
      grabFailedTimerRef.current = null;
      setShowGrabFailedModal(false);
      sessionActiveRef.current = true;
      sessionIdRef.current = data.session_id;
      lastActivityRef.current = new Date();
      const count = Number(data.unaccepted_count || 0);
      unacceptedCountRef.current = count;
      setUnacceptedCount(count);
      setSession({ isWorking: true, sessionId: data.session_id, startedAt: new Date(data.started_at) });
      if (data.session_id !== expectedSessionId || !heartbeatTimerRef.current) startHeartbeat();
      void loadTotalWorkTime();
      void loadTodayOrders();

      const assignment = data.assignment;
      currentOrderRef.current = assignment || null;
      setCurrentOrder(assignment || null);
      setShowOrderDetail(Boolean(assignment));
      if (assignment?.status !== 'accepted') {
        setShowErrorModal(false);
        setErrorReason('');
      }
      if (assignment) return { state: 'active', assignment };
      void scheduleNextOrder();
      return { state: 'idle' };
    })();
    recoveryInFlightRef.current = operation;
    try {
      return await operation;
    } finally {
      if (recoveryInFlightRef.current === operation) recoveryInFlightRef.current = null;
    }
  };

  const restartSessionAfterLifecycleGap = (): Promise<void> => {
    if (visibilityRestartPromiseRef.current) {
      return visibilityRestartPromiseRef.current;
    }

    if (!componentMountedRef.current || !sessionActiveRef.current || document.hidden) return Promise.resolve();
    const generation = ++lifecycleGenerationRef.current;
    clearDispatchTimer();
    selectedDispatchRef.current = null;
    const oldSessionId = sessionIdRef.current;
    const operation = (async () => {
      if (!oldSessionId || !isCurrentDispatch(oldSessionId, generation) || document.hidden) return;
      const outcome = await recoverDispatchState(oldSessionId, generation);
      if (outcome.state !== 'stale' && sessionActiveRef.current) void sendHeartbeatRef.current?.();
    })().catch(error => {
      console.error('Failed to recover work session after lifecycle gap:', error);
      if (oldSessionId && isCurrentDispatch(oldSessionId, generation)) {
        showNotification({
          type: 'error', title: 'Session Recovery Failed',
          message: getOrderDispatchErrorMessage(error), duration: 5000,
        });
        if (currentOrderRef.current?.status === 'accepted') startTimeoutCheckRef.current?.();
        pauseDispatch('error', getOrderDispatchErrorMessage(error), oldSessionId, generation);
      }
    }).finally(() => {
      if (visibilityRestartPromiseRef.current === operation) {
        visibilityRestartPromiseRef.current = null;
      }
    });

    visibilityRestartPromiseRef.current = operation;
    return operation;
  };
  restartSessionRef.current = restartSessionAfterLifecycleGap;

  const sendHeartbeat = async () => {
    const currentSessionId = sessionIdRef.current;
    const auth = getStoredAuth();
    if (
      !componentMountedRef.current ||
      !sessionActiveRef.current ||
      !currentSessionId ||
      auth?.userType !== 'employee'
    ) {
      return;
    }

    try {
      const { data, error } = await supabase.rpc('update_session_heartbeat_secure', {
        p_user_id: auth.user.id,
        p_session_token: auth.financialSessionToken,
        p_tab_id: auth.tabId,
        p_session_id: currentSessionId,
      });

      if (error) throw error;
      if (!data?.success) {
        console.error('Heartbeat rejected:', data?.reason || 'unknown reason');
        if (
          componentMountedRef.current &&
          sessionActiveRef.current &&
          !document.hidden &&
          sessionIdRef.current === currentSessionId
        ) {
          await restartSessionAfterLifecycleGap();
        } else if (sessionIdRef.current === currentSessionId) {
          stopLocalWorkingState(currentSessionId);
        }
      }
    } catch (error) {
      console.error('Error sending heartbeat:', error);
    }
  };
  sendHeartbeatRef.current = sendHeartbeat;

  const startHeartbeat = () => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
    }

    // Add random jitter (0-15 seconds) to distribute load across users
    const jitter = Math.random() * 15000;
    const heartbeatInterval = 60000 + jitter;

    // Send heartbeat every ~60 seconds (with jitter) to keep session alive
    heartbeatTimerRef.current = setInterval(() => {
      void sendHeartbeatRef.current?.();
    }, heartbeatInterval);

    // Send initial heartbeat with small delay to avoid startup spike
    setTimeout(() => {
      void sendHeartbeatRef.current?.();
    }, Math.random() * 3000);
  };

  const checkPendingOrder = async () => {
    await recoverDispatchState(sessionIdRef.current, lifecycleGenerationRef.current);
  };

  checkPendingOrderRef.current = checkPendingOrder;

  const loadConfig = async () => {
    try {
      // Global timeout is only for legacy assignments and idle activity; dispatch
      // interval, group, pool, and mode always come from the secure server RPCs.
      const { data, error } = await supabase
        .from('dispatch_config')
        .select('config_value')
        .eq('config_key', 'session_timeout_minutes')
        .maybeSingle();
      if (error) throw error;
      setConfig({ session_timeout_minutes: Number(data?.config_value) || 10 });

    } catch (error) {
      console.error('Failed to load config:', error);
    }
  };

  const loadTotalWorkTime = async () => {
    try {
      const auth = sessionStorage.getItem(AUTH_STORAGE_KEY);
      if (!auth) return;

      const userId = JSON.parse(auth).user.id;

      const { data, error } = await supabase
        .rpc('get_user_work_time_today', { p_user_id: userId });

      if (error) throw error;

      setTotalWorkTime(data || 0);
    } catch (error) {
      console.error('Failed to load total work time:', error);
    }
  };

  const loadTodayOrders = async () => {
    try {
      const auth = sessionStorage.getItem(AUTH_STORAGE_KEY);
      if (!auth) return;

      const userId = JSON.parse(auth).user.id;
      const todayStartUTC = getTodayStartUTC();

      const { data, error } = await supabase
        .from('dispatch_assignments')
        .select(`
          *,
          dispatch_orders:dispatch_group_orders (
            id,
            order_content
          )
        `)
        .eq('user_id', userId)
        .gte('assigned_at', todayStartUTC)
        .not('accepted_at', 'is', null)
        .order('assigned_at', { ascending: false });

      if (error) throw error;

      // Stale pending/accepted orders are reconciled by the database
      // (auto_recover_stale_pending_orders cron); do not compute timeouts
      // against the browser clock here, as clock skew causes false cancels.
      const finalData: DispatchAssignment[] = (data || []).map(assignment => ({
        ...assignment,
        session_timeout_minutes: assignment.session_timeout_minutes_snapshot,
        dispatch_orders: {
          id: assignment.dispatch_orders?.id,
          order_content: assignment.order_content_snapshot ?? assignment.dispatch_orders?.order_content ?? '',
        },
      }));

      setTodayOrders(finalData);

      const completed = finalData?.filter(o => o.status === 'completed').length || 0;
      const errorCount = finalData?.filter(o => o.status === 'error').length || 0;
      const timeoutCount = finalData?.filter(o => o.status === 'timeout' || o.status === 'cancelled').length || 0;

      setStats({
        total: finalData?.length || 0,
        completed,
        error: errorCount,
        timeout: timeoutCount,
      });

      try {
        const { count } = await supabase
          .from('orders')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .gte('created_at', todayStartUTC);
        setTodaySubmittedOrders(count || 0);
      } catch { /* ignore */ }
    } catch (error: unknown) {
      console.error('Failed to load today orders:', error);
    }
  };

  const startActivityMonitor = () => {
    if (activityTimerRef.current) return;

    activityTimerRef.current = setInterval(() => {
      const now = new Date();
      const timeSinceLastActivity = (now.getTime() - lastActivityRef.current.getTime()) / 1000 / 60;

      if (!currentOrderRef.current && !selectedDispatchRef.current && !dispatchPausedRef.current &&
          timeSinceLastActivity >= configRef.current.session_timeout_minutes) {
        void handleStopWork(true).catch(() => {
          // The handler reports the failure and preserves active state for retry.
        });
      }
    }, 30000);
  };
  startActivityMonitorRef.current = startActivityMonitor;

  const updateActivity = () => {
    lastActivityRef.current = new Date();
    if (sessionIdRef.current) void sendHeartbeat();
  };

  const handleStartWork = async () => {
    console.log('handleStartWork called, isProcessing:', isProcessing, 'lockRef:', startWorkLockRef.current);

    // Double-check with ref to prevent race conditions from rapid clicks
    if (isProcessing || startWorkLockRef.current || isStartButtonPressed) {
      console.log('Already processing, returning early (state:', isProcessing, 'ref:', startWorkLockRef.current, ')');
      return;
    }

    // Quick verification check using cached employee data
    // Real-time subscription already keeps this data fresh
    if (!employee.is_verified) {
      console.log('❌ Employee NOT verified - showing verification modal');
      setShowVerificationModal(true);
      return;
    }

    console.log('✅ Employee verified - proceeding with work session');

    // Explicit lifecycle operations invalidate any older visibility restart.
    const startGeneration = lifecycleGenerationRef.current + 1;
    lifecycleGenerationRef.current = startGeneration;
    const staleVisibilityRestart = visibilityRestartPromiseRef.current;

    // Mobile: Show ripple effect on tap
    console.log('🔍 Device check - isMobile:', isMobile);
    if (isMobile) {
      console.log('📱 Mobile detected - triggering ripple effect');
      setShowStartRipple(true);
      setTimeout(() => {
        console.log('📱 Ripple effect ended');
        setShowStartRipple(false);
      }, 600);
    } else {
      console.log('🖥️ Desktop detected - skipping ripple effect');
    }

    // Show button press feedback first
    setIsStartButtonPressed(true);

    // Use setTimeout instead of await to allow React to render the state change
    setTimeout(async () => {
      if (!componentMountedRef.current || lifecycleGenerationRef.current !== startGeneration) {
        startWorkLockRef.current = false;
        return;
      }

      // Reset press state immediately
      setIsStartButtonPressed(false);

      // Immediately set lock to prevent concurrent executions
      startWorkLockRef.current = true;

      // Show transition animation
      setIsTransitioning(true);
      setTransitionType('start');
      setIsProcessing(true);

    // Single frame wait for smooth transition
    await new Promise(resolve => requestAnimationFrame(resolve));

    try {
      console.log('Starting work session...');
      const initialCleanup = initialCleanupPromiseRef.current;
      if (initialCleanup) {
        try {
          await initialCleanup;
        } catch (error) {
          console.error('Initial dispatch cleanup failed before Start:', error);
        }
      }
      if (staleVisibilityRestart) {
        try {
          await staleVisibilityRestart;
        } catch (error) {
          console.error('Stale visibility restart failed before Start:', error);
        }
      }

      if (!componentMountedRef.current || lifecycleGenerationRef.current !== startGeneration) {
        return;
      }

      const auth = getStoredAuth();
      if (auth?.userType !== 'employee') {
        console.error('No employee auth found in session storage');
        setIsTransitioning(false);
        setTransitionType(null);
        setIsProcessing(false);
        return;
      }

      const userId = auth.user.id;
      console.log('User ID:', userId);

      // Minimal animation duration - the loading state is shown immediately
      const animationPromise = new Promise(resolve => setTimeout(resolve, isMobile ? 100 : performanceSettings.transitionDuration));

      // The secure RPC creates the session; group and pool selection happen on the server.
      sessionActiveRef.current = false;

      // Create one online dispatch session and its corresponding work session atomically.
      console.log('Creating new sessions...');
      const { data: startResult, error: startError } = await supabase.rpc('start_employee_dispatch_session_secure', {
        p_user_id: userId,
        p_session_token: auth.financialSessionToken,
        p_tab_id: auth.tabId,
      });
      if (startError) {
        console.error('Failed to start secure dispatch session:', startError);
        throw startError;
      }
      if (!startResult?.success || !startResult.session_id || !startResult.started_at) {
        console.error('Dispatch session creation returned invalid data:', startResult);
        throw new Error('Failed to create dispatch session - no session ID returned');
      }

      if (!componentMountedRef.current || lifecycleGenerationRef.current !== startGeneration) {
        try {
          const { error: cleanupError } = await supabase.rpc('stop_employee_dispatch_session_secure', {
            p_user_id: userId,
            p_session_token: auth.financialSessionToken,
            p_tab_id: auth.tabId,
            p_session_id: startResult.session_id,
          });
          if (cleanupError) console.error('Failed to clean up stale Start session:', cleanupError);
        } catch (cleanupError) {
          console.error('Failed to clean up stale Start session:', cleanupError);
        }
        return;
      }

      const data = {
        id: startResult.session_id,
        started_at: startResult.started_at,
      };
      console.log('Sessions created successfully, session_id:', data.id);

      // Load total work time (non-blocking - can happen after UI update)
      loadTotalWorkTime().catch(err => console.error('Failed to load work time:', err));

      const newSession = {
        isWorking: true,
        sessionId: data.id,
        startedAt: new Date(data.started_at),
      };

      // Prepare session data but don't update state yet
      sessionActiveRef.current = true;
      sessionIdRef.current = data.id;
      lastActivityRef.current = new Date();
      unacceptedCountRef.current = 0;

      // Start heartbeat to keep session alive
      startHeartbeat();

      selectedDispatchRef.current = null;
      dispatchPausedRef.current = false;
      setDispatchPause(null);
      void scheduleNextOrder();

      // Wait for animation to complete before updating UI state
      await animationPromise;

      if (!componentMountedRef.current || lifecycleGenerationRef.current !== startGeneration) {
        try {
          const { error: cleanupError } = await supabase.rpc('stop_employee_dispatch_session_secure', {
            p_user_id: userId,
            p_session_token: auth.financialSessionToken,
            p_tab_id: auth.tabId,
            p_session_id: data.id,
          });
          if (cleanupError) console.error('Failed to clean up stale animated Start session:', cleanupError);
        } catch (cleanupError) {
          console.error('Failed to clean up stale animated Start session:', cleanupError);
        }
        stopLocalWorkingState(data.id);
        return;
      }

      // Now update the session state to trigger UI change
      setSession(newSession);
      setUnacceptedCount(0);

      // Mobile: Show success toast
      if (isMobile) {
        setTimeout(() => {
          setShowStartSuccess(true);
          setTimeout(() => setShowStartSuccess(false), 1200);
        }, 100);
      }
    } catch (error: unknown) {
      console.error('Failed to start work:', error);
      console.error('Error details:', {
        message: getOrderDispatchErrorMessage(error)
      });

      if (!componentMountedRef.current || lifecycleGenerationRef.current !== startGeneration) {
        return;
      }

      // User-friendly error message
      const errorMsg = getOrderDispatchErrorMessage(error);
      showNotification({
        type: 'error',
        title: 'Failed to Start',
        message: errorMsg,
        duration: 5000
      });

      // Fallback: also use alert if notifications don't show for some reason
      if (typeof alert === 'function') {
        setTimeout(() => {
          alert('Failed to start work: ' + errorMsg);
        }, 100);
      }

      // Reset state on error - critical to prevent stuck states
      setSession({
        isWorking: false,
        sessionId: null,
        startedAt: null,
      });
      sessionActiveRef.current = false;
      selectedDispatchRef.current = null;
      dispatchPausedRef.current = false;
      setDispatchPause(null);
      setNextOrderTime(null);

      // Ensure all timers are cleared
      if (dispatchTimerRef.current) clearTimeout(dispatchTimerRef.current);
      if (heartbeatTimerRef.current) clearTimeout(heartbeatTimerRef.current);
      if (timeoutCheckRef.current) clearTimeout(timeoutCheckRef.current);
    } finally {
      if (componentMountedRef.current) {
        setIsProcessing(false);
        setIsTransitioning(false);
        setTransitionType(null);
      }
      // Release lock after a small delay to ensure state updates complete
      setTimeout(() => {
        startWorkLockRef.current = false;
      }, 100);
    }
    }, 150); // End of setTimeout for button press feedback
  };

  const handleStopWork = async (timeout: boolean = false) => {
    if (isProcessing && !timeout) return;
    const stoppingSessionId = sessionIdRef.current;

    // Explicit lifecycle operations invalidate any older visibility restart.
    const stopGeneration = lifecycleGenerationRef.current + 1;
    lifecycleGenerationRef.current = stopGeneration;
    clearDispatchTimer();
    const staleVisibilityRestart = visibilityRestartPromiseRef.current;

    // Show transition animation (unless auto-stopped by timeout)
    if (!timeout) {
      setIsTransitioning(true);
      setTransitionType('end');
      setIsProcessing(true);

      // Single frame wait for smooth transition
      await new Promise(resolve => requestAnimationFrame(resolve));
    }

    // Shorter animation duration for better responsiveness (500ms)
    const animationPromise = !timeout ? new Promise(resolve => setTimeout(resolve, 500)) : Promise.resolve();

    try {
      if (staleVisibilityRestart) {
        try {
          await staleVisibilityRestart;
        } catch (error) {
          console.error('Stale visibility restart failed before Stop:', error);
        }
      }

      if (!componentMountedRef.current || lifecycleGenerationRef.current !== stopGeneration) {
        return;
      }

      const auth = getStoredAuth();
      if (auth?.userType !== 'employee') {
        throw new Error('Employee session has expired. Please sign in again.');
      }

      const userId = auth.user.id;
      const currentSessionId = sessionIdRef.current || session.sessionId;

      if (currentOrder?.status === 'pending') {
        const { error: cancelError } = await supabase.rpc('finish_dispatch_assignment_secure', {
          p_user_id: userId,
          p_session_token: auth.financialSessionToken,
          p_tab_id: auth.tabId,
          p_assignment_id: currentOrder.id,
          p_status: 'cancelled',
          p_remarks: 'Auto-cancelled: Work session stopped by user',
        });
        if (cancelError) console.error('Failed to cancel pending assignment while stopping work:', cancelError);
      }

      const { data: stopResult, error: stopError } = await supabase.rpc('stop_employee_dispatch_session_secure', {
        p_user_id: userId,
        p_session_token: auth.financialSessionToken,
        p_tab_id: auth.tabId,
        p_session_id: currentSessionId,
      });
      if (!componentMountedRef.current || lifecycleGenerationRef.current !== stopGeneration ||
          sessionIdRef.current !== currentSessionId) return;
      if (stopError) throw stopError;
      if (!stopResult?.success) {
        throw new Error('The work session could not be stopped. Please try again.');
      }
      console.log('Work session ended by user');

      // Load total work time (non-blocking - can happen after UI update)
      void loadTotalWorkTime().catch(err => console.error('Failed to load work time:', err));

      // Stop heartbeat
      stopHeartbeat();

      // Clear all timers only after the server confirms the stop.
      if (dispatchTimerRef.current) {
        clearTimeout(dispatchTimerRef.current);
        dispatchTimerRef.current = null;
      }
      selectedDispatchRef.current = null;
      dispatchPausedRef.current = false;
      setDispatchPause(null);
      if (acceptTimeoutRef.current) {
        clearTimeout(acceptTimeoutRef.current);
        acceptTimeoutRef.current = null;
      }
      if (processTimeoutRef.current) {
        clearTimeout(processTimeoutRef.current);
        processTimeoutRef.current = null;
      }
      if (fiveMinuteWarningRef.current) {
        clearTimeout(fiveMinuteWarningRef.current);
        fiveMinuteWarningRef.current = null;
      }
      if (timeoutCheckRef.current) {
        clearInterval(timeoutCheckRef.current);
        timeoutCheckRef.current = null;
      }

      if (!componentMountedRef.current || lifecycleGenerationRef.current !== stopGeneration) {
        return;
      }

      // Prepare to clear state but don't update UI-affecting states yet.
      sessionActiveRef.current = false;
      sessionIdRef.current = null;
      unacceptedCountRef.current = 0;

      if (timeout) {
        // For timeout, update immediately (no animation)
        setCurrentOrder(null);
        setShowOrderDetail(false);
        setSession({
          isWorking: false,
          sessionId: null,
          startedAt: null,
        });
        setUnacceptedCount(0);
        setNextOrderTime(null);
        setHasTimeout(false);
        setHasFiveMinuteWarning(false);
        setShowTimeoutAlert(false);

        // Notify parent component that timeout is cleared
        if (onStatusChange) {
          onStatusChange(false, false);
        }

        // Show timeout modal instead of blocking alert
        setShowTimeoutStopModal(true);
      } else {
        // Wait for animation to complete before updating UI state
        await animationPromise;
        await new Promise(resolve => setTimeout(resolve, 100));

        if (!componentMountedRef.current || lifecycleGenerationRef.current !== stopGeneration) {
          return;
        }

        // Now update the session state to trigger UI change
        setCurrentOrder(null);
        setShowOrderDetail(false);
        setSession({
          isWorking: false,
          sessionId: null,
          startedAt: null,
        });
        setUnacceptedCount(0);
        setNextOrderTime(null);
        setHasTimeout(false);
        setHasFiveMinuteWarning(false);
        setShowTimeoutAlert(false);

        // Notify parent component that timeout is cleared
        if (onStatusChange) {
          onStatusChange(false, false);
        }

        // Mobile: Show success toast for stop work
        if (isMobile) {
          setTimeout(() => {
            setShowStopSuccess(true);
            setTimeout(() => setShowStopSuccess(false), 1200);
          }, 100);
        }
      }

      // Reload today's orders in background (non-blocking for better UX)
      void loadTodayOrders().catch(err => console.error('Failed to reload orders:', err));
    } catch (error: unknown) {
      console.error('Failed to stop work:', error);
      if (componentMountedRef.current && lifecycleGenerationRef.current === stopGeneration) {
        showNotification({
          type: 'error',
          title: 'Failed to Stop',
          message: getOrderDispatchErrorMessage(error),
          duration: 5000,
        });
        if (stoppingSessionId && sessionActiveRef.current && sessionIdRef.current === stoppingSessionId) {
          const selection = selectedDispatchRef.current;
          if (selection) armDispatchTimer(selection, stopGeneration);
          else if (dispatchPausedRef.current) pauseDispatch(dispatchPause?.type || 'error', dispatchPause?.message || 'Dispatch is temporarily unavailable.', stoppingSessionId, stopGeneration);
          else if (!currentOrderRef.current) void scheduleNextOrder();
        }
      }
      throw error;
    } finally {
      if (!timeout && componentMountedRef.current) {
        setIsProcessing(false);
        setIsTransitioning(false);
        setTransitionType(null);
      }
    }
  };

  const isCurrentDispatch = (sessionId: string, generation: number) =>
    componentMountedRef.current && sessionActiveRef.current &&
    sessionIdRef.current === sessionId && lifecycleGenerationRef.current === generation;

  const clearDispatchTimer = () => {
    if (dispatchTimerRef.current) clearTimeout(dispatchTimerRef.current);
    dispatchTimerRef.current = null;
  };

  membershipChangeHandlerRef.current = () => {
    if (!sessionActiveRef.current || currentOrderRef.current || recoveryInFlightRef.current) return;
    membershipRevisionRef.current += 1;
    if (assigningDispatchRef.current) {
      membershipChangeDuringAssignmentRef.current = true;
      return;
    }
    clearDispatchTimer();
    selectedDispatchRef.current = null;
    dispatchPausedRef.current = false;
    setNextOrderTime(null);
    setDispatchPause(null);
    if (!preparingDispatchRef.current) void scheduleNextOrder();
  };

  const armDispatchTimer = (selection: DispatchSelection, generation: number, minimumDelay = 0) => {
    if (!isCurrentDispatch(selection.sessionId, generation) || selectedDispatchRef.current !== selection) return;
    clearDispatchTimer();
    setNextOrderTime(new Date(selection.dueAt));
    dispatchTimerRef.current = setTimeout(() => {
      dispatchTimerRef.current = null;
      void dispatchNewOrder(selection, generation);
    }, Math.max(minimumDelay, selection.dueAt - Date.now(), 0));
  };

  const pauseDispatch = (type: 'unavailable' | 'error', message: string, sessionId: string, generation: number) => {
    if (!isCurrentDispatch(sessionId, generation)) return;
    clearDispatchTimer();
    selectedDispatchRef.current = null;
    dispatchPausedRef.current = true;
    setNextOrderTime(null);
    setDispatchPause({ type, message });
    // No rapid retry when a group/pool is unavailable or a request fails.
    dispatchTimerRef.current = setTimeout(() => {
      dispatchTimerRef.current = null;
      if (!isCurrentDispatch(sessionId, generation)) return;
      dispatchPausedRef.current = false;
      if (type === 'error') {
        // An uncertain assignment result may already have created an order.
        void checkPendingOrderRef.current?.().catch(error => {
          console.error('Failed to check dispatch assignment after a network error:', error);
          pauseDispatch('error', getOrderDispatchErrorMessage(error), sessionId, generation);
        });
      } else {
        void scheduleNextOrder();
      }
    }, PAUSED_DISPATCH_CHECK_MS);
  };

  const scheduleNextOrder = async () => {
    const sessionId = sessionIdRef.current;
    const generation = lifecycleGenerationRef.current;
    if (!sessionId || !isCurrentDispatch(sessionId, generation) || dispatchPausedRef.current ||
        (assigningDispatchRef.current?.sessionId === sessionId && assigningDispatchRef.current.generation === generation)) return;

    const selection = selectedDispatchRef.current;
    if (selection?.sessionId === sessionId) {
      armDispatchTimer(selection, generation);
      return;
    }
    if (preparingDispatchRef.current?.sessionId === sessionId &&
        preparingDispatchRef.current.generation === generation) return;

    const preparation = { sessionId, generation };
    const membershipRevision = membershipRevisionRef.current;
    preparingDispatchRef.current = preparation;
    try {
      const auth = getStoredAuth();
      if (auth?.userType !== 'employee') throw new Error('Employee session has expired. Please sign in again.');
      const { data, error } = await supabase.rpc('prepare_next_dispatch_order_secure', {
        p_user_id: auth.user.id,
        p_session_token: auth.financialSessionToken,
        p_tab_id: auth.tabId,
        p_session_id: sessionId,
      });
      if (!isCurrentDispatch(sessionId, generation) || membershipRevision !== membershipRevisionRef.current) return;
      if (error) throw error;
      const prepared = data;
      if (prepared?.auto_stopped) {
        stopLocalWorkingState(sessionId);
        setShowAutoStopModal(true);
        return;
      }
      if (!prepared?.available) {
        const message = prepared?.message || 'No eligible dispatch orders are available.';
        pauseDispatch(message === 'An active dispatch assignment already exists.' ? 'error' : 'unavailable', message, sessionId, generation);
        return;
      }
      const dueAt = Date.parse(prepared.due_at || '');
      if (!prepared.group_id || !prepared.pool_id || !Number.isFinite(dueAt)) {
        throw new Error('The dispatch server returned an invalid pool selection.');
      }
      const nextSelection = { sessionId, groupId: prepared.group_id, poolId: prepared.pool_id, dueAt };
      selectedDispatchRef.current = nextSelection;
      dispatchPausedRef.current = false;
      setDispatchPause(null);
      armDispatchTimer(nextSelection, generation);
    } catch (error) {
      if (isCurrentDispatch(sessionId, generation) && membershipRevision === membershipRevisionRef.current) {
        console.error('Failed to prepare dispatch:', error);
        pauseDispatch('error', getOrderDispatchErrorMessage(error), sessionId, generation);
      }
    } finally {
      if (preparingDispatchRef.current === preparation) {
        preparingDispatchRef.current = null;
        if (membershipRevision !== membershipRevisionRef.current && isCurrentDispatch(sessionId, generation))
          void scheduleNextOrder();
      }
    }
  };

  const dispatchNewOrder = async (selection: DispatchSelection, generation: number) => {
    if (!isCurrentDispatch(selection.sessionId, generation) || selectedDispatchRef.current !== selection ||
        (assigningDispatchRef.current?.sessionId === selection.sessionId && assigningDispatchRef.current.generation === generation)) return;
    const assignmentAttempt = { sessionId: selection.sessionId, generation };
    assigningDispatchRef.current = assignmentAttempt;
    let assignedSuccessfully = false;
    try {
      const auth = getStoredAuth();
      if (auth?.userType !== 'employee') throw new Error('Employee session has expired. Please sign in again.');

      // The server's sticky selection is authoritative; legacy group/mode arguments are ignored.
      const { data, error } = await supabase.rpc('assign_next_dispatch_order_secure', {
        p_user_id: auth.user.id,
        p_session_token: auth.financialSessionToken,
        p_tab_id: auth.tabId,
        p_session_id: selection.sessionId,
        p_group_id: null,
      });
      if (!isCurrentDispatch(selection.sessionId, generation) || selectedDispatchRef.current !== selection) return;
      if (error) throw error;
      const result = data;
      if (result?.auto_stopped) {
        stopLocalWorkingState(selection.sessionId);
        setShowAutoStopModal(true);
        return;
      }
      if (!result?.success) {
        if (result?.retry_selection) {
          // The selected pool changed or emptied at due time. The next selection
          // starts a fresh server interval; never assign immediately from another pool.
          selectedDispatchRef.current = null;
          setNextOrderTime(null);
          assigningDispatchRef.current = null;
          membershipChangeDuringAssignmentRef.current = false;
          void scheduleNextOrder();
        } else if (result?.due_at) {
          const dueAt = Date.parse(result.due_at);
          if (!Number.isFinite(dueAt)) throw new Error('The dispatch server returned an invalid due time.');
          const updatedSelection = { ...selection, dueAt };
          selectedDispatchRef.current = updatedSelection;
          armDispatchTimer(updatedSelection, generation, 5000);
        } else if (result?.message === 'An active dispatch assignment already exists.') {
          pauseDispatch('error', 'An active assignment exists. Checking it again in five minutes.', selection.sessionId, generation);
        } else {
          pauseDispatch('unavailable', result?.message || 'No eligible dispatch orders are available.', selection.sessionId, generation);
        }
        return;
      }

      const assignment = result.assignment;
      if (!assignment?.id || !assignment.session_timeout_minutes) {
        throw new Error('The dispatch server returned an incomplete assignment.');
      }
      selectedDispatchRef.current = null;
      setNextOrderTime(null);
      setDispatchPause(null);
      const serverUnacceptedCount = Number(result.unaccepted_count || 0);
      unacceptedCountRef.current = serverUnacceptedCount;
      setUnacceptedCount(serverUnacceptedCount);
      const newAssignment: DispatchAssignment = {
        ...assignment,
        dispatch_orders: { order_content: assignment.order_content },
        session_timeout_minutes: assignment.session_timeout_minutes,
      };
      assignedSuccessfully = true;
      currentOrderRef.current = newAssignment;
      setCurrentOrder(newAssignment);
      setShowOrderDetail(true);
      updateActivity();
      void loadTodayOrders();
      playOrderNotificationSound();

      // The 60-second accept deadline is server-generated, including for slow responses.
      if (acceptTimeoutRef.current) clearTimeout(acceptTimeoutRef.current);
      acceptTimeoutRef.current = setTimeout(() => {
        void handleAcceptTimeoutRef.current?.(newAssignment.id);
      }, newAssignment.accept_deadline_at
        ? Math.max(0, Date.parse(newAssignment.accept_deadline_at) - Date.now()) : 60000);
    } catch (error) {
      if (isCurrentDispatch(selection.sessionId, generation)) {
        console.error('Failed to dispatch order:', error);
        pauseDispatch('error', getOrderDispatchErrorMessage(error), selection.sessionId, generation);
      }
    } finally {
      if (assigningDispatchRef.current === assignmentAttempt) {
        assigningDispatchRef.current = null;
        if (membershipChangeDuringAssignmentRef.current) {
          membershipChangeDuringAssignmentRef.current = false;
          if (!assignedSuccessfully && isCurrentDispatch(selection.sessionId, generation))
            void checkPendingOrderRef.current?.();
        }
      }
    }
  };

  const handleAcceptTimeout = async (assignmentId: string) => {
    const auth = getStoredAuth();
    const currentSessionId = sessionIdRef.current;
    const generation = lifecycleGenerationRef.current;
    if (auth?.userType !== 'employee' || !currentSessionId ||
        !isCurrentDispatch(currentSessionId, generation) || currentOrderRef.current?.id !== assignmentId) return;

    try {
      const { data: result, error } = await supabase.rpc(
        'expire_pending_dispatch_assignment_secure',
        {
          p_user_id: auth.user.id,
          p_session_token: auth.financialSessionToken,
          p_tab_id: auth.tabId,
          p_session_id: currentSessionId,
          p_assignment_id: assignmentId,
        },
      );
      if (!isCurrentDispatch(currentSessionId, generation) || currentOrderRef.current?.id !== assignmentId) return;
      if (error) throw error;

      if (result?.reason === 'deadline_not_reached' && result.accept_deadline_at) {
        const delay = Math.max(0, new Date(result.accept_deadline_at).getTime() - Date.now());
        acceptTimeoutRef.current = setTimeout(() => {
          void handleAcceptTimeoutRef.current?.(assignmentId);
        }, delay);
        return;
      }

      if (result?.assignment_status === 'accepted') {
        await recoverDispatchState(currentSessionId, generation);
        return;
      }
      if (result?.assignment_status === 'pending') return;

      if (typeof result?.unaccepted_count === 'number') {
        unacceptedCountRef.current = result.unaccepted_count;
        setUnacceptedCount(result.unaccepted_count);
      }

      setCurrentOrder(null);
      setShowOrderDetail(false);
      updateActivity();
      void loadTodayOrders();

      if (result?.auto_stopped) {
        stopLocalWorkingState(currentSessionId);
        setShowAutoStopModal(true);
        return;
      }

      if (result?.schedule_next) void scheduleNextOrder();
    } catch (error: unknown) {
      if (!isCurrentDispatch(currentSessionId, generation)) return;
      console.error('Failed to expire pending assignment:', error);
      showNotification({
        type: 'error',
        title: 'Order Timeout Check Failed',
        message: getOrderDispatchErrorMessage(error),
        duration: 5000,
      });
    }
  };
  handleAcceptTimeoutRef.current = handleAcceptTimeout;

  const handleProcessTimeout = async (assignmentId: string, sessionId: string, generation: number): Promise<boolean> => {
    const isCurrentOrder = () => isCurrentDispatch(sessionId, generation) && currentOrderRef.current?.id === assignmentId;
    const auth = getStoredAuth();
    if (!isCurrentOrder() || auth?.userType !== 'employee') return false;

    // OrderSubmission can mark this assignment on the server without updating this component.
    const { data: assignment, error: fetchError } = await supabase
      .from('dispatch_assignments')
      .select('status, order_submitted, assignment_id')
      .eq('id', assignmentId)
      .eq('user_id', auth.user.id)
      .maybeSingle();
    if (!isCurrentOrder()) return false;
    if (fetchError) throw fetchError;
    if (!assignment || assignment.status !== 'accepted') {
      await recoverDispatchState(sessionId, generation);
      return false;
    }

    let linkedOrder: { id: string; status: string } | null = null;
    if (assignment.assignment_id) {
      const { data, error } = await supabase
        .from('orders')
        .select('id, status')
        .eq('user_id', auth.user.id)
        .eq('assignment_id', assignment.assignment_id)
        .limit(1)
        .maybeSingle();
      if (!isCurrentOrder()) return false;
      if (error) throw error;
      linkedOrder = data;
    }

    if (assignment.order_submitted || linkedOrder) {
      if (linkedOrder && ['success', 'failure', 'error'].includes(linkedOrder.status)) {
        await recoverDispatchState(sessionId, generation);
      } else {
        setCurrentOrder(prev => prev?.id === assignmentId && !prev.order_submitted ? { ...prev, order_submitted: true } : prev);
        setHasFiveMinuteWarning(false);
        setHasTimeout(false);
        void loadTodayOrders();
      }
      return false; // Submitted orders are reconciled on the server's 30-minute window.
    }

    const { data: timeoutResult, error: timeoutError } = await supabase.rpc('finish_dispatch_assignment_secure', {
      p_user_id: auth.user.id,
      p_session_token: auth.financialSessionToken,
      p_tab_id: auth.tabId,
      p_assignment_id: assignmentId,
      p_status: 'timeout',
      p_remarks: 'Auto-skipped: Not completed within configured time',
    });
    if (!isCurrentOrder()) return false;
    if (timeoutError) throw timeoutError;
    if (!timeoutResult?.success) {
      await recoverDispatchState(sessionId, generation);
      return false;
    }

    currentOrderRef.current = null;
    setCurrentOrder(null);
    setShowOrderDetail(false);
    setHasTimeout(false);
    setHasFiveMinuteWarning(false);
    setShowTimeoutAlert(false);
    void loadTodayOrders();
    return true;
  };

  const handleCloseGrabFailedModal = () => {
    if (grabFailedTimerRef.current) {
      clearTimeout(grabFailedTimerRef.current);
      grabFailedTimerRef.current = null;
    }
    setShowGrabFailedModal(false);
    scheduleNextOrder();
  };

  const handleAcceptOrder = async () => {
    console.log('🔵 handleAcceptOrder called, currentOrder:', currentOrder?.id, 'isAccepting:', isAccepting);

    if (!currentOrder) {
      console.log('❌ No currentOrder, returning');
      return;
    }

    // Prevent duplicate submissions
    if (isAccepting) {
      console.log('⚠️ Already processing accept request, ignoring');
      return;
    }
    setIsAccepting(true);
    console.log('✅ Set isAccepting to true');
    const orderId = currentOrder.id;
    const acceptSessionId = sessionIdRef.current;
    const generation = lifecycleGenerationRef.current;

    // CRITICAL: Clear 60-second accept timeout IMMEDIATELY to prevent race condition
    // This prevents the timeout from triggering while we're processing the accept
    if (acceptTimeoutRef.current) {
      clearTimeout(acceptTimeoutRef.current);
      acceptTimeoutRef.current = null;
      console.log('✅ Cleared 60-second timeout before processing accept');
    } else {
      console.log('⚠️ No acceptTimeoutRef to clear (may have already triggered)');
    }

    try {
      const auth = getStoredAuth();
      if (auth?.userType !== 'employee' || !acceptSessionId || !isCurrentDispatch(acceptSessionId, generation)) {
        throw new Error('Employee work session is unavailable.');
      }

      let assignmentCode = generateAssignmentId();
      let { data: acceptResult, error: acceptError } = await supabase.rpc(
        'accept_dispatch_assignment_secure',
        {
          p_user_id: auth.user.id,
          p_session_token: auth.financialSessionToken,
          p_tab_id: auth.tabId,
          p_session_id: acceptSessionId,
          p_assignment_id: orderId,
          p_assignment_code: assignmentCode,
        },
      );

      if (!isCurrentDispatch(acceptSessionId, generation) || currentOrderRef.current?.id !== orderId) return;
      if (!acceptError && acceptResult?.reason === 'assignment_code_conflict') {
        assignmentCode = generateAssignmentId();
        const retry = await supabase.rpc('accept_dispatch_assignment_secure', {
          p_user_id: auth.user.id,
          p_session_token: auth.financialSessionToken,
          p_tab_id: auth.tabId,
          p_session_id: acceptSessionId,
          p_assignment_id: orderId,
          p_assignment_code: assignmentCode,
        });
        acceptResult = retry.data;
        acceptError = retry.error;
      }

      if (!isCurrentDispatch(acceptSessionId, generation) || currentOrderRef.current?.id !== orderId) return;
      if (acceptError) throw acceptError;

      if (acceptResult?.reason === 'grab_failed') {
        setShowGrabFailedModal(true);
        setCurrentOrder(null);
        setShowOrderDetail(false);
        setNextOrderTime(null);
        grabFailedTimerRef.current = setTimeout(() => {
          setShowGrabFailedModal(false);
          scheduleNextOrder();
          grabFailedTimerRef.current = null;
        }, 10000);
        setIsAccepting(false);
        return;
      }

      if (!acceptResult?.success) {
        if (acceptResult?.reason === 'accept_deadline_reached') {
          void handleAcceptTimeoutRef.current?.(orderId);
        } else {
          // already_resolved can mean the first accept succeeded but its response was lost.
          await recoverDispatchState(acceptSessionId, generation);
        }
        return;
      }

      unacceptedCountRef.current = 0;
      setUnacceptedCount(0);
      setCurrentOrder({
        ...currentOrder,
        status: 'accepted',
        accepted_at: acceptResult.accepted_at,
        assignment_id: acceptResult.assignment_code || assignmentCode,
        order_submitted: false,
      });
      setIsAccepting(false);

      if (isMobile) {
        setTimeout(() => {
          setShowGrabSuccessAnimation(true);
          setTimeout(() => setShowGrabSuccessAnimation(false), 1200);
        }, 50);
      } else {
        requestAnimationFrame(() => {
          setShowGrabSuccessAnimation(true);
          setTimeout(() => setShowGrabSuccessAnimation(false), 1500);
        });
      }

      setTimeout(() => {
        updateActivity();
        void loadTodayOrders().catch(err => console.error('Failed to reload orders:', err));
      }, isMobile ? 200 : 100);
    } catch (error: unknown) {
      if (acceptSessionId && isCurrentDispatch(acceptSessionId, generation) && currentOrderRef.current?.id === orderId) {
        console.error('Failed to confirm order acceptance:', error);
        try {
          // The request may have succeeded even when its response failed.
          await recoverDispatchState(acceptSessionId, generation);
        } catch (recoveryError) {
          if (isCurrentDispatch(acceptSessionId, generation) && currentOrderRef.current?.id === orderId) {
            showNotification({
              type: 'error', title: 'Order Accept Status Unknown',
              message: `Could not confirm acceptance: ${getOrderDispatchErrorMessage(recoveryError)}. Please try again before the original deadline.`,
              duration: 6000,
            });
            if (currentOrder.accept_deadline_at) {
              const remaining = Math.max(0, new Date(currentOrder.accept_deadline_at).getTime() - Date.now());
              acceptTimeoutRef.current = setTimeout(() => {
                void handleAcceptTimeoutRef.current?.(orderId);
              }, remaining);
            }
          }
        }
      }
    } finally {
      if (componentMountedRef.current) setIsAccepting(false);
    }
  };

  const reconcileUncertainFinish = async (
    orderId: string, sessionId: string, generation: number, title: string, failure: unknown,
  ) => {
    if (!isCurrentDispatch(sessionId, generation) || currentOrderRef.current?.id !== orderId) return;
    try {
      const outcome = await recoverDispatchState(sessionId, generation);
      if (outcome.state === 'active' && componentMountedRef.current) {
        showNotification({
          type: 'warning', title,
          message: `${getOrderDispatchErrorMessage(failure)}. This assignment is still ${outcome.assignment.status}; please try again before its timeout.`,
          duration: 6000,
        });
      }
    } catch (recoveryError) {
      if (!isCurrentDispatch(sessionId, generation) || currentOrderRef.current?.id !== orderId) return;
      console.error('Failed to verify assignment after finish request:', recoveryError);
      showNotification({
        type: 'error', title,
        message: `${getOrderDispatchErrorMessage(failure)}. Could not confirm the order status: ${getOrderDispatchErrorMessage(recoveryError)}. The order is still shown; retry or wait for its timeout.`,
        duration: 0,
      });
    }
  };

  const handleCompleteOrder = async () => {
    if (!currentOrder || isCompleting) return;
    const orderId = currentOrder.id;
    const sessionId = sessionIdRef.current;
    const generation = lifecycleGenerationRef.current;
    if (!sessionId || !isCurrentDispatch(sessionId, generation)) return;
    setIsCompleting(true);

    try {
      if (currentOrder.assignment_id && !currentOrder.order_submitted) {
        const { data: freshData, error: fetchError } = await supabase
          .from('dispatch_assignments')
          .select('order_submitted')
          .eq('id', orderId)
          .maybeSingle();
        if (!isCurrentDispatch(sessionId, generation) || currentOrderRef.current?.id !== orderId) return;
        if (fetchError) throw fetchError;
        if (!freshData?.order_submitted) {
          setShowOrderNotSubmittedModal(true);
          return;
        }
        setCurrentOrder(prev => prev?.id === orderId ? { ...prev, order_submitted: true } : prev);
      }

      const auth = getStoredAuth();
      if (auth?.userType !== 'employee') throw new Error('Employee session has expired.');
      const { data: result, error } = await supabase.rpc('finish_dispatch_assignment_secure', {
        p_user_id: auth.user.id,
        p_session_token: auth.financialSessionToken,
        p_tab_id: auth.tabId,
        p_assignment_id: orderId,
        p_status: 'completed',
        p_remarks: null,
      });
      if (!isCurrentDispatch(sessionId, generation) || currentOrderRef.current?.id !== orderId) return;
      if (error) throw error;
      if (!result?.success) throw new Error('Completion was not applied; checking the current assignment status.');

      if (acceptTimeoutRef.current) clearTimeout(acceptTimeoutRef.current);
      if (processTimeoutRef.current) clearTimeout(processTimeoutRef.current);
      currentOrderRef.current = null;
      setCurrentOrder(null);
      setShowOrderDetail(false);
      setHasTimeout(false);
      setShowTimeoutAlert(false);
      updateActivity();
      void loadTodayOrders();
      void scheduleNextOrder();
    } catch (error: unknown) {
      console.error('Failed to complete order:', error);
      await reconcileUncertainFinish(orderId, sessionId, generation, 'Order Completion Status Unknown', error);
    } finally {
      if (componentMountedRef.current) setIsCompleting(false);
    }
  };

  const handleErrorOrder = () => {
    setShowErrorModal(true);
  };

  const handleSubmitError = async () => {
    if (!currentOrder || isReporting) return;
    if (!errorReason.trim()) {
      alert('Please provide an error reason');
      return;
    }
    const orderId = currentOrder.id;
    const sessionId = sessionIdRef.current;
    const generation = lifecycleGenerationRef.current;
    if (!sessionId || !isCurrentDispatch(sessionId, generation)) return;
    setIsReporting(true);

    try {
      const auth = getStoredAuth();
      if (auth?.userType !== 'employee') throw new Error('Employee session has expired.');
      const { data: result, error } = await supabase.rpc('finish_dispatch_assignment_secure', {
        p_user_id: auth.user.id,
        p_session_token: auth.financialSessionToken,
        p_tab_id: auth.tabId,
        p_assignment_id: orderId,
        p_status: 'error',
        p_remarks: errorReason,
      });
      if (!isCurrentDispatch(sessionId, generation) || currentOrderRef.current?.id !== orderId) return;
      if (error) throw error;
      if (!result?.success) throw new Error('Error report was not applied; checking the current assignment status.');

      if (acceptTimeoutRef.current) clearTimeout(acceptTimeoutRef.current);
      if (processTimeoutRef.current) clearTimeout(processTimeoutRef.current);
      currentOrderRef.current = null;
      setCurrentOrder(null);
      setShowOrderDetail(false);
      setHasTimeout(false);
      setShowTimeoutAlert(false);
      setShowErrorModal(false);
      setErrorReason('');
      updateActivity();
      void loadTodayOrders();
      void scheduleNextOrder();
    } catch (error: unknown) {
      console.error('Failed to submit error report:', error);
      await reconcileUncertainFinish(orderId, sessionId, generation, 'Error Report Status Unknown', error);
    } finally {
      if (componentMountedRef.current) setIsReporting(false);
    }
  };

  const handleCancelError = () => {
    setShowErrorModal(false);
    setErrorReason('');
  };

  const getStatusBadge = (status: string) => {
    const badges = {
      pending: { text: t.dispatch.statusPending, color: 'bg-white/15 text-white border border-white/25 backdrop-blur-sm' },
      accepted: { text: t.dispatch.inProgress, color: 'bg-blue-50 text-blue-600 border border-blue-200' },
      completed: { text: t.dispatch.completed, color: 'bg-emerald-50 text-emerald-600 border border-emerald-200' },
      error: { text: t.dispatch.error, color: 'bg-rose-50 text-rose-600 border border-rose-200' },
      cancelled: { text: t.dispatch.cancelled, color: 'bg-gray-100 text-gray-500 border border-gray-200' },
      timeout: { text: t.dispatch.timeout, color: 'bg-orange-50 text-orange-600 border border-orange-200' },
    };
    const badge = badges[status as keyof typeof badges] || badges.pending;
    return <span className={`px-2 py-1 md:px-4 md:py-1.5 rounded-full text-[10px] md:text-xs font-semibold ${badge.color}`}>{badge.text}</span>;
  };

  const formatTime = (date: Date | null) => {
    if (!date) return '--:--:--';
    return date.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const handleOrderClick = (order: DispatchAssignment) => {
    // If order is accepted (displayed as "In Progress"), reopen the feedback panel
    if (order.status === 'accepted') {
      setCurrentOrder(order);
      // The useEffect will handle setting up timeouts via startTimeoutCheck()
      return;
    }

    // For other statuses, show detail modal
    setSelectedOrderDetail(order);
    setShowOrderDetailModal(true);
  };

  // Unified cleanup for all timers on component unmount
  // This prevents memory leaks and ensures proper cleanup
  useEffect(() => {
    return () => {
      console.log('🧹 OrderDispatch unmounting - cleaning up all timers');

      if (acceptTimeoutRef.current) {
        clearTimeout(acceptTimeoutRef.current);
        acceptTimeoutRef.current = null;
      }

      if (dispatchTimerRef.current) {
        clearTimeout(dispatchTimerRef.current);
        dispatchTimerRef.current = null;
      }

      if (processTimeoutRef.current) {
        clearTimeout(processTimeoutRef.current);
        processTimeoutRef.current = null;
      }

      if (fiveMinuteWarningRef.current) {
        clearTimeout(fiveMinuteWarningRef.current);
        fiveMinuteWarningRef.current = null;
      }

      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }

      if (activityTimerRef.current) {
        clearInterval(activityTimerRef.current);
        activityTimerRef.current = null;
      }

      if (grabFailedTimerRef.current) {
        clearTimeout(grabFailedTimerRef.current);
        grabFailedTimerRef.current = null;
      }

      console.log('✅ All timers cleaned up successfully');
    };
  }, []);  // Empty dependency array - only run on mount/unmount

  return (
    <div className="space-y-8 pb-12 lg:pb-6">

      {/* Timeout Alert Modal */}
      {showTimeoutAlert && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-300" style={{ touchAction: 'none', overscrollBehavior: 'contain' }}>
          <div className="bg-white rounded-2xl max-w-sm w-full shadow-[0_24px_80px_-12px_rgba(0,0,0,0.25)] animate-in zoom-in-95 duration-300 overflow-hidden">
            <div className="relative bg-gradient-to-br from-slate-50 to-amber-50/40 px-6 pt-7 pb-5 border-b border-slate-100">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500"></div>
              <div className="flex flex-col items-center">
                <div className="relative mb-3">
                  <div className="relative w-14 h-14 bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-200/80 rounded-2xl flex items-center justify-center shadow-sm">
                    <AlertTriangle className="w-7 h-7 text-amber-600" />
                  </div>
                </div>
                <h3 className="text-lg font-bold text-slate-800 text-center tracking-tight" style={{ fontFamily: "'Inter', 'SF Pro Display', -apple-system, system-ui, sans-serif" }}>
                  {t.dispatch.timeoutAlert}
                </h3>
              </div>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-slate-600 text-center leading-relaxed mb-5">
                {t.dispatch.timeoutAlertMsg}
              </p>
              <button
                onClick={() => setShowTimeoutAlert(false)}
                className="w-full px-4 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 active:scale-[0.98] text-white rounded-xl font-semibold text-sm shadow-lg shadow-blue-500/25 transition-all flex items-center justify-center gap-2"
              >
                <CheckCircle className="w-4 h-4" />
                <span>{t.dispatch.iUnderstand}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auto-Stop Order Processing Modal */}
      {showAutoStopModal && createPortal(
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999] p-4 animate-in fade-in duration-200"
          style={{ touchAction: 'none', overscrollBehavior: 'contain' }}
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="bg-gradient-to-r from-rose-500 to-pink-500 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-white" />
                </div>
                <h3 className="text-lg font-bold text-white">{t.dispatch.processingEnded}</h3>
              </div>
            </div>

            <div className="px-6 py-5">
              {/* Stop reason */}
              <div className="flex items-start gap-3 mb-4">
                <div className="w-7 h-7 rounded-lg bg-rose-50 border border-rose-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <XCircle className="w-3.5 h-3.5 text-rose-500" />
                </div>
                <p className="text-sm text-gray-700 leading-relaxed">
                  {t.dispatch.autoStopMsg} <span className="font-bold text-rose-600">{t.dispatch.fiveOrdersInRow}</span>.
                </p>
              </div>

              {/* Resume hint */}
              <div className="flex items-center gap-3 px-3.5 py-2.5 bg-blue-50 border border-blue-200 rounded-xl mb-5">
                <Play className="w-4 h-4 text-blue-500 flex-shrink-0" />
                <p className="text-xs text-gray-600 font-medium">
                  {t.dispatch.resumeMsg} <span className="font-bold text-blue-700">{t.dispatch.start}</span> {t.dispatch.resumeMsg2}
                </p>
              </div>

              {/* Button */}
              <button
                onClick={() => setShowAutoStopModal(false)}
                className="w-full px-4 py-2.5 bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 active:scale-[0.98] text-white rounded-xl font-bold text-sm shadow-sm transition-all flex items-center justify-center gap-2"
              >
                <CheckCircle className="w-4 h-4" />
                <span>{t.dispatch.iUnderstand}</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Notification System */}
      {notifications.length > 0 && (
        <div className="fixed top-16 right-4 z-[60] space-y-3 max-w-md">
          {notifications.map((notif) => (
            <div
              key={notif.id}
              className={`
                animate-in slide-in-from-top-5 fade-in duration-300
                backdrop-blur-xl rounded-2xl shadow-2xl border-2 p-4 pr-12
                ${notif.type === 'success' ? 'bg-emerald-900/90 border-emerald-500/50' : ''}
                ${notif.type === 'error' ? 'bg-rose-900/90 border-rose-500/50' : ''}
                ${notif.type === 'warning' ? 'bg-amber-900/90 border-amber-500/50' : ''}
                ${notif.type === 'info' ? 'bg-cyan-900/90 border-cyan-500/50' : ''}
              `}
            >
              <div className="flex items-start space-x-3">
                {notif.type === 'success' && (
                  <CheckCircle className="w-6 h-6 text-emerald-400 flex-shrink-0 mt-0.5" />
                )}
                {notif.type === 'error' && (
                  <XCircle className="w-6 h-6 text-rose-400 flex-shrink-0 mt-0.5" />
                )}
                {notif.type === 'warning' && (
                  <AlertTriangle className="w-6 h-6 text-amber-400 flex-shrink-0 mt-0.5" />
                )}
                {notif.type === 'info' && (
                  <AlertCircle className="w-6 h-6 text-blue-600 flex-shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <h4 className="text-white font-bold text-sm mb-1">{notif.title}</h4>
                  <p className={`text-sm leading-relaxed ${
                    notif.type === 'success' ? 'text-emerald-200' :
                    notif.type === 'error' ? 'text-rose-200' :
                    notif.type === 'warning' ? 'text-amber-200' :
                    'text-cyan-200'
                  }`}>{notif.message}</p>
                </div>
              </div>
              <button
                onClick={() => dismissNotification(notif.id)}
                className="absolute top-2 right-2 w-9 h-9 flex items-center justify-center rounded-xl hover:bg-white/10 transition-colors"
              >
                <XCircle className="w-4 h-4 text-white/60" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Grab Success Animation - Desktop: Full, Tablet: Optimized, Mobile: Toast */}
      {showGrabSuccessAnimation && (
        <>
          {/* Mobile: Lightweight Toast Notification - Portaled to body to avoid layout shifts */}
          {isMobile ? createPortal(
            <div
              className="fixed top-16 left-1/2 z-[9999] pointer-events-none"
              style={{
                transform: 'translateX(-50%)',
                animation: 'slideDownBounce 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)'
              }}
            >
              <div className="bg-emerald-500 text-white px-7 py-4 rounded-xl shadow-2xl flex items-center space-x-4 min-w-[300px]">
                <div className="flex-shrink-0">
                  <CheckCircle className="w-7 h-7" strokeWidth={2.5} />
                </div>
                <div className="flex-1">
                  <p className="font-bold text-lg">{t.dispatch.orderAccepted}</p>
                </div>
              </div>
            </div>,
            document.body
          ) : isTablet ? (
            /* Tablet: Optimized Animation - No particles, no blur, GPU-accelerated */
            createPortal(
              <div
                className="fixed inset-0 z-[9999] pointer-events-none flex items-center justify-center"
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  transform: 'translateZ(0)',
                  willChange: 'opacity'
                }}
              >
                <div className="relative text-center animate-in zoom-in duration-200">
                  <div className="mb-4">
                    <div className="w-28 h-28 mx-auto bg-emerald-500/20 rounded-full flex items-center justify-center border-3 border-emerald-400">
                      <CheckCircle className="w-16 h-16 text-emerald-300" strokeWidth={2.5} />
                    </div>
                  </div>
                  <h2 className="text-5xl font-black text-emerald-300">
                    {t.dispatch.grabSuccess}
                  </h2>
                  <p className="text-xl text-emerald-200 mt-3 font-bold">
                    {t.dispatch.orderGrabbedSuccessfully}
                  </p>
                </div>

                {/* Single Ring - Tablet Only */}
                <div
                  className="absolute w-48 h-48 border-2 border-emerald-400/30 rounded-full"
                  style={{
                    left: '50%',
                    top: '50%',
                    transform: 'translate(-50%, -50%)',
                    animation: 'tabletRipple 0.8s ease-out forwards'
                  }}
                />
              </div>,
              document.body
            )
          ) : (
            /* Desktop: Full Animation Experience - Portal to body for true viewport centering */
            createPortal(
              <div
                className="fixed inset-0 z-[9999] pointer-events-none flex items-center justify-center"
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0
                }}
              >
                {/* Particle Explosion Effect - Desktop Only */}
                {performanceSettings.enableParticles && (
                  <div className="absolute inset-0 overflow-hidden">
                    {[...Array(30)].map((_, i) => (
                      <div
                        key={i}
                        className="absolute w-3 h-3 bg-gradient-to-br from-emerald-400 to-green-500 rounded-full animate-float-particle"
                        style={{
                          left: '50%',
                          top: '50%',
                          animationDelay: `${i * 0.05}s`,
                          animationDuration: `${1 + Math.random()}s`,
                          transform: `translate(-50%, -50%) rotate(${i * 12}deg) translateY(-${50 + Math.random() * 100}px)`
                        }}
                      />
                    ))}
                  </div>
                )}

                {/* Success Text with Glow */}
                <div className="relative">
                  {performanceSettings.enableComplexGradients && (
                    <div className="absolute inset-0 blur-3xl bg-emerald-500/60 animate-pulse"></div>
                  )}
                  <div className={`relative text-center ${performanceSettings.reduceTransitions ? 'animate-in fade-in duration-200' : 'animate-in zoom-in duration-300'}`}>
                    <div className="mb-6">
                      <div className={`w-40 h-40 mx-auto bg-gradient-to-br from-emerald-500/30 to-green-600/30 rounded-full flex items-center justify-center border-4 border-emerald-400 ${performanceSettings.enableAnimations ? 'animate-pulse-ring' : ''}`}>
                        <CheckCircle className="w-24 h-24 text-emerald-300" strokeWidth={3} />
                      </div>
                    </div>
                    <h2 className={`text-7xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 via-green-200 to-emerald-300 ${performanceSettings.enableAnimations ? 'animate-shimmer bg-[length:200%_auto]' : ''} ${performanceSettings.enableComplexGradients ? 'drop-shadow-[0_0_30px_rgba(16,185,129,0.8)]' : ''}`}>
                      {t.dispatch.grabSuccess}
                    </h2>
                    <p className={`text-2xl text-emerald-200 mt-4 font-bold ${performanceSettings.enableComplexGradients ? 'drop-shadow-[0_0_10px_rgba(16,185,129,0.6)]' : ''}`}>
                      {t.dispatch.orderGrabbedSuccessfully}
                    </p>
                  </div>
                </div>

                {/* Expanding Rings - Desktop Only */}
                {performanceSettings.enableAnimations && [...Array(3)].map((_, i) => (
                  <div
                    key={`ring-${i}`}
                    className="absolute w-64 h-64 border-4 border-emerald-400/40 rounded-full animate-ripple-wave"
                    style={{
                      left: '50%',
                      top: '50%',
                      transform: 'translate(-50%, -50%)',
                      animationDelay: `${i * 0.3}s`
                    }}
                  />
                ))}
              </div>,
              document.body
            )
          )}
        </>
      )}

      {/* Grab Failed Modal - Premium Design */}
      {showGrabFailedModal && createPortal(
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999] p-4 animate-in fade-in duration-200"
          style={{ touchAction: 'none', overscrollBehavior: 'contain' }}
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-white" />
                </div>
                <h3 className="text-lg font-bold text-white">{t.dispatch.orderClaimed}</h3>
              </div>
            </div>

            <div className="px-6 py-5">
              {/* Main message */}
              <div className="flex items-start gap-3 mb-4">
                <div className="w-7 h-7 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Zap className="w-3.5 h-3.5 text-amber-600" />
                </div>
                <p className="text-sm text-gray-700 leading-relaxed">{t.dispatch.claimedMsg}</p>
              </div>

              {/* Timing info */}
              <div className="flex items-center gap-3 px-3.5 py-2.5 bg-blue-50 border border-blue-200 rounded-xl mb-5">
                <Clock className="w-4 h-4 text-blue-500 flex-shrink-0" />
                <p className="text-xs text-gray-600 font-medium">
                  {t.dispatch.nextDispatching} <span className="font-bold text-blue-700">10 {t.dispatch.seconds}</span>
                </p>
              </div>

              {/* Button */}
              <button
                onClick={handleCloseGrabFailedModal}
                className="w-full px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 active:scale-[0.98] text-white rounded-xl font-bold text-sm shadow-sm transition-all flex items-center justify-center gap-2"
              >
                <CheckCircle className="w-4 h-4" />
                <span>{t.dispatch.continue}</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showTimeoutStopModal && createPortal(
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4 animate-in fade-in duration-300"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            overflow: 'auto',
            touchAction: 'none',
            overscrollBehavior: 'contain'
          }}
        >
          <div className="bg-white rounded-2xl max-w-md w-full shadow-[0_24px_80px_-12px_rgba(0,0,0,0.25)] animate-in zoom-in-95 duration-300 overflow-hidden">
            {/* Top accent + icon header */}
            <div className="relative bg-gradient-to-br from-slate-50 to-blue-50/60 px-6 pt-8 pb-6 border-b border-slate-100">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500"></div>
              <div className="flex flex-col items-center">
                <div className="relative mb-4">
                  <div className="absolute inset-0 bg-amber-400/20 rounded-full blur-xl"></div>
                  <div className="relative w-16 h-16 bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-200/80 rounded-2xl flex items-center justify-center shadow-sm">
                    <Clock className="w-8 h-8 text-amber-600" />
                  </div>
                </div>
                <h3 className="text-xl font-bold text-slate-800 text-center tracking-tight" style={{ fontFamily: "'Inter', 'SF Pro Display', -apple-system, system-ui, sans-serif" }}>
                  {t.dispatch.orderProcessingEnded}
                </h3>
              </div>
            </div>

            {/* Body */}
            <div className="px-6 py-5">
              {/* Reason card */}
              <div className="flex items-start gap-3 mb-4">
                <div className="w-7 h-7 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <XCircle className="w-3.5 h-3.5 text-amber-600" />
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">
                  {t.dispatch.notCompletedWithin} <span className="font-semibold text-slate-800">{t.dispatch.notCompletedMinutes.replace('{min}', String(timeoutStopMinutes))}</span>. {t.dispatch.orderAutoSkipped}
                </p>
              </div>

              {/* Resume hint */}
              <div className="flex items-center gap-3 px-4 py-3 bg-blue-50/80 border border-blue-100 rounded-xl mb-5">
                <Play className="w-4 h-4 text-blue-500 flex-shrink-0" />
                <p className="text-xs text-slate-600 leading-relaxed">
                  {t.dispatch.pleaseClickStart} <span className="font-bold text-blue-600">{t.dispatch.startText}</span> {t.dispatch.resumeAccepting}
                </p>
              </div>

              {/* Button */}
              <button
                onClick={() => setShowTimeoutStopModal(false)}
                className="w-full px-4 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 active:scale-[0.98] text-white rounded-xl font-semibold text-sm shadow-lg shadow-blue-500/25 transition-all flex items-center justify-center gap-2"
              >
                <CheckCircle className="w-4 h-4" />
                <span>{t.dispatch.iUnderstand}</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {session.isWorking && dispatchPause && (
        <div role="status" className={`rounded-xl border px-4 py-3 text-sm font-medium ${dispatchPause.type === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
          <strong>Dispatch paused.</strong> {dispatchPause.message} Checking again in five minutes. You can stop work at any time.
        </div>
      )}

      {/* Work Control Panel - Premium Blue/White Design */}
      <div className={`relative rounded-2xl md:rounded-3xl ${currentOrder?.status === 'accepted' && acceptPhase === 'idle' ? 'p-0' : currentOrder?.status === 'accepted' ? 'p-2 md:p-4' : 'p-5 md:p-10'} overflow-hidden transition-all duration-500 ease-out ${
        session.isWorking
          ? 'bg-gradient-to-br from-white via-blue-50/80 to-white border-2 border-blue-300/70 shadow-[0_12px_48px_-8px_rgba(37,99,235,0.22),0_4px_16px_-4px_rgba(37,99,235,0.12)]'
          : 'bg-white border-2 border-blue-200 shadow-[0_8px_40px_-8px_rgba(37,99,235,0.15),0_2px_12px_-2px_rgba(0,0,0,0.08)]'
      }`}>
        {/* Inner gradient background for depth */}
        <div className={`absolute inset-0 pointer-events-none transition-all duration-500 ${
          session.isWorking
            ? 'bg-gradient-to-br from-blue-100/40 via-white to-blue-50/30'
            : 'bg-gradient-to-br from-blue-50/60 via-white to-blue-50/20'
        }`}></div>
        {/* Top accent border */}
        <div className={`absolute top-0 left-0 right-0 rounded-t-2xl md:rounded-t-3xl transition-all duration-500 ${
          session.isWorking ? 'h-1.5 bg-gradient-to-r from-blue-500 via-blue-400 to-blue-500' : 'h-1 bg-gradient-to-r from-blue-400 via-blue-500 to-blue-400'
        }`}></div>

        {/* Content */}
        <div className="relative z-10">
          <div className={`transition-all duration-400 ease-out overflow-hidden ${
            currentOrder?.status === 'accepted' ? 'max-h-0 opacity-0 mb-0 pointer-events-none' : 'max-h-[500px] opacity-100 mb-0'
          }`} style={{ transitionProperty: 'max-height, opacity, margin' }}>
          {(!(currentOrder?.status === 'accepted') || acceptPhase !== 'idle') && (
          <>{/* Header Section - Tablet optimized horizontal layout */}
          {isTablet ? (
            /* TABLET: Compact horizontal layout */
            <div className="flex items-center justify-between mb-6 space-x-4">
              {/* Left: Logo + Title */}
              <div className="flex items-center gap-3 flex-shrink-0">
                {/* Icon */}
                <div className={`p-3 rounded-2xl transition-all duration-500 ${
                  session.isWorking
                    ? 'bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-500/20'
                    : 'bg-blue-50 border border-blue-100'
                }`}>
                  <Timer className={`w-5 h-5 ${session.isWorking ? 'text-white' : 'text-blue-600'}`} />
                </div>

                {/* Title + Status */}
                <div>
                  <h3 className="text-lg font-semibold text-blue-700 tracking-[-0.02em]" style={{ fontFamily: "'Inter', 'SF Pro Display', -apple-system, system-ui, sans-serif" }}>{t.dispatch.orderProcessing}</h3>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <div className={`w-2 h-2 rounded-full ${session.isWorking ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`}></div>
                    <p className={`text-xs font-medium ${session.isWorking ? 'text-green-600' : 'text-slate-400'}`}>
                      {session.isWorking ? t.dispatch.active : t.dispatch.readyToStart}
                      {session.isWorking && <span className="text-slate-300 ml-1.5">|</span>}
                      {session.isWorking && <span className="text-slate-400 ml-1.5">{formatTime(session.startedAt)}</span>}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* DESKTOP & MOBILE: Blue/White premium layout */
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-5 md:mb-10 space-y-4 md:space-y-0">
              {/* Mobile: Full-width status banner */}
              <div className="w-full md:w-auto">
                <div className="flex items-center gap-3 md:gap-4">
                  {/* Icon - Distinct from title */}
                  <div className={`relative p-3.5 md:p-4 rounded-2xl transition-all duration-500 ${
                    session.isWorking
                      ? 'bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-500/25 ring-4 ring-blue-100'
                      : 'bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200'
                  }`}>
                    <Timer className={`w-6 h-6 md:w-6 md:h-6 transition-colors duration-500 ${
                      session.isWorking ? 'text-white' : 'text-blue-600'
                    }`} />
                    {session.isWorking && (
                      <div className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-green-400 rounded-full border-2 border-white shadow-sm animate-pulse"></div>
                    )}
                  </div>

                  <div className="flex-1">
                    <h3 className="text-lg md:text-xl font-bold text-blue-800 tracking-[-0.02em]" style={{ fontFamily: "'Inter', 'SF Pro Display', -apple-system, system-ui, sans-serif" }}>
                      {t.dispatch.orderProcessing}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-all duration-300 ${
                        session.isWorking
                          ? 'bg-green-50 border border-green-200'
                          : 'bg-slate-50 border border-slate-200'
                      }`}>
                        <div className={`w-2 h-2 rounded-full transition-all duration-300 ${
                          session.isWorking ? 'bg-green-500 animate-pulse' : 'bg-slate-300'
                        }`}></div>
                        <span className={`text-[11px] font-semibold transition-colors duration-300 ${
                          session.isWorking ? 'text-green-700' : 'text-slate-500'
                        }`}>
                          {session.isWorking ? t.dispatch.active : t.dispatch.standby}
                        </span>
                      </div>
                      {session.isWorking && (
                        <span className="text-[11px] text-slate-400 font-medium">{formatTime(session.startedAt)}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          </>)}
          </div>

          {/* Main Action Area - Balanced Display */}
          {currentOrder ? (
            /* ORDER DISPLAY - Advanced Blockchain Design */
            <div className={`relative backdrop-blur-sm overflow-hidden transition-all duration-700 ease-out ${currentOrder.status === 'accepted' ? (isTablet ? 'border-0 rounded-none shadow-none' : 'border-0 rounded-none shadow-none flex flex-col') : 'border md:border-2 rounded-xl md:rounded-3xl shadow-lg md:shadow-2xl'} ${
              currentOrder.status === 'pending'
                ? 'bg-gradient-to-br from-blue-600 via-blue-700 to-blue-800 border-blue-400/40 shadow-blue-900/50'
                : hasTimeout
                ? 'bg-gradient-to-br from-rose-900/80 to-red-900/80 border-rose-500/50 shadow-rose-500/30'
                : 'bg-gradient-to-br from-sky-50 via-blue-50 to-indigo-50 border-blue-300/60 shadow-blue-200/50'
            }`}>
              {/* Background pattern for pending */}
              {currentOrder.status === 'pending' && (
                <div className="absolute inset-0 opacity-[0.06] pointer-events-none" style={{
                  backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.5) 1px, transparent 1px)',
                  backgroundSize: '24px 24px'
                }}></div>
              )}

              {/* Gradient overlay */}
              <div className={`absolute inset-0 pointer-events-none ${
                currentOrder.status === 'pending'
                  ? 'bg-gradient-to-br from-blue-500/20 via-transparent to-blue-900/30'
                  : hasTimeout
                  ? ''
                  : 'bg-gradient-to-br from-sky-100/40 via-transparent to-blue-100/30'
              }`}></div>

              {/* Corner accents */}
              <div className={`absolute top-2 left-2 md:top-4 md:left-4 w-6 h-6 md:w-8 md:h-8 border-t-2 border-l-2 rounded-tl-md transition-all duration-500 ${
                currentOrder.status === 'pending' ? 'border-blue-300/50' : hasTimeout ? 'border-rose-400/60' : 'border-blue-400/60'
              }`}></div>
              <div className={`absolute top-2 right-2 md:top-4 md:right-4 w-6 h-6 md:w-8 md:h-8 border-t-2 border-r-2 rounded-tr-md transition-all duration-500 ${
                currentOrder.status === 'pending' ? 'border-blue-300/50' : hasTimeout ? 'border-rose-400/60' : 'border-blue-400/60'
              }`}></div>
              <div className={`absolute bottom-2 left-2 md:bottom-4 md:left-4 w-6 h-6 md:w-8 md:h-8 border-b-2 border-l-2 rounded-bl-md transition-all duration-500 ${
                currentOrder.status === 'pending' ? 'border-blue-300/50' : hasTimeout ? 'border-rose-400/60' : 'border-blue-400/60'
              }`}></div>
              <div className={`absolute bottom-2 right-2 md:bottom-4 md:right-4 w-6 h-6 md:w-8 md:h-8 border-b-2 border-r-2 rounded-br-md transition-all duration-500 ${
                currentOrder.status === 'pending' ? 'border-blue-300/50' : hasTimeout ? 'border-rose-400/60' : 'border-blue-400/60'
              }`}></div>

              {/* Scanning Lines */}
              {currentOrder.status === 'pending' && (
                <>
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-300/60 to-transparent animate-scan"></div>
                  <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-blue-300/60 to-transparent animate-scan" style={{animationDelay: '1s'}}></div>
                </>
              )}
              {currentOrder.status === 'accepted' && !hasTimeout && (
                <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-sky-400/50 to-transparent"></div>
              )}

              {/* Ambient glow orbs */}
              <div className={`absolute top-1/4 -left-20 w-40 h-40 rounded-full blur-3xl animate-pulse ${
                currentOrder.status === 'pending' ? 'bg-blue-400/20' : hasTimeout ? 'bg-rose-400/15' : 'bg-sky-300/20'
              }`}></div>
              <div className={`absolute bottom-1/4 -right-20 w-40 h-40 rounded-full blur-3xl animate-pulse ${
                currentOrder.status === 'pending' ? 'bg-sky-300/15' : hasTimeout ? 'bg-red-400/15' : 'bg-blue-300/15'
              }`} style={{animationDelay: '1s'}}></div>

              <div className={`relative p-3 md:p-8 z-10 ${currentOrder.status === 'accepted' ? (isTablet ? 'flex flex-col' : 'flex-1 flex flex-col') : ''} transition-all duration-500 ease-out ${
                acceptPhase === 'fade-out' ? 'opacity-0 scale-[0.98] translate-y-1' : acceptPhase === 'fade-in' ? 'animate-[acceptFadeIn_0.5s_ease-out_forwards]' : ''
              }`}>
                {/* Premium Header with Blockchain Aesthetic */}
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-3 md:mb-6 space-y-2 md:space-y-0">
                  <div className="flex items-center space-x-2 md:space-x-4">
                    {/* Enhanced Icon Container */}
                    <div className="relative">
                      {/* Glow effect */}
                      <div className={`absolute inset-0 rounded-xl md:rounded-2xl blur-lg ${
                        currentOrder.status === 'pending'
                          ? 'bg-amber-400/30 animate-pulse'
                          : hasTimeout
                          ? 'bg-rose-500/50 animate-pulse'
                          : 'bg-blue-500/20'
                      }`}></div>

                      {/* Icon container */}
                      <div className={`relative w-10 h-10 md:w-16 md:h-16 rounded-xl md:rounded-2xl flex items-center justify-center border-2 ${
                        currentOrder.status === 'pending'
                          ? 'bg-gradient-to-br from-amber-400 to-amber-500 border-amber-300/60 shadow-lg shadow-amber-500/30'
                          : hasTimeout
                          ? 'bg-gradient-to-br from-rose-500/30 to-red-500/30 border-rose-400/60'
                          : 'bg-gradient-to-br from-blue-500 to-blue-600 border-blue-300/50 shadow-lg shadow-blue-500/20'
                      }`}>
                        <Package className={`w-5 h-5 md:w-9 md:h-9 ${
                          currentOrder.status === 'pending'
                            ? 'text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.7)]'
                            : hasTimeout
                            ? 'text-rose-300 drop-shadow-[0_0_8px_rgba(244,63,94,0.8)]'
                            : 'text-white'
                        } ${currentOrder.status === 'pending' ? 'animate-pulse' : ''}`} />
                      </div>
                    </div>

                    {/* Title Section */}
                    <div>
                      <div className="flex items-center space-x-2 md:space-x-3">
                        <h3 className={`text-base md:text-3xl font-black tracking-tight ${
                          currentOrder.status === 'pending' ? 'text-white' : hasTimeout ? 'text-rose-100 drop-shadow-lg' : 'text-gray-800'
                        }`}>
                          {currentOrder.status === 'pending' ? t.dispatch.newOrderHeading : hasTimeout ? t.dispatch.timeout : t.dispatch.inProgress}
                        </h3>
                        {currentOrder.status === 'pending' && (
                          <div className="flex items-center space-x-1 px-2 py-0.5 md:px-3 md:py-1 bg-white/10 border border-white/25 rounded-md md:rounded-lg backdrop-blur-sm">
                            <div className="w-1.5 h-1.5 md:w-2 md:h-2 bg-emerald-400 rounded-full animate-pulse"></div>
                            <span className="text-[9px] md:text-xs font-bold text-emerald-300 uppercase tracking-wide">{t.dispatch.verified}</span>
                          </div>
                        )}
                        {currentOrder.status === 'accepted' && !hasTimeout && (
                          <div className="flex items-center space-x-1 px-2 py-0.5 md:px-3 md:py-1 bg-emerald-50 border border-emerald-200 rounded-md md:rounded-lg">
                            <div className="w-1.5 h-1.5 md:w-2 md:h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                            <span className="text-[9px] md:text-xs font-bold text-emerald-600 uppercase tracking-wide">{t.dispatch.inProgress}</span>
                          </div>
                        )}
                      </div>
                      <p className={`text-[10px] md:text-sm font-semibold mt-1 md:mt-1.5 flex items-center space-x-2 ${
                        currentOrder.status === 'pending' ? 'text-blue-200/80' : hasTimeout ? 'text-rose-200' : 'text-gray-500'
                      }`}>
                        <Clock className="w-3 h-3 md:w-4 md:h-4" />
                        <span>{currentOrder.status === 'pending' ? t.dispatch.acceptWithin : hasTimeout ? t.dispatch.completeNow : t.dispatch.completeTask}</span>
                      </p>
                    </div>
                  </div>
                  {currentOrder.status === 'accepted' && currentOrder.assignment_id ? (
                    <div className="flex items-center gap-1.5 md:gap-2 px-2 py-1 md:px-4 md:py-1.5 bg-blue-50 border md:border-2 border-blue-300 rounded-full shadow-sm">
                      <div className="w-1.5 h-1.5 md:w-2 md:h-2 bg-blue-500 rounded-full animate-pulse"></div>
                      <span className="hidden md:inline text-[10px] font-bold text-blue-600 uppercase tracking-wider">{t.dispatch.assignmentIdLabel}</span>
                      <span className="text-[10px] md:text-xs font-black text-blue-700 font-mono tracking-widest">{currentOrder.assignment_id}</span>
                      {currentOrder.order_submitted && (
                        <CheckCircle className="w-3 h-3 text-emerald-600" />
                      )}
                    </div>
                  ) : (
                    getStatusBadge(currentOrder.status)
                  )}
                </div>

                {/* Timeout Alert - Compact */}
                {hasTimeout && (
                  <div className="mb-2 md:mb-5 p-1.5 md:p-3 bg-rose-500/15 border border-rose-500/40 rounded-lg md:rounded-xl flex items-center space-x-1.5 md:space-x-3">
                    <AlertTriangle className="w-3.5 h-3.5 md:w-5 md:h-5 text-rose-300 animate-pulse flex-shrink-0" />
                    <div className="text-rose-200 text-[10px] md:text-sm font-semibold">{t.dispatch.exceededTimeout.replace('{min}', String(currentOrder.session_timeout_minutes ?? currentOrder.session_timeout_minutes_snapshot ?? config.session_timeout_minutes))}</div>
                  </div>
                )}

                {/* Order Content - Compact Blockchain Design */}
                {/* MOBILE: Full Width Order Details First */}
                <div className="md:hidden mb-2.5">
                  <div className={`relative backdrop-blur-md rounded-lg p-2.5 border overflow-hidden shadow-sm ${
                    currentOrder.status === 'pending'
                      ? 'bg-white/10 border-white/20'
                      : 'bg-white/90 border-gray-200'
                  }`}>
                    <div className="relative z-10">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center space-x-1.5">
                          <div className={`w-1 h-1 rounded-full animate-pulse ${currentOrder.status === 'pending' ? 'bg-blue-300' : 'bg-blue-500'}`}></div>
                          <FileText className={`w-3 h-3 ${currentOrder.status === 'pending' ? 'text-blue-300' : 'text-blue-500'}`} />
                          <h4 className={`text-[10px] font-bold uppercase tracking-wide ${currentOrder.status === 'pending' ? 'text-white/90' : 'text-gray-700'}`}>{t.dispatch.orderDetails}</h4>
                        </div>
                        {currentOrder.status === 'pending' && (
                          <div className="px-1.5 py-0.5 bg-white/10 border border-white/20 rounded">
                            <span className="text-[8px] font-bold text-blue-200 uppercase">{t.dispatch.locked}</span>
                          </div>
                        )}
                      </div>



                      {currentOrder.status === 'pending' ? (
                        <div className="text-center py-4 relative">
                          <div className="relative">
                            <div className="inline-flex items-center justify-center mb-2">
                              <div className="relative">
                                <div className="absolute inset-0 bg-amber-400/20 rounded-xl blur-md animate-pulse"></div>
                                <div className="relative w-12 h-12 bg-gradient-to-br from-amber-400 to-amber-500 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/20">
                                  <Package className="w-6 h-6 text-white animate-pulse" />
                                </div>
                              </div>
                            </div>

                            <p className="text-white font-bold text-xs mb-0.5 tracking-wide">{t.dispatch.newOrderAvailable}</p>
                            <p className="text-emerald-300 text-[9px] font-semibold mb-1">{t.dispatch.secured}</p>
                            <p className="text-blue-200/60 text-[8px]">{t.dispatch.acceptToUnlock}</p>
                          </div>
                        </div>
                      ) : (
                        <div className={`text-gray-800 text-xs leading-[1.6] font-medium whitespace-pre-wrap break-words [overflow-wrap:anywhere] overflow-y-auto pr-1.5 custom-scrollbar ${currentOrder.status === 'accepted' ? 'max-h-none' : 'max-h-[140px]'}`}>
                          {currentOrder.dispatch_orders.order_content}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* DESKTOP: Side-by-side layout */}
                <div className={`hidden md:grid gap-4 md:gap-6 ${currentOrder.status === 'accepted' ? (isTablet ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-5 flex-1') : 'grid-cols-1 lg:grid-cols-5'}`}>
                  <div className="lg:col-span-3">
                    <div className={`relative backdrop-blur-xl rounded-2xl p-8 border overflow-hidden shadow-xl transition-all duration-500 ${
                      currentOrder.status === 'pending'
                        ? 'bg-white/10 border-white/20 shadow-blue-900/20'
                        : 'bg-white/90 border-gray-200 shadow-sm'
                    }`}>
                      {/* Subtle dot pattern */}
                      <div className={`absolute inset-0 ${currentOrder.status === 'pending' ? 'opacity-[0.04]' : 'opacity-[0.02]'}`} style={{
                        backgroundImage: currentOrder.status === 'pending'
                          ? 'radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)'
                          : 'radial-gradient(circle, rgba(37,99,235,1) 1px, transparent 1px)',
                        backgroundSize: '20px 20px'
                      }}></div>

                      {/* Soft corner accents */}
                      <div className={`absolute top-3 left-3 w-5 h-5 border-t border-l rounded-tl-sm transition-all duration-500 ${
                        currentOrder.status === 'pending' ? 'border-white/30' : 'border-blue-300/40'
                      }`}></div>
                      <div className={`absolute top-3 right-3 w-5 h-5 border-t border-r rounded-tr-sm transition-all duration-500 ${
                        currentOrder.status === 'pending' ? 'border-white/30' : 'border-blue-300/40'
                      }`}></div>
                      <div className={`absolute bottom-3 left-3 w-5 h-5 border-b border-l rounded-bl-sm transition-all duration-500 ${
                        currentOrder.status === 'pending' ? 'border-white/30' : 'border-blue-300/40'
                      }`}></div>
                      <div className={`absolute bottom-3 right-3 w-5 h-5 border-b border-r rounded-br-sm transition-all duration-500 ${
                        currentOrder.status === 'pending' ? 'border-white/30' : 'border-blue-300/40'
                      }`}></div>

                      <div className="relative z-10">
                        <div className="flex items-center justify-between mb-6">
                          <div className="flex items-center space-x-3">
                            <div className="relative">
                              <div className={`absolute inset-0 rounded-full blur-sm animate-pulse ${currentOrder.status === 'pending' ? 'bg-cyan-300/40' : 'bg-blue-400/30'}`}></div>
                              <div className={`relative w-2 h-2 rounded-full ${currentOrder.status === 'pending' ? 'bg-cyan-300' : 'bg-blue-500'}`}></div>
                            </div>
                            <FileText className={`w-5 h-5 ${currentOrder.status === 'pending' ? 'text-cyan-300' : 'text-blue-500'}`} />
                            <h4 className={`text-sm font-bold uppercase tracking-widest ${currentOrder.status === 'pending' ? 'text-white' : 'text-gray-700'}`}>{t.dispatch.orderDetails}</h4>
                          </div>
                          {currentOrder.status === 'pending' && (
                            <div className="relative flex items-center space-x-2 px-4 py-1.5 bg-amber-400/15 border border-amber-400/30 rounded-lg overflow-hidden backdrop-blur-sm">
                              <div className="absolute inset-0 bg-gradient-to-r from-amber-400/0 via-amber-400/10 to-amber-400/0 animate-shimmer"></div>
                              <div className="relative w-2 h-2 bg-amber-400 rounded-full animate-pulse shadow-sm shadow-amber-400/50"></div>
                              <span className="relative text-xs font-bold text-amber-300 uppercase tracking-wider">{t.dispatch.encryptedLabel}</span>
                            </div>
                          )}
                        </div>



                        {currentOrder.status === 'pending' ? (
                          <div className="text-center relative min-h-[180px] max-h-[180px] flex flex-col justify-center">
                            {/* Floating particles */}
                            <div className="absolute inset-0 overflow-hidden">
                              <div className="absolute top-1/4 left-1/4 w-1 h-1 bg-amber-300/30 rounded-full animate-float-particle-1"></div>
                              <div className="absolute top-1/3 right-1/3 w-1.5 h-1.5 bg-white/15 rounded-full animate-float-particle-2"></div>
                              <div className="absolute bottom-1/3 left-1/2 w-1 h-1 bg-cyan-300/25 rounded-full animate-float-particle-3"></div>
                            </div>

                            <div className="relative">
                              {/* Icon - amber/gold for contrast */}
                              <div className="inline-flex items-center justify-center mb-5">
                                <div className="relative">
                                  <div className="absolute -inset-4 bg-amber-400/15 rounded-full blur-xl animate-pulse"></div>
                                  <div className="absolute -inset-2 bg-amber-500/10 rounded-full blur-md animate-pulse" style={{animationDelay: '0.5s'}}></div>

                                  <div className="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 shadow-xl shadow-amber-500/25 flex items-center justify-center">
                                    <Package className="w-10 h-10 text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.6)]" />
                                    <div className="absolute inset-0 rounded-2xl border border-amber-300/40"></div>
                                  </div>
                                </div>
                              </div>

                              <h3 className="text-xl font-bold mb-3 tracking-tight text-white">
                                {t.dispatch.newOrderAvailable}
                              </h3>

                              {/* Security badge */}
                              <div className="flex items-center justify-center space-x-3 mb-3">
                                <div className="w-10 h-px bg-gradient-to-r from-transparent to-white/25"></div>
                                <div className="flex items-center space-x-2 px-3 py-1 bg-emerald-500/20 border border-emerald-400/30 rounded-full backdrop-blur-sm">
                                  <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
                                  <span className="text-xs font-bold text-emerald-300 uppercase tracking-wider">{t.dispatch.secured}</span>
                                </div>
                                <div className="w-10 h-px bg-gradient-to-l from-transparent to-white/25"></div>
                              </div>

                              <p className="text-blue-100/80 text-sm font-medium mb-3 max-w-sm mx-auto">
                                {t.dispatch.clickAcceptToUnlock}
                              </p>

                              {/* Status indicators */}
                              <div className="flex items-center justify-center space-x-4 pt-3 border-t border-white/10">
                                <div className="flex items-center space-x-1.5">
                                  <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></div>
                                  <span className="text-[10px] text-emerald-300 font-bold uppercase tracking-wide">{t.dispatch.verified}</span>
                                </div>
                                <div className="w-px h-3 bg-white/15"></div>
                                <div className="flex items-center space-x-1.5">
                                  <div className="w-1.5 h-1.5 bg-cyan-300 rounded-full animate-pulse" style={{animationDelay: '0.3s'}}></div>
                                  <span className="text-[10px] text-cyan-200 font-bold uppercase tracking-wide">{t.dispatch.blockchain}</span>
                                </div>
                                <div className="w-px h-3 bg-white/15"></div>
                                <div className="flex items-center space-x-1.5">
                                  <div className="w-1.5 h-1.5 bg-amber-300 rounded-full animate-pulse" style={{animationDelay: '0.6s'}}></div>
                                  <span className="text-[10px] text-amber-200 font-bold uppercase tracking-wide">{t.dispatch.encryptedLabel}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className={`text-gray-800 text-lg leading-relaxed font-medium whitespace-pre-wrap break-words [overflow-wrap:anywhere] overflow-y-auto pr-2 custom-scrollbar ${currentOrder.status === 'accepted' ? 'max-h-none flex-1' : 'max-h-[180px]'}`}>
                            {currentOrder.dispatch_orders.order_content}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons - Compact */}
                  <div className={`lg:col-span-2 flex justify-center ${isTablet && currentOrder.status === 'accepted' ? 'flex-row gap-3' : 'flex-col space-y-2 md:space-y-3'}`}>
                    {currentOrder.status === 'pending' && (
                      <button
                        onClick={handleAcceptOrder}
                        disabled={isAccepting}
                        className={`group relative w-full px-4 py-3 md:px-6 md:py-4 bg-white text-blue-700 rounded-xl font-bold text-sm md:text-base overflow-hidden shadow-xl shadow-white/20 disabled:cursor-not-allowed touch-manipulation ${
                          performanceSettings.reduceTransitions
                            ? 'transition-opacity duration-150 active:opacity-80'
                            : 'hover:shadow-white/40 transition-all duration-200 hover:scale-105 active:scale-[0.98]'
                        }`}
                      >
                        {!performanceSettings.reduceTransitions && (
                          <div className="absolute inset-0 bg-blue-50 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                        )}
                        <div className="relative flex items-center justify-center space-x-2">
                          {isAccepting ? (
                            <>
                              <div className="w-4 h-4 md:w-5 md:h-5 border-2 border-blue-300 border-t-blue-700 rounded-full animate-spin keep-animation"></div>
                              <span>{t.dispatch.accepting}</span>
                            </>
                          ) : (
                            <>
                              <CheckCircle className="w-4 h-4 md:w-5 md:h-5" />
                              <span>{t.dispatch.acceptOrder}</span>
                            </>
                          )}
                        </div>
                      </button>
                    )}
                    {currentOrder.status === 'accepted' && (
                      <>
                        <button
                          onClick={handleCompleteOrder}
                          disabled={isCompleting}
                          className={`group relative w-full px-4 py-3 md:px-6 md:py-4 bg-gradient-to-r from-emerald-500 to-green-600 text-white rounded-xl font-bold text-sm md:text-base overflow-hidden shadow-xl shadow-emerald-500/30 disabled:cursor-not-allowed ${
                            performanceSettings.reduceTransitions
                              ? 'transition-opacity duration-150 active:opacity-80'
                              : 'hover:shadow-emerald-500/50 transition-all duration-200 hover:scale-105 active:scale-[0.98]'
                          }`}
                        >
                          {!performanceSettings.reduceTransitions && (
                            <div className="absolute inset-0 bg-gradient-to-r from-emerald-400 to-green-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                          )}
                          <div className="relative flex items-center justify-center space-x-2">
                            {isCompleting ? (
                              <>
                                <div className="w-4 h-4 md:w-5 md:h-5 border-2 border-green-200 border-t-white rounded-full animate-spin keep-animation"></div>
                                <span>{t.dispatch.submittingOrder}</span>
                              </>
                            ) : (
                              <>
                                <CheckCircle className="w-4 h-4 md:w-5 md:h-5" />
                                <span>{t.dispatch.markCompleted}</span>
                              </>
                            )}
                          </div>
                        </button>
                        <button
                          onClick={handleErrorOrder}
                          className={`group relative w-full px-4 py-3 md:px-6 md:py-4 bg-gradient-to-r from-rose-500 to-red-600 text-white rounded-xl font-bold text-sm md:text-base overflow-hidden shadow-xl shadow-rose-500/30 ${
                            performanceSettings.reduceTransitions
                              ? 'transition-opacity duration-150 active:opacity-80'
                              : 'hover:shadow-rose-500/50 transition-all duration-300 hover:scale-105'
                          }`}
                        >
                          {!performanceSettings.reduceTransitions && (
                            <div className="absolute inset-0 bg-gradient-to-r from-rose-400 to-red-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                          )}
                          <div className="relative flex items-center justify-center space-x-2">
                            <XCircle className="w-4 h-4 md:w-5 md:h-5" />
                            <span>{t.dispatch.reportError}</span>
                          </div>
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* MOBILE: Action Buttons - Full Width Below Content */}
                <div className="md:hidden space-y-2 mt-2.5">
                  {currentOrder.status === 'pending' && (
                    <button
                      onClick={handleAcceptOrder}
                      disabled={isAccepting}
                      className="w-full bg-white text-blue-700 py-3 px-4 rounded-lg font-bold text-sm shadow-lg shadow-white/20 flex items-center justify-center space-x-1.5 disabled:cursor-not-allowed touch-manipulation active:bg-blue-50 active:scale-[0.97] transition-transform duration-75"
                      style={{ WebkitTapHighlightColor: 'transparent' }}
                    >
                      {isAccepting ? (
                        <>
                          <div className="w-4 h-4 border-2 border-blue-300 border-t-blue-700 rounded-full animate-spin keep-animation flex-shrink-0"></div>
                          <span>{t.dispatch.accepting}</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle className="w-4 h-4 flex-shrink-0" />
                          <span>{t.dispatch.acceptOrder}</span>
                        </>
                      )}
                    </button>
                  )}
                  {currentOrder.status === 'accepted' && (
                    <>
                      <button
                        onClick={handleCompleteOrder}
                        disabled={isCompleting}
                        className="w-full bg-gradient-to-r from-emerald-500 to-green-600 text-white py-3 px-4 rounded-lg font-bold text-sm shadow-lg flex items-center justify-center space-x-1.5 disabled:cursor-not-allowed touch-manipulation active:from-emerald-600 active:to-green-700 active:scale-[0.97] transition-transform duration-75"
                        style={{ WebkitTapHighlightColor: 'transparent' }}
                      >
                        {isCompleting ? (
                          <>
                            <div className="w-4 h-4 border-2 border-green-200 border-t-white rounded-full animate-spin keep-animation flex-shrink-0"></div>
                            <span>{t.dispatch.submittingOrder}</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle className="w-4 h-4 flex-shrink-0" />
                            <span>{t.dispatch.markCompleted}</span>
                          </>
                        )}
                      </button>
                      <button
                        onClick={handleErrorOrder}
                        className="w-full bg-gradient-to-r from-rose-500 to-red-600 text-white py-3 px-4 rounded-lg font-bold text-sm shadow-lg flex items-center justify-center space-x-1.5 touch-manipulation active:from-rose-600 active:to-red-700 active:scale-[0.97] transition-transform duration-75"
                        style={{ WebkitTapHighlightColor: 'transparent' }}
                      >
                        <XCircle className="w-4 h-4 flex-shrink-0" />
                        <span>{t.dispatch.reportError}</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>
            {session.isWorking && !(isTransitioning && transitionType === 'start') && (
              <div role="status" className="relative overflow-hidden rounded-2xl border border-blue-400/30 bg-gradient-to-br from-blue-700 via-blue-800 to-slate-900 p-5 text-white shadow-xl shadow-blue-900/20 md:rounded-3xl md:p-8">
                <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-cyan-400/15 blur-3xl" />
                <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-8">
                  <div className="flex flex-col justify-center gap-4">
                    <div className="flex items-center gap-3">
                      <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/20 bg-white/10"><Package className="h-6 w-6 text-cyan-200" aria-hidden="true" /></span>
                      <div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-[0.15em] text-cyan-200">{t.dispatch.orderProcessing}</p><p className="mt-1 text-sm font-semibold text-white">{dispatchPause ? t.dispatch.waitingForOrders : nextOrderTime ? t.dispatch.readyToAcceptOrders : t.dispatch.preparingQueue}</p></div>
                      <button type="button" onClick={() => void handleStopWork(false).catch(() => undefined)} disabled={isProcessing} aria-label={t.dispatch.goOffline} title={t.dispatch.goOffline} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/20 bg-white/10 text-blue-100 transition-colors hover:border-rose-300/60 hover:bg-rose-500/25 hover:text-white disabled:cursor-wait disabled:opacity-50"><Square className="h-3.5 w-3.5" aria-hidden="true" /></button>
                    </div>
                    <p className="text-sm leading-6 text-blue-100/80">{t.dispatch.waitingForOrders}</p>
                    <div className="flex flex-wrap gap-2 text-[11px] font-bold uppercase tracking-wider">
                      <span className="rounded-full border border-emerald-300/25 bg-emerald-400/10 px-3 py-1.5 text-emerald-200">{t.dispatch.verified}</span>
                      <span className="rounded-full border border-cyan-300/25 bg-cyan-400/10 px-3 py-1.5 text-cyan-100">{t.dispatch.encryptedLabel}</span>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/15 bg-white/[0.08] p-5 shadow-inner shadow-blue-950/20 md:p-6">
                    <div className="flex items-center gap-2 border-b border-white/10 pb-3 text-sm font-bold text-blue-100"><FileText className="h-4 w-4 text-cyan-200" aria-hidden="true" />{t.dispatch.orderDetails}</div>
                    <div className="flex min-h-32 flex-col items-center justify-center gap-3 text-center">
                      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10"><Package className="h-6 w-6 text-blue-200" aria-hidden="true" /></span>
                      <p className="text-sm font-semibold text-white">{t.dispatch.waitingForOrders}</p>
                      <p className="text-xs text-blue-200/80">{t.dispatch.acceptToUnlock}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {/* DESKTOP LAYOUT */}
            <div className={`hidden md:grid grid-cols-1 gap-4 md:gap-10 transition-all duration-500`}>
              {/* Action Button */}
              <div className="flex items-center justify-center">
              {(!session.isWorking || (isTransitioning && transitionType === 'start')) ? (
                <button
                  onClick={handleStartWork}
                  disabled={isProcessing}
                  className={`group/btn relative w-full min-h-[200px] md:min-h-[280px] bg-gradient-to-br from-blue-600 via-blue-700 to-blue-800 border border-blue-500/50 rounded-2xl md:rounded-3xl shadow-xl shadow-blue-600/20 disabled:cursor-not-allowed ${
                    isMobile ? 'overflow-visible' : 'overflow-hidden'
                  } ${
                    performanceSettings.reduceTransitions
                      ? 'transition-all duration-200 active:scale-95'
                      : 'transition-all duration-500 hover:from-blue-500 hover:via-blue-600 hover:to-blue-700 hover:shadow-2xl hover:shadow-blue-600/30 hover:scale-[1.02] active:scale-[0.98]'
                  } ${
                    isTransitioning && transitionType === 'start' ? 'scale-95 opacity-70' : 'scale-100 opacity-100'
                  }`}
                >
                  {/* Mobile: Ripple Effect on Tap - Fixed z-index and visibility */}
                  {isMobile && showStartRipple && (
                    <>
                      {/* Flash overlay - Must be first */}
                      <div
                        className="absolute inset-0 pointer-events-none rounded-2xl bg-white"
                        style={{
                          zIndex: 100,
                          animation: 'pulseOut 0.3s ease-out'
                        }}
                      />
                      {/* Primary Ripple - Large visible wave */}
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                        style={{
                          width: '150px',
                          height: '150px',
                          zIndex: 99
                        }}
                      >
                        <div
                          className="absolute inset-0 bg-emerald-400 rounded-full"
                          style={{
                            animation: 'rippleExpand 0.6s ease-out',
                            boxShadow: '0 0 60px rgba(16, 185, 129, 0.8), 0 0 90px rgba(16, 185, 129, 0.6)'
                          }}
                        />
                      </div>
                      {/* Secondary Ripple - Delayed */}
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                        style={{
                          width: '150px',
                          height: '150px',
                          zIndex: 98
                        }}
                      >
                        <div
                          className="absolute inset-0 bg-cyan-400 rounded-full"
                          style={{
                            animation: 'rippleExpand 0.6s ease-out 0.15s',
                            boxShadow: '0 0 60px rgba(6, 182, 212, 0.7), 0 0 90px rgba(6, 182, 212, 0.5)'
                          }}
                        />
                      </div>
                      {/* Energy Pulse - Border flash */}
                      <div
                        className="absolute inset-0 pointer-events-none rounded-2xl border-[6px] border-emerald-300"
                        style={{
                          zIndex: 97,
                          animation: 'pulseOut 0.6s ease-out',
                          boxShadow: '0 0 40px rgba(16, 185, 129, 1), inset 0 0 40px rgba(16, 185, 129, 0.6)'
                        }}
                      />
                    </>
                  )}

                  {/* Hexagonal pattern overlay */}
                  <div className="absolute inset-0 opacity-10">
                    <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
                      <defs>
                        <pattern id="hex-green-btn" x="0" y="0" width="30" height="26" patternUnits="userSpaceOnUse">
                          <path
                            d="M15 0 L22.5 4.3 L22.5 13 L15 17.3 L7.5 13 L7.5 4.3 Z"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="0.5"
                            className="text-emerald-400"
                          />
                        </pattern>
                      </defs>
                      <rect width="100%" height="100%" fill="url(#hex-green-btn)" />
                    </svg>
                  </div>

                  {/* Multi-layer background effects - Simplified for mobile */}
                  {performanceSettings.enableComplexGradients && (
                    <>
                      <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/0 via-cyan-600/0 to-emerald-500/0 group-hover/btn:from-emerald-500/20 group-hover/btn:via-cyan-600/20 group-hover/btn:to-emerald-500/20 transition-all duration-500"></div>
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(16,185,129,0.2),transparent_70%)] opacity-0 group-hover/btn:opacity-100 transition-opacity duration-500"></div>
                    </>
                  )}

                  {/* Animated shine effect - Disabled on low-end devices */}
                  {performanceSettings.enableAnimations && (
                    <div className="absolute inset-0 -translate-x-full group-hover/btn:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>
                  )}

                  {/* Pulsing glow - Simplified for mobile */}
                  {performanceSettings.enableComplexGradients && (
                    <div className="absolute inset-0 rounded-3xl group-hover/btn:shadow-[inset_0_0_60px_rgba(16,185,129,0.2)] transition-all duration-500"></div>
                  )}

                  {/* Corner tech accents - Enhanced */}
                  <div className="absolute top-3 left-3 w-10 h-10 border-t-2 border-l-2 border-emerald-400/60 group-hover/btn:border-emerald-300 transition-colors">
                    <div className="absolute -top-1 -left-1 w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
                  </div>
                  <div className="absolute top-3 right-3 w-10 h-10 border-t-2 border-r-2 border-emerald-400/60 group-hover/btn:border-emerald-300 transition-colors">
                    <div className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-400 rounded-full" style={{animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite 0.2s'}}></div>
                  </div>
                  <div className="absolute bottom-3 left-3 w-10 h-10 border-b-2 border-l-2 border-emerald-400/60 group-hover/btn:border-emerald-300 transition-colors">
                    <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-emerald-400 rounded-full" style={{animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite 0.4s'}}></div>
                  </div>
                  <div className="absolute bottom-3 right-3 w-10 h-10 border-b-2 border-r-2 border-emerald-400/60 group-hover/btn:border-emerald-300 transition-colors">
                    <div className="absolute -bottom-1 -right-1 w-2 h-2 bg-emerald-400 rounded-full" style={{animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite 0.6s'}}></div>
                  </div>

                  {/* Floating particles inside button - Optimized for mobile */}
                  {performanceSettings.enableParticles && [...Array(performanceSettings.particleCount)].map((_, i) => (
                    <div
                      key={`btn-particle-${i}`}
                      className="absolute w-1 h-1 bg-emerald-400 rounded-full opacity-40 animate-float"
                      style={{
                        left: `${10 + (i * 10)}%`,
                        top: `${20 + (i * 8) % 60}%`,
                        animationDelay: `${i * 0.4}s`,
                        animationDuration: `${3 + (i % 2)}s`
                      }}
                    />
                  ))}

                  {/* Optimized Transition Overlay - Start Work */}
                  {isTransitioning && transitionType === 'start' && (
                    <div
                      className="absolute inset-0 flex items-center justify-center rounded-3xl keep-animation"
                      style={{
                        zIndex: 50,
                        background: performanceSettings.enableComplexGradients
                          ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.3), rgba(6, 182, 212, 0.2), rgba(16, 185, 129, 0.3))'
                          : 'rgba(6, 95, 70, 0.6)',
                        WebkitBackdropFilter: 'blur(4px)',
                        backdropFilter: 'blur(4px)'
                      }}
                    >
                      {/* Mobile: Energy Convergence Effect - Ultra Enhanced */}
                      {isMobile && (
                        <>
                          {/* Converging energy lines - Ultra visible */}
                          <div className="absolute inset-0 overflow-hidden rounded-3xl">
                            {[...Array(8)].map((_, i) => (
                              <div
                                key={`energy-line-${i}`}
                                className="absolute"
                                style={{
                                  width: '4px',
                                  height: '100%',
                                  left: `${12 * (i + 1)}%`,
                                  background: 'linear-gradient(to bottom, transparent, rgba(16, 185, 129, 0.9), rgba(6, 182, 212, 0.7), transparent)',
                                  animation: `slideDown 1s ease-in-out infinite ${i * 0.12}s`,
                                  boxShadow: '0 0 15px rgba(16, 185, 129, 0.8), 0 0 25px rgba(16, 185, 129, 0.5)',
                                  zIndex: 60
                                }}
                              />
                            ))}
                          </div>
                          {/* Pulsing center glow - Super bright */}
                          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-emerald-400 rounded-full animate-pulse"
                            style={{
                              opacity: 0.4,
                              filter: 'blur(60px)',
                              boxShadow: '0 0 80px rgba(16, 185, 129, 0.6), 0 0 120px rgba(6, 182, 212, 0.4)',
                              zIndex: 59
                            }}
                          />
                          {/* Rotating energy ring - Larger and brighter */}
                          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32">
                            <div className="absolute inset-0 border-4 border-emerald-400 rounded-full animate-spin"
                              style={{
                                opacity: 0.7,
                                animationDuration: '2s',
                                boxShadow: '0 0 30px rgba(16, 185, 129, 0.6), inset 0 0 30px rgba(16, 185, 129, 0.4)',
                                zIndex: 61
                              }}
                            />
                          </div>
                        </>
                      )}

                      <div className="relative text-center z-10">
                        {/* Enhanced spinner with glow */}
                        <div className="relative w-16 h-16 md:w-20 md:h-20 mx-auto mb-4 md:mb-6">
                          {/* Outer glow ring - Mobile only */}
                          {isMobile && (
                            <div className="absolute inset-0 border-4 border-emerald-400/30 rounded-full animate-ping" style={{ animationDuration: '1.5s' }} />
                          )}
                          <div className="absolute inset-0 border-4 border-emerald-400/20 rounded-full"></div>
                          <div className="absolute inset-0 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin keep-animation"></div>
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Play className={`${isMobile ? 'w-7 h-7' : 'w-6 h-6 md:w-8 md:h-8'} text-emerald-300 drop-shadow-[0_0_8px_rgba(16,185,129,0.8)]`} fill="currentColor" />
                          </div>
                        </div>

                        <div className="space-y-1 md:space-y-2">
                          <p className={`text-emerald-100 font-bold ${isMobile ? 'text-xl' : 'text-lg md:text-xl'} drop-shadow-lg`}>{t.dispatch.startingWork}</p>
                          <p className="text-emerald-300/80 text-xs md:text-sm">{t.dispatch.initializingSession}</p>
                          <div className="flex items-center justify-center space-x-2 mt-3 md:mt-4">
                            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce keep-animation shadow-[0_0_8px_rgba(16,185,129,0.6)]" style={{ animationDelay: '0s' }}></div>
                            <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce keep-animation shadow-[0_0_8px_rgba(6,182,212,0.6)]" style={{ animationDelay: '0.2s' }}></div>
                            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce keep-animation shadow-[0_0_8px_rgba(16,185,129,0.6)]" style={{ animationDelay: '0.4s' }}></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className={`relative flex flex-col items-center justify-center space-y-3 md:space-y-6 p-4 md:p-8 pointer-events-none ${
                    performanceSettings.reduceTransitions ? 'transition-opacity duration-200' : 'interactive-transition'
                  } ${
                    isTransitioning && transitionType === 'start' ? 'opacity-30 scale-95' : 'opacity-100 scale-100'
                  }`}>
                    {/* Icon with enhanced glow and orbit effects */}
                    <div className="relative">
                      {/* Glow and orbiting dots removed for performance */}

                      <div className={`relative p-4 md:p-6 bg-white/15 backdrop-blur-sm rounded-full border-2 border-white/25 ${
                        performanceSettings.reduceTransitions ? 'transition-all duration-150' : 'transition-all duration-200'
                      } ${
                        isStartButtonPressed
                          ? 'scale-90 bg-white/25 border-white/40'
                          : performanceSettings.reduceTransitions
                          ? ''
                          : 'group-hover/btn:scale-110 group-hover/btn:bg-white/20'
                      }`}>
                        <Play className={`w-10 h-10 md:w-14 md:h-14 transition-all duration-200 ${
                          isStartButtonPressed ? 'text-white' : 'text-white group-hover/btn:text-white'
                        }`} fill="currentColor" />
                      </div>
                    </div>

                    <div className="text-center space-y-1 md:space-y-2">
                      <span className={`block text-xl md:text-2xl font-bold transition-all duration-200 tracking-tight ${
                        isStartButtonPressed ? 'text-white' : 'text-white'
                      }`}>
                        {t.dispatch.startProcessing}
                      </span>
                      <span className={`block text-sm md:text-base font-medium tracking-wide transition-all duration-200 ${
                        isStartButtonPressed ? 'text-blue-200' : 'text-blue-200 group-hover/btn:text-blue-100'
                      }`}>
                        {t.dispatch.beginAcceptingOrders}
                      </span>
                    </div>
                  </div>
                </button>
              ) : null}
              </div>
            </div>

            {/* MOBILE-ONLY COMPACT LAYOUT */}
            <div className={session.isWorking && !(isTransitioning && transitionType === 'start') ? 'hidden' : 'md:hidden space-y-3 min-h-[320px]'}>
              {isTransitioning && transitionType === 'start' ? (
                /* Mobile Transition Loading View - Soft edge gradients blend into panel */
                <div className="animate-[fadeIn_0.3s_ease-out] min-h-[320px] -mx-4 relative overflow-hidden flex flex-col items-center justify-center">
                  {/* Core gradient - soft radial that fades to transparent at edges */}
                  <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 85% 75% at 50% 48%, rgba(6,78,59,0.85) 0%, rgba(4,120,87,0.65) 20%, rgba(16,185,129,0.4) 38%, rgba(20,184,166,0.2) 52%, rgba(148,215,200,0.08) 65%, transparent 80%)' }}></div>
                  {/* Secondary warm glow layer */}
                  <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 60% 55% at 50% 45%, rgba(52,211,153,0.2) 0%, rgba(16,185,129,0.08) 45%, transparent 70%)' }}></div>
                  {/* Subtle animated breathing glow */}
                  <div className="absolute inset-0 pointer-events-none keep-animation animate-pulse-slow" style={{ background: 'radial-gradient(circle 160px at 50% 45%, rgba(52,211,153,0.15) 0%, rgba(16,185,129,0.05) 50%, transparent 75%)' }}></div>
                  {/* Very soft conic mesh for subtle movement */}
                  <div className="absolute inset-0 pointer-events-none keep-animation animate-spin-slow-bg" style={{ background: 'conic-gradient(from 0deg at 50% 50%, rgba(52,211,153,0.04) 0deg, rgba(6,182,212,0.03) 90deg, rgba(16,185,129,0.05) 180deg, rgba(20,184,166,0.02) 270deg, rgba(52,211,153,0.04) 360deg)' }}></div>

                  {/* Expanding glow pulses - no borders */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="absolute w-40 h-40 rounded-full bg-emerald-400/5 keep-animation animate-ping-slow"></div>
                    <div className="absolute w-32 h-32 rounded-full bg-teal-400/5 keep-animation animate-ping-slow-delayed"></div>
                  </div>

                  {/* Main content */}
                  <div className="relative z-10 flex flex-col items-center gap-6">
                    {/* Spinner - bold and visible */}
                    <div className="relative w-[96px] h-[96px]">
                      {/* Pulsing glow behind */}
                      <div className="absolute inset-[-16px] rounded-full bg-emerald-400/12 blur-xl keep-animation animate-pulse-fast"></div>
                      {/* Main spinning arc - thick and bright */}
                      <div className="absolute inset-0 border-[4px] border-transparent rounded-full keep-animation animate-spin-fast" style={{ borderTopColor: 'rgba(16,185,129,0.95)', borderRightColor: 'rgba(45,212,191,0.5)' }}></div>
                      {/* Secondary arc - counter-rotating */}
                      <div className="absolute inset-[10px] border-[3px] border-transparent rounded-full keep-animation animate-spin-medium" style={{ borderBottomColor: 'rgba(52,211,153,0.7)', borderLeftColor: 'rgba(20,184,166,0.35)' }}></div>
                      {/* Third inner arc - fast */}
                      <div className="absolute inset-[22px] border-2 border-transparent rounded-full keep-animation animate-spin-fastest" style={{ borderTopColor: 'rgba(94,234,212,0.6)' }}></div>
                      {/* Center icon */}
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Play className="w-7 h-7 text-emerald-600 drop-shadow-[0_0_12px_rgba(16,185,129,0.5)]" fill="currentColor" />
                      </div>
                    </div>

                    {/* Text */}
                    <div className="text-center space-y-1.5">
                      <p className="text-lg font-bold text-emerald-900 drop-shadow-[0_0_20px_rgba(52,211,153,0.3)]">{t.dispatch.startingSession}</p>
                      <p className="text-sm text-emerald-700/60 font-medium">{t.dispatch.preparingQueue}</p>
                    </div>

                    {/* Shimmer progress bar - wider and more visible */}
                    <div className="w-36 h-1 bg-emerald-200/40 rounded-full overflow-hidden mt-1">
                      <div className="h-full w-[60%] bg-gradient-to-r from-transparent via-emerald-500/90 to-transparent rounded-full animate-shimmer keep-animation"></div>
                    </div>
                  </div>
                </div>
              ) : !session.isWorking ? (
                /* Mobile Start View - Enriched */
                <div className="space-y-3">
                  {/* Standby visual area */}
                  <div className="relative -mx-4 px-4 py-6 overflow-hidden flex flex-col items-center justify-center">
                    {/* Background gradient */}
                    <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 85% 70% at 50% 45%, rgba(239,246,255,0.9) 0%, rgba(219,234,254,0.6) 30%, rgba(191,219,254,0.3) 55%, transparent 80%)' }}></div>

                    {/* Subtle animated rings */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className={`absolute w-36 h-36 rounded-full border border-blue-200/40 ${suppressAnimations ? '' : 'animate-[spin_25s_linear_infinite]'}`}>
                        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-blue-400/50 rounded-full"></div>
                      </div>
                      <div className={`absolute w-52 h-52 rounded-full border border-blue-100/30 ${suppressAnimations ? '' : 'animate-[spin_35s_linear_infinite_reverse]'}`}>
                        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-1 h-1 bg-blue-300/40 rounded-full"></div>
                      </div>
                    </div>

                    {/* Breathing glow */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className={`absolute w-28 h-28 rounded-full bg-blue-200/30 blur-2xl ${suppressAnimations ? '' : 'animate-pulse'}`}></div>
                    </div>

                    <div className="relative z-10 w-full">
                      {/* Center icon */}
                      <div className="flex justify-center mb-3">
                        <div className="relative">
                          <div className={`absolute inset-0 bg-blue-400/20 rounded-full blur-md ${suppressAnimations ? '' : 'animate-pulse'}`}></div>
                          <div className="relative w-12 h-12 bg-gradient-to-br from-blue-100 to-blue-200 border border-blue-300/50 rounded-full flex items-center justify-center shadow-md shadow-blue-200/30">
                            <Timer className="w-5 h-5 text-blue-600" />
                          </div>
                        </div>
                      </div>

                      {/* Standby status */}
                      <div className="text-center mb-3">
                        <div className="flex items-center justify-center gap-1.5 mb-1">
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div>
                          <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">{t.dispatch.standbyStatus}</span>
                        </div>
                        <p className="text-sm font-semibold text-blue-800">{t.dispatch.readyToAcceptOrders}</p>
                      </div>

                      {/* Work description text */}
                      <div className="text-center px-4 mb-4">
                        <p className="text-xs text-slate-500 leading-relaxed">
                          {t.dispatch.sessionDesc}
                        </p>
                      </div>

                      {/* Info cards */}
                      <div className="grid grid-cols-2 gap-2 px-1">
                        <div className="bg-white/80 border border-blue-100 rounded-lg px-2.5 py-2 shadow-sm">
                          <div className="flex items-center gap-1.5 mb-1">
                            <div className="w-4 h-4 rounded-md bg-blue-50 flex items-center justify-center">
                              <Package className="w-2.5 h-2.5 text-blue-500" />
                            </div>
                            <span className="text-[9px] font-semibold text-blue-600 uppercase tracking-wider">{t.dispatch.autoDispatch}</span>
                          </div>
                          <p className="text-[10px] text-slate-500 leading-tight">{t.dispatch.ordersByPriority}</p>
                        </div>
                        <div className="bg-white/80 border border-blue-100 rounded-lg px-2.5 py-2 shadow-sm">
                          <div className="flex items-center gap-1.5 mb-1">
                            <div className="w-4 h-4 rounded-md bg-emerald-50 flex items-center justify-center">
                              <TrendingUp className="w-2.5 h-2.5 text-emerald-500" />
                            </div>
                            <span className="text-[9px] font-semibold text-emerald-600 uppercase tracking-wider">{t.dispatch.realTime}</span>
                          </div>
                          <p className="text-[10px] text-slate-500 leading-tight">{t.dispatch.instantNotifications}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Start Button */}
                  <button
                    onClick={handleStartWork}
                    disabled={isProcessing}
                    className={`relative w-full py-5 px-5 rounded-2xl font-bold text-base flex items-center justify-center space-x-3 overflow-hidden transition-transform duration-75 ${
                      isProcessing
                        ? 'bg-blue-600 cursor-wait shadow-xl shadow-blue-500/30 border border-blue-500/50'
                        : 'bg-blue-600 active:scale-[0.97] shadow-xl shadow-blue-600/30 border border-blue-500/30 ring-4 ring-blue-100/50'
                    }`}
                    style={{ WebkitTapHighlightColor: 'transparent' }}
                  >
                    {!isProcessing && (
                      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent"></div>
                    )}

                    {isProcessing ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full shadow-sm animate-spin keep-animation"></div>
                        <span className="text-white font-extrabold tracking-wide text-lg">{t.dispatch.starting}</span>
                      </>
                    ) : (
                      <>
                        <div className="p-2 bg-white/15 rounded-xl">
                          <Play className="w-5 h-5 text-white drop-shadow-sm" fill="currentColor" />
                        </div>
                        <span className="text-white font-extrabold tracking-wide text-lg">{t.dispatch.startProcessing}</span>
                      </>
                    )}
                  </button>
                </div>
              ) : null}
            </div>
            </>
          )}

        </div>
      </div>

      {/* Order Assignment System Header - Premium Light Theme */}
      {/* DESKTOP: Full header (desktop only - lg and up) */}
      <div className="hidden lg:block relative overflow-hidden rounded-2xl p-8 mb-8 bg-white border border-gray-200/80 shadow-sm">
        {/* Subtle background pattern */}
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: 'radial-gradient(circle, rgba(37,99,235,1) 1px, transparent 1px)',
          backgroundSize: '32px 32px'
        }}></div>

        {/* Soft gradient accent */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-bl from-blue-50 via-transparent to-transparent rounded-full"></div>
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-gradient-to-tr from-blue-50/50 via-transparent to-transparent rounded-full"></div>

        <div className="relative flex items-center justify-between">
          <div className="flex items-center space-x-6">
            {/* Icon */}
            <div className="relative">
              <div className="absolute -inset-2 bg-blue-500/10 rounded-2xl blur-xl"></div>
              <div className="relative w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20">
                <Package className="w-9 h-9 text-white" />
              </div>
            </div>

            <div className="flex-1">
              <h2 className="text-3xl font-black text-blue-600 tracking-tight mb-1.5">{t.dispatch.orderAssignmentSystem}</h2>
              <div className="flex items-center space-x-3 text-sm">
                <div className="flex items-center space-x-2">
                  <div className="relative">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-ping absolute opacity-75"></div>
                    <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                  </div>
                  <span className="text-gray-500 font-medium">{t.dispatch.globalSupplyChain}</span>
                </div>
                <span className="text-gray-300">|</span>
                <span className="text-gray-500 font-medium">{t.dispatch.crossBorderLogistics}</span>
                <span className="text-gray-300">|</span>
                <span className="text-gray-500 font-medium">{t.dispatch.tradeCompliance}</span>
              </div>
            </div>
          </div>

          {/* Network Status Badge */}
          <div className="flex items-center space-x-3 px-5 py-3 bg-emerald-50 border border-emerald-200 rounded-xl">
            <div className="relative">
              <div className="w-3 h-3 bg-emerald-500 rounded-full animate-ping absolute opacity-75"></div>
              <div className="w-3 h-3 bg-emerald-500 rounded-full"></div>
            </div>
            <div>
              <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">{t.dispatch.networkStatus}</div>
              <div className="text-sm font-black text-emerald-600 tracking-wide">{t.dispatch.networkOnline}</div>
            </div>
          </div>
        </div>
      </div>

      {/* TABLET: Optimized horizontal layout for tablets */}
      <div className="hidden md:block lg:hidden relative overflow-hidden rounded-xl p-5 mb-6 bg-white border border-gray-200/80 shadow-sm">
        {/* Subtle background pattern */}
        <div className="absolute inset-0 opacity-[0.02]" style={{
          backgroundImage: 'radial-gradient(circle, rgba(37,99,235,1) 1px, transparent 1px)',
          backgroundSize: '28px 28px'
        }}></div>
        <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-blue-50 via-transparent to-transparent rounded-full"></div>

        <div className="relative flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="relative">
              <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-md shadow-blue-500/15">
                <Package className="w-7 h-7 text-white" />
              </div>
            </div>
            <div>
              <h2 className="text-2xl font-black text-blue-600 tracking-tight">{t.dispatch.orderAssignmentSystem}</h2>
              <div className="flex items-center space-x-2 text-xs mt-1">
                <div className="flex items-center space-x-1.5">
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
                  <span className="text-gray-500 font-medium">{t.dispatch.globalSupplyChain}</span>
                </div>
                <span className="text-gray-300">|</span>
                <span className="text-gray-500 font-medium">{t.dispatch.crossBorderLogistics}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2.5 px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-lg flex-shrink-0">
            <div className="relative">
              <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-ping absolute opacity-75"></div>
              <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full"></div>
            </div>
            <div>
              <div className="text-[9px] text-gray-500 font-bold uppercase tracking-wider">{t.dispatch.statusLabel}</div>
              <div className="text-sm font-black text-emerald-600 leading-tight">{t.dispatch.onlineUpper}</div>
            </div>
          </div>
        </div>
      </div>

      {/* MOBILE: Unified compact panel with integrated stats */}
      <div className="md:hidden relative overflow-hidden rounded-2xl mb-4 bg-white border border-slate-200/80 shadow-md shadow-blue-100/30">
        {/* Header Section */}
        <div className="relative border-b border-slate-100 p-3.5">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-50/50 to-transparent pointer-events-none"></div>
          <div className="relative flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-blue-700 rounded-xl flex items-center justify-center shadow-md shadow-blue-500/20">
                <Package className="w-4.5 h-4.5 text-white" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-800">{t.dispatch.orderAssignment}</h2>
                <div className="flex items-center space-x-1.5 text-[9px] mt-0.5">
                  <div className="flex items-center gap-1 px-1.5 py-0.5 bg-emerald-50 border border-emerald-100 rounded-full">
                    <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
                    <span className="text-emerald-700 font-semibold">{t.dispatch.onlineUpper}</span>
                  </div>
                  <div className="flex items-center gap-1 px-1.5 py-0.5 bg-blue-50 border border-blue-100 rounded-full">
                    <span className="text-blue-700 font-semibold">{t.dispatch.autoUpper}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Stats Grid Section */}
        <div className="relative p-3.5">
          <div className="grid grid-cols-3 gap-2.5">
            {/* Today Total */}
            <div className="relative overflow-hidden bg-gradient-to-b from-blue-50 to-white border border-blue-100/80 rounded-xl p-2.5 shadow-sm">
              <div className="relative flex items-center justify-center mb-1.5">
                <div className="w-7 h-7 bg-blue-100 rounded-lg flex items-center justify-center">
                  <TrendingUp className="w-3.5 h-3.5 text-blue-600" />
                </div>
              </div>
              <div className="relative text-center">
                <div className="text-xl font-black text-blue-700 tabular-nums">{stats.total}</div>
                <div className="text-[9px] text-slate-500 font-semibold uppercase tracking-wide">{t.dispatch.totalSmall}</div>
              </div>
            </div>

            {/* Completed */}
            <div className="relative overflow-hidden bg-gradient-to-b from-emerald-50 to-white border border-emerald-100/80 rounded-xl p-2.5 shadow-sm">
              <div className="relative flex items-center justify-center mb-1.5">
                <div className="w-7 h-7 bg-emerald-100 rounded-lg flex items-center justify-center">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                </div>
              </div>
              <div className="relative text-center">
                <div className="text-xl font-black text-emerald-700 tabular-nums">{stats.completed}</div>
                <div className="text-[9px] text-slate-500 font-semibold uppercase tracking-wide">{t.dispatch.doneSmall}</div>
              </div>
            </div>

            {/* Error Orders */}
            <div className="relative overflow-hidden bg-gradient-to-b from-rose-50 to-white border border-rose-100/80 rounded-xl p-2.5 shadow-sm">
              <div className="relative flex items-center justify-center mb-1.5">
                <div className="w-7 h-7 bg-rose-100 rounded-lg flex items-center justify-center">
                  <XCircle className="w-3.5 h-3.5 text-rose-600" />
                </div>
              </div>
              <div className="relative text-center">
                <div className="text-xl font-black text-rose-700 tabular-nums">{stats.error}</div>
                <div className="text-[9px] text-slate-500 font-semibold uppercase tracking-wide">{t.dispatch.errorsLabel}</div>
              </div>
            </div>

            {/* Submitted Orders */}
            <div className="relative overflow-hidden bg-gradient-to-b from-cyan-50 to-white border border-cyan-100/80 rounded-xl p-2.5 shadow-sm">
              <div className="relative flex items-center justify-center mb-1.5">
                <div className="w-7 h-7 bg-cyan-100 rounded-lg flex items-center justify-center">
                  <Send className="w-3.5 h-3.5 text-cyan-600" />
                </div>
              </div>
              <div className="relative text-center">
                <div className="text-xl font-black text-cyan-700 tabular-nums">{todaySubmittedOrders}</div>
                <div className="text-[9px] text-slate-500 font-semibold uppercase tracking-wide">{t.dispatch.submittedSmall}</div>
              </div>
            </div>

            {/* Timeout Orders */}
            <div className="relative overflow-hidden bg-gradient-to-b from-orange-50 to-white border border-orange-100/80 rounded-xl p-2.5 shadow-sm">
              <div className="relative flex items-center justify-center mb-1.5">
                <div className="w-7 h-7 bg-orange-100 rounded-lg flex items-center justify-center">
                  <Clock className="w-3.5 h-3.5 text-orange-600" />
                </div>
              </div>
              <div className="relative text-center">
                <div className="text-xl font-black text-orange-700 tabular-nums">{stats.timeout}</div>
                <div className="text-[9px] text-slate-500 font-semibold uppercase tracking-wide">{t.dispatch.timeoutSmallLabel}</div>
              </div>
            </div>

            {/* Success Rate */}
            <div className="relative overflow-hidden bg-gradient-to-b from-amber-50 to-white border border-amber-100/80 rounded-xl p-2.5 shadow-sm">
              <div className="relative flex items-center justify-center mb-1.5">
                <div className="w-7 h-7 bg-amber-100 rounded-lg flex items-center justify-center">
                  <Zap className="w-3.5 h-3.5 text-amber-600" />
                </div>
              </div>
              <div className="relative text-center">
                <div className="text-xl font-black text-amber-700 tabular-nums">
                  {(stats.completed + stats.error + stats.timeout) > 0 ? Math.round((stats.completed / (stats.completed + stats.error + stats.timeout)) * 100) : 0}%
                </div>
                <div className="text-[9px] text-slate-500 font-semibold uppercase tracking-wide">{t.dispatch.successRateLabel}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Cards - Premium Light Theme */}
      <div className="relative">
        {/* DESKTOP: Full cards in grid (desktop only - lg and up) */}
        <div className="hidden lg:grid relative grid-cols-6 gap-4" style={{ zIndex: 1 }}>
        {/* TODAY TOTAL */}
        <div className="group relative bg-white border border-gray-200/80 rounded-2xl p-5 overflow-hidden transition-all duration-300 hover:shadow-lg hover:shadow-blue-100/50 hover:-translate-y-1">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 to-blue-400 rounded-t-2xl"></div>
          <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
          <div className="relative">
            <div className="flex items-center justify-between mb-3">
              <span className="text-gray-500 text-[11px] font-bold uppercase tracking-wider">{t.dispatch.todayTotal}</span>
              <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center border border-blue-100 group-hover:bg-blue-100 transition-colors">
                <TrendingUp className="w-4.5 h-4.5 text-blue-600" />
              </div>
            </div>
            <div className="text-3xl font-black text-gray-900 mb-1 tabular-nums">{stats.total}</div>
            <div className="text-xs text-gray-400 font-medium">{t.dispatch.totalAssignmentsToday}</div>
          </div>
        </div>

        {/* COMPLETED */}
        <div className="group relative bg-white border border-gray-200/80 rounded-2xl p-5 overflow-hidden transition-all duration-300 hover:shadow-lg hover:shadow-emerald-100/50 hover:-translate-y-1">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-t-2xl"></div>
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
          <div className="relative">
            <div className="flex items-center justify-between mb-3">
              <span className="text-gray-500 text-[11px] font-bold uppercase tracking-wider">{t.dispatch.completedLabel}</span>
              <div className="w-9 h-9 bg-emerald-50 rounded-xl flex items-center justify-center border border-emerald-100 group-hover:bg-emerald-100 transition-colors">
                <CheckCircle className="w-4.5 h-4.5 text-emerald-600" />
              </div>
            </div>
            <div className="text-3xl font-black text-gray-900 mb-1 tabular-nums">{stats.completed}</div>
            <div className="text-xs text-gray-400 font-medium">{t.dispatch.successfullyCompleted}</div>
          </div>
        </div>

        {/* ERROR ORDERS */}
        <div className="group relative bg-white border border-gray-200/80 rounded-2xl p-5 overflow-hidden transition-all duration-300 hover:shadow-lg hover:shadow-rose-100/50 hover:-translate-y-1">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-rose-500 to-rose-400 rounded-t-2xl"></div>
          <div className="absolute inset-0 bg-gradient-to-br from-rose-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
          <div className="relative">
            <div className="flex items-center justify-between mb-3">
              <span className="text-gray-500 text-[11px] font-bold uppercase tracking-wider">{t.dispatch.errorOrders}</span>
              <div className="w-9 h-9 bg-rose-50 rounded-xl flex items-center justify-center border border-rose-100 group-hover:bg-rose-100 transition-colors">
                <XCircle className="w-4.5 h-4.5 text-rose-600" />
              </div>
            </div>
            <div className="text-3xl font-black text-gray-900 mb-1 tabular-nums">{stats.error}</div>
            <div className="text-xs text-gray-400 font-medium">{t.dispatch.reportedErrors}</div>
          </div>
        </div>

        {/* SUBMITTED ORDERS */}
        <div className="group relative bg-white border border-gray-200/80 rounded-2xl p-5 overflow-hidden transition-all duration-300 hover:shadow-lg hover:shadow-cyan-100/50 hover:-translate-y-1">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 to-cyan-400 rounded-t-2xl"></div>
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
          <div className="relative">
            <div className="flex items-center justify-between mb-3">
              <span className="text-gray-500 text-[11px] font-bold uppercase tracking-wider">{t.dispatch.submittedLabel}</span>
              <div className="w-9 h-9 bg-cyan-50 rounded-xl flex items-center justify-center border border-cyan-100 group-hover:bg-cyan-100 transition-colors">
                <Send className="w-4.5 h-4.5 text-cyan-600" />
              </div>
            </div>
            <div className="text-3xl font-black text-gray-900 mb-1 tabular-nums">{todaySubmittedOrders}</div>
            <div className="text-xs text-gray-400 font-medium">{t.dispatch.ordersSubmittedToday}</div>
          </div>
        </div>

        {/* TIMEOUT ORDERS */}
        <div className="group relative bg-white border border-gray-200/80 rounded-2xl p-5 overflow-hidden transition-all duration-300 hover:shadow-lg hover:shadow-orange-100/50 hover:-translate-y-1">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-orange-500 to-orange-400 rounded-t-2xl"></div>
          <div className="absolute inset-0 bg-gradient-to-br from-orange-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
          <div className="relative">
            <div className="flex items-center justify-between mb-3">
              <span className="text-gray-500 text-[11px] font-bold uppercase tracking-wider">{t.dispatch.timeoutOrders}</span>
              <div className="w-9 h-9 bg-orange-50 rounded-xl flex items-center justify-center border border-orange-100 group-hover:bg-orange-100 transition-colors">
                <Clock className="w-4.5 h-4.5 text-orange-600" />
              </div>
            </div>
            <div className="text-3xl font-black text-gray-900 mb-1 tabular-nums">{stats.timeout}</div>
            <div className="text-xs text-gray-400 font-medium">{t.dispatch.timeoutHandling}</div>
          </div>
        </div>

        {/* SUCCESS RATE */}
        <div className="group relative bg-white border border-gray-200/80 rounded-2xl p-5 overflow-hidden transition-all duration-300 hover:shadow-lg hover:shadow-amber-100/50 hover:-translate-y-1">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 to-amber-400 rounded-t-2xl"></div>
          <div className="absolute inset-0 bg-gradient-to-br from-amber-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
          <div className="relative">
            <div className="flex items-center justify-between mb-3">
              <span className="text-gray-500 text-[11px] font-bold uppercase tracking-wider">{t.dispatch.successRateLabel}</span>
              <div className="w-9 h-9 bg-amber-50 rounded-xl flex items-center justify-center border border-amber-100 group-hover:bg-amber-100 transition-colors">
                <Zap className="w-4.5 h-4.5 text-amber-600" />
              </div>
            </div>
            <div className="text-3xl font-black text-gray-900 mb-1 tabular-nums">
              {(stats.completed + stats.error + stats.timeout) > 0 ? Math.round((stats.completed / (stats.completed + stats.error + stats.timeout)) * 100) : 0}%
            </div>
            <div className="text-xs text-gray-400 font-medium">{t.dispatch.completionPercentage}</div>
          </div>
        </div>
        </div>

        {/* TABLET: Compact 5-column layout optimized for tablets */}
        <div className="hidden md:grid lg:hidden relative grid-cols-6 gap-2.5" style={{ zIndex: 1 }}>
          {/* TODAY TOTAL */}
          <div className="group relative bg-white border border-gray-200/80 rounded-xl p-3.5 overflow-hidden transition-all duration-300 hover:shadow-md hover:shadow-blue-100/50 hover:-translate-y-0.5">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 to-blue-400 rounded-t-xl"></div>
            <div className="relative">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">{t.dispatch.totalLabel}</span>
                <div className="w-7 h-7 bg-blue-50 rounded-lg flex items-center justify-center border border-blue-100">
                  <TrendingUp className="w-3.5 h-3.5 text-blue-600" />
                </div>
              </div>
              <div className="text-2xl font-black text-gray-900 mb-0.5 tabular-nums">{stats.total}</div>
              <div className="text-[10px] text-gray-400 font-medium">{t.dispatch.assignmentsLabel}</div>
            </div>
          </div>

          {/* COMPLETED */}
          <div className="group relative bg-white border border-gray-200/80 rounded-xl p-3.5 overflow-hidden transition-all duration-300 hover:shadow-md hover:shadow-emerald-100/50 hover:-translate-y-0.5">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-t-xl"></div>
            <div className="relative">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">{t.dispatch.doneLabel}</span>
                <div className="w-7 h-7 bg-emerald-50 rounded-lg flex items-center justify-center border border-emerald-100">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                </div>
              </div>
              <div className="text-2xl font-black text-gray-900 mb-0.5 tabular-nums">{stats.completed}</div>
              <div className="text-[10px] text-gray-400 font-medium">{t.dispatch.completedSmall}</div>
            </div>
          </div>

          {/* ERROR ORDERS */}
          <div className="group relative bg-white border border-gray-200/80 rounded-xl p-3.5 overflow-hidden transition-all duration-300 hover:shadow-md hover:shadow-rose-100/50 hover:-translate-y-0.5">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-rose-500 to-rose-400 rounded-t-xl"></div>
            <div className="relative">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">{t.dispatch.errorLabel}</span>
                <div className="w-7 h-7 bg-rose-50 rounded-lg flex items-center justify-center border border-rose-100">
                  <XCircle className="w-3.5 h-3.5 text-rose-600" />
                </div>
              </div>
              <div className="text-2xl font-black text-gray-900 mb-0.5 tabular-nums">{stats.error}</div>
              <div className="text-[10px] text-gray-400 font-medium">{t.dispatch.errorsSmall}</div>
            </div>
          </div>

          {/* SUBMITTED ORDERS */}
          <div className="group relative bg-white border border-gray-200/80 rounded-xl p-3.5 overflow-hidden transition-all duration-300 hover:shadow-md hover:shadow-cyan-100/50 hover:-translate-y-0.5">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-cyan-500 to-cyan-400 rounded-t-xl"></div>
            <div className="relative">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">{t.dispatch.submittedLabel}</span>
                <div className="w-7 h-7 bg-cyan-50 rounded-lg flex items-center justify-center border border-cyan-100">
                  <Send className="w-3.5 h-3.5 text-cyan-600" />
                </div>
              </div>
              <div className="text-2xl font-black text-gray-900 mb-0.5 tabular-nums">{todaySubmittedOrders}</div>
              <div className="text-[10px] text-gray-400 font-medium">{t.dispatch.submittedSmall}</div>
            </div>
          </div>

          {/* TIMEOUT ORDERS */}
          <div className="group relative bg-white border border-gray-200/80 rounded-xl p-3.5 overflow-hidden transition-all duration-300 hover:shadow-md hover:shadow-orange-100/50 hover:-translate-y-0.5">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-orange-400 rounded-t-xl"></div>
            <div className="relative">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">{t.dispatch.timeoutLabel}</span>
                <div className="w-7 h-7 bg-orange-50 rounded-lg flex items-center justify-center border border-orange-100">
                  <Clock className="w-3.5 h-3.5 text-orange-600" />
                </div>
              </div>
              <div className="text-2xl font-black text-gray-900 mb-0.5 tabular-nums">{stats.timeout}</div>
              <div className="text-[10px] text-gray-400 font-medium">{t.dispatch.timeoutSmall}</div>
            </div>
          </div>

          {/* SUCCESS RATE */}
          <div className="group relative bg-white border border-gray-200/80 rounded-xl p-3.5 overflow-hidden transition-all duration-300 hover:shadow-md hover:shadow-amber-100/50 hover:-translate-y-0.5">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-amber-500 to-amber-400 rounded-t-xl"></div>
            <div className="relative">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">{t.dispatch.successRateLabel}</span>
                <div className="w-7 h-7 bg-amber-50 rounded-lg flex items-center justify-center border border-amber-100">
                  <Zap className="w-3.5 h-3.5 text-amber-600" />
                </div>
              </div>
              <div className="text-2xl font-black text-gray-900 mb-0.5 tabular-nums">
                {(stats.completed + stats.error + stats.timeout) > 0 ? Math.round((stats.completed / (stats.completed + stats.error + stats.timeout)) * 100) : 0}%
              </div>
              <div className="text-[10px] text-gray-400 font-medium">{t.dispatch.successSmall}</div>
            </div>
          </div>
        </div>
      </div>


      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px) translateX(0px); }
          25% { transform: translateY(-10px) translateX(5px); }
          50% { transform: translateY(-5px) translateX(-5px); }
          75% { transform: translateY(-15px) translateX(3px); }
        }

        .animate-float {
          animation: float 6s ease-in-out infinite;
        }

        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .animate-spin-slow {
          animation: spin-slow 3s linear infinite;
        }

        @keyframes gradient-shift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }

        /* Data Flow Animation for Mobile Streams */
        @keyframes dataFlow {
          0% { transform: translateY(-100%); opacity: 0; }
          10% { opacity: 0.5; }
          50% { opacity: 0.8; }
          90% { opacity: 0.5; }
          100% { transform: translateY(100%); opacity: 0; }
        }

        /* Custom Scrollbar for Order Details */
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }

        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(15, 23, 42, 0.5);
          border-radius: 10px;
        }

        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(96, 165, 250, 0.5);
          border-radius: 10px;
          border: 2px solid rgba(15, 23, 42, 0.5);
        }

        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(96, 165, 250, 0.8);
        }
      `}</style>

      {/* Current Order Detail - NOW INTEGRATED INTO WORK SESSION CONTROL PANEL ABOVE */}


      {/* Today's Assignment Records */}
      <div className="relative rounded-2xl overflow-hidden border-2 border-blue-500/80 shadow-xl shadow-blue-200/50" style={{ background: 'linear-gradient(145deg, #ffffff 0%, #f0f7ff 25%, #e6f2fe 50%, #f5faff 75%, #ffffff 100%)' }}>
        {/* Decorative background pattern */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-20 -right-20 w-[350px] h-[350px] opacity-30" style={{ background: 'radial-gradient(circle, rgba(37,99,235,0.06) 0%, transparent 55%)' }}></div>
          <div className="absolute -bottom-16 -left-16 w-[280px] h-[280px] opacity-25" style={{ background: 'radial-gradient(circle, rgba(14,165,233,0.05) 0%, transparent 55%)' }}></div>
          <svg className="absolute inset-0 w-full h-full opacity-[0.03]" xmlns="http://www.w3.org/2000/svg">
            <pattern id="dispatch-grid" x="0" y="0" width="48" height="48" patternUnits="userSpaceOnUse">
              <circle cx="24" cy="24" r="1.2" fill="#1e40af" />
            </pattern>
            <rect width="100%" height="100%" fill="url(#dispatch-grid)" />
          </svg>
        </div>

        {/* HEADER SECTION */}
        <div className="relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #1e40af 0%, #2563eb 50%, #3b82f6 100%)' }}>
          {/* Header decorative elements */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute top-0 right-0 w-20 sm:w-32 h-20 sm:h-32 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2"></div>
            <div className="absolute bottom-0 left-1/4 w-16 sm:w-24 h-16 sm:h-24 bg-white/5 rounded-full translate-y-1/2"></div>
            <div className="absolute top-1/2 right-1/3 w-8 h-8 bg-sky-300/10 rounded-full -translate-y-1/2 blur-sm"></div>
            <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/5 rounded-full blur-2xl"></div>
            <div className="absolute -bottom-8 -left-8 w-32 h-32 bg-blue-300/10 rounded-full blur-xl"></div>
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>
          </div>
          <div className="relative px-4 md:px-8 py-3 md:py-5">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2 md:space-x-3">
                  <div className="w-8 h-8 md:w-10 md:h-10 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center border border-white/30 flex-shrink-0">
                    <FileText className="w-4 h-4 md:w-5 md:h-5 text-white" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base md:text-xl font-bold text-white tracking-tight truncate">
                        <span className="hidden md:inline">{t.dispatch.todayAssignmentRecords}</span>
                        <span className="md:hidden">{t.dispatch.todayRecords}</span>
                      </h3>
                      {todayOrders.length > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-white/15 border border-white/20 text-[10px] md:text-xs font-semibold text-blue-100 tabular-nums flex-shrink-0 lg:hidden">
                          {todayOrders.length}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <div className="w-1.5 h-1.5 bg-green-300 rounded-full animate-pulse"></div>
                      <span className="text-[10px] md:text-xs text-blue-100 font-medium tracking-wider uppercase">
                        {todayOrders.length > 0
                          ? `${todayOrders.length} ${t.dispatch.assignmentsToday}`
                          : t.dispatch.noAssignmentsYet}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              {/* Desktop: total count badge */}
              {todayOrders.length > 0 && (
                <div className="hidden lg:block flex-shrink-0">
                  <div className="relative bg-white/15 border border-white/30 backdrop-blur-sm rounded-xl px-5 py-2.5 text-center">
                    <div className="text-2xl font-black text-white tabular-nums leading-none">
                      {todayOrders.length}
                    </div>
                    <div className="text-[10px] text-blue-200 uppercase tracking-wider font-bold mt-0.5">
                      {t.dispatch.totalLabel}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          {/* Pagination sub-bar - mobile/tablet only */}
          {todayOrders.length > RECORDS_PER_PAGE && (
            <div className="lg:hidden relative flex items-center justify-between px-4 md:px-8 py-0.5 bg-gradient-to-r from-blue-900/30 via-blue-800/20 to-blue-900/30 border-t border-white/10">
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -left-4 top-1/2 -translate-y-1/2 w-16 h-16 bg-sky-400/8 rounded-full blur-md"></div>
                <div className="absolute -right-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-blue-300/8 rounded-full blur-md"></div>
              </div>
              <button
                onClick={() => setRecordsPage(p => p - 1)}
                disabled={recordsPage <= 0}
                className="relative w-8 h-6 rounded flex items-center justify-center text-white disabled:opacity-30 disabled:cursor-not-allowed active:bg-white/15 transition-all"
              >
                <ChevronLeft className="w-5 h-5" strokeWidth={3} />
              </button>
              <span className="relative text-sm font-bold text-white tabular-nums">
                {recordsPage + 1} / {Math.ceil(todayOrders.length / RECORDS_PER_PAGE)}
              </span>
              <button
                onClick={() => setRecordsPage(p => p + 1)}
                disabled={recordsPage >= Math.ceil(todayOrders.length / RECORDS_PER_PAGE) - 1}
                className="relative w-8 h-6 rounded flex items-center justify-center text-white disabled:opacity-30 disabled:cursor-not-allowed active:bg-white/15 transition-all"
              >
                <ChevronRight className="w-5 h-5" strokeWidth={3} />
              </button>
            </div>
          )}
        </div>

        {todayOrders.length === 0 ? (
          <div className="relative px-8 py-16 text-center">
            <div className="flex flex-col items-center justify-center space-y-4">
              <div className="relative">
                <div className="absolute inset-0 bg-blue-200/50 rounded-full blur-xl animate-pulse"></div>
                <div className="relative w-16 h-16 bg-gradient-to-br from-blue-50 to-sky-50 rounded-2xl flex items-center justify-center border border-blue-100 ring-1 ring-blue-100/50">
                  <Package className="w-8 h-8 text-blue-300" />
                </div>
              </div>
              <div className="text-slate-600 font-medium text-base">{t.dispatch.noAssignmentsReceived}</div>
              <div className="text-xs text-blue-400">{t.dispatch.startToReceive}</div>
            </div>
          </div>
        ) : (
          <div className="relative">
            <div
              className="lg:overflow-y-auto overflow-x-hidden scrollbar-hide"
              style={{
                maxHeight: (isMobile || isTablet) ? 'none' : '680px',
                WebkitOverflowScrolling: 'touch'
              }}
            >
              <div className="p-3 md:p-5 space-y-3 md:space-y-3.5">
                {((isMobile || isTablet)
                  ? todayOrders.slice(recordsPage * RECORDS_PER_PAGE, (recordsPage + 1) * RECORDS_PER_PAGE)
                  : todayOrders
                ).map((order, index) => {
                  const actualIndex = (isMobile || isTablet) ? recordsPage * RECORDS_PER_PAGE + index : index;
                  const statusStyle = order.status === 'completed'
                    ? { gradient: 'from-emerald-50 via-white to-teal-50', ring: 'ring-emerald-200/80', accent: 'from-emerald-500 to-teal-400', iconBg: 'bg-gradient-to-br from-emerald-500 to-teal-500', dotColor: 'bg-emerald-500' }
                    : order.status === 'error'
                    ? { gradient: 'from-rose-50 via-white to-red-50', ring: 'ring-rose-200/80', accent: 'from-rose-500 to-red-400', iconBg: 'bg-gradient-to-br from-rose-500 to-red-500', dotColor: 'bg-rose-500' }
                    : order.status === 'timeout' || order.status === 'timeout_cancelled'
                    ? { gradient: 'from-amber-50 via-white to-orange-50', ring: 'ring-amber-200/80', accent: 'from-amber-500 to-orange-400', iconBg: 'bg-gradient-to-br from-amber-500 to-orange-500', dotColor: 'bg-amber-500' }
                    : { gradient: 'from-blue-50 via-white to-sky-50', ring: 'ring-blue-200/80', accent: 'from-blue-500 to-sky-400', iconBg: 'bg-gradient-to-br from-blue-500 to-sky-500', dotColor: 'bg-blue-500' };

                  return (
                  <div
                    key={order.id}
                    onClick={() => handleOrderClick(order)}
                    className={`group relative rounded-2xl overflow-hidden cursor-pointer transition-all duration-300 active:scale-[0.98] hover:-translate-y-0.5 hover:shadow-lg bg-gradient-to-br ${statusStyle.gradient} ring-1 ${statusStyle.ring} shadow-sm`}
                  >
                    {/* Left accent bar */}
                    <div className={`absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-b ${statusStyle.accent} rounded-l-2xl`}></div>

                    {/* Decorative corner */}
                    <div className="absolute top-0 right-0 w-20 h-20 overflow-hidden pointer-events-none">
                      <div className={`absolute -top-10 -right-10 w-20 h-20 bg-gradient-to-bl ${statusStyle.accent} opacity-[0.06] rounded-full`} />
                    </div>

                    {/* DESKTOP LAYOUT */}
                    <div className="hidden md:block pl-6 pr-5 py-4">
                      <div className="flex items-start gap-4">
                        {/* Order number badge */}
                        <div className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center shadow-sm ${statusStyle.iconBg}`}>
                          <span className="text-xs font-bold text-white">#{actualIndex + 1}</span>
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-4 mb-2">
                            <div className="text-sm text-slate-700 leading-relaxed line-clamp-2 break-all flex-1 group-hover:text-slate-800 transition-colors">
                              {order.dispatch_orders.order_content}
                            </div>
                            <div className="flex-shrink-0">
                              {getStatusBadge(order.status)}
                            </div>
                          </div>

                          {order.remarks && (
                            <div className="inline-flex items-start space-x-2 px-3 py-1.5 bg-rose-50 border border-rose-200/80 rounded-lg max-w-full mb-2">
                              <AlertTriangle className="w-3.5 h-3.5 text-rose-500 flex-shrink-0 mt-0.5" />
                              <span className="text-xs text-rose-600 font-medium break-all min-w-0">{order.remarks}</span>
                            </div>
                          )}

                          {/* Time info row */}
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className="inline-flex items-center gap-1.5 text-[10px] px-2.5 py-0.5 rounded-md font-medium bg-white/80 ring-1 ring-blue-100 text-blue-600">
                              <Clock className="w-3 h-3" />
                              {new Date(order.assigned_at).toLocaleString(dateLocale, {
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false
                              })}
                            </span>
                            {order.completed_at && (
                              <span className={`inline-flex items-center gap-1.5 text-[10px] px-2.5 py-0.5 rounded-md font-medium bg-white/80 ring-1 ${
                                order.status === 'error' ? 'ring-rose-100 text-rose-600' :
                                order.status === 'timeout' || order.status === 'timeout_cancelled' ? 'ring-amber-100 text-amber-600' :
                                'ring-emerald-100 text-emerald-600'
                              }`}>
                                <CheckCircle className="w-3 h-3" />
                                {new Date(order.completed_at).toLocaleString(dateLocale, {
                                  year: 'numeric',
                                  month: '2-digit',
                                  day: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  hour12: false
                                })}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* MOBILE LAYOUT */}
                    <div className="md:hidden relative pl-5 pr-3 py-3.5 overflow-hidden">
                      <div className="relative space-y-2">
                        {/* Top row: number + time + status */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${statusStyle.iconBg}`}>
                              <span className="text-[9px] font-bold text-white">#{actualIndex + 1}</span>
                            </div>
                            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md font-medium bg-white/80 ring-1 ring-slate-200/80 text-slate-500">
                              <Clock className="w-2.5 h-2.5" />
                              {new Date(order.assigned_at).toLocaleString(dateLocale, {
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false
                              })}
                            </span>
                          </div>
                          {getStatusBadge(order.status)}
                        </div>

                        {/* Content */}
                        <div className="text-xs text-slate-700 leading-relaxed line-clamp-2 break-all">
                          {order.dispatch_orders.order_content}
                        </div>

                        {order.remarks && (
                          <div className="flex items-start space-x-1.5 px-2 py-1 bg-rose-50 border border-rose-100 rounded-lg overflow-hidden">
                            <AlertTriangle className="w-3 h-3 text-rose-500 flex-shrink-0 mt-0.5" />
                            <span className="text-[10px] text-rose-600 font-medium leading-tight break-all min-w-0">{order.remarks}</span>
                          </div>
                        )}

                        {order.completed_at && (
                          <div className="flex items-center gap-1.5">
                            <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md font-medium bg-white/80 ring-1 ${
                              order.status === 'error' ? 'ring-rose-100 text-rose-600' :
                              order.status === 'timeout' || order.status === 'timeout_cancelled' ? 'ring-amber-100 text-amber-600' :
                              'ring-emerald-100 text-emerald-600'
                            }`}>
                              <CheckCircle className="w-2.5 h-2.5" />
                              Done: {new Date(order.completed_at).toLocaleString(dateLocale, {
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false
                              })}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>

            {todayOrders.length > 10 && (
              <div className="hidden lg:flex absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white to-transparent pointer-events-none items-end justify-center pb-3">
                <div className="text-xs text-blue-400 flex items-center space-x-1 font-medium">
                  <span>{t.dispatch.scrollForMore}</span>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Order Not Submitted Warning Modal */}
      {showOrderNotSubmittedModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4 overflow-hidden" onClick={() => setShowOrderNotSubmittedModal(false)} style={{ touchAction: 'none', overscrollBehavior: 'contain' }}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-white" />
                </div>
                <h3 className="text-lg font-bold text-white">{t.dispatch.orderNotSubmitted}</h3>
              </div>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-gray-600 leading-relaxed mb-5">{t.dispatch.orderNotSubmittedMessage}</p>
              {currentOrder?.assignment_id && (
                <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg mb-5">
                  <span className="text-xs font-bold text-blue-600 uppercase">{t.dispatch.assignmentIdLabel}</span>
                  <span className="text-sm font-black text-blue-700 font-mono">{currentOrder.assignment_id}</span>
                </div>
              )}
              <div className="flex gap-3">
                <button onClick={() => setShowOrderNotSubmittedModal(false)} className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl font-semibold text-sm hover:bg-gray-50 transition-colors">
                  {t.dispatch.cancel}
                </button>
                <button onClick={() => { setShowOrderNotSubmittedModal(false); onNavigateToOrders?.(); }} className="flex-1 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl font-bold text-sm hover:shadow-lg transition-all">
                  {t.dispatch.goToOrders}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Order Detail Modal - Light Theme Premium Design */}
      {showOrderDetailModal && selectedOrderDetail && (() => {
        const status = selectedOrderDetail.status;
        const isCompleted = status === 'completed';
        const isError = status === 'error';
        const isTimeout = status === 'timeout' || status === 'timeout_cancelled';

        const statusAccent = isCompleted ? 'emerald' : isError ? 'rose' : isTimeout ? 'amber' : 'blue';
        const accentColors = {
          emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', dot: 'bg-emerald-500', headerGradient: 'from-emerald-600 to-teal-500', btnShadow: 'rgba(5,150,105,0.2)' },
          rose: { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700', dot: 'bg-rose-500', headerGradient: 'from-rose-600 to-red-500', btnShadow: 'rgba(225,29,72,0.2)' },
          amber: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', dot: 'bg-amber-500', headerGradient: 'from-amber-600 to-orange-500', btnShadow: 'rgba(217,119,6,0.2)' },
          blue: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', dot: 'bg-blue-500', headerGradient: 'from-blue-600 to-blue-500', btnShadow: 'rgba(37,99,235,0.2)' },
        };
        const accent = accentColors[statusAccent];

        return createPortal(
          <div
            className="fixed inset-0 z-[9999] flex bg-black/50 animate-in fade-in duration-200
            md:items-stretch md:justify-stretch md:p-0
            lg:items-stretch lg:justify-stretch lg:p-0
            xl:items-center xl:justify-center xl:p-4"
            onClick={() => setShowOrderDetailModal(false)}
            style={{
              alignItems: isMobile ? 'stretch' : undefined,
              justifyContent: isMobile ? 'stretch' : undefined,
              padding: isMobile ? '0' : undefined,
              touchAction: 'none',
              overscrollBehavior: 'contain'
            }}
          >
            <div
              ref={modalContentRef}
              className={`relative bg-white shadow-2xl shadow-gray-300/50 flex flex-col overflow-hidden animate-in duration-200
                md:max-w-full md:h-screen md:rounded-none md:max-h-screen
                xl:max-w-2xl xl:rounded-2xl xl:max-h-[85vh] xl:h-auto
                ${isMobile ? 'fixed inset-0 w-full h-full rounded-none slide-in-from-bottom' : ''}`}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: isMobile ? '100%' : undefined,
                height: isMobile ? '100dvh' : undefined,
                maxHeight: isMobile ? '100dvh' : undefined
              }}
            >
              {/* Header */}
              <div
                className={`relative bg-gradient-to-r ${accent.headerGradient} py-3 sm:px-8 sm:py-5 flex-shrink-0`}
                style={{
                  paddingLeft: isMobile ? '0' : undefined,
                  paddingRight: isMobile ? '0' : undefined,
                  paddingTop: isMobile ? 'calc(env(safe-area-inset-top) + 12px)' : undefined
                }}
              >
                <div
                  className="flex items-center justify-between gap-2"
                  style={{
                    paddingLeft: isMobile ? '16px' : undefined,
                    paddingRight: isMobile ? '16px' : undefined
                  }}
                >
                  <div className="flex items-center space-x-2.5 sm:space-x-4 min-w-0 flex-1">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-white/15 backdrop-blur-sm rounded-xl flex items-center justify-center border border-white/20 flex-shrink-0">
                      <Package className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base sm:text-xl font-bold text-white tracking-tight truncate">{t.dispatch.orderDetails}</h3>
                      <p className="text-xs sm:text-sm text-white/70 mt-0.5 font-medium">{t.dispatch.assignmentNumber} #{todayOrders.findIndex(o => o.id === selectedOrderDetail.id) + 1}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowOrderDetailModal(false)}
                    className="flex-shrink-0 w-9 h-9 sm:w-10 sm:h-10 bg-white/15 hover:bg-white/25 active:bg-white/30 border border-white/20 rounded-xl inline-flex items-center justify-center transition-all duration-200 active:scale-95 touch-manipulation"
                  >
                    <XCircle className="w-5 h-5 text-white/90 flex-shrink-0" />
                  </button>
                </div>
              </div>

              {/* Content */}
              <div
                className="relative py-4 sm:px-8 sm:py-6 space-y-4 sm:space-y-5 overflow-y-auto scrollbar-hide flex-1"
                style={{
                  scrollbarWidth: 'none',
                  msOverflowStyle: 'none',
                  paddingLeft: isMobile ? '16px' : undefined,
                  paddingRight: isMobile ? '16px' : undefined,
                  WebkitOverflowScrolling: 'touch'
                }}
              >
                {/* Status, Assignment ID & Time Cards */}
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  <div className={`${accent.bg} border ${accent.border} rounded-xl p-3 sm:p-4`}>
                    <div className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1.5">{t.dispatch.statusLabel}</div>
                    <div className="scale-90 sm:scale-100 origin-left">{getStatusBadge(selectedOrderDetail.status)}</div>
                  </div>
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 sm:p-4">
                    <div className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1.5">{t.dispatch.assignedLabel}</div>
                    <div className="text-xs sm:text-sm text-gray-800 font-semibold font-mono leading-tight">
                      {new Date(selectedOrderDetail.assigned_at).toLocaleString(dateLocale, {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false
                      })}
                    </div>
                  </div>
                </div>

                {/* Order Content */}
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <div className="flex items-center space-x-2 px-3 sm:px-4 py-2.5 sm:py-3 bg-gray-50 border-b border-gray-200">
                    <FileText className="w-4 h-4 text-gray-500 flex-shrink-0" />
                    <h4 className="text-xs sm:text-sm font-semibold text-gray-700">{t.dispatch.orderContent}</h4>
                  </div>
                  <div className="text-xs sm:text-sm text-gray-700 leading-relaxed p-3 sm:p-4 max-h-[140px] sm:max-h-[220px] overflow-y-auto scrollbar-hide" style={{ WebkitOverflowScrolling: 'touch' }}>
                    {selectedOrderDetail.dispatch_orders.order_content}
                  </div>
                </div>

                {/* Timeline */}
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <div className="flex items-center space-x-2 px-3 sm:px-4 py-2.5 sm:py-3 bg-gray-50 border-b border-gray-200">
                    <Clock className="w-4 h-4 text-gray-500 flex-shrink-0" />
                    <h4 className="text-xs sm:text-sm font-semibold text-gray-700">{t.dispatch.timeline}</h4>
                  </div>
                  <div className="p-3 sm:p-4 space-y-3">
                    <div className="flex items-center space-x-3">
                      <div className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0"></div>
                      <div className="flex-1 flex items-center justify-between">
                        <span className="text-xs text-gray-500 font-medium">{t.dispatch.assignedLabel}</span>
                        <span className="text-xs text-gray-700 font-mono font-semibold">
                          {new Date(selectedOrderDetail.assigned_at).toLocaleString(dateLocale, {
                            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
                          })}
                        </span>
                      </div>
                    </div>

                    {selectedOrderDetail.accepted_at && (
                      <div className="flex items-center space-x-3">
                        <div className="w-2 h-2 bg-emerald-500 rounded-full flex-shrink-0"></div>
                        <div className="flex-1 flex items-center justify-between">
                          <span className="text-xs text-gray-500 font-medium">{t.dispatch.acceptedLabel}</span>
                          <span className="text-xs text-gray-700 font-mono font-semibold">
                            {new Date(selectedOrderDetail.accepted_at).toLocaleString(dateLocale, {
                              year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
                            })}
                          </span>
                        </div>
                      </div>
                    )}

                    {selectedOrderDetail.completed_at && (
                      <div className="flex items-center space-x-3">
                        <div className="w-2 h-2 bg-teal-500 rounded-full flex-shrink-0"></div>
                        <div className="flex-1 flex items-center justify-between">
                          <span className="text-xs text-gray-500 font-medium">{t.dispatch.completedTimelineLabel}</span>
                          <span className="text-xs text-gray-700 font-mono font-semibold">
                            {new Date(selectedOrderDetail.completed_at).toLocaleString(dateLocale, {
                              year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
                            })}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Remarks */}
                {selectedOrderDetail.remarks && (
                  <div className="bg-rose-50 border border-rose-200 rounded-xl overflow-hidden">
                    <div className="flex items-center space-x-2 px-3 sm:px-4 py-2.5 sm:py-3 border-b border-rose-200">
                      <AlertTriangle className="w-4 h-4 text-rose-500 flex-shrink-0" />
                      <h4 className="text-xs sm:text-sm font-semibold text-rose-700">{t.dispatch.remarksLabel}</h4>
                    </div>
                    <div className="text-xs sm:text-sm text-rose-700 leading-relaxed p-3 sm:p-4 max-h-[100px] sm:max-h-[150px] overflow-y-auto scrollbar-hide" style={{ WebkitOverflowScrolling: 'touch' }}>
                      {selectedOrderDetail.remarks}
                    </div>
                  </div>
                )}

                {/* System Info */}
                <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 sm:p-4">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-gray-400 uppercase tracking-wider text-[10px] font-semibold">{t.dispatch.assignmentIdLabel}</span>
                      <div className="text-gray-600 font-mono mt-0.5 text-[11px] break-all leading-tight">{selectedOrderDetail.assignment_id || selectedOrderDetail.id.slice(0, 8) + '...'}</div>
                    </div>
                    <div>
                      <span className="text-gray-400 uppercase tracking-wider text-[10px] font-semibold">{t.dispatch.orderId}</span>
                      <div className="text-gray-600 font-mono mt-0.5 text-[11px] break-all leading-tight">{selectedOrderDetail.dispatch_orders.id?.slice(0, 8) || selectedOrderDetail.dispatch_order_id?.slice(0, 8) || selectedOrderDetail.id.slice(0, 8)}...</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div
                className="relative border-t border-slate-200 bg-slate-50/80 py-3 sm:px-8 sm:py-4 flex-shrink-0"
                style={{
                  paddingLeft: isMobile ? '16px' : undefined,
                  paddingRight: isMobile ? '16px' : undefined,
                  paddingBottom: isMobile ? 'calc(env(safe-area-inset-bottom) + 12px)' : undefined
                }}
              >
                <button
                  onClick={() => setShowOrderDetailModal(false)}
                  className={`w-full min-h-[44px] py-2.5 sm:py-3 bg-gradient-to-r ${accent.headerGradient} hover:brightness-110 active:brightness-90 text-white rounded-xl font-semibold text-sm sm:text-base transition-all duration-200 active:scale-[0.98]`}
                  style={{ boxShadow: `0 4px 6px -1px ${accent.btnShadow}` }}
                >
                  {t.common.close}
                </button>
              </div>
            </div>
          </div>,
          document.body
        );
      })()}

      {/* Verification Required Modal */}
      {showVerificationModal && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            overflow: 'auto',
            touchAction: 'none',
            overscrollBehavior: 'contain'
          }}
        >
          <div className="relative bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 border-2 border-amber-500/40 rounded-2xl shadow-2xl shadow-amber-500/20 w-full max-w-md overflow-hidden">
            {/* Decorative Elements */}
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500"></div>
            <div className="absolute -top-20 -right-20 w-40 h-40 bg-amber-500/10 rounded-full blur-3xl"></div>
            <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-orange-500/10 rounded-full blur-3xl"></div>

            <div className="relative p-8">
              {/* Header */}
              <div className="flex items-start space-x-4 mb-6">
                <div className="w-14 h-14 bg-gradient-to-br from-amber-500/20 to-orange-500/20 rounded-xl flex items-center justify-center flex-shrink-0 border border-amber-500/30">
                  <ShieldAlert className="w-7 h-7 text-amber-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-2xl font-bold text-white mb-1 bg-gradient-to-r from-amber-200 to-orange-200 bg-clip-text text-transparent">
                    Verification Required
                  </h3>
                  <p className="text-sm text-gray-500">
                    Complete identity verification to start working
                  </p>
                </div>
              </div>

              {/* Content */}
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 mb-6 backdrop-blur-sm">
                <div className="flex items-start space-x-3 mb-4">
                  <div className="w-6 h-6 bg-amber-500/20 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                    <AlertCircle className="w-4 h-4 text-amber-400" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white mb-1">{t.dispatch.whyVerification}</h4>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      {t.dispatch.verificationExplanation}
                    </p>
                  </div>
                </div>

                <div className="border-t border-gray-200 pt-4">
                  <div className="space-y-2.5">
                    <div className="flex items-center space-x-3">
                      <CheckSquare className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      <span className="text-sm text-gray-600">{t.dispatch.secureAccount}</span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <CheckSquare className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      <span className="text-sm text-gray-600">{t.dispatch.enableWithdrawals}</span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <CheckSquare className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      <span className="text-sm text-gray-600">{t.dispatch.startRemoteWork}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <div className="space-y-3">
                <button
                  onClick={() => {
                    setShowVerificationModal(false);
                  }}
                  className="w-full min-h-[44px] py-3.5 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white rounded-xl font-bold text-base transition-all shadow-lg shadow-amber-500/30 hover:shadow-amber-500/50 active:scale-[0.98] flex items-center justify-center space-x-2"
                >
                  <ShieldAlert className="w-5 h-5" />
                  <span>{t.dispatch.iUnderstand}</span>
                </button>
                <p className="text-xs text-center text-gray-500">
                  {t.dispatch.completeVerification}
                </p>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Error Report Modal - Compact Design */}
      {showErrorModal && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            overflow: 'auto',
            touchAction: 'none',
            overscrollBehavior: 'contain'
          }}
        >
          <div className="relative bg-gradient-to-br from-slate-800 to-slate-900 border border-rose-500/40 rounded-xl shadow-2xl shadow-rose-500/20 w-full max-w-md mx-4">
            <div className="p-6">
              {/* Compact Header */}
              <div className="flex items-center space-x-3 mb-5">
                <div className="w-10 h-10 bg-rose-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                  <XCircle className="w-5 h-5 text-rose-400" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">{t.dispatch.reportErrorTitle}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">{t.dispatch.describeTheIssue}</p>
                </div>
              </div>

              {/* Input Field */}
              <div className="mb-5">
                <label className="block text-xs font-semibold text-gray-600 mb-2">
                  {t.dispatch.errorReasonLabel} <span className="text-rose-400">*</span>
                </label>
                <textarea
                  value={errorReason}
                  onChange={(e) => setErrorReason(e.target.value)}
                  placeholder={t.dispatch.whatWentWrong}
                  className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500/50 focus:border-rose-500/50 transition-all resize-none"
                  rows={3}
                  autoFocus
                  maxLength={500}
                />
                <div className="mt-1.5 text-xs text-gray-500">
                  {errorReason.length}/500
                </div>
              </div>

              {/* Compact Action Buttons */}
              <div className="flex space-x-2">
                <button
                  onClick={handleCancelError}
                  className="flex-1 px-4 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm rounded-lg font-medium transition-colors"
                >
                  {t.dispatch.cancelButton}
                </button>
                <button
                  onClick={handleSubmitError}
                  disabled={!errorReason.trim() || isReporting}
                  className="flex-1 px-4 py-2.5 bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-400 hover:to-red-500 text-white text-sm rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-rose-500/30"
                >
                  {t.dispatch.submitButton}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Mobile: Start Work Success Toast */}
      {isMobile && showStartSuccess && (
        <div
          className="fixed top-16 left-1/2 z-[60] pointer-events-none"
          style={{
            transform: 'translateX(-50%)',
            animation: 'slideDownBounce 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)'
          }}
        >
          <div className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white px-6 py-4 rounded-xl shadow-2xl flex items-center space-x-3 w-[340px]">
            <div className="flex-shrink-0 relative">
              {/* Pulsing glow */}
              <div className="absolute inset-0 bg-white/30 rounded-full animate-ping" />
              <div className="relative bg-white/20 p-2 rounded-full">
                <Play className="w-6 h-6" strokeWidth={2.5} fill="currentColor" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-lg drop-shadow-md truncate">{t.dispatch.processingStarted}</p>
              <p className="text-sm text-emerald-50/90 font-medium truncate">{t.dispatch.readyToProcess}</p>
            </div>
            {/* Success checkmark */}
            <div className="flex-shrink-0">
              <CheckCircle className="w-7 h-7 text-white drop-shadow-md" strokeWidth={2.5} />
            </div>
          </div>
        </div>
      )}

      {/* Mobile: Stop Work Success Toast */}
      {isMobile && showStopSuccess && (
        <div
          className="fixed top-16 left-1/2 z-[60] pointer-events-none"
          style={{
            transform: 'translateX(-50%)',
            animation: 'slideDownBounce 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)'
          }}
        >
          <div className="bg-gradient-to-r from-red-500 to-orange-500 text-white px-6 py-4 rounded-xl shadow-2xl flex items-center space-x-3 w-[340px]">
            <div className="flex-shrink-0 relative">
              {/* Pulsing glow */}
              <div className="absolute inset-0 bg-white/30 rounded-full animate-ping" />
              <div className="relative bg-white/20 p-2 rounded-full">
                <Square className="w-6 h-6" strokeWidth={2.5} fill="currentColor" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-lg drop-shadow-md truncate">{t.dispatch.sessionEnded}</p>
              <p className="text-sm text-red-50/90 font-medium truncate">{t.dispatch.sessionCompleted}</p>
            </div>
            {/* Success checkmark */}
            <div className="flex-shrink-0">
              <CheckCircle className="w-7 h-7 text-white drop-shadow-md" strokeWidth={2.5} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
