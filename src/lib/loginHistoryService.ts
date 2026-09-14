import { supabase } from './supabase';
import { collectLoginDeviceInfo } from './deviceInfo';

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
    console.error('Error getting IP address:', error);
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
    const [ipAddress, deviceInfo] = await Promise.all([
      getUserIP(),
      collectLoginDeviceInfo(),
    ]);
    const userAgent = typeof navigator === 'undefined' ? undefined : navigator.userAgent;

    const { error } = await supabase.rpc('log_employee_login_with_device_info', {
      p_user_id: userId,
      p_username: username,
      p_employee_id: employeeId,
      p_ip_address: ipAddress,
      p_user_agent: userAgent,
      p_session_id: sessionId || null,
      p_device_info: deviceInfo,
    });

    if (error) {
      console.error('Error logging employee login:', error);
    }
  } catch (error) {
    console.error('Error in logEmployeeLogin:', error);
  }
}

export async function logEmployeeLogout(
  userId: string,
  username: string,
  employeeId: string,
  sessionId?: string
): Promise<void> {
  try {
    const [ipAddress, deviceInfo] = await Promise.all([
      getUserIP(),
      collectLoginDeviceInfo(),
    ]);
    const userAgent = typeof navigator === 'undefined' ? undefined : navigator.userAgent;

    const { error } = await supabase.rpc('log_employee_logout_with_device_info', {
      p_user_id: userId,
      p_username: username,
      p_employee_id: employeeId,
      p_ip_address: ipAddress,
      p_user_agent: userAgent,
      p_session_id: sessionId || null,
      p_device_info: deviceInfo,
    });

    if (error) {
      console.error('Error logging employee logout:', error);
    }
  } catch (error) {
    console.error('Error in logEmployeeLogout:', error);
  }
}
