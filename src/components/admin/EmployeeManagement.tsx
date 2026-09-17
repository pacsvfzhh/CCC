import { Fragment, useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { UserPlus, Search, MoreVertical, CheckCircle, XCircle, Key, ChevronDown, ChevronUp, ChevronsDown, ChevronsUp, ChevronLeft, ChevronRight, Trash2, Eye, EyeOff, RefreshCw, ArrowUpDown, ArrowUp, ArrowDown, Pin, Tag, X, Users, CalendarDays, Clock, Pencil, Bell, MessageCircle, DollarSign, Headphones, Globe, Loader2, Timer, Wallet, MapPin, Clock3, History, LogIn, LogOut } from 'lucide-react';
import { formatSupabaseError, isFinancialAdminSessionError, isSupabaseAbortError, supabase } from '../../lib/supabase';
import { Employee, Admin } from '../../types';
import { createFinancialOperationId, getAdminFinancialSessionToken, logout } from '../../lib/auth';
import EmployeeDetailModal from './EmployeeDetailModal';
import LoginDeviceSummary from './LoginDeviceSummary';

interface OrderRealtimeData {
  user_id: string;
  status: string;
  commission_amount?: number | string | null;
  created_at?: string | null;
}

interface PendingWithdrawalRecord {
  id: string;
  amount: number;
  created_at: string;
}

interface WalletModalData {
  available: number;
  pending: number;
}

const loadWalletModalData = async (userId: string): Promise<WalletModalData> => {
  const [walletResult, pendingWithdrawalsResult] = await Promise.all([
    supabase
      .from('wallets')
      .select('available_balance')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('withdrawals')
      .select('amount')
      .eq('user_id', userId)
      .eq('status', 'pending'),
  ]);

  if (walletResult.error) throw walletResult.error;
  if (pendingWithdrawalsResult.error) throw pendingWithdrawalsResult.error;

  return {
    available: Number(walletResult.data?.available_balance) || 0,
    pending: (pendingWithdrawalsResult.data || []).reduce(
      (total, withdrawal) => total + (Number(withdrawal.amount) || 0),
      0,
    ),
  };
};

interface EmployeeWithAdmin extends Employee {
  admin?: {
    id: string;
    username: string;
    role: string;
  };
  walletBalance?: number;
  verification?: {
    real_name: string;
    wallet_address: string;
    phone: string;
    email: string;
  } | null;
  todayOrders: number;
  todayCompletedOrders: number;
  failedOrders: number;
  todayCommission: number;
  totalWorkMinutes: number;
  todayWorkMinutes: number;
  workDays: number;
  workStatus: 'online' | 'offline' | 'never_started';
  totalOrders: number;
  accountBalance: number;
  hasPendingWithdrawal: boolean;
  pendingWithdrawalAmount: number;
  pendingWithdrawalDate: string | null;
  pendingWithdrawals?: PendingWithdrawalRecord[];
  statsLoaded: boolean;
}

type SortField = 'totalOrders' | 'todayOrders' | 'todayCompletedOrders' | 'failedOrders' | 'walletBalance' | 'accountBalance' | 'todayCommission' | 'totalWorkMinutes' | 'todayWorkMinutes' | 'workDays' | 'created_at';
type SummaryFilter = 'today_working' | 'new_today' | 'currently_working';

const AUTO_REFRESH_INTERVAL_MS = 180000;
const AUTO_REFRESH_RETRY_MS = 5000;

const formatWithdrawalDate = (value: string) => {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getCalendarMonthKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

const formatCalendarDateLabel = (value: string) => value || '請選擇日期';

const isValidCalendarDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};

interface EmployeeGroup {
  admin: {
    id: string;
    username: string;
    role: string;
    is_pinned?: boolean;
  };
  employees: EmployeeWithAdmin[];
}

interface LoginIPRecord {
  id: string;
  action_type: 'login' | 'logout';
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  device_info: unknown | null;
}

interface EmployeeManagementProps {
  admin: Admin;
  isActive?: boolean;
  onQuickAction?: (action: 'message' | 'customerservice' | 'cccservice', employee: { id: string; username: string }) => void;
}

export default function EmployeeManagement({ admin, isActive = true, onQuickAction }: EmployeeManagementProps) {
  const [employeeGroups, setEmployeeGroups] = useState<EmployeeGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAdminFilter, setSelectedAdminFilter] = useState<string>('all');
  const [adminFilterOpen, setAdminFilterOpen] = useState(false);
  const [showCreateSecondaryAdmin, setShowCreateSecondaryAdmin] = useState(false);
  const [creatingSecondaryAdmin, setCreatingSecondaryAdmin] = useState(false);
  const [createSecondaryAdminError, setCreateSecondaryAdminError] = useState<string | null>(null);
  const [showSecondaryAdminPassword, setShowSecondaryAdminPassword] = useState(false);
  const [secondaryAdminForm, setSecondaryAdminForm] = useState({
    username: '',
    password: '',
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingEmployee, setEditingEmployee] = useState<EmployeeWithAdmin | null>(null);
  const [editingRemarksOnly, setEditingRemarksOnly] = useState<EmployeeWithAdmin | null>(null);
  const [showPasswordReset, setShowPasswordReset] = useState<{id: string; username: string} | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resettingPassword, setResettingPassword] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const expandedGroupsBeforeSearchRef = useRef<Set<string> | null>(null);
  const [deletingEmployee, setDeletingEmployee] = useState<EmployeeWithAdmin | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [pinConfirmEmployee, setPinConfirmEmployee] = useState<{id: string; username: string; employeeId?: string; currentPinned: boolean} | null>(null);
  const [editingCreatedAt, setEditingCreatedAt] = useState<{id: string; username: string; employeeId: string; currentDate: string} | null>(null);
  const [newCreatedAt, setNewCreatedAt] = useState('');
  const [registrationDateInputError, setRegistrationDateInputError] = useState<string | null>(null);
  const [registrationCalendarOpen, setRegistrationCalendarOpen] = useState(false);
  const [registrationCalendarMonth, setRegistrationCalendarMonth] = useState(() => getCalendarMonthKey(new Date()));
  const [savingCreatedAt, setSavingCreatedAt] = useState(false);

  const closeRegistrationDateEditor = () => {
    setEditingCreatedAt(null);
    setRegistrationCalendarOpen(false);
    setRegistrationDateInputError(null);
  };
  const [viewingEmployee, setViewingEmployee] = useState<EmployeeWithAdmin | null>(null);
  const [selectedTagsByGroup, setSelectedTagsByGroup] = useState<Map<string, string[]>>(new Map());
  const [editingTags, setEditingTags] = useState<EmployeeWithAdmin | null>(null);
  const [newTag, setNewTag] = useState('');
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    employeeId: '',
    remarks: '',
  });
  const [selectedAdminForCreate, setSelectedAdminForCreate] = useState<string | null>(null);
  const adminFilterRef = useRef<HTMLDivElement>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    show: boolean;
    title: string;
    message: string;
    employeeUsername: string;
    employeeId: string;
    variant: 'verification' | 'status';
    nextStatus: boolean;
    onConfirm: () => void;
  } | null>(null);
  const [notification, setNotification] = useState<{
    show: boolean;
    type: 'success' | 'error' | 'warning';
    title: string;
    message: string;
  } | null>(null);

  // Sort state per group
  const [sortByGroup, setSortByGroup] = useState<Map<string, { sortBy: SortField | null; sortDirection: 'asc' | 'desc' }>>(new Map());
  // Active filter per group (is_active): 'all' | 'active' | 'inactive'
  const [activeFilterByGroup, setActiveFilterByGroup] = useState<Map<string, 'all' | 'active' | 'inactive'>>(new Map());
  // Work status filter per group (multi-select): Set of selected work statuses
  const [workStatusFilterByGroup, setWorkStatusFilterByGroup] = useState<Map<string, Set<'online' | 'offline' | 'never_started'>>>(new Map());
  // Inactive days filter per group: accounts created X days ago that never started work
  type InactiveDaysRange = '2-3' | '3-7' | '7-15' | '15+';
  const [inactiveDaysFilterByGroup, setInactiveDaysFilterByGroup] = useState<Map<string, InactiveDaysRange>>(new Map());
  const [inactiveDaysDropdownOpen, setInactiveDaysDropdownOpen] = useState<string | null>(null);
  // Pending withdrawal filter per group
  const [pendingWithdrawalFilterByGroup, setPendingWithdrawalFilterByGroup] = useState<Set<string>>(new Set());
  // Summary filter per group
  const [summaryFilterByGroup, setSummaryFilterByGroup] = useState<Map<string, SummaryFilter>>(new Map());
  // Action menu
  const [openActionMenu, setOpenActionMenu] = useState<string | null>(null);
  const [resetFeedbackAdminId, setResetFeedbackAdminId] = useState<string | null>(null);
  const [pinningAdminId, setPinningAdminId] = useState<string | null>(null);
  const [adminPinOverrides, setAdminPinOverrides] = useState<Map<string, boolean>>(new Map());
  const resetFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Refresh
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);

  const [timeTick, setTimeTick] = useState(0);

  // Login IP popup state
  const [loginIPEmployee, setLoginIPEmployee] = useState<{ id: string; username: string; employeeId?: string } | null>(null);
  const [loginIPRecords, setLoginIPRecords] = useState<LoginIPRecord[]>([]);
  const [loginIPLoading, setLoginIPLoading] = useState(false);
  const [loginIPActionFilter, setLoginIPActionFilter] = useState<'login' | 'logout' | null>(null);

  // Wallet adjustment popup state
  const [walletEmployee, setWalletEmployee] = useState<{ id: string; username: string; employeeId?: string } | null>(null);
  const [walletData, setWalletData] = useState<WalletModalData | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletAdjustData, setWalletAdjustData] = useState({ amount: '', remarks: '' });
  const [walletAdjusting, setWalletAdjusting] = useState(false);
  const [walletNotification, setWalletNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const walletAdjustmentOperationIdRef = useRef<string | null>(null);

  const scrollLockRef = useRef(false);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const registrationCalendarRef = useRef<HTMLDivElement>(null);
  const employeeGroupsScrollRef = useRef<HTMLDivElement>(null);
  const employeeGroupsRef = useRef<EmployeeGroup[]>([]);
  employeeGroupsRef.current = employeeGroups;
  const isMountedRef = useRef(false);
  const initialLoadStartedRef = useRef(false);
  const loadInProgressRef = useRef(false);
  const pendingReloadRef = useRef(false);
  const pendingReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextAutoRefreshAtRef = useRef(Date.now() + AUTO_REFRESH_INTERVAL_MS);
  const withdrawalDateRefreshAttemptedRef = useRef(false);
  const guardedLoadEmployeesRef = useRef<((silent?: boolean) => Promise<void>) | null>(null);
  const realtimeChangeGenerationRef = useRef(0);

  const resetAutoRefreshTimer = useCallback((delayMs = AUTO_REFRESH_INTERVAL_MS) => {
    if (!isMountedRef.current) return;
    if (autoRefreshTimerRef.current) clearTimeout(autoRefreshTimerRef.current);
    nextAutoRefreshAtRef.current = Date.now() + delayMs;
    setTimeTick(tick => tick + 1);
    autoRefreshTimerRef.current = setTimeout(() => {
      void guardedLoadEmployeesRef.current?.(true);
    }, delayMs);
  }, []);

  const schedulePendingReload = () => {
    if (!isMountedRef.current || pendingReloadTimerRef.current) return;
    pendingReloadTimerRef.current = setTimeout(() => {
      pendingReloadTimerRef.current = null;
      if (!pendingReloadRef.current) return;
      pendingReloadRef.current = false;
      void guardedLoadEmployeesRef.current?.(true);
    }, 750);
  };

  // Close action menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (openActionMenu && actionMenuRef.current && !actionMenuRef.current.contains(e.target as Node)) {
        setOpenActionMenu(null);
      }
    };
    if (openActionMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openActionMenu]);

  useEffect(() => {
    if (!adminFilterOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (adminFilterRef.current && !adminFilterRef.current.contains(e.target as Node)) {
        setAdminFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [adminFilterOpen]);

  useEffect(() => {
    if (!inactiveDaysDropdownOpen) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-inactive-days-dropdown]')) {
        setInactiveDaysDropdownOpen(null);
        setIdleDaysDropdownPos(null);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [inactiveDaysDropdownOpen]);

  useEffect(() => {
    if (!inactiveDaysDropdownOpen) return;
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setInactiveDaysDropdownOpen(null);
        setIdleDaysDropdownPos(null);
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [inactiveDaysDropdownOpen]);

  useEffect(() => {
    if (!registrationCalendarOpen) return;
    const closeCalendarOnOutsideClick = (event: MouseEvent) => {
      if (registrationCalendarRef.current && !registrationCalendarRef.current.contains(event.target as Node)) {
        setRegistrationCalendarOpen(false);
      }
    };
    document.addEventListener('mousedown', closeCalendarOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeCalendarOnOutsideClick);
  }, [registrationCalendarOpen]);

  useEffect(() => {
    const anyModalOpen = !!(showCreateSecondaryAdmin || adminFilterOpen || editingEmployee || showPasswordReset || deletingEmployee || editingTags || notification?.show || confirmDialog?.show || loginIPEmployee || walletEmployee);
    if (anyModalOpen && !scrollLockRef.current) {
      scrollLockRef.current = true;
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    } else if (!anyModalOpen && scrollLockRef.current) {
      scrollLockRef.current = false;
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
  }, [showCreateSecondaryAdmin, adminFilterOpen, editingEmployee, showPasswordReset, deletingEmployee, editingTags, notification?.show, confirmDialog?.show, loginIPEmployee, walletEmployee]);

  useEffect(() => {
    if (!isActive) {
      isMountedRef.current = false;
      if (autoRefreshTimerRef.current) clearTimeout(autoRefreshTimerRef.current);
      autoRefreshTimerRef.current = null;
      if (pendingReloadTimerRef.current) clearTimeout(pendingReloadTimerRef.current);
      pendingReloadTimerRef.current = null;
      pendingReloadRef.current = false;
      return;
    }

    isMountedRef.current = true;
    if (!initialLoadStartedRef.current) {
      initialLoadStartedRef.current = true;
      void guardedLoadEmployeesRef.current?.(false);
    } else {
      void guardedLoadEmployeesRef.current?.(true);
    }

    let realtimeReloadTimer: ReturnType<typeof setTimeout> | null = null;
    let realtimeReloadWindowStartedAt: number | null = null;
    const scheduleRealtimeReload = (delay: number) => {
      if (!isMountedRef.current) return;
      const now = Date.now();
      realtimeReloadWindowStartedAt ??= now;
      if (realtimeReloadTimer) clearTimeout(realtimeReloadTimer);
      const elapsed = now - realtimeReloadWindowStartedAt;
      const wait = Math.max(0, Math.min(delay, 2000 - elapsed));
      realtimeReloadTimer = setTimeout(() => {
        realtimeReloadTimer = null;
        realtimeReloadWindowStartedAt = null;
        if (isMountedRef.current) void guardedLoadEmployeesRef.current?.(true);
      }, wait);
    };
    const markRealtimeChange = () => {
      realtimeChangeGenerationRef.current += 1;
    };
    const debouncedStructureReload = () => {
      markRealtimeChange();
      scheduleRealtimeReload(800);
    };
    const debouncedStatsReload = () => {
      markRealtimeChange();
      scheduleRealtimeReload(2000);
    };
    let workStatusUpdateTimer: ReturnType<typeof setTimeout> | null = null;
    const pendingWorkStatusUpdates = new Map<string, 'online' | 'offline'>();
    const scheduleWorkStatusUpdate = (userId: string, status: 'online' | 'offline') => {
      pendingWorkStatusUpdates.set(userId, status);
      markRealtimeChange();
      if (workStatusUpdateTimer) return;

      workStatusUpdateTimer = setTimeout(() => {
        workStatusUpdateTimer = null;
        const updates = new Map(pendingWorkStatusUpdates);
        pendingWorkStatusUpdates.clear();
        if (!isMountedRef.current || updates.size === 0) return;

        setEmployeeGroups(prev => prev.map(group => {
          let groupChanged = false;
          const employees = group.employees.map(employee => {
            const nextStatus = updates.get(employee.id);
            if (!nextStatus || nextStatus === employee.workStatus) return employee;
            groupChanged = true;
            return { ...employee, workStatus: nextStatus };
          });
          return groupChanged ? { ...group, employees } : group;
        }));
      }, 150);
    };
    let workTimeRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    let workTimeRefreshWindowStartedAt: number | null = null;
    let workTimeRefreshRunning = false;
    const pendingWorkTimeUserIds = new Set<string>();
    const scheduleWorkTimeRefresh = (userId: string) => {
      pendingWorkTimeUserIds.add(userId);
      if (workTimeRefreshRunning) return;

      const now = Date.now();
      workTimeRefreshWindowStartedAt ??= now;
      if (workTimeRefreshTimer) clearTimeout(workTimeRefreshTimer);

      const elapsed = now - workTimeRefreshWindowStartedAt;
      const wait = Math.max(0, Math.min(700, 2000 - elapsed));
      workTimeRefreshTimer = setTimeout(async () => {
        workTimeRefreshTimer = null;
        workTimeRefreshWindowStartedAt = null;
        const userIds = Array.from(pendingWorkTimeUserIds);
        pendingWorkTimeUserIds.clear();
        if (userIds.length === 0 || !isMountedRef.current) return;

        workTimeRefreshRunning = true;
        const requestGeneration = realtimeChangeGenerationRef.current;
        try {
          const { data, error } = await supabase.rpc('get_batch_work_time', { p_user_ids: userIds });
          if (error) {
            if (isMountedRef.current) debouncedStatsReload();
            return;
          }
          if (!isMountedRef.current) return;
          if (requestGeneration !== realtimeChangeGenerationRef.current) {
            userIds.forEach(id => pendingWorkTimeUserIds.add(id));
            return;
          }

          const workTimeMap = new Map<string, { total: number; today: number }>();
          (data || []).forEach((row) => {
            workTimeMap.set(row.user_id, {
              total: row.total_work_minutes || 0,
              today: row.today_work_minutes || 0,
            });
          });

          markRealtimeChange();
          setEmployeeGroups(prev => prev.map(group => ({
            ...group,
            employees: group.employees.map(employee => {
              const workTime = workTimeMap.get(employee.id);
              return workTime
                ? {
                    ...employee,
                    totalWorkMinutes: workTime.total,
                    todayWorkMinutes: workTime.today,
                  }
                : employee;
            }),
          })));
        } catch {
          if (isMountedRef.current) debouncedStatsReload();
        } finally {
          workTimeRefreshRunning = false;
          if (isMountedRef.current && pendingWorkTimeUserIds.size > 0) {
            const nextUserId = pendingWorkTimeUserIds.values().next().value;
            if (nextUserId) scheduleWorkTimeRefresh(nextUserId);
          }
        }
      }, wait);
    };
    const getPayloadUserId = (payload: { new: Record<string, unknown>; old: Record<string, unknown> }) => (
      String(payload.new.user_id || payload.old.user_id || '')
    );
    const isVisibleEmployeePayload = (payload: { new: Record<string, unknown>; old: Record<string, unknown> }) => {
      const userId = getPayloadUserId(payload);
      if (!userId) return true;
      return employeeGroupsRef.current.some(group => group.employees.some(employee => employee.id === userId));
    };
    const isBusinessWorkSessionChange = (payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) => {
      if (payload.eventType === 'INSERT' || payload.eventType === 'DELETE') return true;
      return payload.new.end_time != null || payload.new.duration_minutes != null;
    };
    const isTodayOrder = (dateString?: string | null) => {
      if (!dateString) return true;
      const now = new Date();
      const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      const timestamp = new Date(dateString).getTime();
      return timestamp >= start && timestamp < start + 24 * 60 * 60 * 1000;
    };
    const hasRelevantEmployeeChange = (payload: {
      eventType: string;
      new: Record<string, unknown>;
      old: Record<string, unknown>;
    }) => {
      if (payload.eventType === 'INSERT' || payload.eventType === 'DELETE') return true;

      const employeeId = String(payload.new.id || payload.old.id || '');
      const currentEmployee = employeeGroupsRef.current
        .flatMap(group => group.employees)
        .find(employee => employee.id === employeeId);
      if (!currentEmployee) return true;

      const relevantFields = ['username', 'employee_id', 'is_verified', 'is_active', 'remarks', 'tags', 'is_pinned', 'created_by', 'created_at'];
      return relevantFields.some(field =>
        field in payload.new && JSON.stringify(payload.new[field]) !== JSON.stringify((currentEmployee as unknown as Record<string, unknown>)[field])
      );
    };
    let realtimeRecoveryPending = false;
    const handleRealtimeStatus = (status: string) => {
      if (status === 'SUBSCRIBED') {
        if (!realtimeRecoveryPending || !isMountedRef.current) return;
        realtimeRecoveryPending = false;
        void guardedLoadEmployeesRef.current?.(true);
        return;
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        realtimeRecoveryPending = true;
        markRealtimeChange();
        scheduleRealtimeReload(1000);
      }
    };

    const adminsSubscription = supabase
      .channel('employee_mgmt_admins')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admins' }, () => {
        debouncedStructureReload();
      })
      .subscribe(handleRealtimeStatus);

    const usersSubscription = supabase
      .channel('employee_mgmt_users')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, (payload) => {
        if (hasRelevantEmployeeChange(payload)) debouncedStructureReload();
      })
      .subscribe(handleRealtimeStatus);

    const verificationRequestsSubscription = supabase
      .channel('employee_mgmt_verification_requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'verification_requests' }, (payload) => {
        if (isVisibleEmployeePayload(payload)) debouncedStructureReload();
      })
      .subscribe(handleRealtimeStatus);

    const workSessionsSubscription = supabase
      .channel('employee_mgmt_work_sessions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_sessions' }, (payload) => {
        const userId = getPayloadUserId(payload);
        if (!userId || !isVisibleEmployeePayload(payload) || !isBusinessWorkSessionChange(payload)) return;

        const isEnding = payload.eventType === 'DELETE'
          || payload.new.end_time != null
          || payload.new.duration_minutes != null;
        scheduleWorkStatusUpdate(userId, isEnding ? 'offline' : 'online');
        scheduleWorkTimeRefresh(userId);
      })
      .subscribe(handleRealtimeStatus);

    const dispatchSessionsSubscription = supabase
      .channel('employee_mgmt_dispatch_sessions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dispatch_sessions' }, (payload) => {
        const userId = getPayloadUserId(payload);
        if (!userId || !isVisibleEmployeePayload(payload)) return;

        const isStarting = payload.eventType === 'INSERT' && payload.new.status === 'online';
        const isEnding = payload.eventType === 'DELETE'
          || payload.new.status === 'offline'
          || payload.new.ended_at != null;
        if (!isStarting && !isEnding) return;

        scheduleWorkStatusUpdate(userId, isStarting ? 'online' : 'offline');
        if (isEnding) scheduleWorkTimeRefresh(userId);
      })
      .subscribe(handleRealtimeStatus);

    const withdrawalsSubscription = supabase
      .channel('employee_mgmt_withdrawals')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'withdrawals' }, (payload) => {
        if (isVisibleEmployeePayload(payload)) {
          markRealtimeChange();
          scheduleRealtimeReload(500);
        }
      })
      .subscribe(handleRealtimeStatus);

    let commissionRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    let commissionRefreshWindowStartedAt: number | null = null;
    let commissionRefreshRunning = false;
    const pendingCommissionUserIds = new Set<string>();
    const scheduleCommissionRefresh = (userId: string) => {
      pendingCommissionUserIds.add(userId);
      if (commissionRefreshRunning) return;
      const now = Date.now();
      commissionRefreshWindowStartedAt ??= now;
      if (commissionRefreshTimer) clearTimeout(commissionRefreshTimer);
      const elapsed = now - commissionRefreshWindowStartedAt;
      const wait = Math.max(0, Math.min(700, 2000 - elapsed));
      commissionRefreshTimer = setTimeout(async () => {
        commissionRefreshTimer = null;
        commissionRefreshWindowStartedAt = null;
        const userIds = Array.from(pendingCommissionUserIds);
        pendingCommissionUserIds.clear();
        if (userIds.length === 0 || !isMountedRef.current) return;
        commissionRefreshRunning = true;
        const requestGeneration = realtimeChangeGenerationRef.current;

        try {
          const { data, error } = await supabase.rpc('get_today_commission_by_user', { user_ids: userIds });
          if (error) {
            if (isMountedRef.current) debouncedStatsReload();
            return;
          }

          const commissionMap = new Map<string, number>(userIds.map(userId => [userId, 0]));
          (data || []).forEach((row) => {
            commissionMap.set(row.user_id, Number(row.today_commission) || 0);
          });
          if (!isMountedRef.current) return;
          if (requestGeneration !== realtimeChangeGenerationRef.current) {
            debouncedStatsReload();
            return;
          }
          markRealtimeChange();
          setEmployeeGroups(prev => prev.map(group => ({
            ...group,
            employees: group.employees.map(employee => (
              commissionMap.has(employee.id)
                ? { ...employee, todayCommission: commissionMap.get(employee.id) || 0 }
                : employee
            )),
          })));
        } catch {
          if (isMountedRef.current) debouncedStatsReload();
        } finally {
          commissionRefreshRunning = false;
          if (isMountedRef.current && pendingCommissionUserIds.size > 0) {
            const nextUserId = pendingCommissionUserIds.values().next().value;
            if (nextUserId) scheduleCommissionRefresh(nextUserId);
          }
        }
      }, wait);
    };

    const walletTransactionsSubscription = supabase
      .channel('employee_mgmt_wallet_transactions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wallet_transactions', filter: 'type=eq.commission' }, (payload) => {
        if (!isVisibleEmployeePayload(payload)) return;
        const currentRecord = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
        const previousRecord = payload.old as Record<string, unknown>;
        if (currentRecord.type !== 'commission' && previousRecord.type !== 'commission') return;
        const userId = String(currentRecord.user_id || previousRecord.user_id || '');
        if (userId) scheduleCommissionRefresh(userId);
      })
      .subscribe(handleRealtimeStatus);

    const walletsSubscription = supabase
      .channel('employee_mgmt_wallets')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wallets' }, (payload) => {
        if (!isVisibleEmployeePayload(payload)) return;
        if (payload.eventType !== 'DELETE' && payload.new && payload.new.user_id) {
          const userId = String(payload.new.user_id);
          const available = Number(payload.new.available_balance) || 0;
          const frozen = Number(payload.new.frozen_balance) || 0;
          markRealtimeChange();
          setEmployeeGroups(prev => prev.map(group => ({
            ...group,
            employees: group.employees.map(emp =>
              emp.id === userId ? { ...emp, walletBalance: available + frozen, accountBalance: available } : emp
            ),
          })));
          return;
        }
        debouncedStatsReload();
      })
      .subscribe(handleRealtimeStatus);

    const ordersSubscription = supabase
      .channel('employee_mgmt_orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
        if (!isVisibleEmployeePayload(payload)) return;
        if (payload.eventType === 'UPDATE' && payload.new && payload.new.user_id) {
          const order = payload.new as unknown as OrderRealtimeData;
          const previousOrder = payload.old as unknown as Partial<OrderRealtimeData>;
          if (!previousOrder.status) {
            debouncedStatsReload();
            return;
          }
          const userId = order.user_id;
          const wasToday = isTodayOrder(previousOrder.created_at);
          const isToday = isTodayOrder(order.created_at);
          const commissionChanged = previousOrder.status !== order.status
            || Number(previousOrder.commission_amount || 0) !== Number(order.commission_amount || 0);
          if (commissionChanged && (wasToday || isToday)) scheduleCommissionRefresh(userId);
          markRealtimeChange();
          setEmployeeGroups(prev => prev.map(group => ({
            ...group,
            employees: group.employees.map(emp => {
              if (emp.id !== userId) return emp;
              const wasSuccess = previousOrder.status === 'success';
              const isSuccess = order.status === 'success';
              const wasFailed = previousOrder.status === 'failure';
              const isFailed = order.status === 'failure';
              let todayCompletedDelta = 0;
              let failedDelta = 0;
              if (isToday && isSuccess && !wasSuccess) {
                todayCompletedDelta = 1;
              } else if (wasToday && !isSuccess && wasSuccess) {
                todayCompletedDelta = -1;
              }
              if (isToday && isFailed && !wasFailed) failedDelta = 1;
              else if (wasToday && !isFailed && wasFailed) failedDelta = -1;
              return {
                ...emp,
                todayCompletedOrders: Math.max(0, emp.todayCompletedOrders + todayCompletedDelta),
                failedOrders: Math.max(0, emp.failedOrders + failedDelta),
                todayCommission: emp.todayCommission,
              };
            }),
          })));
          return;
        }
        if (payload.eventType === 'INSERT' && payload.new && payload.new.user_id) {
          const order = payload.new as unknown as OrderRealtimeData;
          const userId = order.user_id;
          const isToday = isTodayOrder(order.created_at);
          if (isToday && order.status === 'success') scheduleCommissionRefresh(userId);
          markRealtimeChange();
          setEmployeeGroups(prev => prev.map(group => ({
            ...group,
            employees: group.employees.map(emp => {
              if (emp.id !== userId) return emp;
              return {
                ...emp,
                todayOrders: isToday ? emp.todayOrders + 1 : emp.todayOrders,
                totalOrders: emp.totalOrders + 1,
                todayCompletedOrders: isToday && order.status === 'success' ? emp.todayCompletedOrders + 1 : emp.todayCompletedOrders,
                failedOrders: isToday && order.status === 'failure' ? emp.failedOrders + 1 : emp.failedOrders,
                todayCommission: emp.todayCommission,
              };
            }),
          })));
          return;
        }
        debouncedStatsReload();
      })
      .subscribe(handleRealtimeStatus);

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      setTimeTick(tick => tick + 1);
      if (Date.now() >= nextAutoRefreshAtRef.current && !loadInProgressRef.current) {
        void guardedLoadEmployeesRef.current?.(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const timeUpdateInterval = setInterval(() => {
      setTimeTick(tick => tick + 1);
    }, 1000);

    return () => {
      isMountedRef.current = false;
      pendingReloadRef.current = false;
      if (realtimeReloadTimer) clearTimeout(realtimeReloadTimer);
      supabase.removeChannel(adminsSubscription);
      supabase.removeChannel(usersSubscription);
      supabase.removeChannel(verificationRequestsSubscription);
      supabase.removeChannel(workSessionsSubscription);
      supabase.removeChannel(dispatchSessionsSubscription);
      supabase.removeChannel(withdrawalsSubscription);
      supabase.removeChannel(walletsSubscription);
      supabase.removeChannel(walletTransactionsSubscription);
      supabase.removeChannel(ordersSubscription);
      if (commissionRefreshTimer) clearTimeout(commissionRefreshTimer);
      if (workStatusUpdateTimer) clearTimeout(workStatusUpdateTimer);
      pendingWorkStatusUpdates.clear();
      if (workTimeRefreshTimer) clearTimeout(workTimeRefreshTimer);
      pendingWorkTimeUserIds.clear();
      if (resetFeedbackTimeoutRef.current) clearTimeout(resetFeedbackTimeoutRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (autoRefreshTimerRef.current) clearTimeout(autoRefreshTimerRef.current);
      if (pendingReloadTimerRef.current) clearTimeout(pendingReloadTimerRef.current);
      clearInterval(timeUpdateInterval);
    };
  }, [isActive, resetAutoRefreshTimer]);

  useEffect(() => {
    if (loading || statsLoading || employeeGroups.length === 0 || withdrawalDateRefreshAttemptedRef.current) return;

    const hasPendingWithdrawalWithoutDate = employeeGroups.some(group =>
      group.employees.some(employee => employee.hasPendingWithdrawal && (!employee.pendingWithdrawalDate || !employee.pendingWithdrawals?.length))
    );

    if (!hasPendingWithdrawalWithoutDate) return;
    withdrawalDateRefreshAttemptedRef.current = true;
    void guardedLoadEmployeesRef.current?.(true);
  }, [employeeGroups, loading, statsLoading]);

  const formatTime = useCallback((minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}m`;
  }, []);

  const getCountdownSeconds = () => {
    void timeTick;
    return Math.max(0, Math.ceil((nextAutoRefreshAtRef.current - Date.now()) / 1000));
  };

  const formatCountdown = () => {
    return getCountdownSeconds();
  };

  const generatePassword = () => {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    setFormData({ ...formData, password });
  };

  const generateResetPassword = () => {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    setNewPassword(password);
  };

  const guardedLoadEmployees = async (silent: boolean = true) => {
    if (loadInProgressRef.current) {
      pendingReloadRef.current = true;
      return;
    }
    if (pendingReloadTimerRef.current) {
      clearTimeout(pendingReloadTimerRef.current);
      pendingReloadTimerRef.current = null;
    }
    pendingReloadRef.current = false;
    loadInProgressRef.current = true;
    try {
      const committed = await loadEmployees(silent);
      resetAutoRefreshTimer(committed ? AUTO_REFRESH_INTERVAL_MS : AUTO_REFRESH_RETRY_MS);
    } finally {
      loadInProgressRef.current = false;
      if (isMountedRef.current && pendingReloadRef.current) schedulePendingReload();
    }
  };
  guardedLoadEmployeesRef.current = guardedLoadEmployees;

  const loadEmployees = async (silent: boolean = false) => {
    const requestRealtimeGeneration = realtimeChangeGenerationRef.current;
    const hasExistingGroups = employeeGroupsRef.current.length > 0;
    const showInitialLoading = !silent && !hasExistingGroups;
    let hasBaseData = false;
    let committed = false;

    if (showInitialLoading) setLoading(true);
    else setIsRefreshing(true);

    try {
      const now = new Date();
      const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
      const todayISO = todayUTC.toISOString();

      let employeesQuery = supabase
        .from('users')
        .select('id, username, employee_id, is_verified, is_active, total_income, first_success_order_date, created_by, remarks, tags, is_pinned, current_session_token, session_created_at, last_heartbeat_at, current_tab_id, created_at, updated_at')
        .order('created_at', { ascending: false });

      if (admin.role === 'secondary_admin') {
        employeesQuery = employeesQuery.eq('created_by', admin.id);
      }

      let adminsQuery = supabase.from('admins').select('id, username, role, is_pinned');
      if (admin.role === 'secondary_admin') {
        adminsQuery = adminsQuery.eq('id', admin.id);
      } else {
        adminsQuery = adminsQuery.neq('role', 'emergency_admin');
      }

      const [employeesResult, adminsResult] = await Promise.all([
        employeesQuery,
        adminsQuery,
      ]);

      if (employeesResult.error) throw employeesResult.error;
      if (adminsResult.error) throw adminsResult.error;

      const employees = employeesResult.data || [];
      const admins = adminsResult.data || [];
      const userIds = employees.map((emp: Employee) => emp.id);
      const previousEmployeesById = new Map(
        employeeGroupsRef.current.flatMap(group => group.employees.map(employee => [employee.id, employee] as const)),
      );
      const adminMap = new Map(admins.map((adminInfo) => [adminInfo.id, adminInfo]));
      const baseGroups = new Map<string, EmployeeGroup>();

      admins.forEach((adminInfo) => {
        baseGroups.set(adminInfo.id, {
          admin: adminInfo,
          employees: [],
        });
      });

      employees.forEach((emp: Employee) => {
        const adminInfo = adminMap.get(emp.created_by);
        if (!adminInfo) return;

        const previousEmployee = previousEmployeesById.get(emp.id);
        const baseEmployee: EmployeeWithAdmin = previousEmployee
          ? {
              ...previousEmployee,
              ...emp,
              admin: adminInfo,
            }
          : {
              ...emp,
              admin: adminInfo,
              walletBalance: 0,
              verification: null,
              todayOrders: 0,
              todayCompletedOrders: 0,
              failedOrders: 0,
              todayCommission: 0,
              totalWorkMinutes: 0,
              todayWorkMinutes: 0,
              workDays: 0,
              workStatus: 'never_started',
              totalOrders: 0,
              accountBalance: 0,
              hasPendingWithdrawal: false,
              pendingWithdrawalAmount: 0,
              pendingWithdrawalDate: null,
              pendingWithdrawals: [],
              statsLoaded: false,
            };

        baseEmployee.statsLoaded = previousEmployee?.statsLoaded ?? false;
        if (!baseGroups.has(emp.created_by)) {
          baseGroups.set(emp.created_by, {
            admin: adminInfo,
            employees: [],
          });
        }
        baseGroups.get(emp.created_by)!.employees.push(baseEmployee);
      });

      const sortGroups = (groups: Map<string, EmployeeGroup>) => Array.from(groups.values())
        .sort((a, b) => {
          if (a.admin.role === 'super_admin' && b.admin.role !== 'super_admin') return -1;
          if (a.admin.role !== 'super_admin' && b.admin.role === 'super_admin') return 1;
          if (a.admin.role === 'secondary_admin' && b.admin.role === 'secondary_admin') {
            if (a.admin.is_pinned && !b.admin.is_pinned) return -1;
            if (!a.admin.is_pinned && b.admin.is_pinned) return 1;
          }
          return a.admin.username.localeCompare(b.admin.username);
        });
      const baseGroupsArray = sortGroups(baseGroups);
      const currentEmployeeCount = employeeGroupsRef.current.reduce((sum, group) => sum + group.employees.length, 0);
      const baseEmployeeCount = baseGroupsArray.reduce((sum, group) => sum + group.employees.length, 0);
      const hasIncompleteBaseResult = silent
        && currentEmployeeCount > 0
        && baseEmployeeCount === 0
        && (admins.length === 0 || employees.length > 0);

      if (hasIncompleteBaseResult || !isMountedRef.current) return false;
      if (requestRealtimeGeneration !== realtimeChangeGenerationRef.current) {
        pendingReloadRef.current = true;
        return false;
      }

      hasBaseData = true;
      setEmployeeGroups(baseGroupsArray);
      setLoading(false);
      setStatsLoading(true);
      setExpandedGroups(prev => {
        if (prev.size === 0) return new Set(baseGroupsArray.map(group => group.admin.id));
        return prev;
      });

      // Now load all stats in parallel
      const [
        walletsResult,
        verificationsResult,
        totalOrdersResult,
        workDaysResult,
        todayOrdersResult,
        todayCompletedOrdersResult,
        failedOrdersResult,
        todayCommissionResult,
        workStatusResult,
        workTimeResult,
        pendingWithdrawalsResult,
      ] = await Promise.all([
        userIds.length > 0
          ? supabase.from('wallets').select('user_id, available_balance, frozen_balance').in('user_id', userIds)
          : Promise.resolve({ data: [], error: null }),
        userIds.length > 0
          ? supabase.from('verification_requests').select('user_id, real_name, wallet_address, phone, email').eq('status', 'approved').in('user_id', userIds)
          : Promise.resolve({ data: [], error: null }),
        supabase.rpc('count_orders_by_user', { user_ids: userIds }),
        supabase.rpc('count_order_days_by_user', { user_ids: userIds }),
        supabase.rpc('count_today_orders_by_user', { user_ids: userIds, today_start: todayISO }),
        supabase.rpc('count_today_completed_orders_by_user', { user_ids: userIds, today_start: todayISO }),
        supabase.rpc('count_today_valid_data_failed_orders_by_user', { user_ids: userIds, today_start: todayISO }),
        supabase.rpc('get_today_commission_by_user', { user_ids: userIds }),
        supabase.rpc('get_batch_work_status', { p_user_ids: userIds }),
        userIds.length > 0
          ? supabase.rpc('get_batch_work_time', { p_user_ids: userIds })
          : Promise.resolve({ data: [], error: null }),
        userIds.length > 0
          ? supabase.from('withdrawals').select('id, user_id, amount, created_at').in('user_id', userIds).eq('status', 'pending')
          : Promise.resolve({ data: [], error: null }),
      ]);

      const statsError = [
        walletsResult.error,
        verificationsResult.error,
        totalOrdersResult.error,
        workDaysResult.error,
        todayOrdersResult.error,
        todayCompletedOrdersResult.error,
        failedOrdersResult.error,
        todayCommissionResult.error,
        workStatusResult.error,
        workTimeResult.error,
        pendingWithdrawalsResult.error,
      ].find(Boolean);
      if (statsError) throw statsError;

      // Build maps
      const walletTotalMap = new Map<string, number>();
      const walletAvailableMap = new Map<string, number>();
      walletsResult.data?.forEach((w) => {
        walletTotalMap.set(w.user_id, (Number(w.available_balance) || 0) + (Number(w.frozen_balance) || 0));
        walletAvailableMap.set(w.user_id, Number(w.available_balance) || 0);
      });

      const verificationMap = new Map(
        verificationsResult.data?.map((v) => [v.user_id, {
          real_name: v.real_name,
          wallet_address: v.wallet_address,
          phone: v.phone,
          email: v.email
        }]) || []
      );

      const totalOrdersMap = new Map<string, number>();
      if (totalOrdersResult.data) {
        totalOrdersResult.data.forEach((row) => {
          totalOrdersMap.set(row.user_id, row.count || 0);
        });
      }

      const workDaysMap = new Map<string, number>();
      if (workDaysResult.data) {
        workDaysResult.data.forEach((row) => {
          workDaysMap.set(row.user_id, Number(row.day_count) || 0);
        });
      }

      const todayOrdersMap = new Map<string, number>();
      if (todayOrdersResult.data) {
        todayOrdersResult.data.forEach((row) => {
          todayOrdersMap.set(row.user_id, row.count || 0);
        });
      }

      const todayCompletedMap = new Map<string, number>();
      if (todayCompletedOrdersResult.data) {
        todayCompletedOrdersResult.data.forEach((row) => {
          todayCompletedMap.set(row.user_id, row.count || 0);
        });
      }

      const failedOrdersMap = new Map<string, number>();
      if (failedOrdersResult.data) {
        failedOrdersResult.data.forEach((row) => {
          failedOrdersMap.set(row.user_id, row.count || 0);
        });
      }

      const todayCommissionMap = new Map<string, number>();
      if (todayCommissionResult.data) {
        todayCommissionResult.data.forEach((row) => {
          todayCommissionMap.set(row.user_id, Number(row.today_commission) || 0);
        });
      }

      const workStatusMap = new Map<string, string>();
      if (workStatusResult.data) {
        workStatusResult.data.forEach((row) => {
          workStatusMap.set(row.user_id, row.work_status);
        });
      }

      const workTimeMap = new Map<string, { total: number; today: number }>();
      if (workTimeResult.data) {
        workTimeResult.data.forEach((row) => {
          workTimeMap.set(row.user_id, {
            total: row.total_work_minutes || 0,
            today: row.today_work_minutes || 0,
          });
        });
      }

      const pendingWithdrawalMap = new Map<string, PendingWithdrawalRecord[]>();
      if (pendingWithdrawalsResult.data) {
        pendingWithdrawalsResult.data.forEach((row) => {
          const records = pendingWithdrawalMap.get(row.user_id) || [];
          records.push({
            id: row.id,
            amount: Number(row.amount || 0),
            created_at: row.created_at,
          });
          pendingWithdrawalMap.set(row.user_id, records);
        });
      }
      pendingWithdrawalMap.forEach((records) => {
        records.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      });

      const groups = new Map<string, EmployeeGroup>();
      baseGroups.forEach((group, adminId) => {
        groups.set(adminId, {
          admin: group.admin,
          employees: group.employees.map((employee) => {
            const wsRaw = workStatusMap.get(employee.id) || 'never_started';
            const workStatus: 'online' | 'offline' | 'never_started' =
              wsRaw === 'online' ? 'online' : wsRaw === 'offline' ? 'offline' : 'never_started';
            const wt = workTimeMap.get(employee.id);
            const pendingWithdrawals = pendingWithdrawalMap.get(employee.id) || [];

            return {
              ...employee,
              admin: group.admin,
              walletBalance: walletTotalMap.get(employee.id) || 0,
              verification: verificationMap.get(employee.id) || null,
              todayOrders: todayOrdersMap.get(employee.id) || 0,
              todayCompletedOrders: todayCompletedMap.get(employee.id) || 0,
              failedOrders: failedOrdersMap.get(employee.id) || 0,
              todayCommission: todayCommissionMap.get(employee.id) || 0,
              totalWorkMinutes: wt?.total || 0,
              todayWorkMinutes: wt?.today || 0,
              workDays: workDaysMap.get(employee.id) || 0,
              workStatus,
              totalOrders: totalOrdersMap.get(employee.id) || 0,
              accountBalance: walletAvailableMap.get(employee.id) || 0,
              hasPendingWithdrawal: pendingWithdrawals.length > 0,
              pendingWithdrawalAmount: pendingWithdrawals.reduce((sum, withdrawal) => sum + withdrawal.amount, 0),
              pendingWithdrawalDate: pendingWithdrawals[0]?.created_at || null,
              pendingWithdrawals,
              statsLoaded: true,
            };
          }),
        });
      });

      const groupsArray = sortGroups(groups);

      const nextEmployeeCount = groupsArray.reduce((sum, group) => sum + group.employees.length, 0);
      const hasIncompleteSilentResult = silent
        && currentEmployeeCount > 0
        && nextEmployeeCount === 0
        && (admins.length === 0 || employees.length > 0);
      if (hasIncompleteSilentResult || !isMountedRef.current) return false;
      if (requestRealtimeGeneration !== realtimeChangeGenerationRef.current) {
        pendingReloadRef.current = true;
        return false;
      }

      realtimeChangeGenerationRef.current += 1;
      setEmployeeGroups(groupsArray);
      setAdminPinOverrides(new Map());
      setStatsLoading(false);
      committed = true;
      setExpandedGroups(prev => {
        if (prev.size === 0) return new Set(groupsArray.map(g => g.admin.id));
        return prev;
      });
    } catch (error) {
      if (!isSupabaseAbortError(error)) {
        console.error('Error loading employees:', formatSupabaseError(error));
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(showInitialLoading && !hasBaseData);
        setStatsLoading(false);
        if (!showInitialLoading) setIsRefreshing(false);
      }
    }
    return committed;
  };

  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);

    try {
      if (!formData.username.trim()) throw new Error('使用者名稱為必填');
      if (formData.password.length < 6) throw new Error('密碼至少需要 6 個字元');
      if (!formData.employeeId.trim()) throw new Error('員工 ID 為必填');

      const createdBy = admin.role === 'secondary_admin'
        ? admin.id
        : (selectedAdminForCreate || admin.id);

      const { data: result, error } = await supabase.rpc('admin_create_employee_account', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_username: formData.username.trim(),
        p_password: formData.password,
        p_employee_id: formData.employeeId.trim(),
        p_created_by: createdBy,
        p_remarks: formData.remarks.trim(),
      });

      if (error) throw new Error(formatSupabaseError(error));
      if (!result?.success) throw new Error(result?.error || '建立員工失敗');

      setFormData({ username: '', password: '', employeeId: '', remarks: '' });
      setShowCreateForm(false);
      setCreateError(null);
      setSelectedAdminForCreate(null);
      await guardedLoadEmployeesRef.current?.(false);
    } catch (error: unknown) {
      if (isFinancialAdminSessionError(error)) {
        void logout(false);
        return;
      }

      setCreateError(formatSupabaseError(error) || '建立員工失敗。');
    } finally {
      setCreating(false);
    }
  };

  const handleCreateSecondaryAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateSecondaryAdminError(null);
    setCreatingSecondaryAdmin(true);

    try {
      if (!secondaryAdminForm.username.trim()) throw new Error('使用者名稱為必填');
      if (secondaryAdminForm.password.length < 6) throw new Error('密碼至少需要 6 個字元');

      const { data: result, error } = await supabase.rpc('admin_create_secondary_account', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_username: secondaryAdminForm.username.trim(),
        p_password: secondaryAdminForm.password,
      });

      if (error) throw error;
      if (!result?.success) throw new Error(result?.error || '建立管理員失敗');

      setSecondaryAdminForm({ username: '', password: '' });
      setShowSecondaryAdminPassword(false);
      setShowCreateSecondaryAdmin(false);
      await guardedLoadEmployeesRef.current?.(false);
    } catch (error) {
      console.error('Error creating secondary admin:', formatSupabaseError(error));
      setCreateSecondaryAdminError(formatSupabaseError(error) || '建立次要管理員失敗。');
    } finally {
      setCreatingSecondaryAdmin(false);
    }
  };

  const toggleEmployeeStatus = useCallback(async (employeeId: string, currentStatus: boolean, employeeUsername: string, employeeDisplayId: string) => {
    const newStatus = !currentStatus;
    setConfirmDialog({
      show: true,
      title: `${newStatus ? '啟用' : '停用'}員工`,
      message: `確定要${newStatus ? '啟用' : '停用'}此員工帳戶嗎？`,
      employeeUsername,
      employeeId: employeeDisplayId,
      variant: 'status',
      nextStatus: newStatus,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          setEmployeeGroups(prev => prev.map(g => ({
            ...g,
            employees: g.employees.map(emp => emp.id === employeeId ? { ...emp, is_active: newStatus } : emp)
          })));
          const { error } = await supabase.rpc('admin_update_employee_account', {
            p_admin_session_token: getAdminFinancialSessionToken(),
            p_user_id: employeeId,
            p_updates: { is_active: newStatus },
          });
          if (error) {
            setEmployeeGroups(prev => prev.map(g => ({
              ...g,
              employees: g.employees.map(emp => emp.id === employeeId ? { ...emp, is_active: currentStatus } : emp)
            })));
            throw error;
          }
        } catch (error) {
          console.error('Error toggling employee status:', formatSupabaseError(error));
        }
      }
    });
  }, []);

  const toggleVerification = useCallback(async (employeeId: string, currentStatus: boolean, employeeUsername: string, employeeDisplayId: string) => {
    const newStatus = !currentStatus;
    setConfirmDialog({
      show: true,
      title: `${newStatus ? '驗證' : '取消驗證'}員工`,
      message: `確定要${newStatus ? '驗證' : '取消驗證'}此員工帳戶嗎？`,
      employeeUsername,
      employeeId: employeeDisplayId,
      variant: 'verification',
      nextStatus: newStatus,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          setEmployeeGroups(prev => prev.map(g => ({
            ...g,
            employees: g.employees.map(emp => emp.id === employeeId ? { ...emp, is_verified: newStatus } : emp)
          })));
          const { error: userError } = await supabase.rpc('admin_update_employee_account', {
            p_admin_session_token: getAdminFinancialSessionToken(),
            p_user_id: employeeId,
            p_updates: { is_verified: newStatus },
          });
          if (userError) throw userError;
          if (!newStatus) {
            await supabase.from('verification_requests').delete().eq('user_id', employeeId).eq('status', 'approved');
          }
        } catch (error) {
          console.error('Error toggling verification:', formatSupabaseError(error));
          setEmployeeGroups(prev => prev.map(g => ({
            ...g,
            employees: g.employees.map(emp => emp.id === employeeId ? { ...emp, is_verified: currentStatus } : emp)
          })));
        }
      }
    });
  }, []);

  const handleResetPassword = async (employeeId: string) => {
    if (newPassword.length < 6) {
      setNotification({ show: true, type: 'warning', title: '輸入無效', message: '密碼至少需要 6 個字元' });
      return;
    }

    setResettingPassword(true);
    try {
      const { data, error } = await supabase.rpc('admin_reset_employee_password', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_user_id: employeeId,
        p_new_password: newPassword,
      });
      if (error) throw error;
      if (!data) throw new Error('沒有資料列被更新。');
      setShowPasswordReset(null);
      setNewPassword('');
      setShowResetPassword(false);
      setNotification({ show: true, type: 'success', title: '成功', message: '密碼重設成功' });
    } catch (error: unknown) {
      if (isFinancialAdminSessionError(error)) {
        void logout(false);
        return;
      }

      setNotification({ show: true, type: 'error', title: '錯誤', message: formatSupabaseError(error) || '重設密碼失敗' });
    } finally {
      setResettingPassword(false);
    }
  };

  const toggleGroup = (adminId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(adminId)) next.delete(adminId);
      else next.add(adminId);
      return next;
    });
  };

  const setAllGroupsExpanded = (expanded: boolean) => {
    if (admin.role !== 'super_admin' || selectedAdminFilter !== 'all') return;
    setExpandedGroups(expanded ? new Set(employeeGroups.map(group => group.admin.id)) : new Set());
  };

  const handleUpdateEmployee = async (employeeId: string, updates: Partial<EmployeeWithAdmin>) => {
    try {
      setEmployeeGroups(prev => prev.map(g => ({
        ...g,
        employees: g.employees.map(emp => emp.id === employeeId ? { ...emp, ...updates } : emp)
      })));
      const allowedUpdates = Object.fromEntries(
        Object.entries(updates).filter(([key, value]) =>
          value !== undefined
          && ['username', 'employee_id', 'is_verified', 'is_active', 'remarks', 'tags', 'is_pinned', 'created_at'].includes(key)
        ),
      );
      const { error } = await supabase.rpc('admin_update_employee_account', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_user_id: employeeId,
        p_updates: allowedUpdates,
      });
      if (error) throw error;
      setEditingEmployee(null);
    } catch (error) {
      console.error('Error updating employee:', formatSupabaseError(error));
      setNotification({ show: true, type: 'error', title: '錯誤', message: '更新員工資料失敗' });
      guardedLoadEmployeesRef.current?.(true);
    }
  };

  const handleDeleteEmployee = async (employee: EmployeeWithAdmin) => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const { data, error } = await supabase.rpc('admin_delete_employee_account', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_user_id: employee.id,
      });
      if (error) throw new Error(formatSupabaseError(error) || '發生資料庫錯誤');
      if (!data) throw new Error('無法刪除員工。');
      setEmployeeGroups(prev => prev.map(g => ({
        ...g,
        employees: g.employees.filter(emp => emp.id !== employee.id)
      })).filter(g => g.employees.length > 0 || g.admin.role === 'super_admin' || g.admin.role === 'secondary_admin'));
      setDeletingEmployee(null);
      setDeleteError(null);
    } catch (error: unknown) {
      setDeleteError(formatSupabaseError(error) || '刪除員工失敗。');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSort = (adminId: string, field: SortField) => {
    const group = employeeGroups.find(item => item.admin.id === adminId);
    if (group?.employees.some(employee => !employee.statsLoaded)) return;

    setSortByGroup(prev => {
      const newMap = new Map(prev);
      const current = newMap.get(adminId);
      if (current?.sortBy === field) {
        if (current.sortDirection === 'desc') {
          newMap.set(adminId, { sortBy: field, sortDirection: 'asc' });
        } else {
          newMap.delete(adminId);
        }
      } else {
        newMap.set(adminId, { sortBy: field, sortDirection: 'desc' });
      }
      return newMap;
    });
  };

  const getSortIcon = (adminId: string, field: SortField) => {
    const s = sortByGroup.get(adminId);
    if (!s || s.sortBy !== field) return <ArrowUpDown className="h-3.5 w-3.5 text-white" />;
    if (s.sortDirection === 'desc') return <ArrowDown className="h-3.5 w-3.5 text-white" />;
    return <ArrowUp className="h-3.5 w-3.5 text-white" />;
  };

  const clearPendingWithdrawalFilter = (adminId: string) => {
    setPendingWithdrawalFilterByGroup(prev => {
      if (!prev.has(adminId)) return prev;
      const next = new Set(prev);
      next.delete(adminId);
      return next;
    });
  };

  const handleSearchTermChange = (nextTerm: string) => {
    const wasSearching = searchTerm.trim().length > 0;
    const isSearching = nextTerm.trim().length > 0;

    if (!wasSearching && isSearching) {
      expandedGroupsBeforeSearchRef.current = new Set(expandedGroups);
    } else if (wasSearching && !isSearching) {
      const previousExpandedGroups = expandedGroupsBeforeSearchRef.current;
      if (previousExpandedGroups) {
        setExpandedGroups(new Set(previousExpandedGroups));
      }
      expandedGroupsBeforeSearchRef.current = null;
    }

    setSearchTerm(nextTerm);
  };

  const resetEmployeeListFilters = (adminId: string) => {
    handleSearchTermChange('');
    setResetFeedbackAdminId(adminId);
    if (resetFeedbackTimeoutRef.current) clearTimeout(resetFeedbackTimeoutRef.current);
    resetFeedbackTimeoutRef.current = setTimeout(() => {
      setResetFeedbackAdminId(currentId => currentId === adminId ? null : currentId);
      resetFeedbackTimeoutRef.current = null;
    }, 900);
    setSortByGroup(prev => {
      const next = new Map(prev);
      next.delete(adminId);
      return next;
    });
    setActiveFilterByGroup(prev => {
      const next = new Map(prev);
      next.delete(adminId);
      return next;
    });
    setWorkStatusFilterByGroup(prev => {
      const next = new Map(prev);
      next.delete(adminId);
      return next;
    });
    setInactiveDaysFilterByGroup(prev => {
      const next = new Map(prev);
      next.delete(adminId);
      return next;
    });
    setPendingWithdrawalFilterByGroup(prev => {
      const next = new Set(prev);
      next.delete(adminId);
      return next;
    });
    setSummaryFilterByGroup(prev => {
      const next = new Map(prev);
      next.delete(adminId);
      return next;
    });
    setSelectedTagsByGroup(prev => {
      const next = new Map(prev);
      next.delete(adminId);
      return next;
    });
    setInactiveDaysDropdownOpen(null);
    setIdleDaysDropdownPos(null);
  };

  const handleActiveFilter = (adminId: string, filter: 'all' | 'active' | 'inactive') => {
    clearPendingWithdrawalFilter(adminId);
    setActiveFilterByGroup(prev => {
      const newMap = new Map(prev);
      if (filter === 'all') newMap.delete(adminId);
      else newMap.set(adminId, filter);
      return newMap;
    });
  };

  const getActiveFilter = (adminId: string): 'all' | 'active' | 'inactive' => activeFilterByGroup.get(adminId) || 'all';

  const handleWorkStatusFilter = (adminId: string, status: 'online' | 'offline' | 'never_started') => {
    clearPendingWithdrawalFilter(adminId);
    setWorkStatusFilterByGroup(prev => {
      const newMap = new Map(prev);
      const current = newMap.get(adminId) || new Set<'online' | 'offline' | 'never_started'>();
      const updated = new Set(current);
      if (updated.has(status)) updated.delete(status);
      else updated.add(status);
      if (updated.size === 0) newMap.delete(adminId);
      else newMap.set(adminId, updated);
      return newMap;
    });
  };

  const getWorkStatusFilter = (adminId: string): Set<'online' | 'offline' | 'never_started'> => workStatusFilterByGroup.get(adminId) || new Set();

  const handleSummaryFilter = (adminId: string, filter: SummaryFilter) => {
    clearPendingWithdrawalFilter(adminId);
    setSummaryFilterByGroup(prev => {
      const next = new Map(prev);
      if (next.get(adminId) === filter) next.delete(adminId);
      else next.set(adminId, filter);
      return next;
    });
  };

  const getSummaryFilter = (adminId: string): SummaryFilter | null => summaryFilterByGroup.get(adminId) || null;

  const togglePin = async (employeeId: string, currentPinned: boolean) => {
    const newPinned = !currentPinned;
    setEmployeeGroups(prev => prev.map(g => ({
      ...g,
      employees: g.employees.map(emp => emp.id === employeeId ? { ...emp, is_pinned: newPinned } : emp)
    })));
    try {
      const { error } = await supabase.rpc('admin_update_employee_account', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_user_id: employeeId,
        p_updates: { is_pinned: newPinned },
      });
      if (error) throw error;
    } catch {
      setEmployeeGroups(prev => prev.map(g => ({
        ...g,
        employees: g.employees.map(emp => emp.id === employeeId ? { ...emp, is_pinned: currentPinned } : emp)
      })));
    }
  };

  const toggleAdminPin = async (adminId: string, currentPinned: boolean) => {
    if (pinningAdminId) return;

    const newPinned = !currentPinned;
    setPinningAdminId(adminId);
    setAdminPinOverrides(prev => {
      const next = new Map(prev);
      next.set(adminId, newPinned);
      return next;
    });

    try {
      const { error } = await supabase.rpc('admin_update_admin_account', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_target_admin_id: adminId,
        p_updates: { is_pinned: newPinned },
      });
      if (error) throw error;
    } catch {
      setAdminPinOverrides(prev => {
        const next = new Map(prev);
        next.delete(adminId);
        return next;
      });
    } finally {
      setPinningAdminId(null);
    }
  };

  const handleAddTag = async (employee: EmployeeWithAdmin) => {
    if (!newTag.trim()) return;
    const updatedTags = [...(employee.tags || []), newTag.trim()];
    const tagToAdd = newTag.trim();
    setEmployeeGroups(prev => prev.map(g => ({
      ...g,
      employees: g.employees.map(emp => emp.id === employee.id ? { ...emp, tags: updatedTags } : emp)
    })));
    if (editingTags && editingTags.id === employee.id) setEditingTags({ ...editingTags, tags: updatedTags });
    setNewTag('');
    try {
      const { error } = await supabase.rpc('admin_update_employee_account', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_user_id: employee.id,
        p_updates: { tags: updatedTags },
      });
      if (error) throw error;
    } catch {
      const originalTags = employee.tags || [];
      setEmployeeGroups(prev => prev.map(g => ({
        ...g,
        employees: g.employees.map(emp => emp.id === employee.id ? { ...emp, tags: originalTags } : emp)
      })));
      if (editingTags && editingTags.id === employee.id) setEditingTags({ ...editingTags, tags: originalTags });
      setNewTag(tagToAdd);
    }
  };

  const handleRemoveTag = async (employee: EmployeeWithAdmin, tagToRemove: string) => {
    const updatedTags = (employee.tags || []).filter(tag => tag !== tagToRemove);
    const originalTags = employee.tags || [];
    setEmployeeGroups(prev => prev.map(g => ({
      ...g,
      employees: g.employees.map(emp => emp.id === employee.id ? { ...emp, tags: updatedTags } : emp)
    })));
    if (editingTags && editingTags.id === employee.id) setEditingTags({ ...editingTags, tags: updatedTags });
    try {
      const { error } = await supabase.rpc('admin_update_employee_account', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_user_id: employee.id,
        p_updates: { tags: updatedTags },
      });
      if (error) throw error;
    } catch {
      setEmployeeGroups(prev => prev.map(g => ({
        ...g,
        employees: g.employees.map(emp => emp.id === employee.id ? { ...emp, tags: originalTags } : emp)
      })));
      if (editingTags && editingTags.id === employee.id) setEditingTags({ ...editingTags, tags: originalTags });
    }
  };

  const getGroupTags = (groupId: string) => {
    const group = employeeGroups.find(g => g.admin.id === groupId);
    if (!group) return [];
    const tagsSet = new Set<string>();
    group.employees.forEach(emp => (emp.tags || []).forEach(tag => tagsSet.add(tag)));
    return Array.from(tagsSet).sort();
  };

  const getSelectedTagsForGroup = (groupId: string): string[] => selectedTagsByGroup.get(groupId) || [];

  const setSelectedTagsForGroup = (groupId: string, tags: string[]) => {
    setSelectedTagsByGroup(prev => {
      const newMap = new Map(prev);
      if (tags.length === 0) newMap.delete(groupId);
      else newMap.set(groupId, tags);
      return newMap;
    });
  };

  const sortEmployees = useCallback((employees: EmployeeWithAdmin[], adminId: string) => {
    const sorted = [...employees];
    const groupSort = sortByGroup.get(adminId);
    sorted.sort((a, b) => {
      if (a.is_pinned && !b.is_pinned) return -1;
      if (!a.is_pinned && b.is_pinned) return 1;
      if (groupSort?.sortBy) {
        if (groupSort.sortBy === 'created_at') {
          const aVal = a.created_at ? new Date(a.created_at).getTime() : 0;
          const bVal = b.created_at ? new Date(b.created_at).getTime() : 0;
          return groupSort.sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
        }
        const getSortValue = (employee: EmployeeWithAdmin) => {
          const values: Partial<Record<SortField, number>> = {
            totalOrders: employee.totalOrders,
            todayOrders: employee.todayOrders,
            todayCompletedOrders: employee.todayCompletedOrders,
            failedOrders: employee.failedOrders,
            walletBalance: employee.walletBalance,
            accountBalance: employee.accountBalance,
            todayCommission: employee.todayCommission,
            totalWorkMinutes: employee.totalWorkMinutes,
            todayWorkMinutes: employee.todayWorkMinutes,
            workDays: employee.workDays,
          };
          return values[groupSort.sortBy!] || 0;
        };
        const aVal = getSortValue(a);
        const bVal = getSortValue(b);
        return groupSort.sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }
      return 0;
    });
    return sorted;
  }, [sortByGroup]);

  const getFilteredEmployeesForGroup = useCallback((group: EmployeeGroup) => {
    const selectedTags = selectedTagsByGroup.get(group.admin.id) || [];
    const activeFilter = activeFilterByGroup.get(group.admin.id) || 'all';
    const workStatusFilter = workStatusFilterByGroup.get(group.admin.id) || new Set<'online' | 'offline' | 'never_started'>();
    const summaryFilter = summaryFilterByGroup.get(group.admin.id) || null;
    const searchLower = searchTerm.toLowerCase();
    const today = new Date();
    const now = Date.now();

    return sortEmployees(
      group.employees.filter((emp) => {
        const matchesSearch = !searchTerm ||
          emp.username.toLowerCase().includes(searchLower) ||
          emp.employee_id.toLowerCase().includes(searchLower) ||
          (emp.verification?.real_name && emp.verification.real_name.toLowerCase().includes(searchLower)) ||
          (emp.verification?.phone && emp.verification.phone.includes(searchTerm)) ||
          (emp.verification?.email && emp.verification.email.toLowerCase().includes(searchLower)) ||
          (emp.verification?.wallet_address && emp.verification.wallet_address.toLowerCase().includes(searchLower));

        const matchesTags = selectedTags.length === 0 ||
          selectedTags.some(tag => (emp.tags || []).includes(tag));

        const matchesActive =
          activeFilter === 'all' ? true :
          activeFilter === 'active' ? emp.is_active === true :
          emp.is_active === false;

        const matchesWorkStatus = workStatusFilter.size === 0 || workStatusFilter.has(emp.workStatus);
        const matchesSummary = !summaryFilter ||
          (summaryFilter === 'today_working' && emp.todayWorkMinutes > 0) ||
          (summaryFilter === 'new_today' && Boolean(emp.created_at) && new Date(emp.created_at).toDateString() === today.toDateString()) ||
          (summaryFilter === 'currently_working' && emp.workStatus === 'online');

        const inactiveDaysRange = inactiveDaysFilterByGroup.get(group.admin.id);
        const matchesInactiveDays = !inactiveDaysRange || (() => {
          if (emp.workStatus !== 'never_started' || !emp.created_at) return false;
          const ageDays = (now - new Date(emp.created_at).getTime()) / (1000 * 60 * 60 * 24);
          switch (inactiveDaysRange) {
            case '2-3': return ageDays > 2 && ageDays <= 3;
            case '3-7': return ageDays > 3 && ageDays <= 7;
            case '7-15': return ageDays > 7 && ageDays <= 15;
            case '15+': return ageDays > 15;
            default: return true;
          }
        })();

        const matchesPendingWithdrawal = !pendingWithdrawalFilterByGroup.has(group.admin.id) || emp.hasPendingWithdrawal;

        return matchesSearch && matchesTags && matchesActive && matchesWorkStatus && matchesSummary && matchesInactiveDays && matchesPendingWithdrawal;
      }),
      group.admin.id
    );
  }, [
    activeFilterByGroup,
    inactiveDaysFilterByGroup,
    pendingWithdrawalFilterByGroup,
    searchTerm,
    selectedTagsByGroup,
    sortEmployees,
    summaryFilterByGroup,
    workStatusFilterByGroup,
  ]);
  const filteredEmployeeGroups = useMemo(() => employeeGroups.map(group => ({
    ...group,
    employees: getFilteredEmployeesForGroup(group)
  })).filter(group => {
    if (admin.role === 'super_admin' && selectedAdminFilter !== 'all') {
      return group.admin.id === selectedAdminFilter;
    }
    return group.admin.role === 'secondary_admin' || group.admin.role === 'super_admin' || group.employees.length > 0;
  }), [
    employeeGroups,
    admin.role,
    selectedAdminFilter,
    getFilteredEmployeesForGroup,
  ]);

  const filteredGroups = useMemo(() => {
    if (adminPinOverrides.size === 0) return filteredEmployeeGroups;

    const groupsWithOverrides = filteredEmployeeGroups.map(group => {
      const override = adminPinOverrides.get(group.admin.id);
      return override === undefined || override === group.admin.is_pinned
        ? group
        : { ...group, admin: { ...group.admin, is_pinned: override } };
    });

    return [...groupsWithOverrides].sort((a, b) => {
      if (a.admin.role === 'super_admin' && b.admin.role !== 'super_admin') return -1;
      if (a.admin.role !== 'super_admin' && b.admin.role === 'super_admin') return 1;
      if (a.admin.role === 'secondary_admin' && b.admin.role === 'secondary_admin') {
        if (a.admin.is_pinned && !b.admin.is_pinned) return -1;
        if (!a.admin.is_pinned && b.admin.is_pinned) return 1;
      }
      return a.admin.username.localeCompare(b.admin.username);
    });
  }, [filteredEmployeeGroups, adminPinOverrides]);

  useEffect(() => {
    if (!searchTerm) return;
    const groupsWithMatches = filteredEmployeeGroups
      .filter(group => group.employees.length > 0)
      .map(group => group.admin.id);
    setExpandedGroups(prev => {
      if (prev.size === groupsWithMatches.length && groupsWithMatches.every(groupId => prev.has(groupId))) return prev;
      return new Set(groupsWithMatches);
    });
  }, [searchTerm, filteredEmployeeGroups]);

  const flatFilteredEmployees = admin.role === 'secondary_admin' && filteredGroups.length > 0
    ? filteredGroups[0].employees
    : [];

  const flatAdminId = admin.id;

  useLayoutEffect(() => {
    employeeGroupsScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [selectedAdminFilter]);

  const navigateGroupPanel = (direction: -1 | 1) => {
    if (admin.role !== 'super_admin' || selectedAdminFilter !== 'all') return;

    const container = employeeGroupsScrollRef.current;
    if (!container || filteredGroups.length === 0) return;

    const panelsById = new Map(
      Array.from(container.querySelectorAll<HTMLElement>('[data-admin-group-id]'))
        .map(panel => [panel.dataset.adminGroupId, panel] as const)
    );
    const panels = filteredGroups
      .map(group => panelsById.get(group.admin.id))
      .filter((panel): panel is HTMLElement => Boolean(panel));
    if (panels.length === 0) return;

    const containerRect = container.getBoundingClientRect();
    const panelTops = panels.map(panel =>
      panel.getBoundingClientRect().top - containerRect.top + container.scrollTop
    );
    const currentIndex = panelTops.reduce(
      (index, top, panelIndex) => top <= container.scrollTop + 32 ? panelIndex : index,
      0
    );
    const nextIndex = Math.max(0, Math.min(panels.length - 1, currentIndex + direction));

    container.scrollTo({ top: panelTops[nextIndex], behavior: 'smooth' });
  };

  // ===== Render helpers =====

  const renderEmployeeStat = useCallback((employee: EmployeeWithAdmin, value: ReactNode) => (
    employee.statsLoaded ? value : <span className="text-slate-500" title="統計資料載入中">—</span>
  ), []);

  const renderWorkStatusBadge = useCallback((status: 'online' | 'offline' | 'never_started') => {
    if (status === 'online') {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-green-500/20 border border-green-500/50">
          <span className="w-1 h-1 rounded-full bg-green-400" />
          <span className="text-xs font-medium text-green-400">上線</span>
        </span>
      );
    }
    if (status === 'offline') {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500/20 border border-red-500/50">
          <span className="w-1 h-1 rounded-full bg-red-400" />
          <span className="text-xs font-medium text-red-400">離線</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-slate-500/20 border border-slate-500/50">
        <span className="w-1 h-1 rounded-full bg-slate-400" />
        <span className="text-xs font-medium text-slate-400">新人</span>
      </span>
    );
  }, []);

  const renderSummaryFilterButton = (
    adminId: string,
    filter: SummaryFilter,
    label: string,
    count: number,
  ) => {
    const isSelected = getSummaryFilter(adminId) === filter;
    const styles: Record<SummaryFilter, { active: string; inactive: string; dot: string }> = {
      today_working: {
        active: 'border-emerald-300 bg-emerald-500/85 text-white shadow-md shadow-emerald-950/50 ring-1 ring-emerald-300/35',
        inactive: 'border-emerald-500/50 bg-emerald-950/45 text-emerald-300 hover:border-emerald-300/75 hover:bg-emerald-900/70 hover:text-emerald-100',
        dot: 'bg-emerald-400',
      },
      new_today: {
        active: 'border-sky-300 bg-sky-500/85 text-white shadow-md shadow-sky-950/50 ring-1 ring-sky-300/35',
        inactive: 'border-sky-500/50 bg-sky-950/45 text-sky-300 hover:border-sky-300/75 hover:bg-sky-900/70 hover:text-sky-100',
        dot: 'bg-sky-400',
      },
      currently_working: {
        active: 'border-green-300 bg-green-500/85 text-white shadow-md shadow-green-950/50 ring-1 ring-green-300/35',
        inactive: 'border-green-500/50 bg-green-950/45 text-green-300 hover:border-green-300/75 hover:bg-green-900/70 hover:text-green-100',
        dot: 'bg-green-400',
      },
    };
    const style = styles[filter];

    return (
      <button
        type="button"
        onClick={() => handleSummaryFilter(adminId, filter)}
        aria-pressed={isSelected}
        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold tabular-nums transition-all duration-150 ${
          isSelected ? style.active : style.inactive
        }`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${isSelected ? 'bg-white' : style.dot}`} />
        {label}: {count}
      </button>
    );
  };

  const renderSortableHeader = (adminId: string, field: SortField, label: string, widthClass = '') => {
    const sortState = sortByGroup.get(adminId);
    const isActive = sortState?.sortBy === field;
    const activeStyles = !isActive
      ? 'text-white hover:bg-blue-500 hover:text-white'
      : sortState?.sortDirection === 'desc'
        ? 'bg-emerald-600 font-bold text-white'
        : 'bg-rose-600 font-bold text-white';

    return (
      <th className={`h-[40px] p-0 text-center text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap ${widthClass}`}>
        <button
          type="button"
          onClick={() => handleSort(adminId, field)}
          className={`flex h-full min-h-0 w-full flex-col items-center justify-center gap-0.5 rounded-none px-1 leading-none transition-all ${activeStyles}`}
        >
          <span>{label}</span>
          <span className="inline-flex h-3.5 items-center justify-center">{getSortIcon(adminId, field)}</span>
        </button>
      </th>
    );
  };

  const [idleDaysDropdownPos, setIdleDaysDropdownPos] = useState<{ top: number; left: number } | null>(null);

  const renderIdleDaysPortal = (adminId: string) => {
    if (inactiveDaysDropdownOpen !== adminId || !idleDaysDropdownPos) return null;
    const items = [
      { key: '2-3' as InactiveDaysRange, label: '2～3 天', accent: 'bg-sky-400', badge: 'border-sky-400/35 bg-sky-500/10 text-sky-200' },
      { key: '3-7' as InactiveDaysRange, label: '3～7 天', accent: 'bg-emerald-400', badge: 'border-emerald-400/35 bg-emerald-500/10 text-emerald-200' },
      { key: '7-15' as InactiveDaysRange, label: '7～15 天', accent: 'bg-amber-400', badge: 'border-amber-400/35 bg-amber-500/10 text-amber-200' },
      { key: '15+' as InactiveDaysRange, label: '15 天以上', accent: 'bg-rose-400', badge: 'border-rose-400/35 bg-rose-500/10 text-rose-200' },
    ];
    return createPortal(
      <div
        data-inactive-days-dropdown
        className="fixed z-[9999]"
        style={{ top: idleDaysDropdownPos.top, left: idleDaysDropdownPos.left }}
      >
        <div className="w-[156px] overflow-hidden rounded-xl border border-[#4d8b5c] bg-[#07150b] shadow-2xl shadow-black/70 ring-1 ring-inset ring-emerald-200/10">
          <div role="menu" aria-label="停工天数篩選" className="space-y-1 bg-[#07150b] p-1.5">
            {items.map(({ key, label, accent, badge }, index) => {
              const isSelected = inactiveDaysFilterByGroup.get(adminId) === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isSelected}
                  onClick={() => {
                    clearPendingWithdrawalFilter(adminId);
                    setInactiveDaysFilterByGroup(prev => {
                      const newMap = new Map(prev);
                      if (isSelected) newMap.delete(adminId);
                      else newMap.set(adminId, key);
                      return newMap;
                    });
                    setInactiveDaysDropdownOpen(null);
                    setIdleDaysDropdownPos(null);
                  }}
                  className={`group relative flex h-8 w-full items-center gap-2 overflow-hidden rounded-lg border px-2 text-left text-[11px] font-semibold transition-all duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 ${
                    isSelected
                      ? 'border-emerald-300/80 bg-gradient-to-r from-emerald-700 to-green-600 text-white shadow-md shadow-emerald-950/40'
                      : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <span className={`absolute bottom-1.5 left-0 top-1.5 w-1 rounded-r-full ${isSelected ? 'bg-emerald-100' : accent}`} />
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[10px] font-bold tabular-nums ${isSelected ? 'border-white/30 bg-white/15 text-white' : badge}`}>
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {isSelected ? (
                    <CheckCircle className="h-3.5 w-3.5 shrink-0 text-emerald-100" />
                  ) : (
                    <span className={`h-2 w-2 shrink-0 rounded-full border-2 border-[#07150b] ${accent}`} />
                  )}
                </button>
              );
            })}
          </div>
          {inactiveDaysFilterByGroup.has(adminId) && (
            <div className="border-t border-[#1b4a2a] bg-[#0a1d11] p-1.5">
              <button
                type="button"
                onClick={() => {
                  setInactiveDaysFilterByGroup(prev => {
                    const newMap = new Map(prev);
                    newMap.delete(adminId);
                    return newMap;
                  });
                  setInactiveDaysDropdownOpen(null);
                  setIdleDaysDropdownPos(null);
                }}
                className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-rose-400/45 bg-rose-950/75 px-2 text-[11px] font-semibold text-rose-200 transition-all hover:border-rose-300/75 hover:bg-rose-900/80 hover:text-rose-100 active:scale-[0.98] active:bg-rose-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50"
              >
                <X className="h-3.5 w-3.5" />
                清除篩選
              </button>
            </div>
          )}
        </div>
      </div>,
      document.body
    );
  };

  const handleIdleDaysClick = (adminId: string, e: React.MouseEvent<HTMLButtonElement>) => {
    if (inactiveDaysDropdownOpen === adminId) {
      setInactiveDaysDropdownOpen(null);
      setIdleDaysDropdownPos(null);
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      const menuWidth = 156;
      const menuHeight = 204;
      const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - menuWidth - 8));
      const top = window.innerHeight - rect.bottom < menuHeight + 8
        ? Math.max(8, rect.top - menuHeight - 6)
        : rect.bottom + 6;
      setIdleDaysDropdownPos({ top, left });
      setInactiveDaysDropdownOpen(adminId);
    }
  };

  const renderStatusFilterButtons = (adminId: string) => {
    const groupEmployees = employeeGroups.find(group => group.admin.id === adminId)?.employees || [];
    if (groupEmployees.some(employee => !employee.statsLoaded)) {
      return <span className="px-2 text-[10px] font-medium text-slate-500">統計資料載入中……</span>;
    }

    const currentActive = getActiveFilter(adminId);
    const currentWorkStatus = getWorkStatusFilter(adminId);
    const hasIdleFilter = inactiveDaysFilterByGroup.has(adminId);
    const hasPendingFilter = pendingWithdrawalFilterByGroup.has(adminId);
    const pendingWithdrawalCount = groupEmployees.filter(employee => employee.hasPendingWithdrawal).length;

    const on = 'text-white font-semibold shadow-md border border-transparent';
    const dim = 'bg-slate-800/60 border border-slate-600/50 font-medium';

    return (
      <div className="flex gap-1 flex-wrap items-center">
        {/* Account status: ALL / Active / Off */}
        <button
          onClick={() => handleActiveFilter(adminId, 'all')}
          className={`px-2 py-0.5 rounded text-[11px] transition-all ${
            currentActive === 'all'
              ? `bg-blue-500 ${on}`
              : `${dim} text-slate-400 hover:text-blue-300 hover:border-blue-500/40`
          }`}
        >全部</button>
        <button
          onClick={() => handleActiveFilter(adminId, 'active')}
          className={`px-2 py-0.5 rounded text-[11px] transition-all flex items-center gap-1 ${
            currentActive === 'active'
              ? `bg-emerald-500 ${on}`
              : `${dim} text-slate-400 hover:text-emerald-300 hover:border-emerald-500/40`
          }`}
        >
          <span className={`w-1 h-1 rounded-full ${currentActive === 'active' ? 'bg-white' : 'bg-emerald-600'}`} />
          啟用
        </button>
        <button
          onClick={() => handleActiveFilter(adminId, 'inactive')}
          className={`px-2 py-0.5 rounded text-[11px] transition-all flex items-center gap-1 ${
            currentActive === 'inactive'
              ? `bg-red-500 ${on}`
              : `${dim} text-slate-400 hover:text-red-300 hover:border-red-500/40`
          }`}
        >
          <span className={`w-1 h-1 rounded-full ${currentActive === 'inactive' ? 'bg-white' : 'bg-red-600'}`} />
          停用
        </button>

        <div className="w-px h-4 bg-slate-600 shrink-0 mx-1" />

        {/* Work status: ALL / Online / Offline / Never Started */}
        <button
          onClick={() => {
            clearPendingWithdrawalFilter(adminId);
            setWorkStatusFilterByGroup(prev => {
              const newMap = new Map(prev);
              newMap.delete(adminId);
              return newMap;
            });
          }}
          className={`px-2 py-0.5 rounded text-[11px] transition-all ${
            currentWorkStatus.size === 0
              ? `bg-blue-500 ${on}`
              : `${dim} text-slate-400 hover:text-blue-300 hover:border-blue-500/40`
          }`}
        >全部</button>
        <button
          onClick={() => handleWorkStatusFilter(adminId, 'online')}
          className={`px-2 py-0.5 rounded text-[11px] transition-all flex items-center gap-1 ${
            currentWorkStatus.has('online')
              ? `bg-green-500 ${on}`
              : `${dim} text-slate-400 hover:text-green-300 hover:border-green-500/40`
          }`}
        >
          <span className={`w-1 h-1 rounded-full ${currentWorkStatus.has('online') ? 'bg-white' : 'bg-green-600'}`} />
          上線
        </button>
        <button
          onClick={() => handleWorkStatusFilter(adminId, 'offline')}
          className={`px-2 py-0.5 rounded text-[11px] transition-all flex items-center gap-1 ${
            currentWorkStatus.has('offline')
              ? `bg-red-500 ${on}`
              : `${dim} text-slate-400 hover:text-red-300 hover:border-red-500/40`
          }`}
        >
          <span className={`w-1 h-1 rounded-full ${currentWorkStatus.has('offline') ? 'bg-white' : 'bg-red-600'}`} />
          離線
        </button>
        <button
          onClick={() => handleWorkStatusFilter(adminId, 'never_started')}
          className={`px-2 py-0.5 rounded text-[11px] transition-all flex items-center gap-1 ${
            currentWorkStatus.has('never_started')
              ? `bg-amber-500 ${on}`
              : `${dim} text-slate-400 hover:text-amber-300 hover:border-amber-500/40`
          }`}
        >
          <span className={`w-1 h-1 rounded-full ${currentWorkStatus.has('never_started') ? 'bg-white' : 'bg-amber-600'}`} />
          從未開始
        </button>

        <div className="w-px h-4 bg-slate-600 shrink-0 mx-1" />

        {/* Withdrawing */}
        <div className="ml-2 inline-flex items-center">
          <button
            onClick={() => {
              setPendingWithdrawalFilterByGroup(prev => {
                const next = new Set(prev);
                if (next.has(adminId)) next.delete(adminId);
                else next.add(adminId);
                return next;
              });
            }}
            aria-pressed={hasPendingFilter}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold shadow-md transition-all ${
              hasPendingFilter
                ? 'border-orange-200 bg-orange-500 text-white shadow-orange-950/50 ring-1 ring-orange-300/40'
                : 'border-orange-500/70 bg-orange-950/55 text-orange-200 shadow-orange-950/30 hover:border-orange-300/90 hover:bg-orange-900/75 hover:text-orange-50'
            }`}
          >
            <Wallet className="h-3.5 w-3.5" />
            <span>提現中</span>
            <span className={`min-w-[20px] rounded-full border px-1.5 py-0.5 text-center text-[10px] tabular-nums leading-none ${
              hasPendingFilter
                ? 'border-white/30 bg-white/20 text-white'
                : 'border-orange-400/40 bg-orange-500/20 text-orange-300'
            }`}>
              {pendingWithdrawalCount}
            </span>
          </button>
        </div>

        {/* Idle Days */}
        <div data-inactive-days-dropdown className="ml-2 inline-flex items-center">
          <div className={`inline-flex h-8 w-[156px] shrink-0 overflow-hidden rounded-lg border shadow-sm transition-all ${
            hasIdleFilter
              ? 'border-emerald-400/90 bg-emerald-900/90 shadow-emerald-950/40'
              : inactiveDaysDropdownOpen === adminId
                ? 'border-emerald-500/80 bg-emerald-950 shadow-emerald-950/30'
                : 'border-emerald-700/70 bg-slate-900 hover:border-emerald-500/80 hover:bg-emerald-950'
          }`}>
            <button
              type="button"
              onClick={(e) => handleIdleDaysClick(adminId, e)}
              aria-haspopup="menu"
              aria-expanded={inactiveDaysDropdownOpen === adminId}
              className={`flex h-full min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap px-2.5 text-[11px] font-semibold transition-all active:scale-[0.98] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70 ${
                hasIdleFilter
                  ? 'bg-emerald-800 text-emerald-50 hover:bg-emerald-700'
                  : inactiveDaysDropdownOpen === adminId
                    ? 'bg-emerald-950 text-emerald-100'
                    : 'text-emerald-200 hover:bg-emerald-950 hover:text-emerald-100'
              }`}
            >
              <Timer className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate">
                {hasIdleFilter
                  ? (() => {
                      const r = inactiveDaysFilterByGroup.get(adminId);
                      return r === '2-3' ? '2-3d' : r === '3-7' ? '3-7d' : r === '7-15' ? '7-15d' : '15d+';
                    })()
                  : '停工天数'
                }
              </span>
              <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${inactiveDaysDropdownOpen === adminId ? 'rotate-180' : ''}`} />
            </button>
            {hasIdleFilter && (
              <button
                type="button"
                onClick={() => {
                  setInactiveDaysFilterByGroup(prev => {
                    const next = new Map(prev);
                    next.delete(adminId);
                    return next;
                  });
                  setInactiveDaysDropdownOpen(null);
                  setIdleDaysDropdownPos(null);
                }}
                aria-label="清除停工天数篩選"
                title="清除停工天数篩選"
                className="inline-flex h-full w-8 shrink-0 items-center justify-center border-l border-rose-200/30 bg-rose-600 text-white transition-colors hover:bg-rose-500 active:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200/80"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        {renderIdleDaysPortal(adminId)}
        <button
          type="button"
          onClick={() => resetEmployeeListFilters(adminId)}
          title="取消全部选中"
          aria-label="取消全部选中"
          className={`ml-3 inline-flex h-8 min-w-[142px] items-center justify-center gap-1.5 rounded-lg border border-blue-300/80 px-3.5 py-1 text-[11px] font-semibold text-white shadow-sm transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/70 ${
            resetFeedbackAdminId === adminId
              ? 'bg-emerald-600 shadow-emerald-950/40'
              : 'bg-blue-700 shadow-blue-950/30 hover:bg-blue-500 hover:text-white active:bg-blue-900'
          }`}
        >
          {resetFeedbackAdminId === adminId ? (
            <>
              <CheckCircle className="h-3.5 w-3.5" />
              <span>完成</span>
            </>
          ) : (
            <>
              <RefreshCw className="h-3.5 w-3.5" />
              <span>取消全部选中</span>
            </>
          )}
        </button>
      </div>
    );
  };

  const handleViewLoginIP = useCallback(async (employee: { id: string; username: string; employeeId?: string }) => {
    setLoginIPEmployee(employee);
    setLoginIPRecords([]);
    setLoginIPActionFilter(null);
    setLoginIPLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_employee_login_history_with_device_info', {
        p_admin_id: admin.id,
        p_user_id: employee.id,
        p_limit: 10000,
        p_offset: 0
      });
      if (error) throw error;
      setLoginIPRecords((data as LoginIPRecord[]) || []);
    } catch (err) {
      console.error('Error loading login IP history:', formatSupabaseError(err));
    } finally {
      setLoginIPLoading(false);
    }
  }, [admin.id]);

  const renderLoginIPModal = () => {
    if (!loginIPEmployee) return null;
    const formatDateTime = (dateString: string) => {
      const d = new Date(dateString);
      const Y = d.getFullYear();
      const M = String(d.getMonth() + 1).padStart(2, '0');
      const D = String(d.getDate()).padStart(2, '0');
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      const s = String(d.getSeconds()).padStart(2, '0');
      return `${Y}-${M}-${D} ${h}:${m}:${s}`;
    };
    const loginRecordCount = loginIPRecords.filter(record => record.action_type === 'login').length;
    const logoutRecordCount = loginIPRecords.filter(record => record.action_type === 'logout').length;
    const displayedLoginIPRecords = loginIPActionFilter
      ? loginIPRecords.filter(record => record.action_type === loginIPActionFilter)
      : loginIPRecords;

    return createPortal(
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm" onClick={() => setLoginIPEmployee(null)}>
        <div className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-[26px] border border-cyan-200/25 bg-[#0b1724] shadow-[0_24px_90px_rgba(2,12,27,0.65)]" onClick={(e) => e.stopPropagation()}>
          <div className="relative shrink-0 overflow-hidden border-b border-white/10 px-5 py-3.5 pr-24 sm:px-6 sm:pr-24">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.16),transparent_34%),linear-gradient(115deg,rgba(15,23,42,0.96),rgba(10,31,46,0.88))]" />
            <div className="relative flex flex-wrap items-center gap-3">
              <div className="flex min-w-[240px] flex-1 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-400/10 shadow-[0_0_24px_rgba(34,211,238,0.12)]">
                  <Globe className="h-4 w-4 text-cyan-300" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase leading-4 tracking-[0.18em] text-cyan-300/90">安全活動</p>
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <h3 className="truncate text-lg font-bold leading-6 tracking-tight text-white">{loginIPEmployee.username}</h3>
                    {loginIPEmployee.employeeId && <span className="font-mono text-xs font-semibold tracking-wide text-cyan-300/90">ID: {loginIPEmployee.employeeId}</span>}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 rounded-2xl border border-white/10 bg-slate-950/55 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_10px_24px_rgba(2,12,27,0.28)] backdrop-blur-md">
                <button
                  type="button"
                  onClick={() => setLoginIPActionFilter(null)}
                  aria-pressed={loginIPActionFilter === null}
                  title="顯示全部紀錄"
                  className={`group inline-flex h-9 min-w-[84px] items-center justify-between gap-2 rounded-xl border px-2.5 outline-none transition-[background-color,border-color,box-shadow,transform] duration-200 hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-cyan-200/90 ${loginIPActionFilter === null ? 'border-white/70 bg-gradient-to-br from-white via-cyan-100 to-cyan-300 text-slate-950 shadow-[0_5px_14px_rgba(103,232,249,0.25)]' : 'border-transparent text-cyan-100/80 hover:border-cyan-300/25 hover:bg-cyan-300/10 hover:text-white'}`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className={`flex h-5 w-5 items-center justify-center rounded-lg transition-colors ${loginIPActionFilter === null ? 'bg-slate-950/15' : 'bg-cyan-300/10 group-hover:bg-cyan-300/20'}`}>
                      <History className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-[10px] font-black tracking-wide">全部</span>
                  </span>
                  <span className={`min-w-[1.5rem] rounded-lg px-1 py-1 text-center text-[11px] font-black leading-none ${loginIPActionFilter === null ? 'bg-slate-950/15' : 'bg-cyan-300/10'}`}>
                    {loginIPLoading ? '—' : loginIPRecords.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setLoginIPActionFilter((current) => current === 'login' ? null : 'login')}
                  aria-pressed={loginIPActionFilter === 'login'}
                  title="篩選登入紀錄"
                  className={`group inline-flex h-9 min-w-[84px] items-center justify-between gap-2 rounded-xl border px-2.5 outline-none transition-[background-color,border-color,box-shadow,transform] duration-200 hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-emerald-200/90 ${loginIPActionFilter === 'login' ? 'border-emerald-100/80 bg-gradient-to-br from-emerald-200 via-emerald-300 to-teal-400 text-slate-950 shadow-[0_5px_14px_rgba(52,211,153,0.24)]' : 'border-transparent text-emerald-100/80 hover:border-emerald-300/25 hover:bg-emerald-300/10 hover:text-white'}`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className={`flex h-5 w-5 items-center justify-center rounded-lg transition-colors ${loginIPActionFilter === 'login' ? 'bg-slate-950/15' : 'bg-emerald-300/10 group-hover:bg-emerald-300/20'}`}>
                      <LogIn className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-[10px] font-black tracking-wide">登入</span>
                  </span>
                  <span className={`min-w-[1.5rem] rounded-lg px-1 py-1 text-center text-[11px] font-black leading-none ${loginIPActionFilter === 'login' ? 'bg-slate-950/15' : 'bg-emerald-300/10'}`}>
                    {loginIPLoading ? '—' : loginRecordCount}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setLoginIPActionFilter((current) => current === 'logout' ? null : 'logout')}
                  aria-pressed={loginIPActionFilter === 'logout'}
                  title="篩選登出紀錄"
                  className={`group inline-flex h-9 min-w-[84px] items-center justify-between gap-2 rounded-xl border px-2.5 outline-none transition-[background-color,border-color,box-shadow,transform] duration-200 hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-rose-200/90 ${loginIPActionFilter === 'logout' ? 'border-rose-100/80 bg-gradient-to-br from-rose-200 via-rose-300 to-red-400 text-slate-950 shadow-[0_5px_14px_rgba(251,113,133,0.24)]' : 'border-transparent text-rose-100/80 hover:border-rose-300/25 hover:bg-rose-300/10 hover:text-white'}`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className={`flex h-5 w-5 items-center justify-center rounded-lg transition-colors ${loginIPActionFilter === 'logout' ? 'bg-slate-950/15' : 'bg-rose-300/10 group-hover:bg-rose-300/20'}`}>
                      <LogOut className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-[10px] font-black tracking-wide">登出</span>
                  </span>
                  <span className={`min-w-[1.5rem] rounded-lg px-1 py-1 text-center text-[11px] font-black leading-none ${loginIPActionFilter === 'logout' ? 'bg-slate-950/15' : 'bg-rose-300/10'}`}>
                    {loginIPLoading ? '—' : logoutRecordCount}
                  </span>
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setLoginIPEmployee(null)}
              aria-label="關閉登入 IP 紀錄"
              className="absolute right-5 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg border border-rose-300/35 bg-rose-500/15 text-rose-200 transition-all hover:border-rose-200/80 hover:bg-rose-500/40 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="login-history-modal-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-[linear-gradient(180deg,#0d1b2a_0%,#0a1521_100%)]">
            {loginIPLoading ? (
              <div className="m-4 flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] sm:m-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10">
                  <Loader2 className="h-6 w-6 animate-spin text-cyan-300" />
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-300">正在載入安全活動</p>
                <p className="mt-1 text-xs text-slate-500">正在取得最新登入紀錄</p>
              </div>
            ) : displayedLoginIPRecords.length === 0 ? (
              <div className="m-4 flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.03] text-center sm:m-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-500/20 bg-slate-500/10">
                  <Globe className="h-6 w-6 text-slate-500" />
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-300">{loginIPActionFilter ? `找不到${loginIPActionFilter === 'login' ? '登入' : '登出'}紀錄` : '找不到登入紀錄'}</p>
                <p className="mt-1 max-w-xs text-xs text-slate-500">新的登入與登出活動會顯示在這裡。</p>
              </div>
            ) : (
              <div className="w-full overflow-x-auto">
                <table className="min-w-[720px] w-full">
                  <thead className="bg-white/[0.025]">
                    <tr className="border-y border-white/10">
                      <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">時間</th>
                      <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">類型</th>
                      <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">IP 位址</th>
                      <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">系統與瀏覽器</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedLoginIPRecords.map((record) => (
                      <tr key={record.id} className={`group border-b transition-[background-color,box-shadow,filter] duration-200 ease-out last:border-b-0 ${record.action_type === 'login' ? 'border-emerald-300/15 bg-emerald-400/[0.045] hover:bg-emerald-400/[0.11] hover:shadow-[inset_3px_0_0_rgba(52,211,153,0.85)]' : 'border-rose-300/15 bg-rose-400/[0.045] hover:bg-rose-400/[0.11] hover:shadow-[inset_3px_0_0_rgba(251,113,133,0.85)]'}`}>
                        <td className={`whitespace-nowrap px-4 py-3.5 text-xs ${record.action_type === 'login' ? 'text-emerald-200' : 'text-rose-300'}`}>
                          <span className="flex items-center gap-2">
                            <span className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${record.action_type === 'login' ? 'bg-emerald-300/10 text-emerald-300 group-hover:bg-emerald-300/20' : 'bg-rose-300/10 text-rose-300 group-hover:bg-rose-300/20'}`}>
                              <Clock3 className="h-3.5 w-3.5" />
                            </span>
                            {formatDateTime(record.created_at)}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                            record.action_type === 'login'
                              ? 'border-emerald-300/20 bg-emerald-300/10 text-emerald-300'
                              : 'border-rose-300/20 bg-rose-300/10 text-rose-300'
                          }`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${record.action_type === 'login' ? 'bg-emerald-300' : 'bg-rose-300'}`} />
                            {record.action_type === 'login' ? '登入' : '登出'}
                          </span>
                        </td>
                        <td className={`px-4 py-3.5 text-xs font-mono ${record.action_type === 'login' ? 'text-emerald-200' : 'text-rose-300'}`}>
                          <span className="flex items-center gap-1.5">
                            <MapPin className={`h-3.5 w-3.5 ${record.action_type === 'login' ? 'text-emerald-300' : 'text-rose-300'}`} />
                            {record.ip_address || '未知 IP'}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <LoginDeviceSummary
                            compact
                            deviceInfo={record.device_info}
                            userAgent={record.user_agent}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>,
      document.body
    );
  };

  const handleOpenWallet = useCallback(async (employee: { id: string; username: string; employeeId?: string }) => {
    setWalletEmployee(employee);
    setWalletData(null);
    setWalletAdjustData({ amount: '', remarks: '' });
    setWalletAdjusting(false);
    setWalletNotification(null);
    walletAdjustmentOperationIdRef.current = null;
    setWalletLoading(true);
    try {
      setWalletData(await loadWalletModalData(employee.id));
    } catch (err) {
      console.error('Error loading wallet:', formatSupabaseError(err));
      setWalletData({ available: 0, pending: 0 });
    } finally {
      setWalletLoading(false);
    }
  }, []);

  const handleWalletAdjust = async (type: 'add' | 'subtract') => {
    if (!walletEmployee || !walletData) return;
    const amount = parseFloat(walletAdjustData.amount);
    if (isNaN(amount) || amount <= 0) {
      setWalletNotification({ type: 'error', message: '請輸入有效金額' });
      return;
    }
    if (!walletAdjustData.remarks.trim()) {
      setWalletNotification({ type: 'error', message: '請輸入備註' });
      return;
    }
    setWalletAdjusting(true);
    setWalletNotification(null);
    try {
      const adjustmentAmount = type === 'add' ? amount : -amount;
      walletAdjustmentOperationIdRef.current ||= createFinancialOperationId();
      const { data: result, error: adjustError } = await supabase.rpc('admin_adjust_wallet_balance_atomic', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_user_id: walletEmployee.id,
        p_amount: adjustmentAmount,
        p_remarks: walletAdjustData.remarks.trim(),
        p_operation_id: walletAdjustmentOperationIdRef.current,
      });
      if (adjustError) throw adjustError;
      if (!result?.success) {
        setWalletNotification({ type: 'error', message: result?.error || '調整餘額失敗' });
        setWalletAdjusting(false);
        return;
      }
      setWalletData(await loadWalletModalData(walletEmployee.id));
      walletAdjustmentOperationIdRef.current = null;
      setWalletAdjustData({ amount: '', remarks: '' });
      setWalletNotification({ type: 'success', message: '餘額調整成功' });
    } catch (err: unknown) {
      console.error('Error adjusting wallet:', formatSupabaseError(err));
      setWalletNotification({ type: 'error', message: formatSupabaseError(err) || '調整餘額失敗' });
    } finally {
      setWalletAdjusting(false);
    }
  };

  const renderWalletModal = () => {
    if (!walletEmployee) return null;

    const enteredAmount = Number.parseFloat(walletAdjustData.amount);
    const hasValidAmount = Number.isFinite(enteredAmount) && enteredAmount > 0;

    return createPortal(
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md"
        onClick={(event) => {
          if (event.target === event.currentTarget) setWalletEmployee(null);
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="wallet-adjustment-title"
          className="relative flex max-h-[min(760px,calc(100dvh-2rem))] w-full max-w-xl flex-col overflow-hidden rounded-[28px] border border-amber-200/20 bg-[#07111f] text-slate-100 shadow-[0_28px_90px_rgba(2,6,23,0.75)] ring-1 ring-white/5"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-300 via-orange-400 to-cyan-300" />
          <div className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-amber-400/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-28 -left-24 h-56 w-56 rounded-full bg-cyan-400/10 blur-3xl" />

          <div className="relative flex items-start justify-between gap-4 border-b border-white/10 bg-gradient-to-br from-amber-500/[0.13] via-slate-900/60 to-cyan-500/[0.08] px-5 py-5 sm:px-6">
            <div className="flex min-w-0 items-center gap-3.5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-amber-200/30 bg-gradient-to-br from-amber-300/25 to-orange-500/10 text-amber-200 shadow-[0_0_28px_rgba(251,191,36,0.16)]">
                <Wallet className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.22em] text-amber-200/70">Financial control</p>
                <h3 id="wallet-adjustment-title" className="truncate text-xl font-bold tracking-tight text-white">調整錢包</h3>
                <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2 text-[11px]">
                  <span className="max-w-[220px] truncate font-semibold text-amber-100">{walletEmployee.username}</span>
                  {walletEmployee.employeeId && <span className="rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-0.5 font-mono text-slate-300">ID · {walletEmployee.employeeId}</span>}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setWalletEmployee(null)}
              aria-label="關閉錢包調整面板"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-400 transition-all hover:border-amber-200/30 hover:bg-amber-400/15 hover:text-amber-100 active:scale-95"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="relative min-h-0 overflow-y-auto px-5 py-5 sm:px-6">
            {walletLoading ? (
              <div className="flex min-h-[280px] flex-col items-center justify-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-300/25 bg-amber-400/10">
                  <Loader2 className="h-6 w-6 animate-spin text-amber-300" />
                </div>
                <p className="text-xs font-medium text-slate-400">正在讀取錢包資料</p>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="relative overflow-hidden rounded-2xl border border-emerald-300/20 bg-gradient-to-br from-emerald-400/[0.14] via-emerald-950/45 to-slate-900/70 p-4 shadow-[0_12px_30px_rgba(16,185,129,0.08)]">
                    <div className="pointer-events-none absolute -right-5 -top-7 h-24 w-24 rounded-full bg-emerald-300/10 blur-2xl" />
                    <div className="relative flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-200/70">Available balance</p>
                        <p className="mt-2 text-2xl font-bold tabular-nums text-emerald-100">${(walletData?.available ?? 0).toFixed(2)}</p>
                        <p className="mt-1 text-[10px] font-medium text-emerald-200/55">可用餘額</p>
                      </div>
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-200/20 bg-emerald-300/10 text-emerald-200">
                        <DollarSign className="h-4 w-4" />
                      </span>
                    </div>
                  </div>
                  <div className="relative overflow-hidden rounded-2xl border border-amber-300/20 bg-gradient-to-br from-amber-400/[0.13] via-amber-950/45 to-slate-900/70 p-4 shadow-[0_12px_30px_rgba(245,158,11,0.07)]">
                    <div className="pointer-events-none absolute -right-5 -top-7 h-24 w-24 rounded-full bg-amber-300/10 blur-2xl" />
                    <div className="relative flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-200/70">Withdrawal request funds</p>
                        <p className="mt-2 text-2xl font-bold tabular-nums text-amber-100">${(walletData?.pending ?? 0).toFixed(2)}</p>
                        <p className="mt-1 text-[10px] font-medium text-amber-200/55">申请提现资金</p>
                      </div>
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-amber-200/20 bg-amber-300/10 text-amber-200">
                        <Wallet className="h-4 w-4" />
                      </span>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 shadow-inner shadow-black/10">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-white">調整內容</p>
                      <p className="mt-1 text-[10px] text-slate-500">請填寫金額與可追溯的操作備註</p>
                    </div>
                    <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-cyan-200">Audit required</span>
                  </div>

                  <div className="space-y-4">
                    <label className="block">
                      <span className="mb-2 flex items-center justify-between text-[11px] font-semibold text-slate-300">
                        <span>調整金額</span>
                        <span className="font-normal text-slate-500">正數金額</span>
                      </span>
                      <span className="relative block">
                        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-base font-bold text-amber-300">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={walletAdjustData.amount}
                          onChange={(e) => {
                            walletAdjustmentOperationIdRef.current = null;
                            setWalletAdjustData(d => ({ ...d, amount: e.target.value }));
                          }}
                          placeholder="0.00"
                          className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-4 text-base font-semibold tabular-nums text-slate-900 outline-none shadow-[inset_0_1px_2px_rgba(15,23,42,0.08)] transition-all placeholder:text-slate-400 focus:border-amber-400 focus:bg-white focus:ring-4 focus:ring-amber-300/20"
                        />
                      </span>
                    </label>

                    <label className="block">
                      <span className="mb-2 flex items-center justify-between text-[11px] font-semibold text-slate-300">
                        <span>操作備註 <span className="text-rose-300">*</span></span>
                        <span className="font-normal text-slate-500">將記錄至財務流水</span>
                      </span>
                      <textarea
                        value={walletAdjustData.remarks}
                        onChange={(e) => {
                          walletAdjustmentOperationIdRef.current = null;
                          setWalletAdjustData(d => ({ ...d, remarks: e.target.value }));
                        }}
                        placeholder="例如：訂單補償、人工修正原因……"
                        rows={3}
                        className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm leading-6 text-slate-900 outline-none shadow-[inset_0_1px_2px_rgba(15,23,42,0.08)] transition-all placeholder:text-slate-400 focus:border-cyan-400 focus:bg-white focus:ring-4 focus:ring-cyan-300/20"
                      />
                    </label>
                  </div>
                </div>

                {hasValidAmount && (
                  <div className="flex items-center gap-2 rounded-xl border border-blue-300/15 bg-blue-400/[0.07] px-3 py-2.5 text-[11px] text-blue-100/80">
                    <Clock className="h-3.5 w-3.5 shrink-0 text-blue-300" />
                    <span>輸入金額：<strong className="font-semibold tabular-nums text-blue-100">${enteredAmount.toFixed(2)}</strong>，請確認操作方向後提交。</span>
                  </div>
                )}

                {walletNotification && (
                  <div className={`flex items-start gap-2 rounded-xl border px-3.5 py-3 text-xs font-medium ${walletNotification.type === 'success' ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-200' : 'border-rose-300/25 bg-rose-400/10 text-rose-200'}`}>
                    <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${walletNotification.type === 'success' ? 'bg-emerald-300' : 'bg-rose-300'}`} />
                    <span>{walletNotification.message}</span>
                  </div>
                )}

                <div className="flex flex-col-reverse gap-2 border-t border-white/10 pt-4 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => setWalletEmployee(null)}
                    className="h-11 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-xs font-semibold text-slate-300 transition-all hover:border-white/20 hover:bg-white/[0.09] hover:text-white active:scale-[0.98] sm:w-24"
                  >
                    關閉
                  </button>
                  <button
                    type="button"
                    onClick={() => handleWalletAdjust('subtract')}
                    disabled={walletAdjusting}
                    className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-rose-300/30 bg-gradient-to-r from-rose-500/85 to-red-600/80 px-4 text-xs font-bold text-white shadow-[0_10px_24px_rgba(225,29,72,0.16)] transition-all hover:from-rose-400 hover:to-red-500 active:scale-[0.98] disabled:cursor-wait disabled:opacity-50"
                  >
                    {walletAdjusting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowDown className="h-4 w-4" />}
                    扣除餘額
                  </button>
                  <button
                    type="button"
                    onClick={() => handleWalletAdjust('add')}
                    disabled={walletAdjusting}
                    className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-300/30 bg-gradient-to-r from-emerald-500/85 to-teal-500/80 px-4 text-xs font-bold text-white shadow-[0_10px_24px_rgba(16,185,129,0.16)] transition-all hover:from-emerald-400 hover:to-teal-400 active:scale-[0.98] disabled:cursor-wait disabled:opacity-50"
                  >
                    {walletAdjusting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                    新增餘額
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>,
      document.body
    );
  };

  const renderActionsDropdown = useCallback((employee: EmployeeWithAdmin) => {
    const isOpen = openActionMenu === employee.id;
    return (
      <div className="relative" ref={isOpen ? actionMenuRef : undefined}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setOpenActionMenu(isOpen ? null : employee.id);
          }}
          className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-all duration-150 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:ring-offset-1 focus-visible:ring-offset-slate-950 ${isOpen ? 'bg-blue-500/15 text-blue-200 shadow-[0_0_12px_rgba(59,130,246,0.3)]' : 'text-slate-500 hover:bg-slate-700/45 hover:text-white hover:shadow-[0_0_10px_rgba(148,163,184,0.2)]'}`}
          title="操作"
          aria-label={`開啟 ${employee.username} 的操作選單`}
          aria-expanded={isOpen}
        >
          <MoreVertical className="h-4 w-4" />
        </button>
        {isOpen && (
          <div className="absolute right-8 top-1/2 z-50 flex h-7 -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded-xl border border-slate-400/55 bg-[#0b1220] px-1.5 shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_12px_30px_rgba(2,6,23,0.86)] ring-1 ring-inset ring-blue-300/15">
            <button
              onClick={(e) => { e.stopPropagation(); setOpenActionMenu(null); setEditingEmployee(employee); }}
              className="group inline-flex h-6 items-center gap-1.5 rounded-md border border-blue-300/45 border-l-2 border-l-blue-300/95 bg-blue-950/75 px-3 text-xs font-extrabold text-blue-100 shadow-[inset_0_1px_0_rgba(147,197,253,0.16)] transition-all duration-150 hover:-translate-y-px hover:border-blue-100 hover:bg-blue-600 hover:text-white hover:shadow-[0_0_14px_rgba(59,130,246,0.62)] active:translate-y-px active:scale-[0.96] active:bg-blue-800 active:shadow-inner focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:ring-offset-1 focus-visible:ring-offset-slate-950"
              title="編輯詳情"
              aria-label="編輯員工"
            >
              <Pencil className="h-3.5 w-3.5 transition-transform duration-150 group-hover:scale-110" />
              <span>編輯</span>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setOpenActionMenu(null); setNewPassword(''); setShowResetPassword(false); setShowPasswordReset({ id: employee.id, username: employee.username }); }}
              className="group inline-flex h-6 items-center gap-1.5 rounded-md border border-amber-200/55 border-l-2 border-l-amber-200/95 bg-amber-950/75 px-3 text-xs font-extrabold text-amber-100 shadow-[inset_0_1px_0_rgba(253,230,138,0.2)] transition-all duration-150 hover:-translate-y-px hover:border-amber-50 hover:bg-amber-400 hover:text-slate-950 hover:shadow-[0_0_14px_rgba(245,158,11,0.68)] active:translate-y-px active:scale-[0.96] active:bg-amber-700 active:text-white active:shadow-inner focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200 focus-visible:ring-offset-1 focus-visible:ring-offset-slate-950"
              title="重設密碼"
              aria-label="修改員工密碼"
            >
              <Key className="h-3.5 w-3.5 transition-transform duration-150 group-hover:rotate-[-8deg] group-hover:scale-110" />
              <span>改密碼</span>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setOpenActionMenu(null); setDeletingEmployee(employee); }}
              className="group inline-flex h-6 items-center gap-1.5 rounded-md border border-rose-300/50 border-l-2 border-l-rose-300/95 bg-rose-950/75 px-3 text-xs font-extrabold text-rose-100 shadow-[inset_0_1px_0_rgba(253,164,175,0.18)] transition-all duration-150 hover:-translate-y-px hover:border-rose-50 hover:bg-rose-600 hover:text-white hover:shadow-[0_0_14px_rgba(244,63,94,0.68)] active:translate-y-px active:scale-[0.96] active:bg-rose-800 active:shadow-inner focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200 focus-visible:ring-offset-1 focus-visible:ring-offset-slate-950"
              title="刪除"
              aria-label="刪除員工帳戶"
            >
              <Trash2 className="h-3.5 w-3.5 transition-transform duration-150 group-hover:scale-110" />
              <span>刪除</span>
            </button>
          </div>
        )}
      </div>
    );
  }, [openActionMenu]);

  const renderEmployeeRow = useCallback((employee: EmployeeWithAdmin, index: number, isSuperAdmin: boolean) => (
    <tr
      key={employee.id}
      className={`group border-t border-slate-700/50 transition-colors duration-75 ${
        employee.is_pinned
          ? 'bg-amber-500/10 hover:bg-amber-500/20'
          : isSuperAdmin ? 'hover:bg-yellow-500/15' : 'hover:bg-blue-500/15'
      }`}
    >
      <td className="relative w-[40px] py-0.5 pl-1.5 pr-0 text-xs text-left whitespace-nowrap">
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 left-0 w-1 transition-opacity duration-75 ${
            employee.is_pinned
              ? 'bg-amber-400 opacity-100'
              : isSuperAdmin
                ? 'bg-yellow-400 opacity-0 group-hover:opacity-100'
                : 'bg-blue-400 opacity-0 group-hover:opacity-100'
          }`}
        />
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setPinConfirmEmployee({ id: employee.id, username: employee.username, employeeId: employee.employee_id, currentPinned: employee.is_pinned }); }}
          className={`inline-flex h-5 min-w-[32px] items-center justify-start rounded-md px-1.5 font-bold tabular-nums transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/80 ${employee.is_pinned ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 hover:text-amber-300' : 'text-slate-400 hover:bg-amber-500/10 hover:text-amber-300'}`}
          title={employee.is_pinned ? '取消釘選' : '釘選至頂端'}
          aria-label={employee.is_pinned ? `取消釘選 ${employee.username}` : `釘選 ${employee.username} 至頂端`}
        >
          {index + 1}
        </button>
      </td>
      <td className="w-[46px] py-0.5 px-0 text-center whitespace-nowrap">
        <span className="-ml-1 inline-flex">{employee.statsLoaded ? renderWorkStatusBadge(employee.workStatus) : <span className="text-xs text-slate-500" title="統計資料載入中">—</span>}</span>
      </td>
      <td className="group/withdrawal relative w-[104px] overflow-visible py-0.5 px-1 whitespace-nowrap cursor-pointer sm:w-[116px]" onClick={() => setViewingEmployee(employee)}>
        <div className="flex min-w-0 flex-col">
          <div className="flex min-w-0 items-center gap-0.5">
            <span title={employee.username} className={`block max-w-full truncate text-xs font-medium ${!employee.is_active ? 'text-red-400' : employee.workStatus === 'online' ? 'text-green-400' : employee.hasPendingWithdrawal ? 'text-orange-400' : 'text-white'}`}>{employee.username}</span>
          </div>
          {employee.hasPendingWithdrawal && (
            <div className="relative mt-0.5 flex min-w-0 items-center gap-1.5 whitespace-nowrap">
              {employee.pendingWithdrawals && employee.pendingWithdrawals.length > 1 ? (
                <>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded border border-orange-300/35 bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-bold text-orange-200 transition-colors group-hover/withdrawal:border-orange-200/60 group-hover/withdrawal:bg-orange-500/25">
                    多筆提現
                    <span className="rounded-full bg-orange-300/20 px-1 text-[9px] tabular-nums text-orange-100">{employee.pendingWithdrawals.length}</span>
                  </span>
                  <div className="pointer-events-none invisible absolute left-full top-1/2 z-50 ml-2 w-56 -translate-y-1/2 rounded-xl border border-orange-300/35 bg-slate-950/98 p-2.5 text-left opacity-0 shadow-2xl shadow-black/60 ring-1 ring-orange-300/10 transition-all duration-150 group-hover/withdrawal:pointer-events-auto group-hover/withdrawal:visible group-hover/withdrawal:opacity-100">
                    <div className="mb-2 flex items-center justify-between gap-2 border-b border-orange-300/20 pb-2">
                      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-orange-200">待提現明細</span>
                      <span className="rounded-full border border-orange-300/30 bg-orange-500/15 px-1.5 py-0.5 text-[9px] font-bold tabular-nums text-orange-100">{employee.pendingWithdrawals.length} 筆</span>
                    </div>
                    <div className="max-h-44 overflow-y-auto dark-panel-scroll">
                      {employee.pendingWithdrawals?.map((withdrawal, withdrawalIndex) => (
                        <div key={withdrawal.id} className={`flex items-center justify-between gap-3 py-1.5 ${withdrawalIndex < employee.pendingWithdrawals!.length - 1 ? 'border-b border-slate-800' : ''}`}>
                          <span className="text-[10px] font-medium text-slate-400">第 {withdrawalIndex + 1} 筆</span>
                          <span className="text-right">
                            <span className="block text-[11px] font-bold tabular-nums text-orange-200">${withdrawal.amount.toFixed(2)}</span>
                            <span className="block text-[9px] font-medium tabular-nums text-slate-400">{formatWithdrawalDate(withdrawal.created_at)}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <span className="shrink-0 text-[10px] font-semibold tabular-nums text-orange-400">${employee.pendingWithdrawalAmount.toFixed(2)}</span>
                  {employee.pendingWithdrawalDate && (
                    <span className="shrink-0 border-l border-orange-400/30 pl-1.5 text-[9px] font-medium tabular-nums text-orange-200/75">
                      {formatWithdrawalDate(employee.pendingWithdrawalDate)}
                    </span>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </td>
      <td title={employee.employee_id} className="hidden w-[100px] max-w-[100px] overflow-hidden text-ellipsis py-0.5 px-1 text-xs text-slate-300 font-mono whitespace-nowrap cursor-pointer lg:table-cell" onClick={() => setViewingEmployee(employee)}>{employee.employee_id}</td>
      <td className="hidden w-[72px] py-0.5 px-1 text-[10px] text-emerald-400 whitespace-nowrap xl:table-cell" onClick={(e) => e.stopPropagation()}>
        <span>{employee.created_at ? new Date(employee.created_at).toLocaleDateString('en-CA') : '-'}</span>
        <button
          onClick={() => {
            const d = employee.created_at ? formatWithdrawalDate(employee.created_at) : '';
            setEditingCreatedAt({ id: employee.id, username: employee.username, employeeId: employee.employee_id, currentDate: d });
            setNewCreatedAt(d);
            setRegistrationDateInputError(null);
            setRegistrationCalendarMonth(d ? d.slice(0, 7) : getCalendarMonthKey(new Date()));
            setRegistrationCalendarOpen(false);
          }}
          className="ml-0 inline-flex align-middle p-0.5 rounded text-slate-500 hover:text-blue-400 transition-colors"
          title="編輯註冊日期"
        >
          <Pencil className="w-2.5 h-2.5" />
        </button>
      </td>
      <td className="hidden w-[44px] py-0.5 pl-1 pr-0 align-middle relative group/ver xl:table-cell">
        <button
          onClick={(e) => { e.stopPropagation(); toggleVerification(employee.id, employee.is_verified, employee.username, employee.employee_id); }}
          className={`inline-flex h-5 items-center justify-center gap-0.5 px-1.5 py-0.5 align-middle leading-none rounded text-[10px] font-medium ${
            employee.is_verified ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
          }`}
        >
          {employee.is_verified ? <CheckCircle className="w-2.5 h-2.5" /> : <XCircle className="w-2.5 h-2.5" />}
          {employee.is_verified ? '是' : '否'}
        </button>
        {employee.verification && (
          <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 z-50 hidden group-hover/ver:block bg-slate-950 border border-sky-500/40 rounded-lg p-3 shadow-2xl shadow-black/60 ring-1 ring-sky-500/20 text-xs whitespace-nowrap">
            <span className="text-slate-300"><span className="text-slate-500">姓名：</span> {employee.verification.real_name}</span>
            <span className="text-slate-600 mx-1">|</span>
            <span className="text-slate-300"><span className="text-slate-500">電話：</span> {employee.verification.phone}</span>
            <span className="text-slate-600 mx-1">|</span>
            <span className="text-slate-300"><span className="text-slate-500">電子郵件：</span> {employee.verification.email}</span>
            <span className="text-slate-600 mx-1">|</span>
            <span className="text-slate-300"><span className="text-slate-500">錢包：</span> {employee.verification.wallet_address}</span>
          </div>
        )}
      </td>
      <td className="w-[48px] py-0.5 pl-0 pr-1 align-middle">
        <button
          onClick={(e) => { e.stopPropagation(); toggleEmployeeStatus(employee.id, employee.is_active, employee.username, employee.employee_id); }}
          className={`inline-flex h-5 items-center justify-center px-1.5 py-0.5 align-middle leading-none rounded text-[10px] font-medium ${
            employee.is_active ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
          }`}
        >
          {employee.is_active ? '啟用' : '停用'}
        </button>
      </td>
      <td className="hidden w-[66px] py-0.5 px-1 relative group/remarks 2xl:table-cell" onClick={(e) => e.stopPropagation()}>
        <div className="flex min-w-0 items-center gap-0.5 max-w-[66px]">
          <span className="text-xs text-blue-400 truncate flex-1">{employee.remarks || '-'}</span>
          <button onClick={() => setEditingRemarksOnly(employee)} className="flex-shrink-0 rounded p-0.5 text-blue-400 opacity-0 transition-all hover:bg-blue-500/15 hover:text-cyan-300 group-hover/remarks:opacity-100">
            <Pencil className="h-2.5 w-2.5 text-blue-400 transition-colors group-hover/remarks:text-cyan-300" />
          </button>
        </div>
        {employee.remarks && employee.remarks.length > 8 && (
          <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 z-50 hidden group-hover/remarks:block rounded-lg border border-blue-300 bg-blue-100 px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-blue-950">
            {employee.remarks}
          </div>
        )}
      </td>
      <td className="hidden w-[88px] py-0.5 px-1 relative group/tags 2xl:table-cell" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-0.5 max-w-[88px] min-w-0 overflow-hidden whitespace-nowrap">
          {(employee.tags || []).length > 0 && (
            <span className="min-w-0 flex-1 px-1.5 py-0 bg-amber-500/20 text-amber-400 text-[10px] font-medium rounded-full border border-amber-500/30 truncate">
              {(employee.tags || [])[0]}
            </span>
          )}
          {(employee.tags || []).length > 1 && <span className="flex-shrink-0 text-[10px] text-slate-500">+{(employee.tags || []).length - 1}</span>}
          <button onClick={() => setEditingTags(employee)} className="ml-1 flex-shrink-0 rounded-full border border-transparent bg-slate-700 px-1 py-0 text-[10px] text-slate-400 transition-all hover:border-amber-400/75 hover:bg-amber-500/15 hover:text-amber-400 hover:shadow-[0_0_8px_rgba(245,158,11,0.28)]">
            <Tag className="inline h-2.5 w-2.5 text-current" />+
          </button>
        </div>
        {(employee.tags || []).length > 0 && (
          <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 z-50 hidden group-hover/tags:block rounded-lg border border-amber-300 bg-amber-100 px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-amber-950">
            <div className="flex gap-1">
              {(employee.tags || []).map((tag, idx) => (
                <span key={idx} className="rounded-full border border-amber-700 bg-amber-900 px-1.5 py-px text-[10px] font-medium text-amber-100">{tag}</span>
              ))}
            </div>
          </div>
        )}
      </td>
      {/* Orders group */}
      <td className="py-0.5 px-1 text-[10px] text-center whitespace-nowrap">
        {renderEmployeeStat(employee, <span className="text-blue-400">{employee.totalOrders}</span>)}
      </td>
      <td className="py-0.5 px-1 text-[10px] text-center whitespace-nowrap">
        {renderEmployeeStat(employee, <span className="text-cyan-400 font-medium">{employee.todayOrders}</span>)}
      </td>
      <td className="py-0.5 px-1 text-[10px] text-center whitespace-nowrap">
        {renderEmployeeStat(employee, <span className="text-green-400 font-bold">{employee.todayCompletedOrders}</span>)}
      </td>
      <td className="py-0.5 px-1 text-[10px] text-center whitespace-nowrap">
        {renderEmployeeStat(employee, <span className="text-red-400">{employee.failedOrders}</span>)}
      </td>
      {/* Money group */}
      <td className="hidden py-0.5 px-1 text-[10px] text-center whitespace-nowrap xl:table-cell">
        {renderEmployeeStat(employee, <span className="text-white font-medium">${(employee.walletBalance || 0).toFixed(2)}</span>)}
      </td>
      <td className="hidden py-0.5 px-1 text-[10px] text-center whitespace-nowrap lg:table-cell">
        {renderEmployeeStat(employee, <span className="text-blue-400 font-medium">${employee.accountBalance.toFixed(2)}</span>)}
      </td>
      <td className="py-0.5 px-1 text-[10px] text-center whitespace-nowrap">
        {renderEmployeeStat(employee, <span className="text-amber-400 font-medium">${employee.todayCommission.toFixed(2)}</span>)}
      </td>
      {/* Time group */}
      <td className="py-0.5 px-1 text-[10px] text-center whitespace-nowrap">
        {renderEmployeeStat(employee, <span className="text-white">{formatTime(employee.totalWorkMinutes)}</span>)}
      </td>
      <td className="py-0.5 px-1 text-[10px] text-center whitespace-nowrap">
        {renderEmployeeStat(employee, <span className="text-green-400">{formatTime(employee.todayWorkMinutes)}</span>)}
      </td>
      {/* Work days */}
      <td className="w-[52px] py-0.5 px-1 text-center whitespace-nowrap">
        {renderEmployeeStat(employee, <span className="text-[11px] font-normal tabular-nums text-cyan-300" title="每日明細中的獨立活動天數">{employee.workDays}</span>)}
      </td>
      <td className="w-[132px] py-0.5 px-1 text-center" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-center gap-1">
          <button
            onClick={() => onQuickAction?.('message', { id: employee.id, username: employee.username })}
            className="p-0.5 rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/25 hover:text-blue-300 transition-all border border-blue-500/20 hover:border-blue-400/40"
            title={`傳送訊息給 ${employee.username}`}
          >
            <Bell className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onQuickAction?.('customerservice', { id: employee.id, username: employee.username });
            }}
            className="p-0.5 rounded bg-rose-500/10 text-rose-400 hover:bg-rose-500/25 hover:text-rose-300 transition-all border border-rose-500/20 hover:border-rose-400/40"
            title={`直接傳送模擬客戶訊息給 ${employee.username}`}
            aria-label={`直接傳送模擬客戶訊息給 ${employee.username}`}
          >
            <MessageCircle className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onQuickAction?.('cccservice', { id: employee.id, username: employee.username });
            }}
            className="p-0.5 rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/25 hover:text-emerald-300 transition-all border border-emerald-500/20 hover:border-emerald-400/40"
            title={`直接傳送經理訊息給 ${employee.username}`}
            aria-label={`直接傳送經理訊息給 ${employee.username}`}
          >
            <Headphones className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleOpenWallet({ id: employee.id, username: employee.username, employeeId: employee.employee_id })}
            className="p-0.5 rounded bg-amber-500/10 text-amber-400 hover:bg-amber-500/25 hover:text-amber-300 transition-all border border-amber-500/20 hover:border-amber-400/40"
            title={`調整 ${employee.username} 的錢包`}
          >
            <DollarSign className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleViewLoginIP({ id: employee.id, username: employee.username, employeeId: employee.employee_id })}
            className="p-0.5 rounded bg-sky-500/10 text-sky-400 hover:bg-sky-500/25 hover:text-sky-300 transition-all border border-sky-500/20 hover:border-sky-400/40"
            title={`檢視 ${employee.username} 的登入 IP`}
          >
            <Globe className="w-3.5 h-3.5" />
          </button>
          {renderActionsDropdown(employee)}
        </div>
      </td>
    </tr>
  ), [
    formatTime,
    handleOpenWallet,
    handleViewLoginIP,
    onQuickAction,
    renderActionsDropdown,
    renderEmployeeStat,
    renderWorkStatusBadge,
    toggleEmployeeStatus,
    toggleVerification,
  ]);
  const employeeRowsByGroup = useMemo(() => {
    const rows = new Map<string, ReactNode[]>();
    filteredEmployeeGroups.forEach(group => {
      const isSuperAdminGroup = group.admin.role === 'super_admin';
      rows.set(group.admin.id, group.employees.map((employee, index) => renderEmployeeRow(employee, index, isSuperAdminGroup)));
    });
    return rows;
  }, [filteredEmployeeGroups, renderEmployeeRow]);

  const renderTableHeader = (adminId: string) => (
    <thead className="sticky top-0 z-20 isolate bg-blue-900 shadow-[0_2px_4px_rgba(0,0,0,0.35)] border-b-2 border-blue-300/40">
      <tr className="h-[40px]">
        <th className="w-[40px] pl-1.5 pr-0 py-1 text-left text-[10px] font-semibold text-white uppercase tracking-wider">#</th>
        <th className="h-[40px] w-[46px] px-0 py-1 text-center text-[10px] font-semibold text-white uppercase tracking-wider">工作狀態</th>
        <th className="w-[104px] px-1 py-1 text-left text-[10px] font-semibold text-white uppercase tracking-wider sm:w-[116px]">使用者</th>
        <th className="hidden w-[100px] px-1 py-1 text-left text-[10px] font-semibold text-white uppercase tracking-wider lg:table-cell">員工 ID</th>
        {renderSortableHeader(adminId, 'created_at', '建立日期', 'hidden w-[72px] xl:table-cell')}
        <th className="hidden h-[40px] w-[44px] pl-1 pr-0 py-1 text-left text-[10px] font-semibold text-white uppercase tracking-wider xl:table-cell">驗證</th>
        <th className="h-[40px] w-[48px] pl-0 pr-1 py-1 text-left text-[10px] font-semibold text-white uppercase tracking-wider">狀態</th>
        <th className="hidden h-[40px] w-[66px] px-1 py-1 text-left text-[10px] font-semibold text-white uppercase tracking-wider 2xl:table-cell">備註</th>
        <th className="hidden h-[40px] w-[88px] px-1 py-1 text-left text-[10px] font-semibold text-white uppercase tracking-wider 2xl:table-cell">標籤</th>
        {renderSortableHeader(adminId, 'totalOrders', '總數', 'w-[41px]')}
        {renderSortableHeader(adminId, 'todayOrders', '今日', 'w-[41px]')}
        {renderSortableHeader(adminId, 'todayCompletedOrders', '成功', 'w-[45px]')}
        {renderSortableHeader(adminId, 'failedOrders', '失敗', 'w-[43px]')}
        {renderSortableHeader(adminId, 'walletBalance', '錢包餘額', 'hidden w-[59px] xl:table-cell')}
        {renderSortableHeader(adminId, 'accountBalance', '可用餘額', 'hidden w-[59px] lg:table-cell')}
        {renderSortableHeader(adminId, 'todayCommission', '今日佣金', 'w-[58px]')}
        {renderSortableHeader(adminId, 'totalWorkMinutes', '總工時', 'w-[54px]')}
        {renderSortableHeader(adminId, 'todayWorkMinutes', '今日工時', 'w-[54px]')}
        {renderSortableHeader(adminId, 'workDays', '工作天數', 'w-[52px]')}
        <th className="h-[40px] w-[132px] px-1 py-1 text-center text-[10px] font-semibold text-white uppercase tracking-wider">操作</th>
      </tr>
    </thead>
  );

  const renderCreateForm = (targetAdminId: string, groupAdmin?: { role: string; username: string }) => {
    if (!showCreateForm || selectedAdminForCreate !== targetAdminId) return null;
    const isSuperGroup = groupAdmin?.role === 'super_admin';
    const fieldFocusClasses = isSuperGroup
      ? 'focus:border-yellow-500 focus:ring-yellow-500/20'
      : 'focus:border-blue-500 focus:ring-blue-500/20';

    return (
      <div className={`border-t-2 px-3 py-3 ${isSuperGroup ? 'border-yellow-400/45 bg-gradient-to-r from-[#241805] via-[#352307] to-[#16120a]' : 'border-blue-400/45 bg-gradient-to-r from-[#071a2d] via-[#0b2945] to-[#101827]'}`}>
        <form onSubmit={handleCreateEmployee} className={`overflow-hidden rounded-2xl border shadow-[0_18px_55px_rgba(2,6,23,0.55)] ${isSuperGroup ? 'border-yellow-400/40 bg-gradient-to-br from-[#1a1307] via-[#261b0a] to-[#111827]' : 'border-blue-400/40 bg-gradient-to-br from-[#091827] via-[#0d2238] to-[#111827]'}`}>
          <div className={`flex items-start justify-between gap-4 border-b px-5 py-4 ${isSuperGroup ? 'border-yellow-400/20 bg-yellow-500/5' : 'border-blue-400/20 bg-blue-500/5'}`}>
            <div className="flex min-w-0 items-center gap-3">
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${isSuperGroup ? 'border-yellow-300/40 bg-yellow-500/15 text-yellow-200' : 'border-blue-300/40 bg-blue-500/15 text-blue-200'}`}>
                <UserPlus className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${isSuperGroup ? 'text-yellow-300/80' : 'text-blue-300/80'}`}>存取權限配置</p>
                <h3 className="text-lg font-bold tracking-tight text-white">新增員工帳戶</h3>
                <p className={`truncate text-xs ${isSuperGroup ? 'text-yellow-100/70' : 'text-blue-100/70'}`}>
                  {groupAdmin ? <>建立於： <strong className="font-semibold text-white">{groupAdmin.username}</strong></> : '建立新的員工帳戶'}
                </p>
              </div>
            </div>
            <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-[0.12em] ${isSuperGroup ? 'border-yellow-300/35 bg-yellow-500/10 text-yellow-200' : 'border-blue-300/35 bg-blue-500/10 text-blue-200'}`}>
              安全設定
            </span>
          </div>

          {createError && (
            <div className="mx-5 mt-4 flex items-start gap-2.5 rounded-xl border border-red-400/40 bg-red-500/10 px-3.5 py-3 text-sm text-red-200">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-red-400" />
              <span>{createError}</span>
            </div>
          )}

          <div className="p-5">
            <div className="mb-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
              <span className={`h-px flex-1 ${isSuperGroup ? 'bg-yellow-400/20' : 'bg-blue-400/20'}`} />
              帳戶詳細資料
              <span className={`h-px flex-1 ${isSuperGroup ? 'bg-yellow-400/20' : 'bg-blue-400/20'}`} />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={`mb-1.5 block text-[11px] font-semibold uppercase tracking-wide ${isSuperGroup ? 'text-yellow-100/75' : 'text-blue-100/75'}`}>使用者名稱</label>
                <input type="text" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} disabled={creating} required placeholder="輸入使用者名稱" className={`w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 ${fieldFocusClasses} disabled:bg-slate-100 disabled:text-slate-400 disabled:opacity-100`} />
              </div>
              <div>
                <label className={`mb-1.5 block text-[11px] font-semibold uppercase tracking-wide ${isSuperGroup ? 'text-yellow-100/75' : 'text-blue-100/75'}`}>密碼</label>
                <div className="flex gap-2">
                  <div className="relative min-w-0 flex-1">
                    <input type={showPassword ? 'text' : 'password'} value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} disabled={creating} required minLength={6} autoComplete="new-password" placeholder="建立安全密碼" className={`w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 pr-10 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 ${fieldFocusClasses} disabled:bg-slate-100 disabled:text-slate-400 disabled:opacity-100`} />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900">
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <button type="button" onClick={generatePassword} disabled={creating} className={`inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border bg-white text-slate-600 shadow-sm transition-colors disabled:bg-slate-100 disabled:text-slate-400 disabled:opacity-100 ${isSuperGroup ? 'border-yellow-300 hover:border-yellow-500 hover:bg-yellow-50 hover:text-yellow-700' : 'border-blue-300 hover:border-blue-500 hover:bg-blue-50 hover:text-blue-700'}`} title="產生高強度密碼">
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500">至少 6 個字元</p>
              </div>
              <div>
                <label className={`mb-1.5 block text-[11px] font-semibold uppercase tracking-wide ${isSuperGroup ? 'text-yellow-100/75' : 'text-blue-100/75'}`}>員工 ID</label>
                <input type="text" value={formData.employeeId} onChange={(e) => setFormData({ ...formData, employeeId: e.target.value })} disabled={creating} required placeholder="輸入員工 ID" className={`w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 ${fieldFocusClasses} disabled:bg-slate-100 disabled:text-slate-400 disabled:opacity-100`} />
              </div>
              <div>
                <label className={`mb-1.5 block text-[11px] font-semibold uppercase tracking-wide ${isSuperGroup ? 'text-yellow-100/75' : 'text-blue-100/75'}`}>備註 <span className="font-normal normal-case tracking-normal text-slate-500">（選填）</span></label>
                <input type="text" value={formData.remarks} onChange={(e) => setFormData({ ...formData, remarks: e.target.value })} disabled={creating} placeholder="新增內部備註" className={`w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 ${fieldFocusClasses} disabled:bg-slate-100 disabled:text-slate-400 disabled:opacity-100`} />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2 border-t border-slate-700/70 pt-4">
              <button type="button" onClick={() => { setShowCreateForm(false); setCreateError(null); setFormData({ username: '', password: '', employeeId: '', remarks: '' }); setSelectedAdminForCreate(null); }} disabled={creating} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50">
                <X className="h-4 w-4" />
                取消
              </button>
              <button type="submit" disabled={creating || !formData.username.trim() || !formData.password || !formData.employeeId.trim()} className={`inline-flex items-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${isSuperGroup ? 'border-yellow-300/60 bg-yellow-600 hover:bg-yellow-500' : 'border-blue-300/60 bg-blue-600 hover:bg-blue-500'}`}>
                {creating ? (<><div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />建立中……</>) : (<><UserPlus className="h-4 w-4" />建立員工</>)}
              </button>
            </div>
          </div>
        </form>
      </div>
    );
  };

  // ===== MAIN RENDER =====
  const totalEmployeeCount = employeeGroups.reduce((sum, group) => sum + group.employees.length, 0);
  const selectedGroup = employeeGroups.find((group) => group.admin.id === selectedAdminFilter);
  const selectedGroupLabel = selectedAdminFilter === 'all'
    ? `全部群組（${totalEmployeeCount}）`
    : selectedGroup
      ? `${selectedGroup.admin.username} (${selectedGroup.employees.length})`
      : '選擇群組';

  const confirmDialogStyle = confirmDialog
    ? confirmDialog.variant === 'verification'
      ? confirmDialog.nextStatus
        ? {
            panel: 'border-emerald-300/30 bg-gradient-to-b from-slate-900 via-slate-900 to-emerald-950/30 shadow-emerald-950/40',
            header: 'border-emerald-300/15 bg-gradient-to-r from-emerald-950/85 via-slate-900 to-slate-900',
            eyebrow: 'text-emerald-300/80',
            iconShell: 'border-emerald-300/35 bg-emerald-500/15 text-emerald-200 shadow-emerald-950/40',
            icon: 'text-emerald-300',
            message: 'border-emerald-300/15 bg-emerald-500/5',
            badge: 'border-emerald-300/25 bg-emerald-500/10 text-emerald-200',
            confirmButton: 'border-emerald-300/50 bg-emerald-600 shadow-emerald-950/40 hover:bg-emerald-500',
          }
        : {
            panel: 'border-amber-300/30 bg-gradient-to-b from-slate-900 via-slate-900 to-amber-950/25 shadow-amber-950/40',
            header: 'border-amber-300/15 bg-gradient-to-r from-amber-950/85 via-slate-900 to-slate-900',
            eyebrow: 'text-amber-300/80',
            iconShell: 'border-amber-300/35 bg-amber-500/15 text-amber-200 shadow-amber-950/40',
            icon: 'text-amber-300',
            message: 'border-amber-300/15 bg-amber-500/5',
            badge: 'border-amber-300/25 bg-amber-500/10 text-amber-200',
            confirmButton: 'border-amber-300/50 bg-amber-600 shadow-amber-950/40 hover:bg-amber-500',
          }
      : confirmDialog.nextStatus
        ? {
            panel: 'border-cyan-300/30 bg-gradient-to-b from-slate-900 via-slate-900 to-cyan-950/30 shadow-cyan-950/40',
            header: 'border-cyan-300/15 bg-gradient-to-r from-cyan-950/85 via-slate-900 to-slate-900',
            eyebrow: 'text-cyan-300/80',
            iconShell: 'border-cyan-300/35 bg-cyan-500/15 text-cyan-200 shadow-cyan-950/40',
            icon: 'text-cyan-300',
            message: 'border-cyan-300/15 bg-cyan-500/5',
            badge: 'border-cyan-300/25 bg-cyan-500/10 text-cyan-200',
            confirmButton: 'border-cyan-300/50 bg-cyan-600 shadow-cyan-950/40 hover:bg-cyan-500',
          }
        : {
            panel: 'border-rose-300/30 bg-gradient-to-b from-slate-900 via-slate-900 to-rose-950/30 shadow-rose-950/40',
            header: 'border-rose-300/15 bg-gradient-to-r from-rose-950/85 via-slate-900 to-slate-900',
            eyebrow: 'text-rose-300/80',
            iconShell: 'border-rose-300/35 bg-rose-500/15 text-rose-200 shadow-rose-950/40',
            icon: 'text-rose-300',
            message: 'border-rose-300/15 bg-rose-500/5',
            badge: 'border-rose-300/25 bg-rose-500/10 text-rose-200',
            confirmButton: 'border-rose-300/50 bg-rose-600 shadow-rose-950/40 hover:bg-rose-500',
          }
    : null;

  const [calendarYear, calendarMonthNumber] = registrationCalendarMonth.split('-').map(Number);
  const calendarMonthDate = new Date(calendarYear, calendarMonthNumber - 1, 1);
  const calendarDaysInMonth = new Date(calendarYear, calendarMonthNumber, 0).getDate();
  const calendarLeadingDays = calendarMonthDate.getDay();
  const calendarCells = Array.from(
    { length: 42 },
    (_, index) => {
      const day = index - calendarLeadingDays + 1;
      return day < 1 || day > calendarDaysInMonth ? null : day;
    },
  );
  const todayDateKey = formatWithdrawalDate(new Date().toISOString());
  const calendarMonthLabel = registrationCalendarMonth;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* Unified toolbar: search + group filter + countdown + refresh (super admin only) */}
      {admin.role === 'super_admin' && (
        <div className="relative z-40 flex h-9 w-full min-w-0 items-center overflow-visible rounded-none border border-cyan-200/45 bg-slate-950/95 shadow-lg shadow-cyan-950/25 shrink-0 sticky top-0 backdrop-blur-sm">
          <div className="group relative h-full min-w-[140px] flex-[1_1_0%] overflow-hidden border-r border-cyan-300/25 bg-gradient-to-r from-slate-950/80 via-blue-950/65 to-cyan-950/45 transition-colors focus-within:from-blue-950/90 focus-within:via-cyan-950/55 focus-within:to-blue-950/70">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-300/80 drop-shadow-[0_0_6px_rgba(103,232,249,0.35)] transition-all duration-200 group-focus-within:scale-110 group-focus-within:text-cyan-100" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => handleSearchTermChange(e.target.value)}
              placeholder="搜尋員工……"
              autoComplete="off"
              className="h-full w-full rounded-none bg-transparent pl-10 pr-10 text-[13px] font-semibold tracking-wide text-slate-50 placeholder:text-slate-400/80 outline-none transition-colors focus:bg-white/[0.035]"
            />
            {searchTerm && (
              <button type="button" onClick={() => handleSearchTermChange('')} aria-label="清除員工搜尋" className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border border-transparent text-cyan-200/70 transition-all hover:border-cyan-300/30 hover:bg-cyan-300/15 hover:text-cyan-50">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 bg-gradient-to-r from-cyan-300 via-blue-400 to-transparent opacity-90 transition-transform duration-300 group-focus-within:scale-x-100" />
          </div>
          <div ref={adminFilterRef} className="relative h-full w-[252px] min-w-[252px] max-w-[252px] shrink-0 border-r border-cyan-300/20 bg-gradient-to-r from-blue-950/75 via-slate-900/80 to-cyan-950/55">
            <button
              type="button"
              onClick={() => setAdminFilterOpen((open) => !open)}
              aria-haspopup="listbox"
              aria-expanded={adminFilterOpen}
              className={`group flex h-full w-full items-center gap-2 px-3 text-xs font-semibold transition-colors ${adminFilterOpen ? 'bg-gradient-to-r from-blue-700/70 via-cyan-700/55 to-blue-900/70 text-white shadow-inner shadow-cyan-950/30' : 'text-slate-100 hover:bg-cyan-500/10 hover:text-white'}`}
            >
              <Users className={`h-4 w-4 shrink-0 transition-colors ${adminFilterOpen ? 'text-cyan-100' : 'text-cyan-300'}`} />
              <span className="min-w-0 flex-1 truncate text-left font-semibold">{selectedGroupLabel}</span>
              <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-cyan-200/80 transition-transform duration-200 ${adminFilterOpen ? 'rotate-180 text-cyan-100' : ''}`} />
            </button>
            {adminFilterOpen && (
              <div className="isolate absolute left-0 top-[calc(100%+0.3rem)] z-[60] w-[252px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-cyan-200/45 bg-gradient-to-b from-slate-800 via-blue-950 to-slate-950 p-1 shadow-[0_16px_36px_rgba(2,6,23,0.78)] ring-1 ring-inset ring-white/10" style={{ backgroundColor: '#0f172a' }}>
                <div className="mb-1 flex items-center justify-between rounded-lg border border-cyan-300/15 bg-gradient-to-r from-blue-950/80 via-cyan-950/30 to-slate-900/80 px-2.5 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Users className="h-4 w-4 shrink-0 text-cyan-200" />
                    <div className="min-w-0">
                      <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-cyan-300">員工群組</p>
                      <p className="mt-0.5 truncate text-[10px] text-slate-400">切換顯示群組</p>
                    </div>
                  </div>
                  <span className="inline-flex h-6 min-w-[38px] shrink-0 items-center justify-center gap-1 rounded-md border border-cyan-200/35 bg-gradient-to-b from-cyan-300/20 to-blue-500/15 px-2 text-[11px] font-extrabold tabular-nums text-cyan-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_2px_6px_rgba(8,145,178,0.2)]">
                    <span className="text-[8px] font-bold uppercase tracking-wide text-cyan-200/70">總數</span>
                    {employeeGroups.length}
                  </span>
                </div>
                <div role="listbox" aria-label="篩選員工群組" className="max-h-[calc(100vh-9rem)] min-h-[112px] overflow-y-auto overscroll-contain scrollbar-dark">
                  <button
                    type="button"
                    role="option"
                    aria-selected={selectedAdminFilter === 'all'}
                    onClick={() => {
                      setSelectedAdminFilter('all');
                      setExpandedGroups(new Set(employeeGroups.map(group => group.admin.id)));
                      setAdminFilterOpen(false);
                    }}
                    className={`group flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-all duration-150 ${selectedAdminFilter === 'all' ? 'border-emerald-300/55 bg-gradient-to-r from-emerald-500/25 via-green-500/20 to-transparent text-emerald-50 shadow-sm shadow-emerald-950/40' : 'border-transparent bg-slate-950/20 text-slate-300 hover:border-emerald-300/30 hover:bg-gradient-to-r hover:from-emerald-500/10 hover:via-green-500/10 hover:to-emerald-400/5 hover:text-slate-100 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_3px_9px_rgba(16,185,129,0.1)]'}`}
                  >
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[9px] font-black ${selectedAdminFilter === 'all' ? 'border-emerald-200/45 bg-emerald-300/20 text-emerald-50' : 'border-slate-600/70 bg-slate-800/80 text-slate-400 group-hover:border-emerald-300/35 group-hover:bg-emerald-400/10 group-hover:text-emerald-200'}`}>ALL</span>
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold">全部群組</span>
                    <span className={`inline-flex h-6 min-w-[42px] shrink-0 items-center justify-center rounded-md border px-2 text-xs font-extrabold leading-none tabular-nums shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] ${selectedAdminFilter === 'all' ? 'border-emerald-200/65 bg-gradient-to-b from-emerald-300/30 to-green-500/20 text-emerald-50' : 'border-slate-600/80 bg-slate-800/90 text-cyan-100 group-hover:border-emerald-300/35 group-hover:bg-gradient-to-b group-hover:from-emerald-300/10 group-hover:to-green-500/10 group-hover:text-emerald-100'}`}>{totalEmployeeCount}</span>
                  </button>
                  <div className="my-1.5 h-px bg-gradient-to-r from-transparent via-cyan-300/20 to-transparent" />
                  {employeeGroups.map((group) => {
                    const isSelected = selectedAdminFilter === group.admin.id;
                    return (
                      <button
                        key={group.admin.id}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => {
                          setSelectedAdminFilter(group.admin.id);
                          setExpandedGroups(new Set([group.admin.id]));
                          setAdminFilterOpen(false);
                        }}
                        className={`group flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-all duration-150 ${isSelected ? 'border-emerald-300/55 bg-gradient-to-r from-emerald-500/25 via-green-500/20 to-transparent text-emerald-50 shadow-sm shadow-emerald-950/40' : 'border-transparent bg-slate-950/20 text-slate-300 hover:border-emerald-300/30 hover:bg-gradient-to-r hover:from-emerald-500/10 hover:via-green-500/10 hover:to-emerald-400/5 hover:text-slate-100 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_3px_9px_rgba(16,185,129,0.1)]'}`}
                      >
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[9px] font-black uppercase ${isSelected ? 'border-emerald-200/45 bg-emerald-300/20 text-emerald-50' : 'border-slate-600/70 bg-slate-800/80 text-slate-400 group-hover:border-emerald-300/35 group-hover:bg-emerald-400/10 group-hover:text-emerald-200'}`}>{group.admin.username.slice(0, 1)}</span>
                        <span className="min-w-0 flex-1 truncate text-xs font-medium" title={group.admin.username}>{group.admin.username}</span>
                        <span className={`inline-flex h-6 min-w-[42px] shrink-0 items-center justify-center rounded-md border px-2 text-xs font-extrabold leading-none tabular-nums shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] ${isSelected ? 'border-emerald-200/65 bg-gradient-to-b from-emerald-300/30 to-green-500/20 text-emerald-50' : 'border-slate-600/80 bg-slate-800/90 text-cyan-100 group-hover:border-emerald-300/35 group-hover:bg-gradient-to-b group-hover:from-emerald-300/10 group-hover:to-green-500/10 group-hover:text-emerald-100'}`}>{group.employees.length}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => navigateGroupPanel(-1)}
            disabled={selectedAdminFilter !== 'all'}
            aria-label="顯示上一個群組"
            className="flex h-full w-[92px] shrink-0 items-center justify-center gap-1 border-r border-cyan-300/30 bg-gradient-to-r from-sky-600/85 to-cyan-500/80 px-2 text-[10px] font-bold text-white shadow-sm shadow-cyan-950/30 transition-all hover:from-sky-500 hover:to-cyan-400 active:from-sky-700 active:to-cyan-600 disabled:cursor-not-allowed disabled:border-slate-700/60 disabled:bg-slate-800/80 disabled:bg-none disabled:text-slate-500"
            title="顯示上一個群組"
          >
            <ChevronUp className="h-3.5 w-3.5 shrink-0" />
            <span className="whitespace-nowrap">上一個群組</span>
          </button>
          <button
            type="button"
            onClick={() => navigateGroupPanel(1)}
            disabled={selectedAdminFilter !== 'all'}
            aria-label="顯示下一個群組"
            className="flex h-full w-[92px] shrink-0 items-center justify-center gap-1 border-r border-orange-300/30 bg-gradient-to-r from-orange-600/85 to-amber-500/80 px-2 text-[10px] font-bold text-white shadow-sm shadow-orange-950/30 transition-all hover:from-orange-500 hover:to-amber-400 active:from-orange-700 active:to-amber-600 disabled:cursor-not-allowed disabled:border-slate-700/60 disabled:bg-slate-800/80 disabled:bg-none disabled:text-slate-500"
            title="顯示下一個群組"
          >
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            <span className="whitespace-nowrap">下一個群組</span>
          </button>
          <button
            type="button"
            onClick={() => setAllGroupsExpanded(true)}
            disabled={selectedAdminFilter !== 'all'}
            aria-label="展開全部群組"
            className="flex h-full w-[108px] shrink-0 items-center justify-center gap-1.5 border-r border-emerald-300/25 bg-gradient-to-r from-emerald-600/85 to-green-500/75 px-2 text-[11px] font-bold text-white shadow-sm shadow-emerald-950/30 transition-all hover:from-emerald-500 hover:to-green-400 active:from-emerald-700 active:to-green-600 disabled:cursor-not-allowed disabled:border-slate-700/60 disabled:bg-slate-800/80 disabled:bg-none disabled:text-slate-500"
            title="展開全部群組"
          >
            <ChevronsDown className="h-4 w-4 shrink-0" />
            <span className="whitespace-nowrap">全部展開</span>
          </button>
          <button
            type="button"
            onClick={() => setAllGroupsExpanded(false)}
            disabled={selectedAdminFilter !== 'all'}
            aria-label="收合全部群組"
            className="flex h-full w-[108px] shrink-0 items-center justify-center gap-1.5 border-r border-rose-300/25 bg-gradient-to-r from-rose-600/85 to-red-500/75 px-2 text-[11px] font-bold text-white shadow-sm shadow-rose-950/30 transition-all hover:from-rose-500 hover:to-red-400 active:from-rose-700 active:to-red-600 disabled:cursor-not-allowed disabled:border-slate-700/60 disabled:bg-slate-800/80 disabled:bg-none disabled:text-slate-500"
            title="收合全部群組"
          >
            <ChevronsUp className="h-4 w-4 shrink-0" />
            <span className="whitespace-nowrap">全部收合</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setAdminFilterOpen(false);
              setCreateSecondaryAdminError(null);
              setShowCreateSecondaryAdmin(true);
            }}
            className="flex h-full w-[220px] shrink-0 items-center justify-center gap-2 border-l border-cyan-300/20 bg-gradient-to-r from-blue-600/80 to-cyan-600/80 px-4 text-xs font-semibold text-white transition-all hover:from-blue-500 hover:to-cyan-500 active:from-blue-700 active:to-cyan-700"
            title="建立次要管理員"
          >
            <UserPlus className="h-4 w-4" />
            新增次要管理員
          </button>
          <div className="w-px h-5 bg-cyan-300/30 shrink-0" />
          <div className="flex h-full w-[100px] shrink-0 items-center justify-center gap-1.5 bg-cyan-500/15 px-3">
            <Clock className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
            <span className="text-sm text-cyan-100 font-mono font-bold tabular-nums w-[40px] text-center">{formatCountdown()}s</span>
          </div>
          <button
            type="button"
            onClick={() => { if (!loading && !isRefreshing && !statsLoading) void guardedLoadEmployeesRef.current?.(employeeGroups.length > 0); }}
            disabled={loading || isRefreshing || statsLoading}
            aria-label={(loading || isRefreshing || statsLoading) ? '正在重新整理員工資料' : '立即重新整理員工資料'}
            aria-busy={loading || isRefreshing || statsLoading}
            className="group relative flex h-full w-20 min-w-20 shrink-0 items-center justify-center overflow-hidden bg-gradient-to-r from-blue-500 to-cyan-500 px-4 text-white shadow-sm shadow-cyan-950/30 transition-all duration-300 hover:from-blue-400 hover:to-cyan-400 hover:shadow-md hover:shadow-cyan-500/25 active:from-blue-600 active:to-cyan-600 disabled:cursor-wait disabled:opacity-90"
            title={(loading || isRefreshing || statsLoading) ? '正在重新整理員工資料……' : '立即重新整理'}
          >
            <span className={`absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent transition-opacity ${(loading || isRefreshing || statsLoading) ? 'animate-pulse opacity-100' : 'opacity-0 group-hover:opacity-60'}`} />
            <span className="relative flex h-8 w-8 items-center justify-center">
              {(loading || isRefreshing || statsLoading) && <span className="absolute h-7 w-7 animate-ping rounded-full border border-white/60 [animation-duration:1200ms]" />}
              <RefreshCw className={`h-4 w-4 drop-shadow-sm ${(loading || isRefreshing || statsLoading) ? 'animate-[spin_700ms_linear_infinite]' : 'transition-transform duration-500 group-hover:rotate-180 group-active:rotate-[270deg]'}`} />
            </span>
          </button>
        </div>
      )}

      <div
        ref={employeeGroupsScrollRef}
        className={`${admin.role === 'super_admin' ? 'employee-super-admin-scrollbar overflow-y-auto' : 'dark-panel-scroll overflow-hidden'} flex min-h-0 min-w-0 w-full flex-1 flex-col overscroll-contain`}
        style={{ scrollbarGutter: 'stable' }}
      >
        {/* Content */}
        {loading ? (
        <div className="flex min-h-[280px] flex-1 flex-col items-center justify-center gap-4 text-center text-slate-400">
          <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-300/25 bg-cyan-400/10 shadow-[0_0_30px_rgba(34,211,238,0.12)]">
            <span className="absolute inset-1 animate-ping rounded-xl border border-cyan-300/25 [animation-duration:1.6s]" />
            <Loader2 className="relative h-8 w-8 animate-spin text-cyan-300" />
          </div>
          <div>
            <p className="text-sm font-semibold text-cyan-100">正在載入員工資料</p>
            <p className="mt-1 text-[11px] text-slate-500">正在取得員工清單，請稍候……</p>
          </div>
        </div>
      ) : admin.role === 'secondary_admin' ? (
        // ===== SECONDARY ADMIN: flat list =====
        <>
          {flatFilteredEmployees.length === 0 && employeeGroups.length > 0 && employeeGroups[0].employees.length === 0 ? (
            <div className="bg-gradient-to-br from-blue-500/5 via-slate-800/40 to-slate-800/40 border-2 border-blue-500/30 shadow-lg shadow-blue-500/10 rounded-xl overflow-hidden p-8 text-center">
              <Users className="w-16 h-16 mx-auto mb-4 text-blue-500/30" />
              <p className="text-slate-400 font-medium mb-2">找不到員工</p>
              <p className="text-slate-500 text-sm mb-4">建立第一位員工以開始使用</p>
              <button
                onClick={() => { setSelectedAdminForCreate(admin.id); setShowCreateForm(true); }}
                className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-all shadow-lg shadow-blue-500/30 hover:shadow-blue-500/50 hover:scale-105"
              >
                <UserPlus className="w-5 h-5" /> 建立員工
              </button>
              {renderCreateForm(admin.id)}
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 min-h-0 flex-col">
              {/* Summary stats */}
              {(() => {
                const allEmps = employeeGroups[0]?.employees || [];
                return (
                  <div className="px-3 pb-1.5 pt-3 border-b border-blue-500/20 bg-blue-500/5">
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="inline-flex items-center gap-3 rounded-xl border border-blue-400/35 bg-gradient-to-r from-blue-950/90 via-cyan-950/65 to-slate-900 px-3 py-1 shadow-sm shadow-blue-950/40">
                        <Users className="h-4 w-4 text-cyan-300" />
                        <div className="flex min-w-[82px] flex-col">
                          <span className="text-base font-bold leading-none tabular-nums text-white">{allEmps.length}</span>
                          <span className="mt-0.5 whitespace-nowrap text-[9px] font-bold uppercase tracking-[0.12em] text-cyan-200/80">員工總數</span>
                        </div>
                        <span className="h-7 w-px bg-cyan-300/30" />
                        <div className="flex min-w-[92px] flex-col">
                          <span className="text-base font-bold leading-none tabular-nums text-cyan-100">{flatFilteredEmployees.length}</span>
                          <span className="mt-0.5 whitespace-nowrap text-[9px] font-bold uppercase tracking-[0.12em] text-cyan-200">符合篩選的員工</span>
                        </div>
                      </div>
                    {allEmps.length > 0 && (allEmps.every(employee => employee.statsLoaded) ? (
                      <>
                        <span className="text-slate-500">&bull;</span>
                        {renderSummaryFilterButton(
                          flatAdminId,
                          'today_working',
                          '今日已工作',
                          allEmps.filter(e => e.todayWorkMinutes > 0).length,

                        )}
                        <span className="text-slate-500">&bull;</span>
                        {renderSummaryFilterButton(
                          flatAdminId,
                          'new_today',
                          '今日新增',
                          allEmps.filter(e => {
                            if (!e.created_at) return false;
                            const today = new Date();
                            const created = new Date(e.created_at);
                            return created.toDateString() === today.toDateString();
                          }).length,

                        )}
                        <span className="text-slate-500">&bull;</span>
                        {renderSummaryFilterButton(
                          flatAdminId,
                          'currently_working',
                          '目前工作中',
                          allEmps.filter(e => e.workStatus === 'online').length,

                        )}
                      </>
                    ) : (
                      <span className="text-[10px] font-medium text-slate-500">統計資料載入中……</span>
                    ))}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 flex-wrap">
                      {renderStatusFilterButtons(flatAdminId)}
                      <div className="ml-auto flex h-8 items-center gap-2">
                      <div className="group relative h-8 w-[168px] overflow-hidden rounded-xl border border-cyan-300/30 bg-gradient-to-r from-slate-950/80 via-blue-950/60 to-cyan-950/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_3px_10px_rgba(2,6,23,0.28)] transition-all focus-within:border-cyan-200/70 focus-within:from-blue-950/90 focus-within:via-cyan-950/55 focus-within:to-blue-950/65 focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_0_14px_rgba(34,211,238,0.16)]">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-cyan-300/80 transition-all duration-200 group-focus-within:scale-110 group-focus-within:text-cyan-100" />
                        <input
                          type="text"
                          value={searchTerm}
                          onChange={(e) => handleSearchTermChange(e.target.value)}
                          placeholder="搜尋員工……"
                          autoComplete="off"
                          className="h-full w-full bg-transparent pl-8 pr-8 text-[11px] font-semibold tracking-wide text-cyan-50 placeholder:text-slate-400/80 outline-none transition-colors focus:bg-white/[0.035]"
                        />
                        {searchTerm && (
                          <button type="button" onClick={() => handleSearchTermChange('')} aria-label="清除員工搜尋" className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md border border-transparent text-cyan-200/70 transition-all hover:border-cyan-300/30 hover:bg-cyan-300/15 hover:text-cyan-50">
                            <X className="h-3 w-3" />
                          </button>
                        )}
                        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-gradient-to-r from-cyan-300 via-blue-400 to-transparent transition-transform duration-300 group-focus-within:scale-x-100" />
                      </div>
                      <div className="flex h-8 items-center overflow-hidden rounded-lg border border-cyan-300/45 bg-cyan-950/35 shadow-sm shadow-cyan-950/30">
                        <div className="flex h-full w-[82px] items-center justify-center gap-1.5 border-r border-cyan-300/30 bg-cyan-500/15 px-2">
                          <Clock className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                          <span className="text-xs text-cyan-100 font-mono font-bold tabular-nums w-[34px] text-center">{formatCountdown()}s</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => { if (!loading && !isRefreshing && !statsLoading) void guardedLoadEmployeesRef.current?.(employeeGroups.length > 0); }}
                          disabled={loading || isRefreshing || statsLoading}
                          aria-label={(loading || isRefreshing || statsLoading) ? '正在重新整理員工資料' : '立即重新整理員工資料'}
                          aria-busy={loading || isRefreshing || statsLoading}
                          className="group relative flex h-full min-w-10 items-center justify-center overflow-hidden bg-gradient-to-r from-blue-500 to-cyan-500 px-2.5 text-white shadow-sm shadow-cyan-950/30 transition-all duration-300 hover:from-blue-400 hover:to-cyan-400 hover:shadow-md hover:shadow-cyan-500/25 active:from-blue-600 active:to-cyan-600 disabled:cursor-wait disabled:opacity-90"
                          title={(loading || isRefreshing || statsLoading) ? '正在重新整理員工資料……' : '立即重新整理'}
                        >
                          <span className={`absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent transition-opacity ${(loading || isRefreshing || statsLoading) ? 'animate-pulse opacity-100' : 'opacity-0 group-hover:opacity-60'}`} />
                          <span className="relative flex h-7 w-7 items-center justify-center">
                            {(loading || isRefreshing || statsLoading) && <span className="absolute h-6 w-6 animate-ping rounded-full border border-white/60 [animation-duration:1200ms]" />}
                            <RefreshCw className={`h-4 w-4 drop-shadow-sm ${(loading || isRefreshing || statsLoading) ? 'animate-[spin_700ms_linear_infinite]' : 'transition-transform duration-500 group-hover:rotate-180 group-active:rotate-[270deg]'}`} />
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                );
              })()}
              {/* Controls */}
              <div className="flex min-h-8 items-center gap-2 border-b border-blue-500/30 bg-blue-500/5 px-3 py-0.5">
                {getGroupTags(flatAdminId).length > 0 && (
                  <div className="min-w-0 flex-1 overflow-x-auto scrollbar-hide">
                    <div className="flex w-max min-w-full items-center gap-1.5">
                      <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-yellow-300">
                        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-yellow-500/20 text-yellow-300">
                          <Tag className="h-3.5 w-3.5" />
                        </span>
                        標籤：
                      </span>
                      {getGroupTags(flatAdminId).map(tag => {
                        const selectedTags = getSelectedTagsForGroup(flatAdminId);
                        const isSelected = selectedTags.includes(tag);
                        return (
                          <button key={tag} onClick={() => {
                            if (isSelected) setSelectedTagsForGroup(flatAdminId, selectedTags.filter(t => t !== tag));
                            else setSelectedTagsForGroup(flatAdminId, [...selectedTags, tag]);
                          }} className={`inline-flex h-6 shrink-0 items-center rounded-md border px-2 text-[11px] font-semibold transition-all ${isSelected ? 'border-yellow-200 bg-yellow-400 text-yellow-950 shadow-sm shadow-yellow-500/30 ring-1 ring-yellow-200/60' : 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300 hover:border-yellow-300/70 hover:bg-yellow-500/20 hover:text-yellow-100'}`}>
                            {tag}
                          </button>
                        );
                      })}
                      {getSelectedTagsForGroup(flatAdminId).length > 0 && (
                        <button onClick={() => setSelectedTagsForGroup(flatAdminId, [])} className="inline-flex h-6 shrink-0 items-center rounded-md border border-red-500/30 bg-red-600/15 px-2 text-[11px] font-semibold text-red-300 transition-colors hover:bg-red-600/30">清除</button>
                      )}
                    </div>
                  </div>
                )}
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => { setSelectedAdminForCreate(admin.id); setShowCreateForm(true); }}
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-blue-400/40 bg-blue-600/85 px-2.5 text-xs font-semibold text-white shadow-sm shadow-blue-950/40 transition-all hover:border-blue-300/60 hover:bg-blue-500 active:bg-blue-700"
                  >
                    <UserPlus className="h-3.5 w-3.5" /> 建立員工
                  </button>
                </div>
              </div>

              {renderCreateForm(admin.id)}

              {/* Table - fixed ~22 rows */}
              <div className="-ml-1 min-w-0 pl-1 overflow-x-auto overflow-y-auto overscroll-contain bg-slate-900/50 flex-1 min-h-0 dark-panel-scroll">
                <table className="w-full min-w-0 table-fixed">
                  {renderTableHeader(flatAdminId)}
                  <tbody>
                    {flatFilteredEmployees.map((emp, idx) => renderEmployeeRow(emp, idx, true))}
                  </tbody>
                </table>
                <div aria-hidden="true" className="h-4 shrink-0 border-t border-blue-300/35 bg-gradient-to-r from-blue-950/10 via-blue-500/35 to-blue-950/10 shadow-[inset_0_1px_0_rgba(96,165,250,0.55),0_-4px_14px_rgba(59,130,246,0.18)]" />
              </div>
            </div>
          )}
        </>
      ) : filteredGroups.length === 0 ? (
        <div className="text-center py-8 text-slate-400">找不到員工</div>
      ) : (
        // ===== SUPER ADMIN: grouped view =====
        <div
          key={selectedAdminFilter}
          className={`${selectedAdminFilter === 'all' ? 'space-y-0' : 'flex min-h-0 flex-1 flex-col'} animate-[fadeIn_160ms_ease-out]`}
          style={{ animationFillMode: 'both' }}
        >
          {filteredGroups.map((group, groupIndex) => {
            const isSuperGroup = group.admin.role === 'super_admin';
            return (
              <Fragment key={group.admin.id}>
              <div
                data-admin-group-id={group.admin.id}
                className={`rounded-none overflow-hidden transition-colors duration-200 ${
                  isSuperGroup
                    ? `bg-gradient-to-br from-yellow-500/5 via-slate-800/40 to-slate-800/40 border-2 border-yellow-500/30 shadow-lg shadow-yellow-500/10 ${selectedAdminFilter !== 'all' && expandedGroups.has(group.admin.id) ? 'flex min-h-0 flex-1 flex-col' : ''}`
                    : `bg-gradient-to-br from-blue-500/5 via-slate-800/40 to-slate-800/40 border-2 border-blue-500/30 shadow-lg shadow-blue-500/10 ${selectedAdminFilter !== 'all' && expandedGroups.has(group.admin.id) ? 'flex min-h-0 flex-1 flex-col' : ''}`
                }`}
              >
                {/* Group header */}
                <div className={`w-full flex items-center justify-between gap-3 px-4 py-2 transition-all ${isSuperGroup ? 'hover:bg-yellow-500/10' : 'hover:bg-blue-500/10'}`}>
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {group.admin.role === 'secondary_admin' && (
                      <button
                        onClick={() => toggleAdminPin(group.admin.id, group.admin.is_pinned || false)}
                        disabled={pinningAdminId !== null}
                        aria-busy={pinningAdminId === group.admin.id}
                        className={`shrink-0 rounded-lg border p-1.5 shadow-none transition-colors active:scale-95 disabled:cursor-wait disabled:opacity-70 ${
                          group.admin.is_pinned
                            ? 'border-amber-400/70 bg-amber-600 text-amber-50 hover:bg-amber-500'
                            : 'border-slate-600 bg-slate-700 text-slate-300 hover:border-amber-400/60 hover:bg-slate-600 hover:text-amber-100'
                        }`}
                        title={group.admin.is_pinned ? '取消釘選管理員群組' : '將管理員群組釘選至頂端'}
                      >
                        <Pin className={`h-4 w-4 ${group.admin.is_pinned ? 'fill-current rotate-12' : ''}`} />
                      </button>
                    )}
                    <div onClick={() => toggleGroup(group.admin.id)} className={`shrink-0 cursor-pointer rounded-lg p-1.5 ${isSuperGroup ? 'bg-yellow-500/20' : 'bg-blue-500/20'}`}>
                      <Users className={`h-5 w-5 ${isSuperGroup ? 'text-yellow-400' : 'text-blue-400'}`} />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <div onClick={() => toggleGroup(group.admin.id)} className="order-2 flex shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-slate-600/90 bg-slate-900/85 px-2.5 py-1.5 transition-all hover:border-slate-400/80 hover:bg-slate-800 hover:shadow-[0_0_16px_rgba(59,130,246,0.18)]">
                        <span className={`max-w-[150px] truncate text-sm font-bold ${isSuperGroup ? 'text-yellow-100' : 'text-cyan-100'}`}>{group.admin.username}</span>
                        <span className="h-3.5 w-px bg-slate-600" />
                        <span className={`inline-flex items-center gap-1 text-[10px] font-bold tracking-wide ${isSuperGroup ? 'text-yellow-300' : 'text-cyan-300'}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${isSuperGroup ? 'bg-yellow-400' : 'bg-cyan-400'}`} />
                          {isSuperGroup ? '超級管理員' : '次要管理員'}
                        </span>
                        {group.admin.is_pinned && (
                          <>
                            <span className="h-3.5 w-px bg-slate-600" />
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-wide text-amber-300">
                              <Pin className="h-3 w-3" />
                              已釘選
                            </span>
                          </>
                        )}
                      </div>
                      <div className="flex min-w-0 items-center gap-2 flex-wrap">
                        {(() => {
                          const originalGroup = employeeGroups.find(g => g.admin.id === group.admin.id);
                          const allEmps = originalGroup?.employees || [];
                          return (
                            <>
                              <div className={`inline-flex items-center gap-3 rounded-xl border px-3 py-1 shadow-sm ${isSuperGroup ? 'border-yellow-400/35 bg-gradient-to-r from-yellow-950/90 via-amber-950/60 to-slate-900 shadow-yellow-950/30' : 'border-blue-400/35 bg-gradient-to-r from-blue-950/90 via-cyan-950/60 to-slate-900 shadow-blue-950/30'}`}>
                                <Users className={`h-4 w-4 ${isSuperGroup ? 'text-yellow-300' : 'text-cyan-300'}`} />
                                <div className="flex min-w-[82px] flex-col">
                                  <span className="text-base font-bold leading-none tabular-nums text-white">{allEmps.length}</span>
                                  <span className={`mt-0.5 whitespace-nowrap text-[9px] font-bold uppercase tracking-[0.12em] ${isSuperGroup ? 'text-yellow-200/80' : 'text-cyan-200/80'}`}>員工總數</span>
                                </div>
                                <span className={`h-7 w-px ${isSuperGroup ? 'bg-yellow-300/30' : 'bg-cyan-300/30'}`} />
                                <div className="flex min-w-[92px] flex-col">
                                  <span className={`text-base font-bold leading-none tabular-nums ${isSuperGroup ? 'text-yellow-100' : 'text-cyan-100'}`}>{group.employees.length}</span>
                                  <span className={`mt-0.5 whitespace-nowrap text-[9px] font-bold uppercase tracking-[0.12em] ${isSuperGroup ? 'text-yellow-200' : 'text-cyan-200'}`}>符合篩選的員工</span>
                                </div>
                              </div>
                              {allEmps.length > 0 && (
                                <>
                                  <span className="text-slate-500">•</span>
                                  {renderSummaryFilterButton(
                                    group.admin.id,
                                    'today_working',
                                    '今日已工作',
                                    allEmps.filter(e => e.todayWorkMinutes > 0).length,
          
                                  )}
                                  <span className="text-slate-500">•</span>
                                  {renderSummaryFilterButton(
                                    group.admin.id,
                                    'new_today',
                                    '今日新增',
                                    allEmps.filter(e => {
                                      if (!e.created_at) return false;
                                      const today = new Date();
                                      const created = new Date(e.created_at);
                                      return created.toDateString() === today.toDateString();
                                    }).length,
          
                                  )}
                                  <span className="text-slate-500">•</span>
                                  {renderSummaryFilterButton(
                                    group.admin.id,
                                    'currently_working',
                                    '目前工作中',
                                    allEmps.filter(e => e.workStatus === 'online').length,

                                  )}
                                </>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div onClick={() => toggleGroup(group.admin.id)} className="cursor-pointer">
                      {expandedGroups.has(group.admin.id) ? (
                        <ChevronUp className={`w-6 h-6 ${isSuperGroup ? 'text-yellow-400' : 'text-blue-400'}`} />
                      ) : (
                        <ChevronDown className={`w-6 h-6 ${isSuperGroup ? 'text-yellow-400' : 'text-blue-400'}`} />
                      )}
                    </div>
                  </div>
                </div>

                {expandedGroups.has(group.admin.id) && (
                  <>
                    {renderCreateForm(group.admin.id, group.admin)}

                    <div className={`flex min-h-8 items-center border-b px-4 py-0.5 ${isSuperGroup ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-blue-500/30 bg-blue-500/5'}`}>
                      <div className="min-w-0 flex-1 -translate-y-0.5 overflow-x-auto scrollbar-hide">
                        {renderStatusFilterButtons(group.admin.id)}
                      </div>
                      <button
                        type="button"
                        onClick={() => { setSelectedAdminForCreate(group.admin.id); setShowCreateForm(true); setExpandedGroups(prev => new Set(prev).add(group.admin.id)); }}
                        className="ml-auto inline-flex h-7 shrink-0 -translate-y-0.5 items-center gap-1.5 rounded-lg border border-yellow-400/50 bg-yellow-600/80 px-2.5 py-1 text-[11px] font-semibold text-yellow-50 shadow-lg shadow-yellow-950/30 transition-all hover:border-yellow-300/70 hover:bg-yellow-500 active:bg-yellow-700"
                      >
                        <UserPlus className="h-3.5 w-3.5" /> 新增
                      </button>
                    </div>
                    <div className={`flex min-h-8 flex-wrap items-center gap-2 border-b px-4 py-0.5 ${isSuperGroup ? 'border-yellow-500/20 bg-yellow-500/5' : 'border-blue-500/20 bg-blue-500/5'}`}>
                      {getGroupTags(group.admin.id).length > 0 && (
                        <div className="min-w-0 flex-1 overflow-x-auto scrollbar-hide">
                          <div className="flex w-max min-w-full items-center gap-1.5">
                            <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-yellow-300">
                              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-yellow-500/20 text-yellow-300">
                                <Tag className="h-3.5 w-3.5" />
                              </span>
                              標籤：
                            </span>
                            {getGroupTags(group.admin.id).map(tag => {
                              const selectedTags = getSelectedTagsForGroup(group.admin.id);
                              const isSelected = selectedTags.includes(tag);
                              return (
                                <button key={tag} onClick={() => {
                                  if (isSelected) setSelectedTagsForGroup(group.admin.id, selectedTags.filter(t => t !== tag));
                                  else setSelectedTagsForGroup(group.admin.id, [...selectedTags, tag]);
                                }} className={`inline-flex h-6 shrink-0 items-center rounded-md border px-2 text-[11px] font-semibold transition-all ${isSelected ? 'border-yellow-200 bg-yellow-400 text-yellow-950 shadow-sm shadow-yellow-500/30 ring-1 ring-yellow-200/60' : 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300 hover:border-yellow-300/70 hover:bg-yellow-500/20 hover:text-yellow-100'}`}>
                                  {tag}
                                </button>
                              );
                            })}
                            {getSelectedTagsForGroup(group.admin.id).length > 0 && (
                              <button onClick={() => setSelectedTagsForGroup(group.admin.id, [])} className="inline-flex h-6 shrink-0 items-center rounded-md border border-red-500/30 bg-red-600/15 px-2 text-[11px] font-semibold text-red-300 transition-colors hover:bg-red-600/30">清除</button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    {group.employees.length > 0 ? (
                      <div className={`-ml-1 pl-1 overflow-x-auto overflow-y-auto overscroll-contain bg-slate-900/50 min-h-[300px] dark-panel-scroll ${selectedAdminFilter !== 'all' ? 'min-h-0 flex-1' : 'max-h-[calc(100vh-160px)]'}`}>
                        <table className="w-full min-w-0 table-fixed">
                          {renderTableHeader(group.admin.id)}
                          <tbody>{employeeRowsByGroup.get(group.admin.id)}</tbody>
                        </table>
                        <div aria-hidden="true" className="h-4 shrink-0 border-t border-blue-300/35 bg-gradient-to-r from-blue-950/10 via-blue-500/35 to-blue-950/10 shadow-[inset_0_1px_0_rgba(96,165,250,0.55),0_-4px_14px_rgba(59,130,246,0.18)]" />
                      </div>
                    ) : (
                      <div className={`py-8 text-center ${selectedAdminFilter !== 'all' ? `flex flex-1 flex-col items-center justify-center ${isSuperGroup ? 'bg-yellow-500/5' : 'bg-blue-500/5'}` : isSuperGroup ? 'bg-yellow-500/5' : 'bg-blue-500/5'}`}>
                        <p className="text-slate-400 text-sm">沒有員工符合目前的篩選條件</p>
                      </div>
                    )}
                  </>
                )}
              </div>
              {groupIndex < filteredGroups.length - 1 && (
                <div
                  aria-hidden="true"
                  className="h-4 shrink-0 border-y border-blue-900/60 bg-gradient-to-r from-[#020617] via-[#071a35] to-[#020617] shadow-[inset_0_1px_0_rgba(30,64,175,0.18),inset_0_-1px_0_rgba(2,6,23,0.95)]"
                />
              )}
              </Fragment>
            );
          })}
        </div>
        )}
      </div>

      {/* ===== MODALS ===== */}

      {editingEmployee && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md animate-in fade-in duration-200" onClick={() => setEditingEmployee(null)}>
          <div className="relative w-full max-w-lg overflow-hidden rounded-[1.75rem] border border-blue-300/25 bg-gradient-to-b from-slate-900 via-slate-900 to-blue-950/35 shadow-[0_24px_90px_rgba(2,6,23,0.78)] ring-1 ring-inset ring-white/10 animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            <div className="relative overflow-hidden rounded-t-[1.75rem] border-b border-blue-300/15 bg-gradient-to-r from-blue-950/80 via-cyan-950/35 to-slate-900/80 px-5 py-5 sm:px-6">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-500 via-cyan-300 to-blue-500" />
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-blue-300/35 bg-blue-400/15 text-blue-100 shadow-lg shadow-blue-950/35 ring-1 ring-inset ring-white/10">
                    <Pencil className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-300">帳戶資料</p>
                    <h3 className="mt-1 text-xl font-bold tracking-tight text-white">編輯員工</h3>
                    <p className="mt-1 text-xs text-blue-100/60">更新可識別資訊與內部備註。</p>
                  </div>
                </div>
                <button type="button" onClick={() => setEditingEmployee(null)} aria-label="關閉編輯員工" className="rounded-xl border border-blue-300/15 bg-slate-950/35 p-2 text-slate-400 transition-colors hover:border-blue-300/40 hover:bg-blue-400/10 hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="space-y-5 p-5 sm:p-6">
              <div className="flex items-center gap-3 rounded-2xl border border-blue-300/15 bg-slate-950/45 px-4 py-3.5 shadow-inner shadow-black/20">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-400/10 text-cyan-200">
                  <Users className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500">員工帳戶</p>
                  <p className="mt-1 truncate text-sm font-bold text-white" title={editingEmployee.username}>{editingEmployee.username}</p>
                  <p className="mt-0.5 truncate text-[11px] font-medium tracking-wide text-cyan-200/70">目前 ID：{editingEmployee.employee_id}</p>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="mb-2 flex items-center justify-between gap-3 text-xs font-bold uppercase tracking-[0.14em] text-blue-100" htmlFor="edit-employee-username">
                    使用者名稱
                    <span className="rounded-full border border-blue-300/20 bg-blue-400/10 px-2 py-0.5 text-[9px] font-semibold normal-case tracking-normal text-blue-200">登入識別</span>
                  </label>
                  <input id="edit-employee-username" type="text" value={editingEmployee.username} onChange={(e) => setEditingEmployee({ ...editingEmployee, username: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 shadow-[inset_0_1px_2px_rgba(15,23,42,0.08)] outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-400/20" />
                </div>
                <div>
                  <label className="mb-2 flex items-center justify-between gap-3 text-xs font-bold uppercase tracking-[0.14em] text-blue-100" htmlFor="edit-employee-id">
                    員工 ID
                    <span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2 py-0.5 text-[9px] font-semibold normal-case tracking-normal text-cyan-200">內部識別</span>
                  </label>
                  <input id="edit-employee-id" type="text" value={editingEmployee.employee_id} onChange={(e) => setEditingEmployee({ ...editingEmployee, employee_id: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 font-mono text-sm font-medium text-slate-900 shadow-[inset_0_1px_2px_rgba(15,23,42,0.08)] outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-400/20" />
                </div>
                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-blue-100" htmlFor="edit-employee-remarks">備註</label>
                  <input id="edit-employee-remarks" type="text" value={editingEmployee.remarks || ''} onChange={(e) => setEditingEmployee({ ...editingEmployee, remarks: e.target.value })} placeholder="輸入管理員備註……" className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 shadow-[inset_0_1px_2px_rgba(15,23,42,0.08)] outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-400/20" />
                </div>
              </div>
              <div className="flex items-start gap-2.5 rounded-xl border border-blue-300/15 bg-blue-500/5 px-3.5 py-3 text-xs leading-5 text-slate-400">
                <Pencil className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-300" />
                <span>儲存後，員工清單與相關管理檢視會同步顯示最新資料。</span>
              </div>
            </div>
            <div className="flex flex-col-reverse gap-2 overflow-hidden rounded-b-[1.75rem] border-t border-blue-300/15 bg-slate-950/45 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
              <button type="button" onClick={() => setEditingEmployee(null)} className="rounded-xl border border-slate-600/80 bg-slate-800/70 px-5 py-2.5 text-sm font-semibold text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-700 hover:text-white">取消</button>
              <button type="button" onClick={() => handleUpdateEmployee(editingEmployee.id, { username: editingEmployee.username, employee_id: editingEmployee.employee_id, remarks: editingEmployee.remarks })} className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-300/40 bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-950/35 transition-colors hover:bg-blue-500 active:bg-blue-700">
                <CheckCircle className="h-4 w-4" />
                儲存變更
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {editingRemarksOnly && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm" onClick={() => setEditingRemarksOnly(null)}>
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-blue-400/30 bg-slate-900 shadow-[0_24px_80px_rgba(2,6,23,0.65)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-blue-400/20 bg-gradient-to-r from-blue-950/80 via-slate-900 to-slate-900 px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-300/30 bg-blue-500/15 text-blue-200">
                  <Pencil className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-300/80">員工備註</p>
                  <h3 title={editingRemarksOnly.username} className="truncate text-lg font-bold text-white">{editingRemarksOnly.username}</h3>
                  <p className="truncate text-xs text-slate-400">員工 ID：{editingRemarksOnly.employee_id}</p>
                </div>
              </div>
              <button type="button" onClick={() => setEditingRemarksOnly(null)} aria-label="關閉編輯備註" className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-700/80 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">備註</label>
                <textarea
                  value={editingRemarksOnly.remarks || ''}
                  onChange={(e) => setEditingRemarksOnly({ ...editingRemarksOnly, remarks: e.target.value })}
                  rows={5}
                  placeholder="輸入此員工的內部備註……"
                  className="min-h-[132px] w-full resize-none rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm leading-6 text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15"
                />
              </div>
              <div className="flex items-start gap-2.5 rounded-xl border border-blue-400/20 bg-blue-500/5 px-3.5 py-3 text-xs text-slate-400">
                <Pencil className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-300" />
                <span>此備註會顯示給員工清單中的管理員。</span>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-700/70 pt-4">
                <button type="button" onClick={() => setEditingRemarksOnly(null)} className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-700 hover:text-white">取消</button>
                <button type="button" onClick={() => { handleUpdateEmployee(editingRemarksOnly.id, { remarks: editingRemarksOnly.remarks }); setEditingRemarksOnly(null); }} className="inline-flex items-center gap-2 rounded-lg border border-blue-400/50 bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-950/40 transition-all hover:bg-blue-500 active:bg-blue-700">
                  <CheckCircle className="h-4 w-4" />
                  儲存備註
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showPasswordReset && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md animate-in fade-in duration-200" onClick={() => { if (!resettingPassword) { setShowPasswordReset(null); setNewPassword(''); setShowResetPassword(false); } }}>
          <div className="relative w-full max-w-lg overflow-hidden rounded-[1.75rem] border border-amber-300/25 bg-gradient-to-b from-slate-900 via-slate-900 to-amber-950/25 shadow-[0_24px_90px_rgba(2,6,23,0.78)] ring-1 ring-inset ring-white/10 animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            <div className="relative overflow-hidden rounded-t-[1.75rem] border-b border-amber-300/15 bg-gradient-to-r from-amber-950/80 via-orange-950/30 to-slate-900/80 px-5 py-5 sm:px-6">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-500 via-yellow-200 to-orange-500" />
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-amber-300/35 bg-amber-400/15 text-amber-100 shadow-lg shadow-amber-950/35 ring-1 ring-inset ring-white/10">
                    <Key className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">安全控制</p>
                    <h3 className="mt-1 text-xl font-bold tracking-tight text-white">修改登入密碼</h3>
                    <p className="mt-1 text-xs text-amber-100/60">更新後，舊密碼與既有會話將立即失效。</p>
                  </div>
                </div>
                <button type="button" onClick={() => { setShowPasswordReset(null); setNewPassword(''); setShowResetPassword(false); }} disabled={resettingPassword} aria-label="關閉修改密碼" className="rounded-xl border border-amber-300/15 bg-slate-950/35 p-2 text-slate-400 transition-colors hover:border-amber-300/40 hover:bg-amber-400/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="space-y-5 p-5 sm:p-6">
              <div className="flex items-center gap-3 rounded-2xl border border-amber-300/15 bg-slate-950/45 px-4 py-3.5 shadow-inner shadow-black/20">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-300/25 bg-amber-400/10 text-amber-200">
                  <Users className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500">目標員工帳戶</p>
                  <p className="mt-1 truncate text-base font-bold text-white" title={showPasswordReset.username}>{showPasswordReset.username}</p>
                  <p className="mt-0.5 text-[11px] font-medium tracking-wide text-amber-200/70">密碼變更需要重新登入</p>
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label className="text-xs font-bold uppercase tracking-[0.14em] text-amber-100" htmlFor="reset-employee-password">新密碼</label>
                  <span className="rounded-full border border-amber-300/20 bg-amber-400/10 px-2 py-0.5 text-[9px] font-semibold text-amber-200">至少 6 位</span>
                </div>
                <div className="flex gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Key className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-amber-300/70" />
                    <input id="reset-employee-password" type={showResetPassword ? 'text' : 'password'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="輸入新密碼" autoComplete="new-password" minLength={6} disabled={resettingPassword} className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-11 text-sm font-medium text-slate-900 shadow-[inset_0_1px_2px_rgba(15,23,42,0.08)] outline-none transition-colors placeholder:text-slate-400 focus:border-amber-400 focus:bg-white focus:ring-4 focus:ring-amber-300/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 disabled:opacity-100" />
                    <button type="button" onClick={() => setShowResetPassword(!showResetPassword)} disabled={resettingPassword} aria-label={showResetPassword ? '隱藏密碼' : '顯示密碼'} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-amber-400/10 hover:text-amber-100 disabled:cursor-not-allowed disabled:opacity-50">
                      {showResetPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <button type="button" onClick={generateResetPassword} disabled={resettingPassword} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-300/25 bg-amber-400/10 text-amber-200 transition-all hover:border-amber-200/50 hover:bg-amber-400/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-50" title="產生高強度密碼" aria-label="產生高強度密碼">
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-300/15 bg-amber-400/5 px-3.5 py-3 text-xs leading-5 text-slate-400">
                <Key className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
                <span>重設完成後，員工必須使用新密碼重新登入；系統也會撤銷目前的員工工作會話。</span>
              </div>
            </div>
            <div className="flex flex-col-reverse gap-2 overflow-hidden rounded-b-[1.75rem] border-t border-amber-300/15 bg-slate-950/45 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
              <button type="button" onClick={() => { setShowPasswordReset(null); setNewPassword(''); setShowResetPassword(false); }} disabled={resettingPassword} className="rounded-xl border border-slate-600/80 bg-slate-800/70 px-5 py-2.5 text-sm font-semibold text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50">取消</button>
              <button type="button" onClick={() => { if (showPasswordReset) void handleResetPassword(showPasswordReset.id); }} disabled={resettingPassword || newPassword.length < 6} className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-200/50 bg-amber-500 px-5 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-amber-950/35 transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50">
                {resettingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                {resettingPassword ? '重設中…' : '確認修改'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {editingCreatedAt && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md animate-in fade-in duration-200" onClick={closeRegistrationDateEditor}>
          <div className="relative w-full max-w-lg overflow-visible rounded-[1.75rem] border border-cyan-300/25 bg-gradient-to-b from-slate-900 via-slate-900 to-blue-950/35 shadow-[0_24px_90px_rgba(2,6,23,0.78)] ring-1 ring-inset ring-white/10 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="relative overflow-hidden rounded-t-[1.75rem] border-b border-cyan-300/15 bg-gradient-to-r from-blue-950/80 via-cyan-950/35 to-slate-900/80 px-5 py-5">
              <div className="absolute inset-x-0 top-0 h-1 rounded-t-[1.75rem] bg-gradient-to-r from-blue-500 via-cyan-300 to-blue-500" />
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-300/35 bg-cyan-400/15 text-cyan-100 shadow-lg shadow-cyan-950/35 ring-1 ring-inset ring-white/10">
                    <CalendarDays className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">註冊控制</p>
                    <h3 className="mt-1 text-xl font-bold tracking-tight text-white">編輯註冊日期</h3>
                    <p className="mt-1 text-xs text-cyan-100/60">安全地更新員工帳戶時間戳。</p>
                  </div>
                </div>
                <button type="button" onClick={closeRegistrationDateEditor} aria-label="關閉編輯註冊日期" className="rounded-xl border border-cyan-300/15 bg-slate-950/35 p-2 text-slate-400 transition-colors hover:border-cyan-300/40 hover:bg-cyan-400/10 hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="relative space-y-5 p-5">
              <div className="rounded-2xl border border-cyan-300/15 bg-slate-950/45 px-4 py-3.5 shadow-inner shadow-black/20">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-300/25 bg-blue-500/10 text-blue-200">
                    <Users className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">員工帳戶</p>
                    <p title={editingCreatedAt.username} className="mt-1 truncate text-base font-bold text-white">{editingCreatedAt.username}</p>
                    <p className="mt-0.5 truncate text-xs font-medium tracking-wide text-cyan-200/70">員工 ID：{editingCreatedAt.employeeId}</p>
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label htmlFor="employee-registration-date" className="text-xs font-bold uppercase tracking-[0.14em] text-cyan-100">註冊日期</label>
                  <span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-200">僅日期</span>
                </div>
                <div ref={registrationCalendarRef} className="relative">
                  <input
                    id="employee-registration-date"
                    type="date"
                    autoComplete="off"
                    value={newCreatedAt}
                    onChange={event => {
                      const value = event.target.value;
                      setNewCreatedAt(value);
                      if (registrationDateInputError) setRegistrationDateInputError(null);
                      if (isValidCalendarDate(value)) setRegistrationCalendarMonth(value.slice(0, 7));
                    }}
                    onBlur={() => {
                      if (!newCreatedAt || !isValidCalendarDate(newCreatedAt)) {
                        setRegistrationDateInputError('請輸入有效日期，格式為 YYYY-MM-DD');
                      }
                    }}
                    className={`w-full rounded-xl border bg-slate-950/75 px-4 py-3 pr-14 text-sm font-semibold tracking-wide text-white shadow-inner shadow-black/20 outline-none transition-colors [color-scheme:dark] focus:ring-4 ${registrationDateInputError ? 'border-rose-400/70 focus:border-rose-300 focus:ring-rose-400/10' : 'border-cyan-300/30 focus:border-cyan-300/75 focus:ring-cyan-400/10'}`}
                  />
                  <button
                    type="button"
                    aria-label="開啟日期選擇器"
                    aria-haspopup="dialog"
                    aria-expanded={registrationCalendarOpen}
                    onClick={() => {
                      if (isValidCalendarDate(newCreatedAt)) setRegistrationCalendarMonth(newCreatedAt.slice(0, 7));
                      setRegistrationCalendarOpen(open => !open);
                    }}
                    className={`absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg border transition-colors ${registrationCalendarOpen ? 'border-cyan-300/60 bg-cyan-400/15 text-cyan-100' : 'border-cyan-300/20 bg-cyan-400/5 text-cyan-300 hover:border-cyan-300/50 hover:bg-cyan-400/15 hover:text-white'}`}
                  >
                    <CalendarDays className="h-4 w-4" />
                  </button>

                  {registrationCalendarOpen && (
                    <div className="absolute left-0 right-0 top-full z-[100] mt-2 h-[410px] overflow-hidden rounded-2xl border border-cyan-300/30 bg-gradient-to-b from-slate-800 via-blue-950 to-slate-950 shadow-[0_18px_50px_rgba(2,6,23,0.72)] ring-1 ring-inset ring-white/10 xl:left-full xl:right-auto xl:top-0 xl:mt-0 xl:ml-3 xl:w-[310px]">
                      <div className="h-1 bg-gradient-to-r from-blue-500 via-cyan-300 to-blue-500" />
                      <div className="flex items-center justify-between border-b border-cyan-300/15 bg-gradient-to-r from-blue-950/80 via-cyan-950/35 to-slate-900/80 px-3.5 py-3">
                        <button
                          type="button"
                          aria-label="上個月"
                          onClick={() => {
                            const previousMonth = new Date(calendarYear, calendarMonthNumber - 2, 1);
                            setRegistrationCalendarMonth(getCalendarMonthKey(previousMonth));
                          }}
                          className="rounded-lg border border-cyan-300/15 bg-slate-950/30 p-1.5 text-cyan-200 transition-colors hover:border-cyan-300/40 hover:bg-cyan-400/10 hover:text-white"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                        <div className="text-center">
                          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">日期選擇</p>
                          <p className="mt-0.5 text-sm font-bold text-white">{calendarMonthLabel}</p>
                        </div>
                        <button
                          type="button"
                          aria-label="下個月"
                          onClick={() => {
                            const nextMonth = new Date(calendarYear, calendarMonthNumber, 1);
                            setRegistrationCalendarMonth(getCalendarMonthKey(nextMonth));
                          }}
                          className="rounded-lg border border-cyan-300/15 bg-slate-950/30 p-1.5 text-cyan-200 transition-colors hover:border-cyan-300/40 hover:bg-cyan-400/10 hover:text-white"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="p-3.5">
                        <div className="mb-2 grid grid-cols-7 text-center text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          {['日', '一', '二', '三', '四', '五', '六'].map(day => <span key={day}>{day}</span>)}
                        </div>
                        <div className="grid grid-cols-7 gap-1">
                          {calendarCells.map((day, index) => {
                            if (!day) return <span key={`empty-${index}`} className="h-9" />;
                            const dateKey = `${registrationCalendarMonth}-${String(day).padStart(2, '0')}`;
                            const isSelected = newCreatedAt === dateKey;
                            const isToday = todayDateKey === dateKey;
                            return (
                              <button
                                key={dateKey}
                                type="button"
                                aria-label={`選擇 ${formatCalendarDateLabel(dateKey)}`}
                                aria-pressed={isSelected}
                                onClick={() => {
                                  setNewCreatedAt(dateKey);
                                  setRegistrationDateInputError(null);
                                  setRegistrationCalendarOpen(false);
                                }}
                                className={`relative h-9 rounded-lg text-xs font-semibold transition-colors ${
                                  isSelected
                                    ? 'bg-cyan-500 text-slate-950 shadow-lg shadow-cyan-950/40'
                                    : isToday
                                      ? 'border border-amber-300/50 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20'
                                      : 'text-slate-200 hover:bg-cyan-400/15 hover:text-white'
                                }`}
                              >
                                {day}
                                {isToday && !isSelected && <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-amber-300" />}
                              </button>
                            );
                          })}
                        </div>
                        <div className="mt-3 flex items-center justify-between border-t border-cyan-300/15 pt-3">
                          <button
                            type="button"
                            onClick={() => {
                              const now = new Date();
                              setNewCreatedAt(formatWithdrawalDate(now.toISOString()));
                              setRegistrationDateInputError(null);
                              setRegistrationCalendarMonth(getCalendarMonthKey(now));
                              setRegistrationCalendarOpen(false);
                            }}
                            className="rounded-lg border border-amber-300/25 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-200 transition-colors hover:border-amber-300/50 hover:bg-amber-400/20"
                          >
                            今天
                          </button>
                          <button
                            type="button"
                            onClick={() => setRegistrationCalendarOpen(false)}
                            className="text-xs font-semibold text-cyan-200 transition-colors hover:text-white"
                          >
                            完成
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <p className={`mt-2 flex items-center gap-1.5 text-[11px] leading-5 ${registrationDateInputError ? 'text-rose-300' : 'text-slate-500'}`}>
                  <CalendarDays className={`h-3.5 w-3.5 shrink-0 ${registrationDateInputError ? 'text-rose-300' : 'text-cyan-300/70'}`} />
                  {registrationDateInputError || '可分別調整年、月、日，或點擊右側日曆圖示選擇日期。'}
                </p>
              </div>

              <div className="flex items-start gap-2.5 rounded-xl border border-blue-300/15 bg-blue-500/5 px-3.5 py-3 text-xs leading-5 text-slate-400">
                <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-blue-300" />
                <span>The change will be saved securely and reflected in the employee details page.</span>
              </div>
            </div>

            <div className="flex flex-col-reverse gap-2 overflow-hidden rounded-b-[1.75rem] border-t border-cyan-300/15 bg-slate-950/45 px-5 py-4 sm:flex-row sm:justify-end">
              <button type="button" onClick={closeRegistrationDateEditor} className="rounded-xl border border-slate-600/80 bg-slate-800/70 px-5 py-2.5 text-sm font-semibold text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-700 hover:text-white">取消</button>
              <button
                type="button"
                disabled={savingCreatedAt}
                onClick={async () => {
                  if (!isValidCalendarDate(newCreatedAt)) {
                    setRegistrationDateInputError('請輸入有效日期，格式為 YYYY-MM-DD');
                    return;
                  }
                  setSavingCreatedAt(true);
                  try {
                    const isoDate = new Date(`${newCreatedAt}T12:00:00`).toISOString();
                    const { error } = await supabase.rpc('admin_update_employee_account', {
                      p_admin_session_token: getAdminFinancialSessionToken(),
                      p_user_id: editingCreatedAt.id,
                      p_updates: { created_at: isoDate },
                    });
                    if (!error) {
                      setEmployeeGroups(prev => prev.map(g => ({
                        ...g,
                        employees: g.employees.map(emp => emp.id === editingCreatedAt.id ? { ...emp, created_at: isoDate } : emp)
                      })));
                      closeRegistrationDateEditor();
                    } else {
                      setNotification({ show: true, type: 'error', title: '錯誤', message: '更新註冊日期失敗' });
                    }
                  } finally {
                    setSavingCreatedAt(false);
                  }
                }}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-300/35 bg-cyan-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-cyan-950/35 transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CheckCircle className="h-4 w-4" />
                {savingCreatedAt ? '儲存中……' : '儲存日期'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {pinConfirmEmployee && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-[3px]" onClick={() => setPinConfirmEmployee(null)}>
          <div className="relative w-full max-w-md overflow-hidden rounded-[26px] border border-amber-200/25 bg-[#0b1724] shadow-[0_24px_90px_rgba(2,12,27,0.68)]" onClick={e => e.stopPropagation()}>
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(251,191,36,0.18),transparent_38%),linear-gradient(135deg,rgba(15,23,42,0.98),rgba(10,31,46,0.96))]" />
            <div className="relative border-b border-white/10 px-5 pb-4 pt-5 sm:px-6">
              <button
                type="button"
                onClick={() => setPinConfirmEmployee(null)}
                aria-label="關閉釘選確認面板"
                className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-slate-950/35 text-slate-400 transition-all hover:border-rose-300/60 hover:bg-rose-500/20 hover:text-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/70"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="flex items-start gap-3 pr-10">
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border shadow-lg ${pinConfirmEmployee.currentPinned ? 'border-rose-300/35 bg-rose-400/15 text-rose-200 shadow-rose-950/40' : 'border-amber-300/35 bg-amber-400/15 text-amber-200 shadow-amber-950/40'}`}>
                  <Pin className={`h-5 w-5 ${pinConfirmEmployee.currentPinned ? 'rotate-45' : '-rotate-45'}`} />
                </div>
                <div className="min-w-0">
                  <p className={`text-[10px] font-bold uppercase tracking-[0.18em] ${pinConfirmEmployee.currentPinned ? 'text-rose-300/90' : 'text-amber-300/90'}`}>員工清單管理</p>
                  <h3 className="mt-1 text-xl font-bold tracking-tight text-white">{pinConfirmEmployee.currentPinned ? '取消釘選員工' : '釘選至頂端'}</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-400">{pinConfirmEmployee.currentPinned ? '此員工將恢復一般排序位置。' : '此員工將固定顯示在員工清單頂端。'}</p>
                </div>
              </div>
            </div>
            <div className="relative space-y-3 px-5 py-5 sm:px-6">
              <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500">員工帳戶</p>
                <p className="mt-1.5 truncate text-2xl font-bold tracking-tight text-white" title={pinConfirmEmployee.username}>{pinConfirmEmployee.username}</p>
                {pinConfirmEmployee.employeeId && (
                  <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-3">
                    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">員工 ID</span>
                    <span className="font-mono text-xs font-semibold tracking-wide text-cyan-200">{pinConfirmEmployee.employeeId}</span>
                  </div>
                )}
              </div>
              <p className="px-1 text-xs leading-5 text-slate-400">
                {pinConfirmEmployee.currentPinned ? '確定要取消此員工的置頂狀態嗎？' : '確定要將此員工釘選到清單頂端嗎？'}
              </p>
            </div>
            <div className="relative flex flex-col-reverse gap-2 border-t border-white/10 bg-slate-950/45 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
              <button
                type="button"
                onClick={() => setPinConfirmEmployee(null)}
                className="inline-flex items-center justify-center rounded-xl border border-slate-600/80 bg-slate-800/70 px-5 py-2.5 text-sm font-semibold text-slate-300 transition-all hover:border-slate-500 hover:bg-slate-700 hover:text-white active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/70"
              >取消</button>
              <button
                type="button"
                onClick={() => { togglePin(pinConfirmEmployee.id, pinConfirmEmployee.currentPinned); setPinConfirmEmployee(null); }}
                className={`inline-flex items-center justify-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-bold shadow-lg transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 ${pinConfirmEmployee.currentPinned ? 'border-rose-200/60 bg-rose-600 text-white shadow-rose-950/40 hover:bg-rose-500 focus-visible:ring-rose-300/80' : 'border-amber-200/60 bg-amber-400 text-slate-950 shadow-amber-950/40 hover:bg-amber-300 focus-visible:ring-amber-200/80'}`}
              >
                <Pin className={`h-4 w-4 ${pinConfirmEmployee.currentPinned ? 'rotate-45' : '-rotate-45'}`} />
                {pinConfirmEmployee.currentPinned ? '取消釘選' : '釘選至頂端'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {deletingEmployee && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md animate-in fade-in duration-200" onClick={() => { if (!isDeleting) { setDeletingEmployee(null); setDeleteError(null); } }}>
          <div className="relative w-full max-w-lg overflow-hidden rounded-[1.75rem] border border-rose-300/25 bg-gradient-to-b from-slate-900 via-slate-900 to-rose-950/25 shadow-[0_24px_90px_rgba(2,6,23,0.8)] ring-1 ring-inset ring-white/10 animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            <div className="relative overflow-hidden rounded-t-[1.75rem] border-b border-rose-300/15 bg-gradient-to-r from-rose-950/85 via-red-950/35 to-slate-900/80 px-5 py-5 sm:px-6">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-rose-600 via-red-300 to-orange-400" />
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-rose-300/35 bg-rose-500/15 text-rose-100 shadow-lg shadow-rose-950/40 ring-1 ring-inset ring-white/10">
                    <Trash2 className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-rose-300">危險操作</p>
                    <h3 className="mt-1 text-xl font-bold tracking-tight text-white">刪除員工帳戶</h3>
                    <p className="mt-1 text-xs text-rose-100/60">請確認你了解此操作的不可逆性。</p>
                  </div>
                </div>
                <button type="button" onClick={() => { setDeletingEmployee(null); setDeleteError(null); }} disabled={isDeleting} aria-label="關閉刪除員工" className="rounded-xl border border-rose-300/15 bg-slate-950/35 p-2 text-slate-400 transition-colors hover:border-rose-300/40 hover:bg-rose-400/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="space-y-4 p-5 sm:p-6">
              {deleteError && (
                <div className="flex items-start gap-2.5 rounded-xl border border-rose-400/40 bg-rose-500/10 px-3.5 py-3 text-sm leading-5 text-rose-200">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
                  <span>{deleteError}</span>
                </div>
              )}
              <div className="flex items-center gap-3 rounded-2xl border border-rose-300/15 bg-slate-950/45 px-4 py-3.5 shadow-inner shadow-black/20">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-rose-300/25 bg-rose-400/10 text-rose-200">
                  <Users className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500">目標員工帳戶</p>
                  <p className="mt-1 truncate text-base font-bold text-white" title={deletingEmployee.username}>{deletingEmployee.username}</p>
                  <p className="mt-0.5 truncate text-[11px] font-mono font-medium tracking-wide text-rose-200/70">員工 ID：{deletingEmployee.employee_id}</p>
                </div>
              </div>
              <div className="rounded-2xl border border-rose-300/25 bg-rose-500/5 p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-rose-300/25 bg-rose-500/10 text-rose-200">
                    <Trash2 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white">確定要永久刪除這個員工帳戶嗎？</p>
                    <p className="mt-1 text-xs leading-5 text-rose-200/80">此操作無法復原，以下資料將一併永久移除：</p>
                  </div>
                </div>
                <ul className="mt-4 grid gap-2 border-t border-rose-300/15 pt-3 text-xs text-slate-300 sm:grid-cols-2">
                  <li className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-rose-300" />員工帳戶資訊</li>
                  <li className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-rose-300" />已提交的訂單</li>
                  <li className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-rose-300" />錢包與交易紀錄</li>
                  <li className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-rose-300" />提現申請與驗證紀錄</li>
                </ul>
              </div>
            </div>
            <div className="flex flex-col-reverse gap-2 overflow-hidden rounded-b-[1.75rem] border-t border-rose-300/15 bg-slate-950/45 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
              <button type="button" onClick={() => { setDeletingEmployee(null); setDeleteError(null); }} disabled={isDeleting} className="rounded-xl border border-slate-600/80 bg-slate-800/70 px-5 py-2.5 text-sm font-semibold text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50">取消</button>
              <button type="button" onClick={() => handleDeleteEmployee(deletingEmployee)} disabled={isDeleting} className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200/50 bg-rose-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-rose-950/40 transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50">
                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {isDeleting ? '刪除中……' : '永久刪除'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {editingTags && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm" onClick={() => { setEditingTags(null); setNewTag(''); }}>
          <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-amber-400/30 bg-slate-900 shadow-[0_24px_80px_rgba(2,6,23,0.65)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-amber-400/20 bg-gradient-to-r from-amber-950/70 via-slate-900 to-slate-900 px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-300/35 bg-amber-500/15 text-amber-200">
                  <Tag className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300/80">員工標籤</p>
                  <h3 title={editingTags.username} className="truncate text-lg font-bold text-white">{editingTags.username}</h3>
                  <p className="truncate text-xs text-slate-400">Employee ID: {editingTags.employee_id}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-amber-400/25 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200">{(editingTags.tags || []).length} 個啟用</span>
                <button type="button" onClick={() => { setEditingTags(null); setNewTag(''); }} aria-label="關閉標籤管理" className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-700/80 hover:text-white">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="space-y-4 p-5">
              <div className="rounded-xl border border-amber-400/20 bg-amber-500/5 p-4">
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-amber-200">新增標籤</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddTag(editingTags); }}
                    placeholder="輸入標籤名稱……"
                    className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-amber-500 focus:ring-4 focus:ring-amber-500/15"
                  />
                  <button type="button" onClick={() => handleAddTag(editingTags)} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-amber-400/60 bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-amber-950/30 transition-all hover:bg-amber-500 active:bg-amber-700">
                    <Tag className="h-4 w-4" />
                    新增
                  </button>
                </div>
              </div>
              <div className="rounded-xl border border-slate-700/80 bg-slate-950/45 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <label className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">目前標籤</label>
                  <span className="text-[11px] text-slate-500">變更會立即儲存</span>
                </div>
                <div className="flex min-h-[92px] flex-wrap content-start gap-2">
                  {(editingTags.tags || []).length === 0 ? (
                    <div className="flex w-full flex-col items-center justify-center gap-1.5 py-5 text-center">
                      <Tag className="h-5 w-5 text-slate-600" />
                      <p className="text-sm text-slate-500">尚未指派任何標籤</p>
                    </div>
                  ) : (
                    (editingTags.tags || []).map((tag, idx) => (
                      <span key={idx} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/35 bg-amber-500/15 px-2.5 py-1.5 text-sm font-semibold text-amber-200">
                        {tag}
                        <button type="button" onClick={() => handleRemoveTag(editingTags, tag)} aria-label={`移除 ${tag}`} className="rounded-md p-0.5 text-amber-300 transition-colors hover:bg-amber-400/25 hover:text-white">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ))
                  )}
                </div>
              </div>
              <div className="flex justify-end border-t border-slate-700/70 pt-4">
                <button type="button" onClick={() => { setEditingTags(null); setNewTag(''); }} className="rounded-lg border border-slate-600 bg-slate-800 px-5 py-2 text-sm font-semibold text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-700 hover:text-white">關閉</button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {viewingEmployee && (
        <EmployeeDetailModal
          employee={viewingEmployee}
          onClose={() => setViewingEmployee(null)}
        />
      )}

      {renderLoginIPModal()}

      {renderWalletModal()}

      {showCreateSecondaryAdmin && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !creatingSecondaryAdmin) {
              setShowCreateSecondaryAdmin(false);
              setCreateSecondaryAdminError(null);
              setSecondaryAdminForm({ username: '', password: '' });
              setShowSecondaryAdminPassword(false);
            }
          }}
        >
          <form
            onSubmit={handleCreateSecondaryAdmin}
            onMouseDown={(e) => e.stopPropagation()}
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-cyan-300/30 bg-slate-900 shadow-2xl shadow-slate-950/70"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-secondary-admin-title"
          >
            <div className="flex items-start justify-between border-b border-cyan-300/15 bg-gradient-to-r from-blue-600/20 via-cyan-500/10 to-transparent px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-400/15 text-cyan-200 ring-1 ring-cyan-300/25">
                  <UserPlus className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200/70">管理員存取權限</p>
                  <h2 id="create-secondary-admin-title" className="truncate text-lg font-semibold text-white">建立次要管理員</h2>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (creatingSecondaryAdmin) return;
                  setShowCreateSecondaryAdmin(false);
                  setCreateSecondaryAdminError(null);
                  setSecondaryAdminForm({ username: '', password: '' });
                  setShowSecondaryAdminPassword(false);
                }}
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-cyan-300/10 hover:text-cyan-100"
                aria-label="關閉建立次要管理員面板"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div className="rounded-xl border border-cyan-300/15 bg-cyan-500/5 px-3.5 py-3 text-sm text-slate-300">
                此帳戶會連結至您的管理員帳戶，並可管理指派給它的員工。
              </div>
              {createSecondaryAdminError && (
                <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-200">
                  {createSecondaryAdminError}
                </div>
              )}
              <div>
                <label htmlFor="secondary-admin-username" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">使用者名稱</label>
                <input
                  id="secondary-admin-username"
                  type="text"
                  value={secondaryAdminForm.username}
                  onChange={(e) => setSecondaryAdminForm({ ...secondaryAdminForm, username: e.target.value })}
                  disabled={creatingSecondaryAdmin}
                  required
                  autoComplete="off"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-cyan-500 focus:bg-white focus:ring-2 focus:ring-cyan-400/25 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 disabled:opacity-100"
                  placeholder="輸入管理員使用者名稱"
                />
              </div>
              <div>
                <label htmlFor="secondary-admin-password" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">密碼</label>
                <div className="relative">
                  <input
                    id="secondary-admin-password"
                    type={showSecondaryAdminPassword ? 'text' : 'password'}
                    value={secondaryAdminForm.password}
                    onChange={(e) => setSecondaryAdminForm({ ...secondaryAdminForm, password: e.target.value })}
                    disabled={creatingSecondaryAdmin}
                    required
                    minLength={6}
                    autoComplete="new-password"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 pr-11 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-cyan-500 focus:bg-white focus:ring-2 focus:ring-cyan-400/25 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 disabled:opacity-100"
                    placeholder="至少 6 個字元"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecondaryAdminPassword((visible) => !visible)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                    aria-label={showSecondaryAdminPassword ? '隱藏密碼' : '顯示密碼'}
                  >
                    {showSecondaryAdminPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="mt-1.5 text-xs text-slate-500">請使用至少 6 個字元。</p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-800 bg-slate-950/35 px-5 py-4">
              <button
                type="button"
                onClick={() => {
                  if (creatingSecondaryAdmin) return;
                  setShowCreateSecondaryAdmin(false);
                  setCreateSecondaryAdminError(null);
                  setSecondaryAdminForm({ username: '', password: '' });
                  setShowSecondaryAdminPassword(false);
                }}
                disabled={creatingSecondaryAdmin}
                className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={creatingSecondaryAdmin || !secondaryAdminForm.username.trim() || !secondaryAdminForm.password}
                className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/40 bg-gradient-to-r from-blue-600 to-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-cyan-950/30 transition-all hover:from-blue-500 hover:to-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creatingSecondaryAdmin ? (
                  <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />建立中……</>
                ) : (
                  <><UserPlus className="h-4 w-4" />建立管理員</>
                )}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {notification?.show && createPortal(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999] p-4 animate-in fade-in duration-200">
          <div className="bg-gradient-to-br from-slate-800 via-slate-800 to-slate-900 rounded-3xl border border-slate-700/50 shadow-2xl max-w-md w-full overflow-hidden relative">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-purple-500/5 pointer-events-none" />
            <div className="relative p-8 text-center border-b border-slate-700/50">
              <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 shadow-lg ${
                notification.type === 'success' ? 'bg-gradient-to-br from-green-500/20 to-green-600/20 border border-green-500/30 shadow-green-500/20' :
                notification.type === 'error' ? 'bg-gradient-to-br from-red-500/20 to-red-600/20 border border-red-500/30 shadow-red-500/20' :
                'bg-gradient-to-br from-yellow-500/20 to-yellow-600/20 border border-yellow-500/30 shadow-yellow-500/20'
              }`}>
                {notification.type === 'success' && <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>}
                {notification.type === 'error' && <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>}
                {notification.type === 'warning' && <svg className="w-8 h-8 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>}
              </div>
              <h3 className="text-2xl font-bold text-white mb-2 tracking-tight">{notification.title}</h3>
            </div>
            <div className="relative p-8">
              <p className="text-slate-300 text-base leading-relaxed text-center">{notification.message}</p>
            </div>
            <div className="relative p-6 bg-slate-900/50">
              <button onClick={() => setNotification(null)} className="w-full px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white rounded-xl font-semibold transition-all shadow-lg shadow-blue-500/40 border border-blue-500/50">確定</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {confirmDialog?.show && confirmDialogStyle && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className={`relative w-full max-w-lg overflow-hidden rounded-[1.75rem] border shadow-2xl ${confirmDialogStyle.panel}`} role="dialog" aria-modal="true" aria-labelledby="employee-status-dialog-title">
            <div className={`relative flex items-start justify-between gap-4 border-b px-5 py-4 ${confirmDialogStyle.header}`}>
              <div className="flex min-w-0 items-center gap-3">
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border shadow-lg ${confirmDialogStyle.iconShell}`}>
                  {confirmDialog.variant === 'verification' ? (
                    <CheckCircle className={`h-5 w-5 ${confirmDialogStyle.icon}`} />
                  ) : confirmDialog.nextStatus ? (
                    <CheckCircle className={`h-5 w-5 ${confirmDialogStyle.icon}`} />
                  ) : (
                    <XCircle className={`h-5 w-5 ${confirmDialogStyle.icon}`} />
                  )}
                </div>
                <div className="min-w-0">
                  <p className={`text-[10px] font-bold uppercase tracking-[0.18em] ${confirmDialogStyle.eyebrow}`}>
                    {confirmDialog.variant === 'verification' ? '驗證控制' : '工作狀態控制'}
                  </p>
                  <h3 id="employee-status-dialog-title" className="mt-1 truncate text-xl font-bold tracking-tight text-white">{confirmDialog.title}</h3>
                  <p className="mt-1 text-xs text-slate-400">套用前請確認此帳戶變更。</p>
                </div>
              </div>
              <button type="button" onClick={() => setConfirmDialog(null)} aria-label="關閉確認面板" className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div className={`rounded-2xl border px-4 py-4 ${confirmDialogStyle.message}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className={`text-[10px] font-bold uppercase tracking-[0.16em] ${confirmDialogStyle.eyebrow}`}>員工帳戶</p>
                    <div className="mt-1 flex min-w-0 items-baseline gap-3">
                      <p title={confirmDialog.employeeUsername} className={`min-w-0 truncate text-xl font-black tracking-tight ${confirmDialogStyle.icon}`}>{confirmDialog.employeeUsername}</p>
                      <span className="shrink-0 text-sm font-extrabold tracking-wide text-slate-100 drop-shadow-sm">ID {confirmDialog.employeeId || '—'}</span>
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${confirmDialogStyle.badge}`}>
                    {confirmDialog.variant === 'verification' ? '驗證' : '狀態'}
                  </span>
                </div>
                <p className="mt-3 border-t border-white/10 pt-3 text-sm leading-6 text-slate-200">{confirmDialog.message}</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
                此變更會安全儲存，並反映在員工清單中。
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-700/70 bg-slate-950/35 px-5 py-4">
              <button type="button" onClick={() => setConfirmDialog(null)} className="rounded-xl border border-slate-600 bg-slate-800 px-5 py-2.5 text-sm font-semibold text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-700 hover:text-white">取消</button>
              <button type="button" onClick={confirmDialog.onConfirm} className={`rounded-xl border px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition-all ${confirmDialogStyle.confirmButton}`}>
                {confirmDialog.nextStatus
                  ? confirmDialog.variant === 'verification' ? '驗證員工' : '啟用員工'
                  : confirmDialog.variant === 'verification' ? '取消員工驗證' : '停用員工'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
