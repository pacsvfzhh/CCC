import { useState, useRef, useCallback } from 'react';
import { Search, X, User, Calendar, Mail, Phone, Wallet, FileText, CheckCircle, XCircle, Clock, ChevronDown, ChevronUp } from 'lucide-react';
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
  first_success_order_date: string;
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

    // Cancel any ongoing search
    if (searchAbortController.current) {
      searchAbortController.current.abort();
    }

    // Create new abort controller
    searchAbortController.current = new AbortController();

    setLoading(true);
    setHasSearched(true);
    setProgress({ step: 0, totalSteps: 5, currentTask: 'Initializing search...', percentage: 0 });

    try {
      // Step 1: Search in users table for username and employee_id (exact match)
      setProgress({ step: 1, totalSteps: 5, currentTask: 'Searching users by username and ID...', percentage: 20 });
      const { data: usersFromDirect, error: userError } = await supabase
        .from('users')
        .select('*')
        .or(`username.eq.${trimmedValue},employee_id.eq.${trimmedValue}`);

      if (userError) {
        console.error('User search error:', userError);
        throw userError;
      }

      // Step 2: Search in verification_requests table for personal info (exact match)
      setProgress({ step: 2, totalSteps: 5, currentTask: 'Searching verification records...', percentage: 40 });
      const { data: verifications, error: verError } = await supabase
        .from('verification_requests')
        .select('*')
        .or(`real_name.eq.${trimmedValue},email.eq.${trimmedValue},phone.eq.${trimmedValue},wallet_address.eq.${trimmedValue}`);

      if (verError) {
        console.error('Verification search error:', verError);
        throw verError;
      }

      // Step 3: Processing and combining results
      setProgress({ step: 3, totalSteps: 5, currentTask: 'Processing search results...', percentage: 60 });
      const userIdsFromDirect = usersFromDirect?.map(u => u.id) || [];
      const userIdsFromVerifications = verifications?.map(v => v.user_id) || [];
      const allUserIds = [...new Set([...userIdsFromDirect, ...userIdsFromVerifications])];

      console.log('Search complete:', {
        directUsers: userIdsFromDirect.length,
        verificationUsers: userIdsFromVerifications.length,
        totalUnique: allUserIds.length
      });

      // If no results, return empty array
      if (allUserIds.length === 0) {
        setProgress({ step: 5, totalSteps: 5, currentTask: 'Complete', percentage: 100 });
        setResults([]);
        return;
      }

      // Step 4: Fetch complete user data
      setProgress({ step: 4, totalSteps: 5, currentTask: 'Fetching complete user data...', percentage: 80 });
      const { data: allUsers, error: allUsersError } = await supabase
        .from('users')
        .select('*')
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

      // Fetch wallet balances
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

      // Fetch admin information
      const adminIds = [...new Set((allUsers || []).map(u => u.created_by))].filter(Boolean);
      const { data: adminData, error: adminError } = await supabase
        .from('admins')
        .select('id, username, role')
        .in('id', adminIds);

      if (adminError) {
        console.error('Admin fetch error:', adminError);
      }

      const adminMap = new Map((adminData || []).map(admin => [admin.id, admin]));

      // Step 5: Finalizing results
      setProgress({ step: 5, totalSteps: 5, currentTask: 'Finalizing results...', percentage: 90 });
      const combined = (allUsers || []).map(user => {
        // Only show verification info if user is currently verified
        // Find the most recent approved verification request
        const verificationInfo = user.is_verified
          ? allVerifications?.find(v => v.user_id === user.id && v.status === 'approved')
          : undefined;

        const admin = adminMap.get(user.created_by);
        const wallet = walletMap.get(user.id);

        // Calculate total balance (available + frozen)
        const totalBalance = wallet
          ? Number(wallet.available_balance) + Number(wallet.frozen_balance)
          : 0;

        return {
          ...user,
          total_income: totalBalance, // Override with actual wallet balance
          admin_info: admin ? { username: admin.username, role: admin.role } : undefined,
          verification_info: verificationInfo
        };
      });

      console.log('Final results:', combined.length);
      setProgress({ step: 5, totalSteps: 5, currentTask: 'Complete', percentage: 100 });
      setResults(combined);
    } catch (error: any) {
      // Ignore abort errors
      if (error?.name === 'AbortError') {
        console.log('Search aborted');
        setProgress(null);
        return;
      }
      console.error('Search error:', error);
      setResults([]);
    } finally {
      setLoading(false);
      // Clear progress after a short delay
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
  };

  const toggleCard = (userId: string) => {
    setExpandedCard(expandedCard === userId ? null : userId);
  };

  return (
    <div className="space-y-6">
      {/* Search Form */}
      <div className="bg-white rounded-xl shadow-md p-6">
        <div className="max-w-4xl mx-auto">
          <label className="block text-sm font-medium text-gray-700 mb-3">
            Search Employee
            <span className="ml-2 text-gray-500 font-normal text-xs">
              (Username, Employee ID, Name, Email, Phone, or Wallet Address)
            </span>
          </label>
          <div className="flex gap-3">
            {/* Search Input */}
            <div className="relative flex-1">
              <input
                type="text"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Enter any employee information to search..."
                className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base"
              />
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            </div>

            {/* Clear Button */}
            {searchValue && (
              <button
                onClick={clearSearch}
                className="px-4 py-3 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-colors flex items-center gap-2 font-medium"
                title="Clear search"
              >
                <X className="w-5 h-5" />
                Clear
              </button>
            )}

            {/* Search Button */}
            <button
              onClick={handleSearch}
              disabled={loading || !searchValue.trim()}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors disabled:bg-blue-400 flex items-center gap-2 min-w-[120px] justify-center"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Searching
                </>
              ) : (
                <>
                  <Search className="w-5 h-5" />
                  Search
                </>
              )}
            </button>
          </div>

          {/* Progress Bar */}
          {progress && (
            <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span className="text-sm font-medium text-blue-900">{progress.currentTask}</span>
                </div>
                <span className="text-sm font-semibold text-blue-700">
                  {progress.step}/{progress.totalSteps}
                </span>
              </div>

              {/* Progress Bar */}
              <div className="relative w-full h-2 bg-blue-100 rounded-full overflow-hidden">
                <div
                  className="absolute top-0 left-0 h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-300 ease-out"
                  style={{ width: `${progress.percentage}%` }}
                >
                  <div className="absolute inset-0 bg-blue-400 opacity-50 animate-pulse"></div>
                </div>
              </div>

              {/* Step Indicators */}
              <div className="flex justify-between mt-3">
                {[1, 2, 3, 4, 5].map((step) => (
                  <div
                    key={step}
                    className={`flex flex-col items-center transition-all duration-300 ${
                      step <= progress.step ? 'opacity-100' : 'opacity-40'
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                        step < progress.step
                          ? 'bg-green-500 text-white'
                          : step === progress.step
                          ? 'bg-blue-600 text-white ring-4 ring-blue-200'
                          : 'bg-gray-200 text-gray-500'
                      }`}
                    >
                      {step < progress.step ? '✓' : step}
                    </div>
                    <span className="text-[10px] text-gray-600 mt-1 text-center max-w-[60px]">
                      {step === 1 && 'Users'}
                      {step === 2 && 'Verify'}
                      {step === 3 && 'Process'}
                      {step === 4 && 'Fetch'}
                      {step === 5 && 'Done'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      {hasSearched && (
        <div className="bg-white rounded-xl shadow-md p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              Search Results
              <span className="ml-2 text-sm text-gray-500">
                ({results.length} {results.length === 1 ? 'employee' : 'employees'} found)
              </span>
            </h3>
          </div>

          {results.length === 0 ? (
            <div className="text-center py-12">
              <Search className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 text-lg">No employees found</p>
              <p className="text-gray-400 text-sm mt-2">Try adjusting your search criteria</p>
            </div>
          ) : (
            <div className="space-y-4">
              {results.map(employee => (
                <div
                  key={employee.id}
                  className="border border-gray-200 rounded-lg overflow-hidden hover:shadow-lg transition-shadow"
                >
                  {/* Admin Group Badge */}
                  {employee.admin_info && (
                    <div className="bg-gradient-to-r from-blue-600 to-cyan-600 px-8 py-5 flex items-center gap-6 shadow-md">
                      <div className="flex items-center gap-3">
                        {employee.admin_info.role === 'super_admin' ? (
                          <>
                            <div className="bg-amber-400/30 p-2.5 rounded-lg backdrop-blur-sm border border-amber-300/40">
                              <svg className="w-7 h-7 text-amber-100" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                              </svg>
                            </div>
                            <div className="flex items-center gap-5">
                              <div className="text-xs text-amber-100 font-medium uppercase tracking-wider">Managed by</div>
                              <span className="px-3 py-1 bg-amber-400/20 text-amber-100 text-sm font-bold rounded-full border border-amber-300/30">
                                SUPER ADMIN
                              </span>
                              <div className="h-8 w-px bg-white/40"></div>
                              <span className="text-3xl font-bold text-white tracking-wide drop-shadow-lg">{employee.admin_info.username}</span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="bg-white/20 p-2.5 rounded-lg backdrop-blur-sm border border-white/30">
                              <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
                              </svg>
                            </div>
                            <div className="flex items-center gap-5">
                              <div className="text-xs text-blue-100 font-medium uppercase tracking-wider">Managed by</div>
                              <span className="px-3 py-1 bg-white/20 text-white text-sm font-bold rounded-full border border-white/30">
                                SECONDARY ADMIN
                              </span>
                              <div className="h-8 w-px bg-white/40"></div>
                              <span className="text-3xl font-bold text-white tracking-wide drop-shadow-lg">{employee.admin_info.username}</span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Card Header */}
                  <div
                    onClick={() => toggleCard(employee.id)}
                    className="bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-4 cursor-pointer hover:from-gray-100 hover:to-gray-200 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-full flex items-center justify-center">
                          <User className="w-6 h-6 text-white" />
                        </div>
                        <div>
                          <div className="flex items-center gap-3">
                            <h4 className="font-semibold text-gray-900">{employee.username}</h4>
                            <span className="text-sm text-gray-500">ID: {employee.employee_id}</span>
                            {employee.is_verified && (
                              <span className="flex items-center gap-1 text-green-600 text-sm">
                                <CheckCircle className="w-4 h-4" />
                                Verified
                              </span>
                            )}
                            {!employee.is_active && (
                              <span className="flex items-center gap-1 text-red-600 text-sm">
                                <XCircle className="w-4 h-4" />
                                Inactive
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-sm text-gray-500 mt-1">
                            <Calendar className="w-4 h-4" />
                            Registered: {formatDateUTC(employee.created_at)}
                          </div>
                        </div>
                      </div>
                      <button className="text-gray-400 hover:text-gray-600">
                        {expandedCard === employee.id ? (
                          <ChevronUp className="w-5 h-5" />
                        ) : (
                          <ChevronDown className="w-5 h-5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Expanded Content */}
                  {expandedCard === employee.id && (
                    <div className="px-6 py-4 bg-white">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Account Information */}
                        <div className="space-y-3">
                          <h5 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                            <User className="w-4 h-4 text-blue-600" />
                            Account Information
                          </h5>
                          <InfoRow label="Username" value={employee.username} />
                          <InfoRow label="Employee ID" value={employee.employee_id} />
                          <InfoRow label="Registration Date" value={formatDateUTC(employee.created_at)} />
                          <InfoRow
                            label="Status"
                            value={
                              <span className={`inline-flex items-center gap-1 ${employee.is_active ? 'text-green-600' : 'text-red-600'}`}>
                                {employee.is_active ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                                {employee.is_active ? 'Active' : 'Inactive'}
                              </span>
                            }
                          />
                          <InfoRow
                            label="Identity Verification"
                            value={
                              <span className={`inline-flex items-center gap-1 font-semibold ${employee.is_verified ? 'text-green-600' : 'text-red-600'}`}>
                                {employee.is_verified ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                                {employee.is_verified ? 'Verified' : 'Not Verified'}
                              </span>
                            }
                          />
                          <InfoRow label="Wallet Balance" value={`$${(employee.total_income || 0).toFixed(2)}`} />
                          <InfoRow
                            label="First Success Order"
                            value={employee.first_success_order_date ? formatDateUTC(employee.first_success_order_date) : 'Not started working yet'}
                          />
                        </div>

                        {/* Verification Information */}
                        <div className="space-y-3">
                          <h5 className="font-semibold text-gray-900 mb-3">
                            Verification Information
                          </h5>
                          {employee.verification_info ? (
                            <>
                              <InfoRow
                                label="Full Legal Name"
                                value={employee.verification_info.real_name || 'N/A'}
                              />
                              <InfoRow
                                label="Email Address"
                                value={employee.verification_info.email || 'N/A'}
                                icon={<Mail className="w-4 h-4 text-gray-400" />}
                              />
                              <InfoRow
                                label="Phone Number"
                                value={employee.verification_info.phone || 'N/A'}
                                icon={<Phone className="w-4 h-4 text-gray-400" />}
                              />
                              <InfoRow
                                label="Wallet Address"
                                value={employee.verification_info.wallet_address || 'N/A'}
                                icon={<Wallet className="w-4 h-4 text-gray-400" />}
                                breakAll
                              />
                              <InfoRow
                                label="Verified Date"
                                value={formatDateUTC(employee.verification_info.created_at)}
                                icon={<Calendar className="w-4 h-4 text-gray-400" />}
                              />
                            </>
                          ) : (
                            <div className="flex items-center gap-2 text-red-600 py-4">
                              <Clock className="w-5 h-5" />
                              <span>No verification information available</span>
                            </div>
                          )}
                        </div>

                        {/* Tags and Remarks */}
                        {(employee.tags?.length > 0 || employee.remarks) && (
                          <div className="md:col-span-2 space-y-3 pt-4 border-t border-gray-200">
                            {employee.tags?.length > 0 && (
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Tags</label>
                                <div className="flex flex-wrap gap-2">
                                  {employee.tags.map((tag, index) => (
                                    <span
                                      key={index}
                                      className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium"
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {employee.remarks && (
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Remarks</label>
                                <p className="text-gray-600 bg-gray-50 rounded-lg p-3">{employee.remarks}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
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
    <div className="flex items-start gap-2">
      <span className="text-sm font-medium text-gray-500 min-w-[140px]">{label}:</span>
      <div className="flex items-start gap-2 flex-1">
        {icon}
        {typeof value === 'string' ? (
          <span
            className={`text-sm text-gray-900 ${truncate ? 'truncate' : ''} ${breakAll ? 'break-all' : ''}`}
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
