import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { UserPlus, Search, MoreVertical, CheckCircle, XCircle, Key, CreditCard as Edit, ChevronDown, ChevronUp, Trash2, Eye, EyeOff, RefreshCw, ArrowUpDown, ArrowUp, ArrowDown, Pin, Tag, X, Users, Clock, Pencil, Bell, MessageCircle, DollarSign, Headphones, Globe, Loader2, Timer, Wallet } from 'lucide-react';
import { supabase } from '../../lib/supabase';
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
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingEmployee, setEditingEmployee] = useState<EmployeeWithAdmin | null>(null);
  const [editingRemarksOnly, setEditingRemarksOnly] = useState<EmployeeWithAdmin | null>(null);
  const [showPasswordReset, setShowPasswordReset] = useState<{id: string; username: string} | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
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
  const firstMatchRef = useRef<HTMLDivElement>(null);
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
  // Action menu
  const [openActionMenu, setOpenActionMenu] = useState<string | null>(null);
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
  const loadInProgressRef = useRef(false);
  const pendingReloadRef = useRef(false);
  const autoRefreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastUpdatedRef = useRef<Date>(new Date());

  const resetAutoRefreshTimer = () => {
    if (autoRefreshTimerRef.current) clearInterval(autoRefreshTimerRef.current);
    autoRefreshTimerRef.current = setInterval(() => {
      guardedLoadEmployees(true);
    }, 180000);
    lastUpdatedRef.current = new Date();
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
    const anyModalOpen = !!(editingEmployee || showPasswordReset || deletingEmployee || editingTags || notification?.show || confirmDialog?.show || loginIPEmployee || walletEmployee);
    if (anyModalOpen && !scrollLockRef.current) {
      scrollLockRef.current = true;
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    } else if (!anyModalOpen && scrollLockRef.current) {
      scrollLockRef.current = false;
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
  }, [editingEmployee, showPasswordReset, deletingEmployee, editingTags, notification?.show, confirmDialog?.show, loginIPEmployee, walletEmployee]);

  useEffect(() => {
    if (searchTerm) {
      const groupsWithMatches = employeeGroups
        .filter(group => getFilteredEmployeesForGroup(group).length > 0)
        .map(group => group.admin.id);
      setExpandedGroups(new Set(groupsWithMatches));
      setTimeout(() => {
        if (firstMatchRef.current) {
          firstMatchRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    }
  }, [searchTerm, employeeGroups]);

  useEffect(() => {
    guardedLoadEmployees(false);

    let structureTimer: ReturnType<typeof setTimeout> | null = null;
    let statsTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedStructureReload = () => {
      if (structureTimer) clearTimeout(structureTimer);
      structureTimer = setTimeout(() => { guardedLoadEmployees(true); }, 800);
    };
    const debouncedStatsReload = () => {
      if (statsTimer) clearTimeout(statsTimer);
      statsTimer = setTimeout(() => { guardedLoadEmployees(true); }, 2000);
    };

    const adminsSubscription = supabase
      .channel('employee_mgmt_admins')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admins' }, () => {
        debouncedStructureReload();
      })
      .subscribe();

    const usersSubscription = supabase
      .channel('employee_mgmt_users')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => {
        debouncedStructureReload();
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
      if (structureTimer) clearTimeout(structureTimer);
      if (statsTimer) clearTimeout(statsTimer);
      supabase.removeChannel(adminsSubscription);
      supabase.removeChannel(usersSubscription);
      supabase.removeChannel(walletsSubscription);
      supabase.removeChannel(ordersSubscription);
      if (autoRefreshTimerRef.current) clearInterval(autoRefreshTimerRef.current);
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
    loadInProgressRef.current = true;
    try {
      await loadEmployees(silent);
      resetAutoRefreshTimer();
    } finally {
      loadInProgressRef.current = false;
      if (pendingReloadRef.current) {
        pendingReloadRef.current = false;
        guardedLoadEmployees(true);
      }
    }
  };

  const loadEmployees = async (silent: boolean = false) => {
    if (!silent) setLoading(true);
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

      setEmployeeGroups(groupsArray);
      setExpandedGroups(prev => {
        if (prev.size === 0) return new Set(groupsArray.map(g => g.admin.id));
        return prev;
      });
    } catch (error) {
      console.error('Error loading employees:', error);
    } finally {
      if (!silent) setLoading(false);
      else setIsRefreshing(false);
      const now = new Date();
      lastUpdatedRef.current = now;
    }
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
          console.error('Error toggling employee status:', error);
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
          console.error('Error toggling verification:', error);
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
      console.error('Error updating employee:', error);
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
    if (!s || s.sortBy !== field) return <ArrowUpDown className="w-3 h-3 text-slate-500" />;
    if (s.sortDirection === 'desc') return <ArrowDown className="w-3 h-3 text-blue-400" />;
    return <ArrowUp className="w-3 h-3 text-blue-400" />;
  };

  const handleActiveFilter = (adminId: string, filter: 'all' | 'active' | 'inactive') => {
    setActiveFilterByGroup(prev => {
      const newMap = new Map(prev);
      if (filter === 'all') newMap.delete(adminId);
      else newMap.set(adminId, filter);
      return newMap;
    });
  };

  const getActiveFilter = (adminId: string): 'all' | 'active' | 'inactive' => activeFilterByGroup.get(adminId) || 'all';

  const handleWorkStatusFilter = (adminId: string, status: 'online' | 'offline' | 'never_started') => {
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
    const newPinned = !currentPinned;
    setEmployeeGroups(prev => {
      const updated = prev.map(g =>
        g.admin.id === adminId ? { ...g, admin: { ...g.admin, is_pinned: newPinned } } : g
      );
      return updated.sort((a, b) => {
        if (a.admin.role === 'super_admin' && b.admin.role !== 'super_admin') return -1;
        if (a.admin.role !== 'super_admin' && b.admin.role === 'super_admin') return 1;
        if (a.admin.role === 'secondary_admin' && b.admin.role === 'secondary_admin') {
          if (a.admin.is_pinned && !b.admin.is_pinned) return -1;
          if (!a.admin.is_pinned && b.admin.is_pinned) return 1;
        }
        return a.admin.username.localeCompare(b.admin.username);
      });
    });
    try {
      const { error } = await supabase.from('admins').update({ is_pinned: newPinned }).eq('id', adminId);
      if (error) throw error;
    } catch (error) {
      setEmployeeGroups(prev => {
        const reverted = prev.map(g =>
          g.admin.id === adminId ? { ...g, admin: { ...g.admin, is_pinned: currentPinned } } : g
        );
        return reverted.sort((a, b) => {
          if (a.admin.role === 'super_admin' && b.admin.role !== 'super_admin') return -1;
          if (a.admin.role !== 'super_admin' && b.admin.role === 'super_admin') return 1;
          if (a.admin.role === 'secondary_admin' && b.admin.role === 'secondary_admin') {
            if (a.admin.is_pinned && !b.admin.is_pinned) return -1;
            if (!a.admin.is_pinned && b.admin.is_pinned) return 1;
          }
          return a.admin.username.localeCompare(b.admin.username);
        });
      });
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

    return sortEmployees(
      group.employees.filter((emp) => {
        const searchLower = searchTerm.toLowerCase();
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

        const inactiveDaysRange = inactiveDaysFilterByGroup.get(group.admin.id);
        const matchesInactiveDays = !inactiveDaysRange || (() => {
          if (emp.workStatus !== 'never_started' || !emp.created_at) return false;
          const ageDays = (Date.now() - new Date(emp.created_at).getTime()) / (1000 * 60 * 60 * 24);
          switch (inactiveDaysRange) {
            case '2-3': return ageDays > 2 && ageDays <= 3;
            case '3-7': return ageDays > 3 && ageDays <= 7;
            case '7-15': return ageDays > 7 && ageDays <= 15;
            case '15+': return ageDays > 15;
            default: return true;
          }
        })();

        const matchesPendingWithdrawal = !pendingWithdrawalFilterByGroup.has(group.admin.id) || emp.hasPendingWithdrawal;

        return matchesSearch && matchesTags && matchesActive && matchesWorkStatus && matchesInactiveDays && matchesPendingWithdrawal;
      }),
      group.admin.id
    );
  };

  const filteredGroups = employeeGroups.map(group => ({
    ...group,
    employees: getFilteredEmployeesForGroup(group)
  })).filter(group => {
    if (admin.role === 'super_admin' && selectedAdminFilter !== 'all') {
      return group.admin.id === selectedAdminFilter;
    }
    return group.admin.role === 'secondary_admin' || group.admin.role === 'super_admin' || group.employees.length > 0;
  });

  const flatFilteredEmployees = admin.role === 'secondary_admin' && filteredGroups.length > 0
    ? filteredGroups[0].employees
    : [];

  const flatAdminId = admin.id;

  // ===== Render helpers =====

  const renderWorkStatusBadge = (status: 'online' | 'offline' | 'never_started') => {
    if (status === 'online') {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-green-500/20 border border-green-500/50">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs font-medium text-green-400">On</span>
        </span>
      );
    }
    if (status === 'offline') {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500/20 border border-red-500/50">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
          <span className="text-xs font-medium text-red-400">Off</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-slate-500/20 border border-slate-500/50">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
        <span className="text-xs font-medium text-slate-400">New</span>
      </span>
    );
  };

  const renderSortableHeader = (adminId: string, field: SortField, label: string) => (
    <th className="px-2 py-2.5 text-center text-[10px] font-semibold text-slate-200 uppercase tracking-wider whitespace-nowrap">
      <button
        onClick={() => handleSort(adminId, field)}
        className="flex items-center justify-center gap-1 w-full hover:text-white transition-colors"
      >
        <span>{label}</span>
        {getSortIcon(adminId, field)}
      </button>
    </th>
  );

  const [idleDaysDropdownPos, setIdleDaysDropdownPos] = useState<{ top: number; left: number } | null>(null);

  const renderIdleDaysPortal = (adminId: string) => {
    if (inactiveDaysDropdownOpen !== adminId || !idleDaysDropdownPos) return null;
    const items = [
      { key: '2-3' as InactiveDaysRange, label: '2 ~ 3 days' },
      { key: '3-7' as InactiveDaysRange, label: '3 ~ 7 days' },
      { key: '7-15' as InactiveDaysRange, label: '7 ~ 15 days' },
      { key: '15+' as InactiveDaysRange, label: '15+ days' },
    ];
    return createPortal(
      <div
        data-inactive-days-dropdown
        className="fixed z-[9999]"
        style={{ top: idleDaysDropdownPos.top, left: idleDaysDropdownPos.left }}
      >
        <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-xl shadow-black/50 min-w-[160px] py-1">
          {items.map(({ key, label }) => {
            const isSelected = inactiveDaysFilterByGroup.get(adminId) === key;
            return (
              <button
                key={key}
                onClick={() => {
                  setInactiveDaysFilterByGroup(prev => {
                    const newMap = new Map(prev);
                    if (isSelected) newMap.delete(adminId);
                    else newMap.set(adminId, key);
                    return newMap;
                  });
                  setInactiveDaysDropdownOpen(null);
                  setIdleDaysDropdownPos(null);
                }}
                className={`w-full text-left px-3 py-2 text-xs font-semibold transition-colors flex items-center gap-2.5 ${
                  isSelected
                    ? 'bg-teal-500 text-white'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${isSelected ? 'bg-white' : 'bg-teal-400'}`} />
                {label}
              </button>
            );
          })}
          {inactiveDaysFilterByGroup.has(adminId) && (
            <>
              <div className="border-t border-slate-600 my-1" />
              <button
                onClick={() => {
                  setInactiveDaysFilterByGroup(prev => {
                    const newMap = new Map(prev);
                    newMap.delete(adminId);
                    return newMap;
                  });
                  setInactiveDaysDropdownOpen(null);
                  setIdleDaysDropdownPos(null);
                }}
                className="w-full text-left px-3 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/15 hover:text-red-300 transition-colors"
              >
                Clear Filter
              </button>
            </>
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
      setIdleDaysDropdownPos({ top: rect.bottom + 4, left: rect.left });
      setInactiveDaysDropdownOpen(adminId);
    }
  };

  const renderStatusFilterButtons = (adminId: string) => {
    const currentActive = getActiveFilter(adminId);
    const currentWorkStatus = getWorkStatusFilter(adminId);
    const hasIdleFilter = inactiveDaysFilterByGroup.has(adminId);
    const hasPendingFilter = pendingWithdrawalFilterByGroup.has(adminId);

    const on = 'text-white font-semibold shadow-md border border-transparent';
    const dim = 'bg-slate-800/60 border border-slate-600/50 font-medium';

    return (
      <div className="flex gap-1 flex-wrap items-center">
        {/* Account status: ALL / Active / Off */}
        <button
          onClick={() => handleActiveFilter(adminId, 'all')}
          className={`px-3 py-1 rounded text-xs transition-all ${
            currentActive === 'all'
              ? `bg-blue-500 ${on}`
              : `${dim} text-slate-400 hover:text-blue-300 hover:border-blue-500/40`
          }`}
        >ALL</button>
        <button
          onClick={() => handleActiveFilter(adminId, 'active')}
          className={`px-3 py-1 rounded text-xs transition-all flex items-center gap-1.5 ${
            currentActive === 'active'
              ? `bg-emerald-500 ${on}`
              : `${dim} text-slate-400 hover:text-emerald-300 hover:border-emerald-500/40`
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${currentActive === 'active' ? 'bg-white' : 'bg-emerald-600'}`} />
          Active
        </button>
        <button
          onClick={() => handleActiveFilter(adminId, 'inactive')}
          className={`px-3 py-1 rounded text-xs transition-all flex items-center gap-1.5 ${
            currentActive === 'inactive'
              ? `bg-red-500 ${on}`
              : `${dim} text-slate-400 hover:text-red-300 hover:border-red-500/40`
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${currentActive === 'inactive' ? 'bg-white' : 'bg-red-600'}`} />
          Off
        </button>

        <div className="w-px h-4 bg-slate-600 shrink-0 mx-1" />

        {/* Work status: ALL / Online / Offline / Never Started */}
        <button
          onClick={() => {
            setWorkStatusFilterByGroup(prev => {
              const newMap = new Map(prev);
              newMap.delete(adminId);
              return newMap;
            });
          }}
          className={`px-3 py-1 rounded text-xs transition-all ${
            currentWorkStatus.size === 0
              ? `bg-blue-500 ${on}`
              : `${dim} text-slate-400 hover:text-blue-300 hover:border-blue-500/40`
          }`}
        >ALL</button>
        <button
          onClick={() => handleWorkStatusFilter(adminId, 'online')}
          className={`px-3 py-1 rounded text-xs transition-all flex items-center gap-1.5 ${
            currentWorkStatus.has('online')
              ? `bg-green-500 ${on}`
              : `${dim} text-slate-400 hover:text-green-300 hover:border-green-500/40`
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${currentWorkStatus.has('online') ? 'bg-white' : 'bg-green-600'}`} />
          Online
        </button>
        <button
          onClick={() => handleWorkStatusFilter(adminId, 'offline')}
          className={`px-3 py-1 rounded text-xs transition-all flex items-center gap-1.5 ${
            currentWorkStatus.has('offline')
              ? `bg-red-500 ${on}`
              : `${dim} text-slate-400 hover:text-red-300 hover:border-red-500/40`
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${currentWorkStatus.has('offline') ? 'bg-white' : 'bg-red-600'}`} />
          Offline
        </button>
        <button
          onClick={() => handleWorkStatusFilter(adminId, 'never_started')}
          className={`px-3 py-1 rounded text-xs transition-all flex items-center gap-1.5 ${
            currentWorkStatus.has('never_started')
              ? `bg-amber-500 ${on}`
              : `${dim} text-slate-400 hover:text-amber-300 hover:border-amber-500/40`
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${currentWorkStatus.has('never_started') ? 'bg-white' : 'bg-amber-600'}`} />
          Never Started
        </button>

        <div className="w-px h-4 bg-slate-600 shrink-0 mx-1" />

        {/* Idle Days */}
        <div data-inactive-days-dropdown>
          <button
            onClick={(e) => handleIdleDaysClick(adminId, e)}
            className={`px-3 py-1 rounded text-xs transition-all flex items-center gap-1.5 ${
              hasIdleFilter
                ? `bg-teal-500 ${on}`
                : `${dim} text-slate-400 hover:text-teal-300 hover:border-teal-500/40`
            }`}
          >
            <Timer className="w-3.5 h-3.5" />
            {hasIdleFilter
              ? (() => {
                  const r = inactiveDaysFilterByGroup.get(adminId);
                  return r === '2-3' ? '2-3d' : r === '3-7' ? '3-7d' : r === '7-15' ? '7-15d' : '15d+';
                })()
              : 'Idle Days'
            }
            <ChevronDown className={`w-3 h-3 transition-transform ${inactiveDaysDropdownOpen === adminId ? 'rotate-180' : ''}`} />
          </button>
        </div>
        {renderIdleDaysPortal(adminId)}

        {/* Withdrawing */}
        <button
          onClick={() => {
            setPendingWithdrawalFilterByGroup(prev => {
              const next = new Set(prev);
              if (next.has(adminId)) next.delete(adminId);
              else next.add(adminId);
              return next;
            });
          }}
          className={`px-3 py-1 rounded text-xs transition-all flex items-center gap-1.5 ${
            hasPendingFilter
              ? `bg-orange-500 ${on}`
              : `${dim} text-slate-400 hover:text-orange-300 hover:border-orange-500/40`
          }`}
        >
          <Wallet className="w-3.5 h-3.5" />
          Withdrawing
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
      console.error('Error loading login IP history:', err);
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
      console.error('Error loading wallet:', err);
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
      console.error('Error adjusting wallet:', err);
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
      className={`border-t border-slate-700/50 transition-colors ${
        employee.is_pinned
          ? 'bg-amber-500/10 hover:bg-amber-500/20 border-l-4 border-l-amber-500'
          : isSuperAdmin ? 'hover:bg-yellow-500/15 hover:shadow-[inset_2px_0_0_theme(colors.yellow.400)]' : 'hover:bg-blue-500/15 hover:shadow-[inset_2px_0_0_theme(colors.blue.400)]'
      }`}
    >
      <td className="py-0.5 px-2 text-xs text-slate-500 text-center whitespace-nowrap">
        <span>{index + 1}</span>
        <button
          onClick={(e) => { e.stopPropagation(); setPinConfirmEmployee({ id: employee.id, username: employee.username, currentPinned: employee.is_pinned }); }}
          className={`ml-1 inline-flex align-middle p-0.5 rounded transition-all ${employee.is_pinned ? 'text-amber-400 hover:text-amber-300' : 'text-slate-600 hover:text-amber-400'}`}
          title={employee.is_pinned ? 'Unpin' : 'Pin to Top'}
        >
          <Pin className={`w-3 h-3 ${employee.is_pinned ? 'fill-current' : ''}`} />
        </button>
      </td>
      <td className="py-0.5 px-2 whitespace-nowrap cursor-pointer" onClick={() => setViewingEmployee(employee)}>
        <div className="flex flex-col">
          <div className="flex items-center gap-0.5">
            <span className={`text-xs font-medium ${!employee.is_active ? 'text-red-400' : employee.hasPendingWithdrawal ? 'text-orange-400' : 'text-white'}`}>{employee.username}</span>

          </div>
          {employee.hasPendingWithdrawal && (
            <span className="text-[10px] text-orange-400 animate-pulse">${employee.pendingWithdrawalAmount.toFixed(2)}</span>
          )}
        </div>
      </td>
      <td className="py-0.5 px-2 text-xs text-slate-300 font-mono whitespace-nowrap cursor-pointer" onClick={() => setViewingEmployee(employee)}>{employee.employee_id}</td>
      <td className="py-0.5 px-2 text-[10px] text-emerald-400 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
        <span>{employee.created_at ? new Date(employee.created_at).toLocaleDateString('en-CA') : '-'}</span>
        <button
          onClick={() => {
            const d = employee.created_at ? new Date(employee.created_at).toISOString().slice(0, 16) : '';
            setEditingCreatedAt({ id: employee.id, username: employee.username, currentDate: d });
            setNewCreatedAt(d);
          }}
          className="ml-1 inline-flex align-middle p-0.5 rounded text-slate-500 hover:text-blue-400 transition-colors"
          title="Edit registration date"
        >
          <Pencil className="w-2.5 h-2.5" />
        </button>
      </td>
      <td className="py-0.5 px-2 relative group/tags" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap gap-0.5 max-w-[120px]">
          {(employee.tags || []).slice(0, 2).map((tag, idx) => (
            <span key={idx} className="px-1.5 py-0 bg-amber-500/20 text-amber-400 text-[10px] font-medium rounded-full border border-amber-500/30 max-w-[60px] truncate inline-block align-middle">{tag}</span>
          ))}
          {(employee.tags || []).length > 2 && <span className="text-[10px] text-slate-500">+{(employee.tags || []).length - 2}</span>}
          <button onClick={() => setEditingTags(employee)} className="px-1 py-0 bg-slate-700 hover:bg-slate-600 text-slate-400 text-[10px] rounded-full transition-colors">
            <Tag className="w-2.5 h-2.5 inline" />+
          </button>
        </div>
        {(employee.tags || []).length > 0 && (
          <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 z-50 hidden group-hover/tags:block bg-slate-950 border border-amber-500/40 rounded-lg px-2.5 py-1 shadow-2xl shadow-black/60 ring-1 ring-amber-500/20 text-xs whitespace-nowrap">
            <div className="flex gap-1">
              {(employee.tags || []).map((tag, idx) => (
                <span key={idx} className="px-1.5 py-px bg-amber-500/25 text-amber-300 text-[10px] font-medium rounded-full border border-amber-500/40">{tag}</span>
              ))}
            </div>
          </div>
        )}
      </td>
      <td className="py-0.5 px-2 relative group/ver">
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
      <td className="py-0.5 px-2">
        <button
          onClick={(e) => { e.stopPropagation(); toggleEmployeeStatus(employee.id, employee.is_active, employee.username); }}
          className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
            employee.is_active ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
          }`}
        >
          {employee.is_active ? 'Active' : 'Off'}
        </button>
      </td>
      <td className="py-0.5 px-2 relative group/remarks" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-0.5 max-w-[90px]">
          <span className="text-xs text-blue-400 truncate flex-1">{employee.remarks || '-'}</span>
          <button onClick={() => setEditingRemarksOnly(employee)} className="opacity-0 group-hover/remarks:opacity-100 transition-opacity flex-shrink-0">
            <Pencil className="w-2.5 h-2.5 text-slate-500 hover:text-blue-400" />
          </button>
        </div>
        {employee.remarks && employee.remarks.length > 8 && (
          <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 z-50 hidden group-hover/remarks:block bg-slate-950 border border-sky-500/40 rounded-lg px-3 py-1.5 shadow-2xl shadow-black/60 ring-1 ring-sky-500/20 text-xs text-blue-300 whitespace-nowrap font-medium">
            {employee.remarks}
          </div>
        )}
      </td>
      {/* Orders group */}
      <td className="py-0.5 px-2 text-xs text-center whitespace-nowrap">
        <span className="text-blue-400">{employee.totalOrders}</span>
      </td>
      <td className="py-0.5 px-2 text-xs text-center whitespace-nowrap">
        <span className="text-cyan-400 font-medium">{employee.todayOrders}</span>
      </td>
      <td className="py-0.5 px-2 text-xs text-center whitespace-nowrap">
        <span className="text-green-400 font-bold">{employee.todayCompletedOrders}</span>
      </td>
      <td className="py-0.5 px-2 text-xs text-center whitespace-nowrap">
        <span className="text-red-400">{employee.failedOrders}</span>
      </td>
      {/* Money group */}
      <td className="py-0.5 px-2 text-xs text-center whitespace-nowrap">
        <span className="text-white font-medium">${(employee.walletBalance || 0).toFixed(2)}</span>
      </td>
      <td className="py-0.5 px-2 text-xs text-center whitespace-nowrap">
        <span className="text-blue-400 font-medium">${employee.accountBalance.toFixed(2)}</span>
      </td>
      <td className="py-0.5 px-2 text-xs text-center whitespace-nowrap">
        <span className="text-amber-400 font-medium">${employee.todayCommission.toFixed(2)}</span>
      </td>
      {/* Time group */}
      <td className="py-0.5 px-2 text-xs text-center whitespace-nowrap">
        <span className="text-white">{formatTime(employee.totalWorkMinutes)}</span>
      </td>
      <td className="py-0.5 px-2 text-xs text-center whitespace-nowrap">
        <span className="text-green-400">{formatTime(employee.todayWorkMinutes)}</span>
      </td>
      {/* Work status */}
      <td className="py-0.5 px-2 text-center whitespace-nowrap">
        {renderWorkStatusBadge(employee.workStatus)}
      </td>
      <td className="py-0.5 px-2 text-center" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-center gap-0.5">
          <button
            onClick={() => onQuickAction?.('message', { id: employee.id, username: employee.username })}
            className="p-1 rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/25 hover:text-blue-300 transition-all border border-blue-500/20 hover:border-blue-400/40"
            title={`Send message to ${employee.username}`}
          >
            <Bell className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onQuickAction?.('customerservice', { id: employee.id, username: employee.username })}
            className="p-1 rounded bg-rose-500/10 text-rose-400 hover:bg-rose-500/25 hover:text-rose-300 transition-all border border-rose-500/20 hover:border-rose-400/40"
            title={`Customer Service chat with ${employee.username}`}
          >
            <MessageCircle className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onQuickAction?.('cccservice', { id: employee.id, username: employee.username })}
            className="p-1 rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/25 hover:text-emerald-300 transition-all border border-emerald-500/20 hover:border-emerald-400/40"
            title={`CCC chat with ${employee.username}`}
          >
            <Headphones className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleOpenWallet({ id: employee.id, username: employee.username, employeeId: employee.employee_id })}
            className="p-1 rounded bg-amber-500/10 text-amber-400 hover:bg-amber-500/25 hover:text-amber-300 transition-all border border-amber-500/20 hover:border-amber-400/40"
            title={`Adjust wallet for ${employee.username}`}
          >
            <DollarSign className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleViewLoginIP({ id: employee.id, username: employee.username, employeeId: employee.employee_id })}
            className="p-1 rounded bg-sky-500/10 text-sky-400 hover:bg-sky-500/25 hover:text-sky-300 transition-all border border-sky-500/20 hover:border-sky-400/40"
            title={`View login IP for ${employee.username}`}
          >
            <Globe className="w-3.5 h-3.5" />
          </button>
          {renderActionsDropdown(employee)}
        </div>
      </td>
    </tr>
  );

  const renderTableHeader = (adminId: string) => (
    <thead className="bg-slate-700 sticky top-0 z-10 shadow-[0_2px_4px_rgba(0,0,0,0.3)] border-b-2 border-slate-500/50">
      <tr>
        <th className="px-2 py-2.5 text-left text-[10px] font-semibold text-slate-200 uppercase tracking-wider w-8">#</th>
        <th className="px-2 py-2.5 text-left text-[10px] font-semibold text-slate-200 uppercase tracking-wider">User</th>
        <th className="px-2 py-2.5 text-left text-[10px] font-semibold text-slate-200 uppercase tracking-wider">Emp ID</th>
        {renderSortableHeader(adminId, 'created_at', 'Created')}
        <th className="px-2 py-2.5 text-left text-[10px] font-semibold text-slate-200 uppercase tracking-wider">Tags</th>
        <th className="px-2 py-2.5 text-left text-[10px] font-semibold text-slate-200 uppercase tracking-wider">Ver</th>
        <th className="px-2 py-2.5 text-left text-[10px] font-semibold text-slate-200 uppercase tracking-wider">Status</th>
        <th className="px-2 py-2.5 text-left text-[10px] font-semibold text-slate-200 uppercase tracking-wider">Remarks</th>
        {renderSortableHeader(adminId, 'totalOrders', 'Total')}
        {renderSortableHeader(adminId, 'todayOrders', 'Today')}
        {renderSortableHeader(adminId, 'todayCompletedOrders', 'Success')}
        {renderSortableHeader(adminId, 'failedOrders', 'Failed')}
        {renderSortableHeader(adminId, 'walletBalance', 'Wallet')}
        {renderSortableHeader(adminId, 'accountBalance', 'Avail')}
        {renderSortableHeader(adminId, 'todayCommission', "Today $")}
        {renderSortableHeader(adminId, 'totalWorkMinutes', 'Total T')}
        {renderSortableHeader(adminId, 'todayWorkMinutes', 'Today T')}
        <th className="px-2 py-2.5 text-center text-[10px] font-semibold text-slate-200 uppercase tracking-wider">Work</th>
        <th className="px-2 py-2.5 text-center text-[10px] font-semibold text-slate-200 uppercase tracking-wider w-[170px]">Actions</th>
      </tr>
    </thead>
  );

  const renderCreateForm = (targetAdminId: string, groupAdmin?: { role: string; username: string }) => {
    if (!showCreateForm || selectedAdminForCreate !== targetAdminId) return null;
    const isSuperGroup = groupAdmin?.role === 'super_admin';
    return (
      <div className={`px-6 py-4 border-t-2 ${isSuperGroup ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-blue-500/30 bg-blue-500/5'}`}>
        <form onSubmit={handleCreateEmployee} className="bg-slate-800/50 rounded-lg p-4 space-y-4">
          {createError && (
            <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-3 text-red-400 text-sm">{createError}</div>
          )}
          <div className={`rounded-lg p-3 text-sm flex items-center gap-2 ${isSuperGroup ? 'bg-yellow-500/10 border border-yellow-500/50 text-yellow-300' : 'bg-blue-500/10 border border-blue-500/50 text-blue-300'}`}>
            <Users className="w-4 h-4" />
            <span>{groupAdmin ? <>Creating employee under: <strong>{groupAdmin.username}</strong></> : 'Creating new employee'}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Username</label>
              <input type="text" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} disabled={creating} required className="w-full px-4 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Password</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input type={showPassword ? "text" : "password"} value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} disabled={creating} required minLength={6} autoComplete="new-password" className="w-full px-4 py-2 pr-10 bg-slate-900/50 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors">
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                <button type="button" onClick={generatePassword} disabled={creating} className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-all disabled:opacity-50" title="Generate strong password">
                  <RefreshCw className="w-5 h-5" />
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-1">Min 6 chars.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Employee ID</label>
              <input type="text" value={formData.employeeId} onChange={(e) => setFormData({ ...formData, employeeId: e.target.value })} disabled={creating} required className="w-full px-4 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Remarks (Optional)</label>
              <input type="text" value={formData.remarks} onChange={(e) => setFormData({ ...formData, remarks: e.target.value })} disabled={creating} className="w-full px-4 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50" />
            </div>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => { setShowCreateForm(false); setCreateError(null); setFormData({ username: '', password: '', employeeId: '', remarks: '' }); setSelectedAdminForCreate(null); }} disabled={creating} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-all disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={creating || !formData.username.trim() || !formData.password || !formData.employeeId.trim()} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all disabled:opacity-50 flex items-center gap-2">
              {creating ? (<><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Creating...</>) : 'Create'}
            </button>
          </div>
        </form>
      </div>
    );
  };

  // ===== MAIN RENDER =====
  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Unified toolbar: search + group filter + countdown + refresh (super admin only) */}
      {admin.role === 'super_admin' && (
        <div className="relative z-20 flex items-center bg-slate-800 border border-slate-700/80 rounded-xl overflow-hidden shrink-0 sticky top-0 mb-1">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search employees..."
              autoComplete="off"
              className="w-full pl-9 pr-8 py-2.5 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none focus:bg-slate-700/40 transition-colors"
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="w-px h-6 bg-slate-600/60 shrink-0" />
          <div className="relative min-w-[180px]" style={{ contain: 'layout' }}>
            <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400 pointer-events-none z-10" />
            <select
              value={selectedAdminFilter}
              onChange={(e) => {
                setSelectedAdminFilter(e.target.value);
                if (e.target.value !== 'all') {
                  setExpandedGroups(new Set([e.target.value]));
                }
              }}
              className="relative z-10 w-full appearance-none pl-9 pr-9 py-2.5 bg-transparent text-sm text-white focus:outline-none focus:bg-slate-700/40 cursor-pointer transition-colors"
            >
              <option value="all" className="bg-slate-800">All Groups ({employeeGroups.reduce((sum, g) => sum + g.employees.length, 0)})</option>
              {employeeGroups.map(group => (
                <option key={group.admin.id} value={group.admin.id} className="bg-slate-800">
                  {group.admin.username} ({group.employees.length})
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none z-10" />
          </div>
          <div className="w-px h-6 bg-slate-600/60 shrink-0" />
          <div className="flex items-center gap-1.5 px-3 py-2.5">
            <Clock className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span className="text-sm text-blue-300 font-mono font-bold tabular-nums w-[36px] text-center">{formatCountdown()}s</span>
          </div>
          <button
            onClick={() => { if (!loading && !isRefreshing) guardedLoadEmployees(employeeGroups.length > 0 ? true : false); }}
            disabled={loading || isRefreshing}
            className="flex items-center justify-center px-3.5 py-2.5 bg-blue-600/90 hover:bg-blue-500 active:bg-blue-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white transition-all self-stretch"
            title="Refresh now"
          >
            <RefreshCw className={`w-4 h-4 ${(loading || isRefreshing) ? 'animate-spin' : ''}`} />
          </button>
        </div>
      )}

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
            <div className="bg-gradient-to-br from-blue-500/5 via-slate-800/40 to-slate-800/40 border-2 border-blue-500/30 shadow-lg shadow-blue-500/10 rounded-xl overflow-hidden flex flex-col flex-1 min-h-0">
              {/* Summary stats */}
              {(() => {
                const allEmps = employeeGroups[0]?.employees || [];
                return (
                  <div className="px-4 py-2.5 border-b border-blue-500/20 bg-blue-500/5 flex items-center gap-3 flex-wrap">
                    <span className={`text-sm font-semibold ${allEmps.length > 0 ? 'text-white' : 'text-slate-400'}`}>
                      {allEmps.length} {allEmps.length === 1 ? 'employee' : 'employees'}
                    </span>
                    {allEmps.length > 0 && (
                      <>
                        <span className="text-slate-500">&bull;</span>
                        <span className="text-emerald-300 text-sm">Today Working: {allEmps.filter(e => e.todayWorkMinutes > 0).length}</span>
                        <span className="text-slate-500">&bull;</span>
                        <span className="text-sky-300 text-sm">New Today: {allEmps.filter(e => {
                          if (!e.created_at) return false;
                          const today = new Date();
                          const created = new Date(e.created_at);
                          return created.toDateString() === today.toDateString();
                        }).length}</span>
                      </>
                    )}
                    <span className="text-slate-600 mx-0.5">|</span>
                    {renderStatusFilterButtons(flatAdminId)}
                    <div className="ml-auto flex items-center gap-2.5">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                        <input
                          type="text"
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          placeholder="Search employees..."
                          autoComplete="off"
                          className="w-[200px] pl-9 pr-8 py-1.5 bg-slate-800/80 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                        />
                        {searchTerm && (
                          <button onClick={() => setSearchTerm('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="flex items-center bg-gradient-to-r from-slate-800 to-slate-800/90 border border-blue-500/30 rounded-xl overflow-hidden shadow-lg shadow-blue-500/5">
                        <div className="flex items-center gap-2 px-3.5 py-2 w-[100px] justify-center">
                          <Clock className="w-4 h-4 text-blue-400 shrink-0" />
                          <span className="text-sm text-blue-300 font-mono font-bold tabular-nums w-[36px] text-center">{formatCountdown()}s</span>
                        </div>
                        <button
                          onClick={() => { if (!loading && !isRefreshing) guardedLoadEmployees(employeeGroups.length > 0 ? true : false); }}
                          disabled={loading || isRefreshing}
                          className="flex items-center justify-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white text-sm font-medium transition-all"
                          title="Refresh now"
                        >
                          <RefreshCw className={`w-4 h-4 ${(loading || isRefreshing) ? 'animate-spin' : ''}`} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}
              {/* Controls */}
              <div className="px-4 py-1.5 border-b-2 border-blue-500/30 bg-blue-500/5">
                <div className="flex flex-wrap gap-2 items-center">
                  {/* Tag filters */}
                  {getGroupTags(flatAdminId).length > 0 && (
                    <div className="flex flex-wrap gap-2 items-center">
                    <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider flex items-center gap-1.5">
                      <Tag className="w-3 h-3" /> Tags:
                    </span>
                    {getGroupTags(flatAdminId).map(tag => {
                      const selectedTags = getSelectedTagsForGroup(flatAdminId);
                      const isSelected = selectedTags.includes(tag);
                      return (
                        <button key={tag} onClick={() => {
                          if (isSelected) setSelectedTagsForGroup(flatAdminId, selectedTags.filter(t => t !== tag));
                          else setSelectedTagsForGroup(flatAdminId, [...selectedTags, tag]);
                        }} className={`px-2 py-1 rounded-full text-xs font-semibold transition-all ${isSelected ? 'bg-yellow-500/30 text-yellow-200 border border-yellow-400/50 shadow-sm shadow-yellow-500/20' : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700 hover:text-white border border-slate-600'}`}>
                          {tag}
                        </button>
                      );
                    })}
                    {getSelectedTagsForGroup(flatAdminId).length > 0 && (
                      <button onClick={() => setSelectedTagsForGroup(flatAdminId, [])} className="px-2 py-1 rounded-full text-xs font-semibold bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-500/30">Clear</button>
                    )}
                  </div>
                  )}
                  <div className="ml-auto flex items-center gap-3">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/80 border border-slate-600/50 rounded-lg">
                      <Users className="w-3.5 h-3.5 text-blue-400" />
                      <span className="text-sm font-semibold text-white">{flatFilteredEmployees.length}</span>
                      <span className="text-xs text-slate-400">/ {employeeGroups[0]?.employees.length || 0} shown</span>
                    </div>
                    <button
                      onClick={() => { setSelectedAdminForCreate(admin.id); setShowCreateForm(true); }}
                      className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-all shadow-lg shadow-blue-500/30 text-sm"
                    >
                      <UserPlus className="w-4 h-4" /> Create Employee
                    </button>
                  </div>
                </div>
              </div>

              {renderCreateForm(admin.id)}

              {/* Table - fixed ~22 rows */}
              <div className="overflow-x-auto overflow-y-auto bg-slate-900/50 flex-1 min-h-0 dark-panel-scroll">
                <table className="w-full">
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
        <div className="space-y-4">
          {filteredGroups.map((group, gIdx) => {
            const isSuperGroup = group.admin.role === 'super_admin';
            return (
              <div
                key={group.admin.id}
                ref={searchTerm && gIdx === 0 ? firstMatchRef : null}
                className={`rounded-xl overflow-hidden transition-all duration-300 ${
                  isSuperGroup
                    ? 'bg-gradient-to-br from-yellow-500/5 via-slate-800/40 to-slate-800/40 border-2 border-yellow-500/30 shadow-lg shadow-yellow-500/10'
                    : 'bg-gradient-to-br from-blue-500/5 via-slate-800/40 to-slate-800/40 border-2 border-blue-500/30 shadow-lg shadow-blue-500/10'
                }`}
              >
                {/* Group header */}
                <div className={`w-full flex items-center justify-between px-6 py-4 transition-all ${isSuperGroup ? 'hover:bg-yellow-500/10' : 'hover:bg-blue-500/10'}`}>
                  <div className="flex items-center gap-4">
                    {group.admin.role === 'secondary_admin' && (
                      <button
                        onClick={() => toggleAdminPin(group.admin.id, group.admin.is_pinned || false)}
                        className={`p-2 rounded-lg transition-all ${
                          group.admin.is_pinned
                            ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
                            : 'bg-slate-700/50 text-slate-500 hover:bg-slate-700 hover:text-amber-400'
                        }`}
                        title={group.admin.is_pinned ? 'Unpin admin group' : 'Pin admin group to top'}
                      >
                        <Pin className={`w-5 h-5 ${group.admin.is_pinned ? 'fill-current rotate-12' : ''}`} />
                      </button>
                    )}
                    <div onClick={() => toggleGroup(group.admin.id)} className={`p-2 rounded-lg cursor-pointer ${isSuperGroup ? 'bg-yellow-500/20' : 'bg-blue-500/20'}`}>
                      <Users className={`w-6 h-6 ${isSuperGroup ? 'text-yellow-400' : 'text-blue-400'}`} />
                    </div>
                    <div className="flex flex-col items-start">
                      <div onClick={() => toggleGroup(group.admin.id)} className="flex items-center gap-3 cursor-pointer">
                        <span className="text-white font-bold text-lg">{group.admin.username}</span>
                        <div className={`px-3 py-1 rounded-full text-xs font-semibold ${isSuperGroup ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40' : 'bg-blue-500/20 text-blue-300 border border-blue-500/40'}`}>
                          {isSuperGroup ? 'SUPER ADMIN' : 'SECONDARY ADMIN'}
                        </div>
                        {group.admin.is_pinned && <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 text-xs font-bold rounded border border-amber-500/30">PINNED</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
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
                                  <span className="text-emerald-300 text-sm">Today Working: {allEmps.filter(e => e.todayWorkMinutes > 0).length}</span>
                                  <span className="text-slate-500">•</span>
                                  <span className="text-sky-300 text-sm">New Today: {allEmps.filter(e => {
                                    if (!e.created_at) return false;
                                    const today = new Date();
                                    const created = new Date(e.created_at);
                                    return created.toDateString() === today.toDateString();
                                  }).length}</span>
                                </>
                              )}
                            </>
                          );
                        })()}
                        {expandedGroups.has(group.admin.id) && (
                          <>
                            <span className="text-slate-600 mx-0.5">|</span>
                            {renderStatusFilterButtons(group.admin.id)}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {admin.role === 'super_admin' && (
                      <button
                        onClick={() => { setSelectedAdminForCreate(group.admin.id); setShowCreateForm(true); setExpandedGroups(prev => new Set(prev).add(group.admin.id)); }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 border shadow-lg ${
                          isSuperGroup
                            ? 'bg-yellow-600/20 text-yellow-300 hover:bg-yellow-600/30 border-yellow-500/30 shadow-yellow-500/20'
                            : 'bg-blue-600/20 text-blue-300 hover:bg-blue-600/30 border-blue-500/30 shadow-blue-500/20'
                        }`}
                      >
                        <UserPlus className="w-3.5 h-3.5" /> Add
                      </button>
                    )}
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

                    <div className={`px-4 py-1.5 border-t-2 ${isSuperGroup ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-blue-500/30 bg-blue-500/5'}`}>
                      <div className="flex flex-wrap gap-2 items-center">
                        {getGroupTags(group.admin.id).length > 0 && (
                          <div className="flex flex-wrap gap-2 items-center">
                            <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider flex items-center gap-1.5">
                              <Tag className="w-3 h-3" /> Tags:
                            </span>
                            {getGroupTags(group.admin.id).map(tag => {
                              const selectedTags = getSelectedTagsForGroup(group.admin.id);
                              const isSelected = selectedTags.includes(tag);
                              return (
                                <button key={tag} onClick={() => {
                                  if (isSelected) setSelectedTagsForGroup(group.admin.id, selectedTags.filter(t => t !== tag));
                                  else setSelectedTagsForGroup(group.admin.id, [...selectedTags, tag]);
                                }} className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all ${isSelected
                                  ? isSuperGroup ? 'bg-yellow-500/40 text-yellow-100 border border-yellow-400/70 shadow-sm shadow-yellow-500/20 ring-1 ring-yellow-400/30' : 'bg-blue-500/40 text-blue-100 border border-blue-400/70 shadow-sm shadow-blue-500/20 ring-1 ring-blue-400/30'
                                  : 'bg-slate-700/50 text-slate-400 hover:bg-slate-600 hover:text-white border border-slate-600/80'
                                }`}>
                                  {tag}
                                </button>
                              );
                            })}
                            {getSelectedTagsForGroup(group.admin.id).length > 0 && (
                              <button onClick={() => setSelectedTagsForGroup(group.admin.id, [])} className="px-2 py-1 rounded-full text-xs font-semibold bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-500/30">Clear</button>
                            )}
                          </div>
                        )}
                        <div className="ml-auto flex items-center gap-2 px-3 py-1.5 bg-slate-800/80 border border-slate-600/50 rounded-lg">
                          <Users className="w-3.5 h-3.5 text-blue-400" />
                          <span className="text-sm font-semibold text-white">{group.employees.length}</span>
                          <span className="text-xs text-slate-400">/ {employeeGroups.find(g => g.admin.id === group.admin.id)?.employees.length || 0} shown</span>
                        </div>
                      </div>
                    </div>
                    {group.employees.length > 0 ? (
                      <div className={`overflow-x-auto overflow-y-auto bg-slate-900/50 min-h-[300px] dark-panel-scroll ${admin.role === 'super_admin' ? 'max-h-[calc(100vh-280px)]' : 'max-h-[calc(100vh-300px)]'}`}>
                        <table className="w-full">
                          {renderTableHeader(group.admin.id)}
                          <tbody>
                            {group.employees.map((emp, idx) => renderEmployeeRow(emp, idx, isSuperGroup))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className={`py-8 text-center ${isSuperGroup ? 'bg-yellow-500/5' : 'bg-blue-500/5'}`}>
                        <p className="text-slate-400 text-sm">No employees match the current filter</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-bold text-white mb-1">Edit Remarks</h3>
            <p className="text-sm text-slate-400 mb-4">{editingRemarksOnly.username}</p>
            <div className="space-y-4">
              <textarea
                value={editingRemarksOnly.remarks || ''}
                onChange={(e) => setEditingRemarksOnly({ ...editingRemarksOnly, remarks: e.target.value })}
                rows={3}
                placeholder="Enter remarks..."
                className="w-full px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
              <div className="flex gap-3">
                <button onClick={() => setEditingRemarksOnly(null)} className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-all">Cancel</button>
                <button onClick={() => { handleUpdateEmployee(editingRemarksOnly.id, { remarks: editingRemarksOnly.remarks }); setEditingRemarksOnly(null); }} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all">Save</button>
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4">
          <div className="bg-slate-900 border border-amber-500/20 rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <Tag className="w-6 h-6 text-amber-400" /> Manage Tags
            </h3>
            <p className="text-slate-400 text-sm mb-4">Employee: <span className="text-white font-medium">{editingTags.username}</span></p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Add New Tag</label>
                <div className="flex gap-2">
                  <input type="text" value={newTag} onChange={(e) => setNewTag(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleAddTag(editingTags); }} placeholder="Enter tag name..." className="flex-1 px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-amber-500" />
                  <button onClick={() => handleAddTag(editingTags)} className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-all font-medium">Add</button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Current Tags</label>
                <div className="flex flex-wrap gap-2">
                  {(editingTags.tags || []).length === 0 ? (
                    <p className="text-slate-500 text-sm">No tags yet</p>
                  ) : (
                    (editingTags.tags || []).map((tag, idx) => (
                      <span key={idx} className="inline-flex items-center gap-1 px-3 py-1.5 bg-amber-500/20 text-amber-400 text-sm font-medium rounded-full border border-amber-500/30">
                        {tag}
                        <button onClick={() => handleRemoveTag(editingTags, tag)} className="hover:bg-amber-500/30 rounded-full p-0.5 transition-colors">
                          <X className="w-4 h-4" />
                        </button>
                      </span>
                    ))
                  )}
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => { setEditingTags(null); setNewTag(''); }} className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-all">Close</button>
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
