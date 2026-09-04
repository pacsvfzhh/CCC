import { supabase } from './supabase';

export interface RateLimitCheckResult {
  allowed: boolean;
  locked: boolean;
  lock_until?: string;
  lock_reason?: string;
  failed_attempts?: number;
  remaining_seconds?: number;
  warning?: string;
}

export interface LoginAttemptResult {
  success: boolean;
  locked?: boolean;
  lock_until?: string;
  lock_reason?: string;
  failed_attempts?: number;
  message?: string;
}

export async function checkLoginRateLimit(
  identifier: string,
  identifierType: 'ip' | 'username'
): Promise<RateLimitCheckResult> {
  try {
    const { data, error } = await supabase.rpc('check_login_rate_limit', {
      p_identifier: identifier,
      p_identifier_type: identifierType
    });

    if (error) {
      console.error('[Rate Limit] Check error:', error);
      return { allowed: true, locked: false };
    }

    console.log('[Rate Limit] Check result for', identifier, ':', data);
    return data as RateLimitCheckResult;
  } catch (error) {
    console.error('Rate limit check exception:', error);
    return { allowed: true, locked: false };
  }
}

export async function recordLoginAttempt(
  identifier: string,
  identifierType: 'ip' | 'username',
  success: boolean,
  ipAddress?: string,
  userAgent?: string
): Promise<LoginAttemptResult> {
  try {
    const { data, error } = await supabase.rpc('record_login_attempt', {
      p_identifier: identifier,
      p_identifier_type: identifierType,
      p_success: success,
      p_ip_address: ipAddress,
      p_user_agent: userAgent
    });

    if (error) {
      console.error('[Record Attempt] Error:', error);
      return { success, message: error.message };
    }

    console.log('[Record Attempt] Result for', identifier, ':', data);
    return data as LoginAttemptResult;
  } catch (error) {
    console.error('Record login attempt exception:', error);
    return { success, message: 'Failed to record login attempt' };
  }
}

export async function unlockAccount(
  identifier: string,
  identifierType: 'ip' | 'username',
  adminId: string
): Promise<{ success: boolean; message: string; unlocked_count?: number }> {
  try {
    const { data, error } = await supabase.rpc('unlock_account_with_permission_check', {
      p_identifier: identifier,
      p_identifier_type: identifierType,
      p_admin_id: adminId
    });

    if (error) {
      console.error('Unlock account error:', error);
      return { success: false, message: error.message };
    }

    return data;
  } catch (error) {
    console.error('Unlock account exception:', error);
    return { success: false, message: 'Failed to unlock account' };
  }
}

export function formatLockDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  } else if (seconds < 3600) {
    const minutes = Math.ceil(seconds / 60);
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  } else if (seconds < 86400) {
    const hours = Math.ceil(seconds / 3600);
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  } else {
    const days = Math.ceil(seconds / 86400);
    return `${days} day${days !== 1 ? 's' : ''}`;
  }
}
