import { Fragment, useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { UserPlus, Search, MoreVertical, CheckCircle, XCircle, Key, CreditCard as Edit, ChevronDown, ChevronUp, ChevronsDown, ChevronsUp, Trash2, Eye, EyeOff, RefreshCw, ArrowUpDown, ArrowUp, ArrowDown, Pin, Tag, X, Users, Clock, Pencil, Bell, MessageCircle, DollarSign, Headphones, Globe, Loader2, Timer, Wallet } from 'lucide-react';
import { formatSupabaseError, isSupabaseAbortError, supabase } from '../../lib/supabase';
import { hashPassword } from '../../lib/passwordHash';
import { Employee, Admin } from '../../types';
import EmployeeDetailModal from './EmployeeDetailModal';

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
  workStatus: 'online' | 'offline' | 'never_started';
  totalOrders: number;
  accountBalance: number;
  hasPendingWithdrawal: boolean;
  pendingWithdrawalAmount: number;
}

type SortField = 'totalOrders' | 'todayOrders' | 'todayCompletedOrders' | 'failedOrders' | 'walletBalance' | 'accountBalance' | 'todayCommission' | 'totalWorkMinutes' | 'todayWorkMinutes' | 'created_at';
type SummaryFilter = 'today_working' | 'new_today' | 'currently_working';

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
  ip_address: string;
  user_agent: string | null;
  created_at: string;
}

interface EmployeeManagementProps {
  admin: Admin;
  onQuickAction?: (action: 'message' | 'customerservice' | 'cccservice', employee: { id: string; username: string }) => void;
}

export default function EmployeeManagement({ admin, onQuickAction }: EmployeeManagementProps) {
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
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const expandedGroupsBeforeSearchRef = useRef<Set<string> | null>(null);
  const [deletingEmployee, setDeletingEmployee] = useState<EmployeeWithAdmin | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [pinConfirmEmployee, setPinConfirmEmployee] = useState<{id: string; username: string; currentPinned: boolean} | null>(null);
  const [editingCreatedAt, setEditingCreatedAt] = useState<{id: string; username: string; currentDate: string} | null>(null);
  const [newCreatedAt, setNewCreatedAt] = useState('');
  const [savingCreatedAt, setSavingCreatedAt] = useState(false);
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

  const [timeTick, setTimeTick] = useState(0);

  // Login IP popup state
  const [loginIPEmployee, setLoginIPEmployee] = useState<{ id: string; username: string; employeeId?: string } | null>(null);
  const [loginIPRecords, setLoginIPRecords] = useState<LoginIPRecord[]>([]);
  const [loginIPLoading, setLoginIPLoading] = useState(false);

  // Wallet adjustment popup state
  const [walletEmployee, setWalletEmployee] = useState<{ id: string; username: string; employeeId?: string } | null>(null);
  const [walletData, setWalletData] = useState<{ available: number; frozen: number } | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletAdjustData, setWalletAdjustData] = useState({ amount: '', remarks: '' });
  const [walletAdjusting, setWalletAdjusting] = useState(false);
  const [walletNotification, setWalletNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const scrollLockRef = useRef(false);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const employeeGroupsScrollRef = useRef<HTMLDivElement>(null);
  const employeeGroupsRef = useRef<EmployeeGroup[]>([]);
  employeeGroupsRef.current = employeeGroups;
  const loadInProgressRef = useRef(false);
  const pendingReloadRef = useRef(false);
  const pendingReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRefreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastUpdatedRef = useRef<Date>(new Date());

  const resetAutoRefreshTimer = (updateTimestamp = true) => {
    if (autoRefreshTimerRef.current) clearInterval(autoRefreshTimerRef.current);
    autoRefreshTimerRef.current = setInterval(() => {
      guardedLoadEmployees(true);
    }, 180000);
    if (updateTimestamp) lastUpdatedRef.current = new Date();
  };

  const schedulePendingReload = () => {
    if (pendingReloadTimerRef.current) return;
    pendingReloadTimerRef.current = setTimeout(() => {
      pendingReloadTimerRef.current = null;
      if (!pendingReloadRef.current) return;
      pendingReloadRef.current = false;
      void guardedLoadEmployees(true);
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
    guardedLoadEmployees(false);

    let realtimeReloadTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRealtimeReload = (delay: number) => {
      if (realtimeReloadTimer) clearTimeout(realtimeReloadTimer);
      realtimeReloadTimer = setTimeout(() => {
        realtimeReloadTimer = null;
        void guardedLoadEmployees(true);
      }, delay);
    };
    const debouncedStructureReload = () => scheduleRealtimeReload(800);
    const debouncedStatsReload = () => scheduleRealtimeReload(2000);
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

    const adminsSubscription = supabase
      .channel('employee_mgmt_admins')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admins' }, () => {
        debouncedStructureReload();
      })
      .subscribe();

    const usersSubscription = supabase
      .channel('employee_mgmt_users')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, (payload) => {
        if (hasRelevantEmployeeChange(payload)) debouncedStructureReload();
      })
      .subscribe();

    const walletsSubscription = supabase
      .channel('employee_mgmt_wallets')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'wallets' }, (payload) => {
        if (payload.new && payload.new.user_id) {
          const userId = payload.new.user_id;
          const available = Number(payload.new.available_balance) || 0;
          const frozen = Number(payload.new.frozen_balance) || 0;
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
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wallets' }, () => {
        debouncedStatsReload();
      })
      .subscribe();

    const ordersSubscription = supabase
      .channel('employee_mgmt_orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
        if (payload.eventType === 'UPDATE' && payload.new && payload.new.user_id) {
          const order = payload.new as any;
          const userId = order.user_id;
          setEmployeeGroups(prev => prev.map(group => ({
            ...group,
            employees: group.employees.map(emp => {
              if (emp.id !== userId) return emp;
              const wasSuccess = payload.old && (payload.old as any).status === 'success';
              const isSuccess = order.status === 'success';
              const wasFailed = payload.old && (payload.old as any).status === 'failed';
              const isFailed = order.status === 'failed';
              let todayCompletedDelta = 0;
              let failedDelta = 0;
              let commissionDelta = 0;
              if (isSuccess && !wasSuccess) {
                todayCompletedDelta = 1;
                commissionDelta = parseFloat(order.commission_amount) || 0;
              } else if (!isSuccess && wasSuccess) {
                todayCompletedDelta = -1;
                commissionDelta = -(parseFloat((payload.old as any).commission_amount) || 0);
              }
              if (isFailed && !wasFailed) failedDelta = 1;
              else if (!isFailed && wasFailed) failedDelta = -1;
              return {
                ...emp,
                todayCompletedOrders: Math.max(0, emp.todayCompletedOrders + todayCompletedDelta),
                failedOrders: Math.max(0, emp.failedOrders + failedDelta),
                todayCommission: Math.max(0, emp.todayCommission + commissionDelta),
              };
            }),
          })));
          return;
        }
        if (payload.eventType === 'INSERT' && payload.new && payload.new.user_id) {
          const order = payload.new as any;
          const userId = order.user_id;
          setEmployeeGroups(prev => prev.map(group => ({
            ...group,
            employees: group.employees.map(emp => {
              if (emp.id !== userId) return emp;
              return {
                ...emp,
                todayOrders: emp.todayOrders + 1,
                totalOrders: emp.totalOrders + 1,
                todayCompletedOrders: order.status === 'success' ? emp.todayCompletedOrders + 1 : emp.todayCompletedOrders,
                failedOrders: order.status === 'failed' ? emp.failedOrders + 1 : emp.failedOrders,
                todayCommission: order.status === 'success' ? emp.todayCommission + (parseFloat(order.commission_amount) || 0) : emp.todayCommission,
              };
            }),
          })));
          return;
        }
        debouncedStatsReload();
      })
      .subscribe();

    const timeUpdateInterval = setInterval(() => {
      setTimeTick(tick => tick + 1);
    }, 1000);

    return () => {
      if (realtimeReloadTimer) clearTimeout(realtimeReloadTimer);
      supabase.removeChannel(adminsSubscription);
      supabase.removeChannel(usersSubscription);
      supabase.removeChannel(walletsSubscription);
      supabase.removeChannel(ordersSubscription);
      if (autoRefreshTimerRef.current) clearInterval(autoRefreshTimerRef.current);
      if (pendingReloadTimerRef.current) clearTimeout(pendingReloadTimerRef.current);
      clearInterval(timeUpdateInterval);
    };
  }, []);

  const formatTime = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}m`;
  };

  const AUTO_REFRESH_SECONDS = 180;

  const getCountdownSeconds = () => {
    void timeTick;
    const elapsed = Math.floor((Date.now() - lastUpdatedRef.current.getTime()) / 1000);
    return Math.max(0, AUTO_REFRESH_SECONDS - elapsed);
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
      resetAutoRefreshTimer(committed);
    } finally {
      loadInProgressRef.current = false;
      if (pendingReloadRef.current) schedulePendingReload();
    }
  };

  const loadEmployees = async (silent: boolean = false) => {
    const hasExistingGroups = employeeGroupsRef.current.length > 0;
    const showInitialLoading = !silent && !hasExistingGroups;
    let committed = false;

    if (showInitialLoading) setLoading(true);
    else setIsRefreshing(true);

    try {
      const now = new Date();
      const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
      const todayISO = todayUTC.toISOString();

      let employeesQuery = supabase
        .from('users')
        .select('*')
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

      // Now load all stats in parallel
      const [
        walletsResult,
        verificationsResult,
        totalOrdersResult,
        todayOrdersResult,
        todayCompletedOrdersResult,
        failedOrdersResult,
        todayCommissionResult,
        workStatusResult,
        workTimeResult,
        pendingWithdrawalsResult,
      ] = await Promise.all([
        supabase.from('wallets').select('user_id, available_balance, frozen_balance'),
        supabase.from('verification_requests').select('user_id, real_name, wallet_address, phone, email').eq('status', 'approved'),
        (async () => {
          try { return await supabase.rpc('count_orders_by_user', { user_ids: userIds }); }
          catch { return { data: null, error: null }; }
        })(),
        (async () => {
          try { return await supabase.rpc('count_today_orders_by_user', { user_ids: userIds, today_start: todayISO }); }
          catch { return { data: null, error: null }; }
        })(),
        (async () => {
          try { return await supabase.rpc('count_today_completed_orders_by_user', { user_ids: userIds, today_start: todayISO }); }
          catch { return { data: null, error: null }; }
        })(),
        (async () => {
          try { return await supabase.rpc('count_today_valid_data_failed_orders_by_user', { user_ids: userIds, today_start: todayISO }); }
          catch { return { data: null, error: null }; }
        })(),
        (async () => {
          try { return await supabase.rpc('get_today_commission_by_user', { user_ids: userIds }); }
          catch { return { data: null, error: null }; }
        })(),
        (async () => {
          try { return await supabase.rpc('get_batch_work_status', { p_user_ids: userIds }); }
          catch { return { data: null, error: null }; }
        })(),
        userIds.length > 0
          ? supabase.rpc('get_batch_work_time', { p_user_ids: userIds })
          : Promise.resolve({ data: [], error: null }),
        userIds.length > 0
          ? supabase.from('withdrawals').select('user_id, amount').in('user_id', userIds).eq('status', 'pending')
          : Promise.resolve({ data: [], error: null }),
      ]);

      // Build maps
      const walletTotalMap = new Map<string, number>();
      const walletAvailableMap = new Map<string, number>();
      walletsResult.data?.forEach((w: any) => {
        walletTotalMap.set(w.user_id, (parseFloat(w.available_balance) || 0) + (parseFloat(w.frozen_balance) || 0));
        walletAvailableMap.set(w.user_id, parseFloat(w.available_balance) || 0);
      });

      const verificationMap = new Map(
        verificationsResult.data?.map((v: any) => [v.user_id, {
          real_name: v.real_name,
          wallet_address: v.wallet_address,
          phone: v.phone,
          email: v.email
        }]) || []
      );

      const totalOrdersMap = new Map<string, number>();
      if (totalOrdersResult.data) {
        totalOrdersResult.data.forEach((row: any) => {
          totalOrdersMap.set(row.user_id, row.count || 0);
        });
      }

      const todayOrdersMap = new Map<string, number>();
      if (todayOrdersResult.data) {
        todayOrdersResult.data.forEach((row: any) => {
          todayOrdersMap.set(row.user_id, row.count || 0);
        });
      }

      const todayCompletedMap = new Map<string, number>();
      if (todayCompletedOrdersResult.data) {
        todayCompletedOrdersResult.data.forEach((row: any) => {
          todayCompletedMap.set(row.user_id, row.count || 0);
        });
      }

      const failedOrdersMap = new Map<string, number>();
      if (failedOrdersResult.data) {
        failedOrdersResult.data.forEach((row: any) => {
          failedOrdersMap.set(row.user_id, row.count || 0);
        });
      }

      const todayCommissionMap = new Map<string, number>();
      if (todayCommissionResult.data) {
        todayCommissionResult.data.forEach((row: any) => {
          todayCommissionMap.set(row.user_id, parseFloat(row.today_commission) || 0);
        });
      }

      const workStatusMap = new Map<string, string>();
      if (workStatusResult.data) {
        workStatusResult.data.forEach((row: any) => {
          workStatusMap.set(row.user_id, row.work_status);
        });
      }

      const workTimeMap = new Map<string, { total: number; today: number }>();
      if (workTimeResult.data) {
        workTimeResult.data.forEach((row: any) => {
          workTimeMap.set(row.user_id, {
            total: row.total_work_minutes || 0,
            today: row.today_work_minutes || 0,
          });
        });
      }

      const pendingWithdrawalSet = new Set<string>();
      const pendingWithdrawalAmountMap = new Map<string, number>();
      if (pendingWithdrawalsResult.data) {
        pendingWithdrawalsResult.data.forEach((row: any) => {
          pendingWithdrawalSet.add(row.user_id);
          pendingWithdrawalAmountMap.set(row.user_id, (pendingWithdrawalAmountMap.get(row.user_id) || 0) + Number(row.amount || 0));
        });
      }

      const adminMap = new Map(admins.map((a: any) => [a.id, a]));

      const groups = new Map<string, EmployeeGroup>();
      admins.forEach((adminInfo: any) => {
        groups.set(adminInfo.id, {
          admin: adminInfo,
          employees: []
        });
      });

      employees.forEach((emp: Employee) => {
        const adminInfo = adminMap.get(emp.created_by);
        if (!adminInfo) return;

        if (!groups.has(emp.created_by)) {
          groups.set(emp.created_by, {
            admin: adminInfo,
            employees: []
          });
        }

        const wsRaw = workStatusMap.get(emp.id) || 'never_started';
        const workStatus: 'online' | 'offline' | 'never_started' =
          wsRaw === 'online' ? 'online' : wsRaw === 'offline' ? 'offline' : 'never_started';

        const wt = workTimeMap.get(emp.id);

        groups.get(emp.created_by)!.employees.push({
          ...emp,
          admin: adminInfo,
          walletBalance: walletTotalMap.get(emp.id) || 0,
          verification: verificationMap.get(emp.id) || null,
          todayOrders: todayOrdersMap.get(emp.id) || 0,
          todayCompletedOrders: todayCompletedMap.get(emp.id) || 0,
          failedOrders: failedOrdersMap.get(emp.id) || 0,
          todayCommission: todayCommissionMap.get(emp.id) || 0,
          totalWorkMinutes: wt?.total || 0,
          todayWorkMinutes: wt?.today || 0,
          workStatus,
          totalOrders: totalOrdersMap.get(emp.id) || 0,
          accountBalance: walletAvailableMap.get(emp.id) || 0,
          hasPendingWithdrawal: pendingWithdrawalSet.has(emp.id),
          pendingWithdrawalAmount: pendingWithdrawalAmountMap.get(emp.id) || 0,
        });
      });

      const groupsArray = Array.from(groups.values())
        .sort((a, b) => {
          if (a.admin.role === 'super_admin' && b.admin.role !== 'super_admin') return -1;
          if (a.admin.role !== 'super_admin' && b.admin.role === 'super_admin') return 1;
          if (a.admin.role === 'secondary_admin' && b.admin.role === 'secondary_admin') {
            if (a.admin.is_pinned && !b.admin.is_pinned) return -1;
            if (!a.admin.is_pinned && b.admin.is_pinned) return 1;
          }
          return a.admin.username.localeCompare(b.admin.username);
        });

      const currentEmployeeCount = employeeGroupsRef.current.reduce((sum, group) => sum + group.employees.length, 0);
      const nextEmployeeCount = groupsArray.reduce((sum, group) => sum + group.employees.length, 0);
      const hasIncompleteSilentResult = silent
        && currentEmployeeCount > 0
        && nextEmployeeCount === 0
        && (admins.length === 0 || employees.length > 0);
      if (hasIncompleteSilentResult) return false;

      setEmployeeGroups(groupsArray);
      setAdminPinOverrides(new Map());
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
      if (showInitialLoading) setLoading(false);
      else setIsRefreshing(false);
    }
    return committed;
  };

  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);

    try {
      if (!formData.username.trim()) throw new Error('Username is required');
      if (formData.password.length < 6) throw new Error('Password must be at least 6 characters');
      if (!formData.employeeId.trim()) throw new Error('Employee ID is required');

      const hashedPassword = await hashPassword(formData.password);
      const createdBy = admin.role === 'secondary_admin'
        ? admin.id
        : (selectedAdminForCreate || admin.id);

      const { data, error } = await supabase.from('users').insert({
        username: formData.username.trim(),
        password_hash: hashedPassword,
        employee_id: formData.employeeId.trim(),
        created_by: createdBy,
        remarks: formData.remarks.trim(),
      }).select();

      if (error) {
        if (error.code === '23505') {
          if (error.message.includes('username')) throw new Error('Username already exists');
          if (error.message.includes('employee_id')) throw new Error('Employee ID already exists');
          throw new Error('Username or Employee ID already exists');
        }
        throw new Error(`Database error: ${error.message}`);
      }
      if (!data || data.length === 0) throw new Error('Failed to create employee - no data returned');

      setFormData({ username: '', password: '', employeeId: '', remarks: '' });
      setShowCreateForm(false);
      setCreateError(null);
      setSelectedAdminForCreate(null);
      await guardedLoadEmployees(false);
    } catch (error: any) {
      setCreateError(error.message || 'Failed to create employee.');
    } finally {
      setCreating(false);
    }
  };

  const handleCreateSecondaryAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateSecondaryAdminError(null);
    setCreatingSecondaryAdmin(true);

    try {
      if (!secondaryAdminForm.username.trim()) throw new Error('Username is required');
      if (secondaryAdminForm.password.length < 6) throw new Error('Password must be at least 6 characters');

      const hashedPassword = await hashPassword(secondaryAdminForm.password);
      const { data, error } = await supabase.from('admins').insert({
        username: secondaryAdminForm.username.trim(),
        password_hash: hashedPassword,
        role: 'secondary_admin',
        parent_id: admin.id,
      }).select();

      if (error) {
        if (error.code === '23505') throw new Error('Username already exists');
        throw error;
      }
      if (!data || data.length === 0) throw new Error('Failed to create admin - no data returned');

      setSecondaryAdminForm({ username: '', password: '' });
      setShowSecondaryAdminPassword(false);
      setShowCreateSecondaryAdmin(false);
      await guardedLoadEmployees(false);
    } catch (error) {
      console.error('Error creating secondary admin:', formatSupabaseError(error));
      setCreateSecondaryAdminError(formatSupabaseError(error) || 'Failed to create secondary admin.');
    } finally {
      setCreatingSecondaryAdmin(false);
    }
  };

  const toggleEmployeeStatus = async (employeeId: string, currentStatus: boolean, employeeUsername: string) => {
    const newStatus = !currentStatus;
    setConfirmDialog({
      show: true,
      title: `${newStatus ? 'Activate' : 'Deactivate'} Employee`,
      message: `Are you sure you want to ${newStatus ? 'activate' : 'deactivate'} employee "${employeeUsername}"?`,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          setEmployeeGroups(prev => prev.map(g => ({
            ...g,
            employees: g.employees.map(emp => emp.id === employeeId ? { ...emp, is_active: newStatus } : emp)
          })));
          const { error } = await supabase.from('users').update({ is_active: newStatus }).eq('id', employeeId);
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
  };

  const toggleVerification = async (employeeId: string, currentStatus: boolean, employeeUsername: string) => {
    const newStatus = !currentStatus;
    setConfirmDialog({
      show: true,
      title: `${newStatus ? 'Verify' : 'Unverify'} Employee`,
      message: `Are you sure you want to ${newStatus ? 'verify' : 'unverify'} employee "${employeeUsername}"?`,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          setEmployeeGroups(prev => prev.map(g => ({
            ...g,
            employees: g.employees.map(emp => emp.id === employeeId ? { ...emp, is_verified: newStatus } : emp)
          })));
          const { error: userError } = await supabase.from('users').update({ is_verified: newStatus }).eq('id', employeeId);
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
  };

  const handleResetPassword = async (employeeId: string) => {
    if (!newPassword.trim()) {
      setNotification({ show: true, type: 'warning', title: 'Invalid Input', message: 'Please enter a new password' });
      return;
    }
    try {
      const hashedPassword = await hashPassword(newPassword);
      const { data, error } = await supabase.from('users').update({ password_hash: hashedPassword }).eq('id', employeeId).select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('No rows were updated.');
      setShowPasswordReset(null);
      setNewPassword('');
      setNotification({ show: true, type: 'success', title: 'Success', message: 'Password reset successfully' });
    } catch (error: any) {
      setNotification({ show: true, type: 'error', title: 'Error', message: error.message || 'Failed to reset password' });
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
      const { error } = await supabase.from('users').update(updates).eq('id', employeeId);
      if (error) throw error;
      setEditingEmployee(null);
    } catch (error) {
      console.error('Error updating employee:', formatSupabaseError(error));
      setNotification({ show: true, type: 'error', title: 'Error', message: 'Failed to update employee' });
      guardedLoadEmployees(true);
    }
  };

  const handleDeleteEmployee = async (employee: EmployeeWithAdmin) => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const { data, error } = await supabase.from('users').delete().eq('id', employee.id).select();
      if (error) throw new Error(error.message || 'Database error occurred');
      if (!data || data.length === 0) throw new Error('Unable to delete employee.');
      setEmployeeGroups(prev => prev.map(g => ({
        ...g,
        employees: g.employees.filter(emp => emp.id !== employee.id)
      })).filter(g => g.employees.length > 0 || g.admin.role === 'super_admin' || g.admin.role === 'secondary_admin'));
      setDeletingEmployee(null);
      setDeleteError(null);
    } catch (error: any) {
      setDeleteError(error.message || 'Failed to delete employee.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSort = (adminId: string, field: SortField) => {
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
      const { error } = await supabase.from('users').update({ is_pinned: newPinned }).eq('id', employeeId);
      if (error) throw error;
    } catch (error) {
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
      const { error } = await supabase.from('admins').update({ is_pinned: newPinned }).eq('id', adminId);
      if (error) throw error;
    } catch (error) {
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
      const { error } = await supabase.from('users').update({ tags: updatedTags }).eq('id', employee.id);
      if (error) throw error;
    } catch (error) {
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
      const { error } = await supabase.from('users').update({ tags: updatedTags }).eq('id', employee.id);
      if (error) throw error;
    } catch (error) {
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

  const sortEmployees = (employees: EmployeeWithAdmin[], adminId: string) => {
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
        const aVal = (a as any)[groupSort.sortBy] || 0;
        const bVal = (b as any)[groupSort.sortBy] || 0;
        return groupSort.sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }
      return 0;
    });
    return sorted;
  };

  const getFilteredEmployeesForGroup = (group: EmployeeGroup) => {
    const selectedTags = getSelectedTagsForGroup(group.admin.id);
    const activeFilter = getActiveFilter(group.admin.id);
    const workStatusFilter = getWorkStatusFilter(group.admin.id);
    const summaryFilter = getSummaryFilter(group.admin.id);
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
  };

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
    selectedTagsByGroup,
    activeFilterByGroup,
    workStatusFilterByGroup,
    summaryFilterByGroup,
    inactiveDaysFilterByGroup,
    pendingWithdrawalFilterByGroup,
    sortByGroup,
    searchTerm,
    admin.role,
    selectedAdminFilter,
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

  const renderWorkStatusBadge = (status: 'online' | 'offline' | 'never_started') => {
    if (status === 'online') {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-green-500/20 border border-green-500/50">
          <span className="w-1 h-1 rounded-full bg-green-400" />
          <span className="text-xs font-medium text-green-400">On</span>
        </span>
      );
    }
    if (status === 'offline') {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500/20 border border-red-500/50">
          <span className="w-1 h-1 rounded-full bg-red-400" />
          <span className="text-xs font-medium text-red-400">Off</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-slate-500/20 border border-slate-500/50">
        <span className="w-1 h-1 rounded-full bg-slate-400" />
        <span className="text-xs font-medium text-slate-400">New</span>
      </span>
    );
  };

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
      { key: '2-3' as InactiveDaysRange, label: '2 ~ 3 days', accent: 'bg-sky-400', badge: 'border-sky-400/35 bg-sky-500/10 text-sky-200' },
      { key: '3-7' as InactiveDaysRange, label: '3 ~ 7 days', accent: 'bg-emerald-400', badge: 'border-emerald-400/35 bg-emerald-500/10 text-emerald-200' },
      { key: '7-15' as InactiveDaysRange, label: '7 ~ 15 days', accent: 'bg-amber-400', badge: 'border-amber-400/35 bg-amber-500/10 text-amber-200' },
      { key: '15+' as InactiveDaysRange, label: '15+ days', accent: 'bg-rose-400', badge: 'border-rose-400/35 bg-rose-500/10 text-rose-200' },
    ];
    return createPortal(
      <div
        data-inactive-days-dropdown
        className="fixed z-[9999]"
        style={{ top: idleDaysDropdownPos.top, left: idleDaysDropdownPos.left }}
      >
        <div className="w-[148px] overflow-hidden rounded-xl border border-[#4d8b5c] bg-[#07150b] shadow-2xl shadow-black/70 ring-1 ring-inset ring-emerald-200/10">
          <div role="menu" aria-label="Idle days filter" className="space-y-1 bg-[#07150b] p-1.5">
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
                Clear filter
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
      const menuWidth = 148;
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
    const currentActive = getActiveFilter(adminId);
    const currentWorkStatus = getWorkStatusFilter(adminId);
    const hasIdleFilter = inactiveDaysFilterByGroup.has(adminId);
    const hasPendingFilter = pendingWithdrawalFilterByGroup.has(adminId);
    const groupEmployees = employeeGroups.find(group => group.admin.id === adminId)?.employees || [];
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
        >ALL</button>
        <button
          onClick={() => handleActiveFilter(adminId, 'active')}
          className={`px-2 py-0.5 rounded text-[11px] transition-all flex items-center gap-1 ${
            currentActive === 'active'
              ? `bg-emerald-500 ${on}`
              : `${dim} text-slate-400 hover:text-emerald-300 hover:border-emerald-500/40`
          }`}
        >
          <span className={`w-1 h-1 rounded-full ${currentActive === 'active' ? 'bg-white' : 'bg-emerald-600'}`} />
          Active
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
          Off
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
        >ALL</button>
        <button
          onClick={() => handleWorkStatusFilter(adminId, 'online')}
          className={`px-2 py-0.5 rounded text-[11px] transition-all flex items-center gap-1 ${
            currentWorkStatus.has('online')
              ? `bg-green-500 ${on}`
              : `${dim} text-slate-400 hover:text-green-300 hover:border-green-500/40`
          }`}
        >
          <span className={`w-1 h-1 rounded-full ${currentWorkStatus.has('online') ? 'bg-white' : 'bg-green-600'}`} />
          Online
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
          Offline
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
          Never Started
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
            <span>Withdrawing</span>
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
        <div data-inactive-days-dropdown className="ml-2 inline-flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => handleIdleDaysClick(adminId, e)}
            aria-haspopup="menu"
            aria-expanded={inactiveDaysDropdownOpen === adminId}
            className={`inline-flex h-7 w-[120px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-[11px] font-semibold transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-500 ${
              hasIdleFilter
                ? 'border-emerald-500/80 bg-emerald-800 text-emerald-50'
                : inactiveDaysDropdownOpen === adminId
                  ? 'border-emerald-500/80 bg-emerald-950 text-emerald-100'
                  : 'border-emerald-700/70 bg-slate-900 text-emerald-200 hover:border-emerald-500/80 hover:bg-emerald-950 hover:text-emerald-100'
            }`}
          >
            <Timer className="h-3.5 w-3.5" />
            <span>
              {hasIdleFilter
                ? (() => {
                    const r = inactiveDaysFilterByGroup.get(adminId);
                    return r === '2-3' ? '2-3d' : r === '3-7' ? '3-7d' : r === '7-15' ? '7-15d' : '15d+';
                  })()
                : 'Idle Days'
              }
            </span>
            <ChevronDown className={`h-3 w-3 transition-transform ${inactiveDaysDropdownOpen === adminId ? 'rotate-180' : ''}`} />
          </button>
          <div className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center">
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
                aria-label="Clear Idle Days filter"
                title="Clear Idle Days filter"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-rose-300 bg-rose-600 text-white transition-colors hover:border-rose-200 hover:bg-rose-500"
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
          title="Reset Staff list filters"
          className={`ml-8 inline-flex h-7 min-w-[78px] items-center justify-center gap-1.5 rounded-lg border border-blue-400/70 px-3 py-1 text-[11px] font-semibold text-white transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/70 ${
            resetFeedbackAdminId === adminId
              ? 'bg-emerald-600'
              : 'bg-blue-700 hover:bg-blue-500 hover:text-white active:bg-blue-900'
          }`}
        >
          {resetFeedbackAdminId === adminId ? (
            <>
              <CheckCircle className="h-3.5 w-3.5" />
              <span>Done</span>
            </>
          ) : (
            <>
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Reset</span>
            </>
          )}
        </button>
      </div>
    );
  };

  const handleViewLoginIP = async (employee: { id: string; username: string; employeeId?: string }) => {
    setLoginIPEmployee(employee);
    setLoginIPRecords([]);
    setLoginIPLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_employee_login_history', {
        p_admin_id: admin.id,
        p_user_id: employee.id,
        p_limit: 50,
        p_offset: 0
      });
      if (error) throw error;
      setLoginIPRecords((data as LoginIPRecord[]) || []);
    } catch (err) {
      console.error('Error loading login IP history:', formatSupabaseError(err));
    } finally {
      setLoginIPLoading(false);
    }
  };

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
    return createPortal(
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[9999] p-4" onClick={() => setLoginIPEmployee(null)}>
        <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full max-h-[80vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-sky-500/20 flex items-center justify-center">
                <Globe className="w-5 h-5 text-sky-400" />
              </div>
              <div>
                <p className="text-xs text-slate-400 leading-none">Login IP History</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <h3 className="text-lg font-bold text-sky-300 tracking-wide">{loginIPEmployee.username}</h3>
                  {loginIPEmployee.employeeId && <span className="text-sm text-white font-mono font-semibold">ID: {loginIPEmployee.employeeId}</span>}
                </div>
              </div>
            </div>
            <button onClick={() => setLoginIPEmployee(null)} className="p-1.5 rounded-lg hover:bg-slate-700/60 text-slate-400 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {loginIPLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 text-sky-400 animate-spin" />
              </div>
            ) : loginIPRecords.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-sm">No login records found</div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-2">Time</th>
                    <th className="text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-2">Type</th>
                    <th className="text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-2">IP Address</th>
                  </tr>
                </thead>
                <tbody>
                  {loginIPRecords.map((record) => (
                    <tr key={record.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                      <td className="px-3 py-2 text-xs text-slate-300 whitespace-nowrap">{formatDateTime(record.created_at)}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          record.action_type === 'login'
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'bg-slate-500/15 text-slate-400 border border-slate-500/30'
                        }`}>
                          {record.action_type === 'login' ? 'Login' : 'Logout'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-200 font-mono">{record.ip_address || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>,
      document.body
    );
  };

  const handleOpenWallet = async (employee: { id: string; username: string; employeeId?: string }) => {
    setWalletEmployee(employee);
    setWalletData(null);
    setWalletAdjustData({ amount: '', remarks: '' });
    setWalletAdjusting(false);
    setWalletNotification(null);
    setWalletLoading(true);
    try {
      const { data, error } = await supabase
        .from('wallets')
        .select('available_balance, frozen_balance')
        .eq('user_id', employee.id)
        .maybeSingle();
      if (error) throw error;
      setWalletData({
        available: data?.available_balance ?? 0,
        frozen: data?.frozen_balance ?? 0,
      });
    } catch (err) {
      console.error('Error loading wallet:', formatSupabaseError(err));
      setWalletData({ available: 0, frozen: 0 });
    } finally {
      setWalletLoading(false);
    }
  };

  const handleWalletAdjust = async (type: 'add' | 'subtract') => {
    if (!walletEmployee || !walletData) return;
    const amount = parseFloat(walletAdjustData.amount);
    if (isNaN(amount) || amount <= 0) {
      setWalletNotification({ type: 'error', message: 'Please enter a valid amount' });
      return;
    }
    if (!walletAdjustData.remarks.trim()) {
      setWalletNotification({ type: 'error', message: 'Please enter remarks' });
      return;
    }
    setWalletAdjusting(true);
    setWalletNotification(null);
    try {
      const adjustmentAmount = type === 'add' ? amount : -amount;
      const { data: result, error: adjustError } = await supabase.rpc('adjust_wallet_balance', {
        p_user_id: walletEmployee.id,
        p_amount: adjustmentAmount,
        p_remarks: walletAdjustData.remarks.trim(),
        p_created_by: admin.id,
      });
      if (adjustError) throw adjustError;
      if (!result?.success) {
        setWalletNotification({ type: 'error', message: result?.error || 'Failed to adjust balance' });
        setWalletAdjusting(false);
        return;
      }
      // Refresh wallet data
      const { data: refreshed } = await supabase
        .from('wallets')
        .select('available_balance, frozen_balance')
        .eq('user_id', walletEmployee.id)
        .maybeSingle();
      setWalletData({
        available: refreshed?.available_balance ?? 0,
        frozen: refreshed?.frozen_balance ?? 0,
      });
      setWalletAdjustData({ amount: '', remarks: '' });
      setWalletNotification({ type: 'success', message: 'Balance adjusted successfully' });
    } catch (err: any) {
      console.error('Error adjusting wallet:', formatSupabaseError(err));
      setWalletNotification({ type: 'error', message: err?.message || 'Failed to adjust balance' });
    } finally {
      setWalletAdjusting(false);
    }
  };

  const renderWalletModal = () => {
    if (!walletEmployee) return null;
    return createPortal(
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[9999] p-4" onClick={() => setWalletEmployee(null)}>
        <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="text-xs text-slate-400 leading-none">Wallet Adjustment</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <h3 className="text-lg font-bold text-amber-300 tracking-wide">{walletEmployee.username}</h3>
                  {walletEmployee.employeeId && <span className="text-sm text-white font-mono font-semibold">ID: {walletEmployee.employeeId}</span>}
                </div>
              </div>
            </div>
            <button onClick={() => setWalletEmployee(null)} className="p-1.5 rounded-lg hover:bg-slate-700/60 text-slate-400 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-5 space-y-4">
            {walletLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/50">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Available</p>
                    <p className="text-lg font-bold text-green-400">${(walletData?.available ?? 0).toFixed(2)}</p>
                  </div>
                  <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/50">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Frozen</p>
                    <p className="text-lg font-bold text-yellow-400">${(walletData?.frozen ?? 0).toFixed(2)}</p>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-amber-400">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={walletAdjustData.amount}
                      onChange={(e) => setWalletAdjustData(d => ({ ...d, amount: e.target.value }))}
                      placeholder="0.00"
                      className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-300 rounded-xl text-slate-900 text-sm font-medium focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 focus:outline-none placeholder-slate-400"
                    />
                  </div>
                  <textarea
                    value={walletAdjustData.remarks}
                    onChange={(e) => setWalletAdjustData(d => ({ ...d, remarks: e.target.value }))}
                    placeholder="Remarks (required)"
                    rows={3}
                    className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-xl text-slate-900 text-sm focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 focus:outline-none placeholder-slate-400 resize-none"
                  />
                </div>
                {walletNotification && (
                  <div className={`px-3 py-2 rounded-lg text-sm ${walletNotification.type === 'success' ? 'bg-green-500/15 text-green-400 border border-green-500/30' : 'bg-red-500/15 text-red-400 border border-red-500/30'}`}>
                    {walletNotification.message}
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => handleWalletAdjust('add')}
                    disabled={walletAdjusting}
                    className="flex-1 px-4 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors"
                  >
                    {walletAdjusting ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : <span className="flex items-center justify-center gap-1"><span className="text-base font-bold leading-none">+</span> Add</span>}
                  </button>
                  <button
                    onClick={() => handleWalletAdjust('subtract')}
                    disabled={walletAdjusting}
                    className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors"
                  >
                    {walletAdjusting ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : <span className="flex items-center justify-center gap-1"><span className="text-base font-bold leading-none">&minus;</span> Subtract</span>}
                  </button>
                  <button
                    onClick={() => setWalletEmployee(null)}
                    className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-sm font-medium transition-colors"
                  >
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>,
      document.body
    );
  };

  const renderActionsDropdown = (employee: EmployeeWithAdmin) => {
    const isOpen = openActionMenu === employee.id;
    return (
      <div className="relative" ref={isOpen ? actionMenuRef : undefined}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setOpenActionMenu(isOpen ? null : employee.id);
          }}
          className="p-1.5 hover:bg-slate-700 rounded transition-all text-slate-400 hover:text-white"
          title="Actions"
        >
          <MoreVertical className="w-4 h-4" />
        </button>
        {isOpen && (
          <div className="absolute right-8 top-1/2 -translate-y-1/2 z-50 flex items-center gap-1 bg-slate-800 border border-slate-500/50 rounded-full px-1.5 py-1 shadow-lg shadow-black/40">
            <button
              onClick={(e) => { e.stopPropagation(); setOpenActionMenu(null); setEditingEmployee(employee); }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-blue-300 bg-blue-500/15 hover:bg-blue-500/30 border border-blue-500/30 hover:border-blue-400/50 transition-all whitespace-nowrap"
              title="Edit Details"
            >
              <Edit className="w-3 h-3" /> Edit
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setOpenActionMenu(null); setShowPasswordReset({ id: employee.id, username: employee.username }); }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-amber-300 bg-amber-500/15 hover:bg-amber-500/30 border border-amber-500/30 hover:border-amber-400/50 transition-all whitespace-nowrap"
              title="Reset Password"
            >
              <Key className="w-3 h-3" /> Password
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setOpenActionMenu(null); setDeletingEmployee(employee); }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-red-300 bg-red-500/15 hover:bg-red-500/30 border border-red-500/30 hover:border-red-400/50 transition-all whitespace-nowrap"
              title="Delete"
            >
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderEmployeeRow = (employee: EmployeeWithAdmin, index: number, isSuperAdmin: boolean) => (
    <tr
      key={employee.id}
      className={`group border-t border-slate-700/50 transition-colors duration-75 ${
        employee.is_pinned
          ? 'bg-amber-500/10 hover:bg-amber-500/20'
          : isSuperAdmin ? 'hover:bg-yellow-500/15' : 'hover:bg-blue-500/15'
      }`}
    >
      <td className="relative w-[54px] py-0.5 px-1.5 text-xs text-slate-500 text-center whitespace-nowrap">
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
        <span className="absolute left-2 top-1/2 z-10 inline-block -translate-y-1/2 text-left tabular-nums">{index + 1}</span>
        <button
          onClick={(e) => { e.stopPropagation(); setPinConfirmEmployee({ id: employee.id, username: employee.username, currentPinned: employee.is_pinned }); }}
          className={`absolute right-2 top-1/2 inline-flex -translate-y-1/2 rounded p-0.5 transition-all ${employee.is_pinned ? 'text-amber-400 hover:text-amber-300' : 'text-slate-600 hover:text-amber-400'}`}
          title={employee.is_pinned ? 'Unpin' : 'Pin to Top'}
        >
          <Pin className={`w-3 h-3 ${employee.is_pinned ? 'fill-current' : ''}`} />
        </button>
      </td>
      <td className="w-[88px] py-0.5 px-1.5 whitespace-nowrap cursor-pointer overflow-hidden" onClick={() => setViewingEmployee(employee)}>
        <div className="flex min-w-0 flex-col">
          <div className="flex min-w-0 items-center gap-0.5">
            <span title={employee.username} className={`block max-w-full truncate text-xs font-medium ${!employee.is_active ? 'text-red-400' : employee.hasPendingWithdrawal ? 'text-orange-400' : 'text-white'}`}>{employee.username}</span>

          </div>
          {employee.hasPendingWithdrawal && (
            <span className="text-[10px] text-orange-400">${employee.pendingWithdrawalAmount.toFixed(2)}</span>
          )}
        </div>
      </td>
      <td title={employee.employee_id} className="w-[98px] max-w-[98px] overflow-hidden text-ellipsis py-0.5 px-1.5 text-xs text-slate-300 font-mono whitespace-nowrap cursor-pointer" onClick={() => setViewingEmployee(employee)}>{employee.employee_id}</td>
      <td className="w-[62px] py-0.5 px-1 text-[10px] text-emerald-400 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
        <span>{employee.created_at ? new Date(employee.created_at).toLocaleDateString('en-CA') : '-'}</span>
        <button
          onClick={() => {
            const d = employee.created_at ? new Date(employee.created_at).toISOString().slice(0, 16) : '';
            setEditingCreatedAt({ id: employee.id, username: employee.username, currentDate: d });
            setNewCreatedAt(d);
          }}
          className="ml-0 inline-flex align-middle p-0.5 rounded text-slate-500 hover:text-blue-400 transition-colors"
          title="Edit registration date"
        >
          <Pencil className="w-2.5 h-2.5" />
        </button>
      </td>
      <td className="w-[68px] py-0.5 px-1 relative group/tags" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-0.5 max-w-[68px] min-w-0 overflow-hidden whitespace-nowrap">
          {(employee.tags || []).length > 0 && (
            <span className="min-w-0 flex-1 px-1.5 py-0 bg-amber-500/20 text-amber-400 text-[10px] font-medium rounded-full border border-amber-500/30 truncate">
              {(employee.tags || [])[0]}
            </span>
          )}
          {(employee.tags || []).length > 1 && <span className="flex-shrink-0 text-[10px] text-slate-500">+{(employee.tags || []).length - 1}</span>}
          <button onClick={() => setEditingTags(employee)} className="ml-1 flex-shrink-0 px-1 py-0 bg-slate-700 hover:bg-slate-600 text-slate-400 text-[10px] rounded-full transition-colors">
            <Tag className="w-2.5 h-2.5 inline" />+
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
      <td className="w-[40px] py-0.5 px-1 relative group/ver">
        <button
          onClick={(e) => { e.stopPropagation(); toggleVerification(employee.id, employee.is_verified, employee.username); }}
          className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${
            employee.is_verified ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
          }`}
        >
          {employee.is_verified ? <CheckCircle className="w-2.5 h-2.5" /> : <XCircle className="w-2.5 h-2.5" />}
          {employee.is_verified ? 'Yes' : 'No'}
        </button>
        {employee.verification && (
          <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 z-50 hidden group-hover/ver:block bg-slate-950 border border-sky-500/40 rounded-lg p-3 shadow-2xl shadow-black/60 ring-1 ring-sky-500/20 text-xs whitespace-nowrap">
            <span className="text-slate-300"><span className="text-slate-500">Name:</span> {employee.verification.real_name}</span>
            <span className="text-slate-600 mx-1">|</span>
            <span className="text-slate-300"><span className="text-slate-500">Phone:</span> {employee.verification.phone}</span>
            <span className="text-slate-600 mx-1">|</span>
            <span className="text-slate-300"><span className="text-slate-500">Email:</span> {employee.verification.email}</span>
            <span className="text-slate-600 mx-1">|</span>
            <span className="text-slate-300"><span className="text-slate-500">Wallet:</span> {employee.verification.wallet_address}</span>
          </div>
        )}
      </td>
      <td className="w-[44px] py-0.5 px-1">
        <button
          onClick={(e) => { e.stopPropagation(); toggleEmployeeStatus(employee.id, employee.is_active, employee.username); }}
          className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
            employee.is_active ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
          }`}
        >
          {employee.is_active ? 'Active' : 'Off'}
        </button>
      </td>
      <td className="w-[66px] py-0.5 px-1 relative group/remarks" onClick={(e) => e.stopPropagation()}>
        <div className="flex min-w-0 items-center gap-0.5 max-w-[66px]">
          <span className="text-xs text-blue-400 truncate flex-1">{employee.remarks || '-'}</span>
          <button onClick={() => setEditingRemarksOnly(employee)} className="opacity-0 group-hover/remarks:opacity-100 transition-opacity flex-shrink-0">
            <Pencil className="w-2.5 h-2.5 text-slate-500 hover:text-blue-400" />
          </button>
        </div>
        {employee.remarks && employee.remarks.length > 8 && (
          <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 z-50 hidden group-hover/remarks:block rounded-lg border border-blue-300 bg-blue-100 px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-blue-950">
            {employee.remarks}
          </div>
        )}
      </td>
      {/* Orders group */}
      <td className="py-0.5 px-1 text-[10px] text-center whitespace-nowrap">
        <span className="text-blue-400">{employee.totalOrders}</span>
      </td>
      <td className="py-0.5 px-1 text-[10px] text-center whitespace-nowrap">
        <span className="text-cyan-400 font-medium">{employee.todayOrders}</span>
      </td>
      <td className="py-0.5 px-1 text-[10px] text-center whitespace-nowrap">
        <span className="text-green-400 font-bold">{employee.todayCompletedOrders}</span>
      </td>
      <td className="py-0.5 px-1 text-[10px] text-center whitespace-nowrap">
        <span className="text-red-400">{employee.failedOrders}</span>
      </td>
      {/* Money group */}
      <td className="py-0.5 px-1 text-[10px] text-center whitespace-nowrap">
        <span className="text-white font-medium">${(employee.walletBalance || 0).toFixed(2)}</span>
      </td>
      <td className="py-0.5 px-1 text-[10px] text-center whitespace-nowrap">
        <span className="text-blue-400 font-medium">${employee.accountBalance.toFixed(2)}</span>
      </td>
      <td className="py-0.5 px-1 text-[10px] text-center whitespace-nowrap">
        <span className="text-amber-400 font-medium">${employee.todayCommission.toFixed(2)}</span>
      </td>
      {/* Time group */}
      <td className="py-0.5 px-1 text-[10px] text-center whitespace-nowrap">
        <span className="text-white">{formatTime(employee.totalWorkMinutes)}</span>
      </td>
      <td className="py-0.5 px-1 text-[10px] text-center whitespace-nowrap">
        <span className="text-green-400">{formatTime(employee.todayWorkMinutes)}</span>
      </td>
      {/* Work status */}
      <td className="w-[50px] py-0.5 px-1 text-center whitespace-nowrap">
        {renderWorkStatusBadge(employee.workStatus)}
      </td>
      <td className="w-[132px] py-0.5 px-1 text-center" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-center gap-1">
          <button
            onClick={() => onQuickAction?.('message', { id: employee.id, username: employee.username })}
            className="p-0.5 rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/25 hover:text-blue-300 transition-all border border-blue-500/20 hover:border-blue-400/40"
            title={`Send message to ${employee.username}`}
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
            title={`直接发送模拟客户消息给 ${employee.username}`}
            aria-label={`直接发送模拟客户消息给 ${employee.username}`}
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
            title={`直接发送经理消息给 ${employee.username}`}
            aria-label={`直接发送经理消息给 ${employee.username}`}
          >
            <Headphones className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleOpenWallet({ id: employee.id, username: employee.username, employeeId: employee.employee_id })}
            className="p-0.5 rounded bg-amber-500/10 text-amber-400 hover:bg-amber-500/25 hover:text-amber-300 transition-all border border-amber-500/20 hover:border-amber-400/40"
            title={`Adjust wallet for ${employee.username}`}
          >
            <DollarSign className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleViewLoginIP({ id: employee.id, username: employee.username, employeeId: employee.employee_id })}
            className="p-0.5 rounded bg-sky-500/10 text-sky-400 hover:bg-sky-500/25 hover:text-sky-300 transition-all border border-sky-500/20 hover:border-sky-400/40"
            title={`View login IP for ${employee.username}`}
          >
            <Globe className="w-3.5 h-3.5" />
          </button>
          {renderActionsDropdown(employee)}
        </div>
      </td>
    </tr>
  );

  const employeeRowsByGroup = useMemo(() => {
    const rows = new Map<string, ReturnType<typeof renderEmployeeRow>[]>();
    filteredEmployeeGroups.forEach(group => {
      const isSuperAdminGroup = group.admin.role === 'super_admin';
      rows.set(group.admin.id, group.employees.map((employee, index) => renderEmployeeRow(employee, index, isSuperAdminGroup)));
    });
    return rows;
  }, [filteredEmployeeGroups, openActionMenu, onQuickAction]);

  const renderTableHeader = (adminId: string) => (
    <thead className="sticky top-0 z-20 isolate bg-blue-900 shadow-[0_2px_4px_rgba(0,0,0,0.35)] border-b-2 border-blue-300/40">
      <tr className="h-[40px]">
        <th className="w-[54px] px-1.5 py-1 text-center text-[10px] font-semibold text-white uppercase tracking-wider">#</th>
        <th className="w-[88px] px-1.5 py-1 text-left text-[10px] font-semibold text-white uppercase tracking-wider">User</th>
        <th className="w-[98px] px-1.5 py-1 text-left text-[10px] font-semibold text-white uppercase tracking-wider">Emp ID</th>
        {renderSortableHeader(adminId, 'created_at', 'Created', 'w-[62px]')}
        <th className="h-[40px] w-[68px] px-1 py-1 text-left text-[10px] font-semibold text-white uppercase tracking-wider">Tags</th>
        <th className="h-[40px] w-[40px] px-1 py-1 text-left text-[10px] font-semibold text-white uppercase tracking-wider">Ver</th>
        <th className="h-[40px] w-[44px] px-1 py-1 text-left text-[10px] font-semibold text-white uppercase tracking-wider">Status</th>
        <th className="h-[40px] w-[66px] px-1 py-1 text-left text-[10px] font-semibold text-white uppercase tracking-wider">Remarks</th>
        {renderSortableHeader(adminId, 'totalOrders', 'Total', 'w-[41px]')}
        {renderSortableHeader(adminId, 'todayOrders', 'Today', 'w-[41px]')}
        {renderSortableHeader(adminId, 'todayCompletedOrders', 'Success', 'w-[45px]')}
        {renderSortableHeader(adminId, 'failedOrders', 'Failed', 'w-[43px]')}
        {renderSortableHeader(adminId, 'walletBalance', 'Wallet', 'w-[59px]')}
        {renderSortableHeader(adminId, 'accountBalance', 'Avail', 'w-[59px]')}
        {renderSortableHeader(adminId, 'todayCommission', "Today $", 'w-[58px]')}
        {renderSortableHeader(adminId, 'totalWorkMinutes', 'Total T', 'w-[54px]')}
        {renderSortableHeader(adminId, 'todayWorkMinutes', 'Today T', 'w-[54px]')}
        <th className="h-[40px] w-[50px] px-1 py-1 text-center text-[10px] font-semibold text-white uppercase tracking-wider">Work</th>
        <th className="h-[40px] w-[132px] px-1 py-1 text-center text-[10px] font-semibold text-white uppercase tracking-wider">Actions</th>
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
                <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${isSuperGroup ? 'text-yellow-300/80' : 'text-blue-300/80'}`}>Access provisioning</p>
                <h3 className="text-lg font-bold tracking-tight text-white">New Employee Account</h3>
                <p className={`truncate text-xs ${isSuperGroup ? 'text-yellow-100/70' : 'text-blue-100/70'}`}>
                  {groupAdmin ? <>Creating under: <strong className="font-semibold text-white">{groupAdmin.username}</strong></> : 'Create a new employee account'}
                </p>
              </div>
            </div>
            <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-[0.12em] ${isSuperGroup ? 'border-yellow-300/35 bg-yellow-500/10 text-yellow-200' : 'border-blue-300/35 bg-blue-500/10 text-blue-200'}`}>
              SECURE SETUP
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
              Account details
              <span className={`h-px flex-1 ${isSuperGroup ? 'bg-yellow-400/20' : 'bg-blue-400/20'}`} />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={`mb-1.5 block text-[11px] font-semibold uppercase tracking-wide ${isSuperGroup ? 'text-yellow-100/75' : 'text-blue-100/75'}`}>Username</label>
                <input type="text" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} disabled={creating} required placeholder="Enter username" className={`w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 ${fieldFocusClasses} disabled:bg-slate-100 disabled:text-slate-400 disabled:opacity-100`} />
              </div>
              <div>
                <label className={`mb-1.5 block text-[11px] font-semibold uppercase tracking-wide ${isSuperGroup ? 'text-yellow-100/75' : 'text-blue-100/75'}`}>Password</label>
                <div className="flex gap-2">
                  <div className="relative min-w-0 flex-1">
                    <input type={showPassword ? 'text' : 'password'} value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} disabled={creating} required minLength={6} autoComplete="new-password" placeholder="Create a secure password" className={`w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 pr-10 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 ${fieldFocusClasses} disabled:bg-slate-100 disabled:text-slate-400 disabled:opacity-100`} />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900">
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <button type="button" onClick={generatePassword} disabled={creating} className={`inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border bg-white text-slate-600 shadow-sm transition-colors disabled:bg-slate-100 disabled:text-slate-400 disabled:opacity-100 ${isSuperGroup ? 'border-yellow-300 hover:border-yellow-500 hover:bg-yellow-50 hover:text-yellow-700' : 'border-blue-300 hover:border-blue-500 hover:bg-blue-50 hover:text-blue-700'}`} title="Generate strong password">
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500">Minimum 6 characters</p>
              </div>
              <div>
                <label className={`mb-1.5 block text-[11px] font-semibold uppercase tracking-wide ${isSuperGroup ? 'text-yellow-100/75' : 'text-blue-100/75'}`}>Employee ID</label>
                <input type="text" value={formData.employeeId} onChange={(e) => setFormData({ ...formData, employeeId: e.target.value })} disabled={creating} required placeholder="Enter employee ID" className={`w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 ${fieldFocusClasses} disabled:bg-slate-100 disabled:text-slate-400 disabled:opacity-100`} />
              </div>
              <div>
                <label className={`mb-1.5 block text-[11px] font-semibold uppercase tracking-wide ${isSuperGroup ? 'text-yellow-100/75' : 'text-blue-100/75'}`}>Remarks <span className="font-normal normal-case tracking-normal text-slate-500">(optional)</span></label>
                <input type="text" value={formData.remarks} onChange={(e) => setFormData({ ...formData, remarks: e.target.value })} disabled={creating} placeholder="Add an internal note" className={`w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 ${fieldFocusClasses} disabled:bg-slate-100 disabled:text-slate-400 disabled:opacity-100`} />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2 border-t border-slate-700/70 pt-4">
              <button type="button" onClick={() => { setShowCreateForm(false); setCreateError(null); setFormData({ username: '', password: '', employeeId: '', remarks: '' }); setSelectedAdminForCreate(null); }} disabled={creating} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50">
                <X className="h-4 w-4" />
                Cancel
              </button>
              <button type="submit" disabled={creating || !formData.username.trim() || !formData.password || !formData.employeeId.trim()} className={`inline-flex items-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${isSuperGroup ? 'border-yellow-300/60 bg-yellow-600 hover:bg-yellow-500' : 'border-blue-300/60 bg-blue-600 hover:bg-blue-500'}`}>
                {creating ? (<><div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />Creating...</>) : (<><UserPlus className="h-4 w-4" />Create Employee</>)}
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
    ? `All groups (${totalEmployeeCount})`
    : selectedGroup
      ? `${selectedGroup.admin.username} (${selectedGroup.employees.length})`
      : 'Select group';

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Unified toolbar: search + group filter + countdown + refresh (super admin only) */}
      {admin.role === 'super_admin' && (
        <div className="relative z-40 flex h-9 w-full min-w-0 items-center overflow-visible rounded-none border border-cyan-200/45 bg-slate-950/95 shadow-lg shadow-cyan-950/25 shrink-0 sticky top-0 backdrop-blur-sm">
          <div className="relative h-full min-w-[140px] flex-[1_1_0%] border-r border-cyan-300/25 bg-gradient-to-r from-cyan-500/15 via-cyan-500/10 to-blue-500/10">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-200 drop-shadow-[0_0_6px_rgba(103,232,249,0.35)] pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => handleSearchTermChange(e.target.value)}
              placeholder="Search employees..."
              autoComplete="off"
              className="h-full w-full rounded-none bg-transparent pl-10 pr-9 text-sm font-medium text-slate-50 placeholder:text-cyan-100/65 outline-none transition-colors focus:bg-cyan-900/30"
            />
            {searchTerm && (
              <button type="button" onClick={() => handleSearchTermChange('')} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-cyan-200/70 transition-colors hover:bg-cyan-300/15 hover:text-cyan-50">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <div ref={adminFilterRef} className="relative h-full min-w-[135px] flex-[1_1_0%] border-r border-cyan-300/25">
            <button
              type="button"
              onClick={() => setAdminFilterOpen((open) => !open)}
              aria-haspopup="listbox"
              aria-expanded={adminFilterOpen}
              className={`flex h-full w-full items-center gap-2.5 px-3.5 text-sm font-semibold transition-all ${adminFilterOpen ? 'bg-gradient-to-r from-blue-800/75 to-cyan-800/55 text-cyan-50 ring-1 ring-inset ring-cyan-200/35' : 'bg-gradient-to-r from-blue-950/40 to-cyan-950/25 text-slate-100 hover:from-blue-900/55 hover:to-cyan-900/35'}`}
            >
              <Users className="h-4 w-4 shrink-0 text-cyan-300" />
              <span className="min-w-0 flex-1 truncate text-left font-medium">{selectedGroupLabel}</span>
              <ChevronDown className={`h-4 w-4 shrink-0 text-cyan-200/80 transition-transform duration-200 ${adminFilterOpen ? 'rotate-180 text-cyan-100' : ''}`} />
            </button>
            {adminFilterOpen && (
              <div className="isolate absolute left-0 right-0 top-[calc(100%+0.5rem)] z-[60] overflow-hidden rounded-xl border border-cyan-200/45 bg-slate-900 p-1.5 shadow-2xl shadow-cyan-950/50" style={{ backgroundColor: '#0f172a' }}>
                <div role="listbox" aria-label="Filter employee group" className="max-h-[calc(100vh-7rem)] min-h-[120px] overflow-y-auto overscroll-contain scrollbar-dark">
                  <button
                    type="button"
                    role="option"
                    aria-selected={selectedAdminFilter === 'all'}
                    onClick={() => {
                      setSelectedAdminFilter('all');
                      setAdminFilterOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${selectedAdminFilter === 'all' ? 'bg-cyan-500/20 text-cyan-50' : 'text-slate-200 hover:bg-slate-800/90 hover:text-cyan-50'}`}
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${selectedAdminFilter === 'all' ? 'bg-cyan-300 shadow-[0_0_8px_theme(colors.cyan.300)]' : 'bg-slate-600'}`} />
                    <span className="min-w-0 flex-1 truncate">All groups</span>
                    <span className={`inline-flex min-w-[40px] items-center justify-center rounded-md border px-2.5 py-1 text-sm font-bold leading-none tabular-nums shadow-sm shadow-cyan-950/25 ${selectedAdminFilter === 'all' ? 'border-cyan-200/50 bg-cyan-300/20 text-cyan-50' : 'border-slate-600/80 bg-slate-800 text-cyan-100'}`}>{totalEmployeeCount}</span>
                  </button>
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
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${isSelected ? 'bg-cyan-500/20 text-cyan-50' : 'text-slate-200 hover:bg-slate-800/90 hover:text-cyan-50'}`}
                      >
                        <span className={`h-2 w-2 shrink-0 rounded-full ${isSelected ? 'bg-cyan-300 shadow-[0_0_8px_theme(colors.cyan.300)]' : 'bg-slate-600'}`} />
                        <span className="min-w-0 flex-1 truncate" title={group.admin.username}>{group.admin.username}</span>
                        <span className={`inline-flex min-w-[40px] items-center justify-center rounded-md border px-2.5 py-1 text-sm font-bold leading-none tabular-nums shadow-sm shadow-cyan-950/25 ${isSelected ? 'border-cyan-200/50 bg-cyan-300/20 text-cyan-50' : 'border-slate-600/80 bg-slate-800 text-cyan-100'}`}>{group.employees.length}</span>
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
            aria-label="Show previous group"
            className="flex h-full w-[92px] shrink-0 items-center justify-center gap-1 border-r border-cyan-300/30 bg-gradient-to-r from-sky-600/85 to-cyan-500/80 px-2 text-[10px] font-bold text-white shadow-sm shadow-cyan-950/30 transition-all hover:from-sky-500 hover:to-cyan-400 active:from-sky-700 active:to-cyan-600 disabled:cursor-not-allowed disabled:border-slate-700/60 disabled:bg-slate-800/80 disabled:bg-none disabled:text-slate-500"
            title="Show previous group"
          >
            <ChevronUp className="h-3.5 w-3.5 shrink-0" />
            <span className="whitespace-nowrap">Prev group</span>
          </button>
          <button
            type="button"
            onClick={() => navigateGroupPanel(1)}
            disabled={selectedAdminFilter !== 'all'}
            aria-label="Show next group"
            className="flex h-full w-[92px] shrink-0 items-center justify-center gap-1 border-r border-orange-300/30 bg-gradient-to-r from-orange-600/85 to-amber-500/80 px-2 text-[10px] font-bold text-white shadow-sm shadow-orange-950/30 transition-all hover:from-orange-500 hover:to-amber-400 active:from-orange-700 active:to-amber-600 disabled:cursor-not-allowed disabled:border-slate-700/60 disabled:bg-slate-800/80 disabled:bg-none disabled:text-slate-500"
            title="Show next group"
          >
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            <span className="whitespace-nowrap">Next group</span>
          </button>
          <button
            type="button"
            onClick={() => setAllGroupsExpanded(true)}
            disabled={selectedAdminFilter !== 'all'}
            aria-label="Open all groups"
            className="flex h-full w-[108px] shrink-0 items-center justify-center gap-1.5 border-r border-emerald-300/25 bg-gradient-to-r from-emerald-600/85 to-green-500/75 px-2 text-[11px] font-bold text-white shadow-sm shadow-emerald-950/30 transition-all hover:from-emerald-500 hover:to-green-400 active:from-emerald-700 active:to-green-600 disabled:cursor-not-allowed disabled:border-slate-700/60 disabled:bg-slate-800/80 disabled:bg-none disabled:text-slate-500"
            title="Open all groups"
          >
            <ChevronsDown className="h-4 w-4 shrink-0" />
            <span className="whitespace-nowrap">Open all</span>
          </button>
          <button
            type="button"
            onClick={() => setAllGroupsExpanded(false)}
            disabled={selectedAdminFilter !== 'all'}
            aria-label="Close all groups"
            className="flex h-full w-[108px] shrink-0 items-center justify-center gap-1.5 border-r border-rose-300/25 bg-gradient-to-r from-rose-600/85 to-red-500/75 px-2 text-[11px] font-bold text-white shadow-sm shadow-rose-950/30 transition-all hover:from-rose-500 hover:to-red-400 active:from-rose-700 active:to-red-600 disabled:cursor-not-allowed disabled:border-slate-700/60 disabled:bg-slate-800/80 disabled:bg-none disabled:text-slate-500"
            title="Close all groups"
          >
            <ChevronsUp className="h-4 w-4 shrink-0" />
            <span className="whitespace-nowrap">Close all</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setAdminFilterOpen(false);
              setCreateSecondaryAdminError(null);
              setShowCreateSecondaryAdmin(true);
            }}
            className="flex h-full w-[220px] shrink-0 items-center justify-center gap-2 border-l border-cyan-300/20 bg-gradient-to-r from-blue-600/80 to-cyan-600/80 px-4 text-xs font-semibold text-white transition-all hover:from-blue-500 hover:to-cyan-500 active:from-blue-700 active:to-cyan-700"
            title="Create a secondary administrator"
          >
            <UserPlus className="h-4 w-4" />
            New Secondary Admin
          </button>
          <div className="w-px h-5 bg-cyan-300/30 shrink-0" />
          <div className="flex h-full w-[100px] shrink-0 items-center justify-center gap-1.5 bg-cyan-500/15 px-3">
            <Clock className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
            <span className="text-sm text-cyan-100 font-mono font-bold tabular-nums w-[40px] text-center">{formatCountdown()}s</span>
          </div>
          <button
            onClick={() => { if (!loading && !isRefreshing) guardedLoadEmployees(employeeGroups.length > 0 ? true : false); }}
            disabled={loading || isRefreshing}
            className="flex h-full w-20 min-w-20 shrink-0 items-center justify-center bg-gradient-to-r from-blue-500 to-cyan-500 px-4 text-white shadow-sm shadow-cyan-950/30 transition-all hover:from-blue-400 hover:to-cyan-400 active:from-blue-600 active:to-cyan-600 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:bg-none"
            title="Refresh now"
          >
            <RefreshCw className={`w-4 h-4 ${(loading || isRefreshing) ? 'animate-spin' : ''}`} />
          </button>
        </div>
      )}

      <div ref={employeeGroupsScrollRef} className={`${admin.role === 'super_admin' ? 'employee-super-admin-scrollbar overflow-y-auto' : 'dark-panel-scroll overflow-hidden'} flex min-h-0 flex-1 flex-col overscroll-contain`}>
        {/* Content */}
        {loading ? (
        <div className="text-center py-8 text-slate-400">Loading employees...</div>
      ) : admin.role === 'secondary_admin' ? (
        // ===== SECONDARY ADMIN: flat list =====
        <>
          {flatFilteredEmployees.length === 0 && employeeGroups.length > 0 && employeeGroups[0].employees.length === 0 ? (
            <div className="bg-gradient-to-br from-blue-500/5 via-slate-800/40 to-slate-800/40 border-2 border-blue-500/30 shadow-lg shadow-blue-500/10 rounded-xl overflow-hidden p-8 text-center">
              <Users className="w-16 h-16 mx-auto mb-4 text-blue-500/30" />
              <p className="text-slate-400 font-medium mb-2">No employees found</p>
              <p className="text-slate-500 text-sm mb-4">Create your first employee to get started</p>
              <button
                onClick={() => { setSelectedAdminForCreate(admin.id); setShowCreateForm(true); }}
                className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-all shadow-lg shadow-blue-500/30 hover:shadow-blue-500/50 hover:scale-105"
              >
                <UserPlus className="w-5 h-5" /> Create Employee
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
                      <span className={`text-sm font-semibold ${allEmps.length > 0 ? 'text-white' : 'text-slate-400'}`}>
                      {allEmps.length} {allEmps.length === 1 ? 'employee' : 'employees'}
                    </span>
                    {allEmps.length > 0 && (
                      <>
                        <span className="text-slate-500">&bull;</span>
                        {renderSummaryFilterButton(
                          flatAdminId,
                          'today_working',
                          'Today Working',
                          allEmps.filter(e => e.todayWorkMinutes > 0).length,

                        )}
                        <span className="text-slate-500">&bull;</span>
                        {renderSummaryFilterButton(
                          flatAdminId,
                          'new_today',
                          'New Today',
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
                          'Now Working',
                          allEmps.filter(e => e.workStatus === 'online').length,

                        )}
                      </>
                    )}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 flex-wrap">
                      {renderStatusFilterButtons(flatAdminId)}
                      <div className="ml-auto flex h-8 items-center gap-2">
                      <div className="relative h-8">
                        <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-cyan-300 pointer-events-none" />
                        <input
                          type="text"
                          value={searchTerm}
                          onChange={(e) => handleSearchTermChange(e.target.value)}
                          placeholder="Search employees..."
                          autoComplete="off"
                          className="h-8 w-[168px] rounded-lg border border-cyan-400/40 bg-cyan-950/30 pl-8 pr-7 text-xs text-cyan-50 placeholder:text-cyan-100/60 shadow-sm shadow-slate-950/30 outline-none transition-colors focus:border-cyan-300/80 focus:bg-cyan-900/40 focus:ring-2 focus:ring-cyan-400/20"
                        />
                        {searchTerm && (
                          <button onClick={() => handleSearchTermChange('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-cyan-200/70 hover:text-cyan-50 transition-colors">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="flex h-8 items-center overflow-hidden rounded-lg border border-cyan-300/45 bg-cyan-950/35 shadow-sm shadow-cyan-950/30">
                        <div className="flex h-full w-[82px] items-center justify-center gap-1.5 border-r border-cyan-300/30 bg-cyan-500/15 px-2">
                          <Clock className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                          <span className="text-xs text-cyan-100 font-mono font-bold tabular-nums w-[34px] text-center">{formatCountdown()}s</span>
                        </div>
                        <button
                          onClick={() => { if (!loading && !isRefreshing) guardedLoadEmployees(employeeGroups.length > 0 ? true : false); }}
                          disabled={loading || isRefreshing}
                          className="flex h-full items-center justify-center gap-1 bg-gradient-to-r from-blue-500 to-cyan-500 px-2.5 text-white shadow-sm shadow-cyan-950/30 transition-all hover:from-blue-400 hover:to-cyan-400 active:from-blue-600 active:to-cyan-600 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:bg-none"
                          title="Refresh now"
                        >
                          <RefreshCw className={`w-4 h-4 ${(loading || isRefreshing) ? 'animate-spin' : ''}`} />
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
                        Tags:
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
                        <button onClick={() => setSelectedTagsForGroup(flatAdminId, [])} className="inline-flex h-6 shrink-0 items-center rounded-md border border-red-500/30 bg-red-600/15 px-2 text-[11px] font-semibold text-red-300 transition-colors hover:bg-red-600/30">Clear</button>
                      )}
                    </div>
                  </div>
                )}
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <div className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-400">
                    <Users className="h-3.5 w-3.5 text-cyan-300" />
                    <span className="font-bold tabular-nums text-cyan-100">{flatFilteredEmployees.length}</span>
                    <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">of</span>
                    <span className="font-semibold tabular-nums text-slate-200">{employeeGroups[0]?.employees.length || 0}</span>
                    <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">shown</span>
                  </div>
                  <button
                    onClick={() => { setSelectedAdminForCreate(admin.id); setShowCreateForm(true); }}
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-blue-400/40 bg-blue-600/85 px-2.5 text-xs font-semibold text-white shadow-sm shadow-blue-950/40 transition-all hover:border-blue-300/60 hover:bg-blue-500 active:bg-blue-700"
                  >
                    <UserPlus className="h-3.5 w-3.5" /> Create Employee
                  </button>
                </div>
              </div>

              {renderCreateForm(admin.id)}

              {/* Table - fixed ~22 rows */}
              <div className="-ml-1 pl-1 overflow-x-auto overflow-y-auto overscroll-contain bg-slate-900/50 flex-1 min-h-0 dark-panel-scroll">
                <table className="w-full table-fixed">
                  {renderTableHeader(flatAdminId)}
                  <tbody>
                    {flatFilteredEmployees.map((emp, idx) => renderEmployeeRow(emp, idx, true))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : filteredGroups.length === 0 ? (
        <div className="text-center py-8 text-slate-400">No employees found</div>
      ) : (
        // ===== SUPER ADMIN: grouped view =====
        <div className={selectedAdminFilter === 'all' ? 'space-y-0' : 'flex min-h-0 flex-1 flex-col'}>
          {filteredGroups.map((group, groupIndex) => {
            const isSuperGroup = group.admin.role === 'super_admin';
            return (
              <Fragment key={group.admin.id}>
              <div
                data-admin-group-id={group.admin.id}
                className={`rounded-none overflow-hidden transition-all duration-300 ${
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
                        title={group.admin.is_pinned ? 'Unpin admin group' : 'Pin admin group to top'}
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
                          {isSuperGroup ? 'SUPER ADMIN' : 'SECONDARY ADMIN'}
                        </span>
                        {group.admin.is_pinned && (
                          <>
                            <span className="h-3.5 w-px bg-slate-600" />
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-wide text-amber-300">
                              <Pin className="h-3 w-3" />
                              PINNED
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
                              <span className={`text-sm font-semibold ${allEmps.length > 0 ? 'text-white' : 'text-slate-400'}`}>
                                {allEmps.length} {allEmps.length === 1 ? 'employee' : 'employees'}
                              </span>
                              {allEmps.length > 0 && (
                                <>
                                  <span className="text-slate-500">•</span>
                                  {renderSummaryFilterButton(
                                    group.admin.id,
                                    'today_working',
                                    'Today Working',
                                    allEmps.filter(e => e.todayWorkMinutes > 0).length,
          
                                  )}
                                  <span className="text-slate-500">•</span>
                                  {renderSummaryFilterButton(
                                    group.admin.id,
                                    'new_today',
                                    'New Today',
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
                                    'Now Working',
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
                        <UserPlus className="h-3.5 w-3.5" /> Add
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
                              Tags:
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
                              <button onClick={() => setSelectedTagsForGroup(group.admin.id, [])} className="inline-flex h-6 shrink-0 items-center rounded-md border border-red-500/30 bg-red-600/15 px-2 text-[11px] font-semibold text-red-300 transition-colors hover:bg-red-600/30">Clear</button>
                            )}
                          </div>
                        </div>
                      )}
                      <div className="ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-slate-400">
                        <Users className="h-3.5 w-3.5 text-cyan-300" />
                        <span className="font-bold tabular-nums text-cyan-100">{group.employees.length}</span>
                        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">of</span>
                        <span className="font-semibold tabular-nums text-slate-200">{employeeGroups.find(g => g.admin.id === group.admin.id)?.employees.length || 0}</span>
                        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">shown</span>
                      </div>
                    </div>
                    {group.employees.length > 0 ? (
                      <div className={`-ml-1 pl-1 overflow-x-auto overflow-y-auto overscroll-contain bg-slate-900/50 min-h-[300px] dark-panel-scroll ${selectedAdminFilter !== 'all' ? 'min-h-0 flex-1' : 'max-h-[calc(100vh-160px)]'}`}>
                        <table className="w-full table-fixed">
                          {renderTableHeader(group.admin.id)}
                          <tbody>{employeeRowsByGroup.get(group.admin.id)}</tbody>
                        </table>
                      </div>
                    ) : (
                      <div className={`py-8 text-center ${selectedAdminFilter !== 'all' ? `flex flex-1 flex-col items-center justify-center ${isSuperGroup ? 'bg-yellow-500/5' : 'bg-blue-500/5'}` : isSuperGroup ? 'bg-yellow-500/5' : 'bg-blue-500/5'}`}>
                        <p className="text-slate-400 text-sm">No employees match the current filter</p>
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-white mb-4">Edit Employee</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Username</label>
                <input type="text" value={editingEmployee.username} onChange={(e) => setEditingEmployee({ ...editingEmployee, username: e.target.value })} className="w-full px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Employee ID</label>
                <input type="text" value={editingEmployee.employee_id} onChange={(e) => setEditingEmployee({ ...editingEmployee, employee_id: e.target.value })} className="w-full px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Remarks</label>
                <input type="text" value={editingEmployee.remarks || ''} onChange={(e) => setEditingEmployee({ ...editingEmployee, remarks: e.target.value })} className="w-full px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setEditingEmployee(null)} className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-all">Cancel</button>
                <button onClick={() => handleUpdateEmployee(editingEmployee.id, { username: editingEmployee.username, employee_id: editingEmployee.employee_id, remarks: editingEmployee.remarks })} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all">Save Changes</button>
              </div>
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
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-300/80">Employee note</p>
                  <h3 className="text-lg font-bold text-white">Edit Remarks</h3>
                  <p className="truncate text-xs text-slate-400">{editingRemarksOnly.username}</p>
                </div>
              </div>
              <button type="button" onClick={() => setEditingRemarksOnly(null)} aria-label="Close edit remarks" className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-700/80 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">Remarks</label>
                <textarea
                  value={editingRemarksOnly.remarks || ''}
                  onChange={(e) => setEditingRemarksOnly({ ...editingRemarksOnly, remarks: e.target.value })}
                  rows={5}
                  placeholder="Enter an internal note for this employee..."
                  className="min-h-[132px] w-full resize-none rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm leading-6 text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15"
                />
              </div>
              <div className="flex items-start gap-2.5 rounded-xl border border-blue-400/20 bg-blue-500/5 px-3.5 py-3 text-xs text-slate-400">
                <Pencil className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-300" />
                <span>This note is visible to administrators in the employee list.</span>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-700/70 pt-4">
                <button type="button" onClick={() => setEditingRemarksOnly(null)} className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-700 hover:text-white">Cancel</button>
                <button type="button" onClick={() => { handleUpdateEmployee(editingRemarksOnly.id, { remarks: editingRemarksOnly.remarks }); setEditingRemarksOnly(null); }} className="inline-flex items-center gap-2 rounded-lg border border-blue-400/50 bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-950/40 transition-all hover:bg-blue-500 active:bg-blue-700">
                  <CheckCircle className="h-4 w-4" />
                  Save Remarks
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showPasswordReset && createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-white mb-1">Reset Password</h3>
            <p className="text-sm text-slate-400 mb-4">Username: <span className="text-white font-medium">{showPasswordReset.username}</span></p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">New Password</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input type={showResetPassword ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Enter new password" autoComplete="new-password" className="w-full px-4 py-2 pr-10 bg-slate-800/50 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <button type="button" onClick={() => setShowResetPassword(!showResetPassword)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors">
                      {showResetPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  <button type="button" onClick={generateResetPassword} className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-all" title="Generate strong password">
                    <RefreshCw className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => { setShowPasswordReset(null); setNewPassword(''); }} className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-all">Cancel</button>
                <button onClick={() => handleResetPassword(showPasswordReset.id)} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all">Reset Password</button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {editingCreatedAt && createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4" onClick={() => setEditingCreatedAt(null)}>
          <div className="bg-slate-900 border border-blue-500/20 rounded-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-1">Edit Registration Date</h3>
            <p className="text-slate-400 text-sm mb-4">{editingCreatedAt.username}</p>
            <input
              type="datetime-local"
              value={newCreatedAt}
              onChange={e => setNewCreatedAt(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none"
            />
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setEditingCreatedAt(null)} className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 transition-colors text-sm">Cancel</button>
              <button
                disabled={savingCreatedAt}
                onClick={async () => {
                  if (!newCreatedAt) return;
                  setSavingCreatedAt(true);
                  try {
                    const isoDate = new Date(newCreatedAt).toISOString();
                    const { error } = await supabase.from('users').update({ created_at: isoDate }).eq('id', editingCreatedAt.id);
                    if (!error) {
                      setEmployeeGroups(prev => prev.map(g => ({
                        ...g,
                        employees: g.employees.map(emp => emp.id === editingCreatedAt.id ? { ...emp, created_at: isoDate } : emp)
                      })));
                      setEditingCreatedAt(null);
                    } else {
                      setNotification({ show: true, type: 'error', title: 'Error', message: 'Failed to update registration date' });
                    }
                  } finally {
                    setSavingCreatedAt(false);
                  }
                }}
                className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-500 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >{savingCreatedAt ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {pinConfirmEmployee && createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4" onClick={() => setPinConfirmEmployee(null)}>
          <div className="bg-slate-900 border border-amber-500/20 rounded-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-3">{pinConfirmEmployee.currentPinned ? 'Unpin Employee' : 'Pin to Top'}</h3>
            <p className="text-slate-300 text-sm mb-5">
              {pinConfirmEmployee.currentPinned
                ? `Remove pin from "${pinConfirmEmployee.username}"?`
                : `Pin "${pinConfirmEmployee.username}" to the top of the list?`}
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setPinConfirmEmployee(null)} className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 transition-colors text-sm">Cancel</button>
              <button
                onClick={() => { togglePin(pinConfirmEmployee.id, pinConfirmEmployee.currentPinned); setPinConfirmEmployee(null); }}
                className="px-4 py-2 bg-amber-500 text-black font-semibold rounded-lg hover:bg-amber-400 transition-colors text-sm"
              >{pinConfirmEmployee.currentPinned ? 'Unpin' : 'Pin'}</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {deletingEmployee && createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4">
          <div className="bg-slate-900 border border-red-500/20 rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-red-400 mb-4 flex items-center gap-2">
              <Trash2 className="w-6 h-6" /> Delete Employee
            </h3>
            <div className="space-y-4">
              {deleteError && <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-3 text-red-400 text-sm">{deleteError}</div>}
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                <p className="text-white font-medium mb-2">Are you sure you want to delete employee "{deletingEmployee.username}"?</p>
                <p className="text-red-400 text-sm mb-3">This action cannot be undone!</p>
                <div className="space-y-2 text-slate-300 text-sm">
                  <p className="font-medium text-yellow-400">The following data will be permanently deleted:</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>Employee account information</li>
                    <li>All submitted orders</li>
                    <li>Wallet balance and transaction history</li>
                    <li>All withdrawal requests</li>
                    <li>Verification request records</li>
                  </ul>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => { setDeletingEmployee(null); setDeleteError(null); }} disabled={isDeleting} className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-all disabled:opacity-50">Cancel</button>
                <button onClick={() => handleDeleteEmployee(deletingEmployee)} disabled={isDeleting} className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-all font-medium disabled:opacity-50 flex items-center justify-center gap-2">
                  {isDeleting ? (<><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Deleting...</>) : 'Delete Permanently'}
                </button>
              </div>
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
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300/80">Employee labels</p>
                  <h3 className="text-lg font-bold text-white">Manage Tags</h3>
                  <p className="truncate text-xs text-slate-400">{editingTags.username}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-amber-400/25 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200">{(editingTags.tags || []).length} active</span>
                <button type="button" onClick={() => { setEditingTags(null); setNewTag(''); }} aria-label="Close manage tags" className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-700/80 hover:text-white">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="space-y-4 p-5">
              <div className="rounded-xl border border-amber-400/20 bg-amber-500/5 p-4">
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-amber-200">Add New Tag</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddTag(editingTags); }}
                    placeholder="Enter tag name..."
                    className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-amber-500 focus:ring-4 focus:ring-amber-500/15"
                  />
                  <button type="button" onClick={() => handleAddTag(editingTags)} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-amber-400/60 bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-amber-950/30 transition-all hover:bg-amber-500 active:bg-amber-700">
                    <Tag className="h-4 w-4" />
                    Add
                  </button>
                </div>
              </div>
              <div className="rounded-xl border border-slate-700/80 bg-slate-950/45 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <label className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">Current Tags</label>
                  <span className="text-[11px] text-slate-500">Changes save instantly</span>
                </div>
                <div className="flex min-h-[92px] flex-wrap content-start gap-2">
                  {(editingTags.tags || []).length === 0 ? (
                    <div className="flex w-full flex-col items-center justify-center gap-1.5 py-5 text-center">
                      <Tag className="h-5 w-5 text-slate-600" />
                      <p className="text-sm text-slate-500">No tags assigned yet</p>
                    </div>
                  ) : (
                    (editingTags.tags || []).map((tag, idx) => (
                      <span key={idx} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/35 bg-amber-500/15 px-2.5 py-1.5 text-sm font-semibold text-amber-200">
                        {tag}
                        <button type="button" onClick={() => handleRemoveTag(editingTags, tag)} aria-label={`Remove ${tag}`} className="rounded-md p-0.5 text-amber-300 transition-colors hover:bg-amber-400/25 hover:text-white">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ))
                  )}
                </div>
              </div>
              <div className="flex justify-end border-t border-slate-700/70 pt-4">
                <button type="button" onClick={() => { setEditingTags(null); setNewTag(''); }} className="rounded-lg border border-slate-600 bg-slate-800 px-5 py-2 text-sm font-semibold text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-700 hover:text-white">Close</button>
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
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200/70">Administrator access</p>
                  <h2 id="create-secondary-admin-title" className="truncate text-lg font-semibold text-white">Create Secondary Admin</h2>
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
                aria-label="Close create secondary admin panel"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div className="rounded-xl border border-cyan-300/15 bg-cyan-500/5 px-3.5 py-3 text-sm text-slate-300">
                This account will be linked to your administrator account and can manage its assigned employees.
              </div>
              {createSecondaryAdminError && (
                <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-200">
                  {createSecondaryAdminError}
                </div>
              )}
              <div>
                <label htmlFor="secondary-admin-username" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">Username</label>
                <input
                  id="secondary-admin-username"
                  type="text"
                  value={secondaryAdminForm.username}
                  onChange={(e) => setSecondaryAdminForm({ ...secondaryAdminForm, username: e.target.value })}
                  disabled={creatingSecondaryAdmin}
                  required
                  autoComplete="off"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-cyan-500 focus:bg-white focus:ring-2 focus:ring-cyan-400/25 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 disabled:opacity-100"
                  placeholder="Enter admin username"
                />
              </div>
              <div>
                <label htmlFor="secondary-admin-password" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">Password</label>
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
                    placeholder="At least 6 characters"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecondaryAdminPassword((visible) => !visible)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                    aria-label={showSecondaryAdminPassword ? 'Hide password' : 'Show password'}
                  >
                    {showSecondaryAdminPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="mt-1.5 text-xs text-slate-500">Use at least 6 characters.</p>
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
                Cancel
              </button>
              <button
                type="submit"
                disabled={creatingSecondaryAdmin || !secondaryAdminForm.username.trim() || !secondaryAdminForm.password}
                className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/40 bg-gradient-to-r from-blue-600 to-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-cyan-950/30 transition-all hover:from-blue-500 hover:to-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creatingSecondaryAdmin ? (
                  <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />Creating...</>
                ) : (
                  <><UserPlus className="h-4 w-4" />Create Admin</>
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
              <button onClick={() => setNotification(null)} className="w-full px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white rounded-xl font-semibold transition-all shadow-lg shadow-blue-500/40 border border-blue-500/50">OK</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {confirmDialog?.show && createPortal(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999] p-4 animate-in fade-in duration-200">
          <div className="bg-gradient-to-br from-slate-800 via-slate-800 to-slate-900 rounded-3xl border border-slate-700/50 shadow-2xl max-w-md w-full overflow-hidden relative">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-purple-500/5 pointer-events-none" />
            <div className="relative p-8 text-center border-b border-slate-700/50">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-blue-500/20 to-blue-600/20 border border-blue-500/30 mb-4 shadow-lg shadow-blue-500/20">
                {confirmDialog.title.includes('Verify') || confirmDialog.title.includes('Unverify') ? (
                  <CheckCircle className={`w-8 h-8 ${confirmDialog.title.includes('Verify') && !confirmDialog.title.includes('Unverify') ? 'text-green-400' : 'text-amber-400'}`} />
                ) : (
                  <XCircle className={`w-8 h-8 ${confirmDialog.title.includes('Activate') ? 'text-green-400' : 'text-red-400'}`} />
                )}
              </div>
              <h3 className="text-2xl font-bold text-white mb-2 tracking-tight">{confirmDialog.title}</h3>
            </div>
            <div className="relative p-8">
              <p className="text-slate-300 text-base leading-relaxed text-center">{confirmDialog.message}</p>
            </div>
            <div className="relative p-6 bg-slate-900/50 flex gap-3">
              <button onClick={() => setConfirmDialog(null)} className="flex-1 px-6 py-3 bg-slate-700/50 hover:bg-slate-600 text-slate-200 rounded-xl font-semibold transition-all border border-slate-600/50">Cancel</button>
              <button onClick={confirmDialog.onConfirm} className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white rounded-xl font-semibold transition-all shadow-lg shadow-blue-500/40 border border-blue-500/50">Confirm</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
