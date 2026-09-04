import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { Users, Settings, FileText, LogOut, Shield, Package, UserCheck, Zap, Database, Lock, Eye, EyeOff, Bell, PackageSearch, MessageCircle, Search, History, UserCog, Activity, Clock, Headphones } from 'lucide-react';
import { Admin } from '../../types';
import { logout, updateStoredUsername } from '../../lib/auth';
import { hashPassword, verifyPassword } from '../../lib/passwordHash';
import { useCompanyName } from '../../lib/useCompanyName';
import { AdminBackground } from '../AdminBackground';
import { supabase } from '../../lib/supabase';
import { autoCleanupService } from '../../services/autoCleanupService';

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
const CustomerServiceManagement = lazy(() => import('./CustomerServiceManagement'));
const CccServiceManagement = lazy(() => import('./CccServiceManagement'));
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
  const { companyName } = useCompanyName(admin.id);

  // Cross-tab navigation targets
  const [navigateToMessageEmployee, setNavigateToMessageEmployee] = useState<{ id: string; username: string } | null>(null);
  const [navigateToCustomerServiceEmployee, setNavigateToCustomerServiceEmployee] = useState<{ id: string; username: string } | null>(null);
  const [navigateToCccServiceEmployee, setNavigateToCccServiceEmployee] = useState<{ id: string; username: string } | null>(null);

  // Build tabs array based on admin role
  const tabs = admin.role === 'emergency_admin' ? [
    // Emergency admin only has access to Account Locks
    { id: 'accountlocks' as const, label: 'Account Locks', icon: Shield },
  ] : [
    // Normal admin tabs
    { id: 'employees' as const, label: 'Employees', icon: Users },
    { id: 'employeesearch' as const, label: 'Employee Search', icon: Search },
    { id: 'loginhistory' as const, label: 'Login History', icon: Activity },
    { id: 'accountlocks' as const, label: 'Account Locks', icon: Shield },
    { id: 'messages' as const, label: 'Messages', icon: Bell },
    { id: 'announcements' as const, label: 'Announcements', icon: FileText },
    { id: 'customerservice' as const, label: 'Customer Service', icon: MessageCircle },
    { id: 'cccservice' as const, label: 'CCC', icon: Headphones },
    { id: 'dispatch' as const, label: 'Order Assignment', icon: PackageSearch },
    { id: 'withdrawals' as const, label: 'Withdrawals', icon: FileText },
    { id: 'verifications' as const, label: 'Verifications', icon: UserCheck },
    { id: 'config' as const, label: 'Configuration', icon: Settings },
    { id: 'submittime' as const, label: 'Submit Time', icon: Clock },
    ...(admin.role === 'super_admin' ? [
      { id: 'products' as const, label: 'Products', icon: Package },
      { id: 'validdata' as const, label: 'Valid Data', icon: Database },
      { id: 'admins' as const, label: 'Admins', icon: Shield },
      { id: 'history' as const, label: 'History Data', icon: History },
    ] : []),
  ];

  const loadPendingCounts = useCallback(async () => {
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
        const { data: myEmployees } = await supabase
          .from('users')
          .select('id')
          .eq('created_by', admin.id);
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
      setPendingVerificationsCount(verificationsCount);

      // Load unread customer service messages count (AAA)
      let unreadCount = 0;
      let unreadCccCount = 0;

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
          aaaIds.length > 0 ? supabase.from('customer_employee_conversations').select('*', { count: 'exact', head: true }).in('customer_id', aaaIds).eq('sender_type', 'employee').eq('is_read', false) : Promise.resolve({ count: 0, error: null }),
          cccIds.length > 0 ? supabase.from('customer_employee_conversations').select('*', { count: 'exact', head: true }).in('customer_id', cccIds).eq('sender_type', 'employee').eq('is_read', false) : Promise.resolve({ count: 0, error: null }),
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
          aaaIds.length > 0 ? supabase.from('customer_employee_conversations').select('*', { count: 'exact', head: true }).in('customer_id', aaaIds).eq('sender_type', 'employee').eq('is_read', false) : Promise.resolve({ count: 0, error: null }),
          cccIds.length > 0 ? supabase.from('customer_employee_conversations').select('*', { count: 'exact', head: true }).in('customer_id', cccIds).eq('sender_type', 'employee').eq('is_read', false) : Promise.resolve({ count: 0, error: null }),
        ]);

        if (aaaUnread.error) throw aaaUnread.error;
        if (cccUnread.error) throw cccUnread.error;
        unreadCount = aaaUnread.count || 0;
        unreadCccCount = cccUnread.count || 0;
      }

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
      console.log('[Account Locks] Active locks count:', lockedCount, 'for admin:', admin.id);
      setLockedAccountsCount(lockedCount);
    } catch (error) {
      console.error('Error loading pending counts:', error);
    }
  }, [admin.id, admin.role]);

  // Handle tab change with refresh for account locks
  const handleTabChange = useCallback((tabId: typeof activeTab) => {
    setActiveTab(tabId);
    setLoadedTabs(prev => new Set([...prev, tabId]));
    if (tabId === 'accountlocks') {
      console.log('[Account Locks] Tab switched, refreshing counts...');
      loadPendingCounts();
    }
  }, [loadPendingCounts]);

  const handleEmployeeQuickAction = useCallback((action: 'message' | 'customerservice' | 'cccservice', employee: { id: string; username: string }) => {
    if (action === 'message') {
      setNavigateToMessageEmployee(employee);
      handleTabChange('messages');
    } else if (action === 'customerservice') {
      setNavigateToCustomerServiceEmployee(employee);
      handleTabChange('customerservice');
    } else if (action === 'cccservice') {
      setNavigateToCccServiceEmployee(employee);
      handleTabChange('cccservice');
    }
  }, [handleTabChange]);

  useEffect(() => {
    loadPendingCounts();

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

  return (
    <div className="admin-dashboard-root h-screen relative bg-slate-950 overflow-hidden" style={{ touchAction: 'pan-y' }}>
      {/* Professional dark background for admin interface */}
      <AdminBackground />

      <div className="relative z-10 m-0 p-0 w-full h-full flex flex-col">
        <header className="bg-slate-900/90 backdrop-blur-xl border-b border-blue-500/30 w-full m-0 flex-shrink-0" style={{ WebkitBackdropFilter: 'blur(24px)' }}>
          <div className="absolute inset-0 bg-gradient-to-r from-blue-600/5 via-cyan-500/10 to-blue-600/5 pointer-events-none"></div>
          <div className="w-full px-3 sm:px-4 lg:px-6 py-2 relative">
            <div className="flex justify-between items-center gap-2">
              <div className="flex-1 min-w-0 flex items-center gap-2">
                <div className="relative flex-shrink-0">
                  <div className="relative w-7 h-7 bg-gradient-to-br from-blue-600 via-blue-500 to-cyan-500 rounded-md flex items-center justify-center shadow-md">
                    <Zap className="w-3.5 h-3.5 text-white" fill="currentColor" />
                  </div>
                </div>
                <h1 className="text-sm sm:text-lg lg:text-xl font-bold bg-gradient-to-r from-blue-400 via-cyan-300 to-blue-400 bg-clip-text text-transparent truncate">
                  {companyName}
                </h1>
                <div className="hidden sm:flex items-center gap-1 px-1.5 py-0.5 bg-gradient-to-r from-purple-500/20 to-pink-500/20 rounded border border-purple-400/30">
                  <Shield className="w-3 h-3 text-purple-400" />
                  <span className="text-[10px] text-purple-200 font-semibold uppercase">
                    {admin.role === 'super_admin' ? 'Super Admin' : 'Admin'}
                  </span>
                </div>
                <div className="hidden sm:flex items-center gap-1">
                  <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></div>
                  <span className="text-[10px] text-slate-400 font-medium">{admin.username}</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {admin.role === 'super_admin' && (
                  <button
                    onClick={() => setShowUsernameModal(true)}
                    className="flex items-center gap-1 px-2 py-1 sm:px-2.5 sm:py-1.5 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/40 hover:border-purple-400/60 rounded-md text-purple-400 transition-all text-xs"
                    title="Change Username"
                  >
                    <UserCog className="w-3.5 h-3.5" />
                    <span className="hidden lg:inline font-medium">Username</span>
                  </button>
                )}
                <button
                  onClick={() => setShowPasswordModal(true)}
                  className="flex items-center gap-1 px-2 py-1 sm:px-2.5 sm:py-1.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/40 hover:border-blue-400/60 rounded-md text-blue-400 transition-all text-xs"
                  title="Change Password"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span className="hidden lg:inline font-medium">Password</span>
                </button>
                <button
                  onClick={logout}
                  className="flex items-center gap-1 px-2 py-1 sm:px-2.5 sm:py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/40 hover:border-red-400/60 rounded-md text-red-400 transition-all text-xs"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="font-medium">Logout</span>
                </button>
              </div>
            </div>
          </div>
        </header>

        <style>{`
          .scrollbar-hide::-webkit-scrollbar { display: none; }
          .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        `}</style>

        <div className="w-full lg:flex flex-1 min-h-0">
          {/* Desktop: Vertical Left Sidebar */}
          <aside className="hidden lg:flex lg:flex-col lg:w-40 xl:w-44 flex-shrink-0 bg-slate-900/70 border-r border-slate-700/50 overflow-y-auto scrollbar-hide">
            <nav className="flex flex-col gap-0.5 p-2">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const pendingCount = tab.id === 'withdrawals' ? pendingWithdrawalsCount : tab.id === 'verifications' ? pendingVerificationsCount : tab.id === 'customerservice' ? unreadCustomerServiceCount : tab.id === 'cccservice' ? unreadCccServiceCount : tab.id === 'accountlocks' ? lockedAccountsCount : 0;
                const showBadge = pendingCount > 0;

                return (
                  <button
                    key={tab.id}
                    onClick={() => handleTabChange(tab.id)}
                    className={`relative flex items-center gap-2 px-2.5 py-2 rounded-lg font-medium transition-all text-left ${
                      activeTab === tab.id
                        ? tab.id === 'customerservice'
                          ? 'bg-rose-700 text-white shadow-lg shadow-rose-600/30'
                          : tab.id === 'cccservice'
                            ? 'bg-emerald-700 text-white shadow-lg shadow-emerald-600/30'
                            : 'bg-blue-600 text-white shadow-lg shadow-blue-500/30'
                        : tab.id === 'customerservice'
                          ? 'text-rose-400 hover:text-white hover:bg-rose-900/60'
                          : tab.id === 'cccservice'
                            ? 'text-emerald-400 hover:text-white hover:bg-emerald-900/60'
                            : 'text-slate-400 hover:text-white hover:bg-slate-800/80'
                    }`}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <span className="text-xs font-medium truncate">{tab.label}</span>
                    {showBadge && (
                      <span className="ml-auto flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-gradient-to-r from-orange-500 to-red-500 text-white text-[9px] font-bold rounded-full shadow-lg animate-pulse">
                        {pendingCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Mobile: Horizontal Scrolling Tabs */}
          <div className={`flex-1 min-w-0 flex flex-col ${activeTab === 'messages' ? 'lg:overflow-hidden' : 'lg:overflow-y-auto'} scrollbar-hide`} style={activeTab === 'cccservice' ? {
            background: `
              radial-gradient(ellipse 80% 60% at 10% 15%, rgba(34,197,94,0.35) 0%, transparent 50%),
              radial-gradient(ellipse 60% 50% at 80% 10%, rgba(59,130,246,0.35) 0%, transparent 50%),
              radial-gradient(ellipse 70% 70% at 50% 55%, rgba(245,158,11,0.28) 0%, transparent 50%),
              radial-gradient(ellipse 50% 60% at 90% 80%, rgba(236,72,153,0.28) 0%, transparent 50%),
              radial-gradient(ellipse 55% 80% at 20% 85%, rgba(6,182,212,0.3) 0%, transparent 50%),
              radial-gradient(ellipse 40% 40% at 65% 30%, rgba(248,113,113,0.25) 0%, transparent 50%),
              radial-gradient(ellipse 45% 50% at 35% 45%, rgba(168,85,247,0.22) 0%, transparent 50%),
              radial-gradient(ellipse 60% 45% at 75% 65%, rgba(34,211,238,0.25) 0%, transparent 50%),
              linear-gradient(135deg, #1a2e1a 0%, #1e3a2e 15%, #2e1a1a 30%, #1a1e3a 45%, #3a2e1a 60%, #1a3a2e 75%, #2e1a3a 90%, #1a2e1a 100%)
            `
          } : undefined}>
            <div className="lg:hidden flex gap-2 px-3 pt-4 pb-2 overflow-x-auto scrollbar-hide" style={{ WebkitOverflowScrolling: 'touch' }}>
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const pendingCount = tab.id === 'withdrawals' ? pendingWithdrawalsCount : tab.id === 'verifications' ? pendingVerificationsCount : tab.id === 'customerservice' ? unreadCustomerServiceCount : tab.id === 'cccservice' ? unreadCccServiceCount : tab.id === 'accountlocks' ? lockedAccountsCount : 0;
                const showBadge = pendingCount > 0;

                return (
                  <button
                    key={tab.id}
                    onClick={() => handleTabChange(tab.id)}
                    className={`relative flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-medium transition-all whitespace-nowrap flex-shrink-0 ${
                      activeTab === tab.id
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/50'
                        : 'bg-slate-800/50 text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-700'
                    }`}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <span className="text-xs font-semibold">{tab.label}</span>
                    {showBadge && (
                      <span className="flex items-center justify-center min-w-[18px] h-4 px-1 bg-gradient-to-r from-orange-500 to-red-500 text-white text-[9px] font-bold rounded-full shadow-lg animate-pulse">
                        {pendingCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Content Area - Full Width */}
            <div className="w-full flex-1 min-h-0 flex flex-col">
          <Suspense fallback={<div className="flex-1 flex items-center justify-center"><div className="w-8 h-8 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" /></div>}>

            {loadedTabs.has('employees') && (
              <div className={activeTab === 'employees' ? 'flex-1 min-h-0 flex flex-col animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                <EmployeeManagement admin={admin} onQuickAction={handleEmployeeQuickAction} />
              </div>
            )}
            {loadedTabs.has('employeesearch') && (
              <div className={activeTab === 'employeesearch' ? 'px-2 sm:px-3 lg:px-4 py-2 sm:py-3 space-y-6 animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                <EmployeeSearch />
              </div>
            )}
            {loadedTabs.has('loginhistory') && (
              <div className={activeTab === 'loginhistory' ? 'px-2 sm:px-3 lg:px-4 py-2 sm:py-3 space-y-6 animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                <EmployeeLoginHistory admin={admin} />
              </div>
            )}
            {loadedTabs.has('messages') && (
              <div className={activeTab === 'messages' ? 'flex-1 min-h-0 flex flex-col animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                <MessageManagement admin={admin} initialEmployee={navigateToMessageEmployee} onConsumeInitialEmployee={() => setNavigateToMessageEmployee(null)} />
              </div>
            )}
            {loadedTabs.has('customerservice') && (
              <div className={activeTab === 'customerservice' ? 'px-2 sm:px-3 lg:px-4 py-2 sm:py-3 space-y-6 animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                <CustomerServiceManagement
                  adminId={admin.id}
                  isSuperAdmin={admin.role === 'super_admin'}
                  isActive={activeTab === 'customerservice'}
                  initialEmployee={navigateToCustomerServiceEmployee}
                  onConsumeInitialEmployee={() => setNavigateToCustomerServiceEmployee(null)}
                />
              </div>
            )}
            {loadedTabs.has('cccservice') && (
              <div className={activeTab === 'cccservice' ? 'px-2 sm:px-3 lg:px-4 py-2 sm:py-3 space-y-6 animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                <CccServiceManagement
                  adminId={admin.id}
                  isSuperAdmin={admin.role === 'super_admin'}
                  isActive={activeTab === 'cccservice'}
                  initialEmployee={navigateToCccServiceEmployee}
                  onConsumeInitialEmployee={() => setNavigateToCccServiceEmployee(null)}
                />
              </div>
            )}
            {loadedTabs.has('dispatch') && (
              <div className={activeTab === 'dispatch' ? 'px-2 sm:px-3 lg:px-4 py-2 sm:py-3 space-y-6 animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                <DispatchManagement />
              </div>
            )}
            {loadedTabs.has('withdrawals') && (
              <div className={activeTab === 'withdrawals' ? 'px-2 sm:px-3 lg:px-4 py-2 sm:py-3 space-y-6 animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                <WithdrawalReview admin={admin} />
              </div>
            )}
            {loadedTabs.has('verifications') && (
              <div className={activeTab === 'verifications' ? 'px-2 sm:px-3 lg:px-4 py-2 sm:py-3 space-y-6 animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                <VerificationReview admin={admin} />
              </div>
            )}
            {loadedTabs.has('config') && (
              <div className={activeTab === 'config' ? 'px-2 sm:px-3 lg:px-4 py-2 sm:py-3 space-y-6 animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                {admin.role === 'super_admin' ? (
                  <SystemConfiguration admin={admin} />
                ) : (
                  <SecondaryAdminConfiguration admin={admin} />
                )}
              </div>
            )}
            {loadedTabs.has('submittime') && (
              <div className={activeTab === 'submittime' ? 'px-2 sm:px-3 lg:px-4 py-2 sm:py-3 space-y-6 animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                <SubmitTimeManagement admin={admin} />
              </div>
            )}
            {loadedTabs.has('announcements') && (
              <div className={activeTab === 'announcements' ? 'px-2 sm:px-3 lg:px-4 py-2 sm:py-3 space-y-6 animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                <AnnouncementManagement admin={admin} />
              </div>
            )}
            {admin.role === 'super_admin' && (
              <>
                {loadedTabs.has('products') && (
                  <div className={activeTab === 'products' ? 'px-2 sm:px-3 lg:px-4 py-2 sm:py-3 space-y-6 animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                    <ProductTypeManagement />
                  </div>
                )}
                {loadedTabs.has('validdata') && (
                  <div className={activeTab === 'validdata' ? 'px-2 sm:px-3 lg:px-4 py-2 sm:py-3 space-y-6 animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                    <ValidOrderDataManagement adminId={admin.id} />
                  </div>
                )}
                {loadedTabs.has('admins') && (
                  <div className={activeTab === 'admins' ? 'px-2 sm:px-3 lg:px-4 py-2 sm:py-3 space-y-6 animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                    <AdminManagement admin={admin} />
                  </div>
                )}
                {loadedTabs.has('history') && (
                  <div className={activeTab === 'history' ? 'px-2 sm:px-3 lg:px-4 py-2 sm:py-3 space-y-6 animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
                    <HistoryDataManagement admin={admin} />
                  </div>
                )}
              </>
            )}

            {loadedTabs.has('accountlocks') && (
              <div className={activeTab === 'accountlocks' ? 'px-2 sm:px-3 lg:px-4 py-2 sm:py-3 space-y-6 animate-[fadeIn_150ms_ease-out]' : 'hidden'}>
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
