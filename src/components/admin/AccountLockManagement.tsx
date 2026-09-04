import { useState, useEffect } from 'react';
import { Shield, Unlock, AlertTriangle, Clock, User, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { unlockAccount, formatLockDuration } from '../../lib/rateLimitService';
import { Admin } from '../../types';

interface AccountLock {
  id: string;
  identifier: string;
  identifier_type: string;
  lock_until: string;
  lock_reason: string;
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

  const loadLocks = async (isInitial = false) => {
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
        const now = Date.now();
        const nextLockExpiry = Math.min(
          ...data.map((lock: AccountLock) => new Date(lock.lock_until).getTime())
        );
        setNextExpiry(nextLockExpiry);
      } else {
        setNextExpiry(null);
      }
    } catch (error: any) {
      console.error('Failed to load locks:', error);
      const errorMessage = error?.message || error?.toString() || 'Unknown error';
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
  };

  useEffect(() => {
    loadLocks(true);

    // Subscribe to account_locks changes with immediate reload
    const subscription = supabase
      .channel('account_locks_changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'account_locks'
      }, (payload) => {
        console.log('Account locks changed:', payload);
        loadLocks(false);
      })
      .subscribe();

    // Add page visibility detection - refresh when user returns to the page
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('Page became visible, refreshing account locks...');
        loadLocks(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Auto-refresh every 10 seconds to remove expired locks
    const autoRefreshInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadLocks(false);
      }
    }, 10000);

    return () => {
      subscription.unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(autoRefreshInterval);
    };
  }, [admin.id]);

  // Smart refresh based on next expiry time
  useEffect(() => {
    if (!nextExpiry) return;

    const now = Date.now();
    const timeUntilExpiry = nextExpiry - now;

    // If lock expires in less than 30 seconds, set a timer to refresh right after expiry
    if (timeUntilExpiry > 0 && timeUntilExpiry <= 30000) {
      const timeout = setTimeout(() => {
        console.log('Lock expired, refreshing...');
        loadLocks(false);
      }, timeUntilExpiry + 1000); // Add 1 second buffer

      return () => clearTimeout(timeout);
    }
  }, [nextExpiry]);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded-full text-xs font-medium">
            {locks.length} 个锁定
          </span>
          {refreshing && (
            <div className="flex items-center gap-1 text-xs text-slate-400">
              <RefreshCw className="w-3 h-3 animate-spin" />
              <span>更新中...</span>
            </div>
          )}
        </div>
        <button
          onClick={() => loadLocks(false)}
          className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
          title="刷新"
        >
          <RefreshCw className={`w-4 h-4 text-slate-400 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {message && (
        <div className={`p-3 rounded-lg border ${
          message.type === 'success'
            ? 'bg-green-500/10 border-green-500/30 text-green-300'
            : 'bg-red-500/10 border-red-500/30 text-red-300'
        }`}>
          {message.text}
        </div>
      )}

      {locks.length === 0 ? (
        <div className="text-center py-8 text-slate-400">
          <Shield className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p>当前没有被锁定的账户</p>
        </div>
      ) : (
        <div className="space-y-2">
          {locks.map((lock) => (
            <div
              key={lock.id}
              className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 hover:bg-slate-800/70 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-orange-400" />
                    <span className="font-mono text-slate-200">{lock.identifier}</span>
                    <span className="bg-slate-700 px-2 py-0.5 rounded text-xs text-slate-300">
                      {lock.identifier_type === 'username' ? '用户名' : 'IP'}
                    </span>
                    {lock.username && (
                      <span className="text-slate-400 text-sm">
                        ({lock.username})
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <AlertTriangle className="w-4 h-4" />
                    <span>{lock.lock_reason}</span>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span>剩余时间: {getRemainingTime(lock.lock_until)}</span>
                    </div>
                    <div>
                      失败次数: <span className="text-red-400 font-medium">{lock.failed_attempts}</span>
                    </div>
                    <div>
                      锁定时间: {new Date(lock.created_at).toLocaleString()}
                    </div>
                    {lock.admin_username && admin.role === 'super' && (
                      <div>
                        管理员: <span className="text-blue-400">{lock.admin_username}</span>
                      </div>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => handleUnlock(lock)}
                  disabled={unlocking === lock.id}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors text-sm font-medium"
                >
                  {unlocking === lock.id ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      <span>解锁中...</span>
                    </>
                  ) : (
                    <>
                      <Unlock className="w-4 h-4" />
                      <span>解锁</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
