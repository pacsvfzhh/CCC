import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Clock, User, Wallet, Phone, Mail, Trash2, RotateCcw, AlertCircle, Eye, EyeOff, FileText, Image as ImageIcon, ExternalLink, Shield, Calendar, Hash, Search, Users, X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { VerificationRequest, Employee, Admin } from '../../types';

interface VerificationWithEmployee extends VerificationRequest {
  employee?: Employee;
}

interface VerificationReviewProps {
  admin: Admin;
}

type ViewMode = 'requests' | 'verified' | 'rejected';
type GroupMode = 'all' | 'by_admin';

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
  const [groupMode, setGroupMode] = useState<GroupMode>('all');
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [walletBalances, setWalletBalances] = useState<Map<string, number>>(new Map());
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [expandedAdmins, setExpandedAdmins] = useState<Set<string>>(new Set());
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!imagePreview) return;

      if (e.key === 'Escape') {
        closeImagePreview();
      } else if (e.key === 'ArrowLeft' && imagePreview.currentIndex > 0) {
        prevImage();
      } else if (e.key === 'ArrowRight' && imagePreview.currentIndex < imagePreview.images.length - 1) {
        nextImage();
      } else if (e.key === '+' || e.key === '=') {
        zoomIn();
      } else if (e.key === '-' || e.key === '_') {
        zoomOut();
      } else if (e.key === '0') {
        resetZoom();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [imagePreview]);

  useEffect(() => {
    loadVerifications();
    loadVerifiedEmployees();
    if (admin.role === 'super_admin') {
      loadAdmins();
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
          verifyDebounce = setTimeout(() => loadVerifications(), 800);
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'verification_requests' },
        () => {
          if (verifyDebounce) clearTimeout(verifyDebounce);
          verifyDebounce = setTimeout(() => loadVerifications(), 800);
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'verification_requests' },
        () => {
          if (verifyDebounce) clearTimeout(verifyDebounce);
          verifyDebounce = setTimeout(() => loadVerifications(), 800);
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
          userDebounce = setTimeout(() => loadVerifiedEmployees(), 800);
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
  }, []); // Remove admin.id from dependencies

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

      const { data: employees } = await supabase.from('users').select('*');
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
    } catch (error: any) {
      console.error('Error loading verifications:', error);
      setError(error?.message || 'Failed to load verifications');
    } finally {
      setLoading(false);
    }
  };

  const loadVerifiedEmployees = async () => {
    try {
      console.log('Loading verified employees...');

      let query = supabase
        .from('users')
        .select('*')
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
    } catch (error: any) {
      console.error('Error loading verified employees:', error);
    }
  };

  const loadAdmins = async () => {
    try {
      const { data, error } = await supabase
        .from('admins')
        .select('*')
        .eq('is_active', true)
        .order('username', { ascending: true });

      if (error) throw error;
      setAdmins(data || []);
      console.log('Admins loaded:', data);
    } catch (error: any) {
      console.error('Error loading admins:', error);
    }
  };

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
        const { error: userError } = await supabase
          .from('users')
          .update({ is_verified: true })
          .eq('id', verification.user_id);

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
            const { error: userError } = await supabase
              .from('users')
              .update({ is_verified: false })
              .eq('id', verification.user_id);

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
      pending: 'bg-yellow-500/10 border-yellow-500/50 text-yellow-400',
      approved: 'bg-green-500/10 border-green-500/50 text-green-400',
      rejected: 'bg-red-500/10 border-red-500/50 text-red-400',
    };

    const icons = {
      pending: <Clock className="w-4 h-4" />,
      approved: <CheckCircle className="w-4 h-4" />,
      rejected: <XCircle className="w-4 h-4" />,
    };

    return (
      <div className={`flex items-center gap-2 px-3 py-1 rounded-full border text-sm font-medium ${styles[status as keyof typeof styles]}`}>
        {icons[status as keyof typeof icons]}
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </div>
    );
  };

  const getOverallStats = () => {
    const pending = verifications.filter(v => v.status === 'pending').length;
    const approved = verifications.filter(v => v.status === 'approved').length;
    const rejected = verifications.filter(v => v.status === 'rejected').length;
    const processed = approved + rejected;
    return { pending, approved, rejected, processed, total: verifications.length };
  };

  // Filter verifications based on search query
  const filterVerificationsBySearch = (verificationsList: VerificationWithEmployee[]) => {
    if (!searchQuery.trim()) return verificationsList;

    const query = searchQuery.toLowerCase().trim();
    return verificationsList.filter(v => {
      const employee = v.employee;
      return (
        // Search by Employee ID
        employee?.id?.toLowerCase().includes(query) ||
        // Search by Username
        employee?.username?.toLowerCase().includes(query) ||
        // Search by Phone (from verification request)
        v.phone?.toLowerCase().includes(query) ||
        // Search by Email/Address (from verification request)
        v.email?.toLowerCase().includes(query) ||
        // Search by Wallet Address
        v.wallet_address?.toLowerCase().includes(query) ||
        // Search by Real Name
        v.real_name?.toLowerCase().includes(query)
      );
    });
  };

  // Filter verified employees based on search query
  const filterEmployeesBySearch = (employeesList: Employee[]) => {
    if (!searchQuery.trim()) return employeesList;

    const query = searchQuery.toLowerCase().trim();
    return employeesList.filter(employee => {
      // Find the verification request for this employee
      const verification = verifications.find(v => v.user_id === employee.id && v.status === 'approved');

      return (
        // Search by Employee ID
        employee.id?.toLowerCase().includes(query) ||
        // Search by Username
        employee.username?.toLowerCase().includes(query) ||
        // Search by Phone (from verification request)
        verification?.phone?.toLowerCase().includes(query) ||
        // Search by Email/Address (from verification request)
        verification?.email?.toLowerCase().includes(query) ||
        // Search by Wallet Address
        verification?.wallet_address?.toLowerCase().includes(query) ||
        // Search by Real Name
        verification?.real_name?.toLowerCase().includes(query)
      );
    });
  };

  // Group verifications by admin for super_admin
  const groupVerificationsByAdmin = () => {
    const grouped = new Map<string, VerificationWithEmployee[]>();
    const pending = verifications.filter(v => v.status === 'pending');

    pending.forEach(verification => {
      const employee = verification.employee;
      if (employee) {
        const adminId = employee.created_by;
        if (!grouped.has(adminId)) {
          grouped.set(adminId, []);
        }
        grouped.get(adminId)!.push(verification);
      }
    });

    return grouped;
  };

  // Group verified employees by admin for super_admin
  const groupVerifiedEmployeesByAdmin = () => {
    const grouped = new Map<string, Employee[]>();

    verifiedEmployees.forEach(employee => {
      const adminId = employee.created_by;
      if (!grouped.has(adminId)) {
        grouped.set(adminId, []);
      }
      grouped.get(adminId)!.push(employee);
    });

    return grouped;
  };

  // Filter verifications based on view mode
  const pendingVerifications = verifications.filter(v => v.status === 'pending');
  const rejectedVerifications = verifications.filter(v => v.status === 'rejected');

  const filteredVerifications = filterVerificationsBySearch(pendingVerifications);
  const filteredRejectedVerifications = filterVerificationsBySearch(rejectedVerifications);
  const filteredVerifiedEmployees = filterEmployeesBySearch(verifiedEmployees);

  const groupedVerifications = groupVerificationsByAdmin();
  const groupedVerifiedEmployees = groupVerifiedEmployeesByAdmin();

  // Group rejected verifications by admin
  const groupRejectedVerificationsByAdmin = () => {
    const grouped = new Map<string, VerificationWithEmployee[]>();
    const rejected = verifications.filter(v => v.status === 'rejected');

    rejected.forEach(verification => {
      const employee = verification.employee;
      if (employee) {
        const adminId = employee.created_by;
        if (!grouped.has(adminId)) {
          grouped.set(adminId, []);
        }
        grouped.get(adminId)!.push(verification);
      }
    });

    return grouped;
  };

  const groupedRejectedVerifications = groupRejectedVerificationsByAdmin();

  const toggleAdminGroup = (adminId: string) => {
    const newExpanded = new Set(expandedAdmins);
    if (newExpanded.has(adminId)) {
      newExpanded.delete(adminId);
    } else {
      newExpanded.add(adminId);
    }
    setExpandedAdmins(newExpanded);
  };

  const getAdminName = (adminId: string) => {
    const adminUser = admins.find(a => a.id === adminId);
    return adminUser?.username || adminId;
  };

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

    if ((verification as any).id_front_url) {
      images.push({ url: (verification as any).id_front_url, label: 'ID Front' });
    }
    if ((verification as any).id_back_url) {
      images.push({ url: (verification as any).id_back_url, label: 'ID Back' });
    }
    if ((verification as any).selfie_url) {
      images.push({ url: (verification as any).selfie_url, label: 'Selfie Photo' });
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

  const overallStats = getOverallStats();

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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90">
          <div className="relative max-w-7xl w-full h-[95vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between mb-4 px-4 py-3 bg-slate-900/90 backdrop-blur rounded-t-xl border border-slate-700">
              <div className="flex items-center gap-3">
                <ImageIcon className="w-5 h-5 text-cyan-400" />
                <h3 className="text-lg font-bold text-white">
                  {imagePreview.images[imagePreview.currentIndex].label}
                </h3>
                <span className="text-sm text-slate-400">
                  {imagePreview.currentIndex + 1} / {imagePreview.images.length}
                </span>
                <span className="text-sm text-cyan-400 ml-2">
                  {Math.round(imagePreview.scale * 100)}%
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={zoomOut}
                  disabled={imagePreview.scale <= 0.5}
                  className={`p-2 rounded-lg transition-all ${
                    imagePreview.scale <= 0.5
                      ? 'text-slate-600 cursor-not-allowed'
                      : 'hover:bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                  title="Zoom Out"
                >
                  <ZoomOut className="w-5 h-5" />
                </button>
                <button
                  onClick={resetZoom}
                  className="p-2 hover:bg-slate-800 rounded-lg transition-all text-slate-400 hover:text-white"
                  title="Reset Zoom"
                >
                  <Maximize2 className="w-5 h-5" />
                </button>
                <button
                  onClick={zoomIn}
                  disabled={imagePreview.scale >= 3}
                  className={`p-2 rounded-lg transition-all ${
                    imagePreview.scale >= 3
                      ? 'text-slate-600 cursor-not-allowed'
                      : 'hover:bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                  title="Zoom In"
                >
                  <ZoomIn className="w-5 h-5" />
                </button>
                <div className="w-px h-6 bg-slate-700 mx-2"></div>
                <button
                  onClick={closeImagePreview}
                  className="p-2 hover:bg-slate-800 rounded-lg transition-all text-slate-400 hover:text-white"
                >
                  <X className="w-6 h-6" />
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
                    className={`absolute left-4 p-3 rounded-full backdrop-blur-sm transition-all z-10 ${
                      imagePreview.currentIndex === 0
                        ? 'bg-slate-800/30 text-slate-600 cursor-not-allowed'
                        : 'bg-slate-800/80 text-white hover:bg-slate-700 hover:scale-110'
                    }`}
                  >
                    <ChevronLeft className="w-6 h-6" />
                  </button>
                  <button
                    onClick={nextImage}
                    disabled={imagePreview.currentIndex === imagePreview.images.length - 1}
                    className={`absolute right-4 p-3 rounded-full backdrop-blur-sm transition-all z-10 ${
                      imagePreview.currentIndex === imagePreview.images.length - 1
                        ? 'bg-slate-800/30 text-slate-600 cursor-not-allowed'
                        : 'bg-slate-800/80 text-white hover:bg-slate-700 hover:scale-110'
                    }`}
                  >
                    <ChevronRight className="w-6 h-6" />
                  </button>
                </>
              )}

              {/* Zoom Instructions */}
              {imagePreview.scale > 1 && (
                <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 px-4 py-2 bg-slate-900/80 backdrop-blur border border-slate-700 rounded-lg text-slate-300 text-sm">
                  Click and drag to pan the image
                </div>
              )}
            </div>

            {/* Thumbnails */}
            {imagePreview.images.length > 1 && (
              <div className="flex justify-center gap-2 mt-4">
                {imagePreview.images.map((img, index) => (
                  <button
                    key={index}
                    onClick={() => {
                      setImagePreview({ ...imagePreview, currentIndex: index });
                      setPosition({ x: 0, y: 0 });
                      setImageLoading(!loadedImages.has(img.url));
                    }}
                    className={`px-4 py-2 rounded-lg font-medium transition-all ${
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

      <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-blue-500/20 p-6">
      <div className="flex items-center justify-between mb-6">
        {viewMode === 'requests' && overallStats.pending > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-600/20 to-red-600/20 border-2 border-orange-500/50 rounded-lg animate-pulse">
            <AlertCircle className="w-5 h-5 text-orange-400" />
            <span className="text-orange-300 font-bold">
              {overallStats.pending} Pending Request{overallStats.pending !== 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>

      {/* View Mode Toggle */}
      <div className="mb-6 flex gap-3 border-b border-slate-700 pb-4">
        <button
          onClick={() => setViewMode('requests')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-all ${
            viewMode === 'requests'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/50'
              : 'bg-slate-800/50 text-slate-400 hover:bg-slate-800 hover:text-white'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Verification Requests</span>
          {overallStats.pending > 0 && (
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
              viewMode === 'requests'
                ? 'bg-white/20'
                : 'bg-orange-500/20 text-orange-400'
            }`}>
              {overallStats.pending}
            </span>
          )}
        </button>
        <button
          onClick={() => setViewMode('verified')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-all ${
            viewMode === 'verified'
              ? 'bg-green-600 text-white shadow-lg shadow-green-500/50'
              : 'bg-slate-800/50 text-slate-400 hover:bg-slate-800 hover:text-white'
          }`}
        >
          <Shield className="w-4 h-4" />
          <span>Verified Employees</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
            viewMode === 'verified' ? 'bg-white/20' : 'bg-green-500/20 text-green-400'
          }`}>
            {verifiedEmployees.length}
          </span>
        </button>
        <button
          onClick={() => setViewMode('rejected')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-all ${
            viewMode === 'rejected'
              ? 'bg-red-600 text-white shadow-lg shadow-red-500/50'
              : 'bg-slate-800/50 text-slate-400 hover:bg-slate-800 hover:text-white'
          }`}
        >
          <XCircle className="w-4 h-4" />
          <span>Rejected Requests</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
            viewMode === 'rejected' ? 'bg-white/20' : 'bg-red-500/20 text-red-400'
          }`}>
            {overallStats.rejected}
          </span>
        </button>
      </div>

      {/* Group Mode Toggle - Only for Super Admin */}
      {admin.role === 'super_admin' && (
        <div className="mb-6 flex gap-3 pb-4">
          <button
            onClick={() => setGroupMode('all')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-all ${
              groupMode === 'all'
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/50'
                : 'bg-slate-800/50 text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>All Together</span>
          </button>
          <button
            onClick={() => setGroupMode('by_admin')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-all ${
              groupMode === 'by_admin'
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/50'
                : 'bg-slate-800/50 text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Group by Admin</span>
          </button>
        </div>
      )}

      {/* Search Bar */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            placeholder="Search by Employee ID, Username, Phone, Email, Wallet Address, or Real Name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-slate-800/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
            >
              <XCircle className="w-5 h-5" />
            </button>
          )}
        </div>
        {searchQuery && (
          <div className="mt-2 text-sm text-slate-400">
            {viewMode === 'requests' ? (
              <>
                Found {filteredVerifications.length} of {pendingVerifications.length} pending request{pendingVerifications.length !== 1 ? 's' : ''}
              </>
            ) : viewMode === 'rejected' ? (
              <>
                Found {filteredRejectedVerifications.length} of {rejectedVerifications.length} rejected request{rejectedVerifications.length !== 1 ? 's' : ''}
              </>
            ) : (
              <>
                Found {filteredVerifiedEmployees.length} of {verifiedEmployees.length} verified employee{verifiedEmployees.length !== 1 ? 's' : ''}
              </>
            )}
          </div>
        )}
      </div>

      {viewMode === 'requests' && (
        <>
      {error && (
        <div className="mb-4 p-4 bg-red-500/10 border border-red-500/50 rounded-lg">
          <div className="flex items-center gap-2 text-red-400">
            <AlertCircle className="w-5 h-5" />
            <span className="font-medium">Error: {error}</span>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-slate-400">Loading verifications...</div>
      ) : filteredVerifications.length === 0 ? (
        <div className="text-center py-8 text-slate-400">
          {searchQuery ? 'No pending verification requests match your search' : 'No pending verification requests'}
        </div>
      ) : groupMode === 'by_admin' && admin.role === 'super_admin' && !searchQuery ? (
        <div className="space-y-6">
          {Array.from(groupedVerifications.entries())
            .sort(([adminIdA], [adminIdB]) => getAdminName(adminIdA).localeCompare(getAdminName(adminIdB)))
            .map(([adminId, adminVerifications]) => {
              const isExpanded = expandedAdmins.has(adminId);
              const pendingCount = adminVerifications.filter(v => v.status === 'pending').length;

              return (
                <div key={adminId} className="bg-slate-800/30 rounded-xl border border-slate-700/50 overflow-hidden">
                  <button
                    onClick={() => toggleAdminGroup(adminId)}
                    className="w-full flex items-center justify-between p-4 bg-slate-800/50 hover:bg-slate-800/70 transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <Users className="w-5 h-5 text-blue-400" />
                      <span className="text-white font-semibold">{getAdminName(adminId)}</span>
                      <span className="px-3 py-1 bg-blue-600/20 border border-blue-500/50 rounded-full text-blue-300 text-sm font-medium">
                        {adminVerifications.length} request{adminVerifications.length !== 1 ? 's' : ''}
                      </span>
                      {pendingCount > 0 && (
                        <span className="px-3 py-1 bg-orange-600/20 border border-orange-500/50 rounded-full text-orange-300 text-sm font-bold animate-pulse">
                          {pendingCount} pending
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-slate-400">
                      <span className="text-sm">{isExpanded ? 'Hide' : 'Show'}</span>
                      {isExpanded ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="p-4 space-y-4 max-h-[1200px] overflow-y-auto">
                      {adminVerifications.map((verification) => {
                        const isPending = verification.status === 'pending';
                        const isDetailExpanded = expandedDetails.has(verification.id);
                        return (
                        <div
                          key={verification.id}
                          className={`rounded-lg p-4 transition-all ${
                            isPending
                              ? 'bg-gradient-to-r from-orange-900/30 to-red-900/30 border-2 border-orange-500/50 shadow-lg shadow-orange-500/20'
                              : 'bg-slate-800/50 border border-slate-700'
                          }`}
                        >
                          <div className="flex flex-col lg:flex-row justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center justify-between gap-3 mb-3">
                                <div className="flex items-center gap-3">
                                  <span className="text-white font-medium">{verification.employee?.username}</span>
                                  <span className="text-slate-500 text-sm">{verification.employee?.employee_id}</span>
                                  {getStatusBadge(verification.status)}
                                </div>
                                <button
                                  onClick={() => toggleDetails(verification.id)}
                                  className="flex items-center gap-2 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/50 rounded-lg text-blue-300 text-sm font-medium transition-all"
                                >
                                  {isDetailExpanded ? (
                                    <><EyeOff className="w-4 h-4" /> Hide Details</>
                                  ) : (
                                    <><Eye className="w-4 h-4" /> View Details</>
                                  )}
                                </button>
                              </div>

                              {isDetailExpanded && (
                                <div className="mb-4 p-4 bg-slate-900/50 rounded-lg border border-blue-500/20">
                                  <div className="flex items-center gap-2 mb-3">
                                    <FileText className="w-4 h-4 text-blue-400" />
                                    <h3 className="text-sm font-bold text-blue-300 uppercase tracking-wide">Verification Information</h3>
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                      <div className="text-xs text-slate-500 uppercase tracking-wider">Real Name</div>
                                      <div className="text-sm text-white font-medium">{verification.real_name}</div>
                                    </div>
                                    <div className="space-y-1">
                                      <div className="text-xs text-slate-500 uppercase tracking-wider">Phone Number</div>
                                      <div className="text-sm text-white font-medium">{verification.phone}</div>
                                    </div>
                                    <div className="space-y-1 md:col-span-2">
                                      <div className="text-xs text-slate-500 uppercase tracking-wider">Email Address</div>
                                      <div className="text-sm text-white font-medium">{verification.email}</div>
                                    </div>
                                    <div className="space-y-1 md:col-span-2">
                                      <div className="text-xs text-slate-500 uppercase tracking-wider">Wallet Address</div>
                                      <div className="text-sm text-white font-mono break-all bg-slate-800/50 p-2 rounded">{verification.wallet_address}</div>
                                    </div>
                                  </div>

                                  {((verification as any).id_front_url || (verification as any).id_back_url || (verification as any).selfie_url) && (
                                    <div className="mt-4 pt-4 border-t border-slate-700">
                                      <div className="flex items-center gap-2 mb-3">
                                        <ImageIcon className="w-4 h-4 text-blue-400" />
                                        <h3 className="text-sm font-bold text-blue-300 uppercase tracking-wide">Supporting Documents</h3>
                                      </div>
                                      <button
                                        onClick={() => openImagePreview(verification)}
                                        className="w-full px-4 py-3 bg-gradient-to-r from-cyan-600/20 to-blue-600/20 hover:from-cyan-600/30 hover:to-blue-600/30 border border-cyan-500/50 rounded-lg text-cyan-300 font-medium transition-all flex items-center justify-center gap-2"
                                      >
                                        <Eye className="w-4 h-4" />
                                        View Verification Documents
                                      </button>
                                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
                                        {(verification as any).id_front_url && (
                                          <div className="group relative bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                                            <div className="flex items-center gap-2 mb-2">
                                              <ImageIcon className="w-4 h-4 text-blue-400" />
                                              <span className="text-xs font-medium text-slate-300">ID Front</span>
                                            </div>
                                          </div>
                                        )}
                                        {(verification as any).id_back_url && (
                                          <div className="group relative bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                                            <div className="flex items-center gap-2 mb-2">
                                              <ImageIcon className="w-4 h-4 text-blue-400" />
                                              <span className="text-xs font-medium text-slate-300">ID Back</span>
                                            </div>
                                          </div>
                                        )}
                                        {(verification as any).selfie_url && (
                                          <div className="group relative bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                                            <div className="flex items-center gap-2 mb-2">
                                              <ImageIcon className="w-4 h-4 text-blue-400" />
                                              <span className="text-xs font-medium text-slate-300">Selfie Photo</span>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                                <div className="flex items-start gap-2">
                                  <User className="w-4 h-4 text-slate-400 mt-0.5" />
                                  <div>
                                    <div className="text-xs text-slate-500">Real Name</div>
                                    <div className="text-sm text-slate-200">{verification.real_name}</div>
                                  </div>
                                </div>

                                <div className="flex items-start gap-2">
                                  <Wallet className="w-4 h-4 text-slate-400 mt-0.5" />
                                  <div>
                                    <div className="text-xs text-slate-500">Wallet Address</div>
                                    <div className="text-sm text-slate-200 font-mono break-all">{verification.wallet_address}</div>
                                  </div>
                                </div>

                                <div className="flex items-start gap-2">
                                  <Phone className="w-4 h-4 text-slate-400 mt-0.5" />
                                  <div>
                                    <div className="text-xs text-slate-500">Phone</div>
                                    <div className="text-sm text-slate-200">{verification.phone}</div>
                                  </div>
                                </div>

                                <div className="flex items-start gap-2">
                                  <Mail className="w-4 h-4 text-slate-400 mt-0.5" />
                                  <div>
                                    <div className="text-xs text-slate-500">Email</div>
                                    <div className="text-sm text-slate-200">{verification.email}</div>
                                  </div>
                                </div>
                              </div>

                              <div className="text-slate-400 text-sm">
                                Submitted: {new Date(verification.created_at).toLocaleString()}
                              </div>

                              {verification.audit_remark && (
                                <div className="mt-2 p-2 bg-slate-900 rounded text-slate-300 text-sm">
                                  <strong>Audit Note:</strong> {verification.audit_remark}
                                </div>
                              )}
                            </div>

                            <div className="lg:w-80">
                              {verification.status === 'pending' ? (
                                reviewing === verification.id ? (
                                  <div className="space-y-3">
                                    {reviewAction ? (
                                      <>
                                        <div className={`p-3 rounded-lg ${
                                          reviewAction === 'approved'
                                            ? 'bg-green-500/10 border border-green-500/30'
                                            : 'bg-red-500/10 border border-red-500/30'
                                        }`}>
                                          <div className={`text-sm font-medium mb-2 ${
                                            reviewAction === 'approved' ? 'text-green-400' : 'text-red-400'
                                          }`}>
                                            {reviewAction === 'approved' ? 'Approving Verification' : 'Rejecting Verification'}
                                          </div>
                                          <div className="text-xs text-slate-400">
                                            {reviewAction === 'approved'
                                              ? 'Optional: Add approval notes'
                                              : 'Required: Explain rejection reason and what documents are needed'}
                                          </div>
                                        </div>
                                        <textarea
                                          value={auditRemark}
                                          onChange={(e) => {
                                            setAuditRemark(e.target.value);
                                            if (validationError) setValidationError(null);
                                          }}
                                          placeholder={
                                            reviewAction === 'approved'
                                              ? 'Approval notes (optional)'
                                              : 'Please specify: 1) Why rejected 2) What documents/info needed (required)'
                                          }
                                          className={`w-full px-3 py-2 bg-slate-900/50 backdrop-blur-sm border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 resize-none text-sm ${
                                            validationError && reviewing === verification.id
                                              ? 'border-red-500 focus:ring-red-500'
                                              : 'border-slate-700 focus:ring-blue-500'
                                          }`}
                                          rows={4}
                                        />
                                        {validationError && reviewing === verification.id && (
                                          <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400 text-sm">
                                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                            <span>{validationError}</span>
                                          </div>
                                        )}
                                        <div className="flex gap-2">
                                          <button
                                            onClick={() => handleReview(verification.id, reviewAction)}
                                            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-white rounded-lg text-sm font-medium transition-all ${
                                              reviewAction === 'approved'
                                                ? 'bg-green-600 hover:bg-green-700'
                                                : 'bg-red-600 hover:bg-red-700'
                                            }`}
                                          >
                                            {reviewAction === 'approved' ? (
                                              <><CheckCircle className="w-4 h-4" /> Confirm Approval</>
                                            ) : (
                                              <><XCircle className="w-4 h-4" /> Confirm Rejection</>
                                            )}
                                          </button>
                                          <button
                                            onClick={() => {
                                              setReviewAction(null);
                                              setAuditRemark('');
                                              setValidationError(null);
                                            }}
                                            className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm transition-all"
                                          >
                                            Back
                                          </button>
                                        </div>
                                      </>
                                    ) : (
                                      <>
                                        <div className="flex gap-2">
                                          <button
                                            onClick={() => setReviewAction('approved')}
                                            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-all"
                                          >
                                            <CheckCircle className="w-4 h-4" />
                                            Approve
                                          </button>
                                          <button
                                            onClick={() => setReviewAction('rejected')}
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
                                      </>
                                    )}
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => setReviewing(verification.id)}
                                    className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-all"
                                  >
                                    Review Request
                                  </button>
                                )
                              ) : (
                                <div className="space-y-2">
                                  <button
                                    onClick={() => handleReset(verification.id)}
                                    disabled={resetting === verification.id}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    <RotateCcw className="w-4 h-4" />
                                    {resetting === verification.id ? 'Resetting...' : 'Reset to Pending'}
                                  </button>
                                  <button
                                    onClick={() => handleDelete(verification.id)}
                                    disabled={deleting === verification.id}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                    {deleting === verification.id ? 'Deleting...' : 'Delete Request'}
                                  </button>
                                </div>
                              )}
                            </div>
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
      ) : (
        <div className="space-y-4 max-h-[1200px] overflow-y-auto">
          {filteredVerifications.map((verification) => {
            const isPending = verification.status === 'pending';
            const isExpanded = expandedDetails.has(verification.id);
            const adminId = verification.employee?.created_by;
            return (
            <div
              key={verification.id}
              className={`rounded-lg p-4 transition-all ${
                isPending
                  ? 'bg-gradient-to-r from-orange-900/30 to-red-900/30 border-2 border-orange-500/50 shadow-lg shadow-orange-500/20'
                  : 'bg-slate-800/50 border border-slate-700'
              }`}
            >
              <div className="flex flex-col lg:flex-row justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-white font-medium">{verification.employee?.username}</span>
                      <span className="text-slate-500 text-sm">{verification.employee?.employee_id}</span>
                      {getStatusBadge(verification.status)}
                      {admin.role === 'super_admin' && adminId && (
                        <div className="flex items-center gap-1.5 px-3 py-1 bg-blue-600/20 border border-blue-500/50 rounded-full text-blue-300 text-xs font-medium">
                          <Users className="w-3 h-3" />
                          <span>Admin: {getAdminName(adminId)}</span>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => toggleDetails(verification.id)}
                      className="flex items-center gap-2 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/50 rounded-lg text-blue-300 text-sm font-medium transition-all"
                    >
                      {isExpanded ? (
                        <><EyeOff className="w-4 h-4" /> Hide Details</>
                      ) : (
                        <><Eye className="w-4 h-4" /> View Details</>
                      )}
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="mb-4 p-4 bg-slate-900/50 rounded-lg border border-blue-500/20">
                      <div className="flex items-center gap-2 mb-3">
                        <FileText className="w-4 h-4 text-blue-400" />
                        <h3 className="text-sm font-bold text-blue-300 uppercase tracking-wide">Verification Information</h3>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <div className="text-xs text-slate-500 uppercase tracking-wider">Real Name</div>
                          <div className="text-sm text-white font-medium">{verification.real_name}</div>
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs text-slate-500 uppercase tracking-wider">Phone Number</div>
                          <div className="text-sm text-white font-medium">{verification.phone}</div>
                        </div>
                        <div className="space-y-1 md:col-span-2">
                          <div className="text-xs text-slate-500 uppercase tracking-wider">Email Address</div>
                          <div className="text-sm text-white font-medium">{verification.email}</div>
                        </div>
                        <div className="space-y-1 md:col-span-2">
                          <div className="text-xs text-slate-500 uppercase tracking-wider">Wallet Address</div>
                          <div className="text-sm text-white font-mono break-all bg-slate-800/50 p-2 rounded">{verification.wallet_address}</div>
                        </div>
                      </div>

                      {((verification as any).id_front_url || (verification as any).id_back_url || (verification as any).selfie_url) && (
                        <div className="mt-4 pt-4 border-t border-slate-700">
                          <div className="flex items-center gap-2 mb-3">
                            <ImageIcon className="w-4 h-4 text-blue-400" />
                            <h3 className="text-sm font-bold text-blue-300 uppercase tracking-wide">Supporting Documents</h3>
                          </div>
                          <button
                            onClick={() => openImagePreview(verification)}
                            className="w-full px-4 py-3 bg-gradient-to-r from-cyan-600/20 to-blue-600/20 hover:from-cyan-600/30 hover:to-blue-600/30 border border-cyan-500/50 rounded-lg text-cyan-300 font-medium transition-all flex items-center justify-center gap-2"
                          >
                            <Eye className="w-4 h-4" />
                            View Verification Documents
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                    <div className="flex items-start gap-2">
                      <User className="w-4 h-4 text-slate-400 mt-0.5" />
                      <div>
                        <div className="text-xs text-slate-500">Real Name</div>
                        <div className="text-sm text-slate-200">{verification.real_name}</div>
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <Wallet className="w-4 h-4 text-slate-400 mt-0.5" />
                      <div>
                        <div className="text-xs text-slate-500">Wallet Address</div>
                        <div className="text-sm text-slate-200 font-mono break-all">{verification.wallet_address}</div>
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <Phone className="w-4 h-4 text-slate-400 mt-0.5" />
                      <div>
                        <div className="text-xs text-slate-500">Phone</div>
                        <div className="text-sm text-slate-200">{verification.phone}</div>
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <Mail className="w-4 h-4 text-slate-400 mt-0.5" />
                      <div>
                        <div className="text-xs text-slate-500">Email</div>
                        <div className="text-sm text-slate-200">{verification.email}</div>
                      </div>
                    </div>
                  </div>

                  <div className="text-slate-400 text-sm">
                    Submitted: {new Date(verification.created_at).toLocaleString()}
                  </div>

                  {verification.audit_remark && (
                    <div className="mt-2 p-2 bg-slate-900 rounded text-slate-300 text-sm">
                      <strong>Audit Note:</strong> {verification.audit_remark}
                    </div>
                  )}
                </div>

                <div className="lg:w-80">
                  {verification.status === 'pending' ? (
                    reviewing === verification.id ? (
                      <div className="space-y-3">
                        {reviewAction ? (
                          <>
                            <div className={`p-3 rounded-lg ${
                              reviewAction === 'approved'
                                ? 'bg-green-500/10 border border-green-500/30'
                                : 'bg-red-500/10 border border-red-500/30'
                            }`}>
                              <div className={`text-sm font-medium mb-2 ${
                                reviewAction === 'approved' ? 'text-green-400' : 'text-red-400'
                              }`}>
                                {reviewAction === 'approved' ? 'Approving Verification' : 'Rejecting Verification'}
                              </div>
                              <div className="text-xs text-slate-400">
                                {reviewAction === 'approved'
                                  ? 'Optional: Add approval notes'
                                  : 'Required: Explain rejection reason and what documents are needed'}
                              </div>
                            </div>
                            <textarea
                              value={auditRemark}
                              onChange={(e) => {
                                setAuditRemark(e.target.value);
                                if (validationError) setValidationError(null);
                              }}
                              placeholder={
                                reviewAction === 'approved'
                                  ? 'Approval notes (optional)'
                                  : 'Please specify: 1) Why rejected 2) What documents/info needed (required)'
                              }
                              className={`w-full px-3 py-2 bg-slate-900/50 backdrop-blur-sm border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 resize-none text-sm ${
                                validationError && reviewing === verification.id
                                  ? 'border-red-500 focus:ring-red-500'
                                  : 'border-slate-700 focus:ring-blue-500'
                              }`}
                              rows={4}
                            />
                            {validationError && reviewing === verification.id && (
                              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400 text-sm">
                                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                <span>{validationError}</span>
                              </div>
                            )}
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleReview(verification.id, reviewAction)}
                                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-white rounded-lg text-sm font-medium transition-all ${
                                  reviewAction === 'approved'
                                    ? 'bg-green-600 hover:bg-green-700'
                                    : 'bg-red-600 hover:bg-red-700'
                                }`}
                              >
                                {reviewAction === 'approved' ? (
                                  <><CheckCircle className="w-4 h-4" /> Confirm Approval</>
                                ) : (
                                  <><XCircle className="w-4 h-4" /> Confirm Rejection</>
                                )}
                              </button>
                              <button
                                onClick={() => {
                                  setReviewAction(null);
                                  setAuditRemark('');
                                  setValidationError(null);
                                }}
                                className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm transition-all"
                              >
                                Back
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex gap-2">
                              <button
                                onClick={() => setReviewAction('approved')}
                                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-all"
                              >
                                <CheckCircle className="w-4 h-4" />
                                Approve
                              </button>
                              <button
                                onClick={() => setReviewAction('rejected')}
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
                          </>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={() => setReviewing(verification.id)}
                        className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-all"
                      >
                        Review Request
                      </button>
                    )
                  ) : (
                    <div className="space-y-2">
                      <button
                        onClick={() => handleReset(verification.id)}
                        disabled={resetting === verification.id}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <RotateCcw className="w-4 h-4" />
                        {resetting === verification.id ? 'Resetting...' : 'Reset to Pending'}
                      </button>
                      <button
                        onClick={() => handleDelete(verification.id)}
                        disabled={deleting === verification.id}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-4 h-4" />
                        {deleting === verification.id ? 'Deleting...' : 'Delete Request'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}
        </>
      )}

      {/* Verified Employees View */}
      {viewMode === 'verified' && (
        <>
          {loading ? (
            <div className="text-center py-8 text-slate-400">Loading verified employees...</div>
          ) : filteredVerifiedEmployees.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              {searchQuery ? 'No verified employees match your search' : 'No verified employees found'}
            </div>
          ) : groupMode === 'by_admin' && admin.role === 'super_admin' && !searchQuery ? (
            <div className="space-y-6">
              {Array.from(groupedVerifiedEmployees.entries())
                .sort(([adminIdA], [adminIdB]) => getAdminName(adminIdA).localeCompare(getAdminName(adminIdB)))
                .map(([adminId, adminEmployees]) => {
                  const isExpanded = expandedAdmins.has(adminId);

                  return (
                    <div key={adminId} className="bg-slate-800/30 rounded-xl border border-slate-700/50 overflow-hidden">
                      <button
                        onClick={() => toggleAdminGroup(adminId)}
                        className="w-full flex items-center justify-between p-4 bg-slate-800/50 hover:bg-slate-800/70 transition-all"
                      >
                        <div className="flex items-center gap-3">
                          <Users className="w-5 h-5 text-green-400" />
                          <span className="text-white font-semibold">{getAdminName(adminId)}</span>
                          <span className="px-3 py-1 bg-green-600/20 border border-green-500/50 rounded-full text-green-300 text-sm font-medium">
                            {adminEmployees.length} verified
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-slate-400">
                          <span className="text-sm">{isExpanded ? 'Hide' : 'Show'}</span>
                          {isExpanded ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="p-4 space-y-4 max-h-[1200px] overflow-y-auto">
                          {adminEmployees.map((employee) => {
                            const verification = verifications.find(v => v.user_id === employee.id && v.status === 'approved');
                            const isDetailExpanded = selectedEmployee?.id === employee.id;

                            return (
                              <div
                                key={employee.id}
                                className="bg-slate-800/50 border border-green-500/30 rounded-lg p-4 hover:border-green-500/50 transition-all"
                              >
                                <div className="flex flex-col lg:flex-row justify-between gap-4">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-3 mb-3">
                                      <div className="flex items-center gap-2">
                                        <Shield className="w-5 h-5 text-green-400" />
                                        <span className="text-white font-medium">{employee.username}</span>
                                      </div>
                                      <span className="text-slate-500 text-sm">{employee.employee_id}</span>
                                      <div className="flex items-center gap-2 px-3 py-1 rounded-full border bg-green-500/10 border-green-500/50 text-green-400 text-sm font-medium">
                                        <CheckCircle className="w-4 h-4" />
                                        Verified
                                      </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                                      <div className="flex items-center gap-2 text-slate-300">
                                        <Hash className="w-4 h-4 text-slate-500" />
                                        <span className="text-slate-500">Employee ID:</span>
                                        <span>{employee.employee_id}</span>
                                      </div>
                                      <div className="flex items-center gap-2 text-slate-300">
                                        <User className="w-4 h-4 text-slate-500" />
                                        <span className="text-slate-500">Username:</span>
                                        <span>{employee.username}</span>
                                      </div>
                                      <div className="flex items-center gap-2 text-slate-300">
                                        <Wallet className="w-4 h-4 text-slate-500" />
                                        <span className="text-slate-500">Balance:</span>
                                        <span className="text-green-400 font-medium">${(walletBalances.get(employee.id) || 0).toFixed(2)}</span>
                                      </div>
                                      <div className="flex items-center gap-2 text-slate-300">
                                        <Calendar className="w-4 h-4 text-slate-500" />
                                        <span className="text-slate-500">Joined:</span>
                                        <span>{new Date(employee.created_at).toLocaleDateString()}</span>
                                      </div>
                                    </div>

                                    {verification ? (
                                      <div className="mt-4 pt-4 border-t border-slate-700">
                                        <div className="flex items-center justify-between mb-3">
                                          <h4 className="text-sm font-semibold text-slate-300">Verification Information</h4>
                                          <button
                                            onClick={() => setSelectedEmployee(isDetailExpanded ? null : employee)}
                                            className="flex items-center gap-2 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/50 rounded-lg text-blue-300 text-xs font-medium transition-all"
                                          >
                                            {isDetailExpanded ? (
                                              <><EyeOff className="w-3 h-3" /> Hide Documents</>
                                            ) : (
                                              <><Eye className="w-3 h-3" /> View Documents</>
                                            )}
                                          </button>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                                          <div className="flex items-start gap-2 text-slate-300">
                                            <User className="w-4 h-4 text-slate-500 mt-0.5" />
                                            <div>
                                              <span className="text-slate-500">Real Name:</span>
                                              <span className="ml-2 text-white font-medium">{verification.real_name}</span>
                                            </div>
                                          </div>
                                          <div className="flex items-start gap-2 text-slate-300">
                                            <Phone className="w-4 h-4 text-slate-500 mt-0.5" />
                                            <div>
                                              <span className="text-slate-500">Phone:</span>
                                              <span className="ml-2 text-white">{verification.phone}</span>
                                            </div>
                                          </div>
                                          <div className="flex items-start gap-2 text-slate-300">
                                            <Wallet className="w-4 h-4 text-slate-500 mt-0.5" />
                                            <div className="flex flex-col">
                                              <span className="text-slate-500">Wallet Address:</span>
                                              <span className="text-white font-mono text-xs break-all mt-1">{verification.wallet_address}</span>
                                            </div>
                                          </div>
                                          <div className="flex items-start gap-2 text-slate-300">
                                            <Mail className="w-4 h-4 text-slate-500 mt-0.5" />
                                            <div>
                                              <span className="text-slate-500">Address:</span>
                                              <span className="ml-2 text-white">{verification.email}</span>
                                            </div>
                                          </div>
                                          <div className="flex items-start gap-2 text-slate-300">
                                            <Calendar className="w-4 h-4 text-slate-500 mt-0.5" />
                                            <div>
                                              <span className="text-slate-500">Verified On:</span>
                                              <span className="ml-2 text-white">
                                                {verification.audited_at ? new Date(verification.audited_at).toLocaleString() : 'N/A'}
                                              </span>
                                            </div>
                                          </div>
                                          {verification.audited_by && (
                                            <div className="flex items-start gap-2 text-slate-300">
                                              <User className="w-4 h-4 text-slate-500 mt-0.5" />
                                              <div>
                                                <span className="text-slate-500">Verified By:</span>
                                                <span className="ml-2 text-white">{verification.audited_by}</span>
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="mt-4 pt-4 border-t border-slate-700">
                                        <div className="flex items-center gap-2 text-yellow-400 text-sm">
                                          <AlertCircle className="w-4 h-4" />
                                          <span>Verification information not found for this employee</span>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {isDetailExpanded && verification && (verification.id_front_url || verification.id_back_url || verification.selfie_url) && (
                                  <div className="mt-4 pt-4 border-t border-slate-700">
                                    <h4 className="text-sm font-semibold text-slate-300 mb-3">Verification Documents</h4>
                                    <button
                                      onClick={() => openImagePreview(verification as VerificationWithEmployee)}
                                      className="w-full px-4 py-3 bg-gradient-to-r from-cyan-600/20 to-blue-600/20 hover:from-cyan-600/30 hover:to-blue-600/30 border border-cyan-500/50 rounded-lg text-cyan-300 font-medium transition-all flex items-center justify-center gap-2"
                                    >
                                      <Eye className="w-4 h-4" />
                                      View Verification Documents
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          ) : (
            <div className="space-y-4 max-h-[1200px] overflow-y-auto">
              {filteredVerifiedEmployees.map((employee) => {
                const verification = verifications.find(v => v.user_id === employee.id && v.status === 'approved');
                const isExpanded = selectedEmployee?.id === employee.id;
                const adminId = employee.created_by;

                return (
                  <div
                    key={employee.id}
                    className="bg-slate-800/50 border border-green-500/30 rounded-lg p-4 hover:border-green-500/50 transition-all"
                  >
                    <div className="flex flex-col lg:flex-row justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-3 flex-wrap">
                          <div className="flex items-center gap-2">
                            <Shield className="w-5 h-5 text-green-400" />
                            <span className="text-white font-medium">{employee.username}</span>
                          </div>
                          <span className="text-slate-500 text-sm">{employee.employee_id}</span>
                          <div className="flex items-center gap-2 px-3 py-1 rounded-full border bg-green-500/10 border-green-500/50 text-green-400 text-sm font-medium">
                            <CheckCircle className="w-4 h-4" />
                            Verified
                          </div>
                          {admin.role === 'super_admin' && adminId && (
                            <div className="flex items-center gap-1.5 px-3 py-1 bg-blue-600/20 border border-blue-500/50 rounded-full text-blue-300 text-xs font-medium">
                              <Users className="w-3 h-3" />
                              <span>Admin: {getAdminName(adminId)}</span>
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                          <div className="flex items-center gap-2 text-slate-300">
                            <Hash className="w-4 h-4 text-slate-500" />
                            <span className="text-slate-500">Employee ID:</span>
                            <span>{employee.employee_id}</span>
                          </div>
                          <div className="flex items-center gap-2 text-slate-300">
                            <User className="w-4 h-4 text-slate-500" />
                            <span className="text-slate-500">Username:</span>
                            <span>{employee.username}</span>
                          </div>
                          <div className="flex items-center gap-2 text-slate-300">
                            <Wallet className="w-4 h-4 text-slate-500" />
                            <span className="text-slate-500">Balance:</span>
                            <span className="text-green-400 font-medium">${(walletBalances.get(employee.id) || 0).toFixed(2)}</span>
                          </div>
                          <div className="flex items-center gap-2 text-slate-300">
                            <Calendar className="w-4 h-4 text-slate-500" />
                            <span className="text-slate-500">Joined:</span>
                            <span>{new Date(employee.created_at).toLocaleDateString()}</span>
                          </div>
                        </div>

                        {/* Verification Information - Always Visible */}
                        {verification ? (
                          <div className="mt-4 pt-4 border-t border-slate-700">
                            <div className="flex items-center justify-between mb-3">
                              <h4 className="text-sm font-semibold text-slate-300">Verification Information</h4>
                              <button
                                onClick={() => setSelectedEmployee(isExpanded ? null : employee)}
                                className="flex items-center gap-2 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/50 rounded-lg text-blue-300 text-xs font-medium transition-all"
                              >
                                {isExpanded ? (
                                  <><EyeOff className="w-3 h-3" /> Hide Documents</>
                                ) : (
                                  <><Eye className="w-3 h-3" /> View Documents</>
                                )}
                              </button>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                              <div className="flex items-start gap-2 text-slate-300">
                                <User className="w-4 h-4 text-slate-500 mt-0.5" />
                                <div>
                                  <span className="text-slate-500">Real Name:</span>
                                  <span className="ml-2 text-white font-medium">{verification.real_name}</span>
                                </div>
                              </div>
                              <div className="flex items-start gap-2 text-slate-300">
                                <Phone className="w-4 h-4 text-slate-500 mt-0.5" />
                                <div>
                                  <span className="text-slate-500">Phone:</span>
                                  <span className="ml-2 text-white">{verification.phone}</span>
                                </div>
                              </div>
                              <div className="flex items-start gap-2 text-slate-300">
                                <Wallet className="w-4 h-4 text-slate-500 mt-0.5" />
                                <div className="flex flex-col">
                                  <span className="text-slate-500">Wallet Address:</span>
                                  <span className="text-white font-mono text-xs break-all mt-1">{verification.wallet_address}</span>
                                </div>
                              </div>
                              <div className="flex items-start gap-2 text-slate-300">
                                <Mail className="w-4 h-4 text-slate-500 mt-0.5" />
                                <div>
                                  <span className="text-slate-500">Address:</span>
                                  <span className="ml-2 text-white">{verification.email}</span>
                                </div>
                              </div>
                              <div className="flex items-start gap-2 text-slate-300">
                                <Calendar className="w-4 h-4 text-slate-500 mt-0.5" />
                                <div>
                                  <span className="text-slate-500">Verified On:</span>
                                  <span className="ml-2 text-white">
                                    {verification.audited_at ? new Date(verification.audited_at).toLocaleString() : 'N/A'}
                                  </span>
                                </div>
                              </div>
                              {verification.audited_by && (
                                <div className="flex items-start gap-2 text-slate-300">
                                  <User className="w-4 h-4 text-slate-500 mt-0.5" />
                                  <div>
                                    <span className="text-slate-500">Verified By:</span>
                                    <span className="ml-2 text-white">{verification.audited_by}</span>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="mt-4 pt-4 border-t border-slate-700">
                            <div className="flex items-center gap-2 text-yellow-400 text-sm">
                              <AlertCircle className="w-4 h-4" />
                              <span>Verification information not found for this employee</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Verification Documents - Collapsible */}
                    {isExpanded && verification && (verification.id_front_url || verification.id_back_url || verification.selfie_url) && (
                      <div className="mt-4 pt-4 border-t border-slate-700">
                        <h4 className="text-sm font-semibold text-slate-300 mb-3">Verification Documents</h4>
                        <button
                          onClick={() => openImagePreview(verification as VerificationWithEmployee)}
                          className="w-full px-4 py-3 bg-gradient-to-r from-cyan-600/20 to-blue-600/20 hover:from-cyan-600/30 hover:to-blue-600/30 border border-cyan-500/50 rounded-lg text-cyan-300 font-medium transition-all flex items-center justify-center gap-2"
                        >
                          <Eye className="w-4 h-4" />
                          View Verification Documents
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Rejected Requests View */}
      {viewMode === 'rejected' && (
        <>
          {loading ? (
            <div className="text-center py-8 text-slate-400">Loading rejected requests...</div>
          ) : filteredRejectedVerifications.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              {searchQuery ? 'No rejected requests match your search' : 'No rejected requests found'}
            </div>
          ) : groupMode === 'by_admin' && admin.role === 'super_admin' && !searchQuery ? (
            <div className="space-y-6">
              {Array.from(groupedRejectedVerifications.entries())
                .sort(([adminIdA], [adminIdB]) => getAdminName(adminIdA).localeCompare(getAdminName(adminIdB)))
                .map(([adminId, adminVerifications]) => {
                  const isExpanded = expandedAdmins.has(adminId);

                  return (
                    <div key={adminId} className="bg-slate-800/30 rounded-xl border border-slate-700/50 overflow-hidden">
                      <button
                        onClick={() => toggleAdminGroup(adminId)}
                        className="w-full flex items-center justify-between p-4 bg-slate-800/50 hover:bg-slate-800/70 transition-all"
                      >
                        <div className="flex items-center gap-3">
                          <Users className="w-5 h-5 text-red-400" />
                          <span className="text-white font-semibold">{getAdminName(adminId)}</span>
                          <span className="px-3 py-1 bg-red-600/20 border border-red-500/50 rounded-full text-red-300 text-sm font-medium">
                            {adminVerifications.length} rejected
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-slate-400">
                          <span className="text-sm">{isExpanded ? 'Hide' : 'Show'}</span>
                          {isExpanded ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="p-4 space-y-4 max-h-[1200px] overflow-y-auto">
                          {adminVerifications.map((verification) => {
                            const isDetailExpanded = expandedDetails.has(verification.id);
                            return (
                              <div
                                key={verification.id}
                                className="bg-slate-800/50 border border-red-500/30 rounded-lg p-4 hover:border-red-500/50 transition-all"
                              >
                                <div className="flex flex-col lg:flex-row justify-between gap-4">
                                  <div className="flex-1">
                                    <div className="flex items-center justify-between gap-3 mb-3">
                                      <div className="flex items-center gap-3">
                                        <span className="text-white font-medium">{verification.employee?.username}</span>
                                        <span className="text-slate-500 text-sm">{verification.employee?.employee_id}</span>
                                        {getStatusBadge(verification.status)}
                                      </div>
                                      <button
                                        onClick={() => toggleDetails(verification.id)}
                                        className="flex items-center gap-2 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/50 rounded-lg text-blue-300 text-sm font-medium transition-all"
                                      >
                                        {isDetailExpanded ? (
                                          <><EyeOff className="w-4 h-4" /> Hide Details</>
                                        ) : (
                                          <><Eye className="w-4 h-4" /> View Details</>
                                        )}
                                      </button>
                                    </div>

                                    {isDetailExpanded && (
                                      <div className="mb-4 p-4 bg-slate-900/50 rounded-lg border border-blue-500/20">
                                        <div className="flex items-center gap-2 mb-3">
                                          <FileText className="w-4 h-4 text-blue-400" />
                                          <h3 className="text-sm font-bold text-blue-300 uppercase tracking-wide">Verification Information</h3>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                          <div className="space-y-1">
                                            <div className="text-xs text-slate-500 uppercase tracking-wider">Real Name</div>
                                            <div className="text-sm text-white font-medium">{verification.real_name}</div>
                                          </div>
                                          <div className="space-y-1">
                                            <div className="text-xs text-slate-500 uppercase tracking-wider">Phone Number</div>
                                            <div className="text-sm text-white font-medium">{verification.phone}</div>
                                          </div>
                                          <div className="space-y-1 md:col-span-2">
                                            <div className="text-xs text-slate-500 uppercase tracking-wider">Email Address</div>
                                            <div className="text-sm text-white font-medium">{verification.email}</div>
                                          </div>
                                          <div className="space-y-1 md:col-span-2">
                                            <div className="text-xs text-slate-500 uppercase tracking-wider">Wallet Address</div>
                                            <div className="text-sm text-white font-mono break-all bg-slate-800/50 p-2 rounded">{verification.wallet_address}</div>
                                          </div>
                                        </div>

                                        {((verification as any).id_front_url || (verification as any).id_back_url || (verification as any).selfie_url) && (
                                          <div className="mt-4 pt-4 border-t border-slate-700">
                                            <div className="flex items-center gap-2 mb-3">
                                              <ImageIcon className="w-4 h-4 text-blue-400" />
                                              <h3 className="text-sm font-bold text-blue-300 uppercase tracking-wide">Supporting Documents</h3>
                                            </div>
                                            <button
                                              onClick={() => openImagePreview(verification)}
                                              className="w-full px-4 py-3 bg-gradient-to-r from-cyan-600/20 to-blue-600/20 hover:from-cyan-600/30 hover:to-blue-600/30 border border-cyan-500/50 rounded-lg text-cyan-300 font-medium transition-all flex items-center justify-center gap-2"
                                            >
                                              <Eye className="w-4 h-4" />
                                              View Verification Documents
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                                      <div className="flex items-start gap-2">
                                        <User className="w-4 h-4 text-slate-400 mt-0.5" />
                                        <div>
                                          <div className="text-xs text-slate-500">Real Name</div>
                                          <div className="text-sm text-slate-200">{verification.real_name}</div>
                                        </div>
                                      </div>

                                      <div className="flex items-start gap-2">
                                        <Wallet className="w-4 h-4 text-slate-400 mt-0.5" />
                                        <div>
                                          <div className="text-xs text-slate-500">Wallet Address</div>
                                          <div className="text-sm text-slate-200 font-mono break-all">{verification.wallet_address}</div>
                                        </div>
                                      </div>

                                      <div className="flex items-start gap-2">
                                        <Phone className="w-4 h-4 text-slate-400 mt-0.5" />
                                        <div>
                                          <div className="text-xs text-slate-500">Phone</div>
                                          <div className="text-sm text-slate-200">{verification.phone}</div>
                                        </div>
                                      </div>

                                      <div className="flex items-start gap-2">
                                        <Mail className="w-4 h-4 text-slate-400 mt-0.5" />
                                        <div>
                                          <div className="text-xs text-slate-500">Email</div>
                                          <div className="text-sm text-slate-200">{verification.email}</div>
                                        </div>
                                      </div>
                                    </div>

                                    <div className="text-slate-400 text-sm mb-2">
                                      Submitted: {new Date(verification.created_at).toLocaleString()}
                                    </div>

                                    {verification.audited_at && (
                                      <div className="text-slate-400 text-sm mb-2">
                                        Rejected: {new Date(verification.audited_at).toLocaleString()}
                                      </div>
                                    )}

                                    {verification.audit_remark && (
                                      <div className="mt-2 p-3 bg-red-900/30 border border-red-500/50 rounded-lg text-red-200 text-sm">
                                        <div className="flex items-start gap-2">
                                          <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                                          <div>
                                            <strong className="text-red-300">Rejection Reason:</strong>
                                            <div className="mt-1">{verification.audit_remark}</div>
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>

                                  <div className="lg:w-80">
                                    <div className="space-y-2">
                                      <button
                                        onClick={() => handleReset(verification.id)}
                                        disabled={resetting === verification.id}
                                        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                      >
                                        <RotateCcw className="w-4 h-4" />
                                        {resetting === verification.id ? 'Resetting...' : 'Reset to Pending'}
                                      </button>
                                      <button
                                        onClick={() => handleDelete(verification.id)}
                                        disabled={deleting === verification.id}
                                        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                        {deleting === verification.id ? 'Deleting...' : 'Delete Request'}
                                      </button>
                                    </div>
                                  </div>
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
          ) : (
            <div className="space-y-4 max-h-[1200px] overflow-y-auto">
              {filteredRejectedVerifications.map((verification) => {
                const isExpanded = expandedDetails.has(verification.id);
                const adminId = verification.employee?.created_by;
                return (
                  <div
                    key={verification.id}
                    className="bg-slate-800/50 border border-red-500/30 rounded-lg p-4 hover:border-red-500/50 transition-all"
                  >
                    <div className="flex flex-col lg:flex-row justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center justify-between gap-3 mb-3">
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className="text-white font-medium">{verification.employee?.username}</span>
                            <span className="text-slate-500 text-sm">{verification.employee?.employee_id}</span>
                            {getStatusBadge(verification.status)}
                            {admin.role === 'super_admin' && adminId && (
                              <div className="flex items-center gap-1.5 px-3 py-1 bg-blue-600/20 border border-blue-500/50 rounded-full text-blue-300 text-xs font-medium">
                                <Users className="w-3 h-3" />
                                <span>Admin: {getAdminName(adminId)}</span>
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => toggleDetails(verification.id)}
                            className="flex items-center gap-2 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/50 rounded-lg text-blue-300 text-sm font-medium transition-all"
                          >
                            {isExpanded ? (
                              <><EyeOff className="w-4 h-4" /> Hide Details</>
                            ) : (
                              <><Eye className="w-4 h-4" /> View Details</>
                            )}
                          </button>
                        </div>

                        {isExpanded && (
                          <div className="mb-4 p-4 bg-slate-900/50 rounded-lg border border-blue-500/20">
                            <div className="flex items-center gap-2 mb-3">
                              <FileText className="w-4 h-4 text-blue-400" />
                              <h3 className="text-sm font-bold text-blue-300 uppercase tracking-wide">Verification Information</h3>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-1">
                                <div className="text-xs text-slate-500 uppercase tracking-wider">Real Name</div>
                                <div className="text-sm text-white font-medium">{verification.real_name}</div>
                              </div>
                              <div className="space-y-1">
                                <div className="text-xs text-slate-500 uppercase tracking-wider">Phone Number</div>
                                <div className="text-sm text-white font-medium">{verification.phone}</div>
                              </div>
                              <div className="space-y-1 md:col-span-2">
                                <div className="text-xs text-slate-500 uppercase tracking-wider">Email Address</div>
                                <div className="text-sm text-white font-medium">{verification.email}</div>
                              </div>
                              <div className="space-y-1 md:col-span-2">
                                <div className="text-xs text-slate-500 uppercase tracking-wider">Wallet Address</div>
                                <div className="text-sm text-white font-mono break-all bg-slate-800/50 p-2 rounded">{verification.wallet_address}</div>
                              </div>
                            </div>

                            {((verification as any).id_front_url || (verification as any).id_back_url || (verification as any).selfie_url) && (
                              <div className="mt-4 pt-4 border-t border-slate-700">
                                <div className="flex items-center gap-2 mb-3">
                                  <ImageIcon className="w-4 h-4 text-blue-400" />
                                  <h3 className="text-sm font-bold text-blue-300 uppercase tracking-wide">Supporting Documents</h3>
                                </div>
                                <button
                                  onClick={() => openImagePreview(verification)}
                                  className="w-full px-4 py-3 bg-gradient-to-r from-cyan-600/20 to-blue-600/20 hover:from-cyan-600/30 hover:to-blue-600/30 border border-cyan-500/50 rounded-lg text-cyan-300 font-medium transition-all flex items-center justify-center gap-2"
                                >
                                  <Eye className="w-4 h-4" />
                                  View Verification Documents
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                          <div className="flex items-start gap-2">
                            <User className="w-4 h-4 text-slate-400 mt-0.5" />
                            <div>
                              <div className="text-xs text-slate-500">Real Name</div>
                              <div className="text-sm text-slate-200">{verification.real_name}</div>
                            </div>
                          </div>

                          <div className="flex items-start gap-2">
                            <Wallet className="w-4 h-4 text-slate-400 mt-0.5" />
                            <div>
                              <div className="text-xs text-slate-500">Wallet Address</div>
                              <div className="text-sm text-slate-200 font-mono break-all">{verification.wallet_address}</div>
                            </div>
                          </div>

                          <div className="flex items-start gap-2">
                            <Phone className="w-4 h-4 text-slate-400 mt-0.5" />
                            <div>
                              <div className="text-xs text-slate-500">Phone</div>
                              <div className="text-sm text-slate-200">{verification.phone}</div>
                            </div>
                          </div>

                          <div className="flex items-start gap-2">
                            <Mail className="w-4 h-4 text-slate-400 mt-0.5" />
                            <div>
                              <div className="text-xs text-slate-500">Email</div>
                              <div className="text-sm text-slate-200">{verification.email}</div>
                            </div>
                          </div>
                        </div>

                        <div className="text-slate-400 text-sm mb-2">
                          Submitted: {new Date(verification.created_at).toLocaleString()}
                        </div>

                        {verification.audited_at && (
                          <div className="text-slate-400 text-sm mb-2">
                            Rejected: {new Date(verification.audited_at).toLocaleString()}
                          </div>
                        )}

                        {verification.audit_remark && (
                          <div className="mt-2 p-3 bg-red-900/30 border border-red-500/50 rounded-lg text-red-200 text-sm">
                            <div className="flex items-start gap-2">
                              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                              <div>
                                <strong className="text-red-300">Rejection Reason:</strong>
                                <div className="mt-1">{verification.audit_remark}</div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="lg:w-80">
                        <div className="space-y-2">
                          <button
                            onClick={() => handleReset(verification.id)}
                            disabled={resetting === verification.id}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <RotateCcw className="w-4 h-4" />
                            {resetting === verification.id ? 'Resetting...' : 'Reset to Pending'}
                          </button>
                          <button
                            onClick={() => handleDelete(verification.id)}
                            disabled={deleting === verification.id}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Trash2 className="w-4 h-4" />
                            {deleting === verification.id ? 'Deleting...' : 'Delete Request'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      </div>
    </>
  );
}
