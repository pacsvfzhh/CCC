import { useState, useEffect } from 'react';
import { TrendingUp, Calendar, CheckCircle, XCircle, DollarSign, ListChecks, BarChart3, Gift, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useDeviceOptimization } from '../../lib/useDeviceOptimization';
import { useLanguage } from '../../lib/i18n';

interface DailyStatisticsProps {
  employeeId: string;
}

interface DailyStats {
  date: string;
  dateKey: string;
  total_orders: number;
  success_count: number;
  failure_count: number;
  daily_commission: number;
  daily_tips: number;
  daily_earnings: number;
}

interface OverallStats {
  total_revenue: number;
  total_commission: number;
  total_tips: number;
  total_orders: number;
  total_success: number;
  total_failed: number;
}

export default function DailyStatistics({ employeeId }: DailyStatisticsProps) {
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [overallStats, setOverallStats] = useState<OverallStats>({
    total_revenue: 0,
    total_commission: 0,
    total_tips: 0,
    total_orders: 0,
    total_success: 0,
    total_failed: 0,
  });
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);
  const ITEMS_PER_PAGE = 7;
  const { isMobile, isTablet, deviceType, shouldReduceAnimations } = useDeviceOptimization();
  const { t } = useLanguage();

  // Tablet-specific detection
  const isTabletDevice = deviceType === 'tablet';

  // Pagination for mobile/tablet
  const totalPages = Math.ceil(dailyStats.length / ITEMS_PER_PAGE);
  const paginatedStats = dailyStats.slice(
    currentPage * ITEMS_PER_PAGE,
    (currentPage + 1) * ITEMS_PER_PAGE
  );
  const canGoPrev = currentPage > 0;
  const canGoNext = currentPage < totalPages - 1;

  // Debug logging for device detection
  useEffect(() => {
    console.log('[DailyStatistics] 设备检测信息:', {
      deviceType,
      isTablet,
      isMobile,
      isTabletDevice,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints
    });
  }, [deviceType, isTablet, isMobile, isTabletDevice]);

  useEffect(() => {
    loadStatistics();
    const interval = setInterval(loadStatistics, 10000);
    return () => clearInterval(interval);
  }, [employeeId]);

  const loadStatistics = async () => {
    try {
      const [dailyResult, overallResult, tipsResult, dailyTipsResult] = await Promise.all([
        supabase.rpc('get_daily_order_stats', { p_user_id: employeeId }),
        supabase.rpc('get_overall_order_stats', { p_user_id: employeeId }),
        supabase
          .from('wallet_transactions')
          .select('amount')
          .eq('user_id', employeeId)
          .eq('type', 'tip'),
        supabase
          .from('wallet_transactions')
          .select('amount, created_at')
          .eq('user_id', employeeId)
          .eq('type', 'tip'),
      ]);

      if (dailyResult.error) throw dailyResult.error;
      if (overallResult.error) throw overallResult.error;

      const totalTips = (tipsResult.data || []).reduce(
        (sum: number, row: { amount: number }) => sum + Number(row.amount),
        0
      );

      // Group daily tips by date
      const dailyTipsMap: Record<string, number> = {};
      (dailyTipsResult.data || []).forEach((row: { amount: number; created_at: string }) => {
        const d = new Date(row.created_at);
        const dateKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        dailyTipsMap[dateKey] = (dailyTipsMap[dateKey] || 0) + Number(row.amount);
      });

      const formattedDaily: DailyStats[] = (dailyResult.data || []).map((row: {
        day_date: string;
        total_orders: number;
        success_count: number;
        failure_count: number;
        daily_earnings: number;
      }) => {
        const d = new Date(row.day_date + 'T00:00:00Z');
        const month = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        const year = d.getUTCFullYear();
        const dateKey = `${year}-${month}-${day}`;
        const commission = Number(row.daily_earnings);
        const tips = dailyTipsMap[dateKey] || 0;
        return {
          date: `${month}/${day}/${year}`,
          dateKey,
          total_orders: Number(row.total_orders),
          success_count: Number(row.success_count),
          failure_count: Number(row.failure_count),
          daily_commission: commission,
          daily_tips: tips,
          daily_earnings: commission + tips,
        };
      });

      const orderDateKeys = new Set(formattedDaily.map(s => s.dateKey));
      Object.entries(dailyTipsMap).forEach(([dateKey, tips]) => {
        if (!orderDateKeys.has(dateKey)) {
          const [y, m, d] = dateKey.split('-');
          formattedDaily.push({
            date: `${m}/${d}/${y}`,
            dateKey,
            total_orders: 0,
            success_count: 0,
            failure_count: 0,
            daily_commission: 0,
            daily_tips: tips,
            daily_earnings: tips,
          });
        }
      });

      formattedDaily.sort((a, b) => b.dateKey.localeCompare(a.dateKey));

      setDailyStats(formattedDaily);

      const overall = overallResult.data?.[0];
      if (overall) {
        const commission = Number(overall.total_revenue);
        setOverallStats({
          total_commission: commission,
          total_tips: totalTips,
          total_revenue: commission + totalTips,
          total_orders: Number(overall.total_orders),
          total_success: Number(overall.total_success),
          total_failed: Number(overall.total_failed),
        });
      } else {
        setOverallStats(prev => ({
          ...prev,
          total_tips: totalTips,
          total_revenue: totalTips,
        }));
      }
    } catch (error) {
      console.error('Error loading statistics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl lg:rounded-2xl border border-gray-200 p-6 lg:p-8 text-center">
        <div className="inline-flex items-center gap-2 text-gray-500">
          <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
          <span>{t.statistics.loading}</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }

        /* Optimize animations for mobile */
        @media (max-width: 1023px) {
          * {
            animation-duration: 0s !important;
            transition-duration: 0.15s !important;
          }

          .animate-pulse,
          .animate-spin,
          .animate-ping {
            animation: none !important;
          }
        }
      `}</style>
      <div className="space-y-4 pb-12 lg:pb-6">
        {/* Overall Statistics Summary */}
        <div className="bg-white rounded-xl lg:rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-3 sm:p-4 lg:p-6">
            {/* Header */}
            <div className="flex items-center gap-2 lg:gap-2.5 mb-3 sm:mb-4">
              <BarChart3 className="w-5 h-5 lg:w-5.5 lg:h-5.5 text-blue-600" />
              <h2 className="text-base lg:text-lg font-bold text-blue-600">{t.statistics.overview}</h2>
            </div>
            <div className="grid gap-2.5 sm:gap-3 lg:gap-4 grid-cols-2 md:grid-cols-3">
              {/* Total Revenue Card (Commission + Tips) */}
              <div className="rounded-xl p-3 sm:p-4 bg-gradient-to-b from-amber-50 to-white border border-amber-200 hover:border-amber-300 hover:shadow-sm transition-all duration-200 group">
                <div className="flex items-center gap-1.5 sm:gap-2 mb-2.5 sm:mb-3">
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-amber-100 flex items-center justify-center group-hover:bg-amber-200 transition-colors">
                    <DollarSign className="w-4 h-4 text-amber-600" />
                  </div>
                  <span className="text-[10px] sm:text-xs font-semibold text-amber-600/70 uppercase tracking-wider">{t.statistics.revenue}</span>
                </div>
                <div className="flex items-baseline gap-0.5">
                  <span className="text-sm sm:text-base font-bold text-amber-600">$</span>
                  <span
                    className="font-bold text-amber-700 leading-none truncate"
                    style={{
                      fontSize: `clamp(1rem, ${Math.max(1, 1.5 - (overallStats.total_revenue.toFixed(2).length * 0.04))}rem, 1.5rem)`
                    }}
                    title={`$${overallStats.total_revenue.toFixed(2)}`}
                  >
                    {overallStats.total_revenue.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Commission Card */}
              <div className="rounded-xl p-3 sm:p-4 bg-gradient-to-b from-indigo-50 to-white border border-indigo-200 hover:border-indigo-300 hover:shadow-sm transition-all duration-200 group">
                <div className="flex items-center gap-1.5 sm:gap-2 mb-2.5 sm:mb-3">
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-indigo-100 flex items-center justify-center group-hover:bg-indigo-200 transition-colors">
                    <TrendingUp className="w-4 h-4 text-indigo-600" />
                  </div>
                  <span className="text-[10px] sm:text-xs font-semibold text-indigo-600/70 uppercase tracking-wider">{t.statistics.commission}</span>
                </div>
                <div className="flex items-baseline gap-0.5">
                  <span className="text-sm sm:text-base font-bold text-indigo-600">$</span>
                  <span
                    className="font-bold text-indigo-700 leading-none truncate"
                    style={{
                      fontSize: `clamp(1rem, ${Math.max(1, 1.5 - (overallStats.total_commission.toFixed(2).length * 0.04))}rem, 1.5rem)`
                    }}
                    title={`$${overallStats.total_commission.toFixed(2)}`}
                  >
                    {overallStats.total_commission.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Tips Card */}
              <div className="rounded-xl p-3 sm:p-4 bg-gradient-to-b from-pink-50 to-white border border-pink-200 hover:border-pink-300 hover:shadow-sm transition-all duration-200 group">
                <div className="flex items-center gap-1.5 sm:gap-2 mb-2.5 sm:mb-3">
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-pink-100 flex items-center justify-center group-hover:bg-pink-200 transition-colors">
                    <Gift className="w-4 h-4 text-pink-600" />
                  </div>
                  <span className="text-[10px] sm:text-xs font-semibold text-pink-600/70 uppercase tracking-wider">{t.statistics.tips}</span>
                </div>
                <div className="flex items-baseline gap-0.5">
                  <span className="text-sm sm:text-base font-bold text-pink-600">$</span>
                  <span
                    className="font-bold text-pink-700 leading-none truncate"
                    style={{
                      fontSize: `clamp(1rem, ${Math.max(1, 1.5 - (overallStats.total_tips.toFixed(2).length * 0.04))}rem, 1.5rem)`
                    }}
                    title={`$${overallStats.total_tips.toFixed(2)}`}
                  >
                    {overallStats.total_tips.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Orders Card */}
              <div className="rounded-xl p-3 sm:p-4 bg-gradient-to-b from-blue-50 to-white border border-blue-200 hover:border-blue-300 hover:shadow-sm transition-all duration-200 group">
                <div className="flex items-center gap-1.5 sm:gap-2 mb-2.5 sm:mb-3">
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-blue-100 flex items-center justify-center group-hover:bg-blue-200 transition-colors">
                    <ListChecks className="w-4 h-4 text-blue-600" />
                  </div>
                  <span className="text-[10px] sm:text-xs font-semibold text-blue-600/70 uppercase tracking-wider">{t.statistics.orders}</span>
                </div>
                <div className="text-xl sm:text-2xl font-bold text-blue-700 leading-none">
                  {overallStats.total_orders}
                </div>
              </div>

              {/* Success Card */}
              <div className="rounded-xl p-3 sm:p-4 bg-gradient-to-b from-emerald-50 to-white border border-emerald-200 hover:border-emerald-300 hover:shadow-sm transition-all duration-200 group">
                <div className="flex items-center gap-1.5 sm:gap-2 mb-2.5 sm:mb-3">
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-emerald-100 flex items-center justify-center group-hover:bg-emerald-200 transition-colors">
                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                  </div>
                  <span className="text-[10px] sm:text-xs font-semibold text-emerald-600/70 uppercase tracking-wider">{t.statistics.success}</span>
                </div>
                <div className="text-xl sm:text-2xl font-bold text-emerald-600 leading-none">
                  {overallStats.total_success}
                </div>
              </div>

              {/* Failed Card */}
              <div className="rounded-xl p-3 sm:p-4 bg-gradient-to-b from-red-50 to-white border border-red-200 hover:border-red-300 hover:shadow-sm transition-all duration-200 group">
                <div className="flex items-center gap-1.5 sm:gap-2 mb-2.5 sm:mb-3">
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-red-100 flex items-center justify-center group-hover:bg-red-200 transition-colors">
                    <XCircle className="w-4 h-4 text-red-500" />
                  </div>
                  <span className="text-[10px] sm:text-xs font-semibold text-red-500/70 uppercase tracking-wider">{t.statistics.failed}</span>
                </div>
                <div className="text-xl sm:text-2xl font-bold text-red-500 leading-none">
                  {overallStats.total_failed}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Daily Breakdown List */}
        <div className="bg-white rounded-xl lg:rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="relative bg-gradient-to-r from-blue-600 to-blue-500 overflow-hidden">
            <div className="absolute top-0 right-0 w-20 sm:w-32 h-20 sm:h-32 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2"></div>
            <div className="absolute bottom-0 left-1/4 w-16 sm:w-24 h-16 sm:h-24 bg-white/5 rounded-full translate-y-1/2"></div>
            <div className="absolute top-1/2 right-1/3 w-8 h-8 bg-sky-300/10 rounded-full -translate-y-1/2 blur-sm"></div>
            <div className="relative px-4 py-3.5 lg:px-6 lg:py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 lg:gap-3 min-w-0">
                  <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-lg bg-white/15 backdrop-blur-sm border border-white/20 flex items-center justify-center flex-shrink-0">
                    <Calendar className="w-5 h-5 text-white" />
                  </div>
                  <h2 className="text-base lg:text-xl font-bold text-white truncate">{t.statistics.dailyBreakdown}</h2>
                  {dailyStats.length > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-white/15 border border-white/20 text-[11px] lg:text-xs font-semibold text-blue-100 tabular-nums flex-shrink-0">
                      {dailyStats.length} {dailyStats.length === 1 ? t.statistics.day : t.statistics.days}
                    </span>
                  )}
                </div>
                {/* Desktop: show day count on right */}
                {dailyStats.length > 0 && dailyStats.length <= ITEMS_PER_PAGE && (
                  <div className="hidden lg:block text-sm text-blue-100 font-medium">
                    {dailyStats.length} {dailyStats.length === 1 ? t.statistics.day : t.statistics.days}
                  </div>
                )}
              </div>
            </div>
            {/* Pagination sub-bar - mobile/tablet only */}
            {dailyStats.length > ITEMS_PER_PAGE && (
              <div className="lg:hidden relative flex items-center justify-between px-4 py-0.5 bg-gradient-to-r from-blue-900/30 via-blue-800/20 to-blue-900/30 border-t border-white/10">
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                  <div className="absolute -left-4 top-1/2 -translate-y-1/2 w-16 h-16 bg-sky-400/8 rounded-full blur-md"></div>
                  <div className="absolute -right-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-blue-300/8 rounded-full blur-md"></div>
                </div>
                <button
                  onClick={() => setCurrentPage(p => p - 1)}
                  disabled={!canGoPrev}
                  className="relative w-8 h-6 rounded flex items-center justify-center text-white disabled:opacity-30 disabled:cursor-not-allowed active:bg-white/15 transition-all"
                >
                  <ChevronLeft className="w-5 h-5" strokeWidth={3} />
                </button>
                <span className="relative text-sm font-bold text-white tabular-nums">
                  {currentPage + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(p => p + 1)}
                  disabled={!canGoNext}
                  className="relative w-8 h-6 rounded flex items-center justify-center text-white disabled:opacity-30 disabled:cursor-not-allowed active:bg-white/15 transition-all"
                >
                  <ChevronRight className="w-5 h-5" strokeWidth={3} />
                </button>
              </div>
            )}
          </div>

          <div className="p-4 md:pb-2 lg:p-6">
          {dailyStats.length === 0 ? (
            <div className="text-center py-12 lg:py-16">
              <div className="inline-flex items-center justify-center w-16 h-16 lg:w-20 lg:h-20 rounded-full bg-gray-50 mb-4">
                <Calendar className="w-8 h-8 lg:w-10 lg:h-10 text-gray-400" />
              </div>
              <p className="text-sm lg:text-base text-gray-500 font-medium">{t.statistics.noData}</p>
              <p className="text-xs lg:text-sm text-gray-400 mt-1">{t.statistics.noDataHint}</p>
            </div>
          ) : (
            <>
              {/* Tablet View - Compact List with Refined Design */}
              {isTabletDevice && (
                <div className="relative space-y-2">
                  {paginatedStats.map((stat, index) => (
                    <div
                      key={`tablet-${stat.date}-${index}`}
                      className="relative bg-gray-50 rounded-lg border border-gray-200 overflow-hidden shadow-sm hover:shadow-md hover:bg-blue-50 transition-all duration-200"
                      style={{ willChange: 'auto' }}
                    >
                      <div className="relative px-3 py-2.5">
                        {/* First Row: Date and Total Orders - Compact spacing */}
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className="p-1 bg-blue-500/10 rounded-md">
                              <Calendar className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                            </div>
                            <span className="text-sm font-bold text-gray-900 tracking-wide">{stat.date}</span>
                          </div>
                          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-500/10 rounded-md border border-blue-500/20">
                            <TrendingUp className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                            <span className="text-sm font-bold text-blue-700">{stat.total_orders}</span>
                          </div>
                        </div>

                        {/* Second Row: Success, Failed - Compact horizontal layout */}
                        <div className="flex items-center gap-2 mb-2">
                          {/* Success - Compact */}
                          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-500/10 rounded-md border border-green-500/20">
                            <CheckCircle className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                            <span className="text-sm font-bold text-green-400">{stat.success_count}</span>
                          </div>

                          {/* Failed - Compact */}
                          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-red-500/10 rounded-md border border-red-500/20">
                            <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                            <span className="text-sm font-bold text-red-400">{stat.failure_count}</span>
                          </div>
                        </div>

                        {/* Third Row: Commission, Tips, Earnings */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            {/* Commission */}
                            <div className="flex items-center gap-1 px-2 py-1 bg-indigo-500/10 rounded-md border border-indigo-500/20">
                              <TrendingUp className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                              <span className="text-xs font-bold text-indigo-500">${stat.daily_commission.toFixed(2)}</span>
                            </div>

                            {/* Tips */}
                            <div className="flex items-center gap-1 px-2 py-1 bg-pink-500/10 rounded-md border border-pink-500/20">
                              <Gift className="w-3.5 h-3.5 text-pink-400 flex-shrink-0" />
                              <span className="text-xs font-bold text-pink-500">${stat.daily_tips.toFixed(2)}</span>
                            </div>
                          </div>

                          {/* Earnings - Total */}
                          <div className="flex items-center gap-1 px-2.5 py-1 bg-gradient-to-r from-emerald-500/12 to-teal-500/12 rounded-md border border-emerald-500/25">
                            <DollarSign className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                            <span className="text-sm font-black text-emerald-400 whitespace-nowrap tracking-wide">
                              {stat.daily_earnings.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Mobile View - Optimized */}
              {!isTabletDevice && (
                <div className="relative lg:hidden space-y-1.5">
                {paginatedStats.map((stat, index) => (
                  <div
                    key={`${stat.date}-${index}`}
                    className="relative bg-gray-50 rounded border border-gray-200 overflow-hidden shadow-sm"
                    style={{ willChange: 'auto' }}
                  >
                    <div className="relative px-3 py-2">
                      {/* First Row: Date and Total Orders */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                          <span className="text-xs font-bold text-gray-900">{stat.date}</span>
                        </div>
                        <div className="flex items-center gap-1 px-2 py-0.5 bg-blue-500/10 rounded-full border border-blue-500/20">
                          <TrendingUp className="w-3 h-3 text-blue-400 flex-shrink-0" />
                          <span className="text-xs font-bold text-blue-700">{stat.total_orders}</span>
                        </div>
                      </div>

                      {/* Second Row: Success, Failed */}
                      <div className="flex items-center gap-2 mb-2">
                        {/* Success */}
                        <div className="flex items-center gap-1 px-2 py-1 bg-green-500/10 rounded border border-green-500/20">
                          <CheckCircle className="w-3 h-3 text-green-400 flex-shrink-0" />
                          <span className="text-xs font-bold text-green-400">{stat.success_count}</span>
                        </div>

                        {/* Failed */}
                        <div className="flex items-center gap-1 px-2 py-1 bg-red-500/10 rounded border border-red-500/20">
                          <XCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
                          <span className="text-xs font-bold text-red-400">{stat.failure_count}</span>
                        </div>
                      </div>

                      {/* Third Row: Commission, Tips, Earnings */}
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5">
                          {/* Commission */}
                          <div className="flex items-center gap-0.5 px-1.5 py-0.5 bg-indigo-500/10 rounded border border-indigo-500/20">
                            <TrendingUp className="w-3 h-3 text-indigo-400 flex-shrink-0" />
                            <span className="text-[10px] font-bold text-indigo-500">${stat.daily_commission.toFixed(2)}</span>
                          </div>

                          {/* Tips */}
                          <div className="flex items-center gap-0.5 px-1.5 py-0.5 bg-pink-500/10 rounded border border-pink-500/20">
                            <Gift className="w-3 h-3 text-pink-400 flex-shrink-0" />
                            <span className="text-[10px] font-bold text-pink-500">${stat.daily_tips.toFixed(2)}</span>
                          </div>
                        </div>

                        {/* Earnings */}
                        <div className="flex items-center gap-0.5 px-2.5 py-1 bg-gradient-to-r from-emerald-500/15 to-teal-500/15 rounded border border-emerald-500/30">
                          <DollarSign className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                          <span className="text-sm font-black text-emerald-400 whitespace-nowrap">
                            {stat.daily_earnings.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                </div>
              )}

              {/* Desktop View */}
              {!isTabletDevice && (
                <div className="hidden lg:block overflow-hidden rounded-xl border border-gray-200">
                <div className="max-h-[450px] overflow-y-auto hide-scrollbar" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                  <table className="w-full">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left px-4 py-2.5 text-xs font-bold text-gray-600 uppercase tracking-wider">
                          <div className="flex items-center gap-2">
                            <Calendar className="w-3.5 h-3.5 text-blue-400" />
                            {t.statistics.date}
                          </div>
                        </th>
                        <th className="text-center px-3 py-2.5 text-xs font-bold text-gray-600 uppercase tracking-wider">
                          <div className="flex items-center justify-center gap-1.5">
                            <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
                            {t.statistics.totalOrders}
                          </div>
                        </th>
                        <th className="text-center px-3 py-2.5 text-xs font-bold text-gray-600 uppercase tracking-wider">
                          <div className="flex items-center justify-center gap-1.5">
                            <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                            {t.statistics.successOrders}
                          </div>
                        </th>
                        <th className="text-center px-3 py-2.5 text-xs font-bold text-gray-600 uppercase tracking-wider">
                          <div className="flex items-center justify-center gap-1.5">
                            <XCircle className="w-3.5 h-3.5 text-red-400" />
                            {t.statistics.failedOrders}
                          </div>
                        </th>
                        <th className="text-right px-3 py-2.5 text-xs font-bold text-gray-600 uppercase tracking-wider">
                          <div className="flex items-center justify-end gap-1.5">
                            <TrendingUp className="w-3.5 h-3.5 text-indigo-400" />
                            {t.statistics.commission}
                          </div>
                        </th>
                        <th className="text-right px-3 py-2.5 text-xs font-bold text-gray-600 uppercase tracking-wider">
                          <div className="flex items-center justify-end gap-1.5">
                            <Gift className="w-3.5 h-3.5 text-pink-400" />
                            {t.statistics.tips}
                          </div>
                        </th>
                        <th className="text-right px-4 py-2.5 text-xs font-bold text-gray-600 uppercase tracking-wider">
                          <div className="flex items-center justify-end gap-1.5">
                            <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                            {t.statistics.earned}
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyStats.map((stat, index) => (
                        <tr
                          key={`${stat.date}-${index}`}
                          className="border-b border-gray-200 hover:bg-blue-50 transition-colors"
                        >
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="w-1 h-1 rounded-full bg-blue-400"></div>
                              <span className="text-sm text-gray-700 font-medium">{stat.date}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span className="text-sm font-bold text-gray-900">{stat.total_orders}</span>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span className="text-sm font-bold text-green-400">{stat.success_count}</span>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span className="text-sm font-bold text-red-400">{stat.failure_count}</span>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <span className="text-sm font-bold text-indigo-500">${stat.daily_commission.toFixed(2)}</span>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <span className="text-sm font-bold text-pink-500">${stat.daily_tips.toFixed(2)}</span>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <span className="text-sm font-bold text-emerald-400">
                              ${stat.daily_earnings.toFixed(2)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </div>
              )}
            </>
          )}
          </div>
        </div>
      </div>
    </>
  );
}
