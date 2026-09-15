import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Search, History, Eye, Users, Clock, MapPin, X, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Admin } from '../../types';
import LoginDeviceSummary from './LoginDeviceSummary';

interface EmployeeLoginHistoryProps {
  admin: Admin;
}

interface EmployeeSummary {
  user_id: string;
  username: string;
  employee_id: string;
  created_by: string;
  latest_login_ip: string | null;
  latest_login_time: string | null;
  latest_login_device_info: unknown | null;
  latest_login_user_agent: string | null;
  latest_logout_ip: string | null;
  latest_logout_time: string | null;
  total_logins: number;
  is_active: boolean;
}

interface LoginHistoryRecord {
  id: string;
  action_type: 'login' | 'logout';
  ip_address: string | null;
  user_agent: string | null;
  session_id: string | null;
  created_at: string;
  device_info: unknown | null;
}

interface AdminGroup {
  admin_id: string;
  admin_username: string;
  admin_role: string;
  employees: EmployeeSummary[];
}

interface EmployeeTableRow {
  employee: EmployeeSummary;
  adminUsername?: string;
}

export default function EmployeeLoginHistory({ admin }: EmployeeLoginHistoryProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [adminGroups, setAdminGroups] = useState<AdminGroup[]>([]);
  const [selectedAdminId, setSelectedAdminId] = useState<string | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeSummary | null>(null);
  const [detailedHistory, setDetailedHistory] = useState<LoginHistoryRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [admins, setAdmins] = useState<{ id: string; username: string; role?: string }[]>([]);
  const loadAdminsRef = useRef<(() => Promise<void>) | null>(null);
  const loadEmployeeSummaryRef = useRef<((silentRefresh?: boolean) => Promise<void>) | null>(null);
  const adminCount = admins.length;

  useEffect(() => {
    const initialize = async () => {
      await loadAdminsRef.current?.();
      await loadEmployeeSummaryRef.current?.();
    };
    initialize();

    // Set up real-time subscriptions for new users and admins
    const usersChannel = supabase
      .channel('employee_login_history_users')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'users'
        },
        (payload) => {
          console.log('New user detected:', payload);
          void loadEmployeeSummaryRef.current?.(true);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'users'
        },
        (payload) => {
          console.log('User updated:', payload);
          void loadEmployeeSummaryRef.current?.(true);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'users'
        },
        (payload) => {
          console.log('User deleted:', payload);
          void loadEmployeeSummaryRef.current?.(true);
        }
      )
      .subscribe((status) => {
        console.log('Users channel subscription status:', status);
      });

    const adminsChannel = supabase
      .channel('employee_login_history_admins')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'admins'
        },
        (payload) => {
          console.log('New admin detected:', payload);
          void loadAdminsRef.current?.();
          void loadEmployeeSummaryRef.current?.(true);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'admins'
        },
        (payload) => {
          console.log('Admin updated:', payload);
          void loadAdminsRef.current?.();
          void loadEmployeeSummaryRef.current?.(true);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'admins'
        },
        (payload) => {
          console.log('Admin deleted:', payload);
          void loadAdminsRef.current?.();
          void loadEmployeeSummaryRef.current?.(true);
        }
      )
      .subscribe((status) => {
        console.log('Admins channel subscription status:', status);
      });

    const loginHistoryChannel = supabase
      .channel('employee_login_history_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'employee_login_history'
        },
        (payload) => {
          console.log('Login history changed:', payload);
          void loadEmployeeSummaryRef.current?.(true);
        }
      )
      .subscribe((status) => {
        console.log('Login history channel subscription status:', status);
      });

    return () => {
      console.log('Cleaning up real-time subscriptions');
      supabase.removeChannel(usersChannel);
      supabase.removeChannel(adminsChannel);
      supabase.removeChannel(loginHistoryChannel);
    };
  }, [admin.id]);

  useEffect(() => {
    if (adminCount > 0) {
      void loadEmployeeSummaryRef.current?.();
    }
  }, [searchTerm, adminCount]);

  // Auto-refresh data every 30 seconds (silent refresh, no loading state)
  useEffect(() => {
    const refreshInterval = setInterval(() => {
      if (!selectedEmployee) {
        void loadEmployeeSummaryRef.current?.(true); // Pass true for silent refresh
      }
    }, 30000);

    return () => clearInterval(refreshInterval);
  }, [selectedEmployee]);

  useEffect(() => {
    if (selectedEmployee) {
      const scrollY = window.scrollY;
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = '100%';
      return () => {
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        window.scrollTo(0, scrollY);
      };
    }
  }, [selectedEmployee]);

  const loadAdmins = async () => {
    try {
      if (admin.role === 'super_admin') {
        const { data, error } = await supabase
          .from('admins')
          .select('id, username, role')
          .eq('is_active', true)
          .neq('role', 'emergency_admin')
          .order('username');

        if (error) throw error;
        setAdmins(data || []);
      } else {
        setAdmins([{ id: admin.id, username: admin.username }]);
      }
    } catch (error) {
      console.error('Error loading admins:', error);
    }
  };

  const loadEmployeeSummary = async (silentRefresh = false) => {
    try {
      if (!silentRefresh) {
        setLoading(true);
      }

      const { data, error } = await supabase.rpc('get_employee_login_summary', {
        p_admin_id: admin.id,
        p_search_term: searchTerm || null
      });

      if (error) {
        console.error('Error calling get_employee_login_summary:', error);
        throw error;
      }

      const employees = (data as EmployeeSummary[]) || [];
      console.log('Loaded employees:', employees.length);

      if (admin.role === 'super_admin') {
        // Ensure we have admins loaded
        let adminList = admins;
        if (adminList.length === 0) {
          const { data: adminsData, error: adminsError } = await supabase
            .from('admins')
            .select('id, username, role')
            .eq('is_active', true)
            .neq('role', 'emergency_admin')
            .order('username');

          if (adminsError) throw adminsError;
          adminList = adminsData || [];
          setAdmins(adminList);
        }

        console.log('Admins available:', adminList.length);

        // Create groups for ALL admins, including those with no employees
        const grouped = adminList.map((adm) => {
          const adminEmployees = employees.filter(e => e.created_by === adm.id);
          return {
            admin_id: adm.id,
            admin_username: adm.username,
            admin_role: adm.role || 'secondary_admin',
            employees: adminEmployees,
          };
        });

        // Sort: super_admin first, then by username
        const sorted = grouped.sort((a, b) => {
          if (a.admin_role === 'super_admin' && b.admin_role !== 'super_admin') return -1;
          if (a.admin_role !== 'super_admin' && b.admin_role === 'super_admin') return 1;
          return a.admin_username.localeCompare(b.admin_username);
        });

        console.log('Admin groups created:', sorted.length);
        setAdminGroups(sorted);
        setSelectedAdminId((current) => (
          current && sorted.some((group) => group.admin_id === current)
            ? current
            : sorted[0]?.admin_id || null
        ));
      } else {
        // For secondary admins, show their employees only
        setAdminGroups([
          {
            admin_id: admin.id,
            admin_username: admin.username,
            admin_role: admin.role,
            employees: employees,
          }
        ]);
        setSelectedAdminId(admin.id);
      }
    } catch (error) {
      console.error('Error loading employee summary:', error);
    } finally {
      if (!silentRefresh) {
        setLoading(false);
      }
    }
  };
  loadAdminsRef.current = loadAdmins;
  loadEmployeeSummaryRef.current = loadEmployeeSummary;

  const loadDetailedHistory = useCallback(async (userId: string) => {
    try {
      setHistoryLoading(true);

      const { data, error } = await supabase.rpc('get_employee_login_history_with_device_info', {
        p_admin_id: admin.id,
        p_user_id: userId,
        p_limit: 10000,
        p_offset: 0
      });

      if (error) throw error;

      const records = data as LoginHistoryRecord[];
      setDetailedHistory(records);
    } catch (error) {
      console.error('Error loading detailed history:', error);
    } finally {
      setHistoryLoading(false);
    }
  }, [admin.id]);

  const handleViewHistory = (employee: EmployeeSummary) => {
    setSelectedEmployee(employee);
    loadDetailedHistory(employee.user_id);
  };

  const handleCloseHistory = () => {
    setSelectedEmployee(null);
    setDetailedHistory([]);
  };

  const formatDateTime = (dateString: string | null) => {
    if (!dateString) return '--';
    const date = new Date(dateString);
    const pad = (value: number) => String(value).padStart(2, '0');

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  };

  const totalEmployees = adminGroups.reduce((sum, group) => sum + group.employees.length, 0);
  const isSearching = searchTerm.trim().length > 0;
  const searchRows: EmployeeTableRow[] = adminGroups.flatMap((group) => (
    group.employees.map((employee) => ({ employee, adminUsername: group.admin_username }))
  ));

  const renderEmployeeTable = (rows: EmployeeTableRow[], showAdminGroup = false) => {
    if (rows.length === 0) {
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center py-8">
          <div className="text-center">
            <Users className="mx-auto mb-2 h-10 w-10 text-slate-600" />
            <p className="text-sm text-slate-300">No employees found</p>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-auto custom-scrollbar">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-cyan-950">
            <tr className="border-b border-cyan-500/45">
              <th className="sticky top-0 z-20 bg-cyan-950 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">Username</th>
              {showAdminGroup && (
                <th className="sticky top-0 z-20 bg-cyan-950 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">Admin Group</th>
              )}
              <th className="sticky top-0 z-20 bg-cyan-950 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">Employee ID</th>
              <th className="sticky top-0 z-20 bg-cyan-950 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">Latest Login IP</th>
              <th className="sticky top-0 z-20 bg-cyan-950 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">Latest Login Time</th>
              <th className="sticky top-0 z-20 bg-cyan-950 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">Login System</th>
              <th className="sticky top-0 z-20 bg-cyan-950 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">Latest Logout IP</th>
              <th className="sticky top-0 z-20 bg-cyan-950 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">Latest Logout Time</th>
              <th className="sticky top-0 z-20 bg-cyan-950 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">Total Logins</th>
              <th className="sticky top-0 z-20 bg-cyan-950 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {rows.map(({ employee, adminUsername }) => (
              <tr key={employee.user_id} className="transition-colors hover:bg-slate-800/30">
                <td className="px-2 py-1 text-xs font-semibold text-cyan-100">{employee.username}</td>
                {showAdminGroup && (
                  <td className="px-2 py-1 text-xs font-semibold text-blue-200">{adminUsername || '--'}</td>
                )}
                <td className="px-2 py-1 text-xs text-slate-300">{employee.employee_id}</td>
                <td className="px-2 py-1">
                  {employee.latest_login_ip ? (
                    <div className="flex items-center gap-1.5 text-xs text-slate-300">
                      <MapPin className="h-3.5 w-3.5 text-green-400" />
                      {employee.latest_login_ip}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-300">--</span>
                  )}
                </td>
                <td className="px-2 py-1">
                  {employee.latest_login_time ? (
                    <div className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-slate-300">
                      <Clock className="h-3 w-3 shrink-0 text-cyan-300/80" />
                      {formatDateTime(employee.latest_login_time)}
                    </div>
                  ) : (
                    <span className="text-[11px] text-slate-300">--</span>
                  )}
                </td>
                <td className="px-2 py-1">
                  <LoginDeviceSummary
                    deviceInfo={employee.latest_login_device_info}
                    userAgent={employee.latest_login_user_agent}
                    systemOnly
                  />
                </td>
                <td className="px-2 py-1">
                  {employee.latest_logout_ip ? (
                    <div className="flex items-center gap-1.5 text-xs text-slate-300">
                      <MapPin className="h-3.5 w-3.5 text-orange-400" />
                      {employee.latest_logout_ip}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-300">--</span>
                  )}
                </td>
                <td className="px-2 py-1">
                  {employee.latest_logout_time ? (
                    <div className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-slate-300">
                      <Clock className="h-3 w-3 shrink-0 text-orange-300/80" />
                      {formatDateTime(employee.latest_logout_time)}
                    </div>
                  ) : (
                    <span className="text-[11px] text-slate-300">--</span>
                  )}
                </td>
                <td className="px-2 py-1">
                  <div className="flex items-center gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-500/10">
                      <History className="h-3.5 w-3.5 text-blue-400" />
                    </div>
                    <span className="text-sm font-semibold text-cyan-100">{(employee.total_logins || 0).toLocaleString()}</span>
                    <span className="text-[11px] text-slate-300">{(employee.total_logins || 0) === 1 ? 'time' : 'times'}</span>
                  </div>
                </td>
                <td className="px-2 py-1">
                  <button
                    onClick={() => handleViewHistory(employee)}
                    className="inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-md border border-blue-500/30 bg-blue-500/10 px-1.5 text-[10px] font-semibold text-blue-300 transition-all hover:border-cyan-400/50 hover:bg-cyan-400/10 hover:text-cyan-200"
                  >
                    <Eye className="h-3 w-3" />
                    View History
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const modalContent = selectedEmployee ? (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[9999] p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-6xl w-full max-h-[90vh] flex flex-col shadow-2xl">
        {/* Fixed Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg flex items-center justify-center">
              <History className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white">Login History</h3>
              <p className="text-sm text-slate-400">
                {selectedEmployee.username} ({selectedEmployee.employee_id})
              </p>
            </div>
          </div>
          <button
            onClick={handleCloseHistory}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
          {historyLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : detailedHistory.length === 0 ? (
            <div className="text-center py-12">
              <History className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400">No login history found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-slate-900 z-10">
                  <tr className="border-b-2 border-cyan-500/30">
                    <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider w-16">#</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider w-32">Action</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider w-40">IP Address</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Device Info</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider w-44">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {detailedHistory.map((record, index) => (
                    <tr key={record.id} className="hover:bg-slate-800/50 transition-colors group">
                      <td className="px-3 py-3 text-center">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-slate-800 text-xs font-semibold text-slate-400 group-hover:bg-cyan-500/20 group-hover:text-cyan-400 transition-all">
                          {index + 1}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                          record.action_type === 'login'
                            ? 'bg-green-500/10 text-green-400 border border-green-500/30'
                            : 'bg-orange-500/10 text-orange-400 border border-orange-500/30'
                        }`}>
                          {record.action_type === 'login' ? '→' : '←'}
                          {record.action_type === 'login' ? 'Login' : 'Logout'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 text-sm text-slate-300">
                          <MapPin className="w-4 h-4 text-blue-400 flex-shrink-0" />
                          <span className="break-all">{record.ip_address || 'Unknown'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <LoginDeviceSummary
                          deviceInfo={record.device_info}
                          userAgent={record.user_agent}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-2 text-xs text-slate-400">
                          <Clock className="w-3 h-3 flex-shrink-0 mt-0.5" />
                          <span className="break-words">{formatDateTime(record.created_at)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Fixed Footer with Total Records */}
        {!historyLoading && detailedHistory.length > 0 && (
          <div className="p-4 border-t border-slate-700 flex-shrink-0 bg-slate-900">
            <div className="text-sm text-slate-400 text-center">
              Total <span className="text-cyan-400 font-semibold">{detailedHistory.length}</span> {detailedHistory.length === 1 ? 'record' : 'records'}
            </div>
          </div>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 text-slate-100">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-0 flex shrink-0 flex-col justify-start gap-2 border-b border-cyan-400/25 bg-gradient-to-br from-cyan-950/90 via-slate-950 to-blue-950/85 px-4 py-2.5 shadow-[0_8px_24px_rgba(8,47,73,0.18)] xl:min-h-[109px]">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0 pt-1.5">
              <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-cyan-300/80">Admin activity</p>
              <h2 className="mt-0 bg-gradient-to-r from-cyan-300 via-cyan-100 to-blue-300 bg-clip-text text-xl font-bold tracking-tight text-transparent sm:text-2xl">Login History</h2>
            </div>
            <button
              onClick={() => {
                void loadAdminsRef.current?.();
                void loadEmployeeSummaryRef.current?.();
              }}
              disabled={loading}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-cyan-300/50 bg-gradient-to-r from-blue-600 to-cyan-600 px-3 text-xs font-bold text-white shadow-[0_6px_18px_rgba(8,145,178,0.2)] transition-[filter,transform,box-shadow] hover:-translate-y-px hover:brightness-110 hover:shadow-[0_10px_22px_rgba(8,145,178,0.26)] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none sm:min-w-[88px] xl:min-w-[88px]"
              title="Refresh data"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="font-medium">Refresh</span>
            </button>
          </div>

          <div className="flex w-full min-w-0 items-center gap-1.5">
            {admin.role === 'super_admin' && (
              <div className="flex shrink-0 items-center gap-1.5">
                <div className="min-w-[96px] rounded-lg border border-cyan-300/25 bg-gradient-to-br from-cyan-400/10 to-blue-500/[0.04] px-2 py-1 shadow-[0_6px_16px_rgba(2,6,23,0.14)]">
                  <div className="flex items-center gap-2">
                    <Users className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
                    <div>
                      <p className="text-[8px] font-bold uppercase tracking-[0.08em] text-cyan-200/80">Total Employees</p>
                      <p className="mt-0.5 text-base font-bold leading-none text-cyan-100">{totalEmployees}</p>
                    </div>
                  </div>
                </div>
                <div className="min-w-[90px] rounded-lg border border-blue-300/25 bg-gradient-to-br from-blue-500/10 to-cyan-500/[0.04] px-2 py-1 shadow-[0_6px_16px_rgba(2,6,23,0.14)]">
                  <div className="flex items-center gap-2">
                    <History className="h-3.5 w-3.5 shrink-0 text-blue-300" />
                    <div>
                      <p className="text-[8px] font-bold uppercase tracking-[0.08em] text-blue-200/80">Admin Groups</p>
                      <p className="mt-0.5 text-base font-bold leading-none text-blue-100">{adminGroups.length}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="flex min-w-0 flex-1 justify-end gap-1.5 sm:items-center">
            {admin.role === 'super_admin' && (
              <select
                value={isSearching ? 'all' : selectedAdminId || ''}
                onChange={(event) => {
                  const nextAdminId = event.target.value;
                  setSearchTerm('');
                  if (nextAdminId !== 'all') {
                    setSelectedAdminId(nextAdminId);
                  }
                }}
                className="h-9 w-[170px] shrink-0 rounded-lg border border-cyan-400/30 bg-slate-900 px-2.5 text-xs font-semibold text-cyan-100 outline-none transition-colors hover:border-cyan-300/60 focus:border-cyan-300 focus:ring-4 focus:ring-cyan-400/15"
                aria-label="Select admin group"
              >
                <option value="all">All Admin Groups</option>
                {admins.map((adminOption) => (
                  <option key={adminOption.id} value={adminOption.id}>
                    {adminOption.username}
                  </option>
                ))}
              </select>
            )}
            <div className="relative w-full min-w-0 sm:max-w-[180px]">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-cyan-700" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by username, employee ID, or IP address..."
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs font-medium text-slate-900 shadow-[0_6px_18px_rgba(2,6,23,0.14)] outline-none transition-[border-color,box-shadow] placeholder:text-slate-500 hover:border-cyan-400 focus:border-cyan-500 focus:ring-4 focus:ring-cyan-400/20"
              />
            </div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : (
          <>
            {isSearching ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-cyan-500/20 bg-slate-950/35">
                <div className="flex shrink-0 items-center justify-between border-b border-cyan-500/25 bg-cyan-950/55 px-3 py-2">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-200/80">Search results</p>
                    <p className="mt-0.5 text-xs text-slate-300">
                      {admin.role === 'super_admin' ? 'All admin groups' : 'Your employees only'}
                    </p>
                  </div>
                  <span className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold text-cyan-200">
                    {searchRows.length} employees
                  </span>
                </div>
                {renderEmployeeTable(searchRows, true)}
              </div>
            ) : adminGroups.length === 0 ? (
              <div className="flex min-h-0 flex-1 items-center justify-center py-12">
                <div className="text-center">
                  <History className="mx-auto mb-3 h-12 w-12 text-slate-600" />
                  <p className="text-slate-300">No admin groups found</p>
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {adminGroups.filter((group) => group.admin_id === selectedAdminId).map((group) => (
                  <div
                    key={group.admin_id}
                    className={`flex min-h-0 flex-1 flex-col overflow-hidden border-b border-slate-800/70 border-l-2 ${
                      group.admin_role === 'super_admin'
                        ? 'border-l-yellow-400/80 bg-gradient-to-br from-yellow-500/[0.08] via-slate-900/20 to-transparent'
                        : 'border-l-cyan-400/80 bg-gradient-to-br from-blue-500/[0.08] via-slate-900/20 to-transparent'
                    }`}
                  >
                    {/* Group Header */}
                    <div className={`sticky top-0 z-40 isolate flex items-center justify-between px-4 py-3 border-b ${
                      group.admin_role === 'super_admin'
                        ? 'bg-gradient-to-r from-yellow-950 via-slate-900 to-slate-950 border-yellow-500/30'
                        : 'bg-gradient-to-r from-blue-950 via-slate-900 to-slate-950 border-blue-500/30'
                    }`}>
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${
                          group.admin_role === 'super_admin'
                            ? 'bg-yellow-500/20'
                            : 'bg-blue-500/20'
                        }`}>
                          <Users className={`w-5 h-5 ${
                            group.admin_role === 'super_admin' ? 'text-yellow-400' : 'text-blue-400'
                          }`} />
                        </div>
                        <div className="flex items-center gap-2">
                          <h3 className={`text-lg font-bold ${
                            group.admin_role === 'super_admin' ? 'text-yellow-300' : 'text-cyan-100'
                          }`}>
                            {group.admin_username}
                          </h3>
                          {group.admin_role === 'super_admin' && (
                            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-yellow-500/20 text-yellow-300 border border-yellow-400/40">
                              SUPER ADMIN
                            </span>
                          )}
                        </div>
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                          group.admin_role === 'super_admin'
                            ? group.employees.length > 0
                              ? 'bg-yellow-500/10 text-yellow-300 border border-yellow-400/30'
                              : 'bg-slate-500/10 text-slate-400 border border-slate-500/30'
                            : group.employees.length > 0
                            ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
                            : 'bg-slate-500/10 text-slate-400 border border-slate-500/30'
                        }`}>
                          {group.employees.length} employee{group.employees.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>

                    {/* Group Content */}
                    <>
                        {group.employees.length === 0 ? (
                          <div className="text-center py-8">
                            <Users className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                            <p className="text-slate-300 text-sm">No employees under this admin</p>
                          </div>
                        ) : (
                          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-auto custom-scrollbar pb-1 sm:pb-1.5">
                            <table className="w-full border-collapse text-xs">
                              <thead className="bg-cyan-950">
                                <tr className="border-b border-cyan-500/45">
                                  <th className="sticky top-0 z-20 bg-cyan-950 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">Username</th>
                                  <th className="sticky top-0 z-20 bg-cyan-950 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">Employee ID</th>
                                  <th className="sticky top-0 z-20 bg-cyan-950 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">Latest Login IP</th>
                                  <th className="sticky top-0 z-20 bg-cyan-950 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">Latest Login Time</th>
                                  <th className="sticky top-0 z-20 bg-cyan-950 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">Login System</th>
                                  <th className="sticky top-0 z-20 bg-cyan-950 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">Latest Logout IP</th>
                                  <th className="sticky top-0 z-20 bg-cyan-950 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">Latest Logout Time</th>
                                  <th className="sticky top-0 z-20 bg-cyan-950 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">Total Logins</th>
                                  <th className="sticky top-0 z-20 bg-cyan-950 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">Actions</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-700/50">
                                {group.employees.map((employee) => (
                                  <tr key={employee.user_id} className="hover:bg-slate-800/30 transition-colors">
                                    <td className="px-2 py-1 text-xs font-semibold text-cyan-100">{employee.username}</td>
                                    <td className="px-2 py-1 text-xs text-slate-300">{employee.employee_id}</td>
                                    <td className="px-2 py-1">
                                      {employee.latest_login_ip ? (
                                        <div className="flex items-center gap-1.5 text-xs text-slate-300">
                                          <MapPin className="h-3.5 w-3.5 text-green-400" />
                                          {employee.latest_login_ip}
                                        </div>
                                      ) : (
                                        <span className="text-xs text-slate-300">--</span>
                                      )}
                                    </td>
                                    <td className="px-2 py-1">
                                      {employee.latest_login_time ? (
                                        <div className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-slate-300">
                                          <Clock className="h-3 w-3 shrink-0 text-cyan-300/80" />
                                          {formatDateTime(employee.latest_login_time)}
                                        </div>
                                      ) : (
                                        <span className="text-[11px] text-slate-300">--</span>
                                      )}
                                    </td>
                                    <td className="px-2 py-1">
                                      <LoginDeviceSummary
                                        deviceInfo={employee.latest_login_device_info}
                                        userAgent={employee.latest_login_user_agent}
                                        systemOnly
                                      />
                                    </td>
                                    <td className="px-2 py-1">
                                      {employee.latest_logout_ip ? (
                                        <div className="flex items-center gap-1.5 text-xs text-slate-300">
                                          <MapPin className="h-3.5 w-3.5 text-orange-400" />
                                          {employee.latest_logout_ip}
                                        </div>
                                      ) : (
                                        <span className="text-xs text-slate-300">--</span>
                                      )}
                                    </td>
                                    <td className="px-2 py-1">
                                      {employee.latest_logout_time ? (
                                        <div className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-slate-300">
                                          <Clock className="h-3 w-3 shrink-0 text-orange-300/80" />
                                          {formatDateTime(employee.latest_logout_time)}
                                        </div>
                                      ) : (
                                        <span className="text-[11px] text-slate-300">--</span>
                                      )}
                                    </td>
                                    <td className="px-2 py-1">
                                      <div className="flex items-center gap-2">
                                        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-500/10">
                                          <History className="h-3.5 w-3.5 text-blue-400" />
                                        </div>
                                        <span className="text-sm font-semibold text-cyan-100">
                                          {(employee.total_logins || 0).toLocaleString()}
                                        </span>
                                        <span className="text-[11px] text-slate-300">
                                          {(employee.total_logins || 0) === 1 ? 'time' : 'times'}
                                        </span>
                                      </div>
                                    </td>
                                    <td className="px-2 py-1">
                                      <button
                                        onClick={() => handleViewHistory(employee)}
                                        className="inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-md border border-blue-500/30 bg-blue-500/10 px-1.5 text-[10px] font-semibold text-blue-300 transition-all hover:border-cyan-400/50 hover:bg-cyan-400/10 hover:text-cyan-200"
                                      >
                                        <Eye className="h-3 w-3" />
                                        View History
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {modalContent && createPortal(modalContent, document.body)}
    </div>
  );
}
