import { useState, useEffect, useRef, Fragment } from 'react';
import { CheckCircle, XCircle, Clock, Ban, AlertCircle, ArrowUpDown, Pencil, Save, X, Search, Users, Layers, ChevronDown, Check } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Withdrawal, Employee, Admin } from '../../types';

interface WithdrawalWithEmployee extends Withdrawal {
  employee?: Employee;
}

interface WithdrawalRow extends WithdrawalWithEmployee {
  admin: Admin | null;
}

interface WithdrawalReviewProps {
  admin: Admin;
}

interface AdminGroup {
  admin: Admin | null;
  withdrawals: WithdrawalWithEmployee[];
}

type FilterStatus = 'all' | 'today' | 'pending' | 'approved' | 'rejected' | 'cancelled' | 'processed';
type SortOption = 'submit_time_desc' | 'submit_time_asc' | 'audit_time_desc' | 'audit_time_asc';

const sortOptions: Array<{ key: SortOption; label: string; description: string }> = [
  { key: 'submit_time_desc', label: '最新提交', description: '按提交時間從新到舊' },
  { key: 'submit_time_asc', label: '最早提交', description: '按提交時間從舊到新' },
  { key: 'audit_time_desc', label: '最新審核', description: '按審核時間從新到舊' },
  { key: 'audit_time_asc', label: '最早審核', description: '按審核時間從舊到新' },
];

export default function WithdrawalReview({ admin }: WithdrawalReviewProps) {
  const [adminGroups, setAdminGroups] = useState<AdminGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [auditRemark, setAuditRemark] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [adminFilter, setAdminFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>('submit_time_desc');
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<'approved' | 'rejected'>('approved');
  const [editRemark, setEditRemark] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<'approved' | 'rejected' | null>(null);
  const [bulkRemark, setBulkRemark] = useState('');
  const [bulkValidationError, setBulkValidationError] = useState<string | null>(null);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const loadWithdrawalsRef = useRef<(() => Promise<void>) | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const groupMenuRef = useRef<HTMLDivElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    confirmText: string;
    confirmColor: 'green' | 'red';
  } | null>(null);

  useEffect(() => {
    if (!groupMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (groupMenuRef.current && !groupMenuRef.current.contains(event.target as Node)) {
        setGroupMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [groupMenuOpen]);

  useEffect(() => {
    if (!sortMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(event.target as Node)) {
        setSortMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [sortMenuOpen]);

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

      // Include every admin as a selectable group, even those with no withdrawal records yet
      // (emergency admin accounts don't manage employees, so they're excluded)
      if (admin.role === 'super_admin') {
        (admins || []).forEach((a) => {
          if (a.role === 'emergency_admin') return;
          if (!groupedByAdmin.has(a.id)) {
            groupedByAdmin.set(a.id, []);
          }
        });
      }

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
          if (!a.admin && !b.admin) return 0;
          if (!a.admin) return 1;
          if (!b.admin) return -1;
          if (a.admin.role === 'super_admin' && b.admin.role !== 'super_admin') return -1;
          if (b.admin.role === 'super_admin' && a.admin.role !== 'super_admin') return 1;
          return (a.admin.username || '').localeCompare(b.admin.username || '');
        });

      setAdminGroups(groups);
    } catch (error) {
      console.error('Error loading withdrawals:', error);
    } finally {
      setLoading(false);
    }
  };
  loadWithdrawalsRef.current = loadWithdrawals;

  const processWithdrawalDecision = async (
    withdrawal: WithdrawalWithEmployee,
    status: 'approved' | 'rejected',
    remark: string
  ) => {
    // Update withdrawal status with condition to prevent duplicate processing
    const { error: updateError } = await supabase
      .from('withdrawals')
      .update({
        status,
        audit_remark: remark,
        audited_by: admin.id,
        audited_at: new Date().toISOString(),
      })
      .eq('id', withdrawal.id)
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
        .update({ frozen_balance: newFrozenBalance })
        .eq('user_id', withdrawal.user_id);

      await supabase.from('wallet_transactions').insert({
        user_id: withdrawal.user_id,
        type: 'withdrawal_approved',
        amount: -withdrawal.amount,
        balance_before: wallet.frozen_balance,
        balance_after: newFrozenBalance,
        reference_id: withdrawal.id,
        remarks: `提現已批准：${remark}`,
      });
    } else {
      // When rejecting, move money from frozen back to available.
      // This is an internal transfer, so no wallet_transactions record is created
      // (it would incorrectly increase the reported total balance).
      const newFrozenBalance = wallet.frozen_balance - withdrawal.amount;
      const newAvailableBalance = wallet.available_balance + withdrawal.amount;

      await supabase
        .from('wallets')
        .update({
          available_balance: newAvailableBalance,
          frozen_balance: newFrozenBalance,
        })
        .eq('user_id', withdrawal.user_id);
    }
  };

  const handleReview = async (withdrawalId: string, status: 'approved' | 'rejected') => {
    if (!auditRemark.trim()) {
      setValidationError('請輸入審核備註');
      return;
    }

    setConfirmDialog({
      isOpen: true,
      title: status === 'approved' ? '批准提現' : '拒絕提現',
      message: status === 'approved'
        ? `確定要批准這筆提現嗎？金額將從凍結餘額中扣除。`
        : `確定要拒絕這筆提現嗎？金額將退回員工的可用餘額。`,
      confirmText: status === 'approved' ? '批准' : '拒絕',
      confirmColor: status === 'approved' ? 'green' : 'red',
      onConfirm: async () => {
        setConfirmDialog(null);
        setValidationError(null);

        try {
          const withdrawal = allRows.find((w) => w.id === withdrawalId);
          if (!withdrawal) return;

          await processWithdrawalDecision(withdrawal, status, auditRemark);

          setReviewing(null);
          setAuditRemark('');
          void loadWithdrawalsRef.current?.();
        } catch (error) {
          console.error('Error reviewing withdrawal:', error);
          setError('審核提現失敗');
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
      title: '修改提現記錄',
      message: `確定要將這筆提現修改為「${editStatus === 'approved' ? '已批准' : '已拒絕'}」嗎？這將更新歷史記錄。`,
      confirmText: '儲存變更',
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
          setError('更新提現記錄失敗');
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
      processed: 'bg-cyan-500/10 border-cyan-500/50 text-cyan-400',
    };

    const icons = {
      pending: <Clock className="w-3.5 h-3.5" />,
      approved: <CheckCircle className="w-3.5 h-3.5" />,
      rejected: <XCircle className="w-3.5 h-3.5" />,
      cancelled: <Ban className="w-3.5 h-3.5" />,
      processed: <CheckCircle className="w-3.5 h-3.5" />,
    };

    const labels = {
      pending: '待審核',
      approved: '已批准',
      rejected: '已拒絕',
      cancelled: '已取消',
      processed: '已處理',
    };

    return (
      <div className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-semibold ${styles[status as keyof typeof styles]}`}>
        {icons[status as keyof typeof icons]}
        {labels[status as keyof typeof labels] || '未知狀態'}
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

  const sortWithdrawals = <T extends WithdrawalWithEmployee,>(withdrawals: T[]): T[] => {
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

  const overallStats = getOverallStats();

  const allRows: WithdrawalRow[] = adminGroups.flatMap((group) =>
    group.withdrawals.map((w) => ({ ...w, admin: group.admin }))
  );

  const todayKey = new Date().toDateString();
  const todayCount = allRows.filter((w) => new Date(w.created_at).toDateString() === todayKey).length;

  const adminFilterOptions = adminGroups.map((group) => ({
    key: group.admin?.id || 'unassigned',
    label: group.admin
      ? group.admin.admin_id
        ? `${group.admin.username} (${group.admin.admin_id})`
        : group.admin.username
      : '未分配',
    count: group.withdrawals.length,
  }));

  const searchLower = searchQuery.trim().toLowerCase();

  const filteredRows = sortWithdrawals(
    allRows.filter((w) => {
      const ownerKey = w.admin?.id || 'unassigned';
      if (adminFilter !== 'all' && ownerKey !== adminFilter) return false;
      if (filterStatus === 'today' && new Date(w.created_at).toDateString() !== todayKey) return false;
      if (filterStatus === 'pending' && w.status !== 'pending') return false;
      if (filterStatus === 'approved' && w.status !== 'approved') return false;
      if (filterStatus === 'rejected' && w.status !== 'rejected') return false;
      if (filterStatus === 'cancelled' && w.status !== 'cancelled') return false;
      if (filterStatus === 'processed' && w.status === 'pending') return false;
      if (searchLower) {
        const username = (w.employee?.username || '').toLowerCase();
        const empId = (w.employee?.employee_id || '').toLowerCase();
        if (!username.includes(searchLower) && !empId.includes(searchLower)) return false;
      }
      return true;
    })
  );

  const pendingInView = filteredRows.filter((w) => w.status === 'pending');
  const allPendingSelected = pendingInView.length > 0 && pendingInView.every((w) => selectedIds.has(w.id));

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = !allPendingSelected && pendingInView.some((w) => selectedIds.has(w.id));
    }
  });

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPendingSelected) {
        pendingInView.forEach((w) => next.delete(w.id));
      } else {
        pendingInView.forEach((w) => next.add(w.id));
      }
      return next;
    });
  };

  const openBulkAction = (status: 'approved' | 'rejected') => {
    if (selectedIds.size === 0) return;
    setBulkAction(status);
    setBulkRemark('');
    setBulkValidationError(null);
  };

  const closeBulkAction = () => {
    if (bulkProcessing) return;
    setBulkAction(null);
    setBulkRemark('');
    setBulkValidationError(null);
  };

  const confirmBulkAction = async () => {
    if (!bulkAction) return;
    if (!bulkRemark.trim()) {
      setBulkValidationError('請輸入審核備註');
      return;
    }

    setBulkProcessing(true);
    try {
      const targets = allRows.filter((w) => selectedIds.has(w.id) && w.status === 'pending');
      for (const withdrawal of targets) {
        await processWithdrawalDecision(withdrawal, bulkAction, bulkRemark.trim());
      }
      setSelectedIds(new Set());
      setBulkAction(null);
      setBulkRemark('');
      void loadWithdrawalsRef.current?.();
    } catch (err) {
      console.error('Error processing bulk action:', err);
      setError('批量處理失敗');
    } finally {
      setBulkProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center overflow-hidden bg-slate-950/60">
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-400/25 border-t-blue-400" />
          正在載入提現資料...
        </div>
      </div>
    );
  }

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
                取消
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

      {/* Bulk Action Remark Modal */}
      {bulkAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="mb-4 flex items-start gap-3">
              <div className={`rounded-full p-2.5 ${bulkAction === 'approved' ? 'border border-green-500/40 bg-green-500/10' : 'border border-red-500/40 bg-red-500/10'}`}>
                {bulkAction === 'approved' ? <CheckCircle className="h-5 w-5 text-green-400" /> : <XCircle className="h-5 w-5 text-red-400" />}
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-white">
                  {bulkAction === 'approved' ? '批准' : '拒絕'} {selectedIds.size} 筆提現
                </h3>
                <p className="mt-0.5 text-xs text-slate-400">這則備註將套用至所有選取的申請。</p>
              </div>
            </div>
            <textarea
              value={bulkRemark}
              onChange={(e) => {
                setBulkRemark(e.target.value);
                if (bulkValidationError) setBulkValidationError(null);
              }}
              rows={3}
              placeholder="請輸入審核備註（必填）"
              className={`w-full resize-none rounded-lg border bg-slate-950/50 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 ${
                bulkValidationError ? 'border-red-500 focus:ring-red-500' : 'border-slate-700 focus:ring-blue-500'
              }`}
            />
            {bulkValidationError && (
              <div className="mt-2 flex items-center gap-2 text-xs text-red-400">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                {bulkValidationError}
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <button
                onClick={closeBulkAction}
                disabled={bulkProcessing}
                className="flex-1 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-slate-700 disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={confirmBulkAction}
                disabled={bulkProcessing}
                className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-all disabled:opacity-50 ${
                  bulkAction === 'approved' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {bulkProcessing ? '處理中...' : bulkAction === 'approved' ? `批准 ${selectedIds.size} 筆` : `拒絕 ${selectedIds.size} 筆`}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-950/60">
        {/* Header + Stats */}
        <section className="shrink-0 border-b border-slate-800/70 bg-slate-900/70 px-4 py-1.5 sm:px-5 lg:px-6">
          <div className="flex flex-col gap-1.5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-cyan-400/25 bg-gradient-to-br from-blue-600/30 via-cyan-500/15 to-amber-400/10">
                <ArrowUpDown className="h-3 w-3 text-cyan-300" />
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h1 className="text-sm font-bold tracking-tight text-white sm:text-base">提現審核</h1>
                {overallStats.pending > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-orange-400/35 bg-orange-500/10 px-2 py-0.5 text-[10px] font-semibold text-orange-200">
                    <AlertCircle className="h-3 w-3 text-orange-300" />
                    {overallStats.pending} 筆待審核
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {adminFilterOptions.length > 0 && (
                <div className="relative w-44 shrink-0" ref={groupMenuRef}>
                  <button
                    type="button"
                    onClick={() => setGroupMenuOpen((open) => !open)}
                    className={`flex w-full items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all ${
                      groupMenuOpen
                        ? 'border-cyan-300/80 bg-gradient-to-r from-blue-700/80 via-cyan-700/60 to-amber-500/35 text-white shadow-lg shadow-cyan-950/60 ring-1 ring-inset ring-cyan-200/20'
                        : 'border-cyan-500/35 bg-gradient-to-r from-slate-800/95 via-blue-950/80 to-cyan-950/70 text-cyan-50 shadow-md shadow-cyan-950/30 ring-1 ring-inset ring-white/5 hover:border-cyan-300/60 hover:from-slate-700/95 hover:via-blue-900/80 hover:to-cyan-900/70 hover:text-white'
                    }`}
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-blue-500/60 to-cyan-400/40 text-cyan-100 shadow-inner shadow-cyan-300/20">
                      {adminFilter === 'all' ? <Layers className="h-3 w-3" /> : <Users className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-left">
                      {adminFilter === 'all' ? '全部分組' : adminFilterOptions.find((opt) => opt.key === adminFilter)?.label || '全部分組'}
                    </span>
                    <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-cyan-200/80 transition-transform ${groupMenuOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {groupMenuOpen && (
                    <div className="absolute left-0 z-30 mt-2 w-full max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-cyan-400/30 bg-slate-800/95 shadow-2xl shadow-cyan-950/50 ring-1 ring-white/10 backdrop-blur-xl">
                      <div className="h-1 w-full bg-gradient-to-r from-blue-500 via-cyan-400 to-amber-400" />
                      <div className="max-h-72 overflow-y-auto p-1.5 dark-panel-scroll">
                        <button
                          type="button"
                          onClick={() => {
                            setAdminFilter('all');
                            setGroupMenuOpen(false);
                          }}
                          className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold transition-all ${
                            adminFilter === 'all' ? 'bg-blue-600/90 text-white' : 'text-slate-200 hover:bg-slate-700/80 hover:text-white'
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <Layers className="h-3.5 w-3.5" />
                            全部分組
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${adminFilter === 'all' ? 'bg-white/20' : 'bg-slate-700/70 text-slate-300'}`}>
                              {overallStats.total}
                            </span>
                            {adminFilter === 'all' && <Check className="h-3.5 w-3.5" />}
                          </span>
                        </button>

                        <div className="my-1 h-px bg-cyan-300/15" />

                        {adminFilterOptions.map((opt) => (
                          <button
                            key={opt.key}
                            type="button"
                            onClick={() => {
                              setAdminFilter(opt.key);
                              setGroupMenuOpen(false);
                            }}
                            className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium transition-all ${
                              adminFilter === opt.key ? 'bg-blue-600/90 text-white' : 'text-slate-200 hover:bg-slate-700/80 hover:text-white'
                            }`}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <Users className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{opt.label}</span>
                            </span>
                            <span className="flex shrink-0 items-center gap-1.5">
                              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${adminFilter === opt.key ? 'bg-white/20' : 'bg-slate-700/70 text-slate-300'}`}>
                                {opt.count}
                              </span>
                              {adminFilter === opt.key && <Check className="h-3.5 w-3.5" />}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex overflow-x-auto rounded-xl border border-slate-700/60 bg-slate-950/40 scrollbar-hide">
                <div className="min-w-[112px] flex-[1.6] border-r border-yellow-600/40 bg-gradient-to-br from-yellow-500/30 via-amber-500/20 to-yellow-600/10 px-3.5 py-1.5">
                  <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-yellow-200">今日提交</div>
                  <div className="mt-0.5 text-lg font-extrabold tabular-nums text-yellow-50">{todayCount}</div>
                </div>
                <div className="min-w-[82px] flex-1 border-r border-slate-700/60 px-3.5 py-1.5">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-orange-300/75">待審核</div>
                  <div className="mt-0.5 text-base font-bold tabular-nums text-orange-200">{overallStats.pending}</div>
                </div>
                <div className="min-w-[82px] flex-1 border-r border-slate-700/60 px-3.5 py-1.5">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-300/75">申請總數</div>
                  <div className="mt-0.5 text-base font-bold tabular-nums text-white">{overallStats.total}</div>
                </div>
                <div className="min-w-[82px] flex-1 border-r border-slate-700/60 px-3.5 py-1.5">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-300/75">已批准</div>
                  <div className="mt-0.5 text-base font-bold tabular-nums text-emerald-200">{overallStats.approved}</div>
                </div>
                <div className="min-w-[82px] flex-1 px-3.5 py-1.5">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-red-300/75">已拒絕</div>
                  <div className="mt-0.5 text-base font-bold tabular-nums text-red-200">{overallStats.rejected}</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Toolbar: status filter, admin filter, search, sort */}
        <section className="shrink-0 border-b border-slate-800/60 bg-slate-900/35 px-4 py-2 sm:px-5 lg:px-6">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 overflow-x-auto pb-0 scrollbar-hide">
              <div className="flex min-w-max items-center gap-1.5">
                {([
                  { key: 'all', label: '全部', count: overallStats.total, activeClass: 'bg-blue-600 text-white shadow-md shadow-blue-500/40', inactiveClass: 'border border-blue-500/45 bg-blue-500/10 text-blue-200 hover:bg-blue-500/20 hover:text-blue-100' },
                  { key: 'today', label: '今日提交', count: todayCount, activeClass: 'bg-amber-500 text-white shadow-md shadow-amber-500/40', inactiveClass: 'border border-amber-500/45 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 hover:text-amber-100' },
                  { key: 'pending', label: '待審核', count: overallStats.pending, activeClass: 'bg-orange-600 text-white shadow-md shadow-orange-500/40', inactiveClass: 'border border-orange-500/45 bg-orange-500/10 text-orange-200 hover:bg-orange-500/20 hover:text-orange-100' },
                  { key: 'approved', label: '已批准', count: overallStats.approved, activeClass: 'bg-green-600 text-white shadow-md shadow-green-500/40', inactiveClass: 'border border-green-500/45 bg-green-500/10 text-green-200 hover:bg-green-500/20 hover:text-green-100' },
                  { key: 'rejected', label: '已拒絕', count: overallStats.rejected, activeClass: 'bg-red-600 text-white shadow-md shadow-red-500/40', inactiveClass: 'border border-red-500/45 bg-red-500/10 text-red-200 hover:bg-red-500/20 hover:text-red-100' },
                  { key: 'cancelled', label: '已取消', count: overallStats.cancelled, activeClass: 'bg-slate-600 text-white shadow-md shadow-slate-500/40', inactiveClass: 'border border-slate-500/45 bg-slate-500/10 text-slate-200 hover:bg-slate-500/20 hover:text-slate-100' },
                  { key: 'processed', label: '已處理', count: overallStats.processed, activeClass: 'bg-cyan-600 text-white shadow-md shadow-cyan-500/40', inactiveClass: 'border border-cyan-500/45 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 hover:text-cyan-100' },
                ] as const).map((item) => (
                  <button
                    key={item.key}
                    onClick={() => setFilterStatus(item.key)}
                    className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                      filterStatus === item.key
                        ? item.activeClass
                        : item.inactiveClass
                    }`}
                  >
                    {item.label}
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${filterStatus === item.key ? 'bg-white/20' : 'bg-slate-700/70 text-slate-300'}`}>
                      {item.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜尋員工姓名或員工編號"
                  aria-label="搜尋員工姓名或員工編號"
                  className="w-full rounded-xl border border-white/70 bg-white py-1.5 pl-9 pr-3 text-xs font-medium text-slate-800 shadow-lg shadow-black/20 placeholder-slate-400 outline-none transition-all focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/30 sm:w-60"
                />
              </div>

              <div className="relative" ref={sortMenuRef}>
                <button
                  type="button"
                  onClick={() => setSortMenuOpen((open) => !open)}
                  className={`flex min-w-44 items-center justify-between gap-3 rounded-xl border px-3 py-1.5 text-left text-xs font-semibold shadow-lg transition-all ${
                    sortMenuOpen
                      ? 'border-cyan-300/80 bg-gradient-to-r from-blue-700/85 via-cyan-700/65 to-slate-800 text-white shadow-cyan-950/50 ring-1 ring-inset ring-cyan-200/20'
                      : 'border-slate-600/80 bg-slate-800/95 text-slate-100 shadow-black/25 hover:border-cyan-400/60 hover:bg-slate-700/95'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-cyan-200" />
                    <span className="truncate">{sortOptions.find((option) => option.key === sortOption)?.label}</span>
                  </span>
                  <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-cyan-200/80 transition-transform ${sortMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {sortMenuOpen && (
                  <div className="absolute right-0 z-30 mt-2 w-60 overflow-hidden rounded-xl border border-cyan-400/30 bg-slate-800/95 shadow-2xl shadow-cyan-950/50 ring-1 ring-white/10 backdrop-blur-xl">
                    <div className="h-1 w-full bg-gradient-to-r from-blue-500 via-cyan-400 to-amber-400" />
                    <div className="p-1.5">
                      {sortOptions.map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => {
                            setSortOption(option.key);
                            setSortMenuOpen(false);
                          }}
                          className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-all ${
                            sortOption === option.key
                              ? 'bg-cyan-600/85 text-white shadow-md shadow-cyan-950/30'
                              : 'text-slate-200 hover:bg-slate-700/85 hover:text-white'
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block text-xs font-semibold">{option.label}</span>
                            <span className={`mt-0.5 block text-[10px] ${sortOption === option.key ? 'text-cyan-100/80' : 'text-slate-400'}`}>
                              {option.description}
                            </span>
                          </span>
                          {sortOption === option.key && <Check className="h-3.5 w-3.5 shrink-0 text-cyan-100" />}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-blue-400/30 bg-blue-500/10 px-4 py-2.5 sm:px-5 lg:px-6">
            <div className="text-xs font-semibold text-blue-200">
              已選取 {selectedIds.size} 筆提現
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => openBulkAction('approved')}
                className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition-all hover:bg-green-700"
              >
                <CheckCircle className="h-3.5 w-3.5" />
                批准所選
              </button>
              <button
                onClick={() => openBulkAction('rejected')}
                className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-all hover:bg-red-700"
              >
                <XCircle className="h-3.5 w-3.5" />
                拒絕所選
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-300 transition-all hover:bg-slate-800 hover:text-white"
              >
                清除
              </button>
            </div>
          </div>
        )}

        {/* Data table */}
        <div className="min-h-0 flex-1 overflow-auto bg-slate-950/30 dark-panel-scroll">
          <table className="w-full min-w-[920px] border-collapse text-left text-sm">
            <thead className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur">
              <tr className="text-[10px] uppercase tracking-wider text-slate-400">
                <th className="w-10 px-3 py-2.5">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-blue-500"
                    checked={allPendingSelected}
                    onChange={toggleSelectAll}
                    disabled={pendingInView.length === 0}
                    aria-label="選取目前檢視中的所有待審核提現"
                  />
                </th>
                <th className="px-3 py-2.5 font-semibold">員工</th>
                <th className="px-3 py-2.5 font-semibold">金額</th>
                <th className="px-3 py-2.5 font-semibold">狀態</th>
                <th className="px-3 py-2.5 font-semibold">申請時間</th>
                <th className="px-3 py-2.5 font-semibold">審核資訊</th>
                <th className="px-3 py-2.5 text-right font-semibold">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-14 text-center text-sm text-slate-400">
                    沒有符合目前篩選條件的提現申請
                  </td>
                </tr>
              ) : (
                filteredRows.map((withdrawal) => {
                  const isPending = withdrawal.status === 'pending';
                  const isReviewing = reviewing === withdrawal.id;
                  const isEditing = editing === withdrawal.id;

                  return (
                    <Fragment key={withdrawal.id}>
                      <tr className={isPending ? 'bg-orange-500/[0.06] hover:bg-orange-500/[0.1]' : 'hover:bg-slate-800/40'}>
                        <td className="px-3 py-2.5 align-top">
                          {isPending && (
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 accent-blue-500"
                              checked={selectedIds.has(withdrawal.id)}
                              onChange={() => toggleSelectOne(withdrawal.id)}
                              aria-label={`選取 ${withdrawal.employee?.username || '員工'} 的提現申請` }
                            />
                          )}
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          <div className="font-medium text-white">{withdrawal.employee?.username}</div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            {withdrawal.employee?.employee_id}
                            <span className="text-slate-700"> · </span>
                            {withdrawal.admin ? withdrawal.admin.username : '未分配'}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 align-top font-bold tabular-nums text-emerald-300">
                          ${withdrawal.amount.toFixed(2)}
                        </td>
                        <td className="px-3 py-2.5 align-top">{getStatusBadge(withdrawal.status)}</td>
                        <td className="px-3 py-2.5 align-top text-xs text-slate-400">
                          {new Date(withdrawal.created_at).toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 align-top text-xs text-slate-400">
                          {withdrawal.audited_at ? (
                            <>
                              <div className={
                                withdrawal.status === 'approved' ? 'font-medium text-green-400' :
                                withdrawal.status === 'rejected' ? 'font-medium text-red-400' :
                                'font-medium text-slate-300'
                              }>
                                {new Date(withdrawal.audited_at).toLocaleString()}
                              </div>
                              {withdrawal.audit_remark && (
                                <div className="mt-0.5 max-w-[220px] truncate text-slate-500" title={withdrawal.audit_remark}>
                                  {withdrawal.audit_remark}
                                </div>
                              )}
                            </>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 align-top text-right">
                          {isPending ? (
                            <button
                              onClick={() => {
                                if (isReviewing) {
                                  setReviewing(null);
                                  setAuditRemark('');
                                  setValidationError(null);
                                } else {
                                  setReviewing(withdrawal.id);
                                  setAuditRemark('');
                                  setValidationError(null);
                                }
                              }}
                              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                                isReviewing
                                  ? 'bg-slate-700 text-white hover:bg-slate-600'
                                  : 'bg-blue-600 text-white hover:bg-blue-700'
                              }`}
                            >
                              {isReviewing ? '關閉' : '審核'}
                            </button>
                          ) : (
                            <button
                              onClick={() => (isEditing ? cancelEditing() : startEditing(withdrawal))}
                              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                                isEditing
                                  ? 'bg-slate-700 text-white hover:bg-slate-600'
                                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
                              }`}
                            >
                              <Pencil className="h-3 w-3" />
                              {isEditing ? '關閉' : '編輯'}
                            </button>
                          )}
                        </td>
                      </tr>

                      {isReviewing && (
                        <tr>
                          <td colSpan={7} className="border-t border-slate-800/80 bg-slate-950/40 px-4 py-3.5">
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                              <div className="flex-1">
                                <textarea
                                  value={auditRemark}
                                  onChange={(e) => {
                                    setAuditRemark(e.target.value);
                                    if (validationError) setValidationError(null);
                                  }}
                                  placeholder="請輸入審核備註（必填）"
                                  className={`w-full resize-none rounded-lg border bg-slate-900/50 px-3 py-2 text-sm text-white placeholder-slate-500 backdrop-blur-sm focus:outline-none focus:ring-2 ${
                                    validationError ? 'border-red-500 focus:ring-red-500' : 'border-slate-700 focus:ring-blue-500'
                                  }`}
                                  rows={2}
                                />
                                {validationError && (
                                  <div className="mt-2 flex items-center gap-2 text-xs text-red-400">
                                    <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                                    {validationError}
                                  </div>
                                )}
                              </div>
                              <div className="flex shrink-0 gap-2 lg:w-64">
                                <button
                                  onClick={() => handleReview(withdrawal.id, 'approved')}
                                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white transition-all hover:bg-green-700"
                                >
                                  <CheckCircle className="h-3.5 w-3.5" />
                                  批准
                                </button>
                                <button
                                  onClick={() => handleReview(withdrawal.id, 'rejected')}
                                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white transition-all hover:bg-red-700"
                                >
                                  <XCircle className="h-3.5 w-3.5" />
                                  拒絕
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}

                      {isEditing && (
                        <tr>
                          <td colSpan={7} className="border-t border-slate-800/80 bg-slate-950/40 px-4 py-3.5">
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                              <div className="flex shrink-0 gap-2 lg:w-56">
                                <button
                                  onClick={() => setEditStatus('approved')}
                                  className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                                    editStatus === 'approved' ? 'bg-green-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                                  }`}
                                >
                                  <CheckCircle className="h-3.5 w-3.5" />
                                  已批准
                                </button>
                                <button
                                  onClick={() => setEditStatus('rejected')}
                                  className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                                    editStatus === 'rejected' ? 'bg-red-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                                  }`}
                                >
                                  <XCircle className="h-3.5 w-3.5" />
                                  已拒絕
                                </button>
                              </div>
                              <div className="flex-1">
                                <textarea
                                  value={editRemark}
                                  onChange={(e) => setEditRemark(e.target.value)}
                                  placeholder="請輸入審核備註"
                                  className="w-full resize-none rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-white placeholder-slate-500 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  rows={2}
                                />
                              </div>
                              <div className="flex shrink-0 gap-2 lg:w-48">
                                <button
                                  onClick={() => handleEditSave(withdrawal)}
                                  disabled={editSaving}
                                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-all hover:bg-blue-700 disabled:opacity-50"
                                >
                                  <Save className="h-3.5 w-3.5" />
                                  {editSaving ? '儲存中...' : '儲存'}
                                </button>
                                <button
                                  onClick={cancelEditing}
                                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-700 px-3 py-2 text-xs font-semibold text-white transition-all hover:bg-slate-600"
                                >
                                  <X className="h-3.5 w-3.5" />
                                  取消
              </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Error Display */}
        {error && (
          <div className="shrink-0 border-t border-red-500/40 bg-red-500/10 px-4 py-2.5 sm:px-5 lg:px-6">
            <div className="flex items-center gap-2 text-red-400">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm font-medium">{error}</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
