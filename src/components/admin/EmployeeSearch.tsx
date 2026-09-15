import { useState, useRef, useCallback } from 'react';
import { Search, X, User, Calendar, Mail, Phone, Wallet, CheckCircle, XCircle, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatDateUTC } from '../../lib/dateUtils';

interface EmployeeSearchResult {
  id: string;
  username: string;
  employee_id: string;
  created_at: string;
  is_active: boolean;
  is_verified: boolean;
  created_by: string;
  remarks: string;
  tags: string[];
  total_income: number;
  first_success_order_date: string | null;
  admin_info?: {
    username: string;
    role: string;
  };
  verification_info?: {
    real_name: string;
    email: string;
    phone: string;
    wallet_address: string;
    status: string;
    created_at: string;
  };
}

interface SearchProgress {
  step: number;
  totalSteps: number;
  currentTask: string;
  percentage: number;
}

export default function EmployeeSearch() {
  const [searchValue, setSearchValue] = useState('');
  const [results, setResults] = useState<EmployeeSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [progress, setProgress] = useState<SearchProgress | null>(null);
  const searchAbortController = useRef<AbortController | null>(null);

  const handleSearch = useCallback(async () => {
    const trimmedValue = searchValue.trim();
    if (!trimmedValue) {
      return;
    }

    if (searchAbortController.current) {
      searchAbortController.current.abort();
    }

    searchAbortController.current = new AbortController();
    setLoading(true);
    setHasSearched(true);
    setProgress({ step: 0, totalSteps: 5, currentTask: 'Initializing search...', percentage: 0 });

    try {
      setProgress({ step: 1, totalSteps: 5, currentTask: 'Searching users by username and ID...', percentage: 20 });
      const { data: usersFromDirect, error: userError } = await supabase
        .from('users')
        .select('id, username, employee_id, is_verified, is_active, total_income, first_success_order_date, created_by, remarks, tags, is_pinned, current_session_token, session_created_at, last_heartbeat_at, current_tab_id, created_at, updated_at')
        .or(`username.eq.${trimmedValue},employee_id.eq.${trimmedValue}`);

      if (userError) {
        console.error('User search error:', userError);
        throw userError;
      }

      setProgress({ step: 2, totalSteps: 5, currentTask: 'Searching verification records...', percentage: 40 });
      const { data: verifications, error: verError } = await supabase
        .from('verification_requests')
        .select('*')
        .or(`real_name.eq.${trimmedValue},email.eq.${trimmedValue},phone.eq.${trimmedValue},wallet_address.eq.${trimmedValue}`);

      if (verError) {
        console.error('Verification search error:', verError);
        throw verError;
      }

      setProgress({ step: 3, totalSteps: 5, currentTask: 'Processing search results...', percentage: 60 });
      const userIdsFromDirect = usersFromDirect?.map(u => u.id) || [];
      const userIdsFromVerifications = verifications?.map(v => v.user_id) || [];
      const allUserIds = [...new Set([...userIdsFromDirect, ...userIdsFromVerifications])];

      console.log('Search complete:', {
        directUsers: userIdsFromDirect.length,
        verificationUsers: userIdsFromVerifications.length,
        totalUnique: allUserIds.length
      });

      if (allUserIds.length === 0) {
        setProgress({ step: 5, totalSteps: 5, currentTask: 'Complete', percentage: 100 });
        setResults([]);
        return;
      }

      setProgress({ step: 4, totalSteps: 5, currentTask: 'Fetching complete user data...', percentage: 80 });
      const { data: allUsers, error: allUsersError } = await supabase
        .from('users')
        .select('id, username, employee_id, is_verified, is_active, total_income, first_success_order_date, created_by, remarks, tags, is_pinned, current_session_token, session_created_at, last_heartbeat_at, current_tab_id, created_at, updated_at')
        .in('id', allUserIds);

      if (allUsersError) {
        console.error('All users fetch error:', allUsersError);
        throw allUsersError;
      }

      const { data: allVerifications, error: allVerificationsError } = await supabase
        .from('verification_requests')
        .select('*')
        .in('user_id', allUserIds)
        .order('created_at', { ascending: false });

      if (allVerificationsError) {
        console.error('All verifications fetch error:', allVerificationsError);
        throw allVerificationsError;
      }

      const { data: walletData, error: walletError } = await supabase
        .from('wallets')
        .select('user_id, available_balance, frozen_balance')
        .in('user_id', allUserIds);

      if (walletError) {
        console.error('Wallet fetch error:', walletError);
      }

      const walletMap = new Map((walletData || []).map(wallet => [
        wallet.user_id,
        {
          available_balance: wallet.available_balance || 0,
          frozen_balance: wallet.frozen_balance || 0
        }
      ]));

      const adminIds = [...new Set((allUsers || []).map(u => u.created_by))].filter(Boolean);
      const { data: adminData, error: adminError } = await supabase
        .from('admins')
        .select('id, username, role')
        .in('id', adminIds);

      if (adminError) {
        console.error('Admin fetch error:', adminError);
      }

      const adminMap = new Map((adminData || []).map(admin => [admin.id, admin]));

      setProgress({ step: 5, totalSteps: 5, currentTask: 'Finalizing results...', percentage: 90 });
      const combined = (allUsers || []).map(user => {
        const verificationInfo = user.is_verified
          ? allVerifications?.find(v => v.user_id === user.id && v.status === 'approved')
          : undefined;
        const admin = adminMap.get(user.created_by);
        const wallet = walletMap.get(user.id);
        const totalBalance = wallet
          ? Number(wallet.available_balance) + Number(wallet.frozen_balance)
          : 0;

        return {
          ...user,
          total_income: totalBalance,
          admin_info: admin ? { username: admin.username, role: admin.role } : undefined,
          verification_info: verificationInfo
        };
      });

      console.log('Final results:', combined.length);
      setProgress({ step: 5, totalSteps: 5, currentTask: 'Complete', percentage: 100 });
      setResults(combined);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Search aborted');
        setProgress(null);
        return;
      }
      console.error('Search error:', error);
      setResults([]);
    } finally {
      setLoading(false);
      setTimeout(() => setProgress(null), 500);
    }
  }, [searchValue]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const clearSearch = () => {
    setSearchValue('');
    setResults([]);
    setHasSearched(false);
    setExpandedCard(null);
  };

  const toggleCard = (userId: string) => {
    setExpandedCard(expandedCard === userId ? null : userId);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 text-slate-100">
      <section className="relative shrink-0 overflow-hidden rounded-2xl border border-cyan-800/60 bg-slate-900/80 shadow-[0_16px_40px_rgba(2,6,23,0.28)] backdrop-blur-xl">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(37,99,235,0.18),transparent_35%),radial-gradient(circle_at_92%_0%,rgba(8,145,178,0.14),transparent_32%)]" />
        <div className="relative flex flex-col gap-4 p-4 sm:p-5 xl:flex-row xl:items-end">
          <div className="min-w-0 xl:w-[260px] xl:shrink-0">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300/80">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-400/10 text-cyan-200">
                <Search className="h-3.5 w-3.5" />
              </span>
              Employee Search
            </div>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl">Search the employee directory</h2>
            <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-slate-400">Find an account by username, employee ID, or verified contact information.</p>
          </div>

          <div className="min-w-0 flex-1">
            <label className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
              Search employee records
              <span className="font-medium normal-case tracking-normal text-slate-500">Username · ID · name · email · phone · wallet</span>
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-300/70" />
                <input
                  type="text"
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder="Enter an employee username, ID, or contact..."
                  className="h-11 w-full rounded-xl border border-cyan-900/70 bg-slate-950/70 pl-10 pr-4 text-sm text-slate-100 outline-none transition-[border-color,box-shadow,background-color] placeholder:text-slate-600 hover:border-cyan-700/80 focus:border-cyan-400/70 focus:bg-slate-950 focus:ring-2 focus:ring-cyan-400/15"
                />
              </div>
              {searchValue && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-4 text-sm font-semibold text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-700 hover:text-white"
                  title="Clear search"
                >
                  <X className="h-4 w-4" />
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={handleSearch}
                disabled={loading || !searchValue.trim()}
                className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-blue-300/40 bg-gradient-to-r from-blue-600 to-cyan-600 px-5 text-sm font-bold text-white shadow-[0_8px_22px_rgba(8,145,178,0.2)] transition-[filter,transform,box-shadow] hover:-translate-y-px hover:brightness-110 hover:shadow-[0_10px_26px_rgba(8,145,178,0.3)] active:translate-y-0 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-45 disabled:shadow-none sm:min-w-[126px]"
              >
                {loading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    Searching
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4" />
                    Search
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {progress && (
          <div className="relative border-t border-cyan-900/50 bg-slate-950/35 px-4 py-3 sm:px-5">
            <div className="flex items-center justify-between gap-3 text-xs">
              <div className="flex min-w-0 items-center gap-2 text-cyan-100">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-cyan-200/30 border-t-cyan-200" />
                <span className="truncate">{progress.currentTask}</span>
              </div>
              <span className="shrink-0 font-bold text-cyan-300">{progress.step}/{progress.totalSteps}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-300 transition-all duration-300" style={{ width: `${progress.percentage}%` }} />
            </div>
          </div>
        )}
      </section>

      {hasSearched ? (
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-800/90 bg-slate-900/65 shadow-[0_14px_32px_rgba(2,6,23,0.22)]">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-800/90 px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300/75">Search results</p>
              <h3 className="mt-1 truncate text-base font-semibold text-white">Employee accounts</h3>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1.5 text-xs font-bold text-cyan-100">
              <User className="h-3.5 w-3.5 text-cyan-300" />
              {results.length} {results.length === 1 ? 'employee' : 'employees'}
            </span>
          </div>

          {results.length === 0 ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-14 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-300">
                <Search className="h-7 w-7" />
              </span>
              <p className="mt-4 text-base font-semibold text-slate-200">No employees found</p>
              <p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-500">Try another username, employee ID, or verified contact value.</p>
            </div>
          ) : (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 dark-panel-scroll sm:p-4">
              {results.map(employee => (
                <article
                  key={employee.id}
                  className="overflow-hidden rounded-xl border border-slate-700/80 bg-slate-950/45 shadow-[0_8px_22px_rgba(2,6,23,0.18)] transition-[border-color,background-color,box-shadow] hover:border-cyan-700/70 hover:bg-slate-950/65 hover:shadow-[0_12px_28px_rgba(2,6,23,0.28)]"
                >
                  {employee.admin_info && (
                    <div className={`flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5 sm:px-5 ${employee.admin_info.role === 'super_admin' ? 'border-amber-300/20 bg-gradient-to-r from-amber-500/15 via-slate-900/40 to-cyan-500/10' : 'border-cyan-300/20 bg-gradient-to-r from-blue-500/15 via-slate-900/40 to-cyan-500/10'}`}>
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${employee.admin_info.role === 'super_admin' ? 'border-amber-300/30 bg-amber-300/10 text-amber-200' : 'border-cyan-300/30 bg-cyan-300/10 text-cyan-200'}`}>
                          <User className="h-3.5 w-3.5" />
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Managed by</span>
                        <span className={`truncate text-sm font-bold ${employee.admin_info.role === 'super_admin' ? 'text-amber-100' : 'text-cyan-100'}`}>{employee.admin_info.username}</span>
                      </div>
                      <span className={`rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] ${employee.admin_info.role === 'super_admin' ? 'border-amber-300/25 bg-amber-300/10 text-amber-200' : 'border-cyan-300/25 bg-cyan-300/10 text-cyan-200'}`}>
                        {employee.admin_info.role === 'super_admin' ? 'Super Admin' : 'Secondary Admin'}
                      </span>
                    </div>
                  )}

                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={expandedCard === employee.id}
                    onClick={() => toggleCard(employee.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggleCard(employee.id);
                      }
                    }}
                    className="group flex cursor-pointer items-center justify-between gap-4 px-4 py-3.5 outline-none transition-colors hover:bg-cyan-400/[0.04] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400/60 sm:px-5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-300/25 bg-gradient-to-br from-blue-500/80 to-cyan-500/80 shadow-[0_6px_16px_rgba(6,182,212,0.18)]">
                        <User className="h-5 w-5 text-white" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                          <h4 className="truncate text-sm font-bold text-slate-100 sm:text-base">{employee.username}</h4>
                          <span className="rounded-md border border-slate-700 bg-slate-900/80 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">ID {employee.employee_id}</span>
                          {employee.is_verified && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-300"><CheckCircle className="h-3.5 w-3.5" />Verified</span>
                          )}
                          {!employee.is_active && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-300"><XCircle className="h-3.5 w-3.5" />Inactive</span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
                          <Calendar className="h-3.5 w-3.5 text-slate-600" />
                          Registered {formatDateUTC(employee.created_at)}
                        </div>
                      </div>
                    </div>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-900/70 text-slate-400 transition-colors group-hover:border-cyan-500/50 group-hover:text-cyan-200">
                      {expandedCard === employee.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </span>
                  </div>

                  {expandedCard === employee.id && (
                    <div className="border-t border-slate-800/90 bg-slate-900/45 px-4 py-4 sm:px-5">
                      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                        <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-4">
                          <h5 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-cyan-200"><User className="h-4 w-4 text-cyan-300" />Account information</h5>
                          <div className="mt-3 space-y-2.5">
                            <InfoRow label="Username" value={employee.username} />
                            <InfoRow label="Employee ID" value={employee.employee_id} />
                            <InfoRow label="Registration Date" value={formatDateUTC(employee.created_at)} />
                            <InfoRow label="Status" value={<span className={`inline-flex items-center gap-1 font-semibold ${employee.is_active ? 'text-emerald-300' : 'text-rose-300'}`}>{employee.is_active ? <CheckCircle className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}{employee.is_active ? 'Active' : 'Inactive'}</span>} />
                            <InfoRow label="Identity Verification" value={<span className={`inline-flex items-center gap-1 font-semibold ${employee.is_verified ? 'text-emerald-300' : 'text-rose-300'}`}>{employee.is_verified ? <CheckCircle className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}{employee.is_verified ? 'Verified' : 'Not Verified'}</span>} />
                            <InfoRow label="Wallet Balance" value={`$${(employee.total_income || 0).toFixed(2)}`} />
                            <InfoRow label="First Success Order" value={employee.first_success_order_date ? formatDateUTC(employee.first_success_order_date) : 'Not started working yet'} />
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-4">
                          <h5 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-cyan-200"><CheckCircle className="h-4 w-4 text-cyan-300" />Verification information</h5>
                          {employee.verification_info ? (
                            <div className="mt-3 space-y-2.5">
                              <InfoRow label="Full Legal Name" value={employee.verification_info.real_name || 'N/A'} />
                              <InfoRow label="Email Address" value={employee.verification_info.email || 'N/A'} icon={<Mail className="h-3.5 w-3.5 text-slate-500" />} />
                              <InfoRow label="Phone Number" value={employee.verification_info.phone || 'N/A'} icon={<Phone className="h-3.5 w-3.5 text-slate-500" />} />
                              <InfoRow label="Wallet Address" value={employee.verification_info.wallet_address || 'N/A'} icon={<Wallet className="h-3.5 w-3.5 text-slate-500" />} breakAll />
                              <InfoRow label="Verified Date" value={formatDateUTC(employee.verification_info.created_at)} icon={<Calendar className="h-3.5 w-3.5 text-slate-500" />} />
                            </div>
                          ) : (
                            <div className="mt-4 flex items-center gap-2 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2.5 text-xs text-rose-300"><Clock className="h-4 w-4" />No verification information available</div>
                          )}
                        </div>

                        {(employee.tags?.length > 0 || employee.remarks) && (
                          <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/35 p-4 lg:col-span-2">
                            {employee.tags?.length > 0 && (
                              <div>
                                <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Tags</label>
                                <div className="flex flex-wrap gap-2">
                                  {employee.tags.map((tag, index) => <span key={index} className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-xs font-semibold text-cyan-200">{tag}</span>)}
                                </div>
                              </div>
                            )}
                            {employee.remarks && (
                              <div>
                                <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Remarks</label>
                                <p className="rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-xs leading-relaxed text-slate-300">{employee.remarks}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-slate-800 bg-slate-900/35 px-6 py-12 text-center">
          <div className="max-w-md">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-300 shadow-[0_0_28px_rgba(34,211,238,0.08)]"><Search className="h-7 w-7" /></span>
            <p className="mt-4 text-base font-semibold text-slate-200">Search employee records</p>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">Use the search bar above to bring account, verification, wallet, and administrator ownership details into view.</p>
          </div>
        </section>
      )}
    </div>
  );
}

function InfoRow({
  label,
  value,
  icon,
  truncate = false,
  breakAll = false
}: {
  label: string;
  value: string | React.ReactNode;
  icon?: React.ReactNode;
  truncate?: boolean;
  breakAll?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-slate-800/70 pb-2 last:border-0 last:pb-0">
      <span className="w-[112px] shrink-0 text-[11px] font-medium text-slate-500">{label}</span>
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {icon}
        {typeof value === 'string' ? (
          <span
            className={`min-w-0 text-xs text-slate-200 ${truncate ? 'truncate' : ''} ${breakAll ? 'break-all' : ''}`}
            title={truncate ? value : undefined}
          >
            {value}
          </span>
        ) : (
          value
        )}
      </div>
    </div>
  );
}
