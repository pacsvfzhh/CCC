import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { Users, Settings, FileText, LogOut, Shield, Package, UserCheck, Zap, Database, Lock, Eye, EyeOff, Bell, PackageSearch, MessageCircle, Search, History, UserCog, Activity, Clock, Headphones, ChevronDown } from 'lucide-react';
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

export default function AdminDashboard({ admin }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<'employees' | 'products' | 'withdrawals' | 'verifications' | 'announcements' | 'config' | 'admins' | 'validdata' | 'messages' | 'dispatch' | 'records' | 'customerservice' | 'cccservice' | 'employeesearch' | 'history' | 'accountlocks' | 'loginhistory' | 'submittime'>(
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
  const { companyName } = useCompanyName(admin.id);

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

  // Build tabs array based on admin role
  const tabs = admin.role === 'emergency_admin' ? [
    // Emergency admin only has access to Account Locks
    { id: 'accountlocks' as const, label: 'Locks', icon: Shield },
  ] : [
    // Normal admin tabs
    { id: 'employees' as const, label: 'Staff', icon: Users },
    { id: 'employeesearch' as const, label: 'Emp Search', icon: Search },
    { id: 'loginhistory' as const, label: 'Logins', icon: Activity },
    { id: 'accountlocks' as const, label: 'Locks', icon: Shield },
    { id: 'messages' as const, label: 'Msgs', icon: Bell },
    { id: 'announcements' as const, label: 'Notices', icon: FileText },
    { id: 'customerservice' as const, label: '模拟客户', icon: MessageCircle },
    { id: 'cccservice' as const, label: '经理', icon: Headphones },
    { id: 'dispatch' as const, label: 'Dispatch', icon: PackageSearch },
    { id: 'withdrawals' as const, label: 'Withdraw', icon: FileText },
    { id: 'verifications' as const, label: 'Verify', icon: UserCheck },
    { id: 'config' as const, label: 'Config', icon: Settings },
    { id: 'submittime' as const, label: 'Time', icon: Clock },
    ...(admin.role === 'super_admin' ? [
      { id: 'products' as const, label: 'Products', icon: Package },
      { id: 'validdata' as const, label: 'Valid', icon: Database },
      { id: 'admins' as const, label: 'Admins', icon: Shield },
      { id: 'history' as const, label: 'History', icon: History },
    ] : []),
  ];

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
  }, [loadPendingCounts]);

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
    } catch (error: any) {
      console.error('Error changing password:', error);
      setPasswordError(error.message || 'Failed to change password');
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
    } catch (error: any) {
      console.error('Error changing username:', error);
      setUsernameError(error.message || 'Failed to change username');
    } finally {
      setChangingUsername(false);
    }
  };

  const renderAccountMenu = (variant: 'sidebar' | 'mobile') => {
    const isSidebar = variant === 'sidebar';

    return (
      <div className={`relative ${isSidebar ? 'w-full' : 'shrink-0'}`}>
        <button
          type="button"
          onClick={() => setAccountMenuOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={accountMenuOpen}
          className={`flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-all duration-200 ${isSidebar ? `h-8 w-full justify-between border-l-2 border-amber-300/90 bg-gradient-to-r from-amber-600 via-yellow-600 to-emerald-700 px-1.5 text-[10px] text-amber-50 shadow-sm shadow-emerald-950/45 hover:-translate-y-px hover:border-emerald-200 hover:from-amber-500 hover:via-yellow-500 hover:to-emerald-600 hover:shadow-md hover:shadow-emerald-950/45 active:translate-y-0 ${accountMenuOpen ? 'border-amber-100 bg-gradient-to-r from-amber-500 via-yellow-500 to-emerald-600 text-slate-950 ring-1 ring-amber-200/50' : ''}` : `h-7 border border-amber-400/80 bg-gradient-to-r from-amber-600 via-yellow-600 to-emerald-700 px-2 text-[10px] text-amber-50 shadow-sm shadow-emerald-950/40 hover:border-emerald-200/90 hover:from-amber-500 hover:via-yellow-500 hover:to-emerald-600 hover:shadow-md hover:shadow-emerald-950/40 sm:px-2.5 sm:text-[11px] ${accountMenuOpen ? 'border-amber-100 bg-gradient-to-r from-amber-500 via-yellow-500 to-emerald-600 text-slate-950 ring-1 ring-amber-200/50' : ''}`}`}
          title="Account actions"
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-amber-200/25">
            <UserCog className="h-3 w-3 text-amber-50" />
          </span>
          <span className="flex-1 text-left tracking-wide">Account</span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-emerald-100 transition-transform duration-200 ${accountMenuOpen ? 'rotate-180 text-slate-950' : ''}`} />
        </button>
        {accountMenuOpen && (
          <div
            role="menu"
            className={`absolute z-[70] w-full min-w-0 overflow-hidden rounded-xl border border-amber-400/55 bg-slate-950 p-1.5 shadow-xl shadow-emerald-950/60 ring-1 ring-emerald-300/15 animate-[fadeIn_120ms_ease-out] ${isSidebar ? 'left-0 right-0 top-[calc(100%+0.35rem)]' : 'right-0 top-[calc(100%+0.35rem)] min-w-[164px]'}`}
          >
            {admin.role === 'super_admin' && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAccountMenuOpen(false);
                  setShowUsernameModal(true);
                }}
                className="flex h-8 w-full items-center gap-2 rounded-lg border-l-2 border-violet-400/90 bg-violet-500/15 px-1.5 text-left text-[11px] font-medium text-violet-100 transition-all hover:bg-violet-500/25 hover:text-white"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-violet-400/20">
                  <UserCog className="h-3.5 w-3.5 text-violet-300" />
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
              className="flex h-8 w-full items-center gap-2 rounded-lg border-l-2 border-cyan-400/90 bg-cyan-500/15 px-1.5 text-left text-[11px] font-medium text-cyan-100 transition-all hover:bg-cyan-500/25 hover:text-white"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-cyan-400/20">
                <Lock className="h-3.5 w-3.5 text-cyan-300" />
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
              className="flex h-8 w-full items-center gap-2 rounded-lg border-l-2 border-rose-400/90 bg-rose-500/15 px-1.5 text-left text-[11px] font-medium text-rose-100 transition-all hover:bg-rose-500/25 hover:text-white"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-rose-400/20">
                <LogOut className="h-3.5 w-3.5 text-rose-300" />
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
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <div className="relative shrink-0">
                  <div className="relative flex h-4 w-4 items-center justify-center rounded bg-gradient-to-br from-blue-600 via-blue-500 to-cyan-500 shadow-md">
                    <Zap className="h-2.5 w-2.5 text-white" fill="currentColor" />
                  </div>
                </div>
                <div className="min-w-0 flex flex-col gap-0.5">
                  <h1 className="truncate text-[11px] font-bold leading-none bg-gradient-to-r from-blue-400 via-cyan-300 to-blue-400 bg-clip-text text-transparent sm:text-xs">
                    {companyName}
                  </h1>
                  <div className="flex min-w-0 items-center gap-1">
                    <Shield className="h-2.5 w-2.5 shrink-0 text-purple-400" />
                    <span className="truncate text-[9px] font-semibold uppercase text-purple-200">
                      {admin.role === 'super_admin' ? 'Super Admin' : 'Admin'}
                    </span>
                  </div>
                  <div className="flex min-w-0 items-center gap-1">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-400" />
                    <span className="truncate text-[11px] font-semibold tracking-wide text-cyan-100 drop-shadow-[0_0_5px_rgba(103,232,249,0.25)]">{admin.username}</span>
                  </div>
                </div>
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
          <aside className="hidden lg:flex lg:flex-col lg:w-32 xl:w-36 flex-shrink-0 bg-slate-900/70 border-r border-slate-700/50 overflow-y-auto scrollbar-hide">
            <div className="shrink-0 border-b border-slate-700/60 bg-slate-950/55 px-1.5 py-2.5">
              <div className="flex min-w-0 items-center gap-1.5">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-blue-600 via-blue-500 to-cyan-500 shadow-md shadow-blue-950/40">
                  <Zap className="h-3 w-3 text-white" fill="currentColor" />
                </div>
                <h1 className="min-w-0 truncate text-[11px] font-bold leading-tight bg-gradient-to-r from-blue-400 via-cyan-300 to-blue-400 bg-clip-text text-transparent" title={companyName}>
                  {companyName}
                </h1>
              </div>
              <div className="mt-1 flex min-w-0 flex-col gap-0.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Shield className="h-3 w-3 shrink-0 text-purple-400" />
                  <span className="truncate text-[9px] font-semibold uppercase tracking-wide text-purple-200">
                    {admin.role === 'super_admin' ? 'Super Admin' : 'Admin'}
                  </span>
                </div>
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-400" />
                  <span className="min-w-0 truncate text-[11px] font-semibold tracking-wide text-cyan-100 drop-shadow-[0_0_5px_rgba(103,232,249,0.25)]" title={admin.username}>
                    {admin.username}
                  </span>
                </div>
              </div>
              <div className="mt-4">
                {renderAccountMenu('sidebar')}
              </div>
            </div>
            <nav className="flex flex-col gap-0.5 p-1.5 pt-2.5">
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
                            : 'bg-blue-600 text-white shadow-lg shadow-blue-500/30'
                        : tab.id === 'customerservice'
                          ? 'text-orange-400 hover:text-orange-100 hover:bg-orange-950/70'
                          : tab.id === 'cccservice'
                            ? 'text-emerald-400 hover:text-emerald-100 hover:bg-emerald-950/70'
                            : 'text-slate-400 hover:text-white hover:bg-slate-800/80'
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

      {/* Change Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center">
                <Lock className="w-5 h-5 text-white" />
              </div>
              <h3 className="text-xl font-bold text-white">Change Password</h3>
            </div>

            {passwordSuccess && (
              <div className="mb-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-sm flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                  <span className="text-white text-xs">✓</span>
                </div>
                Password changed successfully!
              </div>
            )}

            {passwordError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                {passwordError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Current Password
                </label>
                <div className="relative">
                  <input
                    type={showCurrentPassword ? 'text' : 'password'}
                    value={passwordData.currentPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                    autoComplete="current-password"
                    className="w-full px-4 py-2 bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500 pr-10"
                    placeholder="Enter current password"
                    disabled={changingPassword}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  New Password
                </label>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={passwordData.newPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                    autoComplete="new-password"
                    className="w-full px-4 py-2 bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500 pr-10"
                    placeholder="Enter new password"
                    disabled={changingPassword}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Confirm New Password
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={passwordData.confirmPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                    autoComplete="new-password"
                    className="w-full px-4 py-2 bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500 pr-10"
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
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowPasswordModal(false);
                  setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
                  setPasswordError(null);
                  setPasswordSuccess(false);
                }}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-all"
                disabled={changingPassword}
              >
                Cancel
              </button>
              <button
                onClick={handleChangePassword}
                disabled={changingPassword}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg flex items-center justify-center">
                <UserCog className="w-5 h-5 text-white" />
              </div>
              <h3 className="text-xl font-bold text-white">Change Username</h3>
            </div>

            {usernameSuccess && (
              <div className="mb-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-sm flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                  <span className="text-white text-xs">✓</span>
                </div>
                Username changed successfully! Reloading...
              </div>
            )}

            {usernameError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                {usernameError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  New Username
                </label>
                <input
                  type="text"
                  value={usernameData.newUsername}
                  onChange={(e) => setUsernameData({ ...usernameData, newUsername: e.target.value })}
                  autoComplete="username"
                  className="w-full px-4 py-2 bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-lg text-white focus:outline-none focus:border-purple-500"
                  placeholder="Enter new username"
                  disabled={changingUsername}
                />
                <p className="mt-1 text-xs text-slate-400">
                  Only letters, numbers and underscores (minimum 3 characters)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Current Password
                </label>
                <div className="relative">
                  <input
                    type={showUsernamePassword ? 'text' : 'password'}
                    value={usernameData.currentPassword}
                    onChange={(e) => setUsernameData({ ...usernameData, currentPassword: e.target.value })}
                    autoComplete="current-password"
                    className="w-full px-4 py-2 bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-lg text-white focus:outline-none focus:border-purple-500 pr-10"
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
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    {showUsernamePassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowUsernameModal(false);
                  setUsernameData({ newUsername: '', currentPassword: '' });
                  setUsernameError(null);
                  setUsernameSuccess(false);
                }}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-all"
                disabled={changingUsername}
              >
                Cancel
              </button>
              <button
                onClick={handleChangeUsername}
                disabled={changingUsername}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
