import { supabase } from './supabase';

export async function getUserIP(): Promise<string> {
  try {
    const response = await fetch('https://api.ipify.org?format=json');
    const data = await response.json();
    return data.ip || 'Unknown';
  } catch (error) {
    console.error('Error getting IP address:', error);
    return 'Unknown';
  }
}

export async function logEmployeeLogin(
  userId: string,
  username: string,
  employeeId: string,
  sessionId?: string
): Promise<void> {
  try {
    const ipAddress = await getUserIP();
    const userAgent = navigator.userAgent;

    const { error } = await supabase.rpc('log_employee_login', {
      p_user_id: userId,
      p_username: username,
      p_employee_id: employeeId,
      p_ip_address: ipAddress,
      p_user_agent: userAgent,
      p_session_id: sessionId || null
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
    const ipAddress = await getUserIP();
    const userAgent = navigator.userAgent;

    const { error } = await supabase.rpc('log_employee_logout', {
      p_user_id: userId,
      p_username: username,
      p_employee_id: employeeId,
      p_ip_address: ipAddress,
      p_user_agent: userAgent,
      p_session_id: sessionId || null
    });

    if (error) {
      console.error('Error logging employee logout:', error);
    }
  } catch (error) {
    console.error('Error in logEmployeeLogout:', error);
  }
}
