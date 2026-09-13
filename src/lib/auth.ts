import { supabase } from './supabase';
import { tabSessionManager } from './TabSessionManager';
import { logEmployeeLogin, logEmployeeLogout } from './loginHistoryService';
import type { Admin, Employee } from '../types';

export const AUTH_STORAGE_KEY = 'work_platform_auth';
export const AUTH_LOGOUT_EVENT = 'work_platform_logout';
export const PROFILE_UPDATED_EVENT = 'work_platform_profile_updated';
const LEGACY_AUTH_STORAGE_KEY = ['quantum', 'trader', 'auth'].join('_');

export interface LoginCredentials {
  username: string;
  password: string;
}

export type StoredAuth =
  | {
      user: Admin;
      userType: 'admin';
      adminSessionToken: string;
    }
  | {
      user: Employee;
      userType: 'employee';
      sessionToken: string;
      financialSessionToken: string;
      tabId: string;
    };

type FinancialLoginResult<T> = {
  success?: boolean;
  error?: string;
  session_token?: string;
  session_marker?: string;
  user?: T;
};

export async function login(credentials: LoginCredentials): Promise<StoredAuth> {
  const [adminAccount, employeeAccount] = await Promise.all([
    supabase
      .from('admins')
      .select('id, is_active')
      .eq('username', credentials.username)
      .maybeSingle(),
    supabase
      .from('users')
      .select('id, is_active')
      .eq('username', credentials.username)
      .maybeSingle(),
  ]);

  if (adminAccount.error) throw adminAccount.error;
  if (employeeAccount.error) throw employeeAccount.error;

  if (adminAccount.data) {
    if (!adminAccount.data.is_active) {
      throw new Error('Account has been deactivated. Please contact administrator.');
    }

    const { data, error } = await supabase.rpc('create_admin_financial_session', {
      p_username: credentials.username,
      p_password: credentials.password,
    });
    if (error) throw error;

    const result = data as FinancialLoginResult<Admin>;
    if (!result.success || !result.session_token || !result.user) {
      throw new Error(result.error || 'Invalid credentials');
    }

    return {
      user: result.user,
      userType: 'admin',
      adminSessionToken: result.session_token,
    };
  }

  if (employeeAccount.data) {
    if (!employeeAccount.data.is_active) {
      throw new Error('Account has been deactivated. Please contact administrator.');
    }

    const tabId = tabSessionManager.getTabId();
    const { data, error } = await supabase.rpc('create_employee_financial_session', {
      p_username: credentials.username,
      p_password: credentials.password,
      p_tab_id: tabId,
    });
    if (error) throw error;

    const result = data as FinancialLoginResult<Employee>;
    if (!result.success || !result.session_token || !result.session_marker || !result.user) {
      throw new Error(result.error || 'Invalid credentials');
    }

    const authData: StoredAuth = {
      user: result.user,
      userType: 'employee',
      sessionToken: result.session_marker,
      financialSessionToken: result.session_token,
      tabId,
    };
    storeAuth(authData);

    logEmployeeLogin(
      result.user.id,
      result.user.username,
      result.user.employee_id,
      result.session_marker,
    ).catch(err => console.error('Failed to log employee login:', err));

    return authData;
  }

  throw new Error('Invalid credentials');
}

export async function logout(isUserInitiated: boolean = true) {
  const auth = getStoredAuth();

  if (auth) {
    const financialSessionToken = auth.userType === 'admin'
      ? auth.adminSessionToken
      : auth.financialSessionToken;
    const operations: Array<PromiseLike<unknown>> = [
      supabase
        .rpc('revoke_financial_session', { p_token: financialSessionToken })
        .then(() => undefined, () => undefined),
    ];

    if (auth.userType === 'employee') {
      operations.push(
        supabase
          .rpc('end_work_session', { p_user_id: auth.user.id })
          .then(() => undefined, () => undefined),
        logEmployeeLogout(
          auth.user.id,
          auth.user.username,
          auth.user.employee_id,
          auth.sessionToken,
        ).catch(() => undefined),
      );
    }

    try {
      await Promise.race([
        Promise.all(operations),
        new Promise(resolve => setTimeout(resolve, 500)),
      ]);
    } catch {
      // Logout must continue even when the network is unavailable.
    }

    if (auth.userType === 'employee') {
      tabSessionManager.stopSession(isUserInitiated);
    }
  }

  sessionStorage.removeItem(AUTH_STORAGE_KEY);
  sessionStorage.removeItem(LEGACY_AUTH_STORAGE_KEY);
  sessionStorage.removeItem('tabId');
  sessionStorage.removeItem('announcement_admin_id');
  sessionStorage.removeItem('announcement_categories');
  sessionStorage.removeItem('announcement_carousel_enabled');
  sessionStorage.removeItem('announcement_carousel_speed');
  sessionStorage.removeItem('announcements_cache');
  sessionStorage.removeItem('announcements_cache_time');
  sessionStorage.removeItem('announcements_cache_user_id');

  window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT));
}

export function getStoredAuth(): StoredAuth | null {
  let stored = sessionStorage.getItem(AUTH_STORAGE_KEY);

  if (!stored) {
    const legacyStored = sessionStorage.getItem(LEGACY_AUTH_STORAGE_KEY);
    if (legacyStored) {
      sessionStorage.setItem(AUTH_STORAGE_KEY, legacyStored);
      sessionStorage.removeItem(LEGACY_AUTH_STORAGE_KEY);
      stored = legacyStored;
    }
  }

  if (!stored) return null;

  try {
    const auth = JSON.parse(stored) as StoredAuth;
    if (auth.userType === 'admin' && !auth.adminSessionToken) return null;
    if (auth.userType === 'employee' && (!auth.financialSessionToken || !auth.sessionToken)) return null;
    return auth;
  } catch {
    return null;
  }
}

export function storeAuth(data: StoredAuth) {
  sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data));
}

export function getAdminFinancialSessionToken(): string {
  const auth = getStoredAuth();
  if (!auth || auth.userType !== 'admin' || !auth.adminSessionToken) {
    throw new Error('Administrator session has expired. Please sign in again.');
  }
  return auth.adminSessionToken;
}

export function getEmployeeFinancialSession() {
  const auth = getStoredAuth();
  if (!auth || auth.userType !== 'employee' || !auth.financialSessionToken) {
    throw new Error('Employee session has expired. Please sign in again.');
  }
  return {
    token: auth.financialSessionToken,
    tabId: auth.tabId,
  };
}

export function createFinancialOperationId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const random = Math.random() * 16 | 0;
    const value = character === 'x' ? random : (random & 0x3 | 0x8);
    return value.toString(16);
  });
}

export function updateStoredUsername(newUsername: string) {
  const stored = getStoredAuth();
  if (stored) {
    stored.user.username = newUsername;
    storeAuth(stored);
    window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT));
  }
}

export async function validateEmployeeSession(
  userId: string,
  sessionToken: string,
  tabId?: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('validate_employee_session', {
      p_user_id: userId,
      p_session_token: sessionToken,
      p_tab_id: tabId || null,
    });

    if (error) {
      console.error('Session validation error:', error);
      return false;
    }

    return data === true;
  } catch (error) {
    console.error('Failed to validate session:', error);
    return false;
  }
}
