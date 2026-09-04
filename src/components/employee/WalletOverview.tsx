import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Wallet as WalletIcon, DollarSign, Lock, TrendingUp, AlertCircle, Send, Clock, History } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Wallet, Employee, AdminConfig, VerificationRequest } from '../../types';
import VerificationForm from './VerificationForm';
import WithdrawalHistory from './WithdrawalHistory';
import { useDeviceOptimization } from '../../lib/useDeviceOptimization';
import { useCurrencyUnit } from '../../lib/useCurrencyUnit';
import { useLanguage } from '../../lib/i18n';

interface WalletOverviewProps {
  employeeId: string;
  employee: Employee;
  onWithdrawalHistoryChange?: (show: boolean) => void;
}

export default function WalletOverview({ employeeId, employee, onWithdrawalHistoryChange }: WalletOverviewProps) {
  const { t, dateLocale } = useLanguage();
  const currencyUnit = useCurrencyUnit(employee.created_by);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showWithdrawalForm, setShowWithdrawalForm] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showVerificationForm, setShowVerificationForm] = useState(false);
  const [showWithdrawalHistory, setShowWithdrawalHistory] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [localEmployee, setLocalEmployee] = useState(employee);
  const [verificationRequest, setVerificationRequest] = useState<VerificationRequest | null>(null);
  const [checkingEligibility, setCheckingEligibility] = useState(false);
  const { deviceType } = useDeviceOptimization();

  const isTabletDevice = deviceType === 'tablet';

  // Format large numbers to K/M format
  const formatAmount = (amount: number) => {
    if (amount >= 1000000) {
      return (amount / 1000000).toFixed(1) + 'M';
    } else if (amount >= 1000) {
      return (amount / 1000).toFixed(1) + 'K';
    }
    return amount.toFixed(2);
  };

  // Dynamic font size calculation for tablet to prevent overflow
  const getTabletFontSize = (amount: number) => {
    const formattedValue = amount.toFixed(2);
    const length = formattedValue.length;

    // Base size for tablet
    let fontSize = '1.5rem'; // 24px base

    if (length <= 6) {
      fontSize = '1.5rem'; // 24px
    } else if (length <= 8) {
      fontSize = '1.25rem'; // 20px
    } else if (length <= 10) {
      fontSize = '1.125rem'; // 18px
    } else {
      fontSize = '1rem'; // 16px
    }

    return fontSize;
  };

  useEffect(() => {
    loadWallet();
    loadEmployeeData();
    loadVerificationRequest();

    // Set up real-time subscription for employee verification status changes
    const userChannel = supabase
      .channel(`user-verification-${employeeId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${employeeId}` },
        (payload) => {
          console.log('Employee data changed:', payload);
          if (payload.new) {
            setLocalEmployee(payload.new as Employee);
          }
        }
      )
      .subscribe();

    // Set up real-time subscription for verification request changes
    const verificationChannel = supabase
      .channel(`verification-request-${employeeId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'verification_requests', filter: `user_id=eq.${employeeId}` },
        (payload) => {
          console.log('Verification request changed:', payload);
          // If verification request was deleted, set to null
          if (payload.eventType === 'DELETE') {
            setVerificationRequest(null);
          } else {
            loadVerificationRequest();
          }
        }
      )
      .subscribe();

    // Set up real-time subscription for wallet changes
    const walletChannel = supabase
      .channel(`wallet-${employeeId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'wallets', filter: `user_id=eq.${employeeId}` },
        (payload) => {
          console.log('Wallet changed:', payload);
          if (payload.new) {
            setWallet(payload.new as Wallet);
          }
        }
      )
      .subscribe();

    // Listen for new wallet transactions (tips, commissions, admin adjustments)
    // This provides a second signal to refresh wallet data immediately
    const txChannel = supabase
      .channel(`wallet-tx-${employeeId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'wallet_transactions', filter: `user_id=eq.${employeeId}` },
        () => {
          loadWallet();
        }
      )
      .subscribe();

    // Fallback polling for redundancy
    const interval = setInterval(() => {
      loadWallet();
      loadEmployeeData();
      loadVerificationRequest();
    }, 15000);

    return () => {
      supabase.removeChannel(userChannel);
      supabase.removeChannel(verificationChannel);
      supabase.removeChannel(walletChannel);
      supabase.removeChannel(txChannel);
      clearInterval(interval);
    };
  }, [employeeId]);

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  useEffect(() => {
    if (showConfirmModal) {
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
    }
  }, [showConfirmModal]);

  const loadEmployeeData = async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', employeeId)
        .single();

      if (error) throw error;
      if (data) {
        setLocalEmployee(data);
      }
    } catch (error) {
      console.error('Error loading employee data:', error);
    }
  };

  const loadVerificationRequest = async () => {
    try {
      const { data, error } = await supabase
        .from('verification_requests')
        .select('*')
        .eq('user_id', employeeId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      setVerificationRequest(data);
    } catch (error) {
      console.error('Error loading verification request:', error);
    }
  };

  const loadWallet = async () => {
    try {
      let { data: walletData, error: walletError } = await supabase
        .from('wallets')
        .select('*')
        .eq('user_id', employeeId)
        .maybeSingle();

      if (walletError) throw walletError;

      if (!walletData) {
        const { data: newWallet, error: createError } = await supabase
          .from('wallets')
          .insert({ user_id: employeeId })
          .select()
          .single();

        if (createError) throw createError;
        walletData = newWallet;
      }

      setWallet(walletData);
    } catch (error) {
      console.error('Error loading wallet:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleVerificationComplete = () => {
    setShowVerificationForm(false);
    loadEmployeeData();
    loadVerificationRequest();
  };

  useEffect(() => {
    if (verificationRequest?.status === 'rejected') {
      setShowVerificationForm(false);
    }
  }, [verificationRequest]);

  const checkWithdrawalEligibility = async () => {
    console.log('Starting withdrawal eligibility check...');
    console.log('Employee verified:', localEmployee.is_verified);
    console.log('Wallet balance:', wallet?.available_balance);
    console.log('Employee created_by:', localEmployee.created_by);

    if (!localEmployee.is_verified) {
      return { eligible: false, message: t.wallet.verificationNeeded };
    }

    if (!wallet || wallet.available_balance <= 0) {
      return { eligible: false, message: t.wallet.insufficientBalance };
    }

    const { data: adminConfigs, error: configError } = await supabase
      .from('admin_configs')
      .select('*')
      .or(`admin_id.eq.${localEmployee.created_by},admin_id.is.null`);

    console.log('Admin configs query error:', configError);
    console.log('Admin configs data:', adminConfigs);

    const configs = adminConfigs || [];

    const getConfigValue = (type: string) => {
      const adminConfig = configs.find(c => c.admin_id === localEmployee.created_by && c.config_type === type);
      const globalConfig = configs.find(c => c.admin_id === null && c.config_type === type);
      const value = adminConfig?.config_value || globalConfig?.config_value;
      console.log(`Config ${type}: admin=${adminConfig?.config_value}, global=${globalConfig?.config_value}, final=${value}`);
      return value;
    };

    const amountThreshold = parseFloat(getConfigValue('withdrawal_amount_threshold') || '100');
    const ordersThreshold = parseInt(getConfigValue('withdrawal_days_threshold') || '1000');
    const conditionMode = (getConfigValue('withdrawal_condition_mode') || 'OR').toUpperCase();

    console.log('Amount threshold:', amountThreshold);
    console.log('Orders threshold:', ordersThreshold);
    console.log('Condition mode:', conditionMode);
    console.log('Current balance:', wallet.available_balance);

    const amountMet = wallet.available_balance >= amountThreshold;
    let ordersMet = false;
    let completedOrdersCount = 0;

    // Get the total number of orders for this user
    try {
      const { data: ordersData, error: ordersError } = await supabase.rpc('get_user_completed_orders_count', {
        p_user_id: employeeId
      });

      if (ordersError) {
        console.error('Error getting orders count:', ordersError);
      } else {
        completedOrdersCount = ordersData || 0;
        ordersMet = completedOrdersCount >= ordersThreshold;
        console.log('Completed orders count:', completedOrdersCount);
        console.log('Orders threshold:', ordersThreshold);
      }
    } catch (error) {
      console.error('Failed to get orders count:', error);
    }

    console.log('Amount met:', amountMet);
    console.log('Orders met:', ordersMet);

    let eligible = false;
    let message = '';

    switch (conditionMode) {
      case 'AMOUNT_ONLY':
        eligible = amountMet;
        if (!eligible) {
          message = t.wallet.eligibilityAmountOnly(String(amountThreshold), wallet.available_balance.toFixed(2));
        }
        break;

      case 'DAYS_ONLY':
        eligible = ordersMet;
        if (!eligible) {
          message = t.wallet.eligibilityDaysOnly(ordersThreshold, completedOrdersCount);
        }
        break;

      case 'AND':
      case 'BOTH':
        eligible = amountMet && ordersMet;
        if (!eligible) {
          const reasons = [];
          if (!amountMet) {
            reasons.push(t.wallet.eligibilityBalanceReason(String(amountThreshold), wallet.available_balance.toFixed(2)));
          }
          if (!ordersMet) {
            reasons.push(t.wallet.eligibilityOrdersReason(ordersThreshold, completedOrdersCount));
          }
          message = t.wallet.eligibilityBothPrefix + reasons.join(t.wallet.eligibilityAnd);
        }
        break;

      case 'OR':
      case 'EITHER':
      default:
        eligible = amountMet || ordersMet;
        if (!eligible) {
          message = t.wallet.eligibilityEitherPrefix + t.wallet.eligibilityBalanceReason(String(amountThreshold), wallet.available_balance.toFixed(2)) + t.wallet.eligibilityOr + t.wallet.eligibilityOrdersReason(ordersThreshold, completedOrdersCount);
        }
        break;
    }

    console.log(eligible ? '✓ Eligible' : '✗ Not eligible');
    return { eligible, message };
  };

  const handleRequestWithdrawal = async () => {
    console.log('handleRequestWithdrawal called');
    setMessage(null);
    setCheckingEligibility(true);

    try {
      const eligibility = await checkWithdrawalEligibility();
      console.log('Eligibility check result:', eligibility);

      if (!eligibility.eligible) {
        setMessage({ type: 'error', text: eligibility.message });
        setCheckingEligibility(false);
        return;
      }

      // Add a small delay for better visual effect
      await new Promise(resolve => setTimeout(resolve, 300));
      setShowWithdrawalForm(true);
      setCheckingEligibility(false);
    } catch (error) {
      console.error('Error in handleRequestWithdrawal:', error);
      setMessage({ type: 'error', text: t.wallet.eligibilityFailed });
      setCheckingEligibility(false);
    }
  };

  const handleConfirmWithdrawal = async () => {
    if (submitting) return;

    console.log('handleConfirmWithdrawal called');
    setMessage(null);
    setSubmitting(true);

    try {
      // Re-check eligibility to prevent race conditions
      const eligibility = await checkWithdrawalEligibility();
      console.log('Final eligibility check:', eligibility);

      if (!eligibility.eligible) {
        setMessage({ type: 'error', text: eligibility.message });
        setShowConfirmModal(false);
        setShowWithdrawalForm(false);
        setSubmitting(false);
        return;
      }

      if (!wallet || wallet.available_balance <= 0) {
        setMessage({ type: 'error', text: t.wallet.insufficientBalanceError });
        setShowConfirmModal(false);
        setShowWithdrawalForm(false);
        setSubmitting(false);
        return;
      }

      const amount = wallet.available_balance;
      const newFrozen = wallet.frozen_balance + amount;

      console.log('Creating withdrawal request first (before updating wallet)...');

      // Insert withdrawal record FIRST (RLS checks available_balance > 0)
      const { error: insertError } = await supabase.from('withdrawals').insert({
        user_id: employeeId,
        amount: amount,
        status: 'pending',
      });

      if (insertError) {
        console.error('Withdrawal insert error:', insertError);
        throw insertError;
      }

      console.log('Withdrawal created, now freezing funds in wallet...');

      // Then update wallet to freeze the funds
      const { error: updateError } = await supabase.from('wallets').update({
        available_balance: 0,
        frozen_balance: newFrozen,
      }).eq('user_id', employeeId);

      if (updateError) {
        console.error('Wallet update error:', updateError);
        // Rollback: delete the withdrawal record we just created
        await supabase.from('withdrawals')
          .delete()
          .eq('user_id', employeeId)
          .eq('amount', amount)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(1);
        throw updateError;
      }

      console.log('Withdrawal submitted successfully');
      setMessage({ type: 'success', text: t.wallet.withdrawalSuccess });
      setShowConfirmModal(false);

      // Reset form after short delay to show success message
      setTimeout(() => {
        setShowWithdrawalForm(false);
      }, 3000);

      loadWallet();
    } catch (error: any) {
      console.error('Error in handleConfirmWithdrawal:', error);
      setMessage({ type: 'error', text: t.wallet.withdrawalRequestFailed(error.message || t.wallet.unknownError) });
      setShowConfirmModal(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-blue-200 p-8 text-center shadow-sm">
        <div className="text-gray-500">{t.common.loading}</div>
      </div>
    );
  }

  const totalAssets = (wallet?.available_balance || 0) + (wallet?.frozen_balance || 0);

  return (
    <div className="space-y-4 sm:space-y-6 pt-2 sm:pt-0">
      {!localEmployee.is_verified && showVerificationForm && (
        <VerificationForm
          employeeId={employeeId}
          onVerificationComplete={handleVerificationComplete}
          existingRequest={verificationRequest?.status === 'rejected' ? {
            id: verificationRequest.id,
            real_name: verificationRequest.real_name,
            wallet_address: verificationRequest.wallet_address,
            phone: verificationRequest.phone,
            email: verificationRequest.email,
          } : null}
        />
      )}

      {localEmployee.is_verified && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-emerald-700 font-medium mb-1 text-sm sm:text-base">{t.wallet.verificationComplete}</h3>
            <p className="text-emerald-600/80 text-xs sm:text-sm">
              {t.wallet.verificationMotivation}
            </p>
          </div>
        </div>
      )}

      {!localEmployee.is_verified && verificationRequest?.status === 'pending' && !verificationRequest.audited_at && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
          <Clock className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-blue-700 font-medium mb-1 text-sm sm:text-base">{t.wallet.verificationUnderReview}</h3>
            <p className="text-blue-600 text-xs sm:text-sm mb-2">
              {t.wallet.verificationReviewMsg}
            </p>
            <div className="text-xs text-blue-600">
              {t.wallet.submitted}: {new Date(verificationRequest.created_at).toLocaleString(dateLocale)}
            </div>
          </div>
        </div>
      )}

      {!localEmployee.is_verified && verificationRequest?.status === 'pending' && verificationRequest.audited_at && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-amber-700 font-medium mb-1 text-sm sm:text-base">{t.wallet.verificationReset}</h3>
            <p className="text-amber-600 text-xs sm:text-sm mb-3">
              {t.wallet.verificationResetMsg}
            </p>
            {verificationRequest.audit_remark && (
              <div className="bg-amber-100 border border-amber-300 rounded-lg p-3 mb-3">
                <div className="text-xs text-amber-600 mb-1">{t.wallet.previousNote}:</div>
                <div className="text-sm text-amber-800">{verificationRequest.audit_remark}</div>
              </div>
            )}
            <button
              onClick={() => setShowVerificationForm(true)}
              className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all"
            >
              {t.wallet.resubmitVerification}
            </button>
          </div>
        </div>
      )}

      {!localEmployee.is_verified && verificationRequest?.status === 'rejected' && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-red-700 font-medium mb-1 text-sm sm:text-base">{t.wallet.verificationRejected}</h3>
            <p className="text-red-600 text-xs sm:text-sm mb-3">
              {t.wallet.verificationRejectedMsg}
            </p>
            {verificationRequest.audit_remark && (
              <div className="bg-red-100 border border-red-300 rounded-lg p-3 mb-3">
                <div className="text-xs text-red-600 mb-1">{t.wallet.rejectionReason}:</div>
                <div className="text-sm text-red-800">{verificationRequest.audit_remark}</div>
              </div>
            )}
            <button
              onClick={() => setShowVerificationForm(true)}
              className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all"
            >
              {t.wallet.supplementResubmit}
            </button>
          </div>
        </div>
      )}

      {!localEmployee.is_verified && !verificationRequest && !showVerificationForm && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-amber-700 font-medium mb-1 text-sm sm:text-base">{t.wallet.verificationRequired}</h3>
            <p className="text-amber-600 text-xs sm:text-sm mb-3">
              {t.wallet.verificationRequiredMsg}
            </p>
            <button
              onClick={() => setShowVerificationForm(true)}
              className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all"
            >
              {t.wallet.startVerification}
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes gradientShift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }

        @keyframes floatParticle {
          0% {
            transform: translate(0, 0) scale(0);
            opacity: 0;
          }
          20% { opacity: 1; }
          80% { opacity: 1; }
          100% {
            transform: translate(var(--tx), var(--ty)) scale(1);
            opacity: 0;
          }
        }

        @keyframes bounceIn {
          0% {
            transform: scale(0) translateY(50px);
            opacity: 0;
          }
          60% {
            transform: scale(1.1) translateY(0);
            opacity: 1;
          }
          100% {
            transform: scale(1) translateY(0);
            opacity: 1;
          }
        }

        @keyframes coinDrop {
          0%, 100% {
            transform: translateY(0) rotate(0deg);
          }
          50% {
            transform: translateY(8px) rotate(180deg);
          }
        }

        @keyframes scaleUp {
          0% {
            transform: scaleX(0);
            opacity: 0;
          }
          100% {
            transform: scaleX(1);
            opacity: 1;
          }
        }

        @keyframes twinkle {
          0%, 100% {
            opacity: 0.3;
            transform: scale(1);
          }
          50% {
            opacity: 1;
            transform: scale(1.5);
          }
        }

        @keyframes secureFlash {
          0%, 100% {
            opacity: 0.4;
            transform: scale(1);
          }
          50% {
            opacity: 1;
            transform: scale(1.3);
          }
        }

        @keyframes successGlow {
          0%, 100% {
            opacity: 0.5;
            transform: scale(1);
          }
          50% {
            opacity: 1;
            transform: scale(1.4);
          }
        }

        @keyframes twinkleGold {
          0%, 100% {
            opacity: 0.4;
            transform: scale(1);
          }
          50% {
            opacity: 1;
            transform: scale(1.5);
          }
        }

        @keyframes coinFloat {
          0%, 100% {
            transform: translateY(0) rotate(0deg);
          }
          50% {
            transform: translateY(-10px) rotate(180deg);
          }
        }

        @keyframes flyCoins {
          0% {
            transform: translateX(0) translateY(0) rotate(0deg);
            opacity: 0;
          }
          20% {
            opacity: 0.8;
          }
          80% {
            opacity: 0.8;
          }
          100% {
            transform: translateX(calc(100vw - 100%)) translateY(-30px) rotate(720deg);
            opacity: 0;
          }
        }

        @keyframes miniCoinOrbit {
          0%, 100% {
            transform: translate(0, 0) scale(1);
            opacity: 0.6;
          }
          50% {
            transform: translate(-8px, -8px) scale(1.2);
            opacity: 1;
          }
        }

        @keyframes glowPulse {
          0%, 100% {
            opacity: 0.5;
            filter: blur(8px);
          }
          50% {
            opacity: 1;
            filter: blur(12px);
          }
        }

        @keyframes ripple {
          0% {
            transform: scale(0.8);
            opacity: 1;
          }
          100% {
            transform: scale(2);
            opacity: 0;
          }
        }

        @keyframes rotate3d {
          from { transform: rotateY(0deg) rotateX(5deg); }
          to { transform: rotateY(360deg) rotateX(5deg); }
        }

        @keyframes circuitFlow {
          0% {
            background-position: 0% 0%;
            opacity: 0.2;
          }
          50% {
            opacity: 0.4;
          }
          100% {
            background-position: 100% 100%;
            opacity: 0.2;
          }
        }

        @keyframes hexPulse {
          0%, 100% {
            opacity: 0.05;
            transform: scale(1);
          }
          50% {
            opacity: 0.15;
            transform: scale(1.05);
          }
        }

        @keyframes dataFlow {
          0% {
            transform: translateY(-100%);
            opacity: 0;
          }
          10% {
            opacity: 0.6;
          }
          90% {
            opacity: 0.6;
          }
          100% {
            transform: translateY(200%);
            opacity: 0;
          }
        }

        @keyframes orbFloat {
          0%, 100% {
            transform: translate(0, 0) scale(1);
          }
          33% {
            transform: translate(10px, -10px) scale(1.1);
          }
          66% {
            transform: translate(-10px, 10px) scale(0.9);
          }
        }

        @keyframes nodePulse {
          0%, 100% {
            transform: scale(1);
            box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7);
          }
          50% {
            transform: scale(1.2);
            box-shadow: 0 0 0 8px rgba(59, 130, 246, 0);
          }
        }

        @keyframes lineFlow {
          0% {
            stroke-dashoffset: 1000;
            opacity: 0.2;
          }
          50% {
            opacity: 0.8;
          }
          100% {
            stroke-dashoffset: 0;
            opacity: 0.2;
          }
        }

        @keyframes scanMove {
          0% {
            top: -100%;
            opacity: 0;
          }
          10% {
            opacity: 0.6;
          }
          90% {
            opacity: 0.6;
          }
          100% {
            top: 200%;
            opacity: 0;
          }
        }

        .crypto-card {
          position: relative;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.1);
          transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .crypto-card:hover {
          transform: translateY(-4px) scale(1.02);
          border-color: rgba(255, 255, 255, 0.2);
        }

        .crypto-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: inherit;
          filter: brightness(1.1);
          opacity: 0;
          transition: opacity 0.4s ease;
        }

        .crypto-card:hover::before {
          opacity: 1;
        }

        .card-blue {
          background: linear-gradient(135deg,
            rgba(99, 102, 241, 0.15) 0%,
            rgba(59, 130, 246, 0.1) 50%,
            rgba(14, 165, 233, 0.15) 100%);
          background-size: 200% 200%;
          animation: gradientShift 8s ease infinite;
        }

        .card-green {
          background: linear-gradient(135deg,
            rgba(16, 185, 129, 0.15) 0%,
            rgba(5, 150, 105, 0.1) 50%,
            rgba(6, 182, 212, 0.15) 100%);
          background-size: 200% 200%;
          animation: gradientShift 8s ease infinite;
          animation-delay: 2s;
        }

        .card-orange {
          background: linear-gradient(135deg,
            rgba(251, 146, 60, 0.15) 0%,
            rgba(249, 115, 22, 0.1) 50%,
            rgba(234, 88, 12, 0.15) 100%);
          background-size: 200% 200%;
          animation: gradientShift 8s ease infinite;
          animation-delay: 4s;
        }

        .card-purple {
          background: linear-gradient(135deg,
            rgba(168, 85, 247, 0.15) 0%,
            rgba(147, 51, 234, 0.1) 50%,
            rgba(126, 34, 206, 0.15) 100%);
          background-size: 200% 200%;
          animation: gradientShift 8s ease infinite;
          animation-delay: 6s;
        }

        .glow-orb {
          position: absolute;
          border-radius: 50%;
          animation: glowPulse 3s ease-in-out infinite;
          pointer-events: none;
        }

        .particle {
          position: absolute;
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: currentColor;
          animation: floatParticle 4s ease-in-out infinite;
          pointer-events: none;
        }

        .ripple-effect {
          position: absolute;
          border-radius: 50%;
          border: 2px solid currentColor;
          animation: ripple 3s ease-out infinite;
          pointer-events: none;
        }

        .mesh-gradient {
          position: absolute;
          inset: -50%;
          opacity: 0.3;
          filter: blur(40px);
          background: radial-gradient(circle at center, currentColor 0%, transparent 70%);
          animation: rotate3d 20s linear infinite;
          pointer-events: none;
        }

        .icon-glow {
          filter: drop-shadow(0 0 8px currentColor);
        }

        .number-glow {
          text-shadow: 0 0 20px currentColor, 0 0 40px currentColor;
        }

        .glass-panel {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.05);
        }

        /* Withdraw Funds Panel Styles */
        .withdraw-funds-panel {
          position: relative;
        }

        .blockchain-circuit {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(90deg, rgba(6, 182, 212, 0.12) 1px, transparent 1px),
            linear-gradient(rgba(6, 182, 212, 0.12) 1px, transparent 1px),
            linear-gradient(90deg, rgba(14, 165, 233, 0.08) 1px, transparent 1px),
            linear-gradient(rgba(14, 165, 233, 0.08) 1px, transparent 1px);
          background-size: 40px 40px, 40px 40px, 8px 8px, 8px 8px;
          animation: circuitFlow 15s linear infinite;
          pointer-events: none;
          z-index: 0;
        }

        .hex-grid {
          position: absolute;
          inset: 0;
          background-image:
            radial-gradient(circle, rgba(59, 130, 246, 0.1) 1px, transparent 1px);
          background-size: 30px 30px;
          animation: hexPulse 4s ease-in-out infinite;
          pointer-events: none;
          z-index: 0;
        }

        .data-stream {
          position: absolute;
          width: 2px;
          height: 100px;
          background: linear-gradient(to bottom,
            transparent,
            rgba(59, 130, 246, 0.8),
            rgba(6, 182, 212, 0.8),
            transparent);
          animation: dataFlow 3s ease-in-out infinite;
          pointer-events: none;
          z-index: 1;
        }

        .data-stream-1 {
          left: 15%;
          animation-delay: 0s;
        }

        .data-stream-2 {
          left: 50%;
          animation-delay: 1s;
        }

        .data-stream-3 {
          left: 85%;
          animation-delay: 2s;
        }

        .tech-orb {
          position: absolute;
          border-radius: 50%;
          background: radial-gradient(circle,
            rgba(59, 130, 246, 0.4) 0%,
            rgba(6, 182, 212, 0.2) 50%,
            transparent 100%);
          filter: blur(20px);
          animation: orbFloat 8s ease-in-out infinite;
          pointer-events: none;
          z-index: 1;
        }

        .tech-orb-1 {
          width: 150px;
          height: 150px;
          top: -50px;
          right: -50px;
          animation-delay: 0s;
        }

        .tech-orb-2 {
          width: 120px;
          height: 120px;
          bottom: -40px;
          left: -40px;
          animation-delay: 2.5s;
        }

        .tech-orb-3 {
          width: 100px;
          height: 100px;
          top: 50%;
          left: 50%;
          margin-left: -50px;
          margin-top: -50px;
          animation-delay: 5s;
        }

        .blockchain-node {
          position: absolute;
          width: 8px;
          height: 8px;
          background: rgba(59, 130, 246, 0.8);
          border-radius: 50%;
          animation: nodePulse 2s ease-in-out infinite;
          pointer-events: none;
          z-index: 2;
        }

        .node-1 {
          top: 20%;
          left: 20%;
          animation-delay: 0s;
        }

        .node-2 {
          top: 30%;
          right: 25%;
          animation-delay: 0.5s;
        }

        .node-3 {
          bottom: 25%;
          left: 30%;
          animation-delay: 1s;
        }

        .node-4 {
          bottom: 20%;
          right: 20%;
          animation-delay: 1.5s;
        }

        .connection-lines {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 1;
        }

        .connect-line {
          stroke: rgba(59, 130, 246, 0.3);
          stroke-width: 1;
          stroke-dasharray: 1000;
          stroke-dashoffset: 1000;
          animation: lineFlow 8s ease-in-out infinite;
        }

        .line-1 {
          animation-delay: 0s;
        }

        .line-2 {
          animation-delay: 2.5s;
        }

        .line-3 {
          animation-delay: 5s;
        }

        .scan-line {
          position: absolute;
          left: 0;
          right: 0;
          height: 2px;
          background: linear-gradient(to right,
            transparent,
            rgba(6, 182, 212, 0.8),
            rgba(59, 130, 246, 0.8),
            transparent);
          box-shadow: 0 0 10px rgba(6, 182, 212, 0.8);
          animation: scanMove 5s ease-in-out infinite;
          pointer-events: none;
          z-index: 2;
        }

        @keyframes curtainLeft {
          0% {
            transform: scaleX(0);
          }
          100% {
            transform: scaleX(1);
          }
        }

        @keyframes curtainRight {
          0% {
            transform: scaleX(0);
          }
          100% {
            transform: scaleX(1);
          }
        }

        @keyframes progressFill {
          0% {
            width: 0%;
          }
          100% {
            width: 100%;
          }
        }

        @keyframes shimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
      `}</style>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-3 md:gap-4">
        {/* Total Assets Card */}
        <div className="rounded-xl p-3 sm:p-4 md:p-5 bg-gradient-to-b from-amber-50 to-white border border-amber-200 hover:border-amber-300 hover:shadow-md transition-all duration-200 group">
          <div className="flex items-center gap-1.5 sm:gap-2 mb-2.5 sm:mb-3 md:mb-4">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-amber-100 flex items-center justify-center group-hover:bg-amber-200 transition-colors">
              <WalletIcon className="w-4 h-4 text-amber-600" />
            </div>
            <span className="text-[10px] xs:text-[11px] sm:text-xs md:text-sm font-semibold text-gray-500 uppercase tracking-wider leading-tight">{t.wallet.balance}</span>
          </div>
          <div className="flex items-baseline gap-0.5 sm:gap-1 min-w-0 w-full">
            <span className={`text-amber-600 font-bold flex-shrink-0 ${
              isTabletDevice ? 'text-sm' : 'text-xs sm:text-base md:text-lg'
            }`}>$</span>
            <span
              className={`font-bold text-gray-900 leading-tight truncate ${
                isTabletDevice ? '' : 'text-base sm:text-xl md:text-2xl lg:text-3xl'
              }`}
              style={isTabletDevice ? { fontSize: getTabletFontSize(totalAssets) } : {}}
              title={`$${totalAssets.toFixed(2)}`}
            >
              {totalAssets.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Available Card */}
        <div className="rounded-xl p-3 sm:p-4 md:p-5 bg-gradient-to-b from-emerald-50 to-white border border-emerald-200 hover:border-emerald-300 hover:shadow-md transition-all duration-200 group">
          <div className="flex items-center gap-1.5 sm:gap-2 mb-2.5 sm:mb-3 md:mb-4">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-emerald-100 flex items-center justify-center group-hover:bg-emerald-200 transition-colors">
              <DollarSign className="w-4 h-4 text-emerald-600" />
            </div>
            <span className="text-[10px] xs:text-[11px] sm:text-xs md:text-sm font-semibold text-gray-500 uppercase tracking-wider leading-tight">{t.wallet.availableBalance}</span>
          </div>
          <div className="flex items-baseline gap-0.5 sm:gap-1 min-w-0 w-full">
            <span className={`text-emerald-600 font-bold flex-shrink-0 ${
              isTabletDevice ? 'text-sm' : 'text-xs sm:text-base md:text-lg'
            }`}>$</span>
            <span
              className={`font-bold text-gray-900 leading-tight truncate ${
                isTabletDevice ? '' : 'text-base sm:text-xl md:text-2xl lg:text-3xl'
              }`}
              style={isTabletDevice ? { fontSize: getTabletFontSize(wallet?.available_balance || 0) } : {}}
              title={`$${wallet?.available_balance.toFixed(2)}`}
            >
              {(wallet?.available_balance || 0).toFixed(2)}
            </span>
          </div>
        </div>

        {/* Frozen Card */}
        <div className="rounded-xl p-3 sm:p-4 md:p-5 bg-gradient-to-b from-orange-50 to-white border border-orange-200 hover:border-orange-300 hover:shadow-md transition-all duration-200 group">
          <div className="flex items-center gap-1.5 sm:gap-2 mb-2.5 sm:mb-3 md:mb-4">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-orange-100 flex items-center justify-center group-hover:bg-orange-200 transition-colors">
              <Lock className="w-4 h-4 text-orange-600" />
            </div>
            <span className="text-[10px] xs:text-[11px] sm:text-xs md:text-sm font-semibold text-gray-500 uppercase tracking-wider leading-tight">{t.wallet.frozenFunds}</span>
          </div>
          <div className="flex items-baseline gap-0.5 sm:gap-1 min-w-0 w-full">
            <span className={`text-orange-600 font-bold flex-shrink-0 ${
              isTabletDevice ? 'text-sm' : 'text-xs sm:text-base md:text-lg'
            }`}>$</span>
            <span
              className={`font-bold text-gray-900 leading-tight truncate ${
                isTabletDevice ? '' : 'text-base sm:text-xl md:text-2xl lg:text-3xl'
              }`}
              style={isTabletDevice ? { fontSize: getTabletFontSize(wallet?.frozen_balance || 0) } : {}}
              title={`$${wallet?.frozen_balance.toFixed(2)}`}
            >
              {(wallet?.frozen_balance || 0).toFixed(2)}
            </span>
          </div>
        </div>

        {/* Total Earnings Card */}
        <div className="rounded-xl p-3 sm:p-4 md:p-5 bg-gradient-to-b from-blue-50 to-white border border-blue-200 hover:border-blue-300 hover:shadow-md transition-all duration-200 group">
          <div className="flex items-center gap-1.5 sm:gap-2 mb-2.5 sm:mb-3 md:mb-4">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-blue-100 flex items-center justify-center group-hover:bg-blue-200 transition-colors">
              <TrendingUp className="w-4 h-4 text-blue-600" />
            </div>
            <span className="text-[10px] xs:text-[11px] sm:text-xs md:text-sm font-semibold text-gray-500 uppercase tracking-wider leading-tight">{t.wallet.totalEarnings}</span>
          </div>
          <div className="flex items-baseline gap-0.5 sm:gap-1 min-w-0 w-full">
            <span className={`text-blue-600 font-bold flex-shrink-0 ${
              isTabletDevice ? 'text-sm' : 'text-xs sm:text-base md:text-lg'
            }`}>$</span>
            <span
              className={`font-bold text-gray-900 leading-tight truncate ${
                isTabletDevice ? '' : 'text-base sm:text-xl md:text-2xl lg:text-3xl'
              }`}
              style={isTabletDevice ? { fontSize: getTabletFontSize(localEmployee.total_income) } : {}}
              title={`$${localEmployee.total_income.toFixed(2)}`}
            >
              {localEmployee.total_income.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* Withdraw Funds Panel - Wealth Transfer Theme */}
      <div className="relative rounded-2xl overflow-hidden border border-gray-200 shadow-sm">
        {/* Curtain animation overlay - appears during checking */}
        {checkingEligibility && (
          <>
            {/* Left curtain */}
            <div className="absolute inset-0 z-50 bg-gradient-to-r from-cyan-500/95 via-blue-600/90 to-transparent origin-left animate-[curtainLeft_0.8s_ease-out_forwards]"></div>
            {/* Right curtain */}
            <div className="absolute inset-0 z-50 bg-gradient-to-l from-blue-600/95 via-cyan-500/90 to-transparent origin-right animate-[curtainRight_0.8s_ease-out_forwards]"></div>

            {/* Center loading area with progress - positioned below title */}
            <div className="absolute inset-0 z-50 flex items-start md:items-center justify-center pt-12 sm:pt-16 md:pt-0">
              <div className="flex flex-col items-center gap-2 sm:gap-3 px-4 sm:px-8">
                {/* Glowing background orb - smaller */}
                <div className="absolute w-24 h-24 sm:w-32 sm:h-32 bg-cyan-400/20 rounded-full blur-2xl animate-pulse"></div>

                {/* Rotating ring spinner - smaller */}
                <div className="relative w-12 h-12 sm:w-16 sm:h-16">
                  {/* Outer ring */}
                  <div className="absolute inset-0 border-2 sm:border-3 border-white/10 rounded-full"></div>
                  {/* Spinning arc */}
                  <div className="absolute inset-0 border-2 sm:border-3 border-transparent border-t-cyan-400 border-r-blue-400 rounded-full animate-spin keep-animation"></div>
                  {/* Inner ring */}
                  <div className="absolute inset-1 sm:inset-2 border-2 border-white/5 rounded-full"></div>
                  {/* Inner spinning arc - opposite direction */}
                  <div className="absolute inset-1 sm:inset-2 border-2 border-transparent border-b-blue-300 border-l-cyan-300 rounded-full animate-[spin_1s_linear_infinite_reverse] keep-animation"></div>
                  {/* Center dot */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 bg-white rounded-full animate-pulse keep-animation shadow-lg shadow-cyan-400/50"></div>
                  </div>
                </div>

                {/* Status text */}
                <div className="relative text-center">
                  <div className="text-white font-bold text-sm sm:text-base tracking-wide mb-1 animate-pulse keep-animation">{t.wallet.checkingEligibility}</div>
                  <div className="text-cyan-300 text-xs sm:text-sm font-medium">{t.common.loading}</div>
                </div>

                {/* Progress bar */}
                <div className="relative w-48 sm:w-56 h-1.5 sm:h-2 bg-white/10 rounded-full overflow-hidden backdrop-blur-sm">
                  {/* Background shimmer */}
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-[shimmer_1.5s_ease-in-out_infinite] keep-animation"></div>
                  {/* Progress fill */}
                  <div className="absolute inset-0 bg-gradient-to-r from-cyan-500 via-blue-500 to-cyan-500 animate-[progressFill_0.8s_ease-out_forwards] keep-animation shadow-lg shadow-cyan-400/50"></div>
                  {/* Glowing edge */}
                  <div className="absolute right-0 top-0 bottom-0 w-0.5 sm:w-1 bg-white animate-[progressFill_0.8s_ease-out_forwards] keep-animation shadow-[0_0_10px_rgba(255,255,255,0.8)]"></div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Light Blue Background */}
        <div className="absolute inset-0 bg-white"></div>

        {/* Elegant static grid pattern - mobile optimized */}
        <div className="absolute inset-0 opacity-[0.03] sm:opacity-[0.06]">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="hex-withdraw" x="0" y="0" width="50" height="43.3" patternUnits="userSpaceOnUse">
                <path d="M25 0 L37.5 7.2 L37.5 21.6 L25 28.8 L12.5 21.6 L12.5 7.2 Z" fill="none" stroke="rgba(59,130,246,0.25)" strokeWidth="0.5"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#hex-withdraw)"/>
          </svg>
        </div>

        {/* Static accent lines - desktop only to preserve performance */}
        <svg className="hidden sm:block absolute inset-0 w-full h-full opacity-8">
          <defs>
            <linearGradient id="circuit-grad-1" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(59,130,246,0)"/>
              <stop offset="50%" stopColor="rgba(6,182,212,0.6)"/>
              <stop offset="100%" stopColor="rgba(59,130,246,0)"/>
            </linearGradient>
          </defs>
          <line x1="0" y1="30%" x2="100%" y2="30%" stroke="url(#circuit-grad-1)" strokeWidth="1" strokeDasharray="10,5"/>
          <line x1="0" y1="70%" x2="100%" y2="70%" stroke="url(#circuit-grad-1)" strokeWidth="1" strokeDasharray="10,5"/>
          <line x1="25%" y1="0" x2="25%" y2="100%" stroke="url(#circuit-grad-1)" strokeWidth="0.5" strokeDasharray="8,4"/>
          <line x1="75%" y1="0" x2="75%" y2="100%" stroke="url(#circuit-grad-1)" strokeWidth="0.5" strokeDasharray="8,4"/>
        </svg>

        {/* Money Transfer Animation - Flying Gold Coins - Hidden on mobile */}
        <div className="hidden sm:block absolute top-1/4 right-0 w-full h-32 pointer-events-none">
          {/* Coin 1 */}
          <div className="absolute top-0 right-[80%] w-12 h-12 rounded-full bg-gradient-to-br from-yellow-200 via-amber-400 to-yellow-600 shadow-2xl animate-[flyCoins_4s_ease-in-out_infinite] opacity-40">
            <div className="absolute inset-2 rounded-full bg-gradient-to-br from-amber-300 to-amber-500 flex items-center justify-center">
              <span className="text-amber-900 text-lg font-black">$</span>
            </div>
          </div>
          {/* Coin 2 */}
          <div className="absolute top-8 right-[75%] w-10 h-10 rounded-full bg-gradient-to-br from-yellow-300 via-amber-500 to-yellow-700 shadow-xl animate-[flyCoins_4s_ease-in-out_infinite] delay-500 opacity-30">
            <div className="absolute inset-2 rounded-full bg-gradient-to-br from-amber-400 to-amber-600"></div>
          </div>
          {/* Coin 3 */}
          <div className="absolute top-4 right-[85%] w-14 h-14 rounded-full bg-gradient-to-br from-amber-200 via-yellow-400 to-amber-600 shadow-2xl animate-[flyCoins_4s_ease-in-out_infinite] delay-1000 opacity-35">
            <div className="absolute inset-2 rounded-full bg-gradient-to-br from-yellow-300 to-yellow-500 flex items-center justify-center">
              <span className="text-yellow-900 text-xl font-black">$</span>
            </div>
          </div>
        </div>

        {/* Blockchain Network Nodes - Hidden on mobile */}
        <div className="hidden sm:block absolute top-4 left-6 w-3 h-3 rounded-full bg-cyan-400 shadow-[0_0_20px_rgba(6,182,212,1)] animate-[nodePulse_2s_ease-in-out_infinite]"></div>
        <div className="hidden sm:block absolute top-12 left-12 w-2 h-2 rounded-full bg-blue-400 shadow-[0_0_15px_rgba(59,130,246,1)] animate-[nodePulse_2.5s_ease-in-out_infinite] delay-500"></div>
        <div className="hidden sm:block absolute bottom-12 left-8 w-2.5 h-2.5 rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,1)] animate-[nodePulse_3s_ease-in-out_infinite] delay-1000"></div>
        <div className="hidden sm:block absolute top-8 right-10 w-2 h-2 rounded-full bg-blue-300 shadow-[0_0_15px_rgba(147,197,253,1)] animate-[nodePulse_2.7s_ease-in-out_infinite] delay-700"></div>
        <div className="hidden sm:block absolute bottom-8 right-16 w-3 h-3 rounded-full bg-cyan-500 shadow-[0_0_20px_rgba(6,182,212,1)] animate-[nodePulse_2.3s_ease-in-out_infinite] delay-1200"></div>

        {/* Wealth Sparkles - Hidden on mobile */}
        <div className="hidden sm:block absolute top-16 right-24 w-2 h-2 bg-yellow-300 rounded-full shadow-[0_0_20px_rgba(253,224,71,1)] animate-[twinkleGold_2s_ease-in-out_infinite]"></div>
        <div className="hidden sm:block absolute top-24 right-32 w-1.5 h-1.5 bg-amber-300 rounded-full shadow-[0_0_15px_rgba(252,211,77,1)] animate-[twinkleGold_2.5s_ease-in-out_infinite] delay-600"></div>
        <div className="hidden sm:block absolute bottom-20 left-20 w-2 h-2 bg-yellow-400 rounded-full shadow-[0_0_18px_rgba(250,204,21,1)] animate-[twinkleGold_3s_ease-in-out_infinite] delay-1200"></div>

        {/* Corner Decorations - Hidden on mobile */}
        <div className="hidden sm:block absolute top-0 left-0 w-16 h-16 border-t-2 border-l-2 border-blue-400/40 rounded-tl-2xl"></div>
        <div className="hidden sm:block absolute top-0 right-0 w-16 h-16 border-t-2 border-r-2 border-cyan-400/40 rounded-tr-2xl"></div>
        <div className="hidden sm:block absolute bottom-0 left-0 w-16 h-16 border-b-2 border-l-2 border-cyan-400/40 rounded-bl-2xl"></div>
        <div className="hidden sm:block absolute bottom-0 right-0 w-16 h-16 border-b-2 border-r-2 border-blue-400/40 rounded-br-2xl"></div>

        {/* Mobile-only elegant static decorative elements */}
        <div className="sm:hidden absolute inset-0 pointer-events-none overflow-hidden">
          {/* Elegant gradient orbs - subtle and refined */}
          <div className="absolute -top-20 -right-20 w-64 h-64 bg-gradient-radial from-cyan-500/8 via-blue-500/4 to-transparent rounded-full"></div>
          <div className="absolute -bottom-20 -left-20 w-64 h-64 bg-gradient-radial from-blue-500/8 via-cyan-500/4 to-transparent rounded-full"></div>

          {/* Refined corner brackets - minimalist design */}
          <div className="absolute top-0 left-0 w-16 h-16">
            <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-cyan-400/40 via-cyan-400/20 to-transparent"></div>
            <div className="absolute top-0 left-0 w-0.5 h-full bg-gradient-to-b from-cyan-400/40 via-cyan-400/20 to-transparent"></div>
            <div className="absolute top-0 left-0 w-2 h-2 bg-cyan-400/60 rounded-full"></div>
          </div>
          <div className="absolute top-0 right-0 w-16 h-16">
            <div className="absolute top-0 right-0 w-full h-0.5 bg-gradient-to-l from-blue-400/40 via-blue-400/20 to-transparent"></div>
            <div className="absolute top-0 right-0 w-0.5 h-full bg-gradient-to-b from-blue-400/40 via-blue-400/20 to-transparent"></div>
            <div className="absolute top-0 right-0 w-2 h-2 bg-blue-400/60 rounded-full"></div>
          </div>
          <div className="absolute bottom-0 left-0 w-16 h-16">
            <div className="absolute bottom-0 left-0 w-full h-0.5 bg-gradient-to-r from-cyan-400/40 via-cyan-400/20 to-transparent"></div>
            <div className="absolute bottom-0 left-0 w-0.5 h-full bg-gradient-to-t from-cyan-400/40 via-cyan-400/20 to-transparent"></div>
            <div className="absolute bottom-0 left-0 w-2 h-2 bg-cyan-400/60 rounded-full"></div>
          </div>
          <div className="absolute bottom-0 right-0 w-16 h-16">
            <div className="absolute bottom-0 right-0 w-full h-0.5 bg-gradient-to-l from-blue-400/40 via-blue-400/20 to-transparent"></div>
            <div className="absolute bottom-0 right-0 w-0.5 h-full bg-gradient-to-t from-blue-400/40 via-blue-400/20 to-transparent"></div>
            <div className="absolute bottom-0 right-0 w-2 h-2 bg-blue-400/60 rounded-full"></div>
          </div>

          {/* Geometric accent lines - clean and elegant */}
          <div className="absolute top-1/3 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-400/15 to-transparent"></div>
          <div className="absolute bottom-1/3 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-400/15 to-transparent"></div>

          {/* Minimalist side accents */}
          <div className="absolute top-1/4 left-0 w-px h-20 bg-gradient-to-b from-transparent via-cyan-400/20 to-transparent"></div>
          <div className="absolute bottom-1/4 right-0 w-px h-20 bg-gradient-to-b from-transparent via-blue-400/20 to-transparent"></div>

          {/* Refined send icon watermark - larger and more elegant */}
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 opacity-[0.03]">
            <Send className="w-40 h-40 text-blue-600" />
          </div>

          {/* Subtle diagonal accent */}
          <div className="absolute top-0 right-0 w-32 h-32 border-t border-r border-blue-400/10 rounded-tr-2xl"></div>
          <div className="absolute bottom-0 left-0 w-32 h-32 border-b border-l border-cyan-400/10 rounded-bl-2xl"></div>
        </div>

        <div className="relative z-10 p-3 sm:p-4 md:p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-6 sm:mb-8">
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Animated Wallet Icon with Gold Coins */}
            <div className="relative w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14">
              {/* Glowing background - Hidden on mobile */}
              <div className="hidden sm:block absolute inset-0 bg-gradient-to-br from-blue-500/40 to-cyan-500/40 blur-xl rounded-full animate-pulse"></div>

              {/* Icon container */}
              <div className="relative w-full h-full bg-gradient-to-br from-blue-600/30 to-cyan-600/30 rounded-xl border-2 border-cyan-400/50 flex items-center justify-center backdrop-blur-sm overflow-hidden">
                {/* Rotating ring */}
                <div className="absolute inset-0 border-2 border-blue-400/20 rounded-xl animate-[spin_4s_linear_infinite]"></div>

                {/* Small gold coins flying around - Hidden on mobile */}
                <div className="hidden sm:block absolute top-0 right-0 w-3 h-3 rounded-full bg-gradient-to-br from-yellow-300 to-amber-500 shadow-lg animate-[miniCoinOrbit_3s_ease-in-out_infinite]"></div>
                <div className="hidden sm:block absolute bottom-1 left-1 w-2.5 h-2.5 rounded-full bg-gradient-to-br from-amber-300 to-yellow-600 shadow-md animate-[miniCoinOrbit_3s_ease-in-out_infinite] delay-1000"></div>

                <Send className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 text-blue-600 drop-shadow-[0_0_10px_rgba(6,182,212,0.8)] relative z-10" />
              </div>
            </div>

            <div>
              <h2 className="text-base sm:text-xl md:text-2xl font-bold text-blue-600 leading-tight">
                {t.wallet.withdraw}
              </h2>
              <p className="text-[10px] sm:text-xs text-gray-500 font-medium leading-tight">{t.wallet.transferSubtitle}</p>
            </div>
          </div>
          <button
            onClick={() => {
              setShowWithdrawalHistory(true);
              onWithdrawalHistoryChange?.(true);
            }}
            className="flex items-center gap-1.5 sm:gap-2 px-3.5 py-2 sm:px-4 sm:py-2.5 md:px-5 md:py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg sm:rounded-xl font-semibold transition-all duration-200 text-xs sm:text-sm shadow-sm hover:shadow-md group"
          >
            <History className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white group-hover:rotate-[-15deg] transition-transform duration-200" />
            <span className="tracking-wide text-[10px] sm:text-xs md:text-sm font-bold">{t.wallet.withdrawalHistory}</span>
          </button>
        </div>

        {/* Content wrapper with transition animation */}
        <div className="relative z-10">
          {/* Transitioning content area */}
          {!showWithdrawalForm ? (
            <div className={`interactive-transition ${
              checkingEligibility ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
            }`}>
              {message && (
                <div
                  className={`rounded-lg p-2.5 sm:p-3 md:p-4 text-[11px] sm:text-xs md:text-sm flex items-start gap-1.5 sm:gap-2 md:gap-3 mb-3 sm:mb-4 ${
                    message.type === 'success'
                      ? 'bg-green-500/10 border border-green-500/50 text-green-400'
                      : 'bg-red-500/10 border border-red-500/50 text-red-400'
                  }`}
                >
                  <AlertCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 md:w-5 md:h-5 flex-shrink-0 mt-0.5" />
                  <span className="flex-1 leading-tight">{message.text}</span>
                </div>
              )}

              <button
                onClick={handleRequestWithdrawal}
                disabled={checkingEligibility}
                className={`relative w-full min-h-[44px] text-white py-2.5 sm:py-3 md:py-4 px-3 sm:px-4 rounded-lg sm:rounded-xl font-bold flex items-center justify-center gap-1.5 sm:gap-2 group overflow-hidden disabled:cursor-not-allowed text-sm sm:text-base transition-all duration-300 ${
                  checkingEligibility
                    ? 'bg-blue-600 opacity-90 cursor-wait shadow-2xl shadow-blue-500/50'
                    : 'bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-600 hover:from-blue-500 hover:via-cyan-500 hover:to-blue-600 shadow-2xl shadow-blue-500/50 hover:shadow-cyan-500/50 hover:scale-[1.02] active:scale-[0.98]'
                }`}
              >
                {/* Pulsing glow when loading */}
                {checkingEligibility && (
                  <div className="keep-animation absolute inset-0 bg-gradient-to-r from-blue-400 via-cyan-400 to-blue-400 rounded-lg sm:rounded-xl blur-xl opacity-40 animate-pulse"></div>
                )}

                {/* Shimmer effect when loading */}
                {checkingEligibility && (
                  <div className="keep-animation absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer"></div>
                )}

                {/* Hover effect when not loading */}
                {!checkingEligibility && (
                  <div className="absolute inset-0 bg-gradient-to-r from-blue-600 via-cyan-500 to-blue-600 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                )}

                {/* Icon and text */}
                <span className="relative z-10 flex items-center justify-center gap-2">
                  {checkingEligibility ? (
                    <>
                      {/* Double spinner effect - outer ring + inner ring */}
                      <div className="keep-animation relative">
                        {/* Outer ring - clockwise */}
                        <div className="keep-animation w-5 h-5 sm:w-6 sm:h-6 border-2 sm:border-[3px] border-white/30 border-t-white rounded-full animate-spin"></div>
                        {/* Inner ring - counter-clockwise (desktop only) */}
                        <div className="keep-animation hidden sm:block absolute inset-0 w-6 h-6 border-[3px] border-transparent border-t-cyan-300 rounded-full animate-spin" style={{ animationDuration: '0.8s', animationDirection: 'reverse' }}></div>
                      </div>
                      <span className="keep-animation tracking-wide">{t.wallet.checking}</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 sm:w-5 sm:h-5 transition-transform duration-300 group-hover:scale-110" />
                      <span className="tracking-wide">{t.wallet.submitWithdrawal}</span>
                    </>
                  )}
                </span>
              </button>
            </div>
          ) : (
            <div className="space-y-3 sm:space-y-4 interactive-transition" style={{
              animation: 'fadeIn 0.4s ease-out',
              transformOrigin: 'center'
            }}>
            {/* Withdrawal Request Header Card */}
            <div className="relative rounded-xl sm:rounded-2xl overflow-hidden border border-gray-200 shadow-sm">
              {/* Blue Header Banner */}
              <div className="bg-gradient-to-r from-blue-600 to-blue-500 px-3 sm:px-5 md:px-6 py-3 sm:py-4">
                <div className="flex items-center gap-2.5 sm:gap-3">
                  <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center">
                    <Send className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-sm sm:text-base md:text-lg font-bold text-white leading-tight">
                      {t.wallet.submitWithdrawal}
                    </h3>
                    <p className="text-blue-100 text-[10px] sm:text-xs mt-0.5">
                      {t.wallet.withdrawFullBalance}
                    </p>
                  </div>
                </div>
              </div>

              {/* Card Body */}
              <div className="bg-white p-3 sm:p-5 md:p-6 space-y-3 sm:space-y-4">
                {/* Amount Display */}
                <div className="bg-gradient-to-br from-gray-50 to-blue-50/50 rounded-xl p-4 sm:p-5 md:p-6 border border-gray-200">
                  <div className="flex items-center justify-between mb-3 sm:mb-4">
                    <span className="text-gray-600 text-xs sm:text-sm font-medium">{t.wallet.withdrawalAmount}</span>
                    <span className="px-2 py-0.5 sm:px-2.5 sm:py-1 bg-blue-100 border border-blue-200 rounded-md text-[10px] sm:text-xs text-blue-700 font-bold uppercase tracking-wide">
                      {t.wallet.submitWithdrawal}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 sm:gap-3 justify-center py-2 sm:py-3">
                    <div className="w-8 h-8 sm:w-11 sm:h-11 rounded-full bg-emerald-100 border border-emerald-200 flex items-center justify-center">
                      <DollarSign className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-600" />
                    </div>
                    <div className="text-2xl sm:text-4xl md:text-5xl font-black text-gray-900">
                      {wallet?.available_balance.toFixed(2)}
                    </div>
                    <div className="px-2 py-1 sm:px-3 sm:py-1.5 bg-blue-100 border border-blue-200 rounded-lg">
                      <span className="text-sm sm:text-lg text-blue-700 font-bold">{currencyUnit}</span>
                    </div>
                  </div>

                  <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-gray-200 space-y-2">
                    <div className="flex items-center justify-between text-xs sm:text-sm">
                      <span className="text-gray-500">{t.wallet.amount}</span>
                      <span className="text-emerald-600 font-bold">${wallet?.available_balance.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs sm:text-sm">
                      <span className="text-gray-500">{t.wallet.afterWithdrawal}</span>
                      <span className="text-gray-400 font-bold">$0.00</span>
                    </div>
                  </div>
                </div>

                {message && (
                  <div
                    className={`rounded-lg p-2.5 sm:p-3 md:p-4 text-[11px] sm:text-xs md:text-sm flex items-start gap-1.5 sm:gap-2 md:gap-3 ${
                      message.type === 'success'
                        ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                        : 'bg-red-50 border border-red-200 text-red-700'
                    }`}
                  >
                    <AlertCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 md:w-5 md:h-5 flex-shrink-0 mt-0.5" />
                    <span className="flex-1 leading-tight">{message.text}</span>
                  </div>
                )}

                <div className="flex gap-2 sm:gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowWithdrawalForm(false);
                      setMessage(null);
                    }}
                    className="flex-1 min-h-[44px] bg-white hover:bg-gray-50 border border-gray-300 hover:border-gray-400 text-gray-700 py-2.5 sm:py-3 px-3 sm:px-4 rounded-lg sm:rounded-xl font-semibold transition-all text-xs sm:text-sm md:text-base"
                  >
                    {t.common.cancel}
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowConfirmModal(true)}
                    disabled={!wallet || wallet.available_balance <= 0}
                    className="flex-1 min-h-[44px] bg-blue-600 hover:bg-blue-700 text-white py-2.5 sm:py-3 px-3 sm:px-4 rounded-lg sm:rounded-xl font-bold shadow-md shadow-blue-200 hover:shadow-lg hover:shadow-blue-200 transition-all flex items-center justify-center gap-1.5 sm:gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-xs sm:text-sm md:text-base"
                  >
                    <Send className="w-4 h-4 sm:w-5 sm:h-5" />
                    <span className="hidden sm:inline">{t.wallet.submitWithdrawal}</span>
                    <span className="sm:hidden">{t.wallet.withdraw}</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 rounded-lg p-3 sm:p-4 border border-blue-100">
              <p className="text-blue-700 text-[10px] sm:text-xs leading-relaxed">
                <span className="font-semibold">{t.wallet.importantNotice}:</span> {t.wallet.withdrawalNote}
              </p>
            </div>
          </div>
          )}
        </div>
        </div>
      </div>

      {showConfirmModal && createPortal(
        <div className="fixed top-0 left-0 right-0 bottom-0 flex items-center justify-center" style={{ zIndex: 9999 }}>
          <div className="absolute top-0 left-0 right-0 bottom-0 bg-black/50"></div>
          <div className="relative bg-white rounded-xl sm:rounded-2xl border border-gray-200 shadow-2xl max-w-md w-full overflow-hidden max-h-[90vh] overflow-y-auto mx-3 sm:mx-4">
            {/* Blue Header */}
            <div className="bg-gradient-to-r from-blue-600 to-blue-500 px-4 sm:px-6 py-3.5 sm:py-4">
              <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center">
                  <AlertCircle className="w-4.5 h-4.5 sm:w-5 sm:h-5 text-white" />
                </div>
                {t.wallet.submitWithdrawal}
              </h3>
            </div>

            <div className="p-4 sm:p-6 space-y-4 sm:space-y-5">
              {/* Amount Card */}
              <div className="bg-gradient-to-br from-blue-50 to-sky-50 rounded-xl p-4 sm:p-5 border border-blue-200">
                <div className="text-center mb-3 sm:mb-4">
                  <div className="text-xs sm:text-sm text-blue-600 mb-2 font-semibold uppercase tracking-wide">{t.wallet.withdrawalAmount}</div>
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center">
                      <DollarSign className="w-6 h-6 sm:w-7 sm:h-7 text-blue-600" strokeWidth={2.5} />
                    </div>
                    <div className="text-3xl sm:text-4xl font-black text-gray-900">
                      {wallet?.available_balance.toFixed(2)}
                    </div>
                    <span className="text-blue-600 text-sm sm:text-base font-bold">{currencyUnit}</span>
                  </div>
                </div>
                <div className="pt-3 sm:pt-4 border-t border-blue-200 space-y-2">
                  <div className="flex items-center justify-between text-xs sm:text-sm">
                    <span className="text-gray-500">{t.wallet.amount}</span>
                    <span className="text-emerald-600 font-bold">${wallet?.available_balance.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs sm:text-sm">
                    <span className="text-gray-500">{t.wallet.afterWithdrawal}</span>
                    <span className="text-gray-400 font-bold">$0.00</span>
                  </div>
                </div>
              </div>

              {/* Important Notice */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 sm:p-4">
                <div className="flex items-start gap-2.5">
                  <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-amber-800 text-xs sm:text-sm font-semibold mb-1.5 sm:mb-2">
                      {t.wallet.importantNotice}
                    </p>
                    <div className="text-amber-700 text-[10px] sm:text-xs space-y-2 leading-relaxed">
                      <p>{t.wallet.noticeSubmitted}</p>
                      <p>{t.wallet.noticeFrozen}</p>
                      <p>{t.wallet.noticeContact}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={() => setShowConfirmModal(false)}
                  disabled={submitting}
                  className="flex-1 min-h-[44px] bg-white hover:bg-gray-50 border border-gray-300 hover:border-gray-400 text-gray-700 py-2.5 sm:py-3 px-3 sm:px-4 rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="button"
                  onClick={handleConfirmWithdrawal}
                  disabled={submitting}
                  className="flex-1 min-h-[44px] bg-blue-600 hover:bg-blue-700 text-white py-2.5 sm:py-3 px-3 sm:px-4 rounded-lg font-semibold shadow-md shadow-blue-200 hover:shadow-lg hover:shadow-blue-300 transition-all duration-200 flex items-center justify-center gap-1.5 sm:gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base"
                >
                  <Send className="w-4 h-4 sm:w-5 sm:h-5" />
                  {submitting ? t.common.loading : t.wallet.submitWithdrawal}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showWithdrawalHistory && (
        <WithdrawalHistory
          employeeId={employeeId}
          onClose={() => {
            setShowWithdrawalHistory(false);
            onWithdrawalHistoryChange?.(false);
          }}
        />
      )}
    </div>
  );
}
