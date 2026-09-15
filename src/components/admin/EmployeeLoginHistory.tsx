import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Search, History, Eye, Users, Clock, MapPin, X, RefreshCw, ChevronDown, Check } from 'lucide-react';
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

interface SharedIpGroup {
  ip: string;
  employees: EmployeeSummary[];
}

interface SharedIpSelection {
  scope: 'all' | 'group';
  groupId?: string;
  ip: string;
}

const getSharedIpGroups = (employees: EmployeeSummary[]): SharedIpGroup[] => {
  const employeesByIp = new Map<string, EmployeeSummary[]>();

  employees.forEach((employee) => {
    const ip = employee.latest_login_ip?.trim();
    if (!ip) return;

    const group = employeesByIp.get(ip) || [];
    group.push(employee);
    employeesByIp.set(ip, group);
  });

  return Array.from(employeesByIp.entries())
    .filter(([, groupedEmployees]) => groupedEmployees.length > 1)
    .map(([ip, groupedEmployees]) => ({ ip, employees: groupedEmployees }))
    .sort((a, b) => b.employees.length - a.employees.length || a.ip.localeCompare(b.ip));
};

const getEmployeesForSharedIp = (employees: EmployeeSummary[], ip: string) => (
  employees.filter((employee) => employee.latest_login_ip?.trim() === ip)
);

export default function EmployeeLoginHistory({ admin }: EmployeeLoginHistoryProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [sharedIpSelection, setSharedIpSelection] = useState<SharedIpSelection | null>(null);
  const [openSharedIpMenu, setOpenSharedIpMenu] = useState<'all' | string | null>(null);
  const [loading, setLoading] = useState(true);
  const [adminGroups, setAdminGroups] = useState<AdminGroup[]>([]);
  const [selectedAdminId, setSelectedAdminId] = useState<string | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeSummary | null>(null);
  const [detailedHistory, setDetailedHistory] = useState<LoginHistoryRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [admins, setAdmins] = useState<{ id: string; username: string; role?: string }[]>([]);
  const [isAdminMenuOpen, setIsAdminMenuOpen] = useState(false);
  const adminMenuRef = useRef<HTMLDivElement | null>(null);
  const loadAdminsRef = useRef<(() => Promise<void>) | null>(null);
  const loadEmployeeSummaryRef = useRef<((silentRefresh?: boolean) => Promise<void>) | null>(null);
  const adminCount = admins.length;

  useEffect(() => {
    if (!isAdminMenuOpen && !openSharedIpMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (adminMenuRef.current && !adminMenuRef.current.contains(event.target as Node)) {
        setIsAdminMenuOpen(false);
      }
      if (!(event.target instanceof Element) || !event.target.closest('[data-shared-ip-menu]')) {
        setOpenSharedIpMenu(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsAdminMenuOpen(false);
        setOpenSharedIpMenu(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAdminMenuOpen, openSharedIpMenu]);

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
  const selectedAdmin = admins.find((adminOption) => adminOption.id === selectedAdminId);
  const sortedAdminOptions = [...admins].sort((a, b) => {
    if (a.role === 'super_admin' && b.role !== 'super_admin') return -1;
    if (a.role !== 'super_admin' && b.role === 'super_admin') return 1;
    return a.username.localeCompare(b.username);
  });
  const allEmployees = adminGroups.flatMap((group) => group.employees);
  const allSharedIpGroups = getSharedIpGroups(allEmployees);
  const selectedAllSharedIpGroup = sharedIpSelection?.scope === 'all'
    ? allSharedIpGroups.find((group) => group.ip === sharedIpSelection.ip)
    : null;
  const sharedIpRows: EmployeeTableRow[] = selectedAllSharedIpGroup
    ? adminGroups.flatMap((group) => (
        getEmployeesForSharedIp(group.employees, selectedAllSharedIpGroup.ip)
          .map((employee) => ({ employee, adminUsername: group.admin_username }))
      ))
    : [];
  const getDisplayedGroupEmployees = (group: AdminGroup) => {
    if (sharedIpSelection?.scope === 'group' && sharedIpSelection.groupId === group.admin_id) {
      return getEmployeesForSharedIp(group.employees, sharedIpSelection.ip);
    }
    return group.employees;
  };
  const getSelectedGroupSharedIp = (group: AdminGroup) => {
    if (sharedIpSelection?.scope !== 'group' || sharedIpSelection.groupId !== group.admin_id) return null;
    return getSharedIpGroups(group.employees).find((option) => option.ip === sharedIpSelection.ip) || null;
  };
  const secondaryGroup = admin.role !== 'super_admin' ? adminGroups.find((group) => group.admin_id === admin.id) : null;
  const secondarySharedIpGroups = secondaryGroup ? getSharedIpGroups(secondaryGroup.employees) : [];
  const selectedSecondarySharedIpGroup = secondaryGroup ? getSelectedGroupSharedIp(secondaryGroup) : null;

  const renderEmployeeTable = (rows: EmployeeTableRow[], showAdminGroup = false, sharedIpMode = false) => {
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
      <div className="min-h-0 flex-1 overflow-y-scroll overflow-x-auto bg-slate-950 login-history-list-scrollbar">
        <table className="login-history-table w-full text-xs">
          <thead className="bg-cyan-950">
            <tr className="border-b border-cyan-500/45">
              <th className="sticky top-0 z-20 w-10 bg-cyan-950 px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">#</th>
              <th className="sticky top-0 z-20 bg-cyan-950 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">Username</th>
              {showAdminGroup && (
                <th className="sticky top-0 z-20 bg-cyan-950 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">Admin Group</th>
              )}
              <th className="sticky top-0 z-20 bg-cyan-950 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">Employee ID</th>
              <th className="sticky top-0 z-20 bg-cyan-950 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">{sharedIpMode ? 'Shared Login IP' : 'Latest Login IP'}</th>
              <th className="sticky top-0 z-20 bg-cyan-950 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">{sharedIpMode ? 'Shared Login Time' : 'Latest Login Time'}</th>
              <th className="sticky top-0 z-20 bg-cyan-950 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">Login System</th>
              <th className="sticky top-0 z-20 bg-cyan-950 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">Latest Logout IP</th>
              <th className="sticky top-0 z-20 bg-cyan-950 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">Latest Logout Time</th>
              <th className="sticky top-0 z-20 bg-cyan-950 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">Total Logins</th>
              <th className="sticky top-0 z-20 bg-cyan-950 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-slate-950">
            {rows.map(({ employee, adminUsername }, index) => (
              <tr key={employee.user_id} className="bg-slate-950 hover:bg-slate-800/30">
                <td className="px-2 py-1 text-center text-[11px] font-semibold text-slate-500">{index + 1}</td>
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
                    className="inline-flex h-5 items-center gap-0.5 whitespace-nowrap px-1 text-[9px] font-medium text-blue-300 transition-colors hover:text-cyan-200"
                  >
                    <Eye className="h-2.5 w-2.5" />
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
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-cyan-400/30 bg-slate-950 shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-cyan-400/25 bg-gradient-to-r from-blue-950 via-slate-950 to-cyan-950 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 shadow-[0_0_16px_rgba(34,211,238,0.2)]">
              <History className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-cyan-300/75">Login History</p>
              <h3 className="truncate text-base font-bold text-cyan-100 sm:text-lg">{selectedEmployee.username}</h3>
              <p className="truncate text-[10px] text-slate-400 sm:text-xs">Employee ID: {selectedEmployee.employee_id}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!historyLoading && detailedHistory.length > 0 && (
              <div className="flex items-center gap-1.5 rounded-lg border border-cyan-300/20 bg-slate-900/75 px-2 py-1 text-[10px] text-slate-400">
                <span>Total</span>
                <span className="font-bold text-cyan-300">{detailedHistory.length}</span>
                <span>records</span>
              </div>
            )}
            <button
              type="button"
              onClick={handleCloseHistory}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-300/20 bg-slate-900/80 text-slate-400 outline-none transition-colors hover:border-cyan-300/50 hover:bg-cyan-900/60 hover:text-cyan-100 focus-visible:ring-2 focus-visible:ring-cyan-300/50"
              aria-label="Close login history"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto bg-slate-950 px-2 py-2 login-history-modal-scroll sm:px-3 sm:py-2">
          {historyLoading ? (
            <div className="flex items-center justify-center py-10">
              <div className="h-7 w-7 animate-spin rounded-full border-4 border-cyan-500 border-t-transparent"></div>
            </div>
          ) : detailedHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <History className="mb-2 h-10 w-10 text-slate-600" />
              <p className="text-slate-400">No login history found</p>
            </div>
          ) : (
            <div className="min-w-full">
              <table className="min-w-[900px] w-full border-separate border-spacing-0">
                <thead className="sticky top-0 z-10 bg-slate-900">
                  <tr className="border-b border-cyan-500/35">
                    <th className="w-12 border-b border-cyan-500/30 px-2 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-cyan-200/75">#</th>
                    <th className="w-28 border-b border-cyan-500/30 px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/75">Action</th>
                    <th className="w-40 border-b border-cyan-500/30 px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/75">IP Address</th>
                    <th className="border-b border-cyan-500/30 px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/75">Device Info</th>
                    <th className="w-44 border-b border-cyan-500/30 px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-cyan-200/75">Time</th>
                  </tr>
                </thead>
                <tbody className="bg-slate-950">
                  {detailedHistory.map((record, index) => (
                    <tr key={record.id} className="border-b border-slate-800/80 bg-slate-950 hover:bg-slate-900/80">
                      <td className="px-2 py-1.5 text-center">
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-slate-800 text-[10px] font-semibold text-slate-400">
                          {index + 1}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold ${
                          record.action_type === 'login'
                            ? 'bg-green-500/10 text-green-400 border border-green-500/30'
                            : 'bg-orange-500/10 text-orange-400 border border-orange-500/30'
                        }`}>
                          {record.action_type === 'login' ? '→' : '←'}
                          {record.action_type === 'login' ? 'Login' : 'Logout'}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5 text-xs text-slate-300">
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                          <span className="break-all">{record.ip_address || 'Unknown'}</span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        <LoginDeviceSummary
                          deviceInfo={record.device_info}
                          userAgent={record.user_agent}
                          compact
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-start gap-1.5 text-[10px] text-slate-400">
                          <Clock className="mt-0.5 h-3 w-3 shrink-0" />
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

      </div>
    </div>
  ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 bg-slate-950 text-slate-100">
      <div className="flex min-h-0 flex-1 flex-col bg-slate-950">
        <div className="mb-0 flex shrink-0 flex-col justify-start gap-2 border-b border-cyan-400/25 bg-gradient-to-tr from-blue-950/85 via-slate-950 to-cyan-950/90 px-4 py-2.5 shadow-[0_8px_24px_rgba(8,47,73,0.18)] xl:min-h-[109px]">
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
              <div data-shared-ip-menu="all" className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('');
                    setIsAdminMenuOpen(false);
                    setOpenSharedIpMenu((current) => current === 'all' ? null : 'all');
                  }}
                  disabled={allSharedIpGroups.length === 0}
                  className={`inline-flex h-9 w-[230px] shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-bold outline-none transition-[background-color,border-color,box-shadow,color] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50 ${
                    selectedAllSharedIpGroup
                      ? 'border border-cyan-200/70 bg-cyan-700 text-white shadow-[0_0_14px_rgba(34,211,238,0.2)]'
                      : 'border border-cyan-300/30 bg-slate-900 text-cyan-200 hover:border-cyan-200/65 hover:bg-cyan-800 hover:text-white disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-600 disabled:shadow-none'
                  }`}
                  title={selectedAllSharedIpGroup ? 'Clear shared IP filter' : 'Choose a shared login IP across all admin groups'}
                >
                  <MapPin className="h-3 w-3 shrink-0" />
                  {selectedAllSharedIpGroup ? (
                    <>
                      <span className="min-w-0 flex-1 truncate text-left">{selectedAllSharedIpGroup.ip}</span>
                      <span className="shrink-0 rounded-full bg-slate-950 px-1.5 py-0.5 text-[9px]">{selectedAllSharedIpGroup.employees.length}</span>
                      <span
                        role="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSharedIpSelection(null);
                          setOpenSharedIpMenu(null);
                        }}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-600 text-white ring-1 ring-inset ring-red-300 transition-colors hover:bg-red-500 hover:text-white"
                        aria-label="Clear shared IP filter"
                      >
                        <X className="h-3 w-3" />
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate text-left">Shared Login IP</span>
                      <span className="shrink-0 rounded-full bg-slate-950 px-1.5 py-0.5 text-[9px]">{allSharedIpGroups.length}</span>
                      <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${openSharedIpMenu === 'all' ? 'rotate-180' : ''}`} />
                    </>
                  )}
                </button>
                {openSharedIpMenu === 'all' && (
                  <div role="listbox" aria-label="Shared login IP options" className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[230px] overflow-hidden rounded-lg border border-cyan-300/30 bg-slate-950 shadow-[0_14px_28px_rgba(2,6,23,0.55)] backdrop-blur-xl">
                    <div className="flex items-center justify-between border-b border-cyan-400/15 bg-gradient-to-r from-cyan-950 to-blue-950 px-2.5 py-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-200/85">Shared Login IP</span>
                      <span className="rounded-full border border-cyan-300/20 bg-cyan-950 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-200">{allSharedIpGroups.length}</span>
                    </div>
                    <div className="max-h-64 overflow-y-auto p-1 login-history-menu-scrollbar">
                      {allSharedIpGroups.map((option) => (
                        <button
                          key={option.ip}
                          type="button"
                          role="option"
                          aria-selected={selectedAllSharedIpGroup?.ip === option.ip}
                          onClick={() => {
                            setSearchTerm('');
                            setSharedIpSelection({ scope: 'all', ip: option.ip });
                            setOpenSharedIpMenu(null);
                          }}
                          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-slate-300 transition-[background-color,color,box-shadow] hover:bg-slate-800 hover:text-cyan-100 hover:ring-1 hover:ring-inset hover:ring-cyan-300/35"
                        >
                          <MapPin className="h-3 w-3 shrink-0 text-cyan-300" />
                          <span className="min-w-0 flex-1 truncate text-xs font-semibold">{option.ip}</span>
                          <span className="shrink-0 rounded-full border border-slate-600/70 bg-slate-900 px-1.5 py-0.5 text-[9px] font-bold text-slate-300">{option.employees.length}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {admin.role === 'super_admin' && (
              <div ref={adminMenuRef} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setIsAdminMenuOpen((open) => !open)}
                  className="inline-flex h-9 w-[190px] items-center gap-2 rounded-lg border border-cyan-300/35 bg-gradient-to-r from-slate-900 to-cyan-950 px-2.5 text-left text-xs font-semibold text-cyan-100 shadow-[0_6px_18px_rgba(8,47,73,0.2)] outline-none transition-[border-color,box-shadow,background-color] hover:border-cyan-200/65 hover:from-slate-800 hover:to-cyan-950 focus:border-cyan-200 focus:ring-4 focus:ring-cyan-400/20"
                  aria-haspopup="listbox"
                  aria-expanded={isAdminMenuOpen}
                  aria-label="Select admin group"
                >
                  <Users className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
                  <span className="min-w-0 flex-1 truncate">
                    {isSearching ? 'All groups · Search' : selectedAdmin?.username || 'Select group'}
                  </span>
                  <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-cyan-300 transition-transform ${isAdminMenuOpen ? 'rotate-180' : ''}`} />
                </button>
                {isAdminMenuOpen && (
                  <div
                    role="listbox"
                    aria-label="Admin groups"
                    className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[190px] overflow-hidden rounded-lg border border-cyan-300/30 bg-slate-950 shadow-[0_14px_28px_rgba(2,6,23,0.55)] backdrop-blur-xl"
                  >
                    <div className="flex items-center justify-between border-b border-cyan-400/15 bg-gradient-to-r from-cyan-950 to-blue-950 px-2.5 py-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-200/85">Admin groups</span>
                      <span className="rounded-full border border-cyan-300/20 bg-cyan-950 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-200">{admins.length}</span>
                    </div>
                    <div className="max-h-64 overflow-y-auto p-1 login-history-menu-scrollbar">
                      {sortedAdminOptions.map((adminOption) => {
                        const group = adminGroups.find((groupOption) => groupOption.admin_id === adminOption.id);
                        const isSelected = !isSearching && selectedAdminId === adminOption.id;
                        return (
                          <button
                            key={adminOption.id}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            onClick={() => {
                              setSearchTerm('');
                              setSharedIpSelection(null);
                              setSelectedAdminId(adminOption.id);
                              setIsAdminMenuOpen(false);
                            }}
                            className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-[background-color,color,box-shadow] ${
                              isSelected
                                ? 'bg-cyan-800 text-white ring-1 ring-inset ring-cyan-200/60 shadow-[inset_3px_0_0_rgba(103,232,249,0.9),0_0_12px_rgba(34,211,238,0.16)]'
                                : 'text-slate-300 hover:bg-slate-800 hover:text-cyan-100 hover:ring-1 hover:ring-inset hover:ring-cyan-300/35 hover:shadow-[0_0_10px_rgba(34,211,238,0.1)]'
                            }`}
                          >
                            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${
                              adminOption.role === 'super_admin' ? 'bg-yellow-400/15 text-yellow-300' : 'bg-blue-400/15 text-blue-300'
                            }`}>
                              <Users className="h-3 w-3" />
                            </span>
                            <span className="min-w-0 flex-1 truncate text-xs font-semibold">{adminOption.username}</span>
                            <span className="shrink-0 rounded-full border border-slate-600/70 bg-slate-900 px-1.5 py-0.5 text-[9px] font-bold text-slate-300">
                              {group?.employees.length || 0}
                            </span>
                            {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-cyan-300" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
            {admin.role !== 'super_admin' && secondaryGroup && (
              <div data-shared-ip-menu={secondaryGroup.admin_id} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('');
                    setIsAdminMenuOpen(false);
                    setOpenSharedIpMenu((current) => current === secondaryGroup.admin_id ? null : secondaryGroup.admin_id);
                  }}
                  disabled={secondarySharedIpGroups.length === 0}
                  className={`inline-flex h-9 w-[230px] shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-bold outline-none transition-[background-color,border-color,box-shadow,color] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50 ${
                    selectedSecondarySharedIpGroup
                      ? 'border border-cyan-200/70 bg-cyan-700 text-white shadow-[0_0_14px_rgba(34,211,238,0.2)]'
                      : 'border border-cyan-300/30 bg-slate-900 text-cyan-200 hover:border-cyan-200/65 hover:bg-cyan-800 hover:text-white disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-600 disabled:shadow-none'
                  }`}
                  title={selectedSecondarySharedIpGroup ? 'Open shared login IP choices' : 'Choose a shared login IP'}
                >
                  <MapPin className="h-3 w-3 shrink-0" />
                  {selectedSecondarySharedIpGroup ? (
                    <>
                      <span className="min-w-0 flex-1 truncate text-left">{selectedSecondarySharedIpGroup.ip}</span>
                      <span className="shrink-0 rounded-full bg-slate-950 px-1.5 py-0.5 text-[9px]">{selectedSecondarySharedIpGroup.employees.length}</span>
                      <span
                        role="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSharedIpSelection(null);
                          setOpenSharedIpMenu(null);
                        }}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-600 text-white ring-1 ring-inset ring-red-300 transition-colors hover:bg-red-500 hover:text-white"
                        aria-label="Clear shared IP filter"
                      >
                        <X className="h-3 w-3" />
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate text-left">Shared Login IP</span>
                      <span className="shrink-0 rounded-full bg-slate-950 px-1.5 py-0.5 text-[9px]">{secondarySharedIpGroups.length}</span>
                      <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${openSharedIpMenu === secondaryGroup.admin_id ? 'rotate-180' : ''}`} />
                    </>
                  )}
                </button>
                {openSharedIpMenu === secondaryGroup.admin_id && (
                  <div role="listbox" aria-label="Shared login IP options" className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[230px] overflow-hidden rounded-lg border border-cyan-300/30 bg-slate-950 shadow-[0_14px_28px_rgba(2,6,23,0.55)] backdrop-blur-xl">
                    <div className="flex items-center justify-between border-b border-cyan-400/15 bg-gradient-to-r from-cyan-950 to-blue-950 px-2.5 py-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-200/85">Shared Login IP</span>
                      <span className="rounded-full border border-cyan-300/20 bg-cyan-950 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-200">{secondarySharedIpGroups.length}</span>
                    </div>
                    <div className="max-h-64 overflow-y-auto p-1 login-history-menu-scrollbar">
                      {secondarySharedIpGroups.map((option) => (
                        <button
                          key={option.ip}
                          type="button"
                          role="option"
                          aria-selected={selectedSecondarySharedIpGroup?.ip === option.ip}
                          onClick={() => {
                            setSearchTerm('');
                            setSharedIpSelection({ scope: 'group', groupId: secondaryGroup.admin_id, ip: option.ip });
                            setOpenSharedIpMenu(null);
                          }}
                          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-slate-300 transition-[background-color,color,box-shadow] hover:bg-slate-800 hover:text-cyan-100 hover:ring-1 hover:ring-inset hover:ring-cyan-300/35"
                        >
                          <MapPin className="h-3 w-3 shrink-0 text-cyan-300" />
                          <span className="min-w-0 flex-1 truncate text-xs font-semibold">{option.ip}</span>
                          <span className="shrink-0 rounded-full border border-slate-600/70 bg-slate-900 px-1.5 py-0.5 text-[9px] font-bold text-slate-300">{option.employees.length}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="relative w-full min-w-0 sm:max-w-[280px] xl:max-w-[320px]">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-cyan-700" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setSharedIpSelection(null);
                }}
                placeholder="Search by username, employee ID, or IP address..."
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-9 text-xs font-medium text-slate-900 shadow-[0_6px_18px_rgba(2,6,23,0.14)] outline-none transition-[border-color,box-shadow] placeholder:text-slate-500 hover:border-cyan-400 focus:border-cyan-500 focus:ring-4 focus:ring-cyan-400/20"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('');
                    setSharedIpSelection(null);
                    setOpenSharedIpMenu(null);
                  }}
                  className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-red-600 text-white transition-colors hover:bg-red-500"
                  aria-label="Clear search"
                  title="Clear search"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-950 isolate">
            {sharedIpSelection?.scope === 'all' ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-cyan-500/20 bg-slate-950 isolate">
                <div className="flex shrink-0 items-center justify-between border-b border-cyan-500/25 bg-cyan-950/55 px-3 py-2">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-200/80">Shared IP employees</p>
                    <p className="mt-0.5 text-xs text-slate-300">All admin groups</p>
                  </div>
                  <span className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold text-cyan-200">
                    {sharedIpRows.length} employees
                  </span>
                </div>
                {renderEmployeeTable(sharedIpRows, true, true)}
              </div>
            ) : sharedIpSelection?.scope === 'group' && admin.role !== 'super_admin' ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-cyan-500/20 bg-slate-950 isolate">
                <div className="flex shrink-0 items-center justify-between border-b border-cyan-500/25 bg-cyan-950/55 px-3 py-2">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-200/80">Shared IP employees</p>
                    <p className="mt-0.5 text-xs text-slate-300">Your employees only</p>
                  </div>
                  <span className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold text-cyan-200">
                    {selectedSecondarySharedIpGroup?.employees.length || 0} employees
                  </span>
                </div>
                {renderEmployeeTable(
                  secondaryGroup
                    ? getEmployeesForSharedIp(secondaryGroup.employees, sharedIpSelection.ip).map((employee) => ({ employee }))
                    : [],
                  false,
                  true,
                )}
              </div>
            ) : isSearching ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-cyan-500/20 bg-slate-950 isolate">
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
                    <div className={`sticky top-0 z-40 isolate relative flex items-center justify-between px-4 py-3 pr-60 border-b ${
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
                            ? getDisplayedGroupEmployees(group).length > 0
                              ? 'bg-yellow-500/10 text-yellow-300 border border-yellow-400/30'
                              : 'bg-slate-500/10 text-slate-400 border border-slate-500/30'
                            : getDisplayedGroupEmployees(group).length > 0
                            ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
                            : 'bg-slate-500/10 text-slate-400 border border-slate-500/30'
                        }`}>
                          {getDisplayedGroupEmployees(group).length} employee{getDisplayedGroupEmployees(group).length !== 1 ? 's' : ''}
                        </span>
                      </div>
                    {admin.role === 'super_admin' && (
                    <div data-shared-ip-menu={group.admin_id} className="absolute right-3 top-1/2 -translate-y-1/2">
                      <button
                        type="button"
                        onClick={() => {
                          setSearchTerm('');
                          setIsAdminMenuOpen(false);
                          setOpenSharedIpMenu((current) => current === group.admin_id ? null : group.admin_id);
                        }}
                        disabled={getSharedIpGroups(group.employees).length === 0}
                        className={`inline-flex h-7 w-[230px] items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-semibold outline-none transition-[background-color,border-color,box-shadow,color] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50 ${
                          getSelectedGroupSharedIp(group)
                            ? 'border border-cyan-200/70 bg-cyan-700 text-white shadow-[0_0_12px_rgba(34,211,238,0.2)]'
                            : 'border border-cyan-300/25 bg-slate-950 text-cyan-200 hover:border-cyan-200/60 hover:bg-cyan-800 hover:text-white disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-600 disabled:shadow-none'
                        }`}
                        title={getSelectedGroupSharedIp(group) ? 'Open shared login IP choices' : 'Choose a shared login IP in this group'}
                      >
                        <MapPin className="h-3 w-3 shrink-0" />
                        {getSelectedGroupSharedIp(group) ? (
                          <>
                            <span className="min-w-0 flex-1 truncate text-left">{getSelectedGroupSharedIp(group)?.ip}</span>
                            <span className="shrink-0 rounded-full bg-slate-950 px-1.5 py-0.5 text-[9px]">{getSelectedGroupSharedIp(group)?.employees.length}</span>
                            <span
                              role="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSharedIpSelection(null);
                                setOpenSharedIpMenu(null);
                              }}
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-600 text-white ring-1 ring-inset ring-red-300 transition-colors hover:bg-red-500 hover:text-white"
                              aria-label="Clear shared IP filter"
                            >
                              <X className="h-3 w-3" />
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="min-w-0 flex-1 truncate text-left">Shared Login IP</span>
                            <span className="shrink-0 rounded-full bg-slate-950 px-1.5 py-0.5 text-[9px]">{getSharedIpGroups(group.employees).length}</span>
                            <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${openSharedIpMenu === group.admin_id ? 'rotate-180' : ''}`} />
                          </>
                        )}
                      </button>
                      {openSharedIpMenu === group.admin_id && (
                        <div role="listbox" aria-label={`${group.admin_username} shared login IP options`} className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[230px] overflow-hidden rounded-lg border border-cyan-300/30 bg-slate-950 shadow-[0_14px_28px_rgba(2,6,23,0.55)] backdrop-blur-xl">
                          <div className="flex items-center justify-between border-b border-cyan-400/15 bg-gradient-to-r from-cyan-950 to-blue-950 px-2.5 py-1.5">
                            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-200/85">Shared Login IP</span>
                            <span className="rounded-full border border-cyan-300/20 bg-cyan-950 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-200">{getSharedIpGroups(group.employees).length}</span>
                          </div>
                          <div className="max-h-64 overflow-y-auto p-1 login-history-menu-scrollbar">
                            {getSharedIpGroups(group.employees).map((option) => (
                              <button
                                key={option.ip}
                                type="button"
                                role="option"
                                aria-selected={getSelectedGroupSharedIp(group)?.ip === option.ip}
                                onClick={() => {
                                  setSearchTerm('');
                                  setSharedIpSelection({ scope: 'group', groupId: group.admin_id, ip: option.ip });
                                  setOpenSharedIpMenu(null);
                                }}
                                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-slate-300 transition-[background-color,color,box-shadow] hover:bg-slate-800 hover:text-cyan-100 hover:ring-1 hover:ring-inset hover:ring-cyan-300/35"
                              >
                                <MapPin className="h-3 w-3 shrink-0 text-cyan-300" />
                                <span className="min-w-0 flex-1 truncate text-xs font-semibold">{option.ip}</span>
                                <span className="shrink-0 rounded-full border border-slate-600/70 bg-slate-900 px-1.5 py-0.5 text-[9px] font-bold text-slate-300">{option.employees.length}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    )}
                    </div>

                    {/* Group Content */}
                    <>
                        {getDisplayedGroupEmployees(group).length === 0 ? (
                          <div className="text-center py-8">
                            <Users className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                            <p className="text-slate-300 text-sm">No employees under this admin</p>
                          </div>
                        ) : (
                          <div className="min-h-0 flex-1 overflow-y-scroll overflow-x-auto bg-slate-950 login-history-list-scrollbar pb-1 sm:pb-1.5">
                            <table className="login-history-table w-full text-xs">
                              <thead className="bg-cyan-950">
                                <tr className="border-b border-cyan-500/45">
                                  <th className="sticky top-0 z-20 w-10 bg-cyan-950 px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-wider text-cyan-200/85">#</th>
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
                              <tbody className="bg-slate-950">
                                {getDisplayedGroupEmployees(group).map((employee, index) => (
                                  <tr key={employee.user_id} className="bg-slate-950 hover:bg-slate-800/30">
                                    <td className="px-2 py-1 text-center text-[11px] font-semibold text-slate-500">{index + 1}</td>
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
                                        className="inline-flex h-5 items-center gap-0.5 whitespace-nowrap px-1 text-[9px] font-medium text-blue-300 transition-colors hover:text-cyan-200"
                                      >
                                        <Eye className="h-2.5 w-2.5" />
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
          </div>
        )}
      </div>

      {modalContent && createPortal(modalContent, document.body)}
    </div>
  );
}
