import { useState, useEffect, useCallback, useRef } from 'react';
import { Shield, Unlock, AlertTriangle, Clock, User, RefreshCw, History, Search, Users, ChevronDown, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { unlockAccount } from '../../lib/rateLimitService';
import { Admin } from '../../types';

interface AccountLock {
  id: string;
  identifier: string;
  identifier_type: string;
  lock_until: string;
  lock_reason: string | null;
  failed_attempts: number;
  created_at: string;
  unlocked_at: string | null;
  unlocked_by: string | null;
  user_id: string | null;
  username: string | null;
  employee_id: string | null;
  lock_ip: string | null;
  admin_username: string | null;
}

interface AccountLockManagementProps {
  admin: Admin;
  isActive: boolean;
  onActiveLockCountChange: (count: number, nextExpiry: number | null) => void;
}

interface AdminGroupOption {
  id: string;
  username: string;
  role: Admin['role'];
}

export default function AccountLockManagement({ admin, isActive, onActiveLockCountChange }: AccountLockManagementProps) {
  const [locks, setLocks] = useState<AccountLock[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unlocking, setUnlocking] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [nextExpiry, setNextExpiry] = useState<number | null>(null);
  const [countdownNow, setCountdownNow] = useState(() => Date.now());
  const [historyLocks, setHistoryLocks] = useState<AccountLock[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAdminId, setSelectedAdminId] = useState('all');
  const [adminGroups, setAdminGroups] = useState<AdminGroupOption[]>([]);
  const [adminGroupsLoading, setAdminGroupsLoading] = useState(false);
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const initialLoadStartedRef = useRef(false);
  const locksLoadingRef = useRef(false);
  const historyLoadedRef = useRef(false);
  const historyLoadingRef = useRef(false);
  const historyRpcUnavailableRef = useRef(false);
  const adminGroupsLoadedRef = useRef(false);
  const groupMenuRef = useRef<HTMLDivElement>(null);

  const loadLocks = useCallback(async (isInitial = false) => {
    if (locksLoadingRef.current) return;
    locksLoadingRef.current = true;

    try {
      if (isInitial) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      const { data, error } = await supabase.rpc('get_account_locks_for_admin', {
        p_admin_id: admin.id
      });

      if (error) {
        console.error('Failed to load locks:', error);
        if (isInitial) {
          setMessage({
            type: 'error',
            text: '載入鎖定記錄失敗，請稍後再試。'
          });
        }
        return;
      }

      const accountLocks = (data || []).filter(
        (lock: AccountLock) => lock.identifier_type === 'username'
      );
      const userIds = [...new Set(
        accountLocks
          .map(lock => lock.user_id)
          .filter((userId): userId is string => Boolean(userId))
      )];
      const employeeIdsByUserId = new Map<string, string>();

      if (userIds.length > 0 && accountLocks.some(lock => !lock.employee_id)) {
        const { data: employeeRows } = await supabase
          .from('users')
          .select('id, employee_id')
          .in('id', userIds);

        employeeRows?.forEach(employee => {
          employeeIdsByUserId.set(employee.id, employee.employee_id);
        });
      }

      const missingLockIpIdentifiers = [...new Set(
        accountLocks
          .filter(lock => !lock.lock_ip)
          .map(lock => lock.identifier)
      )];
      const lockIpsByIdentifier = new Map<string, string>();

      if (missingLockIpIdentifiers.length > 0) {
        const { data: attemptRows } = await supabase
          .from('login_attempts')
          .select('identifier, ip_address')
          .in('identifier', missingLockIpIdentifiers)
          .eq('identifier_type', 'username')
          .eq('success', false)
          .not('ip_address', 'is', null)
          .order('attempt_time', { ascending: false });

        attemptRows?.forEach(attempt => {
          if (attempt.ip_address && !lockIpsByIdentifier.has(attempt.identifier)) {
            lockIpsByIdentifier.set(attempt.identifier, attempt.ip_address);
          }
        });
      }

      const locksWithEmployeeIds = accountLocks.map(lock => ({
        ...lock,
        employee_id: lock.employee_id ?? employeeIdsByUserId.get(lock.user_id ?? '') ?? null,
        lock_ip: lock.lock_ip ?? lockIpsByIdentifier.get(lock.identifier) ?? null
      }));
      const nextLockExpiry = accountLocks.length > 0
        ? Math.min(...accountLocks.map((lock: AccountLock) => new Date(lock.lock_until).getTime()))
        : null;
      setLocks(locksWithEmployeeIds);
      setNextExpiry(nextLockExpiry);
      onActiveLockCountChange(locksWithEmployeeIds.length, nextLockExpiry);
      setMessage(null);
    } catch (error: unknown) {
      console.error('Failed to load locks:', error);
      if (isInitial) {
        setMessage({
          type: 'error',
          text: '載入鎖定記錄失敗，請稍後再試。'
        });
      }
    } finally {
      locksLoadingRef.current = false;
      if (isInitial) {
        setLoading(false);
      } else {
        setRefreshing(false);
      }
    }
  }, [admin.id, onActiveLockCountChange]);

  const loadHistory = useCallback(async (options: { force?: boolean; silent?: boolean } = {}) => {
    const { force = false, silent = false } = options;
    if (historyLoadingRef.current || (historyLoadedRef.current && !force)) return;

    historyLoadingRef.current = true;
    setHistoryLoading(true);
    if (!silent) {
      setMessage(null);
    }

    try {
      let historyData: AccountLock[] | null = null;
      if (!historyRpcUnavailableRef.current) {
        const { data, error } = await supabase.rpc('get_account_lock_history_for_admin', {
          p_admin_id: admin.id,
          p_limit: 200
        });

        if (!error) {
          historyData = data || [];
        } else {
          if (error.code === 'PGRST202') {
            historyRpcUnavailableRef.current = true;
          }
          console.warn('Lock history RPC unavailable; falling back to active lock records:', error);
        }
      }

      if (!historyData) {
        const fallback = await supabase.rpc('get_account_locks_for_admin', {
          p_admin_id: admin.id
        });

        if (fallback.error) throw fallback.error;
        historyData = fallback.data || [];
      }

      setHistoryLocks(historyData.filter(lock => lock.identifier_type === 'username'));
      historyLoadedRef.current = true;
    } catch (error) {
      console.error('Failed to load lock history:', error);
      if (!silent) {
        setMessage({ type: 'error', text: '載入歷史鎖定記錄失敗，請稍後再試。' });
      }
    } finally {
      historyLoadingRef.current = false;
      setHistoryLoading(false);
    }
  }, [admin.id]);

  useEffect(() => {
    if (!isActive || admin.role !== 'super_admin' || adminGroupsLoadedRef.current) return;

    let cancelled = false;
    const loadAdminGroups = async () => {
      setAdminGroupsLoading(true);
      const { data, error } = await supabase
        .from('admins')
        .select('id, username, role')
        .in('role', ['super_admin', 'secondary_admin', 'emergency_admin'])
        .order('username', { ascending: true });

      if (cancelled) return;

      const rows: AdminGroupOption[] = error
        ? [{ id: admin.id, username: admin.username, role: admin.role }]
        : (data || []).map(row => ({
            id: row.id,
            username: row.username,
            role: (row.role || 'secondary_admin') as Admin['role']
          }));

      if (error) {
        console.warn('Failed to load administrator groups:', error);
      }

      const uniqueGroups = new Map(rows.map(row => [row.id, row]));
      uniqueGroups.set(admin.id, { id: admin.id, username: admin.username, role: admin.role });
      setAdminGroups(Array.from(uniqueGroups.values()).sort((a, b) => a.username.localeCompare(b.username)));
      adminGroupsLoadedRef.current = true;
      setAdminGroupsLoading(false);
    };

    void loadAdminGroups();
    return () => {
      cancelled = true;
    };
  }, [admin.id, admin.role, admin.username, isActive]);

  useEffect(() => {
    if (!groupMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (groupMenuRef.current && !groupMenuRef.current.contains(event.target as Node)) {
        setGroupMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [groupMenuOpen]);

  useEffect(() => {
    if (!isActive) return;

    setCountdownNow(Date.now());
    const countdownInterval = window.setInterval(() => {
      setCountdownNow(Date.now());
    }, 1000);

    return () => window.clearInterval(countdownInterval);
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;

    const refreshVisibleData = () => {
      if (document.visibilityState !== 'visible') return;
      void loadLocks(false);
      if (historyLoadedRef.current) {
        void loadHistory({ force: true, silent: true });
      }
    };

    if (!initialLoadStartedRef.current) {
      initialLoadStartedRef.current = true;
      void loadLocks(true).then(() => {
        void loadHistory({ silent: true });
      });
    } else {
      refreshVisibleData();
    }

    const subscription = supabase
      .channel('account_locks_changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'account_locks'
      }, refreshVisibleData)
      .subscribe();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshVisibleData();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      subscription.unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isActive, loadHistory, loadLocks]);

  useEffect(() => {
    if (!isActive || !nextExpiry) return;

    const refreshDelay = Math.max(1000, nextExpiry - Date.now() + 1000);
    const timeout = window.setTimeout(() => {
      if (document.visibilityState === 'visible') {
        void loadLocks(false);
      }
    }, refreshDelay);

    return () => window.clearTimeout(timeout);
  }, [isActive, nextExpiry, loadLocks]);

  const handleUnlock = async (lock: AccountLock) => {
    if (!admin?.id) {
      setMessage({ type: 'error', text: '無法取得管理員識別資訊。' });
      return;
    }

    try {
      setUnlocking(lock.id);
      setMessage(null);

      const result = await unlockAccount(lock.identifier, 'username', admin.id);

      if (result.success) {
        setMessage({ type: 'success', text: `已成功解除鎖定：${lock.identifier}` });
        await loadLocks(false);
      } else {
        setMessage({ type: 'error', text: '解除鎖定失敗，請稍後再試。' });
      }
    } catch (error) {
      console.error('Unlock failed:', error);
      setMessage({ type: 'error', text: '解除鎖定失敗，請稍後再試。' });
    } finally {
      setUnlocking(null);
    }
  };

  const formatRemainingTime = (seconds: number) => {
    if (seconds < 60) return `${seconds} 秒`;

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes} 分鐘 ${remainingSeconds} 秒`;

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (hours < 24) return `${hours} 小時 ${remainingMinutes} 分 ${remainingSeconds} 秒`;

    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days} 天 ${remainingHours} 小時 ${remainingMinutes} 分 ${remainingSeconds} 秒`;
  };

  const getRemainingTime = (lockUntil: string, currentTime: number) => {
    const until = new Date(lockUntil).getTime();
    const seconds = Math.max(0, Math.ceil((until - currentTime) / 1000));
    return formatRemainingTime(seconds);
  };

  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const selectedAdmin = adminGroups.find(group => group.id === selectedAdminId);
  const filterLocks = (items: AccountLock[]) => items.filter(lock => {
    const matchesAdmin = selectedAdminId === 'all'
      || lock.admin_username?.toLocaleLowerCase() === selectedAdmin?.username.toLocaleLowerCase();
    if (!matchesAdmin) return false;
    if (!normalizedSearchQuery) return true;

    return [lock.username, lock.employee_id, lock.identifier]
      .filter(Boolean)
      .some(value => value!.toLocaleLowerCase().includes(normalizedSearchQuery));
  });
  const filteredLocks = filterLocks(locks);
  const filteredHistoryLocks = filterLocks(historyLocks);
  const visibleLocks = showHistory ? filteredHistoryLocks : filteredLocks;
  const hasActiveFilters = Boolean(normalizedSearchQuery) || selectedAdminId !== 'all';
  const isInitialHistoryLoading = showHistory && historyLoading && !historyLoadedRef.current;
  const usernameLocks = filteredLocks.length;
  const expiringSoon = filteredLocks.filter(lock => {
    const remaining = new Date(lock.lock_until).getTime() - Date.now();
    return remaining > 0 && remaining <= 30 * 60 * 1000;
  }).length;
  const manuallyResolvedHistoryCount = filteredHistoryLocks.filter(lock => Boolean(lock.unlocked_by)).length;
  const automaticallyResolvedHistoryCount = filteredHistoryLocks.filter(
    lock => !lock.unlocked_by && new Date(lock.lock_until).getTime() <= Date.now()
  ).length;
  const getLockStatus = (lock: AccountLock, currentTime: number) => {
    const isCurrentlyLocked = !lock.unlocked_at
      && !lock.unlocked_by
      && new Date(lock.lock_until).getTime() > currentTime;

    if (!showHistory || isCurrentlyLocked) {
      return {
        label: showHistory ? '目前鎖定' : '鎖定中',
        badgeClass: 'border-rose-300/30 bg-rose-500/[0.12] text-rose-200',
        textClass: 'text-rose-300',
        metaLabelClass: 'text-rose-300/80',
        metaValueClass: 'text-rose-200',
        accountBadgeClass: 'border-rose-300/30 bg-rose-500/[0.12] text-rose-200',
        cardClass: 'border-rose-300/25 bg-rose-950/20 hover:border-rose-300/50 hover:bg-rose-950/35',
        accentClass: 'border-rose-400/80',
        iconClass: 'border-rose-300/30 bg-rose-400/[0.1] text-rose-300 group-hover:border-rose-200/60 group-hover:bg-rose-400/20'
      };
    }

    if (lock.unlocked_by) {
      return {
        label: '已解除',
        badgeClass: 'border-emerald-300/30 bg-emerald-400/[0.1] text-emerald-200',
        textClass: 'text-emerald-300',
        metaLabelClass: 'text-emerald-300/80',
        metaValueClass: 'text-emerald-200',
        accountBadgeClass: 'border-emerald-300/30 bg-emerald-400/[0.1] text-emerald-200',
        cardClass: 'border-emerald-300/25 bg-emerald-950/20 hover:border-emerald-300/50 hover:bg-emerald-950/35',
        accentClass: 'border-emerald-400/80',
        iconClass: 'border-emerald-300/30 bg-emerald-400/[0.1] text-emerald-300 group-hover:border-emerald-200/60 group-hover:bg-emerald-400/20'
      };
    }

    return {
      label: '自動解除',
      badgeClass: 'border-sky-300/30 bg-sky-400/[0.08] text-sky-200',
      textClass: 'text-sky-300',
      metaLabelClass: 'text-sky-300/80',
      metaValueClass: 'text-sky-200',
      accountBadgeClass: 'border-sky-300/30 bg-sky-400/[0.08] text-sky-200',
      cardClass: 'border-sky-300/20 bg-sky-950/15 hover:border-sky-300/45 hover:bg-sky-950/25',
      accentClass: 'border-sky-400/70',
      iconClass: 'border-sky-300/25 bg-sky-400/[0.08] text-sky-300 group-hover:border-sky-200/55 group-hover:bg-sky-400/15'
    };
  };

  const handleShowHistory = () => {
    setShowHistory(true);
    void loadHistory();
  };

  const handleShowCurrentLocks = () => {
    setShowHistory(false);
  };

  const selectedGroupLabel = selectedAdminId === 'all'
    ? '總分組'
    : selectedAdmin?.username || '管理員分組';
  const isRefreshing = refreshing || historyLoading;

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-slate-400">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-orange-400/20 bg-orange-500/10">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-orange-300/25 border-t-orange-300" />
          </div>
          <span className="text-sm">正在載入鎖定記錄...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_88%_0%,rgba(245,158,11,0.1),transparent_62%),radial-gradient(ellipse_55%_65%_at_10%_100%,rgba(14,116,144,0.08),transparent_68%)]" />
      <div className={`relative shrink-0 border-b px-4 py-4 sm:px-6 lg:px-8 ${showHistory ? 'border-violet-400/20' : 'border-orange-400/15'}`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${showHistory ? 'border border-violet-300/30 bg-violet-400/10 text-violet-300 shadow-[0_0_24px_rgba(139,92,246,0.14)]' : 'border border-orange-300/25 bg-orange-400/10 text-orange-300 shadow-[0_0_24px_rgba(245,158,11,0.12)]'}`}>
              <Shield className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold tracking-tight text-white sm:text-2xl">{showHistory ? '歷史鎖定記錄' : '已鎖定帳戶'}</h1>
              <p className="mt-0.5 text-xs text-slate-400">{showHistory ? '檢視歷史帳戶防護鎖定記錄。' : '檢視目前的帳戶防護鎖定記錄。'}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2.5">
            {admin.role === 'super_admin' && (
              <div ref={groupMenuRef} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setGroupMenuOpen(open => !open)}
                  disabled={adminGroupsLoading}
                  aria-expanded={groupMenuOpen}
                  aria-haspopup="listbox"
                  className="group inline-flex h-10 max-w-[190px] items-center gap-2 rounded-xl border border-violet-300/35 bg-[linear-gradient(135deg,rgba(139,92,246,0.2),rgba(8,47,73,0.34))] px-2.5 text-left shadow-[0_6px_18px_rgba(2,6,23,0.24)] transition-[background-color,border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-violet-200/70 hover:bg-violet-500/25 hover:shadow-[0_8px_22px_rgba(2,6,23,0.34)] disabled:cursor-wait disabled:opacity-70"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-violet-200/25 bg-violet-300/15 text-violet-200 transition-colors group-hover:border-violet-100/45 group-hover:bg-violet-300/25">
                    <Users className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 leading-tight">
                    <span className="block text-[9px] font-semibold uppercase tracking-[0.12em] text-violet-200/70">管理員分組</span>
                    <span className="block max-w-[112px] truncate text-[11px] font-bold text-violet-50">{adminGroupsLoading ? '載入中...' : selectedGroupLabel}</span>
                  </span>
                  <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-violet-200/80 transition-transform ${groupMenuOpen ? 'rotate-180' : ''}`} />
                </button>
                {groupMenuOpen && !adminGroupsLoading && (
                  <div className="absolute right-0 top-full z-50 mt-2 w-[278px] overflow-hidden rounded-2xl border border-violet-200/25 bg-[linear-gradient(160deg,rgba(15,23,42,0.98),rgba(20,28,55,0.98))] p-2 shadow-[0_22px_55px_rgba(2,6,23,0.68)] backdrop-blur-xl">
                    <div className="mb-1.5 border-b border-white/[0.08] px-2 pb-2">
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-200/70">切換管理員分組</p>
                      <p className="mt-1 text-[11px] text-slate-500">同步篩選目前與歷史鎖定</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedAdminId('all');
                        setGroupMenuOpen(false);
                      }}
                      className={`group flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition-[background-color,border-color,transform] duration-150 ${selectedAdminId === 'all' ? 'border-cyan-200/45 bg-cyan-300/15 text-cyan-50' : 'border-transparent text-slate-300 hover:-translate-y-px hover:border-cyan-300/25 hover:bg-cyan-300/[0.08] hover:text-white'}`}
                      role="option"
                      aria-selected={selectedAdminId === 'all'}
                    >
                      <span className="flex min-w-0 items-center gap-2.5"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-cyan-200/25 bg-cyan-300/15 text-cyan-200"><Users className="h-3.5 w-3.5" /></span><span><span className="block text-xs font-bold">總分組</span><span className="mt-0.5 block text-[10px] text-slate-500">查看全部管理員</span></span></span>
                      {selectedAdminId === 'all' && <span className="h-2 w-2 rounded-full bg-cyan-200 shadow-[0_0_10px_rgba(165,243,252,0.7)]" />}
                    </button>
                    <div className="mt-1.5 space-y-1">
                      {adminGroups.map(group => (
                        <button
                          key={group.id}
                          type="button"
                          onClick={() => {
                            setSelectedAdminId(group.id);
                            setGroupMenuOpen(false);
                          }}
                          className={`group flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left transition-[background-color,border-color,transform] duration-150 ${selectedAdminId === group.id ? 'border-violet-200/45 bg-violet-300/15 text-violet-50' : 'border-transparent text-slate-300 hover:-translate-y-px hover:border-violet-300/25 hover:bg-violet-300/[0.08] hover:text-white'}`}
                          role="option"
                          aria-selected={selectedAdminId === group.id}
                        >
                          <span className="flex min-w-0 items-center gap-2.5"><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-[10px] font-black ${group.role === 'super_admin' ? 'border-amber-200/30 bg-amber-300/15 text-amber-100' : 'border-violet-200/25 bg-violet-300/15 text-violet-200'}`}>{group.username.slice(0, 1).toUpperCase()}</span><span className="min-w-0"><span className="block truncate text-xs font-bold">{group.username}</span><span className="mt-0.5 block text-[10px] text-slate-500">{group.role === 'super_admin' ? 'Super Admin' : 'Secondary Admin'}</span></span></span>
                          {selectedAdminId === group.id && <span className="h-2 w-2 rounded-full bg-violet-200 shadow-[0_0_10px_rgba(221,214,254,0.65)]" />}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <label className="group flex h-10 w-[180px] items-center gap-2 rounded-xl border border-cyan-300/25 bg-[linear-gradient(135deg,rgba(8,47,73,0.46),rgba(15,23,42,0.82))] px-3 text-slate-300 shadow-[0_6px_18px_rgba(2,6,23,0.2)] transition-[background-color,border-color,box-shadow] duration-150 focus-within:border-cyan-200/75 focus-within:bg-cyan-950/35 focus-within:shadow-[0_8px_24px_rgba(8,47,73,0.3)] sm:w-[220px]">
              <Search className="h-4 w-4 shrink-0 text-cyan-300/75 transition-colors group-focus-within:text-cyan-200" />
              <input
                type="search"
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder="搜尋帳戶或 ID"
                aria-label="搜尋員工帳戶或員工 ID"
                className="min-w-0 flex-1 bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="rounded-md p-1 text-slate-500 transition-colors hover:bg-white/[0.08] hover:text-slate-200"
                  aria-label="清除搜尋"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </label>
            <button
              type="button"
              onClick={handleShowCurrentLocks}
              className={`inline-flex h-10 min-w-[108px] items-center justify-center gap-2 rounded-xl border px-3 text-xs font-bold transition-colors active:scale-[0.97] ${!showHistory
                ? 'border-orange-200 bg-orange-500 text-white'
                : 'border-orange-400/40 bg-orange-500/[0.12] text-orange-200 hover:border-orange-300/70 hover:bg-orange-500/20 hover:text-orange-100'
              }`}
              title="查看目前鎖定記錄"
              aria-pressed={!showHistory}
            >
              <Shield className={`h-4 w-4 ${!showHistory ? 'text-orange-50' : 'text-orange-300/75'}`} />
              目前鎖定
              {!showHistory && <span className="h-1.5 w-1.5 rounded-full bg-orange-50" aria-hidden="true" />}
            </button>
            <button
              type="button"
              onClick={handleShowHistory}
              className={`inline-flex h-10 min-w-[108px] items-center justify-center gap-2 rounded-xl border px-3 text-xs font-bold transition-colors active:scale-[0.97] ${showHistory
                ? 'border-violet-200 bg-violet-600 text-white'
                : 'border-violet-400/40 bg-violet-500/[0.12] text-violet-200 hover:border-violet-300/70 hover:bg-violet-500/20 hover:text-violet-100'
              }`}
              title="查看歷史鎖定記錄"
              aria-pressed={showHistory}
            >
              <History className={`h-4 w-4 ${showHistory ? 'text-violet-50' : 'text-violet-300/75'} ${historyLoading ? 'animate-pulse' : ''}`} />
              歷史鎖定
              {showHistory && <span className="h-1.5 w-1.5 rounded-full bg-violet-50" aria-hidden="true" />}
            </button>
            <button
              type="button"
              onClick={() => showHistory ? void loadHistory({ force: true }) : void loadLocks(false)}
              disabled={isRefreshing}
              aria-busy={isRefreshing}
              className="inline-flex h-10 min-w-[94px] items-center justify-center gap-2 rounded-xl border border-blue-200/80 bg-blue-600 px-3 text-xs font-bold text-white transition-[background-color,border-color,transform] duration-150 active:scale-[0.97] hover:border-blue-100 hover:bg-blue-500 disabled:cursor-wait disabled:border-blue-200/55 disabled:bg-blue-500/75 disabled:text-blue-50"
              title={showHistory ? '刷新歷史記錄' : '刷新鎖定記錄'}
            >
              <RefreshCw className={`h-4 w-4 text-blue-50 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>{isRefreshing ? '刷新中...' : '刷新'}</span>
            </button>
          </div>
        </div>

        <div className={`mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border px-3 py-2.5 sm:px-4 ${showHistory ? 'border-violet-300/25 bg-violet-500/[0.08] shadow-[0_8px_24px_rgba(139,92,246,0.08)]' : 'border-orange-300/25 bg-orange-500/[0.08] shadow-[0_8px_24px_rgba(245,158,11,0.08)]'}`}>
          {showHistory ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="h-2 w-2 rounded-full bg-violet-300 shadow-[0_0_9px_rgba(196,181,253,0.9)]" />
                <span className="text-[10px] font-bold tracking-wide text-violet-100/90">歷史鎖定</span>
                <span className="text-lg font-bold leading-none text-violet-50">{historyLocks.length}</span>
              </div>
              <span className="hidden h-4 w-px bg-violet-200/25 sm:block" />
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] font-bold tracking-wide text-emerald-200/85">管理員解除</span>
                <span className="text-sm font-bold leading-none text-emerald-200">{manuallyResolvedHistoryCount}</span>
              </div>
              <span className="hidden h-4 w-px bg-violet-200/25 sm:block" />
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] font-bold tracking-wide text-sky-200/85">系統自動解除</span>
                <span className="text-sm font-bold leading-none text-sky-200">{automaticallyResolvedHistoryCount}</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-orange-300 shadow-[0_0_8px_rgba(253,186,116,0.85)]" />
                <span className="text-[10px] font-bold tracking-wide text-orange-100/85">目前鎖定</span>
                <span className="text-lg font-bold leading-none text-orange-50">{locks.length}</span>
              </div>
              <span className="hidden h-4 w-px bg-orange-200/25 sm:block" />
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] font-bold tracking-wide text-orange-100/75">使用者名稱鎖定</span>
                <span className="text-sm font-bold leading-none text-orange-50">{usernameLocks}</span>
              </div>
              <span className="hidden h-4 w-px bg-orange-200/25 sm:block" />
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] font-bold tracking-wide text-orange-100/75">即將到期</span>
                <span className="text-sm font-bold leading-none text-orange-50">{expiringSoon}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {message && (
        <div className={`relative shrink-0 border-b px-4 py-3 text-sm sm:px-6 lg:px-8 ${
          message.type === 'success'
            ? 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-200'
            : 'border-rose-400/20 bg-rose-400/[0.06] text-rose-200'
        }`}>
          <span className={`mr-2 inline-block h-1.5 w-1.5 rounded-full align-middle ${message.type === 'success' ? 'bg-emerald-300' : 'bg-rose-300'}`} />
          {message.text}
        </div>
      )}

      {visibleLocks.length === 0 ? (
        isInitialHistoryLoading ? (
          <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-16 text-center text-slate-400">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-300/25 border-t-violet-300" />
            <p className="mt-4 text-sm font-semibold text-slate-200">正在載入歷史鎖定記錄...</p>
          </div>
        ) : (
          <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-16 text-center text-slate-400">
          <Shield className="h-12 w-12 text-emerald-300/45" />
          <p className="mt-4 text-base font-semibold text-slate-200">{hasActiveFilters ? '沒有符合篩選條件的記錄' : showHistory ? '目前沒有歷史鎖定記錄' : '目前沒有被鎖定的帳戶'}</p>
          <p className="mt-1 text-xs text-slate-500">{showHistory ? '員工帳戶的過往防護鎖定會顯示在這裡。' : '系統偵測到異常登入行為時，會自動顯示防護記錄。'}</p>
          </div>
        )
      ) : (
        <div className="relative min-h-0 flex-1 overflow-y-auto dark-panel-scroll px-4 pb-6 pt-4 sm:px-6 lg:px-8">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <p className={`text-[10px] font-bold uppercase tracking-[0.18em] ${showHistory ? 'text-violet-300/85' : 'text-orange-300/80'}`}>{showHistory ? '歷史清單' : '防護清單'}</p>
              <p className="mt-1 text-xs text-slate-500">{showHistory ? '查看員工帳戶過往的鎖定與解除記錄' : '目前仍生效的帳戶鎖定記錄'}</p>
            </div>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 ${showHistory
              ? 'border-violet-300/35 bg-violet-500/[0.12] text-violet-200 shadow-[0_0_18px_rgba(139,92,246,0.14)]'
              : 'border-orange-300/25 bg-orange-400/[0.1] text-orange-200/90'
            }`}>
              <History className={`h-3.5 w-3.5 ${showHistory ? 'text-violet-300' : 'text-orange-300'}`} />
              <span className="text-sm font-bold">{visibleLocks.length} 筆記錄</span>
            </span>
          </div>
          <div className="space-y-3">
            {visibleLocks.map((lock) => {
              const isPendingHistoryLock = showHistory
                && !lock.unlocked_at
                && !lock.unlocked_by
                && new Date(lock.lock_until).getTime() > countdownNow;
              const status = getLockStatus(lock, countdownNow);
              const releaseTimeClass = lock.unlocked_by
                ? 'text-emerald-300'
                : status.label === '自動解除'
                  ? 'text-sky-300'
                  : 'text-rose-300';
              const releaseTimeLabelClass = lock.unlocked_by
                ? 'text-emerald-300/80'
                : status.label === '自動解除'
                  ? 'text-sky-300/80'
                  : 'text-rose-300/80';
              const releaseTimeValue = new Date(
                lock.unlocked_by ? lock.unlocked_at || lock.lock_until : lock.lock_until
              ).toLocaleString();

              return (
                <article
                  key={lock.id}
                  className={`group overflow-hidden border shadow-[0_10px_28px_rgba(2,6,23,0.24)] transition-colors duration-150 ${showHistory ? 'rounded-xl' : 'rounded-2xl'} ${status.cardClass}`}
                >
                  <div className={`border-l-2 px-4 sm:px-5 ${showHistory ? 'py-3' : 'py-4'} ${status.accentClass}`}>
                    <div className={`flex flex-col xl:flex-row xl:items-center ${showHistory ? 'gap-3' : 'gap-4'}`}>
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <div className={`flex shrink-0 items-center justify-center transition-colors ${showHistory ? 'h-10 w-10 rounded-lg' : 'h-11 w-11 rounded-xl'} ${status.iconClass}`}>
                          <User className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="max-w-full truncate font-mono text-base font-semibold text-slate-100">{lock.username || lock.identifier}</span>
                            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold tracking-wide ${status.accountBadgeClass}`}>
                              使用者帳戶
                            </span>
                            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold tracking-wide ${status.badgeClass}`}>
                              {status.label}
                            </span>
                          </div>
                          <div className={`mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold ${status.metaLabelClass}`}>
                            <span>員工 ID：<span className={`font-mono ${status.metaValueClass}`}>{lock.employee_id || '未記錄'}</span></span>
                            <span>登入 IP：<span className={`font-mono ${status.metaValueClass}`}>{lock.lock_ip || '未記錄'}</span></span>
                          </div>
                          <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-slate-400">
                            <AlertTriangle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${status.metaLabelClass}`} />
                            <span className="line-clamp-2">{lock.lock_reason || '系統偵測到異常登入活動，已啟用暫時防護。'}</span>
                          </p>
                        </div>
                      </div>

                      <div className={`grid grid-cols-2 border-t border-orange-300/15 xl:min-w-[500px] xl:border-l xl:border-t-0 xl:pl-5 ${showHistory ? 'gap-x-5 gap-y-2 pt-2.5 sm:grid-cols-3 xl:pt-0' : 'gap-x-6 gap-y-3 pt-3 sm:grid-cols-4 xl:pt-0'}`}>
                        <div>
                          <p className={`text-[10px] font-bold tracking-[0.12em] ${status.metaLabelClass}`}>防護狀態</p>
                          <p className={`mt-1 text-sm font-bold ${status.textClass}`}>{status.label}</p>
                        </div>
                        {showHistory ? (
                          <div className="min-w-0">
                            <p className="text-[10px] font-bold tracking-[0.12em] text-rose-300/80">鎖定時間</p>
                            <p className="mt-1 flex min-w-0 items-center gap-1.5 truncate text-xs font-semibold text-rose-300">
                              <Clock className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate whitespace-nowrap">{new Date(lock.created_at).toLocaleString()}</span>
                            </p>
                            <p className={`mt-2 text-[10px] font-bold tracking-[0.12em] ${releaseTimeLabelClass}`}>
                              {lock.unlocked_by ? '管理員手動解除時間' : status.label === '自動解除' ? '系統自動解除時間' : '預計解除時間'}
                            </p>
                            <p className={`mt-1 flex min-w-0 items-center gap-1.5 truncate text-xs font-semibold ${releaseTimeClass}`}>
                              <Unlock className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate whitespace-nowrap">{releaseTimeValue}</span>
                            </p>
                          </div>
                        ) : (
                          <div>
                            <p className={`text-[10px] font-bold tracking-[0.12em] ${status.metaLabelClass}`}>剩餘時間</p>
                            <p className={`mt-1 flex items-center gap-1.5 text-base font-bold ${status.textClass}`}>
                              <Clock className={`h-4 w-4 ${status.textClass}`} />
                              {getRemainingTime(lock.lock_until, countdownNow)}
                            </p>
                          </div>
                        )}
                        <div>
                          <p className="text-[10px] font-bold tracking-[0.12em] text-rose-300/80">失敗嘗試</p>
                          <p className="mt-1 text-sm font-bold text-rose-300">{lock.failed_attempts} 次</p>
                        </div>
                        {!showHistory && (
                          <div className="min-w-0">
                            <p className={`text-[10px] font-bold tracking-[0.12em] ${status.metaLabelClass}`}>鎖定時間</p>
                            <p className={`mt-1 truncate text-xs font-semibold ${status.textClass}`}>{new Date(lock.created_at).toLocaleString()}</p>
                          </div>
                        )}
                      </div>

                      <div className={`flex flex-wrap items-center justify-between border-t border-white/[0.08] xl:w-[150px] xl:shrink-0 xl:flex-col xl:items-stretch xl:border-t-0 xl:pl-1 ${showHistory ? 'gap-2 pt-2.5 xl:pt-0' : 'gap-3 pt-3 xl:pt-0'}`}>
                        {showHistory ? (
                          isPendingHistoryLock ? (
                            <div>
                              <p className="truncate text-xs font-bold text-rose-300">等待解除中</p>
                              <p className="mt-1 flex items-center gap-1.5 text-base font-bold text-rose-300">
                                <Clock className="h-4 w-4 shrink-0" />
                                {getRemainingTime(lock.lock_until, countdownNow)}
                              </p>
                            </div>
                          ) : lock.unlocked_by ? (
                            <p className="truncate text-xs font-medium text-emerald-300/80">手動解除：<span className="text-sm font-semibold text-emerald-200">{lock.admin_username || '管理員'}</span></p>
                          ) : (
                            <p className="truncate text-xs font-medium text-sky-300/80">系統自動解除</p>
                          )
                        ) : (
                          <>
                            {lock.admin_username && admin.role === 'super_admin' && (
                              <p className="truncate text-xs font-medium text-slate-400">鎖定所屬管理員：<span className="text-sm font-semibold text-cyan-200">{lock.admin_username}</span></p>
                            )}
                            <button
                              type="button"
                              onClick={() => handleUnlock(lock)}
                              disabled={unlocking === lock.id}
                              aria-busy={unlocking === lock.id}
                              className="inline-flex h-10 min-w-[132px] items-center justify-center gap-2 rounded-xl border border-orange-300/65 bg-orange-500/[0.16] px-4 text-xs font-bold text-orange-100 shadow-[0_6px_16px_rgba(2,6,23,0.22)] transition-[background-color,border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-orange-100 hover:bg-orange-500/35 hover:text-white hover:shadow-[0_8px_18px_rgba(2,6,23,0.3)] active:translate-y-0 active:scale-[0.96] active:bg-orange-500/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:translate-y-0 disabled:cursor-wait disabled:border-orange-200/40 disabled:bg-orange-500/30 disabled:text-orange-100 disabled:shadow-none"
                            >
                              {unlocking === lock.id ? (
                                <>
                                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-orange-200/45 border-t-orange-50" />
                                  <span>解除鎖定中...</span>
                                </>
                              ) : (
                                <>
                                  <Unlock className="h-3.5 w-3.5" />
                                  <span>解除鎖定</span>
                                </>
                              )}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
