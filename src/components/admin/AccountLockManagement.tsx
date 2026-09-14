import { useState, useEffect, useCallback } from 'react';
import { Shield, Unlock, AlertTriangle, Clock, User, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { unlockAccount, formatLockDuration } from '../../lib/rateLimitService';
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
        const errorMessage = error.message || 'Unknown error';
        if (isInitial) {
          setMessage({
            type: 'error',
            text: `Failed to load lock records: ${errorMessage}`
          });
        }
        return;
      }

      setLocks(data || []);
      setMessage(null);

      // Calculate next expiry time
      if (data && data.length > 0) {
        const nextLockExpiry = Math.min(
          ...data.map((lock: AccountLock) => new Date(lock.lock_until).getTime())
        );
        setNextExpiry(nextLockExpiry);
      } else {
        setNextExpiry(null);
      }
    } catch (error: unknown) {
      console.error('Failed to load locks:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (isInitial) {
        setMessage({
          type: 'error',
          text: `Failed to load lock records: ${errorMessage}`
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
      setMessage({ type: 'error', text: 'Unable to get admin ID' });
      return;
    }

    try {
      setUnlocking(lock.id);
      setMessage(null);

      const result = await unlockAccount(lock.identifier, lock.identifier_type as 'ip' | 'username', admin.id);

      if (result.success) {
        setMessage({ type: 'success', text: `Successfully unlocked ${lock.identifier}` });
        await loadLocks(false);
      } else {
        setMessage({ type: 'error', text: result.message });
      }
    } catch (error) {
      console.error('Unlock failed:', error);
      setMessage({ type: 'error', text: 'Failed to unlock account' });
    } finally {
      setUnlocking(null);
    }
  };

  const getRemainingTime = (lockUntil: string) => {
    const now = new Date().getTime();
    const until = new Date(lockUntil).getTime();
    const seconds = Math.max(0, Math.floor((until - now) / 1000));
    return formatLockDuration(seconds);
  };

  const usernameLocks = locks.filter(lock => lock.identifier_type === 'username').length;
  const ipLocks = locks.filter(lock => lock.identifier_type === 'ip').length;
  const expiringSoon = locks.filter(lock => {
    const remaining = new Date(lock.lock_until).getTime() - Date.now();
    return remaining > 0 && remaining <= 30 * 60 * 1000;
  }).length;

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-slate-400">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-orange-400/20 bg-orange-500/10">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-orange-300/25 border-t-orange-300" />
          </div>
          <span className="text-sm">正在加载锁定记录...</span>
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
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-300/80">Access protection</p>
              <h1 className="truncate text-xl font-bold tracking-tight text-white sm:text-2xl">Locked accounts</h1>
              <p className="mt-0.5 text-xs text-slate-400">Review active account and IP protection locks.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {refreshing && (
              <span className="flex items-center gap-1.5 text-xs text-slate-400">
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-orange-300" />
                Updating
              </span>
            )}
            <button
              type="button"
              onClick={() => loadLocks(false)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-orange-300/35 bg-orange-500/15 px-3 text-xs font-semibold text-orange-100 shadow-[0_0_18px_rgba(245,158,11,0.08)] transition-all hover:border-orange-200/80 hover:bg-orange-500/30 hover:text-white hover:shadow-[0_0_22px_rgba(245,158,11,0.18)] active:scale-[0.98]"
              title="刷新锁定记录"
            >
              <RefreshCw className={`h-4 w-4 text-orange-300 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/[0.07] pt-3">
          <div className="flex items-baseline gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-orange-300 shadow-[0_0_8px_rgba(253,186,116,0.8)]" />
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Active locks</span>
            <span className="text-lg font-bold leading-none text-orange-200">{locks.length}</span>
          </div>
          <span className="hidden h-4 w-px bg-white/10 sm:block" />
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Username locks</span>
            <span className="text-sm font-bold text-slate-200">{usernameLocks}</span>
          </div>
          <span className="hidden h-4 w-px bg-white/10 sm:block" />
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">IP locks</span>
            <span className="text-sm font-bold text-slate-200">{ipLocks}</span>
          </div>
          <span className="hidden h-4 w-px bg-white/10 sm:block" />
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Expiring soon</span>
            <span className={`text-sm font-bold ${expiringSoon > 0 ? 'text-amber-300' : 'text-slate-300'}`}>{expiringSoon}</span>
          </div>
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

      {locks.length === 0 ? (
        <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-16 text-center text-slate-400">
          <Shield className="h-12 w-12 text-emerald-300/45" />
          <p className="mt-4 text-base font-semibold text-slate-200">当前没有被锁定的账户</p>
          <p className="mt-1 text-xs text-slate-500">系统会在检测到异常登录行为时自动显示保护记录。</p>
        </div>
      ) : (
        <div className="relative min-h-0 flex-1 overflow-y-auto dark-panel-scroll px-4 sm:px-6 lg:px-8">
          <div className="hidden border-b border-white/10 py-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 md:grid md:grid-cols-[minmax(250px,1.2fr)_minmax(210px,1fr)_minmax(230px,1fr)_auto] md:gap-5">
            <span>Identifier</span>
            <span>Lock reason</span>
            <span>Timing & attempts</span>
            <span className="text-right">Action</span>
          </div>
          <div className="divide-y divide-white/[0.07]">
            {locks.map((lock) => (
              <div
                key={lock.id}
                className="group grid gap-4 py-4 transition-colors duration-150 hover:bg-orange-300/[0.045] md:grid-cols-[minmax(250px,1.2fr)_minmax(210px,1fr)_minmax(230px,1fr)_auto] md:items-center md:gap-5 md:px-2"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-orange-300/15 bg-orange-400/[0.08] text-orange-300 transition-colors group-hover:border-orange-300/35 group-hover:bg-orange-400/15">
                    {lock.identifier_type === 'username' ? <User className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-mono text-sm font-semibold text-slate-100">{lock.identifier}</span>
                      <span className="rounded-full border border-slate-500/25 bg-slate-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                        {lock.identifier_type === 'username' ? 'Username' : 'IP'}
                      </span>
                    </div>
                    {lock.username && <p className="mt-1 truncate text-xs text-slate-500">Account: {lock.username}</p>}
                  </div>
                </div>

                <div className="min-w-0 md:pl-1">
                  <p className="mb-1 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-600 md:hidden">Lock reason</p>
                  <div className="flex items-start gap-2 text-sm text-slate-300">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300/80" />
                    <span className="line-clamp-2">{lock.lock_reason || 'Suspicious activity threshold'}</span>
                  </div>
                </div>

                <div className="min-w-0 text-xs text-slate-500 md:pl-1">
                  <p className="mb-1 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-600 md:hidden">Timing & attempts</p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="flex items-center gap-1.5 text-orange-200/80">
                      <Clock className="h-3.5 w-3.5 text-orange-300/80" />
                      {getRemainingTime(lock.lock_until)} left
                    </span>
                    <span>Failed: <strong className="font-semibold text-rose-300">{lock.failed_attempts}</strong></span>
                  </div>
                  <p className="mt-1 truncate text-[10px] text-slate-600">Locked {new Date(lock.created_at).toLocaleString()}</p>
                  {lock.admin_username && admin.role === 'super_admin' && (
                    <p className="mt-0.5 truncate text-[10px] text-slate-600">By <span className="text-cyan-300/70">{lock.admin_username}</span></p>
                  )}
                </div>

                <div className="flex justify-start md:justify-end">
                  <button
                    type="button"
                    onClick={() => handleUnlock(lock)}
                    disabled={unlocking === lock.id}
                    className="inline-flex h-9 items-center gap-2 border-l-2 border-amber-300/60 px-3 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-300/10 hover:text-amber-100 disabled:cursor-not-allowed disabled:border-slate-600 disabled:text-slate-500"
                  >
                    {unlocking === lock.id ? (
                      <>
                        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-500 border-t-amber-200" />
                        <span>解锁中...</span>
                      </>
                    ) : (
                      <>
                        <Unlock className="h-3.5 w-3.5" />
                        <span>解锁</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
