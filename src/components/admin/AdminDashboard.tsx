import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import { Users, Settings, FileText, LogOut, Shield, Package, UserCheck, Zap, Database, Lock, Eye, EyeOff, Bell, PackageSearch, MessageCircle, Search, History, UserCog, Activity, Clock, Headphones, ChevronDown, ChevronUp, SlidersHorizontal, RotateCcw, Save, X } from 'lucide-react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Admin } from '../../types';
import { logout, updateStoredUsername } from '../../lib/auth';
import { hashPassword, verifyPassword } from '../../lib/passwordHash';
import { useCompanyName } from '../../lib/useCompanyName';
import { AdminBackground } from '../AdminBackground';
import { supabase } from '../../lib/supabase';
import { autoCleanupService } from '../../services/autoCleanupService';
import { prefetchAdminGroups, prefetchAdminWorkspaceData, prefetchConversationSummaries } from '../../lib/serviceWorkspaceCache';

const EmployeeManagement = lazy(() => import('./EmployeeManagement'));
const ProductTypeManagement = lazy(() => import('./ProductTypeManagement'));
const WithdrawalReview = lazy(() => import('./WithdrawalReview'));
const VerificationReview = lazy(() => import('./VerificationReview'));
const AnnouncementManagement = lazy(() => import('./AnnouncementManagement'));
const SystemConfiguration = lazy(() => import('./SystemConfiguration'));
const SecondaryAdminConfiguration = lazy(() => import('./SecondaryAdminConfiguration'));
const AdminManagement = lazy(() => import('./AdminManagement'));
const ValidOrderDataManagement = lazy(() => import('./ValidOrderDataManagement'));
const MessageManagement = lazy(() => import('./MessageManagement'));
const DispatchManagement = lazy(() => import('./DispatchManagement'));
const loadCustomerServiceManagement = () => import('./CustomerServiceManagement');
const loadCccServiceManagement = () => import('./CccServiceManagement');
const CustomerServiceManagement = lazy(loadCustomerServiceManagement);
const CccServiceManagement = lazy(loadCccServiceManagement);

function preloadServiceTab(tabId: string) {
  if (tabId === 'customerservice') void loadCustomerServiceManagement();
  if (tabId === 'cccservice') void loadCccServiceManagement();
}

function formatRequestError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const details = error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    const parts = [details.message, details.code, details.details, details.hint]
      .filter(value => typeof value === 'string' && value.length > 0)
      .map(value => String(value));
    if (parts.length > 0) return parts.join(' | ');
    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown request error';
    }
  }
  return String(error);
}

function ServiceWorkspaceSkeleton({ service }: { service: 'customerservice' | 'cccservice' }) {
  const isCustomerService = service === 'customerservice';

  return (
    <div className="flex min-h-0 flex-1 flex-col text-slate-100">
      <div className={`relative flex shrink-0 items-center justify-between gap-4 border-b px-4 py-4 sm:px-6 sm:py-5 ${isCustomerService ? 'border-orange-500/25' : 'border-emerald-500/25'}`}>
        <div className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r ${isCustomerService ? 'from-orange-300 via-orange-500 to-amber-500' : 'from-emerald-300 via-emerald-500 to-teal-500'}`} />
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className={`h-10 w-10 shrink-0 animate-pulse rounded-xl border ${isCustomerService ? 'border-orange-400/35 bg-orange-500/15' : 'border-emerald-400/35 bg-emerald-500/15'}`} />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-40 animate-pulse rounded bg-slate-700/70" />
            <div className="h-2.5 w-64 max-w-full animate-pulse rounded bg-slate-800" />
          </div>
        </div>
        <div className="hidden shrink-0 gap-2 sm:flex">
          {[0, 1, 2, 3].map(index => <div key={index} className={`h-14 w-[104px] animate-pulse rounded-xl border ${isCustomerService ? 'border-orange-500/15 bg-orange-950/35' : 'border-emerald-500/15 bg-emerald-950/35'}`} />)}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-1 sm:p-2">
        <div className={`divide-y overflow-hidden rounded-xl border ${isCustomerService ? 'divide-orange-900/30 border-orange-500/25 bg-orange-950/15' : 'divide-emerald-900/30 border-emerald-500/25 bg-emerald-950/15'}`}>
          {[0, 1, 2, 3, 4].map(index => (
            <div key={index} className="flex animate-pulse items-center gap-3 px-3 py-4 sm:px-4">
              <div className={`h-9 w-9 shrink-0 rounded-lg ${isCustomerService ? 'bg-orange-500/10' : 'bg-emerald-500/10'}`} />
              <div className="min-w-0 flex-1 space-y-2"><div className="h-3 w-40 max-w-[65%] rounded bg-slate-700/70" /><div className="h-2.5 w-28 rounded bg-slate-800" /></div>
              <div className="hidden gap-2 sm:flex"><div className="h-10 w-20 rounded-lg bg-slate-800/70" /><div className="h-10 w-20 rounded-lg bg-slate-800/70" /><div className="h-10 w-20 rounded-lg bg-slate-800/70" /></div>
              <div className="h-9 w-20 shrink-0 rounded-lg bg-slate-800" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const EmployeeSearch = lazy(() => import('./EmployeeSearch'));
const HistoryDataManagement = lazy(() => import('./HistoryDataManagement'));
const AccountLockManagement = lazy(() => import('./AccountLockManagement'));
const EmployeeLoginHistory = lazy(() => import('./EmployeeLoginHistory'));
const SubmitTimeManagement = lazy(() => import('./SubmitTimeManagement'));

interface AdminDashboardProps {
  admin: Admin;
}

type AdminTabId = 'employees' | 'products' | 'withdrawals' | 'verifications' | 'announcements' | 'config' | 'admins' | 'validdata' | 'messages' | 'dispatch' | 'records' | 'customerservice' | 'cccservice' | 'employeesearch' | 'history' | 'accountlocks' | 'loginhistory' | 'submittime';

interface NavigationTab {
  id: AdminTabId;
  label: string;
  icon: LucideIcon;
}

interface NavigationPreferences {
  order: AdminTabId[];
  labels: Partial<Record<AdminTabId, string>>;
}

interface NavigationDragState {
  tabId: AdminTabId;
  direction: -1 | 1;
  pointerId: number;
  pointerX: number;
  pointerY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

const NAVIGATION_PREFERENCES_KEY = 'admin_navigation_preferences';

function loadNavigationPreferences(adminId: string): NavigationPreferences {
  try {
    const stored = localStorage.getItem(`${NAVIGATION_PREFERENCES_KEY}:${adminId}`);
    if (!stored) return { order: [], labels: {} };

    const parsed = JSON.parse(stored) as { order?: unknown; labels?: unknown };
    const order = Array.isArray(parsed.order)
      ? parsed.order.filter((value): value is AdminTabId => typeof value === 'string')
      : [];
    const labels = parsed.labels && typeof parsed.labels === 'object'
      ? Object.fromEntries(
          Object.entries(parsed.labels).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        ) as Partial<Record<AdminTabId, string>>
      : {};

    return { order, labels };
  } catch {
    return { order: [], labels: {} };
  }
}

function saveNavigationPreferences(adminId: string, preferences: NavigationPreferences) {
  try {
    localStorage.setItem(`${NAVIGATION_PREFERENCES_KEY}:${adminId}`, JSON.stringify(preferences));
  } catch {
    return;
  }
}

export default function AdminDashboard({ admin }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<AdminTabId>(
    admin.role === 'emergency_admin' ? 'accountlocks' : 'employees'
  );
  const [loadedTabs, setLoadedTabs] = useState<Set<string>>(new Set([admin.role === 'emergency_admin' ? 'accountlocks' : 'employees']));
  const [pendingWithdrawalsCount, setPendingWithdrawalsCount] = useState(0);
  const [pendingVerificationsCount, setPendingVerificationsCount] = useState(0);
  const [unreadCustomerServiceCount, setUnreadCustomerServiceCount] = useState(0);
  const [unreadCccServiceCount, setUnreadCccServiceCount] = useState(0);
  const [lockedAccountsCount, setLockedAccountsCount] = useState(0);
  const pendingCountsRequestRef = useRef(0);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordData, setPasswordData] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [usernameData, setUsernameData] = useState({ newUsername: '', currentPassword: '' });
  const [showUsernamePassword, setShowUsernamePassword] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameSuccess, setUsernameSuccess] = useState(false);
  const [changingUsername, setChangingUsername] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [showNavigationSettings, setShowNavigationSettings] = useState(false);
  const [navigationPreferences, setNavigationPreferences] = useState<NavigationPreferences>(() =>
    admin.role === 'super_admin'
      ? loadNavigationPreferences(admin.id)
      : { order: [], labels: {} }
  );
  const [navigationDraft, setNavigationDraft] = useState<Array<{ id: AdminTabId; label: string }>>([]);
  const [navigationDragState, setNavigationDragState] = useState<NavigationDragState | null>(null);
  const navigationListRef = useRef<HTMLDivElement>(null);
  const navigationDragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigationDragOriginRef = useRef<{
    tabId: AdminTabId;
    direction: -1 | 1;
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
  } | null>(null);
  const navigationDragActiveRef = useRef(false);
  const navigationDragSuppressClickUntilRef = useRef(0);
  const { companyName } = useCompanyName(admin.id);

  useEffect(() => {
    setNavigationPreferences(
      admin.role === 'super_admin'
        ? loadNavigationPreferences(admin.id)
        : { order: [], labels: {} }
    );
    setNavigationDraft([]);
    setShowNavigationSettings(false);
  }, [admin.id, admin.role]);

  useEffect(() => () => {
    if (navigationDragTimerRef.current) {
      clearTimeout(navigationDragTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!showNavigationSettings) return;

    const bodyOverflow = document.body.style.overflow;
    const bodyOverscrollBehavior = document.body.style.overscrollBehavior;
    const documentOverflow = document.documentElement.style.overflow;
    const documentOverscrollBehavior = document.documentElement.style.overscrollBehavior;

    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.overscrollBehavior = 'none';

    return () => {
      document.body.style.overflow = bodyOverflow;
      document.body.style.overscrollBehavior = bodyOverscrollBehavior;
      document.documentElement.style.overflow = documentOverflow;
      document.documentElement.style.overscrollBehavior = documentOverscrollBehavior;
    };
  }, [showNavigationSettings]);

  useEffect(() => {
    if (admin.role === 'super_admin') {
      void prefetchAdminGroups(admin.id, 'customer').catch(error => {
        console.warn('Unable to prefetch customer service workspaces:', error);
      });
      void prefetchAdminGroups(admin.id, 'manager').catch(error => {
        console.warn('Unable to prefetch manager workspaces:', error);
      });
    } else if (admin.role !== 'emergency_admin') {
      void prefetchAdminWorkspaceData(admin.id, 'customer').catch(error => {
        console.warn('Unable to prefetch customer service data:', error);
      });
      void prefetchAdminWorkspaceData(admin.id, 'manager').catch(error => {
        console.warn('Unable to prefetch manager service data:', error);
      });
      void prefetchConversationSummaries(admin.id, 'customer', async () => {
        const { data, error } = await supabase.rpc('get_ccc_conversation_summaries', {
          p_admin_id: admin.id,
          p_source_type: 'aaa_service'
        });
        if (error) throw error;
        return data || [];
      }).catch(error => {
        console.warn('Unable to prefetch customer service sessions:', error);
      });
      void prefetchConversationSummaries(admin.id, 'manager', async () => {
        const { data, error } = await supabase.rpc('get_ccc_conversation_summaries', {
          p_admin_id: admin.id,
          p_source_type: 'ccc_service'
        });
        if (error) throw error;
        return data || [];
      }).catch(error => {
        console.warn('Unable to prefetch manager service sessions:', error);
      });
    }

    const preload = () => {
      void loadCustomerServiceManagement();
      void loadCccServiceManagement();
    };

    if (admin.role !== 'super_admin' && admin.role !== 'emergency_admin') {
      preload();
      return;
    }

    if ('requestIdleCallback' in window) {
      const idleId = window.requestIdleCallback(preload, { timeout: 1500 });
      return () => window.cancelIdleCallback(idleId);
    }

    const timerId = globalThis.setTimeout(preload, 800);
    return () => globalThis.clearTimeout(timerId);
  }, [admin.id, admin.role]);

  // Cross-tab navigation targets
  const [navigateToMessageEmployee, setNavigateToMessageEmployee] = useState<{ id: string; username: string } | null>(null);
  const [navigateToCustomerServiceEmployee, setNavigateToCustomerServiceEmployee] = useState<{ id: string; username: string } | null>(null);
  const [navigateToCccServiceEmployee, setNavigateToCccServiceEmployee] = useState<{ id: string; username: string } | null>(null);
  const consumeCustomerServiceEmployee = useCallback(() => setNavigateToCustomerServiceEmployee(null), []);
  const consumeCccServiceEmployee = useCallback(() => setNavigateToCccServiceEmployee(null), []);

  const defaultTabs = useMemo<NavigationTab[]>(() => admin.role === 'emergency_admin' ? [
    { id: 'accountlocks', label: 'Locked', icon: Shield },
  ] : [
    { id: 'employees', label: 'Employees', icon: Users },
    { id: 'employeesearch', label: 'Employee Search', icon: Search },
    { id: 'loginhistory', label: 'Login History', icon: Activity },
    { id: 'accountlocks', label: 'Locked', icon: Shield },
    { id: 'messages', label: 'Messages', icon: Bell },
    { id: 'announcements', label: 'Announcements', icon: FileText },
    { id: 'customerservice', label: '模拟客户', icon: MessageCircle },
    { id: 'cccservice', label: '经理', icon: Headphones },
    { id: 'dispatch', label: 'Order Assignment', icon: PackageSearch },
    { id: 'withdrawals', label: 'Withdrawals', icon: FileText },
    { id: 'verifications', label: 'Verifications', icon: UserCheck },
    { id: 'config', label: 'Configuration', icon: Settings },
    { id: 'submittime', label: 'Submit Time', icon: Clock },
    ...(admin.role === 'super_admin' ? [
      { id: 'products' as const, label: 'Products', icon: Package },
      { id: 'validdata' as const, label: 'Valid Data', icon: Database },
      { id: 'admins' as const, label: 'Admins', icon: Shield },
      { id: 'history' as const, label: 'History Data', icon: History },
    ] : []),
  ], [admin.role]);

  const tabs = useMemo<NavigationTab[]>(() => {
    if (admin.role !== 'super_admin') return defaultTabs;

    const tabsById = new Map(defaultTabs.map(tab => [tab.id, tab]));
    const orderedIds = navigationPreferences.order.filter(id => tabsById.has(id));
    defaultTabs.forEach(tab => {
      if (!orderedIds.includes(tab.id)) orderedIds.push(tab.id);
    });

    return orderedIds.map(id => {
      const tab = tabsById.get(id)!;
      const customLabel = navigationPreferences.labels[id]?.trim();
      return { ...tab, label: customLabel || tab.label };
    });
  }, [admin.role, defaultTabs, navigationPreferences]);

  const openNavigationSettings = () => {
    if (admin.role !== 'super_admin') return;
    setNavigationDraft(tabs.map(tab => ({ id: tab.id, label: tab.label })));
    setShowNavigationSettings(true);
  };

  const moveNavigationItem = (index: number, direction: -1 | 1) => {
    if (admin.role !== 'super_admin') return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= navigationDraft.length) return;
    setNavigationDraft(current => {
      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  };

  const startNavigationDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    tabId: AdminTabId,
    direction: -1 | 1
  ) => {
    if (admin.role !== 'super_admin') return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const card = event.currentTarget.closest<HTMLElement>('[data-navigation-item-id]');
    if (!card) return;

    const rect = card.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    navigationDragOriginRef.current = {
      tabId,
      direction,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
    navigationDragActiveRef.current = false;

    if (navigationDragTimerRef.current) clearTimeout(navigationDragTimerRef.current);
    navigationDragTimerRef.current = setTimeout(() => {
      const origin = navigationDragOriginRef.current;
      if (!origin || origin.pointerId !== event.pointerId) return;

      navigationDragActiveRef.current = true;
      navigationDragSuppressClickUntilRef.current = Date.now() + 400;
      setNavigationDragState({
        tabId: origin.tabId,
        direction: origin.direction,
        pointerId: origin.pointerId,
        pointerX: origin.startX,
        pointerY: origin.startY,
        offsetX: origin.offsetX,
        offsetY: origin.offsetY,
        width: origin.width,
        height: origin.height,
      });
    }, 260);
  };

  const updateNavigationDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const origin = navigationDragOriginRef.current;
    if (!origin || origin.pointerId !== event.pointerId) return;

    if (!navigationDragActiveRef.current) {
      const directionalDistance = origin.direction === -1
        ? origin.startY - event.clientY
        : event.clientY - origin.startY;

      if (directionalDistance <= 5) return;

      if (navigationDragTimerRef.current) {
        clearTimeout(navigationDragTimerRef.current);
        navigationDragTimerRef.current = null;
      }

      navigationDragActiveRef.current = true;
      navigationDragSuppressClickUntilRef.current = Date.now() + 400;
      setNavigationDragState({
        tabId: origin.tabId,
        direction: origin.direction,
        pointerId: origin.pointerId,
        pointerX: event.clientX,
        pointerY: event.clientY,
        offsetX: origin.offsetX,
        offsetY: origin.offsetY,
        width: origin.width,
        height: origin.height,
      });
    }

    event.preventDefault();
    setNavigationDragState(current => current ? {
      ...current,
      pointerX: event.clientX,
      pointerY: event.clientY,
    } : current);

    const list = navigationListRef.current;
    if (!list) return;

    const listRect = list.getBoundingClientRect();
    if (event.clientY < listRect.top + 36) list.scrollBy({ top: -18 });
    if (event.clientY > listRect.bottom - 36) list.scrollBy({ top: 18 });

    const cards = Array.from(list.querySelectorAll<HTMLElement>('[data-navigation-item-id]'));
    if (cards.length === 0) return;

    let targetCard = cards[0];
    let closestDistance = Number.POSITIVE_INFINITY;
    cards.forEach(card => {
      const rect = card.getBoundingClientRect();
      const distance = Math.abs(event.clientY - (rect.top + rect.height / 2));
      if (distance < closestDistance) {
        closestDistance = distance;
        targetCard = card;
      }
    });

    const targetId = targetCard.dataset.navigationItemId as AdminTabId | undefined;
    if (!targetId || targetId === origin.tabId) return;

    setNavigationDraft(current => {
      const currentIndex = current.findIndex(item => item.id === origin.tabId);
      const targetIndex = current.findIndex(item => item.id === targetId);
      if (currentIndex < 0 || targetIndex < 0) return current;
      if (origin.direction === -1 && targetIndex >= currentIndex) return current;
      if (origin.direction === 1 && targetIndex <= currentIndex) return current;

      const next = [...current];
      const [movedItem] = next.splice(currentIndex, 1);
      next.splice(targetIndex, 0, movedItem);
      return next;
    });
  };

  const endNavigationDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const origin = navigationDragOriginRef.current;
    if (!origin || origin.pointerId !== event.pointerId) return;

    if (navigationDragTimerRef.current) {
      clearTimeout(navigationDragTimerRef.current);
      navigationDragTimerRef.current = null;
    }

    if (navigationDragActiveRef.current) {
      navigationDragSuppressClickUntilRef.current = Date.now() + 400;
    }

    navigationDragActiveRef.current = false;
    navigationDragOriginRef.current = null;
    setNavigationDragState(null);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleNavigationMoveClick = (index: number, direction: -1 | 1) => {
    if (Date.now() < navigationDragSuppressClickUntilRef.current) return;
    moveNavigationItem(index, direction);
  };

  const restoreNavigationItemLabel = (tabId: AdminTabId) => {
    if (admin.role !== 'super_admin') return;
    const originalLabel = defaultTabs.find(tab => tab.id === tabId)?.label;
    if (!originalLabel) return;

    setNavigationDraft(current => current.map(item =>
      item.id === tabId ? { ...item, label: originalLabel } : item
    ));
  };

  const saveNavigationDraft = () => {
    if (admin.role !== 'super_admin') return;
    const defaultLabels = new Map(defaultTabs.map(tab => [tab.id, tab.label]));
    const nextPreferences: NavigationPreferences = {
      order: navigationDraft.map(item => item.id),
      labels: Object.fromEntries(navigationDraft.map(item => [
        item.id,
        item.label.trim() || defaultLabels.get(item.id) || item.id,
      ])) as Partial<Record<AdminTabId, string>>,
    };
    setNavigationPreferences(nextPreferences);
    saveNavigationPreferences(admin.id, nextPreferences);
    setShowNavigationSettings(false);
  };

  const loadPendingCounts = useCallback(async () => {
    const requestId = ++pendingCountsRequestRef.current;
    try {
      // Emergency admin only needs locked accounts count
      if (admin.role === 'emergency_admin') {
        const { count: lockedCount, error: lockedError } = await supabase
          .from('account_locks')
          .select('*', { count: 'exact', head: true })
          .is('unlocked_at', null)
          .gt('lock_until', new Date().toISOString());

        if (lockedError) throw lockedError;
        setLockedAccountsCount(lockedCount || 0);
        return;
      }

      // For secondary admins, fetch their employee IDs once for scoping
      let scopedEmployeeIds: string[] | null = null;
      if (admin.role === 'secondary_admin') {
        const { data: myEmployees, error: employeesError } = await supabase
          .from('users')
          .select('id')
          .eq('created_by', admin.id);
        if (employeesError) throw employeesError;
        scopedEmployeeIds = myEmployees?.map(e => e.id) || [];
      }

      // Load pending withdrawals count (scoped by admin)
      let withdrawalsCount = 0;
      if (scopedEmployeeIds !== null) {
        if (scopedEmployeeIds.length > 0) {
          const { count, error: wErr } = await supabase
            .from('withdrawals')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending')
            .in('user_id', scopedEmployeeIds);
          if (wErr) throw wErr;
          withdrawalsCount = count || 0;
        }
      } else {
        const { count, error: wErr } = await supabase
          .from('withdrawals')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending');
        if (wErr) throw wErr;
        withdrawalsCount = count || 0;
      }
      if (requestId !== pendingCountsRequestRef.current) return;
      setPendingWithdrawalsCount(withdrawalsCount);

      // Load pending verifications count (scoped by admin)
      let verificationsCount = 0;
      if (scopedEmployeeIds !== null) {
        if (scopedEmployeeIds.length > 0) {
          const { count, error: vErr } = await supabase
            .from('verification_requests')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending')
            .in('user_id', scopedEmployeeIds);
          if (vErr) throw vErr;
          verificationsCount = count || 0;
        }
      } else {
        const { count, error: vErr } = await supabase
          .from('verification_requests')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending');
        if (vErr) throw vErr;
        verificationsCount = count || 0;
      }
      if (requestId !== pendingCountsRequestRef.current) return;
      setPendingVerificationsCount(verificationsCount);

      // Load unread customer service messages count (AAA)
      let unreadCount = 0;
      let unreadCccCount = 0;
      const countUnreadCustomerMessages = (customerIds: string[], sourceType: 'aaa_service' | 'ccc_service') => {
        if (customerIds.length === 0 || (scopedEmployeeIds !== null && scopedEmployeeIds.length === 0)) {
          return Promise.resolve({ count: 0, error: null });
        }

        let query = supabase
          .from('customer_employee_conversations')
          .select('*', { count: 'exact', head: true })
          .in('customer_id', customerIds)
          .eq('source_type', sourceType)
          .eq('sender_type', 'employee')
          .eq('is_read', false);
        if (scopedEmployeeIds !== null) {
          query = query.in('employee_id', scopedEmployeeIds);
        }
        return query;
      };

      if (admin.role === 'super_admin') {
        const [aaaCustomersRes, cccCustomersRes] = await Promise.all([
          supabase.from('simulated_customers').select('id').eq('source_type', 'aaa_service'),
          supabase.from('simulated_customers').select('id').eq('source_type', 'ccc_service'),
        ]);

        if (aaaCustomersRes.error) throw aaaCustomersRes.error;
        if (cccCustomersRes.error) throw cccCustomersRes.error;

        const aaaIds = (aaaCustomersRes.data || []).map(c => c.id);
        const cccIds = (cccCustomersRes.data || []).map(c => c.id);

        const [aaaUnread, cccUnread] = await Promise.all([
          countUnreadCustomerMessages(aaaIds, 'aaa_service'),
          countUnreadCustomerMessages(cccIds, 'ccc_service'),
        ]);

        if (aaaUnread.error) throw aaaUnread.error;
        if (cccUnread.error) throw cccUnread.error;
        unreadCount = aaaUnread.count || 0;
        unreadCccCount = cccUnread.count || 0;
      } else {
        const [aaaCustomersRes, cccCustomersRes] = await Promise.all([
          supabase.from('simulated_customers').select('id').eq('admin_id', admin.id).eq('source_type', 'aaa_service'),
          supabase.from('simulated_customers').select('id').eq('admin_id', admin.id).eq('source_type', 'ccc_service'),
        ]);

        if (aaaCustomersRes.error) throw aaaCustomersRes.error;
        if (cccCustomersRes.error) throw cccCustomersRes.error;

        const aaaIds = (aaaCustomersRes.data || []).map(c => c.id);
        const cccIds = (cccCustomersRes.data || []).map(c => c.id);

        const [aaaUnread, cccUnread] = await Promise.all([
          countUnreadCustomerMessages(aaaIds, 'aaa_service'),
          countUnreadCustomerMessages(cccIds, 'ccc_service'),
        ]);

        if (aaaUnread.error) throw aaaUnread.error;
        if (cccUnread.error) throw cccUnread.error;
        unreadCount = aaaUnread.count || 0;
        unreadCccCount = cccUnread.count || 0;
      }

      if (requestId !== pendingCountsRequestRef.current) return;
      setUnreadCustomerServiceCount(unreadCount);
      setUnreadCccServiceCount(unreadCccCount);

      // Load locked accounts count using the RPC function
      // This respects admin scope (super_admin sees all, secondary_admin sees only their employees)
      const { data: locksData, error: lockedError } = await supabase.rpc('get_account_locks_for_admin', {
        p_admin_id: admin.id
      });

      if (lockedError) {
        console.error('Error loading locked accounts count:', lockedError);
        throw lockedError;
      }
      const lockedCount = locksData?.length || 0;
      if (requestId !== pendingCountsRequestRef.current) return;
      console.log('[Account Locks] Active locks count:', lockedCount, 'for admin:', admin.id);
      setLockedAccountsCount(lockedCount);
    } catch (error) {
      console.warn('Pending counts are temporarily unavailable:', formatRequestError(error));
    }
  }, [admin.id, admin.role]);

  const handleCustomerServiceUnreadChange = useCallback((delta: number) => {
    setUnreadCustomerServiceCount(prev => Math.max(0, prev + delta));
  }, []);

  const handleCccServiceUnreadChange = useCallback((delta: number) => {
    setUnreadCccServiceCount(prev => Math.max(0, prev + delta));
  }, []);

  // Handle tab change with refresh for account locks
  const handleTabChange = useCallback((tabId: typeof activeTab) => {
    preloadServiceTab(tabId);
    setActiveTab(tabId);
    setLoadedTabs(prev => new Set([...prev, tabId]));
    if (tabId === 'accountlocks') {
      console.log('[Account Locks] Tab switched, refreshing counts...');
      loadPendingCounts();
    }
  }, [loadPendingCounts]);

  const handleEmployeeQuickAction = useCallback((action: 'message' | 'customerservice' | 'cccservice', employee: { id: string; username: string }) => {
    if (action === 'message') {
      setNavigateToCustomerServiceEmployee(null);
      setNavigateToCccServiceEmployee(null);
      setNavigateToMessageEmployee(employee);
      handleTabChange('messages');
    } else if (action === 'customerservice') {
      setNavigateToMessageEmployee(null);
      setNavigateToCccServiceEmployee(null);
      setNavigateToCustomerServiceEmployee(employee);
      handleTabChange('customerservice');
    } else {
      setNavigateToMessageEmployee(null);
      setNavigateToCustomerServiceEmployee(null);
      setNavigateToCccServiceEmployee(employee);
      handleTabChange('cccservice');
    }
  }, [handleTabChange]);

  useEffect(() => {
    const pendingCountsTimer = window.setTimeout(() => {
      void loadPendingCounts();
    }, 600);
    const pendingCountsFallbackTimer = window.setInterval(() => {
      void loadPendingCounts();
    }, 15000);

    // 启动自动清理服务
    autoCleanupService.start(admin.id);
    console.log('[Admin Dashboard] Auto cleanup service started');

    // Set up real-time subscriptions for withdrawals
    const withdrawalChannel = supabase
      .channel('admin-withdrawals')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'withdrawals' },
        () => {
          loadPendingCounts();
        }
      )
      .subscribe();

    // Set up real-time subscriptions for verifications
    const verificationChannel = supabase
      .channel('admin-verifications')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'verification_requests' },
        () => {
          loadPendingCounts();
        }
      )
      .subscribe();

    // Set up real-time subscriptions for customer service conversations
    const customerServiceChannel = supabase
      .channel('admin-customer-service')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'customer_employee_conversations' },
        () => {
          loadPendingCounts();
        }
      )
      .subscribe();

    // Set up real-time subscriptions for account locks
    const accountLocksChannel = supabase
      .channel('admin-account-locks')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'account_locks' },
        (payload) => {
          console.log('[Account Locks] Real-time event triggered:', payload.eventType, payload);
          loadPendingCounts();
        }
      )
      .subscribe();

    return () => {
      window.clearTimeout(pendingCountsTimer);
      window.clearInterval(pendingCountsFallbackTimer);
      supabase.removeChannel(withdrawalChannel);
      supabase.removeChannel(verificationChannel);
      supabase.removeChannel(customerServiceChannel);
      supabase.removeChannel(accountLocksChannel);

      // 停止自动清理服务
      autoCleanupService.stop();
      console.log('[Admin Dashboard] Auto cleanup service stopped');
    };
  }, [loadPendingCounts, admin.id]);

  const handleChangePassword = async () => {
    setPasswordError(null);
    setPasswordSuccess(false);

    if (!passwordData.currentPassword || !passwordData.newPassword || !passwordData.confirmPassword) {
      setPasswordError('Please fill in all fields');
      return;
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    if (passwordData.newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return;
    }

    setChangingPassword(true);

    try {
      // Verify current password
      const { data: adminData, error: verifyError } = await supabase
        .from('admins')
        .select('password_hash')
        .eq('id', admin.id)
        .single();

      if (verifyError) throw verifyError;

      // Verify password hash
      const isValidPassword = await verifyPassword(passwordData.currentPassword, adminData.password_hash);
      if (!isValidPassword) {
        setPasswordError('Current password is incorrect');
        setChangingPassword(false);
        return;
      }

      // Hash the new password before storing
      const hashedPassword = await hashPassword(passwordData.newPassword);

      // Update password
      const { error: updateError } = await supabase
        .from('admins')
        .update({ password_hash: hashedPassword })
        .eq('id', admin.id);

      if (updateError) throw updateError;

      setPasswordSuccess(true);
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });

      setTimeout(() => {
        setShowPasswordModal(false);
        setPasswordSuccess(false);
      }, 2000);
    } catch (error: unknown) {
      console.error('Error changing password:', error);
      setPasswordError(error instanceof Error ? error.message : 'Failed to change password');
    } finally {
      setChangingPassword(false);
    }
  };

  const handleChangeUsername = async () => {
    setUsernameError(null);
    setUsernameSuccess(false);

    if (!usernameData.newUsername || !usernameData.currentPassword) {
      setUsernameError('Please fill in all fields');
      return;
    }

    if (usernameData.newUsername.length < 3) {
      setUsernameError('Username must be at least 3 characters');
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(usernameData.newUsername)) {
      setUsernameError('Username can only contain letters, numbers and underscores');
      return;
    }

    setChangingUsername(true);

    try {
      // Verify current password
      const { data: adminData, error: verifyError } = await supabase
        .from('admins')
        .select('password_hash')
        .eq('id', admin.id)
        .single();

      if (verifyError) throw verifyError;

      // Verify password hash
      const isValidPassword = await verifyPassword(usernameData.currentPassword, adminData.password_hash);
      if (!isValidPassword) {
        setUsernameError('Password is incorrect');
        setChangingUsername(false);
        return;
      }

      // Check if username already exists
      const { data: existingAdmin, error: checkError } = await supabase
        .from('admins')
        .select('id')
        .eq('username', usernameData.newUsername)
        .maybeSingle();

      if (checkError) throw checkError;

      if (existingAdmin && existingAdmin.id !== admin.id) {
        setUsernameError('Username already exists');
        setChangingUsername(false);
        return;
      }

      // Update username
      const { error: updateError } = await supabase
        .from('admins')
        .update({ username: usernameData.newUsername })
        .eq('id', admin.id);

      if (updateError) throw updateError;

      setUsernameSuccess(true);
      setUsernameData({ newUsername: '', currentPassword: '' });

      // Update localStorage and trigger state update
      updateStoredUsername(usernameData.newUsername);

      setTimeout(() => {
        setShowUsernameModal(false);
        setUsernameSuccess(false);
      }, 2000);
    } catch (error: unknown) {
      console.error('Error changing username:', error);
      setUsernameError(error instanceof Error ? error.message : 'Failed to change username');
    } finally {
      setChangingUsername(false);
    }
  };

  const renderAccountMenu = (variant: 'sidebar' | 'mobile') => {
    const isSidebar = variant === 'sidebar';

    return (
      <div className={`relative ${isSidebar ? 'z-40 w-full' : 'shrink-0'}`}>
        <button
          type="button"
          onClick={() => setAccountMenuOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={accountMenuOpen}
          className={`flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors duration-200 ${isSidebar ? `h-8 w-full justify-between border-l-2 border-emerald-300 bg-emerald-700 px-1.5 text-[10px] text-white hover:border-emerald-100 hover:bg-emerald-600 ${accountMenuOpen ? 'border-emerald-100 bg-emerald-600' : ''}` : `h-7 border border-emerald-300/90 bg-emerald-700 px-2 text-[10px] text-white hover:border-emerald-100 hover:bg-emerald-600 sm:px-2.5 sm:text-[11px] ${accountMenuOpen ? 'border-emerald-100 bg-emerald-600' : ''}`}`}
          title="Account actions"
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-emerald-600">
            <UserCog className="h-3 w-3 text-white" />
          </span>
          <span className="flex-1 text-left tracking-wide">Account</span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-emerald-100 transition-transform duration-200 ${accountMenuOpen ? 'rotate-180 text-white' : ''}`} />
        </button>
        {accountMenuOpen && (
          <div
            role="menu"
            className={`absolute z-[70] flex w-full min-w-0 flex-col gap-1 overflow-hidden rounded-lg border border-emerald-400/50 bg-slate-950 p-1 shadow-xl shadow-emerald-950/40 ring-1 ring-emerald-200/10 animate-[fadeIn_120ms_ease-out] ${isSidebar ? 'left-0 right-0 top-[calc(100%+0.35rem)]' : 'right-0 top-[calc(100%+0.35rem)] min-w-[164px]'}`}
          >
            {admin.role === 'super_admin' && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAccountMenuOpen(false);
                  setShowUsernameModal(true);
                }}
                className="flex h-7 w-full items-center gap-1.5 rounded-md border-l-2 border-violet-300 bg-violet-700 px-1.5 text-left text-[10px] font-medium text-white transition-colors hover:bg-violet-600"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-violet-600">
                  <UserCog className="h-3 w-3 text-violet-100" />
                </span>
                <span>Username</span>
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setAccountMenuOpen(false);
                setShowPasswordModal(true);
              }}
              className="flex h-7 w-full items-center gap-1.5 rounded-md border-l-2 border-cyan-200 bg-cyan-700 px-1.5 text-left text-[10px] font-medium text-white transition-colors hover:bg-cyan-600"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-cyan-600">
                <Lock className="h-3 w-3 text-cyan-100" />
              </span>
              <span>Password</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setAccountMenuOpen(false);
                logout();
              }}
              className="flex h-7 w-full items-center gap-1.5 rounded-md border-l-2 border-rose-300 bg-rose-700 px-1.5 text-left text-[10px] font-medium text-white transition-colors hover:bg-rose-600"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-rose-600">
                <LogOut className="h-3 w-3 text-rose-100" />
              </span>
              <span>Logout</span>
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="admin-dashboard-root h-screen relative bg-slate-950 overflow-hidden" style={{ touchAction: 'pan-y' }}>
      {/* Professional dark background for admin interface */}
      <AdminBackground />

      <div className="relative z-10 m-0 p-0 w-full h-full flex flex-col">
        <header className="bg-slate-900/90 backdrop-blur-xl border-b border-blue-500/30 w-full m-0 flex-shrink-0 lg:hidden" style={{ WebkitBackdropFilter: 'blur(24px)' }}>
          <div className="absolute inset-0 bg-gradient-to-r from-blue-600/5 via-cyan-500/10 to-blue-600/5 pointer-events-none"></div>
          <div className="w-full px-2 sm:px-2.5 lg:px-3 py-0 relative">
            <div className="flex min-h-[38px] items-center justify-between gap-2 py-1 leading-none">
              <div className="grid min-w-0 flex-1 grid-cols-[16px_minmax(0,1fr)] items-center gap-x-1.5 gap-y-0.5">
                <div className="relative flex h-4 w-4 shrink-0 items-center justify-center justify-self-center rounded bg-gradient-to-br from-blue-600 via-blue-500 to-cyan-500 shadow-md">
                  <Zap className="h-2.5 w-2.5 text-white" fill="currentColor" />
                </div>
                <h1 className="min-w-0 truncate text-[11px] font-bold leading-none bg-gradient-to-r from-blue-400 via-cyan-300 to-blue-400 bg-clip-text text-transparent sm:text-xs">
                  {companyName}
                </h1>
                <Shield className="h-3.5 w-3.5 shrink-0 justify-self-center text-purple-400" />
                <span className="min-w-0 truncate text-[9px] font-semibold uppercase text-purple-200">
                  {admin.role === 'super_admin' ? 'Super Admin' : 'Admin'}
                </span>
                <span className="h-2 w-2 shrink-0 justify-self-center rounded-full border border-green-200/70 bg-green-400 shadow-sm shadow-green-500/40" />
                <span className="min-w-0 truncate text-[11px] font-semibold tracking-wide text-cyan-100 drop-shadow-[0_0_5px_rgba(103,232,249,0.25)]">{admin.username}</span>
              </div>
              {renderAccountMenu('mobile')}
            </div>
          </div>
        </header>

        <style>{`
          .scrollbar-hide::-webkit-scrollbar { display: none; }
          .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        `}</style>

        <div className="w-full lg:flex flex-1 min-h-0">
          {/* Desktop: Vertical Left Sidebar */}
          <aside className="relative isolate hidden flex-shrink-0 overflow-y-auto border-r border-cyan-800/70 bg-[linear-gradient(180deg,#071225_0%,#092433_34%,#171b2e_68%,#292116_100%)] shadow-[6px_0_18px_rgba(2,6,23,0.72)] scrollbar-hide lg:flex lg:w-32 lg:flex-col xl:w-36">
            <div className="pointer-events-none absolute inset-y-0 right-0 w-[2px] bg-gradient-to-b from-blue-600/80 via-cyan-700/75 to-amber-700/75" aria-hidden="true" />
            <div className="relative z-30 shrink-0 border-b border-cyan-800/55 bg-gradient-to-br from-blue-950/90 via-cyan-950/65 to-amber-950/45 px-1.5 py-2.5 shadow-[0_8px_18px_rgba(2,6,23,0.35)]">
              <div className="grid min-w-0 grid-cols-[20px_minmax(0,1fr)] items-center gap-x-1.5 gap-y-1">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center justify-self-center rounded-md bg-gradient-to-br from-blue-600 via-blue-500 to-cyan-500 shadow-md shadow-blue-950/40">
                  <Zap className="h-3 w-3 text-white" fill="currentColor" />
                </div>
                <h1 className="min-w-0 truncate bg-gradient-to-r from-blue-300 via-cyan-200 to-amber-200 bg-clip-text text-[11px] font-bold leading-tight text-transparent" title={companyName}>
                  {companyName}
                </h1>
                <Shield className="h-4 w-4 shrink-0 justify-self-center text-purple-400" />
                <span className="min-w-0 truncate text-[9px] font-semibold uppercase tracking-wide text-purple-200">
                  {admin.role === 'super_admin' ? 'Super Admin' : 'Admin'}
                </span>
                <span className="h-2 w-2 shrink-0 justify-self-center rounded-full border border-green-200/70 bg-green-400 shadow-sm shadow-green-500/40" />
                <span className="min-w-0 truncate text-[11px] font-semibold tracking-wide text-cyan-100" title={admin.username}>
                  {admin.username}
                </span>
              </div>
              <div className="mt-4">
                {renderAccountMenu('sidebar')}
              </div>
            </div>
            <nav className="relative z-10 flex flex-col gap-0.5 border-t border-blue-300/15 bg-slate-950/10 p-1.5 pt-8">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const pendingCount = tab.id === 'withdrawals' ? pendingWithdrawalsCount : tab.id === 'verifications' ? pendingVerificationsCount : tab.id === 'customerservice' ? unreadCustomerServiceCount : tab.id === 'cccservice' ? unreadCccServiceCount : tab.id === 'accountlocks' ? lockedAccountsCount : 0;
                const showBadge = pendingCount > 0;

                return (
                  <button
                    key={tab.id}
                    onClick={() => handleTabChange(tab.id)}
                    onPointerEnter={() => preloadServiceTab(tab.id)}
                    className={`relative flex items-center gap-1.5 px-1.5 py-1.5 rounded-lg font-medium transition-all text-left ${
                      activeTab === tab.id
                        ? tab.id === 'customerservice'
                          ? 'bg-orange-700 text-white shadow-lg shadow-orange-900/40'
                          : tab.id === 'cccservice'
                            ? 'bg-emerald-800 text-white shadow-lg shadow-emerald-950/40'
                            : 'border border-cyan-700/55 bg-gradient-to-r from-blue-700 via-cyan-800 to-slate-800 text-white shadow-md shadow-slate-950/45'
                        : tab.id === 'customerservice'
                          ? 'text-orange-400 hover:text-orange-100 hover:bg-orange-950/70'
                          : tab.id === 'cccservice'
                            ? 'text-emerald-400 hover:text-emerald-100 hover:bg-emerald-950/70'
                            : 'border border-transparent text-slate-300 hover:border-cyan-900/60 hover:bg-gradient-to-r hover:from-blue-950/90 hover:via-cyan-950/70 hover:to-amber-950/45 hover:text-white'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="text-[11px] font-medium truncate">{tab.label}</span>
                    {showBadge && (
                      <span className={`ml-auto flex items-center justify-center min-w-[20px] h-[20px] px-1 text-xs font-bold rounded-full shadow-lg animate-pulse ${
                        tab.id === 'customerservice'
                          ? 'bg-white text-orange-600'
                          : tab.id === 'cccservice'
                            ? 'bg-white text-emerald-600'
                            : 'bg-gradient-to-r from-orange-500 to-red-500 text-white'
                      }`}>
                        {pendingCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
            {admin.role === 'super_admin' && (
              <div className="relative z-10 mt-auto border-t border-cyan-900/60 bg-slate-950/35 p-1.5">
                <button
                  type="button"
                  onClick={openNavigationSettings}
                  className="flex h-8 w-full items-center gap-1.5 rounded-lg border border-amber-800/55 bg-gradient-to-r from-blue-950/90 via-cyan-950/70 to-amber-950/50 px-2 text-left text-[10px] font-semibold text-slate-200 transition-colors hover:border-amber-700/70 hover:text-white"
                  title="Customize navigation order and names"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                  <span className="min-w-0 flex-1 truncate">Nav Settings</span>
                  <Settings className="h-3 w-3 shrink-0 text-cyan-400" />
                </button>
              </div>
            )}
          </aside>

          {/* Mobile: Horizontal Scrolling Tabs */}
          <div className={`flex-1 min-w-0 flex flex-col ${activeTab === 'messages' ? 'lg:overflow-hidden' : 'lg:overflow-y-auto'} scrollbar-hide`} style={activeTab === 'customerservice' ? {
            background: `
              radial-gradient(ellipse 80% 60% at 10% 15%, rgba(249,115,22,0.11) 0%, transparent 50%),
              radial-gradient(ellipse 60% 50% at 80% 10%, rgba(245,158,11,0.1) 0%, transparent 50%),
              radial-gradient(ellipse 70% 70% at 50% 55%, rgba(234,88,12,0.08) 0%, transparent 50%),
              radial-gradient(ellipse 50% 60% at 90% 80%, rgba(251,146,60,0.09) 0%, transparent 50%),
              radial-gradient(ellipse 55% 80% at 20% 85%, rgba(154,52,18,0.12) 0%, transparent 50%),
              linear-gradient(135deg, #120b04 0%, #190d05 25%, #160b04 50%, #1d0e04 75%, #0e0803 100%)
            `
          } : activeTab === 'cccservice' ? {
            background: `
              radial-gradient(ellipse 80% 60% at 10% 15%, rgba(34,197,94,0.11) 0%, transparent 50%),
              radial-gradient(ellipse 60% 50% at 80% 10%, rgba(16,185,129,0.09) 0%, transparent 50%),
              radial-gradient(ellipse 70% 70% at 50% 55%, rgba(5,150,105,0.07) 0%, transparent 50%),
              radial-gradient(ellipse 50% 60% at 90% 80%, rgba(22,163,74,0.08) 0%, transparent 50%),
              radial-gradient(ellipse 55% 80% at 20% 85%, rgba(6,95,70,0.1) 0%, transparent 50%),
              linear-gradient(135deg, #040e09 0%, #06160e 25%, #05120b 50%, #071d12 75%, #030a06 100%)
            `
          } : undefined}>
            <div className="lg:hidden flex gap-1.5 px-2 pt-2 pb-1.5 overflow-x-auto scrollbar-hide" style={{ WebkitOverflowScrolling: 'touch' }}>
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const pendingCount = tab.id === 'withdrawals' ? pendingWithdrawalsCount : tab.id === 'verifications' ? pendingVerificationsCount : tab.id === 'customerservice' ? unreadCustomerServiceCount : tab.id === 'cccservice' ? unreadCccServiceCount : tab.id === 'accountlocks' ? lockedAccountsCount : 0;
                const showBadge = pendingCount > 0;

                return (
                  <button
                    key={tab.id}
                    onClick={() => handleTabChange(tab.id)}
                    onPointerEnter={() => preloadServiceTab(tab.id)}
                    className={`relative flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg font-medium transition-all whitespace-nowrap flex-shrink-0 ${
                      activeTab === tab.id
                        ? tab.id === 'customerservice'
                          ? 'bg-orange-700 text-white shadow-lg shadow-orange-900/40'
                          : tab.id === 'cccservice'
                            ? 'bg-emerald-800 text-white shadow-lg shadow-emerald-950/40'
                            : 'bg-blue-600 text-white shadow-lg shadow-blue-500/50'
                        : tab.id === 'customerservice'
                          ? 'bg-orange-950/70 text-orange-300 hover:text-orange-100 hover:bg-orange-950 border border-orange-700/50'
                          : tab.id === 'cccservice'
                            ? 'bg-emerald-950/70 text-emerald-300 hover:text-emerald-100 hover:bg-emerald-950 border border-emerald-700/50'
                            : 'bg-slate-800/50 text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-700'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="text-xs font-semibold">{tab.label}</span>
                    {showBadge && (
                      <span className={`flex items-center justify-center min-w-[20px] h-5 px-1 text-xs font-bold rounded-full shadow-lg animate-pulse ${
                        tab.id === 'customerservice'
                          ? 'bg-white text-orange-600'
                          : tab.id === 'cccservice'
                            ? 'bg-white text-emerald-600'
                            : 'bg-gradient-to-r from-orange-500 to-red-500 text-white'
                      }`}>
                        {pendingCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Content Area - Full Width */}
            <div className="w-full flex-1 min-h-0 flex flex-col">
          <Suspense fallback={
            activeTab === 'customerservice' || activeTab === 'cccservice'
              ? <ServiceWorkspaceSkeleton service={activeTab} />
              : <div className="flex-1 flex items-center justify-center"><div className="w-8 h-8 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" /></div>
          }>

            {loadedTabs.has('employees') && (
              <div className={activeTab === 'employees' ? 'flex-1 min-h-0 flex flex-col animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                <EmployeeManagement admin={admin} onQuickAction={handleEmployeeQuickAction} />
              </div>
            )}
            {loadedTabs.has('employeesearch') && (
              <div className={activeTab === 'employeesearch' ? 'px-2 sm:px-3 lg:px-4 py-1.5 sm:py-2 space-y-4 animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                <EmployeeSearch />
              </div>
            )}
            {loadedTabs.has('loginhistory') && (
              <div className={activeTab === 'loginhistory' ? 'px-2 sm:px-3 lg:px-4 py-1.5 sm:py-2 space-y-4 animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                <EmployeeLoginHistory admin={admin} />
              </div>
            )}
            {loadedTabs.has('messages') && (
              <div className={activeTab === 'messages' ? 'flex-1 min-h-0 flex flex-col animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                <MessageManagement admin={admin} isActive={activeTab === 'messages'} initialEmployee={navigateToMessageEmployee} onConsumeInitialEmployee={() => setNavigateToMessageEmployee(null)} />
              </div>
            )}
            {loadedTabs.has('customerservice') && (
              <div className={activeTab === 'customerservice' ? 'flex-1 min-h-0 flex flex-col animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                <CustomerServiceManagement
                  adminId={admin.id}
                  isSuperAdmin={admin.role === 'super_admin'}
                  isActive={activeTab === 'customerservice'}
                  initialEmployee={navigateToCustomerServiceEmployee}
                  onConsumeInitialEmployee={consumeCustomerServiceEmployee}
                  onUnreadCountChange={handleCustomerServiceUnreadChange}
                />
              </div>
            )}
            {loadedTabs.has('cccservice') && (
              <div className={activeTab === 'cccservice' ? 'flex-1 min-h-0 flex flex-col animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                <CccServiceManagement
                  adminId={admin.id}
                  isSuperAdmin={admin.role === 'super_admin'}
                  isActive={activeTab === 'cccservice'}
                  initialEmployee={navigateToCccServiceEmployee}
                  onConsumeInitialEmployee={consumeCccServiceEmployee}
                  onUnreadCountChange={handleCccServiceUnreadChange}
                />
              </div>
            )}
            {loadedTabs.has('dispatch') && (
              <div className={activeTab === 'dispatch' ? 'px-2 sm:px-3 lg:px-4 py-1.5 sm:py-2 space-y-4 animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                <DispatchManagement />
              </div>
            )}
            {loadedTabs.has('withdrawals') && (
              <div className={activeTab === 'withdrawals' ? 'px-2 sm:px-3 lg:px-4 py-1.5 sm:py-2 space-y-4 animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                <WithdrawalReview admin={admin} />
              </div>
            )}
            {loadedTabs.has('verifications') && (
              <div className={activeTab === 'verifications' ? 'px-2 sm:px-3 lg:px-4 py-1.5 sm:py-2 space-y-4 animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                <VerificationReview admin={admin} />
              </div>
            )}
            {loadedTabs.has('config') && (
              <div className={activeTab === 'config' ? 'px-2 sm:px-3 lg:px-4 py-1.5 sm:py-2 space-y-4 animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                {admin.role === 'super_admin' ? (
                  <SystemConfiguration admin={admin} />
                ) : (
                  <SecondaryAdminConfiguration admin={admin} />
                )}
              </div>
            )}
            {loadedTabs.has('submittime') && (
              <div className={activeTab === 'submittime' ? 'px-2 sm:px-3 lg:px-4 py-1.5 sm:py-2 space-y-4 animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                <SubmitTimeManagement admin={admin} />
              </div>
            )}
            {loadedTabs.has('announcements') && (
              <div className={activeTab === 'announcements' ? 'px-2 sm:px-3 lg:px-4 py-1.5 sm:py-2 space-y-4 animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                <AnnouncementManagement admin={admin} />
              </div>
            )}
            {admin.role === 'super_admin' && (
              <>
                {loadedTabs.has('products') && (
                  <div className={activeTab === 'products' ? 'px-2 sm:px-3 lg:px-4 py-1.5 sm:py-2 space-y-4 animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                    <ProductTypeManagement />
                  </div>
                )}
                {loadedTabs.has('validdata') && (
                  <div className={activeTab === 'validdata' ? 'px-2 sm:px-3 lg:px-4 py-1.5 sm:py-2 space-y-4 animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                    <ValidOrderDataManagement adminId={admin.id} />
                  </div>
                )}
                {loadedTabs.has('admins') && (
                  <div className={activeTab === 'admins' ? 'px-2 sm:px-3 lg:px-4 py-1.5 sm:py-2 space-y-4 animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                    <AdminManagement admin={admin} />
                  </div>
                )}
                {loadedTabs.has('history') && (
                  <div className={activeTab === 'history' ? 'px-2 sm:px-3 lg:px-4 py-1.5 sm:py-2 space-y-4 animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                    <HistoryDataManagement admin={admin} />
                  </div>
                )}
              </>
            )}

            {loadedTabs.has('accountlocks') && (
              <div className={activeTab === 'accountlocks' ? 'px-2 sm:px-3 lg:px-4 py-1.5 sm:py-2 space-y-4 animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                <AccountLockManagement admin={admin} />
              </div>
            )}

          </Suspense>
          </div>
          </div>
        </div>
      </div>

      {admin.role === 'super_admin' && showNavigationSettings && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden overscroll-none bg-slate-950/90 p-3 backdrop-blur-sm sm:p-5">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-cyan-800/80 bg-[#172235] shadow-[0_24px_70px_rgba(2,10,24,0.78)]">
            <div className="flex shrink-0 items-center justify-between border-b border-cyan-800/70 bg-[linear-gradient(110deg,#172f55_0%,#164653_55%,#42361f_100%)] px-4 py-3 sm:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-950/30 text-cyan-100 ring-1 ring-cyan-700/70">
                  <SlidersHorizontal className="h-[18px] w-[18px]" strokeWidth={2.4} />
                </div>
                <div className="min-w-0">
                  <h3 className="truncate text-base font-bold text-white">Navigation Settings</h3>
                  <p className="text-[11px] text-slate-300">Preview updates instantly. Save to apply.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowNavigationSettings(false)}
                className="ml-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-500/70 bg-slate-950/30 text-slate-300 transition-colors hover:border-cyan-600 hover:bg-slate-700/70 hover:text-white"
                aria-label="Close navigation settings"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 lg:grid-cols-[180px_minmax(0,1fr)]">
              <aside className="hidden min-h-0 border-r border-cyan-800/60 bg-[linear-gradient(180deg,#11253f_0%,#123743_58%,#3a311f_100%)] lg:flex lg:flex-col">
                <div className="shrink-0 border-b border-cyan-800/60 bg-slate-950/25 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-cyan-200/75">
                  Live preview
                </div>
                <div className="min-h-0 flex-1 space-y-0.5 overflow-hidden p-2">
                  {navigationDraft.map((item, index) => {
                    const definition = defaultTabs.find(tab => tab.id === item.id);
                    const Icon = definition?.icon || Settings;
                    const previewLabel = item.label.trim() || definition?.label || item.id;
                    const previewBadgeCount = item.id === 'customerservice'
                      ? 3
                      : item.id === 'cccservice'
                        ? 2
                        : item.id === 'accountlocks' || item.id === 'withdrawals' || item.id === 'verifications'
                          ? 1
                          : 0;

                    return (
                      <div
                        key={item.id}
                        className={`flex h-6 items-center gap-1.5 rounded px-1.5 text-left ${index === 0 ? 'bg-blue-700 text-white shadow-sm' : 'text-slate-300 hover:bg-cyan-900/35 hover:text-white'}`}
                      >
                        <Icon className="h-3 w-3 shrink-0" />
                        <span className="min-w-0 flex-1 truncate text-[10px] font-medium leading-none">{previewLabel}</span>
                        {previewBadgeCount > 0 && (
                          <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full border border-orange-300/70 bg-orange-600 px-1 text-[8px] font-bold leading-none text-white shadow-sm" title="Notification preview">
                            {previewBadgeCount}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </aside>

              <div ref={navigationListRef} className="min-h-0 overflow-y-auto overscroll-contain bg-[linear-gradient(180deg,#1b293b_0%,#233143_100%)] p-2.5 scrollbar-dark sm:p-3">
                <div className="space-y-1.5">
                  {navigationDraft.map((item, index) => {
                    const definition = defaultTabs.find(tab => tab.id === item.id);
                    const originalLabel = definition?.label || item.id;
                    const hasCustomLabel = item.label.trim() !== originalLabel;
                    const hasCustomPosition = defaultTabs.findIndex(tab => tab.id === item.id) !== index;
                    const isModified = hasCustomLabel || hasCustomPosition;
                    const Icon = definition?.icon || Settings;

                    return (
                      <div
                        key={item.id}
                        data-navigation-item-id={item.id}
                        className={`group relative grid grid-cols-[26px_30px_minmax(0,1fr)] items-center gap-2 rounded-lg border p-2 shadow-sm transition-all duration-150 sm:grid-cols-[26px_30px_minmax(0,1fr)_132px] ${navigationDragState?.tabId === item.id ? 'scale-[0.99] border-cyan-300 bg-cyan-950/60 opacity-30' : isModified ? 'border-amber-600/75 bg-gradient-to-r from-amber-950/45 via-slate-800 to-slate-800 shadow-[inset_3px_0_0_rgba(245,158,11,0.7)] hover:-translate-y-px hover:border-cyan-400 hover:bg-cyan-950/35 hover:shadow-[0_0_0_1px_rgba(34,211,238,0.24),0_6px_14px_rgba(2,6,23,0.48)] focus-within:border-blue-400 focus-within:bg-blue-950/50 focus-within:ring-1 focus-within:ring-blue-400/50' : 'border-slate-600/90 bg-slate-800/85 hover:-translate-y-px hover:border-cyan-400 hover:bg-cyan-950/35 hover:shadow-[0_0_0_1px_rgba(34,211,238,0.24),0_6px_14px_rgba(2,6,23,0.48)] focus-within:border-blue-400 focus-within:bg-blue-950/50 focus-within:ring-1 focus-within:ring-blue-400/50'}`}
                      >
                        <div className="flex h-7 w-[26px] items-center justify-center rounded-md border border-yellow-200/70 bg-yellow-400 text-[10px] font-black tabular-nums text-slate-950 shadow-sm shadow-yellow-950/30 transition-transform group-hover:scale-105 group-focus-within:scale-105" title={`Position ${index + 1}`}>
                          {String(index + 1).padStart(2, '0')}
                        </div>
                        <div className="flex h-7 w-[30px] items-center justify-center rounded-md border border-cyan-700/70 bg-cyan-950/65 text-cyan-200 transition-colors group-hover:border-cyan-400 group-hover:bg-cyan-800/70 group-hover:text-white group-focus-within:border-blue-400 group-focus-within:bg-blue-800/70 group-focus-within:text-white" title={originalLabel}>
                          <Icon className="h-3.5 w-3.5" strokeWidth={2.3} />
                        </div>
                        <div className="min-w-0">
                          <label htmlFor={`navigation-label-${item.id}`} className="sr-only">Display name for {originalLabel}</label>
                          <input
                            id={`navigation-label-${item.id}`}
                            type="text"
                            value={item.label}
                            maxLength={30}
                            onChange={(event) => {
                              const label = event.target.value;
                              setNavigationDraft(current => current.map(entry => entry.id === item.id ? { ...entry, label } : entry));
                            }}
                            className="h-8 w-full rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-950 shadow-sm outline-none transition-all placeholder:text-slate-400 hover:border-cyan-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                            placeholder={originalLabel}
                            title={`Original name: ${originalLabel}`}
                          />
                        </div>
                        <div className="col-span-3 flex items-center justify-end gap-1 sm:col-span-1">
                          <button
                            type="button"
                            onClick={() => restoreNavigationItemLabel(item.id)}
                            disabled={!hasCustomLabel}
                            className="inline-flex h-8 w-[66px] items-center justify-center gap-1 rounded-md border border-amber-500/80 bg-gradient-to-b from-amber-700/80 to-amber-900 px-1.5 text-[10px] font-bold text-amber-100 shadow-sm shadow-slate-950/60 transition-colors hover:border-yellow-300 hover:from-amber-500 hover:to-amber-700 hover:text-white disabled:cursor-not-allowed disabled:border-slate-700 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-600 disabled:shadow-none"
                            title={`Restore “${originalLabel}”`}
                          >
                            <RotateCcw className="h-3 w-3" />
                            Reset
                          </button>
                          <button
                            type="button"
                            onClick={() => handleNavigationMoveClick(index, -1)}
                            onPointerDown={(event) => startNavigationDrag(event, item.id, -1)}
                            onPointerMove={updateNavigationDrag}
                            onPointerUp={endNavigationDrag}
                            onPointerCancel={endNavigationDrag}
                            disabled={index === 0}
                            className="flex h-8 w-[29px] touch-none select-none items-center justify-center rounded-md border border-blue-400/80 bg-gradient-to-b from-blue-600 to-blue-800 text-white shadow-sm shadow-slate-950/60 transition-colors hover:border-blue-200 hover:from-blue-500 hover:to-blue-700 disabled:cursor-not-allowed disabled:border-slate-700 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-600 disabled:shadow-none"
                            aria-label={`Move ${item.label || originalLabel} up. Hold and drag upward to reorder.`}
                            title="Click to move up · Hold and drag upward"
                          >
                            <ChevronUp className="h-3.5 w-3.5" strokeWidth={2.6} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleNavigationMoveClick(index, 1)}
                            onPointerDown={(event) => startNavigationDrag(event, item.id, 1)}
                            onPointerMove={updateNavigationDrag}
                            onPointerUp={endNavigationDrag}
                            onPointerCancel={endNavigationDrag}
                            disabled={index === navigationDraft.length - 1}
                            className="flex h-8 w-[29px] touch-none select-none items-center justify-center rounded-md border border-cyan-400/80 bg-gradient-to-b from-cyan-600 to-cyan-800 text-white shadow-sm shadow-slate-950/60 transition-colors hover:border-cyan-200 hover:from-cyan-500 hover:to-cyan-700 disabled:cursor-not-allowed disabled:border-slate-700 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-600 disabled:shadow-none"
                            aria-label={`Move ${item.label || originalLabel} down. Hold and drag downward to reorder.`}
                            title="Click to move down · Hold and drag downward"
                          >
                            <ChevronDown className="h-3.5 w-3.5" strokeWidth={2.6} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-cyan-800/60 bg-[#17263a] px-4 py-3 sm:px-5">
              <button
                type="button"
                onClick={() => setShowNavigationSettings(false)}
                className="h-9 rounded-lg border border-slate-600 bg-slate-800 px-4 text-xs font-semibold text-slate-200 shadow-sm transition-colors hover:border-slate-500 hover:bg-slate-700 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveNavigationDraft}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-cyan-700/70 bg-gradient-to-r from-blue-700 to-cyan-700 px-4 text-xs font-bold text-white shadow-md shadow-slate-950/40 transition-colors hover:from-blue-600 hover:to-cyan-600"
              >
                <Save className="h-3.5 w-3.5" />
                Save settings
              </button>
            </div>
          </div>

          {navigationDragState && (() => {
            const draggedItem = navigationDraft.find(item => item.id === navigationDragState.tabId);
            const definition = defaultTabs.find(tab => tab.id === navigationDragState.tabId);
            const Icon = definition?.icon || Settings;
            const label = draggedItem?.label.trim() || definition?.label || navigationDragState.tabId;

            return (
              <div
                className="pointer-events-none fixed z-[10000] flex items-center gap-2 rounded-lg border-2 border-cyan-300 bg-cyan-950/95 p-2 text-white opacity-95 shadow-[0_0_10px_rgba(34,211,238,0.95),0_0_28px_rgba(6,182,212,0.75)]"
                style={{
                  left: navigationDragState.pointerX - navigationDragState.offsetX,
                  top: navigationDragState.pointerY - navigationDragState.offsetY,
                  width: navigationDragState.width,
                  height: navigationDragState.height,
                }}
                aria-hidden="true"
              >
                <div className="flex h-7 w-[26px] shrink-0 items-center justify-center rounded-md bg-yellow-400 text-[10px] font-black text-slate-950">
                  {String(navigationDraft.findIndex(item => item.id === navigationDragState.tabId) + 1).padStart(2, '0')}
                </div>
                <div className="flex h-7 w-[30px] shrink-0 items-center justify-center rounded-md border border-cyan-300/70 bg-cyan-800 text-cyan-50">
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <span className="min-w-0 flex-1 truncate text-xs font-bold">{label}</span>
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-cyan-500 text-white">
                  {navigationDragState.direction === -1
                    ? <ChevronUp className="h-4 w-4" strokeWidth={2.7} />
                    : <ChevronDown className="h-4 w-4" strokeWidth={2.7} />}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Change Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900 p-5 shadow-[0_24px_70px_rgba(2,6,23,0.7)] sm:p-6">
            <div className="mb-5 flex items-center gap-3 border-b border-slate-700/70 pb-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-300/30 bg-cyan-500/15">
                <Lock className="h-5 w-5 text-cyan-200" />
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-white sm:text-xl">Change Password</h3>
                <p className="mt-0.5 text-xs text-slate-400">Update your administrator login credentials</p>
              </div>
            </div>

            {passwordSuccess && (
              <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-emerald-400/35 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-200">
                <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                  <span className="text-white text-xs">✓</span>
                </div>
                Password changed successfully!
              </div>
            )}

            {passwordError && (
              <div className="mb-4 rounded-xl border border-rose-400/35 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-200">
                {passwordError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-300">
                  Current Password
                </label>
                <div className="relative">
                  <input
                    type={showCurrentPassword ? 'text' : 'password'}
                    value={passwordData.currentPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                    autoComplete="current-password"
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 pr-10 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                    placeholder="Enter current password"
                    disabled={changingPassword}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                  >
                    {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-300">
                  New Password
                </label>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={passwordData.newPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                    autoComplete="new-password"
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 pr-10 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                    placeholder="Enter new password"
                    disabled={changingPassword}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-300">
                  Confirm New Password
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={passwordData.confirmPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                    autoComplete="new-password"
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 pr-10 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                    placeholder="Confirm new password"
                    disabled={changingPassword}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && !changingPassword) {
                        handleChangePassword();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-6 flex gap-2.5 border-t border-slate-700/70 pt-4">
              <button
                onClick={() => {
                  setShowPasswordModal(false);
                  setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
                  setPasswordError(null);
                  setPasswordSuccess(false);
                }}
                className="flex-1 rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={changingPassword}
              >
                Cancel
              </button>
              <button
                onClick={handleChangePassword}
                disabled={changingPassword}
                className="flex-1 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:from-cyan-500 hover:to-blue-500 disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {changingPassword ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Changing...
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4" />
                    Change Password
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change Username Modal */}
      {showUsernameModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900 p-5 shadow-[0_24px_70px_rgba(2,6,23,0.7)] sm:p-6">
            <div className="mb-5 flex items-center gap-3 border-b border-slate-700/70 pb-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-violet-300/30 bg-violet-500/15">
                <UserCog className="h-5 w-5 text-violet-200" />
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-white sm:text-xl">Change Username</h3>
                <p className="mt-0.5 text-xs text-slate-400">Choose a new name for your administrator account</p>
              </div>
            </div>

            {usernameSuccess && (
              <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-emerald-400/35 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-200">
                <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                  <span className="text-white text-xs">✓</span>
                </div>
                Username changed successfully! Reloading...
              </div>
            )}

            {usernameError && (
              <div className="mb-4 rounded-xl border border-rose-400/35 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-200">
                {usernameError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-300">
                  New Username
                </label>
                <input
                  type="text"
                  value={usernameData.newUsername}
                  onChange={(e) => setUsernameData({ ...usernameData, newUsername: e.target.value })}
                  autoComplete="username"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                  placeholder="Enter new username"
                  disabled={changingUsername}
                />
                <p className="mt-1.5 text-[11px] text-slate-400">
                  Only letters, numbers and underscores (minimum 3 characters)
                </p>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-300">
                  Current Password
                </label>
                <div className="relative">
                  <input
                    type={showUsernamePassword ? 'text' : 'password'}
                    value={usernameData.currentPassword}
                    onChange={(e) => setUsernameData({ ...usernameData, currentPassword: e.target.value })}
                    autoComplete="current-password"
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 pr-10 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                    placeholder="Confirm with your password"
                    disabled={changingUsername}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && !changingUsername) {
                        handleChangeUsername();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowUsernamePassword(!showUsernamePassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                  >
                    {showUsernamePassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-6 flex gap-2.5 border-t border-slate-700/70 pt-4">
              <button
                onClick={() => {
                  setShowUsernameModal(false);
                  setUsernameData({ newUsername: '', currentPassword: '' });
                  setUsernameError(null);
                  setUsernameSuccess(false);
                }}
                className="flex-1 rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={changingUsername}
              >
                Cancel
              </button>
              <button
                onClick={handleChangeUsername}
                disabled={changingUsername}
                className="flex-1 rounded-xl bg-gradient-to-r from-violet-600 to-purple-700 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:from-violet-500 hover:to-purple-600 disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {changingUsername ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Changing...
                  </>
                ) : (
                  <>
                    <UserCog className="w-4 h-4" />
                    Change Username
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
