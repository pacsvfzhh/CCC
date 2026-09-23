import { useState, useEffect, useRef } from 'react';
import { CheckCircle, XCircle, Clock, User, Wallet, Phone, Mail, Trash2, RotateCcw, AlertCircle, Eye, EyeOff, FileText, Image as ImageIcon, Shield, Search, Users, X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { formatSupabaseError, supabase } from '../../lib/supabase';
import { VerificationRequest, Employee, Admin } from '../../types';
import { getAdminFinancialSessionToken } from '../../lib/auth';

interface VerificationWithEmployee extends VerificationRequest {
  employee?: Employee;
}

interface VerificationReviewProps {
  admin: Admin;
}

type ViewMode = 'requests' | 'verified' | 'rejected';
type SelectedAdminId = 'all' | string;

interface ImagePreview {
  images: { url: string; label: string }[];
  currentIndex: number;
  scale: number;
}

export default function VerificationReview({ admin }: VerificationReviewProps) {
  const [verifications, setVerifications] = useState<VerificationWithEmployee[]>([]);
  const [verifiedEmployees, setVerifiedEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [reviewAction, setReviewAction] = useState<'approved' | 'rejected' | null>(null);
  const [auditRemark, setAuditRemark] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const [expandedDetails, setExpandedDetails] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>('requests');
  const [selectedAdminId, setSelectedAdminId] = useState<SelectedAdminId>(admin.role === 'super_admin' ? 'all' : admin.id);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [walletBalances, setWalletBalances] = useState<Map<string, number>>(new Map());
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    confirmText: string;
    confirmColor: 'red' | 'amber';
  } | null>(null);
  const [imagePreview, setImagePreview] = useState<ImagePreview | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [imageLoading, setImageLoading] = useState(false);
  const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set());
  const loadVerificationsRef = useRef<(() => Promise<void>) | null>(null);
  const loadVerifiedEmployeesRef = useRef<(() => Promise<void>) | null>(null);
  const loadAdminsRef = useRef<(() => Promise<void>) | null>(null);
  const nextImageRef = useRef<(() => void) | null>(null);
  const prevImageRef = useRef<(() => void) | null>(null);
  const zoomInRef = useRef<(() => void) | null>(null);
  const zoomOutRef = useRef<(() => void) | null>(null);
  const resetZoomRef = useRef<(() => void) | null>(null);
  const isSuperAdmin = admin.role === 'super_admin';

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!imagePreview) return;

      if (e.key === 'Escape') {
        closeImagePreview();
      } else if (e.key === 'ArrowLeft' && imagePreview.currentIndex > 0) {
        prevImageRef.current?.();
      } else if (e.key === 'ArrowRight' && imagePreview.currentIndex < imagePreview.images.length - 1) {
        nextImageRef.current?.();
      } else if (e.key === '+' || e.key === '=') {
        zoomInRef.current?.();
      } else if (e.key === '-' || e.key === '_') {
        zoomOutRef.current?.();
      } else if (e.key === '0') {
        resetZoomRef.current?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [imagePreview]);

  useEffect(() => {
    void loadVerificationsRef.current?.();
    void loadVerifiedEmployeesRef.current?.();
    if (isSuperAdmin) {
      void loadAdminsRef.current?.();
    }

    // Set up real-time subscription for verification requests
    let verifyDebounce: ReturnType<typeof setTimeout> | null = null;
    const verificationChannel = supabase
      .channel('verification-changes')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'verification_requests' },
        (payload) => {
          if (payload.new) {
            setVerifications(prev => prev.map(v =>
              v.id === payload.new.id ? { ...v, ...payload.new } : v
            ));
            return;
          }
          if (verifyDebounce) clearTimeout(verifyDebounce);
          verifyDebounce = setTimeout(() => { void loadVerificationsRef.current?.(); }, 800);
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'verification_requests' },
        () => {
          if (verifyDebounce) clearTimeout(verifyDebounce);
          verifyDebounce = setTimeout(() => { void loadVerificationsRef.current?.(); }, 800);
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'verification_requests' },
        () => {
          if (verifyDebounce) clearTimeout(verifyDebounce);
          verifyDebounce = setTimeout(() => { void loadVerificationsRef.current?.(); }, 800);
        }
      )
      .subscribe();

    // Set up real-time subscription for user verification status changes
    let userDebounce: ReturnType<typeof setTimeout> | null = null;
    const userChannel = supabase
      .channel('user-verification-changes')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users', filter: 'is_verified=eq.true' },
        () => {
          if (userDebounce) clearTimeout(userDebounce);
          userDebounce = setTimeout(() => { void loadVerifiedEmployeesRef.current?.(); }, 800);
        }
      )
      .subscribe();

    // Set up real-time subscription for wallet balance changes
    const walletChannel = supabase
      .channel('wallet-balance-changes')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'wallets' },
        (payload) => {
          console.log('Wallet balance change detected:', payload);
          // Update the balance in the map
          if (payload.new && payload.new.user_id) {
            setWalletBalances(prev => {
              const newMap = new Map(prev);
              newMap.set(payload.new.user_id, Number(payload.new.available_balance) || 0);
              return newMap;
            });
          }
        }
      )
      .subscribe();

    return () => {
      if (verifyDebounce) clearTimeout(verifyDebounce);
      if (userDebounce) clearTimeout(userDebounce);
      supabase.removeChannel(verificationChannel);
      supabase.removeChannel(userChannel);
      supabase.removeChannel(walletChannel);
    };
  }, [isSuperAdmin]);

  const loadVerifications = async () => {
    try {
      console.log('Loading verifications for admin:', admin.id, 'role:', admin.role);

      // Test query to verify connection
      const { data: testData, error: testError } = await supabase
        .from('verification_requests')
        .select('count');
      console.log('Test query - count:', testData, 'error:', testError);

      let employeeIds: string[] = [];

      if (admin.role === 'secondary_admin') {
        const { data: employees } = await supabase
          .from('users')
          .select('id')
          .eq('created_by', admin.id);
        employeeIds = employees?.map((e) => e.id) || [];
        console.log('Secondary admin employee IDs:', employeeIds);
      }

      let query = supabase
        .from('verification_requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (admin.role === 'secondary_admin' && employeeIds.length > 0) {
        query = query.in('user_id', employeeIds);
      }

      const { data: verificationsData, error: verificationsError } = await query;
      console.log('Loaded verifications:', verificationsData);
      console.log('Verifications error:', verificationsError);
      console.log('Verifications count:', verificationsData?.length);
      if (verificationsError) {
        console.error('Error fetching verifications:', verificationsError);
        throw verificationsError;
      }

      const { data: employees } = await supabase.from('users').select('id, username, employee_id, is_verified, is_active, total_income, first_success_order_date, created_by, remarks, tags, is_pinned, current_session_token, session_created_at, last_heartbeat_at, current_tab_id, created_at, updated_at');
      const employeeMap = new Map(employees?.map((e) => [e.id, e]));

      const verificationsWithEmployees = verificationsData?.map((v) => ({
        ...v,
        employee: employeeMap.get(v.user_id),
      })) || [];

      // Sort: pending first, then by created_at descending
      verificationsWithEmployees.sort((a, b) => {
        if (a.status === 'pending' && b.status !== 'pending') return -1;
        if (a.status !== 'pending' && b.status === 'pending') return 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

      setVerifications(verificationsWithEmployees);
      setError(null);
    } catch (error: unknown) {
      console.error('Error loading verifications:', formatSupabaseError(error));
      setError(formatSupabaseError(error) || 'Failed to load verifications');
    } finally {
      setLoading(false);
    }
  };
  loadVerificationsRef.current = loadVerifications;

  const loadVerifiedEmployees = async () => {
    try {
      console.log('Loading verified employees...');

      let query = supabase
        .from('users')
        .select('id, username, employee_id, is_verified, is_active, total_income, first_success_order_date, created_by, remarks, tags, is_pinned, current_session_token, session_created_at, last_heartbeat_at, current_tab_id, created_at, updated_at')
        .eq('is_verified', true)
        .order('created_at', { ascending: false });

      if (admin.role === 'secondary_admin') {
        query = query.eq('created_by', admin.id);
      }

      const { data, error } = await query;
      if (error) throw error;

      console.log('Verified employees loaded:', data);
      setVerifiedEmployees(data || []);

      // Load wallet balances for verified employees
      if (data && data.length > 0) {
        const userIds = data.map(e => e.id);

        // Load wallet balances
        const { data: walletsData, error: walletsError } = await supabase
          .from('wallets')
          .select('user_id, available_balance')
          .in('user_id', userIds);

        if (!walletsError && walletsData) {
          const balanceMap = new Map<string, number>();
          walletsData.forEach(wallet => {
            balanceMap.set(wallet.user_id, Number(wallet.available_balance) || 0);
          });
          setWalletBalances(balanceMap);
          console.log('Wallet balances loaded:', balanceMap);
        }

        // Also reload verifications to ensure we have the verification details
        const { data: verificationData, error: verificationError } = await supabase
          .from('verification_requests')
          .select('*')
          .in('user_id', userIds)
          .eq('status', 'approved');

        console.log('Verification details loaded:', verificationData);
        if (!verificationError && verificationData) {
          // Merge with existing verifications to avoid losing pending requests
          setVerifications(prev => {
            const newVerifications = [...prev];
            verificationData.forEach(v => {
              const index = newVerifications.findIndex(nv => nv.id === v.id);
              if (index === -1) {
                newVerifications.push(v);
              }
            });
            return newVerifications;
          });
        }
      }
    } catch (error: unknown) {
      console.error('Error loading verified employees:', formatSupabaseError(error));
    }
  };
  loadVerifiedEmployeesRef.current = loadVerifiedEmployees;

  const loadAdmins = async () => {
    try {
      const { data, error } = await supabase
        .from('admins')
        .select('id, username, role, parent_id, is_active, is_pinned, created_at, updated_at')
        .eq('is_active', true)
        .order('username', { ascending: true });

      if (error) throw error;
      setAdmins(data || []);
      console.log('Admins loaded:', data);
    } catch (error: unknown) {
      console.error('Error loading admins:', formatSupabaseError(error));
    }
  };
  loadAdminsRef.current = loadAdmins;

  const handleReview = async (verificationId: string, status: 'approved' | 'rejected') => {
    if (status === 'rejected' && !auditRemark.trim()) {
      setValidationError('Please provide a reason for rejection and specify what documents are needed');
      return;
    }

    // Clear any previous errors
    setValidationError(null);

    try {
      const verification = verifications.find((v) => v.id === verificationId);
      if (!verification) {
        console.error('Verification not found:', verificationId);
        return;
      }

      console.log('Reviewing verification:', {
        verificationId,
        status,
        auditRemark,
        adminId: admin.id,
      });

      const updateData = {
        status,
        audit_remark: auditRemark || null,
        audited_by: admin.id,
        audited_at: new Date().toISOString(),
      };

      console.log('Updating with data:', updateData);

      const { data: updateResult, error: updateError } = await supabase
        .from('verification_requests')
        .update(updateData)
        .eq('id', verificationId)
        .select();

      console.log('Update result:', { updateResult, updateError });

      if (updateError) {
        console.error('Update error details:', updateError);
        throw updateError;
      }

      if (status === 'approved') {
        console.log('Updating user verification status for user:', verification.user_id);
        const { error: userError } = await supabase.rpc('admin_update_employee_account', {
          p_admin_session_token: getAdminFinancialSessionToken(),
          p_user_id: verification.user_id,
          p_updates: { is_verified: true },
        });

        if (userError) {
          console.error('User update error:', userError);
          throw userError;
        }
      }

      console.log('Review completed successfully');

      // Update local state immediately for instant feedback
      setVerifications((prev) =>
        prev.map((v) =>
          v.id === verificationId
            ? {
                ...v,
                status: status as 'pending' | 'approved' | 'rejected',
                audit_remark: auditRemark || null,
                audited_by: admin.id,
                audited_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              }
            : v
        )
      );

      setReviewing(null);
      setReviewAction(null);
      setAuditRemark('');
      setValidationError(null);

      // Reload from server to ensure consistency
      console.log('Reloading verifications from server...');
      await loadVerifications();

      // If approved, also reload verified employees list
      if (status === 'approved') {
        console.log('Reloading verified employees...');
        await loadVerifiedEmployees();
      }
      console.log('Verifications reloaded');
    } catch (error) {
      console.error('Error reviewing verification:', error);
      setError(`Failed to review verification: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleDelete = async (verificationId: string) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Delete Verification Request',
      message: 'Are you sure you want to delete this verification request? This action cannot be undone.',
      confirmText: 'Delete',
      confirmColor: 'red',
      onConfirm: async () => {
        setConfirmDialog(null);
        setDeleting(verificationId);
        try {
          const { error } = await supabase
            .from('verification_requests')
            .delete()
            .eq('id', verificationId);

          if (error) throw error;

          // Update local state immediately
          setVerifications((prev) => prev.filter((v) => v.id !== verificationId));

          // Reload from server to ensure consistency
          await loadVerifications();
        } catch (error) {
          console.error('Error deleting verification:', error);
          setError('Failed to delete verification request');
        } finally {
          setDeleting(null);
        }
      }
    });
  };

  const handleReset = async (verificationId: string) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Reset Verification Request',
      message: 'Are you sure you want to reset this verification request to pending status? This will allow the employee to resubmit.',
      confirmText: 'Reset to Pending',
      confirmColor: 'amber',
      onConfirm: async () => {
        setConfirmDialog(null);
        setResetting(verificationId);
        try {
          const verification = verifications.find((v) => v.id === verificationId);
          if (!verification) return;

          const { error: updateError } = await supabase
            .from('verification_requests')
            .update({
              status: 'pending',
              audit_remark: null,
              audited_by: null,
              audited_at: null,
            })
            .eq('id', verificationId);

          if (updateError) throw updateError;

          if (verification.status === 'approved') {
            const { error: userError } = await supabase.rpc('admin_update_employee_account', {
              p_admin_session_token: getAdminFinancialSessionToken(),
              p_user_id: verification.user_id,
              p_updates: { is_verified: false },
            });

            if (userError) throw userError;
          }

          // Update local state immediately
          setVerifications((prev) =>
            prev.map((v) =>
              v.id === verificationId
                ? {
                    ...v,
                    status: 'pending',
                    audit_remark: null,
                    audited_by: null,
                    audited_at: null,
                  }
                : v
            )
          );

          // Reload from server to ensure consistency
          await loadVerifications();
        } catch (error) {
          console.error('Error resetting verification:', error);
          setError('Failed to reset verification request');
        } finally {
          setResetting(null);
        }
      }
    });
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      pending: 'border-amber-400/40 bg-amber-500/10 text-amber-300',
      approved: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300',
      rejected: 'border-rose-400/40 bg-rose-500/10 text-rose-300',
    };
    const labels = { pending: '待审核', approved: '已验证', rejected: '已拒绝' };
    const icons = {
      pending: <Clock className="h-3.5 w-3.5" />,
      approved: <CheckCircle className="h-3.5 w-3.5" />,
      rejected: <XCircle className="h-3.5 w-3.5" />,
    };
    const typedStatus = status as keyof typeof styles;

    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-black ${styles[typedStatus]}`}>
        {icons[typedStatus]}
        {labels[typedStatus]}
      </span>
    );
  };

  const adminOptions = Array.from(
    new Map([admin, ...admins].map(adminOption => [adminOption.id, adminOption])).values()
  ).sort((a, b) => {
    if (a.id === admin.id) return -1;
    if (b.id === admin.id) return 1;
    return a.username.localeCompare(b.username);
  });

  const employeeOwnerById = new Map<string, string>();
  verifiedEmployees.forEach(employee => employeeOwnerById.set(employee.id, employee.created_by));
  verifications.forEach(verification => {
    if (verification.employee?.created_by) {
      employeeOwnerById.set(verification.user_id, verification.employee.created_by);
    }
  });

  const getVerificationOwnerId = (verification: VerificationWithEmployee) =>
    verification.employee?.created_by || employeeOwnerById.get(verification.user_id) || '';

  const matchesVerificationSearch = (verification: VerificationWithEmployee) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    const employee = verification.employee || verifiedEmployees.find(item => item.id === verification.user_id);
    return [
      employee?.id,
      employee?.employee_id,
      employee?.username,
      verification.phone,
      verification.email,
      verification.wallet_address,
      verification.real_name,
    ].some(value => value?.toLowerCase().includes(query));
  };

  const matchesEmployeeSearch = (employee: Employee) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    const verification = verifications.find(item => item.user_id === employee.id && item.status === 'approved');
    return [
      employee.id,
      employee.employee_id,
      employee.username,
      verification?.phone,
      verification?.email,
      verification?.wallet_address,
      verification?.real_name,
    ].some(value => value?.toLowerCase().includes(query));
  };

  const belongsToSelectedAdmin = (ownerId: string) =>
    !isSuperAdmin || selectedAdminId === 'all' || ownerId === selectedAdminId;

  const pendingVerifications = verifications.filter(item => item.status === 'pending');
  const rejectedVerifications = verifications.filter(item => item.status === 'rejected');
  const filteredVerifications = pendingVerifications.filter(item =>
    belongsToSelectedAdmin(getVerificationOwnerId(item)) && matchesVerificationSearch(item)
  );
  const filteredRejectedVerifications = rejectedVerifications.filter(item =>
    belongsToSelectedAdmin(getVerificationOwnerId(item)) && matchesVerificationSearch(item)
  );
  const filteredVerifiedEmployees = verifiedEmployees.filter(item =>
    belongsToSelectedAdmin(item.created_by) && matchesEmployeeSearch(item)
  );

  const overallStats = {
    pending: pendingVerifications.length,
    approved: verifiedEmployees.length,
    rejected: rejectedVerifications.length,
  };

  const getAdminStats = (adminId: string) => ({
    pending: pendingVerifications.filter(item => getVerificationOwnerId(item) === adminId).length,
    approved: verifiedEmployees.filter(item => item.created_by === adminId).length,
    rejected: rejectedVerifications.filter(item => getVerificationOwnerId(item) === adminId).length,
  });

  const selectedAdminName = selectedAdminId === 'all'
    ? '全部管理员'
    : adminOptions.find(item => item.id === selectedAdminId)?.username || admin.username;
  const selectedGroupStats = selectedAdminId === 'all' ? overallStats : getAdminStats(selectedAdminId);

  const activeResultCount = viewMode === 'requests'
    ? filteredVerifications.length
    : viewMode === 'verified'
      ? filteredVerifiedEmployees.length
      : filteredRejectedVerifications.length;

  const clearReviewDraft = () => {
    setReviewing(null);
    setReviewAction(null);
    setAuditRemark('');
    setValidationError(null);
  };

  const applyContextChange = (nextViewMode: ViewMode, nextAdminId: SelectedAdminId) => {
    clearReviewDraft();
    setExpandedDetails(new Set());
    setSelectedEmployee(null);
    setViewMode(nextViewMode);
    setSelectedAdminId(nextAdminId);
  };

  const changeContext = (nextViewMode: ViewMode, nextAdminId: SelectedAdminId) => {
    if (reviewing && (reviewAction || auditRemark.trim())) {
      setConfirmDialog({
        isOpen: true,
        title: '放弃当前审核内容？',
        message: '切换状态或管理员分组后，尚未提交的审核备注将被清除。',
        confirmText: '放弃并切换',
        confirmColor: 'amber',
        onConfirm: () => {
          setConfirmDialog(null);
          applyContextChange(nextViewMode, nextAdminId);
        },
      });
      return;
    }
    applyContextChange(nextViewMode, nextAdminId);
  };

  const getAdminName = (adminId: string) =>
    adminOptions.find(item => item.id === adminId)?.username || adminId;

  const toggleDetails = (verificationId: string) => {
    const newExpanded = new Set(expandedDetails);
    if (newExpanded.has(verificationId)) {
      newExpanded.delete(verificationId);
    } else {
      newExpanded.add(verificationId);
    }
    setExpandedDetails(newExpanded);
  };

  const openImagePreview = (verification: VerificationWithEmployee) => {
    const images: { url: string; label: string }[] = [];

    if (verification.id_front_url) {
      images.push({ url: verification.id_front_url, label: 'ID Front' });
    }
    if (verification.id_back_url) {
      images.push({ url: verification.id_back_url, label: 'ID Back' });
    }
    if (verification.selfie_url) {
      images.push({ url: verification.selfie_url, label: 'Selfie Photo' });
    }

    if (images.length > 0) {
      setImagePreview({ images, currentIndex: 0, scale: 1 });
      setPosition({ x: 0, y: 0 });
      setImageLoading(!loadedImages.has(images[0].url));
      document.body.style.overflow = 'hidden';
    }
  };

  const closeImagePreview = () => {
    setImagePreview(null);
    setPosition({ x: 0, y: 0 });
    setImageLoading(false);
    document.body.style.overflow = 'unset';
  };

  const handleImageLoad = (url: string) => {
    setLoadedImages(prev => new Set(prev).add(url));
    setImageLoading(false);
  };

  const nextImage = () => {
    if (imagePreview && imagePreview.currentIndex < imagePreview.images.length - 1) {
      const nextIndex = imagePreview.currentIndex + 1;
      const nextUrl = imagePreview.images[nextIndex].url;
      setImagePreview({ ...imagePreview, currentIndex: nextIndex });
      setPosition({ x: 0, y: 0 });
      setImageLoading(!loadedImages.has(nextUrl));
    }
  };

  const prevImage = () => {
    if (imagePreview && imagePreview.currentIndex > 0) {
      const prevIndex = imagePreview.currentIndex - 1;
      const prevUrl = imagePreview.images[prevIndex].url;
      setImagePreview({ ...imagePreview, currentIndex: prevIndex });
      setPosition({ x: 0, y: 0 });
      setImageLoading(!loadedImages.has(prevUrl));
    }
  };

  const zoomIn = () => {
    if (imagePreview && imagePreview.scale < 3) {
      setImagePreview({ ...imagePreview, scale: imagePreview.scale + 0.25 });
    }
  };

  const zoomOut = () => {
    if (imagePreview && imagePreview.scale > 0.5) {
      setImagePreview({ ...imagePreview, scale: imagePreview.scale - 0.25 });
      if (imagePreview.scale <= 1) {
        setPosition({ x: 0, y: 0 });
      }
    }
  };

  const resetZoom = () => {
    if (imagePreview) {
      setImagePreview({ ...imagePreview, scale: 1 });
      setPosition({ x: 0, y: 0 });
    }
  };

  nextImageRef.current = nextImage;
  prevImageRef.current = prevImage;
  zoomInRef.current = zoomIn;
  zoomOutRef.current = zoomOut;
  resetZoomRef.current = resetZoom;

  const handleMouseDown = (e: React.MouseEvent) => {
    if (imagePreview && imagePreview.scale > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && imagePreview && imagePreview.scale > 1) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const renderVerificationCard = (verification: VerificationWithEmployee) => {
    const employee = verification.employee || verifiedEmployees.find(item => item.id === verification.user_id);
    const isExpanded = expandedDetails.has(verification.id);
    const ownerId = getVerificationOwnerId(verification);
    const isPending = verification.status === 'pending';
    const isRejected = verification.status === 'rejected';
    const hasDocuments = Boolean(verification.id_front_url || verification.id_back_url || verification.selfie_url);
    const tone = isPending
      ? 'border-amber-400/30 bg-[linear-gradient(145deg,rgba(120,53,15,0.18),rgba(15,23,42,0.96)_42%)]'
      : 'border-rose-400/30 bg-[linear-gradient(145deg,rgba(127,29,29,0.16),rgba(15,23,42,0.96)_42%)]';

    return (
      <article key={verification.id} className={`overflow-hidden rounded-2xl border shadow-lg shadow-slate-950/20 ${tone}`}>
        <div className="flex flex-col xl:grid xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0 p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-2.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-black text-white">{employee?.username || '未知员工'}</span>
                  <span className="rounded-md border border-slate-600/70 bg-slate-950/50 px-2 py-0.5 text-[10px] font-bold text-slate-300">{employee?.employee_id || verification.user_id}</span>
                  {getStatusBadge(verification.status)}
                  {isSuperAdmin && ownerId && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2 py-1 text-[10px] font-black text-cyan-200">
                      <Users className="h-3 w-3" />{getAdminName(ownerId)}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[10px] font-medium text-slate-500">提交于 {new Date(verification.created_at).toLocaleString()}</p>
              </div>
              <button
                type="button"
                onClick={() => toggleDetails(verification.id)}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-blue-400/25 bg-blue-500/10 px-2.5 text-[10px] font-black text-blue-200 transition hover:border-blue-300/45 hover:bg-blue-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
              >
                {isExpanded ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {isExpanded ? '收起详情' : '查看详情'}
              </button>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2 2xl:grid-cols-4">
              {[
                { icon: User, label: '真实姓名', value: verification.real_name },
                { icon: Phone, label: '电话号码', value: verification.phone },
                { icon: Mail, label: '邮箱地址', value: verification.email },
                { icon: Wallet, label: '钱包地址', value: verification.wallet_address },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="min-w-0 rounded-xl border border-slate-700/60 bg-slate-950/35 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider text-slate-500"><Icon className="h-3 w-3 text-cyan-400/70" />{label}</div>
                  <div className={`mt-1 break-words text-xs font-semibold text-slate-200 ${label === '钱包地址' ? 'font-mono' : ''}`}>{value || '—'}</div>
                </div>
              ))}
            </div>

            {isExpanded && (
              <div className="mt-3 rounded-xl border border-blue-400/20 bg-slate-950/45 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-blue-300">验证资料</p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      {verification.audited_at ? `最近审核：${new Date(verification.audited_at).toLocaleString()}` : '尚未审核'}
                    </p>
                  </div>
                  {hasDocuments && (
                    <button
                      type="button"
                      onClick={() => openImagePreview(verification)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 text-[10px] font-black text-cyan-200 transition hover:bg-cyan-500/20"
                    >
                      <ImageIcon className="h-3.5 w-3.5" />查看验证证件
                    </button>
                  )}
                </div>
                {verification.audit_remark && (
                  <div className={`mt-3 rounded-lg border px-3 py-2 text-xs leading-5 ${isRejected ? 'border-rose-400/25 bg-rose-500/10 text-rose-100' : 'border-slate-700 bg-slate-900/70 text-slate-300'}`}>
                    <span className="font-black">审核备注：</span>{verification.audit_remark}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-slate-700/60 bg-slate-950/25 p-3 xl:border-l xl:border-t-0 sm:p-4">
            {isPending ? (
              reviewing === verification.id ? (
                <div className="space-y-2.5">
                  {reviewAction ? (
                    <>
                      <div className={`rounded-lg border px-3 py-2 text-xs font-black ${reviewAction === 'approved' ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300' : 'border-rose-400/30 bg-rose-500/10 text-rose-300'}`}>
                        {reviewAction === 'approved' ? '确认通过验证' : '填写拒绝原因'}
                      </div>
                      <textarea
                        value={auditRemark}
                        onChange={event => {
                          setAuditRemark(event.target.value);
                          if (validationError) setValidationError(null);
                        }}
                        rows={4}
                        placeholder={reviewAction === 'approved' ? '审核备注（选填）' : '请填写拒绝原因及需要补充的资料'}
                        className={`w-full resize-none rounded-lg border bg-slate-900/80 px-3 py-2 text-xs text-white outline-none placeholder:text-slate-500 focus:ring-2 ${validationError ? 'border-rose-500 focus:ring-rose-500/30' : 'border-slate-700 focus:border-cyan-500 focus:ring-cyan-500/20'}`}
                      />
                      {validationError && <p className="text-[10px] font-bold leading-4 text-rose-300">{validationError}</p>}
                      <div className="grid grid-cols-[1fr_auto] gap-2">
                        <button type="button" onClick={() => void handleReview(verification.id, reviewAction)} className={`h-9 rounded-lg text-xs font-black text-white transition ${reviewAction === 'approved' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-rose-600 hover:bg-rose-500'}`}>
                          {reviewAction === 'approved' ? '确认通过' : '确认拒绝'}
                        </button>
                        <button type="button" onClick={() => { setReviewAction(null); setAuditRemark(''); setValidationError(null); }} className="h-9 rounded-lg border border-slate-600 bg-slate-800 px-3 text-xs font-bold text-slate-200 hover:bg-slate-700">返回</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-[10px] font-bold leading-4 text-slate-500">选择审核结果后再提交，拒绝时必须填写原因。</p>
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => setReviewAction('approved')} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 text-xs font-black text-white hover:bg-emerald-500"><CheckCircle className="h-4 w-4" />通过</button>
                        <button type="button" onClick={() => setReviewAction('rejected')} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-rose-600 text-xs font-black text-white hover:bg-rose-500"><XCircle className="h-4 w-4" />拒绝</button>
                      </div>
                      <button type="button" onClick={clearReviewDraft} className="h-8 w-full rounded-lg border border-slate-700 bg-slate-900/60 text-[10px] font-bold text-slate-400 hover:text-white">取消审核</button>
                    </>
                  )}
                </div>
              ) : (
                <div className="flex h-full min-h-20 flex-col justify-center">
                  <p className="mb-3 text-[10px] font-bold leading-4 text-slate-500">检查身份资料与证件后进行审核。</p>
                  <button type="button" onClick={() => { clearReviewDraft(); setReviewing(verification.id); }} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 text-xs font-black text-white shadow-lg shadow-cyan-950/30 hover:from-blue-500 hover:to-cyan-500">
                    <Shield className="h-4 w-4" />开始审核
                  </button>
                </div>
              )
            ) : (
              <div className="flex h-full flex-col justify-center gap-2">
                <button type="button" onClick={() => handleReset(verification.id)} disabled={resetting === verification.id} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-amber-600 text-xs font-black text-white hover:bg-amber-500 disabled:opacity-50"><RotateCcw className="h-4 w-4" />{resetting === verification.id ? '重置中…' : '重置为待审核'}</button>
                <button type="button" onClick={() => handleDelete(verification.id)} disabled={deleting === verification.id} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-rose-400/30 bg-rose-500/10 text-xs font-black text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"><Trash2 className="h-4 w-4" />{deleting === verification.id ? '删除中…' : '删除申请'}</button>
              </div>
            )}
          </div>
        </div>
      </article>
    );
  };

  const renderVerifiedEmployeeCard = (employee: Employee) => {
    const verification = verifications.find(item => item.user_id === employee.id && item.status === 'approved');
    const isExpanded = selectedEmployee?.id === employee.id;
    const hasDocuments = Boolean(verification && (verification.id_front_url || verification.id_back_url || verification.selfie_url));

    return (
      <article key={employee.id} className="overflow-hidden rounded-2xl border border-emerald-400/25 bg-[linear-gradient(145deg,rgba(6,78,59,0.16),rgba(15,23,42,0.96)_42%)] shadow-lg shadow-slate-950/20">
        <div className="flex flex-col xl:grid xl:grid-cols-[minmax(0,1fr)_220px]">
          <div className="min-w-0 p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-emerald-400/30 bg-emerald-500/10 text-emerald-300"><Shield className="h-4 w-4" /></span>
              <span className="text-sm font-black text-white">{employee.username}</span>
              <span className="rounded-md border border-slate-600/70 bg-slate-950/50 px-2 py-0.5 text-[10px] font-bold text-slate-300">{employee.employee_id}</span>
              {getStatusBadge('approved')}
              {isSuperAdmin && (
                <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2 py-1 text-[10px] font-black text-cyan-200"><Users className="h-3 w-3" />{getAdminName(employee.created_by)}</span>
              )}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-slate-700/60 bg-slate-950/35 px-3 py-2"><p className="text-[9px] font-black uppercase tracking-wider text-slate-500">真实姓名</p><p className="mt-1 text-xs font-semibold text-slate-200">{verification?.real_name || '—'}</p></div>
              <div className="rounded-xl border border-slate-700/60 bg-slate-950/35 px-3 py-2"><p className="text-[9px] font-black uppercase tracking-wider text-slate-500">钱包余额</p><p className="mt-1 text-xs font-black text-emerald-300">${(walletBalances.get(employee.id) || 0).toFixed(2)}</p></div>
              <div className="rounded-xl border border-slate-700/60 bg-slate-950/35 px-3 py-2"><p className="text-[9px] font-black uppercase tracking-wider text-slate-500">加入日期</p><p className="mt-1 text-xs font-semibold text-slate-200">{new Date(employee.created_at).toLocaleDateString()}</p></div>
              <div className="rounded-xl border border-slate-700/60 bg-slate-950/35 px-3 py-2"><p className="text-[9px] font-black uppercase tracking-wider text-slate-500">验证日期</p><p className="mt-1 text-xs font-semibold text-slate-200">{verification?.audited_at ? new Date(verification.audited_at).toLocaleDateString() : '—'}</p></div>
            </div>
            {isExpanded && verification && (
              <div className="mt-3 grid gap-2 rounded-xl border border-emerald-400/20 bg-slate-950/45 p-3 sm:grid-cols-2">
                <p className="break-words text-xs text-slate-300"><span className="font-black text-slate-500">电话：</span>{verification.phone || '—'}</p>
                <p className="break-words text-xs text-slate-300"><span className="font-black text-slate-500">邮箱：</span>{verification.email || '—'}</p>
                <p className="break-all text-xs text-slate-300 sm:col-span-2"><span className="font-black text-slate-500">钱包：</span>{verification.wallet_address || '—'}</p>
                {verification.audit_remark && <p className="text-xs text-slate-300 sm:col-span-2"><span className="font-black text-slate-500">审核备注：</span>{verification.audit_remark}</p>}
              </div>
            )}
          </div>
          <div className="flex flex-col justify-center gap-2 border-t border-slate-700/60 bg-slate-950/25 p-3 xl:border-l xl:border-t-0 sm:p-4">
            <button type="button" onClick={() => setSelectedEmployee(isExpanded ? null : employee)} disabled={!verification} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-cyan-400/25 bg-cyan-500/10 text-xs font-black text-cyan-200 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40">{isExpanded ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{isExpanded ? '收起资料' : '查看资料'}</button>
            {isExpanded && hasDocuments && verification && <button type="button" onClick={() => openImagePreview(verification)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-blue-400/25 bg-blue-500/10 text-xs font-black text-blue-200 hover:bg-blue-500/20"><ImageIcon className="h-4 w-4" />查看证件</button>}
            {verification && <button type="button" onClick={() => handleReset(verification.id)} disabled={resetting === verification.id} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-amber-600 text-xs font-black text-white hover:bg-amber-500 disabled:opacity-50"><RotateCcw className="h-4 w-4" />{resetting === verification.id ? '重置中…' : '重置审核'}</button>}
          </div>
        </div>
      </article>
    );
  };

  return (
    <>
      {/* Confirmation Dialog */}
      {confirmDialog?.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
            <div className="flex items-start gap-4 mb-4">
              <div className={`p-3 rounded-full ${
                confirmDialog.confirmColor === 'red'
                  ? 'bg-red-500/10 border border-red-500/50'
                  : 'bg-amber-500/10 border border-amber-500/50'
              }`}>
                <AlertCircle className={`w-6 h-6 ${
                  confirmDialog.confirmColor === 'red' ? 'text-red-400' : 'text-amber-400'
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
                  confirmDialog.confirmColor === 'red'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-amber-600 hover:bg-amber-700'
                }`}
              >
                {confirmDialog.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Preview Modal */}
      {imagePreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-2 sm:p-4">
          <div className="relative flex h-[96vh] w-full max-w-7xl flex-col sm:h-[95vh]">
            {/* Header */}
            <div className="mb-2 flex items-center justify-between gap-2 rounded-t-xl border border-slate-700 bg-slate-900/90 px-2 py-2 backdrop-blur sm:mb-4 sm:px-4 sm:py-3">
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <ImageIcon className="h-4 w-4 shrink-0 text-cyan-400 sm:h-5 sm:w-5" />
                <h3 className="truncate text-sm font-bold text-white sm:text-lg">
                  {imagePreview.images[imagePreview.currentIndex].label}
                </h3>
                <span className="shrink-0 text-xs text-slate-400 sm:text-sm">
                  {imagePreview.currentIndex + 1} / {imagePreview.images.length}
                </span>
                <span className="shrink-0 text-xs text-cyan-400 sm:ml-2 sm:text-sm">
                  {Math.round(imagePreview.scale * 100)}%
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-0.5 sm:gap-2">
                <button
                  onClick={zoomOut}
                  disabled={imagePreview.scale <= 0.5}
                  className={`rounded-lg p-1.5 transition-all sm:p-2 ${
                    imagePreview.scale <= 0.5
                      ? 'text-slate-600 cursor-not-allowed'
                      : 'hover:bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                  title="Zoom Out"
                >
                  <ZoomOut className="h-4 w-4 sm:h-5 sm:w-5" />
                </button>
                <button
                  onClick={resetZoom}
                  className="rounded-lg p-1.5 text-slate-400 transition-all hover:bg-slate-800 hover:text-white sm:p-2"
                  title="Reset Zoom"
                >
                  <Maximize2 className="h-4 w-4 sm:h-5 sm:w-5" />
                </button>
                <button
                  onClick={zoomIn}
                  disabled={imagePreview.scale >= 3}
                  className={`rounded-lg p-1.5 transition-all sm:p-2 ${
                    imagePreview.scale >= 3
                      ? 'text-slate-600 cursor-not-allowed'
                      : 'hover:bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                  title="Zoom In"
                >
                  <ZoomIn className="h-4 w-4 sm:h-5 sm:w-5" />
                </button>
                <div className="mx-0.5 h-5 w-px bg-slate-700 sm:mx-2 sm:h-6" />
                <button
                  onClick={closeImagePreview}
                  className="rounded-lg p-1.5 text-slate-400 transition-all hover:bg-slate-800 hover:text-white sm:p-2"
                >
                  <X className="h-5 w-5 sm:h-6 sm:w-6" />
                </button>
              </div>
            </div>

            {/* Image Container */}
            <div
              className="flex-1 relative bg-slate-900/90 backdrop-blur rounded-b-xl border border-slate-700 border-t-0 flex items-center justify-center overflow-hidden"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              style={{ cursor: imagePreview.scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
            >
              {/* Loading Spinner */}
              {imageLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm z-20">
                  <div className="flex flex-col items-center gap-4">
                    <div className="relative w-16 h-16">
                      <div className="absolute inset-0 border-4 border-slate-700 rounded-full"></div>
                      <div className="absolute inset-0 border-4 border-transparent border-t-cyan-500 rounded-full animate-spin"></div>
                    </div>
                    <div className="text-cyan-400 font-medium">Loading image...</div>
                  </div>
                </div>
              )}

              <img
                src={imagePreview.images[imagePreview.currentIndex].url}
                alt={imagePreview.images[imagePreview.currentIndex].label}
                className="max-w-full max-h-full object-contain transition-transform select-none"
                style={{
                  transform: `scale(${imagePreview.scale}) translate(${position.x / imagePreview.scale}px, ${position.y / imagePreview.scale}px)`,
                  transformOrigin: 'center center',
                  opacity: imageLoading ? 0 : 1,
                  transition: 'opacity 0.3s ease-in-out'
                }}
                draggable={false}
                onLoad={() => handleImageLoad(imagePreview.images[imagePreview.currentIndex].url)}
                onError={() => setImageLoading(false)}
              />

              {/* Navigation Buttons */}
              {imagePreview.images.length > 1 && (
                <>
                  <button
                    onClick={prevImage}
                    disabled={imagePreview.currentIndex === 0}
                    className={`absolute left-2 z-10 rounded-full p-2 backdrop-blur-sm transition-all sm:left-4 sm:p-3 ${
                      imagePreview.currentIndex === 0
                        ? 'bg-slate-800/30 text-slate-600 cursor-not-allowed'
                        : 'bg-slate-800/80 text-white hover:bg-slate-700 hover:scale-110'
                    }`}
                  >
                    <ChevronLeft className="h-5 w-5 sm:h-6 sm:w-6" />
                  </button>
                  <button
                    onClick={nextImage}
                    disabled={imagePreview.currentIndex === imagePreview.images.length - 1}
                    className={`absolute right-2 z-10 rounded-full p-2 backdrop-blur-sm transition-all sm:right-4 sm:p-3 ${
                      imagePreview.currentIndex === imagePreview.images.length - 1
                        ? 'bg-slate-800/30 text-slate-600 cursor-not-allowed'
                        : 'bg-slate-800/80 text-white hover:bg-slate-700 hover:scale-110'
                    }`}
                  >
                    <ChevronRight className="h-5 w-5 sm:h-6 sm:w-6" />
                  </button>
                </>
              )}

              {/* Zoom Instructions */}
              {imagePreview.scale > 1 && (
                <div className="absolute bottom-4 left-1/2 hidden -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm text-slate-300 backdrop-blur sm:block">
                  Click and drag to pan the image
                </div>
              )}
            </div>

            {/* Thumbnails */}
            {imagePreview.images.length > 1 && (
              <div className="mt-2 flex flex-wrap justify-center gap-1.5 sm:mt-4 sm:gap-2">
                {imagePreview.images.map((img, index) => (
                  <button
                    key={index}
                    onClick={() => {
                      setImagePreview({ ...imagePreview, currentIndex: index });
                      setPosition({ x: 0, y: 0 });
                      setImageLoading(!loadedImages.has(img.url));
                    }}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all sm:px-4 sm:py-2 sm:text-sm ${
                      index === imagePreview.currentIndex
                        ? 'bg-cyan-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
                    }`}
                  >
                    {img.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-slate-950">
        <header className="relative z-20 shrink-0 border-b border-cyan-300/20 bg-[radial-gradient(circle_at_top_left,rgba(8,145,178,0.2),transparent_36%),linear-gradient(105deg,rgba(8,47,73,0.94),rgba(15,23,42,0.98)_70%)] px-3 py-2.5 shadow-lg shadow-slate-950/25 sm:px-4">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-500/10 text-cyan-200 shadow-inner shadow-cyan-950/30">
                <Shield className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-black text-white sm:text-base">验证管理</h2>
                <p className="mt-0.5 truncate text-[10px] font-bold text-cyan-100/60">
                  {selectedAdminName} · {viewMode === 'requests' ? '待审核' : viewMode === 'verified' ? '已验证' : '已拒绝'}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="hidden rounded-lg border border-cyan-300/20 bg-slate-950/35 px-2.5 py-1.5 text-[10px] font-black text-slate-300 sm:inline">
                当前结果 <strong className="ml-1 text-white">{activeResultCount}</strong>
              </span>
              {overallStats.pending > 0 && (
                <span className="inline-flex items-center gap-1 rounded-lg border border-amber-300/30 bg-amber-500/15 px-2.5 py-1.5 text-[10px] font-black text-amber-200">
                  <AlertCircle className="h-3.5 w-3.5" />{overallStats.pending} 待处理
                </span>
              )}
            </div>
          </div>
        </header>

        <div className="shrink-0 space-y-2 border-b border-slate-700 bg-slate-900 p-2 lg:hidden">
          {isSuperAdmin && (
            <select
              value={selectedAdminId}
              onChange={event => changeContext(viewMode, event.target.value)}
              className="h-9 w-full rounded-lg border border-slate-600 bg-slate-800 px-2 text-xs font-black text-white outline-none focus:border-cyan-400"
            >
              <option value="all">全部管理员</option>
              {adminOptions.map(adminOption => (
                <option key={adminOption.id} value={adminOption.id}>{adminOption.username}</option>
              ))}
            </select>
          )}
          <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-700/80 bg-slate-950/50 p-1">
            {([
              { value: 'requests', label: '待审核', count: selectedGroupStats.pending, active: 'bg-amber-600 text-white' },
              { value: 'verified', label: '已验证', count: selectedGroupStats.approved, active: 'bg-emerald-600 text-white' },
              { value: 'rejected', label: '已拒绝', count: selectedGroupStats.rejected, active: 'bg-rose-600 text-white' },
            ] as const).map(item => (
              <button
                key={item.value}
                type="button"
                onClick={() => changeContext(item.value, selectedAdminId)}
                className={`flex h-8 items-center justify-center gap-1 rounded-lg text-[10px] font-black transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 ${viewMode === item.value ? item.active : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
              >
                {item.label}<span className="rounded bg-black/20 px-1.5 py-0.5 text-[9px]">{item.count}</span>
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder="搜索员工、电话、邮箱或钱包"
              className="h-9 w-full rounded-lg border border-slate-600 bg-slate-800 pl-9 pr-9 text-xs font-bold text-white outline-none placeholder:text-slate-500 focus:border-cyan-400"
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 hover:bg-slate-700 hover:text-white" aria-label="清除搜索">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="hidden min-h-0 flex-col border-r border-cyan-950/70 bg-[linear-gradient(180deg,rgba(15,23,42,0.99),rgba(8,20,38,0.99))] lg:flex">
            <div className="shrink-0 border-b border-cyan-900/45 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.12),transparent_42%)] p-3">
              <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-slate-950/45 p-1 shadow-inner shadow-slate-950/50">
                {([
                  { value: 'requests', label: '待审核', count: selectedGroupStats.pending, Icon: Clock, active: 'border-amber-300/50 bg-amber-600 text-white shadow-amber-950/40', idle: 'border-transparent text-amber-200 hover:bg-amber-500/15' },
                  { value: 'verified', label: '已验证', count: selectedGroupStats.approved, Icon: CheckCircle, active: 'border-emerald-300/50 bg-emerald-600 text-white shadow-emerald-950/40', idle: 'border-transparent text-emerald-200 hover:bg-emerald-500/15' },
                  { value: 'rejected', label: '已拒绝', count: selectedGroupStats.rejected, Icon: XCircle, active: 'border-rose-300/50 bg-rose-600 text-white shadow-rose-950/40', idle: 'border-transparent text-rose-200 hover:bg-rose-500/15' },
                ] as const).map(({ value, label, count, Icon, active, idle }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => changeContext(value, selectedAdminId)}
                    aria-pressed={viewMode === value}
                    className={`flex h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg border text-[10px] font-black shadow-md transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 ${viewMode === value ? active : idle}`}
                  >
                    <span className="flex items-center gap-1"><Icon className="h-3.5 w-3.5" />{label}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[9px] tabular-nums ${viewMode === value ? 'bg-white/20' : 'bg-slate-950/40'}`}>{count}</span>
                  </button>
                ))}
              </div>
              <div className="relative mt-2.5">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  value={searchQuery}
                  onChange={event => setSearchQuery(event.target.value)}
                  placeholder="搜索员工、电话、邮箱或钱包"
                  className="h-10 w-full rounded-xl border border-white/80 bg-slate-50 pl-9 pr-9 text-xs font-bold text-slate-800 shadow-lg shadow-slate-950/20 outline-none placeholder:font-medium placeholder:text-slate-400 focus:border-cyan-400 focus:bg-white focus:ring-2 focus:ring-cyan-400/20"
                />
                {searchQuery && (
                  <button type="button" onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-200 hover:text-slate-700" aria-label="清除搜索">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between text-[10px] font-bold text-slate-500"><span>管理员分组</span><span>{activeResultCount} 条结果</span></div>
            </div>

            <div className="dark-panel-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
              {isSuperAdmin && (
                <button
                  type="button"
                  onClick={() => changeContext(viewMode, 'all')}
                  aria-pressed={selectedAdminId === 'all'}
                  className={`group relative mb-1.5 w-full overflow-hidden rounded-xl border p-2.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 ${selectedAdminId === 'all' ? 'border-cyan-300/55 bg-gradient-to-r from-cyan-700 via-blue-800 to-slate-800 text-white shadow-lg shadow-cyan-950/35' : 'border-slate-700/70 bg-slate-900/65 text-slate-300 hover:border-cyan-600/50 hover:bg-cyan-950/30'}`}
                >
                  {selectedAdminId === 'all' && <span className="absolute bottom-1 left-0 top-1 w-1 rounded-r-full bg-cyan-300" />}
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-xs font-black"><span className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/15 bg-slate-950/25"><Users className="h-3.5 w-3.5" /></span>全部管理员</span>
                    <span className="text-[9px] font-black text-cyan-100">汇总</span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[10px] font-black">
                    <span className="rounded bg-amber-500/15 px-1 py-1 text-amber-200">待审核 {overallStats.pending}</span>
                    <span className="rounded bg-emerald-500/15 px-1 py-1 text-emerald-200">已验证 {overallStats.approved}</span>
                    <span className="rounded bg-rose-500/15 px-1 py-1 text-rose-200">已拒绝 {overallStats.rejected}</span>
                  </div>
                </button>
              )}

              {adminOptions.map(adminOption => {
                const stats = getAdminStats(adminOption.id);
                const selected = selectedAdminId === adminOption.id;
                return (
                  <button
                    key={adminOption.id}
                    type="button"
                    onClick={() => changeContext(viewMode, adminOption.id)}
                    aria-pressed={selected}
                    className={`group relative mb-1.5 w-full overflow-hidden rounded-xl border p-2.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 ${selected ? 'border-cyan-300/55 bg-gradient-to-r from-blue-700 via-cyan-800 to-slate-800 text-white shadow-lg shadow-cyan-950/35' : 'border-slate-700/70 bg-slate-900/65 text-slate-300 hover:border-cyan-600/50 hover:bg-cyan-950/30'}`}
                  >
                    {selected && <span className="absolute bottom-1 left-0 top-1 w-1 rounded-r-full bg-cyan-300" />}
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${selected ? 'border-white/25 bg-slate-950/25 text-white' : 'border-slate-700 bg-slate-950/40 text-cyan-300'}`}><User className="h-3.5 w-3.5" /></span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-black">{adminOption.username}</p>
                        <p className={`mt-0.5 text-[9px] font-bold ${selected ? 'text-cyan-100/70' : 'text-slate-500'}`}>{adminOption.role === 'super_admin' ? '超级管理员' : '次要管理员'}</p>
                      </div>
                      {stats.pending > 0 && <span className="rounded-full border border-amber-300/30 bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-black text-amber-200">{stats.pending}</span>}
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[10px] font-black">
                      <span className="rounded bg-amber-500/10 px-1 py-1 text-amber-200">待审核 {stats.pending}</span>
                      <span className="rounded bg-emerald-500/10 px-1 py-1 text-emerald-200">已验证 {stats.approved}</span>
                      <span className="rounded bg-rose-500/10 px-1 py-1 text-rose-200">已拒绝 {stats.rejected}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="shrink-0 border-t border-cyan-950/70 bg-slate-950/55 p-3">
              <div className="flex items-center justify-between text-[10px] font-bold text-slate-500"><span>当前筛选</span><span className="font-black text-white">{activeResultCount}</span></div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500" style={{ width: `${Math.min(100, activeResultCount ? Math.max(8, activeResultCount) : 0)}%` }} /></div>
            </div>
          </aside>

          <main className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_top_right,rgba(8,145,178,0.08),transparent_32%),#0f172a]">
            <div className="shrink-0 border-b border-slate-700/70 bg-slate-900/80 px-3 py-2.5 sm:px-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-xs font-black text-white">{selectedAdminName} · {viewMode === 'requests' ? '待审核申请' : viewMode === 'verified' ? '已验证员工' : '已拒绝申请'}</h3>
                  <p className="mt-0.5 text-[10px] font-bold text-slate-500">列表区域独立滚动，共 {activeResultCount} 条符合条件的记录</p>
                </div>
                {searchQuery && <span className="max-w-full truncate rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-2 py-1 text-[10px] font-bold text-cyan-200">搜索：{searchQuery}</span>}
              </div>
            </div>

            <div className="dark-panel-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-2.5 sm:p-4">
              {error && (
                <div className="mb-3 flex items-center gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2.5 text-xs font-bold text-rose-200"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>
              )}
              {loading ? (
                <div className="flex h-full min-h-64 flex-col items-center justify-center text-center">
                  <span className="mb-3 h-9 w-9 animate-spin rounded-full border-2 border-slate-700 border-t-cyan-400" />
                  <p className="text-xs font-bold text-slate-400">正在加载验证资料…</p>
                </div>
              ) : activeResultCount === 0 ? (
                <div className="flex h-full min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-950/25 px-6 text-center">
                  <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-500/10 text-cyan-300"><FileText className="h-5 w-5" /></span>
                  <h3 className="text-sm font-black text-white">没有符合条件的记录</h3>
                  <p className="mt-1.5 max-w-sm text-xs leading-5 text-slate-500">请切换管理员分组、审核状态，或调整搜索条件后再查看。</p>
                  {searchQuery && <button type="button" onClick={() => setSearchQuery('')} className="mt-4 h-8 rounded-lg border border-cyan-400/25 bg-cyan-500/10 px-3 text-[10px] font-black text-cyan-200 hover:bg-cyan-500/20">清除搜索</button>}
                </div>
              ) : (
                <div className="space-y-3">
                  {viewMode === 'requests' && filteredVerifications.map(renderVerificationCard)}
                  {viewMode === 'verified' && filteredVerifiedEmployees.map(renderVerifiedEmployeeCard)}
                  {viewMode === 'rejected' && filteredRejectedVerifications.map(renderVerificationCard)}
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
