import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, History, Eye, Users, Clock, MapPin, Monitor, X, ChevronDown, ChevronRight, ChevronUp, Pin, PinOff, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Admin } from '../../types';

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
  latest_logout_ip: string | null;
  latest_logout_time: string | null;
  total_logins: number;
  is_active: boolean;
}

interface LoginHistoryRecord {
  id: string;
  action_type: 'login' | 'logout';
  ip_address: string;
  user_agent: string | null;
  session_id: string | null;
  created_at: string;
}

interface AdminGroup {
  admin_id: string;
  admin_username: string;
  admin_role: string;
  employees: EmployeeSummary[];
  isCollapsed: boolean;
  isPinned: boolean;
}

export default function EmployeeLoginHistory({ admin }: EmployeeLoginHistoryProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [adminGroups, setAdminGroups] = useState<AdminGroup[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeSummary | null>(null);
  const [detailedHistory, setDetailedHistory] = useState<LoginHistoryRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [admins, setAdmins] = useState<{ id: string; username: string; role?: string; is_pinned?: boolean }[]>([]);

  useEffect(() => {
    const initialize = async () => {
      await loadAdmins();
      await loadEmployeeSummary();
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
          loadEmployeeSummary(true);
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
          loadEmployeeSummary(true);
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
          loadEmployeeSummary(true);
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
          loadAdmins();
          loadEmployeeSummary(true);
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
          loadAdmins();
          loadEmployeeSummary(true);
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
          loadAdmins();
          loadEmployeeSummary(true);
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
          loadEmployeeSummary(true);
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
    if (admins.length > 0) {
      loadEmployeeSummary();
    }
  }, [searchTerm]);

  // Auto-refresh data every 30 seconds (silent refresh, no loading state)
  useEffect(() => {
    const refreshInterval = setInterval(() => {
      if (!selectedEmployee) {
        loadEmployeeSummary(true); // Pass true for silent refresh
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
          .select('id, username, role, is_pinned')
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
            .select('id, username, role, is_pinned')
            .eq('is_active', true)
            .neq('role', 'emergency_admin')
            .order('username');

          if (adminsError) throw adminsError;
          adminList = adminsData || [];
          setAdmins(adminList);
        }

        console.log('Admins available:', adminList.length);

        // Create groups for ALL admins, including those with no employees
        const grouped = adminList.map((adm: any) => {
          const adminEmployees = employees.filter(e => e.created_by === adm.id);
          return {
            admin_id: adm.id,
            admin_username: adm.username,
            admin_role: adm.role || 'secondary_admin',
            employees: adminEmployees,
            isCollapsed: false,
            isPinned: adm.is_pinned || false
          };
        });

        // Sort: super_admin first, then by pinned status, then by username
        const sorted = grouped.sort((a, b) => {
          if (a.admin_role === 'super_admin' && b.admin_role !== 'super_admin') return -1;
          if (a.admin_role !== 'super_admin' && b.admin_role === 'super_admin') return 1;
          if (a.isPinned && !b.isPinned) return -1;
          if (!a.isPinned && b.isPinned) return 1;
          return a.admin_username.localeCompare(b.admin_username);
        });

        console.log('Admin groups created:', sorted.length);
        setAdminGroups(sorted);
      } else {
        // For secondary admins, show their employees only
        setAdminGroups([
          {
            admin_id: admin.id,
            admin_username: admin.username,
            admin_role: admin.role,
            employees: employees,
            isCollapsed: false,
            isPinned: false
          }
        ]);
      }
    } catch (error) {
      console.error('Error loading employee summary:', error);
    } finally {
      if (!silentRefresh) {
        setLoading(false);
      }
    }
  };

  const toggleGroupCollapse = (adminId: string) => {
    setAdminGroups(prev =>
      prev.map(group =>
        group.admin_id === adminId
          ? { ...group, isCollapsed: !group.isCollapsed }
          : group
      )
    );
  };

  const toggleGroupPin = async (adminId: string) => {
    try {
      // Find the current pin status
      const group = adminGroups.find(g => g.admin_id === adminId);
      if (!group) return;

      const newPinnedStatus = !group.isPinned;

      // Update in database
      const { error } = await supabase
        .from('admins')
        .update({ is_pinned: newPinnedStatus })
        .eq('id', adminId);

      if (error) {
        console.error('Error updating pin status:', error);
        return;
      }

      // Update local state
      setAdminGroups(prev => {
        const updated = prev.map(g =>
          g.admin_id === adminId
            ? { ...g, isPinned: newPinnedStatus }
            : g
        );

        // Sort: super_admin first, then pinned groups, then by username
        return updated.sort((a, b) => {
          if (a.admin_role === 'super_admin' && b.admin_role !== 'super_admin') return -1;
          if (a.admin_role !== 'super_admin' && b.admin_role === 'super_admin') return 1;
          if (a.isPinned && !b.isPinned) return -1;
          if (!a.isPinned && b.isPinned) return 1;
          return a.admin_username.localeCompare(b.admin_username);
        });
      });
    } catch (error) {
      console.error('Error toggling pin status:', error);
    }
  };

  const loadDetailedHistory = useCallback(async (userId: string) => {
    try {
      setHistoryLoading(true);

      const { data, error } = await supabase.rpc('get_employee_login_history', {
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
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const totalEmployees = adminGroups.reduce((sum, group) => sum + group.employees.length, 0);

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
                        {record.user_agent ? (
                          <div className="flex items-start gap-2 text-xs text-slate-400">
                            <Monitor className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" />
                            <span className="break-words">{record.user_agent}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500">Not recorded</span>
                        )}
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
    <div className="space-y-6">
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl">
        <div className="mb-6 flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by username, employee ID, or IP address..."
              className="w-full pl-12 pr-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 transition-all"
            />
          </div>
          <button
            onClick={() => {
              loadAdmins();
              loadEmployeeSummary();
            }}
            disabled={loading}
            className="px-4 py-3 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded-xl text-blue-400 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Refresh data"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            <span className="font-medium">Refresh</span>
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-2 text-sm text-slate-400">
              <Users className="w-4 h-4" />
              <span>Total Employees: {totalEmployees}</span>
              <span className="mx-2">|</span>
              <span>Admin Groups: {adminGroups.length}</span>
            </div>

            {adminGroups.length === 0 ? (
              <div className="text-center py-12">
                <History className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400">No admin groups found</p>
              </div>
            ) : (
              <div className="space-y-4">
                {adminGroups.map((group) => (
                  <div
                    key={group.admin_id}
                    className={`rounded-xl overflow-hidden border-2 ${
                      group.admin_role === 'super_admin'
                        ? 'bg-gradient-to-br from-yellow-500/5 via-slate-800/40 to-slate-800/40 border-yellow-500/30 shadow-lg shadow-yellow-500/10'
                        : 'bg-gradient-to-br from-blue-500/5 via-slate-800/40 to-slate-800/40 border-blue-500/30 shadow-lg shadow-blue-500/10'
                    }`}
                  >
                    {/* Group Header */}
                    <div className={`flex items-center justify-between px-4 py-3 border-b ${
                      group.admin_role === 'super_admin'
                        ? 'bg-gradient-to-r from-yellow-500/10 to-yellow-500/5 border-yellow-500/20'
                        : 'bg-gradient-to-r from-blue-500/10 to-blue-500/5 border-blue-500/20'
                    }`}>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => toggleGroupCollapse(group.admin_id)}
                          className={`p-1 rounded transition-colors ${
                            group.admin_role === 'super_admin'
                              ? 'hover:bg-yellow-500/20'
                              : 'hover:bg-blue-500/20'
                          }`}
                          title={group.isCollapsed ? 'Expand' : 'Collapse'}
                        >
                          {group.isCollapsed ? (
                            <ChevronRight className={`w-5 h-5 ${
                              group.admin_role === 'super_admin' ? 'text-yellow-400' : 'text-blue-400'
                            }`} />
                          ) : (
                            <ChevronDown className={`w-5 h-5 ${
                              group.admin_role === 'super_admin' ? 'text-yellow-400' : 'text-blue-400'
                            }`} />
                          )}
                        </button>
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
                            group.admin_role === 'super_admin' ? 'text-yellow-300' : 'text-white'
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
                        {group.isPinned && (
                          <Pin className="w-4 h-4 text-amber-400 fill-amber-400" />
                        )}
                      </div>
                      <button
                        onClick={() => toggleGroupPin(group.admin_id)}
                        className={`p-2 rounded-lg transition-all ${
                          group.isPinned
                            ? 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                            : group.admin_role === 'super_admin'
                            ? 'hover:bg-yellow-500/20 text-yellow-400'
                            : 'hover:bg-blue-500/20 text-blue-400'
                        }`}
                        title={group.isPinned ? 'Unpin group' : 'Pin group to top'}
                      >
                        {group.isPinned ? (
                          <PinOff className="w-4 h-4" />
                        ) : (
                          <Pin className="w-4 h-4" />
                        )}
                      </button>
                    </div>

                    {/* Group Content */}
                    {!group.isCollapsed && (
                      <div className={`max-h-[600px] overflow-y-auto overflow-x-auto custom-scrollbar ${
                        group.admin_role === 'super_admin'
                          ? 'scrollbar-thumb-amber-500/40 scrollbar-track-amber-950/30 hover:scrollbar-thumb-amber-400/60'
                          : 'scrollbar-thumb-cyan-500/50 scrollbar-track-slate-900/50 hover:scrollbar-thumb-cyan-400/70'
                      }`}>
                        {group.employees.length === 0 ? (
                          <div className="text-center py-8">
                            <Users className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                            <p className="text-slate-500 text-sm">No employees under this admin</p>
                          </div>
                        ) : (
                          <div className="p-4">
                            <table className="w-full">
                              <thead>
                                <tr className="border-b border-slate-700">
                                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Username</th>
                                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Employee ID</th>
                                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Latest Login IP</th>
                                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Latest Login Time</th>
                                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Latest Logout IP</th>
                                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Latest Logout Time</th>
                                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Logins</th>
                                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Actions</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-700/50">
                                {group.employees.map((employee) => (
                                  <tr key={employee.user_id} className="hover:bg-slate-800/30 transition-colors">
                                    <td className="px-4 py-3 text-sm text-white font-medium">{employee.username}</td>
                                    <td className="px-4 py-3 text-sm text-slate-300">{employee.employee_id}</td>
                                    <td className="px-4 py-3">
                                      {employee.latest_login_ip ? (
                                        <div className="flex items-center gap-2 text-sm text-slate-300">
                                          <MapPin className="w-4 h-4 text-green-400" />
                                          {employee.latest_login_ip}
                                        </div>
                                      ) : (
                                        <span className="text-sm text-slate-500">No data</span>
                                      )}
                                    </td>
                                    <td className="px-4 py-3">
                                      {employee.latest_login_time ? (
                                        <div className="flex items-center gap-2 text-xs text-slate-400">
                                          <Clock className="w-3 h-3" />
                                          {formatDateTime(employee.latest_login_time)}
                                        </div>
                                      ) : (
                                        <span className="text-xs text-slate-500">Never</span>
                                      )}
                                    </td>
                                    <td className="px-4 py-3">
                                      {employee.latest_logout_ip ? (
                                        <div className="flex items-center gap-2 text-sm text-slate-300">
                                          <MapPin className="w-4 h-4 text-orange-400" />
                                          {employee.latest_logout_ip}
                                        </div>
                                      ) : (
                                        <span className="text-sm text-slate-500">No data</span>
                                      )}
                                    </td>
                                    <td className="px-4 py-3">
                                      {employee.latest_logout_time ? (
                                        <div className="flex items-center gap-2 text-xs text-slate-400">
                                          <Clock className="w-3 h-3" />
                                          {formatDateTime(employee.latest_logout_time)}
                                        </div>
                                      ) : (
                                        <span className="text-xs text-slate-500">Never</span>
                                      )}
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className="flex items-center gap-2">
                                        <div className="flex items-center justify-center w-8 h-8 bg-blue-500/10 rounded-lg">
                                          <History className="w-4 h-4 text-blue-400" />
                                        </div>
                                        <span className="text-sm font-semibold text-white">
                                          {(employee.total_logins || 0).toLocaleString()}
                                        </span>
                                        <span className="text-xs text-slate-400">
                                          {(employee.total_logins || 0) === 1 ? 'time' : 'times'}
                                        </span>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3">
                                      <button
                                        onClick={() => handleViewHistory(employee)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded-lg text-blue-400 text-sm font-medium transition-all"
                                      >
                                        <Eye className="w-4 h-4" />
                                        View History
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
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
