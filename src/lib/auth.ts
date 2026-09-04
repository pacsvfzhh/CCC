import { supabase } from './supabase';
import { verifyPassword } from './passwordHash';
import { tabSessionManager } from './TabSessionManager';
import { logEmployeeLogin, logEmployeeLogout } from './loginHistoryService';

export interface LoginCredentials {
  username: string;
  password: string;
}

export async function login(credentials: LoginCredentials) {
  console.log('Attempting login for:', credentials.username);

  // Parallel query for both admin and employee to reduce latency
  const [adminResult, employeeResult] = await Promise.all([
    supabase
      .from('admins')
      .select('*')
      .eq('username', credentials.username)
      .maybeSingle(),
    supabase
      .from('users')
      .select('*')
      .eq('username', credentials.username)
      .maybeSingle()
  ]);

  const { data: admin, error: adminError } = adminResult;
  const { data: employee, error: employeeError } = employeeResult;

  // Try admin login first
  if (!adminError && admin) {
    if (!admin.is_active) {
      throw new Error('Account has been deactivated. Please contact administrator.');
    }

    const isValidPassword = await verifyPassword(credentials.password, admin.password_hash);
    if (isValidPassword) {
      console.log('Admin login successful');
      return { user: admin, userType: 'admin' as const };
    }
  }

  // Try employee login
  if (!employeeError && employee) {
    if (!employee.is_active) {
      throw new Error('Account has been deactivated. Please contact administrator.');
    }

    const isValidPassword = await verifyPassword(credentials.password, employee.password_hash);
    if (isValidPassword) {
      console.log('Employee login successful');

      const sessionToken = generateSessionToken();
      const tabId = tabSessionManager.getTabId();

      // Update database with new session token and tab ID
      const { error: updateError } = await supabase
        .from('users')
        .update({
          current_session_token: sessionToken,
          current_tab_id: tabId,
          session_created_at: new Date().toISOString()
        })
        .eq('id', employee.id);

      if (updateError) {
        console.error('Failed to update session token:', updateError);
        throw new Error('Failed to create session');
      }

      const authData = {
        user: employee,
        userType: 'employee' as const,
        sessionToken,
        tabId
      };
      storeAuth(authData);

      // Log employee login asynchronously (don't wait)
      logEmployeeLogin(
        employee.id,
        employee.username,
        employee.employee_id,
        sessionToken
      ).catch(err => console.error('Failed to log employee login:', err));

      return authData;
    }
  }

  throw new Error('Invalid credentials');
}

export async function logout(isUserInitiated: boolean = true) {
  // Get current user info before clearing storage
  const auth = getStoredAuth();

  // If user is an employee, handle critical cleanup operations synchronously
  if (auth?.userType === 'employee' && auth?.user?.id) {
    try {
      // Execute critical operations in parallel with a reasonable timeout (500ms)
      await Promise.race([
        Promise.all([
          // End work session - CRITICAL: releases pending orders
          supabase.rpc('end_work_session', { p_user_id: auth.user.id })
            .then(() => console.log('Work session ended on logout'))
            .catch(() => {}), // Silent catch

          // Clear session token - CRITICAL: prevents session conflicts
          supabase
            .from('users')
            .update({
              current_session_token: null,
              current_tab_id: null
            })
            .eq('id', auth.user.id)
            .then(() => console.log('Session cleared from database'))
            .catch(() => {}), // Silent catch

          // Log employee logout - IMPORTANT: for audit trail (run in background)
          logEmployeeLogout(
            auth.user.id,
            auth.user.username,
            auth.user.employee_id,
            auth.sessionToken
          ).catch(() => {}) // Silent catch
        ]),
        // Timeout after 500ms - proceed with logout even if operations haven't completed
        new Promise(resolve => setTimeout(() => {
          resolve(null);
        }, 500))
      ]);
    } catch (error) {
      // Silent catch - don't show errors to user during logout
    }

    // Stop tab session tracking (after DB operations)
    tabSessionManager.stopSession(isUserInitiated);
  }

  // Clear local storage and dispatch event
  sessionStorage.removeItem('quantum_trader_auth');
  sessionStorage.removeItem('tabId');

  // Clear all announcement-related cache to prevent data leakage between users
  sessionStorage.removeItem('announcement_admin_id');
  sessionStorage.removeItem('announcement_categories');
  sessionStorage.removeItem('announcement_carousel_enabled');
  sessionStorage.removeItem('announcement_carousel_speed');
  sessionStorage.removeItem('announcements_cache');
  sessionStorage.removeItem('announcements_cache_time');
  sessionStorage.removeItem('announcements_cache_user_id');

  window.dispatchEvent(new Event('quantum_trader_logout'));
}

export function getStoredAuth() {
  const stored = sessionStorage.getItem('quantum_trader_auth');
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }
  return null;
}

export function storeAuth(data: any) {
  sessionStorage.setItem('quantum_trader_auth', JSON.stringify(data));
}

export function updateStoredUsername(newUsername: string) {
  const stored = getStoredAuth();
  if (stored && stored.user) {
    stored.user.username = newUsername;
    storeAuth(stored);
    window.dispatchEvent(new Event('quantum_trader_profile_updated'));
  }
}

/**
 * Generate a unique session token (UUID format)
 */
function generateSessionToken(): string {
  // Always generate a valid UUID for consistency with database type
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback UUID v4 format for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Validate employee session with backend
 */
export async function validateEmployeeSession(
  userId: string,
  sessionToken: string,
  tabId?: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('validate_employee_session', {
      p_user_id: userId,
      p_session_token: sessionToken,
      p_tab_id: tabId || null
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
