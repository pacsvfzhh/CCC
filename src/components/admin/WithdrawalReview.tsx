import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Clock, Ban, ChevronDown, ChevronRight, Users, AlertCircle, ArrowUpDown, ArrowUp, ArrowDown, Pencil, Save, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Withdrawal, Employee, Admin } from '../../types';

interface WithdrawalWithEmployee extends Withdrawal {
  employee?: Employee;
}

interface WithdrawalReviewProps {
  admin: Admin;
}

interface AdminGroup {
  admin: Admin | null;
  withdrawals: WithdrawalWithEmployee[];
}

type FilterStatus = 'all' | 'pending' | 'approved' | 'rejected' | 'cancelled' | 'processed';
type SortOption = 'submit_time_desc' | 'submit_time_asc' | 'audit_time_desc' | 'audit_time_asc';

export default function WithdrawalReview({ admin }: WithdrawalReviewProps) {
  const [adminGroups, setAdminGroups] = useState<AdminGroup[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [auditRemark, setAuditRemark] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [sortOption, setSortOption] = useState<SortOption>('submit_time_desc');
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<'approved' | 'rejected'>('approved');
  const [editRemark, setEditRemark] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    confirmText: string;
    confirmColor: 'green' | 'red';
  } | null>(null);

  useEffect(() => {
    loadWithdrawals();

    // Set up real-time subscription for withdrawal requests
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const withdrawalChannel = supabase
      .channel('withdrawal-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'withdrawals' },
        (payload) => {
          if (payload.eventType === 'UPDATE' && payload.new) {
            setAdminGroups(prev => prev.map(group => ({
              ...group,
              withdrawals: group.withdrawals.map(w =>
                w.id === payload.new.id ? { ...w, ...payload.new } : w
              ),
            })));
            return;
          }
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => loadWithdrawals(), 800);
        }
      )
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(withdrawalChannel);
    };
  }, []); // Remove admin.id from dependencies

  const loadWithdrawals = async () => {
    try {
      let employeeIds: string[] = [];

      if (admin.role === 'secondary_admin') {
        const { data: employees } = await supabase
          .from('users')
          .select('id')
          .eq('created_by', admin.id);
        employeeIds = employees?.map((e) => e.id) || [];
      }

      let query = supabase
        .from('withdrawals')
        .select('*')
        .order('created_at', { ascending: false });

      if (admin.role === 'secondary_admin' && employeeIds.length > 0) {
        query = query.in('user_id', employeeIds);
      }

      const { data: withdrawalsData, error: withdrawalsError } = await query;
      if (withdrawalsError) throw withdrawalsError;

      const { data: employees } = await supabase.from('users').select('*');
      const employeeMap = new Map(employees?.map((e) => [e.id, e]));

      const { data: admins } = await supabase.from('admins').select('*');
      const adminMap = new Map(admins?.map((a) => [a.id, a]));

      const withdrawalsWithEmployees = withdrawalsData?.map((w) => ({
        ...w,
        employee: employeeMap.get(w.user_id),
      })) || [];

      const groupedByAdmin = new Map<string, WithdrawalWithEmployee[]>();

      withdrawalsWithEmployees.forEach((withdrawal) => {
        const createdBy = withdrawal.employee?.created_by || 'unassigned';
        if (!groupedByAdmin.has(createdBy)) {
          groupedByAdmin.set(createdBy, []);
        }
        groupedByAdmin.get(createdBy)!.push(withdrawal);
      });

      const groups: AdminGroup[] = Array.from(groupedByAdmin.entries())
        .map(([adminId, withdrawals]) => ({
          admin: adminId === 'unassigned' ? null : adminMap.get(adminId) || null,
          withdrawals: withdrawals.sort((a, b) => {
            if (a.status === 'pending' && b.status !== 'pending') return -1;
            if (a.status !== 'pending' && b.status === 'pending') return 1;
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          }),
        }))
        .sort((a, b) => {
          if (!a.admin) return 1;
          if (!b.admin) return -1;
          return (a.admin.username || '').localeCompare(b.admin.username || '');
        });

      setAdminGroups(groups);

      const initialExpanded = new Set<string>();
      groups.forEach((group) => {
        const key = group.admin?.id || 'unassigned';
        initialExpanded.add(key);
      });
      setExpandedGroups(initialExpanded);
    } catch (error) {
      console.error('Error loading withdrawals:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleGroup = (adminId: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(adminId)) {
      newExpanded.delete(adminId);
    } else {
      newExpanded.add(adminId);
    }
    setExpandedGroups(newExpanded);
  };

  const handleReview = async (withdrawalId: string, status: 'approved' | 'rejected') => {
    if (!auditRemark.trim()) {
      setValidationError('Please enter audit remarks');
      return;
    }

    setConfirmDialog({
      isOpen: true,
      title: status === 'approved' ? 'Approve Withdrawal' : 'Reject Withdrawal',
      message: status === 'approved'
        ? `Are you sure you want to approve this withdrawal? The amount will be deducted from the frozen balance.`
        : `Are you sure you want to reject this withdrawal? The amount will be returned to the employee's available balance.`,
      confirmText: status === 'approved' ? 'Approve' : 'Reject',
      confirmColor: status === 'approved' ? 'green' : 'red',
      onConfirm: async () => {
        setConfirmDialog(null);
        setValidationError(null);

        try {
          const withdrawal = adminGroups
            .flatMap((g) => g.withdrawals)
            .find((w) => w.id === withdrawalId);
          if (!withdrawal) return;

          // First, update withdrawal status with condition to prevent duplicate processing
          const { error: updateError } = await supabase
            .from('withdrawals')
            .update({
              status,
              audit_remark: auditRemark,
              audited_by: admin.id,
              audited_at: new Date().toISOString(),
            })
            .eq('id', withdrawalId)
            .eq('status', 'pending');

          if (updateError) throw updateError;

          const { data: wallet } = await supabase
            .from('wallets')
            .select('*')
            .eq('user_id', withdrawal.user_id)
            .single();

          if (!wallet) return;

          if (status === 'approved') {
            const newFrozenBalance = wallet.frozen_balance - withdrawal.amount;

            await supabase
              .from('wallets')
              .update({
                frozen_balance: newFrozenBalance,
              })
              .eq('user_id', withdrawal.user_id);

            await supabase.from('wallet_transactions').insert({
              user_id: withdrawal.user_id,
              type: 'withdrawal_approved',
              amount: -withdrawal.amount,
              balance_before: wallet.frozen_balance,
              balance_after: newFrozenBalance,
              reference_id: withdrawalId,
              remarks: `Withdrawal approved: ${auditRemark}`,
            });
          } else {
            // When rejecting, move money from frozen back to available
            // This is an internal transfer, NOT a new transaction
            // DO NOT create wallet_transactions record (it would incorrectly increase total balance)
            const newFrozenBalance = wallet.frozen_balance - withdrawal.amount;
            const newAvailableBalance = wallet.available_balance + withdrawal.amount;

            await supabase
              .from('wallets')
              .update({
                available_balance: newAvailableBalance,
                frozen_balance: newFrozenBalance,
              })
              .eq('user_id', withdrawal.user_id);

            // NOTE: We do NOT create a wallet_transaction here because:
            // 1. This is just moving funds internally (frozen -> available)
            // 2. Creating a transaction would incorrectly ADD to the total balance
            // 3. The wallet table itself tracks the state correctly
          }

          setReviewing(null);
          setAuditRemark('');
          loadWithdrawals();
        } catch (error) {
          console.error('Error reviewing withdrawal:', error);
          setError('Failed to review withdrawal');
        }
      }
    });
  };

  const startEditing = (withdrawal: WithdrawalWithEmployee) => {
    setEditing(withdrawal.id);
    setEditStatus(withdrawal.status === 'rejected' ? 'rejected' : 'approved');
    setEditRemark(withdrawal.audit_remark || '');
  };

  const cancelEditing = () => {
    setEditing(null);
    setEditRemark('');
  };

  const handleEditSave = async (withdrawal: WithdrawalWithEmployee) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Modify Withdrawal Record',
      message: `Are you sure you want to change this withdrawal to "${editStatus}"? This will update the historical record.`,
      confirmText: 'Save Changes',
      confirmColor: editStatus === 'approved' ? 'green' : 'red',
      onConfirm: async () => {
        setConfirmDialog(null);
        setEditSaving(true);
        try {
          const oldStatus = withdrawal.status;
          const newStatus = editStatus;

          const { error: updateError } = await supabase
            .from('withdrawals')
            .update({
              status: newStatus,
              audit_remark: editRemark || null,
              audited_by: admin.id,
              audited_at: new Date().toISOString(),
            })
            .eq('id', withdrawal.id);

          if (updateError) throw updateError;

          // Handle wallet balance adjustments when status changes
          if (oldStatus !== newStatus) {
            const { data: wallet } = await supabase
              .from('wallets')
              .select('*')
              .eq('user_id', withdrawal.user_id)
              .maybeSingle();

            if (wallet) {
              if (oldStatus === 'approved' && newStatus === 'rejected') {
                // Was approved (money deducted from frozen), now rejected (return to available)
                await supabase
                  .from('wallets')
                  .update({
                    available_balance: wallet.available_balance + withdrawal.amount,
                  })
                  .eq('user_id', withdrawal.user_id);
              } else if (oldStatus === 'rejected' && newStatus === 'approved') {
                // Was rejected (money returned to available), now approved (deduct from available)
                await supabase
                  .from('wallets')
                  .update({
                    available_balance: wallet.available_balance - withdrawal.amount,
                  })
                  .eq('user_id', withdrawal.user_id);
              }
            }
          }

          setEditing(null);
          setEditRemark('');
          loadWithdrawals();
        } catch (err) {
          console.error('Error updating withdrawal:', err);
          setError('Failed to update withdrawal record');
        } finally {
          setEditSaving(false);
        }
      }
    });
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      pending: 'bg-yellow-500/10 border-yellow-500/50 text-yellow-400',
      approved: 'bg-green-500/10 border-green-500/50 text-green-400',
      rejected: 'bg-red-500/10 border-red-500/50 text-red-400',
      cancelled: 'bg-slate-500/10 border-slate-500/50 text-slate-400',
    };

    const icons = {
      pending: <Clock className="w-4 h-4" />,
      approved: <CheckCircle className="w-4 h-4" />,
      rejected: <XCircle className="w-4 h-4" />,
      cancelled: <Ban className="w-4 h-4" />,
    };

    return (
      <div className={`flex items-center gap-2 px-3 py-1 rounded-full border text-sm font-medium ${styles[status as keyof typeof styles]}`}>
        {icons[status as keyof typeof icons]}
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </div>
    );
  };

  const getGroupStats = (withdrawals: WithdrawalWithEmployee[]) => {
    const pending = withdrawals.filter((w) => w.status === 'pending').length;
    const approved = withdrawals.filter((w) => w.status === 'approved').length;
    const rejected = withdrawals.filter((w) => w.status === 'rejected').length;
    const cancelled = withdrawals.filter((w) => w.status === 'cancelled').length;
    const processed = approved + rejected + cancelled;
    const totalAmount = withdrawals.reduce((sum, w) => sum + w.amount, 0);

    return { pending, approved, rejected, cancelled, processed, total: withdrawals.length, totalAmount };
  };

  const getOverallStats = () => {
    const allWithdrawals = adminGroups.flatMap(g => g.withdrawals);
    return getGroupStats(allWithdrawals);
  };

  const sortWithdrawals = (withdrawals: WithdrawalWithEmployee[]) => {
    const sorted = [...withdrawals];

    switch (sortOption) {
      case 'submit_time_desc':
        return sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      case 'submit_time_asc':
        return sorted.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      case 'audit_time_desc':
        return sorted.sort((a, b) => {
          if (!a.audited_at && !b.audited_at) return 0;
          if (!a.audited_at) return 1;
          if (!b.audited_at) return -1;
          return new Date(b.audited_at).getTime() - new Date(a.audited_at).getTime();
        });
      case 'audit_time_asc':
        return sorted.sort((a, b) => {
          if (!a.audited_at && !b.audited_at) return 0;
          if (!a.audited_at) return 1;
          if (!b.audited_at) return -1;
          return new Date(a.audited_at).getTime() - new Date(b.audited_at).getTime();
        });
      default:
        return sorted;
    }
  };

  const filteredAdminGroups = adminGroups.map(group => ({
    ...group,
    withdrawals: sortWithdrawals(group.withdrawals.filter(w => {
      if (filterStatus === 'all') return true;
      if (filterStatus === 'pending') return w.status === 'pending';
      if (filterStatus === 'approved') return w.status === 'approved';
      if (filterStatus === 'rejected') return w.status === 'rejected';
      if (filterStatus === 'cancelled') return w.status === 'cancelled';
      if (filterStatus === 'processed') return w.status !== 'pending';
      return true;
    }))
  })).filter(group => group.withdrawals.length > 0);

  if (loading) {
    return (
      <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-blue-500/20 p-6">
        <div className="text-center py-8 text-slate-400">Loading withdrawals...</div>
      </div>
    );
  }

  const overallStats = getOverallStats();

  return (
    <>
      {/* Confirmation Dialog */}
      {confirmDialog?.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
            <div className="flex items-start gap-4 mb-4">
              <div className={`p-3 rounded-full ${
                confirmDialog.confirmColor === 'green'
                  ? 'bg-green-500/10 border border-green-500/50'
                  : 'bg-red-500/10 border border-red-500/50'
              }`}>
                <AlertCircle className={`w-6 h-6 ${
                  confirmDialog.confirmColor === 'green' ? 'text-green-400' : 'text-red-400'
                }`} />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-white mb-2">{confirmDialog.title}</h3>
                <p className="text-slate-300 text-sm">{confirmDialog.message}</p>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setConfirmDialog(null)}
                className="flex-1 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-medium transition-all"
              >
                Cancel
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className={`flex-1 px-4 py-2.5 text-white rounded-lg font-medium transition-all ${
                  confirmDialog.confirmColor === 'green'
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {confirmDialog.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-blue-500/20 p-6">
      <div className="flex items-center justify-end mb-6">
        {overallStats.pending > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-600/20 to-red-600/20 border-2 border-orange-500/50 rounded-lg animate-pulse">
            <AlertCircle className="w-5 h-5 text-orange-400" />
            <span className="text-orange-300 font-bold">
              {overallStats.pending} Pending Request{overallStats.pending !== 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <button
          onClick={() => setFilterStatus('all')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-all ${
            filterStatus === 'all'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/50'
              : 'bg-slate-800/50 text-slate-400 hover:bg-slate-800 hover:text-white border border-slate-700'
          }`}
        >
          <div className="flex items-center gap-2">
            <span>All Requests</span>
            <span className="px-2 py-0.5 bg-white/10 rounded-full text-xs font-bold">
              {overallStats.total}
            </span>
          </div>
        </button>

        <button
          onClick={() => setFilterStatus('pending')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-all ${
            filterStatus === 'pending'
              ? 'bg-orange-600 text-white shadow-lg shadow-orange-500/50'
              : 'bg-slate-800/50 text-slate-400 hover:bg-slate-800 hover:text-white border border-slate-700'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>Pending</span>
          {overallStats.pending > 0 && (
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
              filterStatus === 'pending'
                ? 'bg-white/20'
                : 'bg-orange-500/20 text-orange-400'
            }`}>
              {overallStats.pending}
            </span>
          )}
        </button>

        <button
          onClick={() => setFilterStatus('approved')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-all ${
            filterStatus === 'approved'
              ? 'bg-green-600 text-white shadow-lg shadow-green-500/50'
              : 'bg-slate-800/50 text-slate-400 hover:bg-slate-800 hover:text-white border border-slate-700'
          }`}
        >
          <CheckCircle className="w-4 h-4" />
          <span>Approved</span>
          {overallStats.approved > 0 && (
            <span className="px-2 py-0.5 bg-white/10 rounded-full text-xs font-bold">
              {overallStats.approved}
            </span>
          )}
        </button>

        <button
          onClick={() => setFilterStatus('rejected')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-all ${
            filterStatus === 'rejected'
              ? 'bg-red-600 text-white shadow-lg shadow-red-500/50'
              : 'bg-slate-800/50 text-slate-400 hover:bg-slate-800 hover:text-white border border-slate-700'
          }`}
        >
          <XCircle className="w-4 h-4" />
          <span>Rejected</span>
          {overallStats.rejected > 0 && (
            <span className="px-2 py-0.5 bg-white/10 rounded-full text-xs font-bold">
              {overallStats.rejected}
            </span>
          )}
        </button>

        <button
          onClick={() => setFilterStatus('cancelled')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-all ${
            filterStatus === 'cancelled'
              ? 'bg-slate-600 text-white shadow-lg shadow-slate-500/50'
              : 'bg-slate-800/50 text-slate-400 hover:bg-slate-800 hover:text-white border border-slate-700'
          }`}
        >
          <Ban className="w-4 h-4" />
          <span>Cancelled</span>
          {overallStats.cancelled > 0 && (
            <span className="px-2 py-0.5 bg-white/10 rounded-full text-xs font-bold">
              {overallStats.cancelled}
            </span>
          )}
        </button>

        <button
          onClick={() => setFilterStatus('processed')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-all ${
            filterStatus === 'processed'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/50'
              : 'bg-slate-800/50 text-slate-400 hover:bg-slate-800 hover:text-white border border-slate-700'
          }`}
        >
          <CheckCircle className="w-4 h-4" />
          <span>All Processed</span>
          <span className="px-2 py-0.5 bg-white/10 rounded-full text-xs font-bold">
            {overallStats.processed}
          </span>
        </button>
      </div>

      {/* Sort Options */}
      <div className="mb-6 flex items-center gap-3 p-4 bg-slate-800/30 rounded-lg border border-slate-700">
        <div className="flex items-center gap-2 text-slate-300">
          <ArrowUpDown className="w-4 h-4" />
          <span className="text-sm font-medium">Sort by:</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSortOption('submit_time_desc')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              sortOption === 'submit_time_desc'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-white'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Submit Time</span>
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setSortOption('submit_time_asc')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              sortOption === 'submit_time_asc'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-white'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Submit Time</span>
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setSortOption('audit_time_desc')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              sortOption === 'audit_time_desc'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-white'
            }`}
          >
            <CheckCircle className="w-3.5 h-3.5" />
            <span>Audit Time</span>
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setSortOption('audit_time_asc')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              sortOption === 'audit_time_asc'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-white'
            }`}
          >
            <CheckCircle className="w-3.5 h-3.5" />
            <span>Audit Time</span>
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {filteredAdminGroups.length === 0 ? (
        <div className="text-center py-8 text-slate-400">
          {filterStatus === 'all' && 'No withdrawal requests'}
          {filterStatus === 'pending' && 'No pending withdrawal requests'}
          {filterStatus === 'approved' && 'No approved withdrawal requests'}
          {filterStatus === 'rejected' && 'No rejected withdrawal requests'}
          {filterStatus === 'cancelled' && 'No cancelled withdrawal requests'}
          {filterStatus === 'processed' && 'No processed withdrawal requests'}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredAdminGroups.map((group) => {
            const adminId = group.admin?.id || 'unassigned';
            const isExpanded = expandedGroups.has(adminId);
            const stats = getGroupStats(group.withdrawals);

            return (
              <div key={adminId} className="bg-slate-800/50 rounded-lg border border-slate-700 overflow-hidden">
                <button
                  onClick={() => toggleGroup(adminId)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-700/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500/20 rounded-lg">
                      <Users className="w-5 h-5 text-blue-400" />
                    </div>
                    <div className="text-left">
                      <div className="text-white font-semibold">
                        {group.admin ? `${group.admin.username} (${group.admin.admin_id})` : 'Unassigned'}
                      </div>
                      <div className="text-sm text-slate-400">
                        {stats.total} withdrawal{stats.total !== 1 ? 's' : ''} · ${stats.totalAmount.toFixed(2)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {stats.pending > 0 && (
                      <div className="flex items-center gap-1 px-2 py-1 bg-yellow-500/10 rounded text-yellow-400 text-sm">
                        <Clock className="w-3 h-3" />
                        {stats.pending}
                      </div>
                    )}
                    {stats.approved > 0 && (
                      <div className="flex items-center gap-1 px-2 py-1 bg-green-500/10 rounded text-green-400 text-sm">
                        <CheckCircle className="w-3 h-3" />
                        {stats.approved}
                      </div>
                    )}
                    {stats.rejected > 0 && (
                      <div className="flex items-center gap-1 px-2 py-1 bg-red-500/10 rounded text-red-400 text-sm">
                        <XCircle className="w-3 h-3" />
                        {stats.rejected}
                      </div>
                    )}
                    {stats.cancelled > 0 && (
                      <div className="flex items-center gap-1 px-2 py-1 bg-slate-500/10 rounded text-slate-400 text-sm">
                        <Ban className="w-3 h-3" />
                        {stats.cancelled}
                      </div>
                    )}
                    {isExpanded ? (
                      <ChevronDown className="w-5 h-5 text-slate-400" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-slate-400" />
                    )}
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3 max-h-[1200px] overflow-y-auto">
                    {group.withdrawals.map((withdrawal) => {
                      const isPending = withdrawal.status === 'pending';
                      return (
                      <div
                        key={withdrawal.id}
                        className={`rounded-lg p-4 transition-all ${
                          isPending
                            ? 'bg-gradient-to-r from-orange-900/30 to-red-900/30 border-2 border-orange-500/50 shadow-lg shadow-orange-500/20'
                            : 'bg-slate-900/50 border border-slate-700/50'
                        }`}
                      >
                        <div className="flex flex-col md:flex-row justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="text-white font-medium">{withdrawal.employee?.username}</span>
                              <span className="text-slate-500 text-sm">{withdrawal.employee?.employee_id}</span>
                              {getStatusBadge(withdrawal.status)}
                            </div>
                            <div className="text-2xl font-bold text-green-400 mb-2">
                              ${withdrawal.amount.toFixed(2)}
                            </div>
                            <div className="space-y-1 text-slate-400 text-sm">
                              <div>Requested: {new Date(withdrawal.created_at).toLocaleString()}</div>
                              {withdrawal.audited_at && (
                                <div className={`font-medium ${
                                  withdrawal.status === 'approved' ? 'text-green-400' :
                                  withdrawal.status === 'rejected' ? 'text-red-400' :
                                  'text-slate-300'
                                }`}>
                                  {withdrawal.status === 'approved' && 'Approved: '}
                                  {withdrawal.status === 'rejected' && 'Rejected: '}
                                  {withdrawal.status === 'cancelled' && 'Cancelled: '}
                                  {new Date(withdrawal.audited_at).toLocaleString()}
                                </div>
                              )}
                            </div>
                            {withdrawal.audit_remark && (
                              <div className="mt-2 p-2 bg-slate-800 rounded text-slate-300 text-sm">
                                <strong>Audit Note:</strong> {withdrawal.audit_remark}
                              </div>
                            )}
                          </div>

                          {withdrawal.status === 'pending' && (
                            <div className="md:w-80">
                              {reviewing === withdrawal.id ? (
                                <div className="space-y-3">
                                  <textarea
                                    value={auditRemark}
                                    onChange={(e) => {
                                      setAuditRemark(e.target.value);
                                      if (validationError) setValidationError(null);
                                    }}
                                    placeholder="Enter audit remarks (required)"
                                    className={`w-full px-3 py-2 bg-slate-900/50 backdrop-blur-sm border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 resize-none ${
                                      validationError && reviewing === withdrawal.id
                                        ? 'border-red-500 focus:ring-red-500'
                                        : 'border-slate-700 focus:ring-blue-500'
                                    }`}
                                    rows={3}
                                  />
                                  {validationError && reviewing === withdrawal.id && (
                                    <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400 text-sm">
                                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                      <span>{validationError}</span>
                                    </div>
                                  )}
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => handleReview(withdrawal.id, 'approved')}
                                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-all"
                                    >
                                      <CheckCircle className="w-4 h-4" />
                                      Approve
                                    </button>
                                    <button
                                      onClick={() => handleReview(withdrawal.id, 'rejected')}
                                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-all"
                                    >
                                      <XCircle className="w-4 h-4" />
                                      Reject
                                    </button>
                                  </div>
                                  <button
                                    onClick={() => {
                                      setReviewing(null);
                                      setAuditRemark('');
                                      setValidationError(null);
                                    }}
                                    className="w-full px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm transition-all"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setReviewing(withdrawal.id)}
                                  className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-all"
                                >
                                  Review Request
                                </button>
                              )}
                            </div>
                          )}

                          {withdrawal.status !== 'pending' && (
                            <div className="md:w-80">
                              {editing === withdrawal.id ? (
                                <div className="space-y-3">
                                  <div>
                                    <label className="text-xs text-slate-400 mb-1 block">Status</label>
                                    <div className="flex gap-2">
                                      <button
                                        onClick={() => setEditStatus('approved')}
                                        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                                          editStatus === 'approved'
                                            ? 'bg-green-600 text-white'
                                            : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                                        }`}
                                      >
                                        <CheckCircle className="w-4 h-4" />
                                        Approved
                                      </button>
                                      <button
                                        onClick={() => setEditStatus('rejected')}
                                        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                                          editStatus === 'rejected'
                                            ? 'bg-red-600 text-white'
                                            : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                                        }`}
                                      >
                                        <XCircle className="w-4 h-4" />
                                        Rejected
                                      </button>
                                    </div>
                                  </div>
                                  <div>
                                    <label className="text-xs text-slate-400 mb-1 block">Audit Remark</label>
                                    <textarea
                                      value={editRemark}
                                      onChange={(e) => setEditRemark(e.target.value)}
                                      placeholder="Enter audit remarks"
                                      className="w-full px-3 py-2 bg-slate-900/50 backdrop-blur-sm border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                                      rows={3}
                                    />
                                  </div>
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => handleEditSave(withdrawal)}
                                      disabled={editSaving}
                                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-all"
                                    >
                                      <Save className="w-4 h-4" />
                                      {editSaving ? 'Saving...' : 'Save'}
                                    </button>
                                    <button
                                      onClick={cancelEditing}
                                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition-all"
                                    >
                                      <X className="w-4 h-4" />
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  onClick={() => startEditing(withdrawal)}
                                  className="flex items-center justify-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white rounded-lg text-sm font-medium transition-all"
                                >
                                  <Pencil className="w-4 h-4" />
                                  Edit Record
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="mt-4 p-4 bg-red-500/10 border border-red-500/50 rounded-lg">
          <div className="flex items-center gap-2 text-red-400">
            <AlertCircle className="w-5 h-5" />
            <span className="font-medium">{error}</span>
          </div>
        </div>
      )}
      </div>
    </>
  );
}
