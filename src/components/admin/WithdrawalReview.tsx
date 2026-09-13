import { useState, useEffect, useRef } from 'react';
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
  const loadWithdrawalsRef = useRef<(() => Promise<void>) | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    confirmText: string;
    confirmColor: 'green' | 'red';
  } | null>(null);

  useEffect(() => {
    void loadWithdrawalsRef.current?.();

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
          debounceTimer = setTimeout(() => { void loadWithdrawalsRef.current?.(); }, 800);
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
  loadWithdrawalsRef.current = loadWithdrawals;

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
          void loadWithdrawalsRef.current?.();
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
          void loadWithdrawalsRef.current?.();
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
      <div className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-semibold ${styles[status as keyof typeof styles]}`}>
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
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-950/55 px-3 py-3 sm:px-4 lg:px-5">
        <div className="flex h-full min-h-0 items-center justify-center rounded-2xl border border-blue-500/20 bg-slate-900/70 shadow-2xl shadow-slate-950/30">
          <div className="flex items-center gap-3 text-sm text-slate-400">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-400/25 border-t-blue-400" />
            Loading withdrawals...
          </div>
        </div>
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

      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-950/55 px-3 py-3 sm:px-4 lg:px-5">
        <section className="shrink-0 rounded-2xl border border-blue-500/20 bg-slate-900/80 p-4 shadow-2xl shadow-slate-950/25 backdrop-blur-xl sm:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-400/25 bg-gradient-to-br from-blue-600/30 via-cyan-500/15 to-amber-400/10 shadow-inner shadow-cyan-400/10">
                <ArrowUpDown className="h-5 w-5 text-cyan-300" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-lg font-bold tracking-tight text-white sm:text-xl">Withdrawal Review</h1>
                  {overallStats.pending > 0 && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-400/35 bg-orange-500/10 px-2.5 py-1 text-xs font-semibold text-orange-200">
                      <AlertCircle className="h-3.5 w-3.5 text-orange-300" />
                      {overallStats.pending} pending
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-400 sm:text-sm">Review requests, track processing status, and manage audit records.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:min-w-[440px]">
              <div className="rounded-xl border border-blue-400/15 bg-blue-500/[0.07] px-3 py-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-300/75">Requests</div>
                <div className="mt-1 text-lg font-bold tabular-nums text-white">{overallStats.total}</div>
              </div>
              <div className="rounded-xl border border-orange-400/20 bg-orange-500/[0.07] px-3 py-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-orange-300/75">Pending</div>
                <div className="mt-1 text-lg font-bold tabular-nums text-orange-200">{overallStats.pending}</div>
              </div>
              <div className="rounded-xl border border-emerald-400/15 bg-emerald-500/[0.07] px-3 py-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-300/75">Approved</div>
                <div className="mt-1 text-lg font-bold tabular-nums text-emerald-200">{overallStats.approved}</div>
              </div>
              <div className="rounded-xl border border-cyan-400/15 bg-cyan-500/[0.07] px-3 py-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-300/75">Total value</div>
                <div className="mt-1 truncate text-lg font-bold tabular-nums text-cyan-100">${overallStats.totalAmount.toFixed(2)}</div>
              </div>
            </div>
          </div>
        </section>

      <div className="mt-3 shrink-0 overflow-x-auto pb-1 scrollbar-hide">
        <div className="flex min-w-max gap-2">
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
      </div>

      {/* Sort Options */}
      <div className="mt-2 shrink-0 rounded-xl border border-slate-700/80 bg-slate-800/30 p-3">
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
          <ArrowUpDown className="w-4 h-4" />
          <span className="text-sm font-medium">Sort by:</span>
        </div>
        <div className="flex min-w-0 flex-wrap gap-2">
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

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 dark-panel-scroll">
      {filteredAdminGroups.length === 0 ? (
        <div className="flex min-h-[180px] items-center justify-center rounded-2xl border border-dashed border-slate-700/80 bg-slate-900/40 px-6 py-8 text-center text-sm text-slate-400">
          {filterStatus === 'all' && 'No withdrawal requests'}
          {filterStatus === 'pending' && 'No pending withdrawal requests'}
          {filterStatus === 'approved' && 'No approved withdrawal requests'}
          {filterStatus === 'rejected' && 'No rejected withdrawal requests'}
          {filterStatus === 'cancelled' && 'No cancelled withdrawal requests'}
          {filterStatus === 'processed' && 'No processed withdrawal requests'}
        </div>
      ) : (
        <div className="space-y-3 pb-3">
          {filteredAdminGroups.map((group) => {
            const adminId = group.admin?.id || 'unassigned';
            const isExpanded = expandedGroups.has(adminId);
            const stats = getGroupStats(group.withdrawals);

            return (
              <div key={adminId} className="overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900/70 shadow-lg shadow-slate-950/20">
                <button
                  onClick={() => toggleGroup(adminId)}
                  className="flex w-full items-center justify-between gap-3 border-b border-transparent px-4 py-3.5 text-left transition-colors hover:bg-blue-950/25"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-400/20 bg-blue-500/10">
                      <Users className="h-5 w-5 text-blue-300" />
                    </div>
                    <div className="min-w-0 text-left">
                      <div className="truncate text-sm font-semibold text-white sm:text-base">
                        {group.admin ? `${group.admin.username} (${group.admin.admin_id})` : 'Unassigned'}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-400">
                        {stats.total} withdrawal{stats.total !== 1 ? 's' : ''} <span className="text-slate-600">·</span> ${stats.totalAmount.toFixed(2)} total
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {stats.pending > 0 && (
                      <div className="flex items-center gap-1 rounded-lg border border-orange-400/20 bg-orange-500/10 px-2 py-1 text-xs font-semibold text-orange-300">
                        <Clock className="w-3 h-3" />
                        {stats.pending}
                      </div>
                    )}
                    {stats.approved > 0 && (
                      <div className="flex items-center gap-1 rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-300">
                        <CheckCircle className="w-3 h-3" />
                        {stats.approved}
                      </div>
                    )}
                    {stats.rejected > 0 && (
                      <div className="flex items-center gap-1 rounded-lg border border-red-400/20 bg-red-500/10 px-2 py-1 text-xs font-semibold text-red-300">
                        <XCircle className="w-3 h-3" />
                        {stats.rejected}
                      </div>
                    )}
                    {stats.cancelled > 0 && (
                      <div className="flex items-center gap-1 rounded-lg border border-slate-600/50 bg-slate-500/10 px-2 py-1 text-xs font-semibold text-slate-300">
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
                  <div className="space-y-3 border-t border-slate-800/80 bg-slate-950/20 px-3 pb-3 pt-3 sm:px-4 sm:pt-4">
                    {group.withdrawals.map((withdrawal) => {
                      const isPending = withdrawal.status === 'pending';
                      return (
                      <div
                        key={withdrawal.id}
                        className={`rounded-xl p-3.5 transition-all sm:p-4 ${
                          isPending
                            ? 'border border-orange-400/45 bg-gradient-to-br from-orange-950/45 via-slate-900/80 to-red-950/30 shadow-lg shadow-orange-950/20'
                            : 'border border-slate-700/70 bg-slate-900/65 hover:border-blue-400/25'
                        }`}
                      >
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="flex-1">
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-white sm:text-base">{withdrawal.employee?.username}</span>
                              <span className="rounded-md border border-slate-700 bg-slate-950/35 px-1.5 py-0.5 text-[11px] text-slate-400">{withdrawal.employee?.employee_id}</span>
                              {getStatusBadge(withdrawal.status)}
                            </div>
                            <div className="mb-2 text-2xl font-bold tabular-nums text-emerald-300">
                              ${withdrawal.amount.toFixed(2)}
                            </div>
                            <div className="space-y-1 text-xs text-slate-400 sm:text-sm">
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
                              <div className="mt-3 rounded-lg border border-slate-700/70 bg-slate-950/45 px-3 py-2 text-xs text-slate-300 sm:text-sm">
                                <span className="font-semibold text-slate-200">Audit note:</span> {withdrawal.audit_remark}
                              </div>
                            )}
                          </div>

                          {withdrawal.status === 'pending' && (
                            <div className="w-full shrink-0 lg:w-80">
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
                            <div className="w-full shrink-0 lg:w-80">
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
      </div>

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
