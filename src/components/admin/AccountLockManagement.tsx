import { useState, useEffect, useCallback } from 'react';
import { Shield, Unlock, AlertTriangle, Clock, User, RefreshCw, History } from 'lucide-react';
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
}

export default function AccountLockManagement({ admin }: AccountLockManagementProps) {
  const [locks, setLocks] = useState<AccountLock[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unlocking, setUnlocking] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [nextExpiry, setNextExpiry] = useState<number | null>(null);
  const [countdownNow, setCountdownNow] = useState(() => Date.now());
  const [historyLocks, setHistoryLocks] = useState<AccountLock[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const loadLocks = useCallback(async (isInitial = false) => {
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
      setLocks(locksWithEmployeeIds);
      setMessage(null);

      // Calculate next expiry time
      if (accountLocks.length > 0) {
        const nextLockExpiry = Math.min(
          ...accountLocks.map((lock: AccountLock) => new Date(lock.lock_until).getTime())
        );
        setNextExpiry(nextLockExpiry);
      } else {
        setNextExpiry(null);
      }
    } catch (error: unknown) {
      console.error('Failed to load locks:', error);
      if (isInitial) {
        setMessage({
          type: 'error',
          text: '載入鎖定記錄失敗，請稍後再試。'
        });
      }
    } finally {
      if (isInitial) {
        setLoading(false);
      } else {
        setRefreshing(false);
      }
    }
  }, [admin.id]);

  const loadHistory = useCallback(async () => {
    try {
      setHistoryLoading(true);
      setMessage(null);

      const { data, error } = await supabase.rpc('get_account_lock_history_for_admin', {
        p_admin_id: admin.id,
        p_limit: 200
      });

      if (error) {
        console.error('Failed to load lock history:', error);
        setMessage({ type: 'error', text: '載入歷史鎖定記錄失敗，請稍後再試。' });
        return;
      }

      setHistoryLocks((data || []).filter(lock => lock.identifier_type === 'username'));
      setHistoryLoaded(true);
    } catch (error) {
      console.error('Failed to load lock history:', error);
      setMessage({ type: 'error', text: '載入歷史鎖定記錄失敗，請稍後再試。' });
    } finally {
      setHistoryLoading(false);
    }
  }, [admin.id]);

  useEffect(() => {
    const countdownInterval = window.setInterval(() => {
      setCountdownNow(Date.now());
    }, 1000);

    return () => window.clearInterval(countdownInterval);
  }, []);

  useEffect(() => {
    void loadLocks(true);

    // Subscribe to account_locks changes with immediate reload
    const subscription = supabase
      .channel('account_locks_changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'account_locks'
      }, (payload) => {
        console.log('Account locks changed:', payload);
        void loadLocks(false);
      })
      .subscribe();

    // Add page visibility detection - refresh when user returns to the page
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('Page became visible, refreshing account locks...');
        void loadLocks(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Auto-refresh every 10 seconds to remove expired locks
    const autoRefreshInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadLocks(false);
      }
    }, 10000);

    return () => {
      subscription.unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(autoRefreshInterval);
    };
  }, [loadLocks]);

  // Smart refresh based on next expiry time
  useEffect(() => {
    if (!nextExpiry) return;

    const now = Date.now();
    const timeUntilExpiry = nextExpiry - now;

    // If lock expires in less than 30 seconds, set a timer to refresh right after expiry
    if (timeUntilExpiry > 0 && timeUntilExpiry <= 30000) {
      const timeout = setTimeout(() => {
        console.log('Lock expired, refreshing...');
        void loadLocks(false);
      }, timeUntilExpiry + 1000); // Add 1 second buffer

      return () => clearTimeout(timeout);
    }
  }, [nextExpiry, loadLocks]);

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
    const seconds = Math.max(0, Math.floor((until - currentTime) / 1000));
    return formatRemainingTime(seconds);
  };

  const usernameLocks = locks.length;
  const expiringSoon = locks.filter(lock => {
    const remaining = new Date(lock.lock_until).getTime() - Date.now();
    return remaining > 0 && remaining <= 30 * 60 * 1000;
  }).length;
  const visibleLocks = showHistory ? historyLocks : locks;
  const resolvedHistoryCount = historyLocks.filter(lock => Boolean(lock.unlocked_at)).length;
  const getLockStatus = (lock: AccountLock) => {
    if (!showHistory || (!lock.unlocked_at && new Date(lock.lock_until).getTime() > Date.now())) {
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

    if (lock.unlocked_at) {
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
    if (!historyLoaded) {
      void loadHistory();
    }
  };

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
      <div className="relative shrink-0 border-b border-orange-400/15 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-orange-300/25 bg-orange-400/10 text-orange-300 shadow-[0_0_24px_rgba(245,158,11,0.12)]">
              <Shield className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-300/80">存取防護</p>
              <h1 className="truncate text-xl font-bold tracking-tight text-white sm:text-2xl">{showHistory ? '歷史鎖定記錄' : '已鎖定帳戶'}</h1>
              <p className="mt-0.5 text-xs text-slate-400">{showHistory ? '檢視歷史帳戶防護鎖定記錄。' : '檢視目前的帳戶防護鎖定記錄。'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            {(refreshing || historyLoading) && (
              <span className="flex items-center gap-1.5 text-xs text-slate-400">
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-orange-300" />
                更新中
              </span>
            )}
            <button
              type="button"
              onClick={() => setShowHistory(false)}
              className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-all active:scale-[0.98] ${!showHistory
                ? 'border-orange-200/80 bg-orange-500/35 text-white shadow-[0_0_22px_rgba(245,158,11,0.18)]'
                : 'border-orange-300/35 bg-orange-500/10 text-orange-100 hover:border-orange-200/80 hover:bg-orange-500/25 hover:text-white'
              }`}
              title="查看目前鎖定記錄"
              aria-pressed={!showHistory}
            >
              <Shield className="h-4 w-4 text-orange-300" />
              目前鎖定
            </button>
            <button
              type="button"
              onClick={handleShowHistory}
              className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-all active:scale-[0.98] ${showHistory
                ? 'border-violet-200/80 bg-violet-500/35 text-white shadow-[0_0_22px_rgba(139,92,246,0.2)]'
                : 'border-violet-300/35 bg-violet-500/10 text-violet-100 hover:border-violet-200/80 hover:bg-violet-500/25 hover:text-white'
              }`}
              title="查看歷史鎖定記錄"
              aria-pressed={showHistory}
            >
              <History className={`h-4 w-4 text-violet-300 ${historyLoading ? 'animate-pulse' : ''}`} />
              歷史鎖定
            </button>
            <button
              type="button"
              onClick={() => showHistory ? void loadHistory() : void loadLocks(false)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-blue-300/40 bg-blue-500/20 px-3 text-xs font-semibold text-blue-100 shadow-[0_0_18px_rgba(59,130,246,0.1)] transition-all hover:border-blue-200/80 hover:bg-blue-500/35 hover:text-white hover:shadow-[0_0_22px_rgba(59,130,246,0.2)] active:scale-[0.98]"
              title={showHistory ? '刷新歷史記錄' : '刷新鎖定記錄'}
            >
              <RefreshCw className={`h-4 w-4 text-blue-300 ${(refreshing || historyLoading) ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-orange-300/25 bg-orange-500/[0.08] px-3 py-2.5 shadow-[0_8px_24px_rgba(245,158,11,0.08)] sm:px-4">
          {showHistory ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-orange-300 shadow-[0_0_8px_rgba(253,186,116,0.85)]" />
                <span className="text-[10px] font-bold tracking-wide text-orange-100/85">歷史鎖定</span>
                <span className="text-lg font-bold leading-none text-orange-50">{historyLocks.length}</span>
              </div>
              <span className="hidden h-4 w-px bg-orange-200/25 sm:block" />
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] font-bold tracking-wide text-orange-100/75">已解除</span>
                <span className="text-sm font-bold leading-none text-orange-50">{resolvedHistoryCount}</span>
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
        <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-16 text-center text-slate-400">
          <Shield className="h-12 w-12 text-emerald-300/45" />
          <p className="mt-4 text-base font-semibold text-slate-200">{showHistory ? '目前沒有歷史鎖定記錄' : '目前沒有被鎖定的帳戶'}</p>
          <p className="mt-1 text-xs text-slate-500">{showHistory ? '員工帳戶的過往防護鎖定會顯示在這裡。' : '系統偵測到異常登入行為時，會自動顯示防護記錄。'}</p>
        </div>
      ) : (
        <div className="relative min-h-0 flex-1 overflow-y-auto dark-panel-scroll px-4 pb-6 pt-4 sm:px-6 lg:px-8">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-300/80">{showHistory ? '歷史清單' : '防護清單'}</p>
              <p className="mt-1 text-xs text-slate-500">{showHistory ? '查看員工帳戶過往的鎖定與解除記錄' : '目前仍生效的帳戶鎖定記錄'}</p>
            </div>
            <span className="rounded-full border border-orange-300/20 bg-orange-400/[0.08] px-2.5 py-1 text-[10px] font-semibold text-orange-200/80">
              {visibleLocks.length} 筆記錄
            </span>
          </div>
          <div className="space-y-3">
            {visibleLocks.map((lock) => {
              const status = getLockStatus(lock);
              const releaseTimeClass = lock.unlocked_at
                ? 'text-emerald-300'
                : status.label === '自動解除'
                  ? 'text-sky-300'
                  : 'text-rose-300';
              const releaseTimeLabelClass = lock.unlocked_at
                ? 'text-emerald-300/80'
                : status.label === '自動解除'
                  ? 'text-sky-300/80'
                  : 'text-rose-300/80';
              const releaseTimeValue = new Date(
                lock.unlocked_at || lock.lock_until
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
                              {lock.unlocked_at ? '管理員手動解除時間' : status.label === '自動解除' ? '系統自動解除時間' : '預計解除時間'}
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
                          lock.admin_username ? (
                            <p className="truncate text-xs font-medium text-emerald-300/80">手動解除：<span className="text-sm font-semibold text-emerald-200">{lock.admin_username}</span></p>
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
                              className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-orange-300/45 bg-gradient-to-r from-orange-500/25 to-amber-500/15 px-3 text-xs font-semibold text-orange-100 shadow-[0_6px_18px_rgba(245,158,11,0.1)] transition-colors hover:border-orange-200/80 hover:bg-orange-500/40 hover:text-white disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-800/60 disabled:text-slate-500 disabled:shadow-none"
                            >
                              {unlocking === lock.id ? (
                                <>
                                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-500 border-t-orange-200" />
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
