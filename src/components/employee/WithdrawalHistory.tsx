import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Clock, CheckCircle, XCircle, History, ChevronDown, ChevronUp, TrendingUp, TrendingDown, DollarSign, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useResponsive } from '../../lib/useResponsive';
import { useLanguage } from '../../lib/i18n';
import { usePaginatedList } from '../../lib/usePaginatedList';

interface Withdrawal {
  id: string;
  amount: number;
  status: string;
  audit_remark: string | null;
  audited_at: string | null;
  created_at: string;
}

interface WalletTransaction {
  id: string;
  type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  remarks: string | null;
  created_at: string;
}

interface CombinedRecord {
  id: string;
  type: 'withdrawal' | 'adjustment';
  amount: number;
  created_at: string;
  data: Withdrawal | WalletTransaction;
}

interface WithdrawalHistoryProps {
  employeeId: string;
  onClose: () => void;
}

export default function WithdrawalHistory({ employeeId, onClose }: WithdrawalHistoryProps) {
  const [records, setRecords] = useState<CombinedRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const { isMobile } = useResponsive();
  const { t, dateLocale } = useLanguage();
  const ITEMS_PER_PAGE = isMobile ? 10 : 20;
  const { pageItems, page, totalPages, totalItems, hasNext, hasPrev, goNext, goPrev } = usePaginatedList({
    items: records,
    pageSize: ITEMS_PER_PAGE,
  });

  useEffect(() => {
    loadAllRecords();

    const interval = setInterval(() => {
      loadAllRecords();
    }, 5000);

    return () => clearInterval(interval);
  }, [employeeId]);

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  useEffect(() => {
    const body = document.body;
    const html = document.documentElement;

    const originalBodyOverflow = body.style.overflow;
    const originalHtmlOverflow = html.style.overflow;

    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';

    return () => {
      body.style.overflow = originalBodyOverflow;
      html.style.overflow = originalHtmlOverflow;
    };
  }, []);

  const loadAllRecords = async () => {
    try {
      const [withdrawalsResult, transactionsResult] = await Promise.all([
        supabase
          .from('withdrawals')
          .select('*')
          .eq('user_id', employeeId)
          .order('created_at', { ascending: false }),
        supabase
          .from('wallet_transactions')
          .select('*')
          .eq('user_id', employeeId)
          .eq('type', 'manual_adjustment')
          .order('created_at', { ascending: false })
      ]);

      const withdrawalRecords: CombinedRecord[] = (withdrawalsResult.data || []).map(w => ({
        id: `w-${w.id}`,
        type: 'withdrawal' as const,
        amount: w.amount,
        created_at: w.created_at,
        data: w
      }));

      const transactionRecords: CombinedRecord[] = (transactionsResult.data || []).map(t => ({
        id: `t-${t.id}`,
        type: 'adjustment' as const,
        amount: Math.abs(parseFloat(t.amount.toString())),
        created_at: t.created_at,
        data: t
      }));

      const combined = [...withdrawalRecords, ...transactionRecords].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setRecords(combined);
    } catch (error) {
      console.error('Error loading records:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setExpandedId(null);
    onClose();
  };

  const handleCancelWithdrawal = async (withdrawalId: string) => {
    if (cancelling) return;

    setCancelling(withdrawalId);
    setMessage(null);

    try {
      const { data: withdrawal, error: fetchError } = await supabase
        .from('withdrawals')
        .select('amount, status')
        .eq('id', withdrawalId)
        .single();

      if (fetchError) throw fetchError;

      if (withdrawal.status !== 'pending') {
        setMessage({ type: 'error', text: t.withdrawals.alreadyProcessed });
        loadAllRecords();
        setCancelling(null);
        return;
      }

      const { data: wallet, error: walletError } = await supabase
        .from('wallets')
        .select('available_balance, frozen_balance')
        .eq('user_id', employeeId)
        .single();

      if (walletError) throw walletError;

      const newAvailableBalance = wallet.available_balance + withdrawal.amount;
      const newFrozenBalance = wallet.frozen_balance - withdrawal.amount;

      if (newFrozenBalance < 0) {
        throw new Error('Insufficient frozen balance. Please refresh and try again.');
      }

      const { error: withdrawalUpdateError } = await supabase
        .from('withdrawals')
        .update({
          status: 'cancelled',
          audit_remark: t.withdrawals.cancelledByUser,
          audited_at: new Date().toISOString(),
        })
        .eq('id', withdrawalId)
        .eq('status', 'pending');

      if (withdrawalUpdateError) throw withdrawalUpdateError;

      const { error: walletUpdateError } = await supabase
        .from('wallets')
        .update({
          available_balance: newAvailableBalance,
          frozen_balance: newFrozenBalance,
        })
        .eq('user_id', employeeId);

      if (walletUpdateError) {
        await supabase
          .from('withdrawals')
          .update({
            status: 'pending',
            audit_remark: null,
            audited_at: null,
          })
          .eq('id', withdrawalId);
        throw walletUpdateError;
      }

      setMessage({ type: 'success', text: t.withdrawals.cancelSuccess });

      setTimeout(() => loadAllRecords(), 500);
    } catch (error) {
      console.error('Error cancelling withdrawal:', error);
      const errorMessage = error instanceof Error ? error.message : t.withdrawals.cancelFailed;
      setMessage({ type: 'error', text: errorMessage });
      loadAllRecords();
    } finally {
      setCancelling(null);
    }
  };

  const getStatusIcon = (record: CombinedRecord) => {
    if (record.type === 'withdrawal') {
      const withdrawal = record.data as Withdrawal;
      switch (withdrawal.status) {
        case 'pending':
          return <Clock className="w-5 h-5 text-amber-500" />;
        case 'approved':
          return <CheckCircle className="w-5 h-5 text-emerald-500" />;
        case 'rejected':
          return <XCircle className="w-5 h-5 text-red-500" />;
        case 'cancelled':
          return <XCircle className="w-5 h-5 text-gray-400" />;
        default:
          return <Clock className="w-5 h-5 text-gray-400" />;
      }
    } else {
      const transaction = record.data as WalletTransaction;
      if (parseFloat(transaction.amount.toString()) > 0) {
        return <TrendingUp className="w-5 h-5 text-emerald-500" />;
      } else {
        return <TrendingDown className="w-5 h-5 text-red-500" />;
      }
    }
  };

  const getStatusBadgeStyle = (record: CombinedRecord) => {
    if (record.type === 'withdrawal') {
      const withdrawal = record.data as Withdrawal;
      switch (withdrawal.status) {
        case 'pending':
          return 'text-amber-700 bg-amber-50 border-amber-200';
        case 'approved':
          return 'text-emerald-700 bg-emerald-50 border-emerald-200';
        case 'rejected':
          return 'text-red-700 bg-red-50 border-red-200';
        case 'cancelled':
          return 'text-gray-600 bg-gray-100 border-gray-200';
        default:
          return 'text-gray-600 bg-gray-100 border-gray-200';
      }
    } else {
      const transaction = record.data as WalletTransaction;
      if (parseFloat(transaction.amount.toString()) > 0) {
        return 'text-emerald-700 bg-emerald-50 border-emerald-200';
      } else {
        return 'text-red-700 bg-red-50 border-red-200';
      }
    }
  };

  const getCardStyle = (record: CombinedRecord) => {
    if (record.type === 'withdrawal') {
      const withdrawal = record.data as Withdrawal;
      switch (withdrawal.status) {
        case 'pending':
          return 'bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200 hover:border-amber-300 hover:shadow-amber-100/50';
        case 'approved':
          return 'bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-200 hover:border-emerald-300 hover:shadow-emerald-100/50';
        case 'rejected':
          return 'bg-gradient-to-r from-red-50 to-rose-50 border-red-200 hover:border-red-300 hover:shadow-red-100/50';
        case 'cancelled':
          return 'bg-gradient-to-r from-gray-50 to-slate-50 border-gray-200 hover:border-gray-300 hover:shadow-gray-100/50';
        default:
          return 'bg-white border-gray-200 hover:border-gray-300';
      }
    } else {
      const transaction = record.data as WalletTransaction;
      if (parseFloat(transaction.amount.toString()) > 0) {
        return 'bg-gradient-to-r from-emerald-50 to-cyan-50 border-emerald-200 hover:border-emerald-300 hover:shadow-emerald-100/50';
      } else {
        return 'bg-gradient-to-r from-red-50 to-orange-50 border-red-200 hover:border-red-300 hover:shadow-red-100/50';
      }
    }
  };

  const getCardAccentBar = (record: CombinedRecord) => {
    if (record.type === 'withdrawal') {
      const withdrawal = record.data as Withdrawal;
      switch (withdrawal.status) {
        case 'pending':
          return 'bg-gradient-to-b from-amber-400 to-orange-400';
        case 'approved':
          return 'bg-gradient-to-b from-emerald-400 to-teal-400';
        case 'rejected':
          return 'bg-gradient-to-b from-red-400 to-rose-400';
        case 'cancelled':
          return 'bg-gradient-to-b from-gray-300 to-gray-400';
        default:
          return 'bg-gradient-to-b from-gray-300 to-gray-400';
      }
    } else {
      const transaction = record.data as WalletTransaction;
      if (parseFloat(transaction.amount.toString()) > 0) {
        return 'bg-gradient-to-b from-emerald-400 to-cyan-400';
      } else {
        return 'bg-gradient-to-b from-red-400 to-orange-400';
      }
    }
  };

  const getStatusLabel = (record: CombinedRecord) => {
    if (record.type === 'withdrawal') {
      const withdrawal = record.data as Withdrawal;
      switch (withdrawal.status) {
        case 'pending':
          return t.withdrawals.pending;
        case 'approved':
          return t.withdrawals.approved;
        case 'rejected':
          return t.withdrawals.rejected;
        case 'cancelled':
          return t.withdrawals.cancelled;
        default:
          return withdrawal.status;
      }
    } else {
      const transaction = record.data as WalletTransaction;
      if (parseFloat(transaction.amount.toString()) > 0) {
        return t.withdrawals.balanceAdded;
      } else {
        return t.withdrawals.balanceDeducted;
      }
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 flex md:items-stretch md:justify-stretch md:p-0 lg:items-stretch lg:justify-stretch lg:p-0 xl:items-center xl:justify-center xl:p-4"
      style={{
        zIndex: 9999,
        alignItems: isMobile ? 'stretch' : undefined,
        justifyContent: isMobile ? 'stretch' : undefined,
        padding: isMobile ? '0' : undefined
      }}
    >
      <div className="absolute inset-0 bg-black/40"></div>
      <div
        className="relative bg-gray-50 w-full overflow-hidden flex flex-col
                   md:h-screen md:max-h-full md:rounded-none md:border-0
                   xl:h-auto xl:max-h-[90vh] xl:rounded-2xl xl:border xl:border-gray-200 xl:shadow-2xl xl:max-w-4xl"
        style={{
          width: isMobile ? '100%' : undefined,
          height: isMobile ? '100dvh' : undefined,
          maxHeight: isMobile ? '100dvh' : undefined,
          borderRadius: isMobile ? '0' : undefined
        }}
      >
        {/* Blue Header */}
        <div
          className="relative z-10 bg-gradient-to-r from-blue-600 to-blue-500 sm:px-6 flex items-center justify-between"
          style={{
            paddingTop: isMobile ? 'calc(env(safe-area-inset-top) + 16px)' : '18px',
            paddingBottom: isMobile ? '16px' : '18px',
            paddingLeft: isMobile ? '16px' : undefined,
            paddingRight: isMobile ? '16px' : undefined
          }}
        >
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <History className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white leading-tight">
                {t.withdrawals.title}
              </h2>
              <p className="text-[10px] sm:text-xs text-blue-100 mt-0.5">{t.withdrawals.subtitle}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-white/10 transition-colors active:scale-95 touch-manipulation"
          >
            <X className="w-4 h-4 text-white/90" />
          </button>
        </div>

        {message && (
          <div
            className={`sm:mx-6 sm:mt-4 p-3 sm:p-4 rounded-lg border ${
              message.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-red-50 border-red-200 text-red-700'
            } flex items-center gap-2`}
            style={{
              marginLeft: isMobile ? '16px' : undefined,
              marginRight: isMobile ? '16px' : undefined,
              marginTop: isMobile ? '12px' : undefined
            }}
          >
            {message.type === 'success' ? (
              <CheckCircle className="w-5 h-5 flex-shrink-0" />
            ) : (
              <XCircle className="w-5 h-5 flex-shrink-0" />
            )}
            <span className="text-xs sm:text-sm font-medium">{message.text}</span>
          </div>
        )}

        <div
          className="flex-1 overflow-y-auto sm:p-6"
          style={{
            WebkitOverflowScrolling: 'touch',
            paddingTop: isMobile ? '16px' : undefined,
            paddingBottom: isMobile ? 'calc(env(safe-area-inset-bottom) + 16px)' : undefined,
            paddingLeft: isMobile ? '12px' : undefined,
            paddingRight: isMobile ? '12px' : undefined
          }}
        >
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex items-center gap-2 text-gray-400">
                <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                <span className="text-sm">{t.withdrawals.loadingTransactions}</span>
              </div>
            </div>
          ) : records.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 sm:py-12 text-center">
              <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mb-4">
                <History className="w-8 h-8 text-blue-300" />
              </div>
              <p className="text-gray-700 text-base sm:text-lg font-medium">{t.withdrawals.noWithdrawals}</p>
              <p className="text-gray-400 text-xs sm:text-sm mt-1.5 sm:mt-2">{t.withdrawals.historyHint}</p>
            </div>
          ) : (
          <>
            <div className="space-y-2.5 sm:space-y-3">
              {pageItems.map((record) => {
                const isExpanded = expandedId === record.id;
                return (
                  <div
                    key={record.id}
                    className={`rounded-xl border overflow-hidden hover:shadow-md transition-all duration-200 ${getCardStyle(record)}`}
                  >
                    {/* Left accent bar + content */}
                    <div className="flex">
                      <div className={`w-1 sm:w-1.5 flex-shrink-0 ${getCardAccentBar(record)}`}></div>
                      <div className="flex-1">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : record.id)}
                          className="w-full p-3 sm:p-4 flex items-center justify-between text-left"
                        >
                          <div className="flex items-start sm:items-center gap-2.5 sm:gap-3 flex-1">
                            <div className="flex-shrink-0 mt-0.5 sm:mt-0 w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-white shadow-sm flex items-center justify-center">
                              {getStatusIcon(record)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 mb-0.5">
                                <span className="text-lg sm:text-xl font-bold text-gray-900">
                                  ${parseFloat(record.amount.toString()).toFixed(2)}
                                </span>
                                <span className={`px-2 py-0.5 rounded-md border text-[10px] sm:text-xs font-semibold w-fit ${getStatusBadgeStyle(record)}`}>
                                  {getStatusLabel(record)}
                                </span>
                              </div>
                              <div className="text-[10px] sm:text-xs text-gray-500">
                                {new Date(record.created_at).toLocaleString(dateLocale, {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </div>
                            </div>
                          </div>
                          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-white/80 shadow-sm flex items-center justify-center">
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4 text-gray-500" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-gray-500" />
                            )}
                          </div>
                        </button>

                        {isExpanded && record.type === 'withdrawal' && (() => {
                          const withdrawal = record.data as Withdrawal;
                          return (
                            <div className="px-3 sm:px-4 pb-3 sm:pb-4 pt-0 space-y-2 sm:space-y-3 border-t border-black/5">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 pt-3 sm:pt-4">
                                <div className="bg-white/70 rounded-lg p-2.5 sm:p-3">
                                  <div className="text-[10px] sm:text-xs text-gray-400 mb-1">{t.withdrawals.amount}</div>
                                  <div className="text-base sm:text-lg font-bold text-gray-900">
                                    ${parseFloat(withdrawal.amount.toString()).toFixed(2)}
                                  </div>
                                </div>
                                <div className="bg-white/70 rounded-lg p-2.5 sm:p-3">
                                  <div className="text-[10px] sm:text-xs text-gray-400 mb-1">{t.withdrawals.status}</div>
                                  <div className={`inline-flex px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-md border text-[10px] sm:text-xs font-semibold ${getStatusBadgeStyle(record)}`}>
                                    {getStatusLabel(record)}
                                  </div>
                                </div>
                                <div className="bg-white/70 rounded-lg p-2.5 sm:p-3">
                                  <div className="text-[10px] sm:text-xs text-gray-400 mb-1">{t.withdrawals.date}</div>
                                  <div className="text-xs sm:text-sm text-gray-700">
                                    {new Date(withdrawal.created_at).toLocaleString(dateLocale, {
                                      year: 'numeric',
                                      month: 'short',
                                      day: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </div>
                                </div>
                                {withdrawal.audited_at && (
                                  <div className="bg-white/70 rounded-lg p-2.5 sm:p-3">
                                    <div className={`text-[10px] sm:text-xs mb-1 ${
                                      withdrawal.status === 'approved' ? 'text-emerald-600' :
                                      withdrawal.status === 'rejected' ? 'text-red-600' :
                                      'text-gray-400'
                                    }`}>
                                      {withdrawal.status === 'approved' && t.withdrawals.approvedAt}
                                      {withdrawal.status === 'rejected' && t.withdrawals.rejectedAt}
                                      {withdrawal.status === 'cancelled' && t.withdrawals.cancelledAt}
                                      {!['approved', 'rejected', 'cancelled'].includes(withdrawal.status) && t.withdrawals.processedAt}
                                    </div>
                                    <div className={`text-xs sm:text-sm font-medium ${
                                      withdrawal.status === 'approved' ? 'text-emerald-700' :
                                      withdrawal.status === 'rejected' ? 'text-red-700' :
                                      'text-gray-700'
                                    }`}>
                                      {new Date(withdrawal.audited_at).toLocaleString(dateLocale, {
                                        year: 'numeric',
                                        month: 'short',
                                        day: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>

                              {withdrawal.status === 'approved' && (
                                <div className="bg-white border border-emerald-200 rounded-lg p-3 sm:p-4">
                                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-0 mb-2">
                                    <div className="flex items-center gap-2 text-emerald-700">
                                      <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5" />
                                      <span className="text-sm sm:text-base font-semibold">{t.withdrawals.withdrawalApproved}</span>
                                    </div>
                                    {withdrawal.audited_at && (
                                      <div className="text-[10px] sm:text-xs text-emerald-500 sm:text-right">
                                        {new Date(withdrawal.audited_at).toLocaleString(dateLocale, {
                                          month: 'short',
                                          day: 'numeric',
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        })}
                                      </div>
                                    )}
                                  </div>
                                  <p className="text-xs sm:text-sm text-emerald-600">
                                    {t.withdrawals.withdrawalApprovedMsg}
                                  </p>
                                  {withdrawal.audit_remark && (
                                    <div className="mt-2 sm:mt-3 pt-2 sm:pt-3 border-t border-emerald-100">
                                      <div className="text-[10px] sm:text-xs text-emerald-500 mb-1">{t.withdrawals.adminNote}</div>
                                      <div className="text-xs sm:text-sm text-emerald-700">{withdrawal.audit_remark === 'Cancelled by user' ? t.withdrawals.cancelledByUser : withdrawal.audit_remark}</div>
                                    </div>
                                  )}
                                </div>
                              )}

                              {withdrawal.status === 'rejected' && (
                                <div className="bg-white border border-red-200 rounded-lg p-3 sm:p-4">
                                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-0 mb-2">
                                    <div className="flex items-center gap-2 text-red-700">
                                      <XCircle className="w-4 h-4 sm:w-5 sm:h-5" />
                                      <span className="text-sm sm:text-base font-semibold">{t.withdrawals.withdrawalRejected}</span>
                                    </div>
                                    {withdrawal.audited_at && (
                                      <div className="text-xs text-red-400">
                                        {new Date(withdrawal.audited_at).toLocaleString(dateLocale, {
                                          month: 'short',
                                          day: 'numeric',
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        })}
                                      </div>
                                    )}
                                  </div>
                                  {withdrawal.audit_remark ? (
                                    <div>
                                      <div className="text-[10px] sm:text-xs text-red-400 mb-1">{t.withdrawals.rejectionReason}</div>
                                      <div className="text-xs sm:text-sm text-red-700">{withdrawal.audit_remark === 'Cancelled by user' ? t.withdrawals.cancelledByUser : withdrawal.audit_remark}</div>
                                    </div>
                                  ) : (
                                    <p className="text-xs sm:text-sm text-red-600">
                                      {t.withdrawals.rejectedContactSupport}
                                    </p>
                                  )}
                                </div>
                              )}

                              {withdrawal.status === 'pending' && (
                                <div className="space-y-2 sm:space-y-3">
                                  <div className="bg-white border border-amber-200 rounded-lg p-3 sm:p-4">
                                    <div className="flex items-center gap-2 text-amber-700 mb-2">
                                      <Clock className="w-4 h-4 sm:w-5 sm:h-5" />
                                      <span className="text-sm sm:text-base font-semibold">{t.withdrawals.underReview}</span>
                                    </div>
                                    <p className="text-xs sm:text-sm text-amber-600">
                                      {t.withdrawals.underReviewMsg}
                                    </p>
                                  </div>
                                  <button
                                    onClick={() => handleCancelWithdrawal(withdrawal.id)}
                                    disabled={cancelling === withdrawal.id}
                                    className="w-full bg-white hover:bg-red-50 border border-red-200 hover:border-red-300 text-red-600 hover:text-red-700 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                  >
                                    <XCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                                    {cancelling === withdrawal.id ? t.withdrawals.cancelling : t.withdrawals.cancelWithdrawal}
                                  </button>
                                </div>
                              )}

                              {withdrawal.status === 'cancelled' && (
                                <div className="bg-white border border-gray-200 rounded-lg p-3 sm:p-4">
                                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-0 mb-2">
                                    <div className="flex items-center gap-2 text-gray-600">
                                      <XCircle className="w-4 h-4 sm:w-5 sm:h-5" />
                                      <span className="text-sm sm:text-base font-semibold">{t.withdrawals.withdrawalCancelled}</span>
                                    </div>
                                    {withdrawal.audited_at && (
                                      <div className="text-xs text-gray-400">
                                        {new Date(withdrawal.audited_at).toLocaleString(dateLocale, {
                                          month: 'short',
                                          day: 'numeric',
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        })}
                                      </div>
                                    )}
                                  </div>
                                  {withdrawal.audit_remark ? (
                                    <div>
                                      <div className="text-[10px] sm:text-xs text-gray-400 mb-1">{t.withdrawals.reason}</div>
                                      <div className="text-xs sm:text-sm text-gray-600">{withdrawal.audit_remark === 'Cancelled by user' ? t.withdrawals.cancelledByUser : withdrawal.audit_remark}</div>
                                    </div>
                                  ) : (
                                    <p className="text-xs sm:text-sm text-gray-500">
                                      {t.withdrawals.cancelledMsg}
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {isExpanded && record.type === 'adjustment' && (() => {
                          const transaction = record.data as WalletTransaction;
                          const isAdd = parseFloat(transaction.amount.toString()) > 0;
                          return (
                            <div className="px-3 sm:px-4 pb-3 sm:pb-4 pt-0 space-y-2 sm:space-y-3 border-t border-black/5">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 pt-3 sm:pt-4">
                                <div className="bg-white/70 rounded-lg p-2.5 sm:p-3">
                                  <div className="text-[10px] sm:text-xs text-gray-400 mb-1">{t.withdrawals.transactionType}</div>
                                  <div className={`inline-flex items-center gap-1 sm:gap-1.5 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-md border text-[10px] sm:text-xs font-semibold ${getStatusBadgeStyle(record)}`}>
                                    {isAdd ? <TrendingUp className="w-3 h-3 sm:w-3.5 sm:h-3.5" /> : <TrendingDown className="w-3 h-3 sm:w-3.5 sm:h-3.5" />}
                                    {isAdd ? t.withdrawals.balanceAdded : t.withdrawals.balanceDeducted}
                                  </div>
                                </div>
                                <div className="bg-white/70 rounded-lg p-2.5 sm:p-3">
                                  <div className="text-[10px] sm:text-xs text-gray-400 mb-1">{t.withdrawals.amount}</div>
                                  <div className={`text-base sm:text-lg font-bold ${isAdd ? 'text-emerald-600' : 'text-red-600'}`}>
                                    {isAdd ? '+' : ''}${Math.abs(parseFloat(transaction.amount.toString())).toFixed(2)}
                                  </div>
                                </div>
                                <div className="bg-white/70 rounded-lg p-2.5 sm:p-3">
                                  <div className="text-[10px] sm:text-xs text-gray-400 mb-1">{t.withdrawals.balanceBefore}</div>
                                  <div className="text-xs sm:text-sm text-gray-700">
                                    ${parseFloat(transaction.balance_before.toString()).toFixed(2)}
                                  </div>
                                </div>
                                <div className="bg-white/70 rounded-lg p-2.5 sm:p-3">
                                  <div className="text-[10px] sm:text-xs text-gray-400 mb-1">{t.withdrawals.balanceAfter}</div>
                                  <div className="text-xs sm:text-sm text-gray-700">
                                    ${parseFloat(transaction.balance_after.toString()).toFixed(2)}
                                  </div>
                                </div>
                                <div className="col-span-1 sm:col-span-2 bg-white/70 rounded-lg p-2.5 sm:p-3">
                                  <div className="text-[10px] sm:text-xs text-gray-400 mb-1">{t.withdrawals.transactionTime}</div>
                                  <div className="text-xs sm:text-sm text-gray-700">
                                    {new Date(transaction.created_at).toLocaleString(dateLocale, {
                                      year: 'numeric',
                                      month: 'short',
                                      day: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </div>
                                </div>
                              </div>

                              {transaction.remarks && (
                                <div className={`bg-white border ${isAdd ? 'border-emerald-200' : 'border-red-200'} rounded-lg p-3 sm:p-4`}>
                                  <div className="flex items-center gap-2 mb-2">
                                    <DollarSign className={`w-4 h-4 sm:w-5 sm:h-5 ${isAdd ? 'text-emerald-600' : 'text-red-600'}`} />
                                    <span className={`text-sm sm:text-base font-semibold ${isAdd ? 'text-emerald-700' : 'text-red-700'}`}>
                                      {t.withdrawals.financialAdjustment}
                                    </span>
                                  </div>
                                  <div className="text-[10px] sm:text-xs text-gray-400 mb-1">{t.withdrawals.remarks}</div>
                                  <div className={`text-xs sm:text-sm ${isAdd ? 'text-emerald-700' : 'text-red-700'}`}>
                                    {transaction.remarks}
                                  </div>
                                </div>
                              )}

                              {!transaction.remarks && (
                                <div className={`bg-white border ${isAdd ? 'border-emerald-200' : 'border-red-200'} rounded-lg p-3 sm:p-4`}>
                                  <div className="flex items-center gap-2">
                                    <DollarSign className={`w-4 h-4 sm:w-5 sm:h-5 ${isAdd ? 'text-emerald-600' : 'text-red-600'}`} />
                                    <p className={`text-xs sm:text-sm ${isAdd ? 'text-emerald-600' : 'text-red-600'}`}>
                                      {isAdd
                                        ? t.withdrawals.adminAddedFunds
                                        : t.withdrawals.adminDeductedFunds
                                      }
                                    </p>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 px-1">
                <button
                  onClick={goPrev}
                  disabled={!hasPrev}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-100 border border-gray-200 text-xs font-medium text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-200 transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Prev</span>
                </button>
                <span className="text-xs text-gray-500 font-medium">
                  {page + 1} / {totalPages}
                  <span className="text-gray-400 ml-1.5">({totalItems})</span>
                </span>
                <button
                  onClick={goNext}
                  disabled={!hasNext}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-100 border border-gray-200 text-xs font-medium text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-200 transition-colors"
                >
                  <span className="hidden sm:inline">Next</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </>
          )}
        </div>

        {/* Mobile Close Button */}
        {isMobile && (
        <div className="relative border-t border-gray-200 px-4 py-4 bg-white" style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
          <button
            onClick={handleClose}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3.5 px-4 rounded-xl text-sm font-semibold transition-colors min-h-[48px] active:scale-95 touch-manipulation flex items-center justify-center gap-2"
          >
            <X className="w-4 h-4" />
            {t.common.close}
          </button>
        </div>
        )}

        {/* Desktop Close Button */}
        {!isMobile && (
        <div className="relative border-t border-gray-200 px-4 sm:px-6 py-4 sm:py-5 bg-white">
          <button
            onClick={handleClose}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 sm:py-2.5 rounded-lg font-semibold transition-colors min-h-[44px] active:scale-[0.98] text-sm sm:text-base"
          >
            {t.common.close}
          </button>
        </div>
        )}
      </div>
    </div>,
    document.body
  );
}
