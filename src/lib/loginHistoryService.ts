import { formatSupabaseError, supabase } from './supabase';
import { collectLoginDeviceInfo, parseLoginDeviceInfo } from './deviceInfo';

export async function getUserIP(): Promise<string> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 2000);

  try {
    const response = await fetch('https://api.ipify.org?format=json', {
      signal: controller.signal,
    });
    const data = await response.json();
    return data.ip || 'Unknown';
  } catch (error) {
    console.error('Error getting IP address:', formatSupabaseError(error));
    return 'Unknown';
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function logEmployeeLogin(
  userId: string,
  username: string,
  employeeId: string,
  sessionId?: string
): Promise<void> {
  try {
    const userAgent = typeof navigator === 'undefined' ? undefined : navigator.userAgent;
    const [ipAddress, deviceInfo] = await Promise.all([
      getUserIP(),
      collectLoginDeviceInfo().catch(() => parseLoginDeviceInfo(userAgent)),
    ]);

    const { error: structuredError } = await supabase.rpc('log_employee_login_with_device_info', {
      p_user_id: userId,
      p_username: username,
      p_employee_id: employeeId,
      p_ip_address: ipAddress,
      p_user_agent: userAgent,
      p_session_id: sessionId || null,
      p_device_info: deviceInfo,
    });

    if (!structuredError) return;

    const { error: fallbackError } = await supabase.rpc('log_employee_login', {
      p_user_id: userId,
      p_username: username,
      p_employee_id: employeeId,
      p_ip_address: ipAddress,
      p_user_agent: userAgent,
      p_session_id: sessionId || null,
    });

    if (fallbackError) {
      console.error(
        'Error logging employee login:',
        `${formatSupabaseError(fallbackError)} (structured RPC: ${formatSupabaseError(structuredError)})`,
      );
    }
  } catch (error) {
    console.error('Error in logEmployeeLogin:', formatSupabaseError(error));
  }
}

export async function logEmployeeLogout(
  userId: string,
  username: string,
  employeeId: string,
  sessionId?: string
): Promise<void> {
  try {
    const userAgent = typeof navigator === 'undefined' ? undefined : navigator.userAgent;
    const [ipAddress, deviceInfo] = await Promise.all([
      getUserIP(),
      collectLoginDeviceInfo().catch(() => parseLoginDeviceInfo(userAgent)),
    ]);

    const { error: structuredError } = await supabase.rpc('log_employee_logout_with_device_info', {
      p_user_id: userId,
      p_username: username,
      p_employee_id: employeeId,
      p_ip_address: ipAddress,
      p_user_agent: userAgent,
      p_session_id: sessionId || null,
      p_device_info: deviceInfo,
    });

    if (!structuredError) return;

    const { error: fallbackError } = await supabase.rpc('log_employee_logout', {
      p_user_id: userId,
      p_username: username,
      p_employee_id: employeeId,
      p_ip_address: ipAddress,
      p_user_agent: userAgent,
      p_session_id: sessionId || null,
    });

    if (fallbackError) {
      console.error(
        'Error logging employee logout:',
        `${formatSupabaseError(fallbackError)} (structured RPC: ${formatSupabaseError(structuredError)})`,
      );
    }
  } catch (error) {
    console.error('Error in logEmployeeLogout:', formatSupabaseError(error));
  }
}
