import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  X,
  TrendingUp,
  CheckCircle,
  XCircle,
  Calendar,
  DollarSign,
  User,
  Wallet,
  Clock,
  MessageSquare,
  FileText,
  Shield,
  Mail,
  Phone,
  CreditCard,
  Eye,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Employee } from "../../types";

interface DailyStats {
  date: string;
  totalCommission: number;
  successCount: number;
  failureCount: number;
  totalOrders: number;
}

interface WalletTransaction {
  id: string;
  type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  remarks: string;
  created_at: string;
  created_by?: string;
  reference_id?: string;
}

interface VerificationRequest {
  id: string;
  user_id: string;
  real_name: string;
  wallet_address: string;
  phone: string;
  email: string;
  status: 'pending' | 'approved' | 'rejected';
  audit_remark: string | null;
  audited_by: string | null;
  audited_at: string | null;
  id_front_url: string | null;
  id_back_url: string | null;
  selfie_url: string | null;
  created_at: string;
  updated_at: string;
}

interface EmployeeDetailModalProps {
  employee: Employee;
  onClose: () => void;
}

interface ImagePreview {
  images: { url: string; label: string }[];
  currentIndex: number;
  scale: number;
}

export default function EmployeeDetailModal({
  employee,
  onClose,
}: EmployeeDetailModalProps) {
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [verificationData, setVerificationData] = useState<VerificationRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"daily" | "transactions" | "verification">("daily");
  const [currentPage, setCurrentPage] = useState(1);
  const [transactionPage, setTransactionPage] = useState(1);
  const [walletBalance, setWalletBalance] = useState({
    available: 0,
    frozen: 0,
  });
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingTransactions, setLoadingTransactions] = useState(true);
  const [loadingVerification, setLoadingVerification] = useState(true);
  const [imagePreview, setImagePreview] = useState<ImagePreview | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [imageLoading, setImageLoading] = useState(false);
  const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set());
  const itemsPerPage = 10;

  useEffect(() => {
    // Show modal immediately with basic info
    setLoading(false);
    // Load detailed data in background
    loadEmployeeDetails();
  }, [employee.id]);

  useEffect(() => {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
  }, []);

  const loadEmployeeDetails = async () => {
    try {
      setLoadingStats(true);
      setLoadingTransactions(true);

      // Load wallet balance first (fastest query)
      const walletPromise = supabase
        .from("wallets")
        .select("available_balance, frozen_balance")
        .eq("user_id", employee.id)
        .maybeSingle()
        .then((result) => {
          if (!result.error && result.data) {
            setWalletBalance({
              available: parseFloat(result.data.available_balance),
              frozen: parseFloat(result.data.frozen_balance),
            });
          }
          return result;
        });

      // Load orders and transactions independently
      const ordersPromise = supabase
        .from("orders")
        .select("status, commission_amount, created_at")
        .eq("user_id", employee.id)
        .gte(
          "created_at",
          new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
        )
        .order("created_at", { ascending: false })
        .then((result) => {
          if (!result.error && result.data) {
            const dailyStatsMap = new Map<string, DailyStats>();
            result.data.forEach((order) => {
              const date = new Date(order.created_at).toLocaleDateString(
                "zh-CN",
              );

              if (!dailyStatsMap.has(date)) {
                dailyStatsMap.set(date, {
                  date,
                  totalCommission: 0,
                  successCount: 0,
                  failureCount: 0,
                  totalOrders: 0,
                });
              }

              const stats = dailyStatsMap.get(date)!;
              stats.totalOrders += 1;

              if (order.status === "success") {
                stats.successCount += 1;
                stats.totalCommission += parseFloat(
                  order.commission_amount || "0",
                );
              } else if (order.status === "failure") {
                stats.failureCount += 1;
              }
            });
            setDailyStats(Array.from(dailyStatsMap.values()));
          }
          setLoadingStats(false);
          return result;
        });

      const transactionsPromise = supabase
        .from("wallet_transactions")
        .select("*")
        .eq("user_id", employee.id)
        .order("created_at", { ascending: false })
        .limit(100)
        .then((result) => {
          if (!result.error && result.data) {
            setTransactions(result.data);
          }
          setLoadingTransactions(false);
          return result;
        });

      const verificationPromise = supabase
        .from("verification_requests")
        .select("*")
        .eq("user_id", employee.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
        .then((result) => {
          if (!result.error && result.data) {
            setVerificationData(result.data);
          }
          setLoadingVerification(false);
          return result;
        });

      // Wait for all queries to complete
      const [walletResult, ordersResult, transactionsResult, verificationResult] =
        await Promise.all([walletPromise, ordersPromise, transactionsPromise, verificationPromise]);

      // Check for errors
      if (walletResult.error)
        console.error("Wallet load error:", walletResult.error);
      if (ordersResult.error)
        console.error("Orders load error:", ordersResult.error);
      if (transactionsResult.error)
        console.error("Transactions load error:", transactionsResult.error);
      if (verificationResult.error)
        console.error("Verification load error:", verificationResult.error);
    } catch (error) {
      console.error("Error loading employee details:", error);
      setLoadingStats(false);
      setLoadingTransactions(false);
      setLoadingVerification(false);
    }
  };

  const openImagePreview = () => {
    if (!verificationData) return;

    const images: { url: string; label: string }[] = [];

    if (verificationData.id_front_url) {
      images.push({ url: verificationData.id_front_url, label: 'ID Front' });
    }
    if (verificationData.id_back_url) {
      images.push({ url: verificationData.id_back_url, label: 'ID Back' });
    }
    if (verificationData.selfie_url) {
      images.push({ url: verificationData.selfie_url, label: 'Selfie Photo' });
    }

    if (images.length > 0) {
      setImagePreview({ images, currentIndex: 0, scale: 1 });
      setPosition({ x: 0, y: 0 });
      setImageLoading(!loadedImages.has(images[0].url));
    }
  };

  const closeImagePreview = () => {
    setImagePreview(null);
    setPosition({ x: 0, y: 0 });
    setImageLoading(false);
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

  const getTransactionTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      commission: "Order Commission",
      withdrawal_request: "Withdrawal Request",
      withdrawal_approved: "Withdrawal Approved",
      withdrawal_rejected: "Withdrawal Rejected",
      manual_adjustment: "Admin Adjustment",
    };
    return labels[type] || type;
  };

  const getTransactionColor = (type: string) => {
    if (type === "commission" || type === "withdrawal_rejected")
      return "text-green-400";
    if (type === "withdrawal_request" || type === "withdrawal_approved")
      return "text-red-400";
    if (type === "manual_adjustment") return "text-blue-400";
    return "text-slate-400";
  };

  return createPortal(
    <>
      {/* Image Preview Modal */}
      {imagePreview && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/90">
          <div className="relative max-w-7xl w-full h-[95vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between mb-4 px-4 py-3 bg-slate-900/90 backdrop-blur rounded-t-xl border border-slate-700">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-cyan-400" />
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

      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999] p-4">
      <div className="bg-slate-900 rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col border border-slate-700/50 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700/50">
          <div>
            <h2 className="text-2xl font-bold text-white">
              {employee.username}
            </h2>
            <p className="text-slate-400 mt-1">
              Employee ID: {employee.employee_id}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-6 h-6 text-slate-400" />
          </button>
        </div>

        {/* Employee Info Cards */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-700/50">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-500/20 rounded-xl p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-blue-500/20 rounded-lg">
                  <User className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-400 font-medium">Status</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-bold ${
                        employee.is_active
                          ? "bg-green-500/20 text-green-400"
                          : "bg-red-500/20 text-red-400"
                      }`}
                    >
                      {employee.is_active ? "Active" : "Inactive"}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-bold ${
                        employee.is_verified
                          ? "bg-green-500/20 text-green-400"
                          : "bg-yellow-500/20 text-yellow-400"
                      }`}
                    >
                      {employee.is_verified ? "Verified" : "Unverified"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/20 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-500/20 rounded-lg">
                  <DollarSign className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-400 font-medium">
                    Total Income
                  </p>
                  <p className="text-lg font-bold text-emerald-400">
                    ${employee.total_income.toFixed(2)}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 border border-purple-500/20 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-500/20 rounded-lg">
                  <Wallet className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-400 font-medium">
                    Wallet Balance
                  </p>
                  <p className="text-lg font-bold text-purple-400">
                    ${walletBalance.available.toFixed(2)}
                  </p>
                  {walletBalance.frozen > 0 && (
                    <p className="text-xs text-slate-500">
                      Frozen: ${walletBalance.frozen.toFixed(2)}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-slate-500/10 to-slate-600/5 border border-slate-500/20 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-500/20 rounded-lg">
                  <Clock className="w-5 h-5 text-slate-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-400 font-medium">
                    Member Since
                  </p>
                  <p className="text-sm font-bold text-white">
                    {new Date(employee.created_at).toLocaleDateString("zh-CN")}
                  </p>
                  {employee.first_success_order_date && (
                    <p className="text-xs text-slate-500">
                      First order:{" "}
                      {new Date(
                        employee.first_success_order_date,
                      ).toLocaleDateString("zh-CN")}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {employee.remarks && (
            <div className="mt-4 bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-amber-500/20 rounded-lg mt-0.5">
                  <MessageSquare className="w-4 h-4 text-amber-400" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-slate-400 font-medium mb-1">
                    Admin Remarks
                  </p>
                  <p className="text-sm text-white">{employee.remarks}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 px-6 pt-4 border-b border-slate-700/50">
          <button
            onClick={() => setActiveTab("daily")}
            className={`px-4 py-2 font-medium transition-all rounded-t-lg ${
              activeTab === "daily"
                ? "bg-slate-800 text-white border-b-2 border-blue-500"
                : "text-slate-400 hover:text-white hover:bg-slate-800/50"
            }`}
          >
            Daily Statistics
          </button>
          <button
            onClick={() => setActiveTab("transactions")}
            className={`px-4 py-2 font-medium transition-all rounded-t-lg ${
              activeTab === "transactions"
                ? "bg-slate-800 text-white border-b-2 border-blue-500"
                : "text-slate-400 hover:text-white hover:bg-slate-800/50"
            }`}
          >
            Transaction History
          </button>
          <button
            onClick={() => setActiveTab("verification")}
            className={`px-4 py-2 font-medium transition-all rounded-t-lg flex items-center gap-2 ${
              activeTab === "verification"
                ? "bg-slate-800 text-white border-b-2 border-blue-500"
                : "text-slate-400 hover:text-white hover:bg-slate-800/50"
            }`}
          >
            <Shield className="w-4 h-4" />
            Verification Info
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className={activeTab === "daily" ? "space-y-4" : "hidden"}>
            {loadingStats ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3">
                <div className="w-10 h-10 border-4 border-slate-600 border-t-blue-500 rounded-full animate-spin"></div>
                <div className="text-slate-400 text-sm">
                  Loading statistics...
                </div>
              </div>
            ) : dailyStats.length === 0 ? (
              <div className="text-center text-slate-400 py-12">
                No order data available in the last 90 days
              </div>
            ) : (
              <>
                {/* Data Range Notice */}
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 mb-4">
                  <p className="text-sm text-blue-300">
                    📊 Showing statistics for the last 90 days
                  </p>
                </div>

                {/* Overall Statistics Summary */}
                <div className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 rounded-lg p-5 border border-slate-600/50">
                  <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-4">
                    Overall Statistics (Last 90 Days)
                  </h3>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="bg-slate-800/80 rounded-lg p-3 border border-emerald-500/30">
                      <div className="flex items-center gap-2 mb-1">
                        <DollarSign className="w-4 h-4 text-emerald-400" />
                        <span className="text-xs text-emerald-300 font-bold">
                          Total Revenue
                        </span>
                      </div>
                      <div className="text-2xl font-black text-emerald-400">
                        $
                        {dailyStats
                          .reduce((sum, stat) => sum + stat.totalCommission, 0)
                          .toFixed(2)}
                      </div>
                    </div>
                    <div className="bg-slate-800/80 rounded-lg p-3 border border-blue-500/30">
                      <div className="flex items-center gap-2 mb-1">
                        <TrendingUp className="w-4 h-4 text-blue-400" />
                        <span className="text-xs text-blue-300 font-bold">
                          Total Orders
                        </span>
                      </div>
                      <div className="text-2xl font-black text-white">
                        {dailyStats.reduce(
                          (sum, stat) => sum + stat.totalOrders,
                          0,
                        )}
                      </div>
                    </div>
                    <div className="bg-slate-800/80 rounded-lg p-3 border border-green-500/30">
                      <div className="flex items-center gap-2 mb-1">
                        <CheckCircle className="w-4 h-4 text-green-400" />
                        <span className="text-xs text-green-300 font-bold">
                          Success
                        </span>
                      </div>
                      <div className="text-2xl font-black text-green-400">
                        {dailyStats.reduce(
                          (sum, stat) => sum + stat.successCount,
                          0,
                        )}
                      </div>
                    </div>
                    <div className="bg-slate-800/80 rounded-lg p-3 border border-red-500/30">
                      <div className="flex items-center gap-2 mb-1">
                        <XCircle className="w-4 h-4 text-red-400" />
                        <span className="text-xs text-red-300 font-bold">
                          Failed
                        </span>
                      </div>
                      <div className="text-2xl font-black text-red-400">
                        {dailyStats.reduce(
                          (sum, stat) => sum + stat.failureCount,
                          0,
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Daily Breakdown with Pagination */}
                <div className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 rounded-lg border border-slate-600/50 overflow-hidden">
                  <div className="p-4 border-b border-slate-600/50 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">
                      Daily Breakdown ({dailyStats.length}{" "}
                      {dailyStats.length === 1 ? "day" : "days"})
                    </h3>
                    {dailyStats.length > itemsPerPage && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() =>
                            setCurrentPage(Math.max(1, currentPage - 1))
                          }
                          disabled={currentPage === 1}
                          className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded transition-colors"
                        >
                          Prev
                        </button>
                        <span className="text-xs text-slate-400">
                          Page {currentPage} of{" "}
                          {Math.ceil(dailyStats.length / itemsPerPage)}
                        </span>
                        <button
                          onClick={() =>
                            setCurrentPage(
                              Math.min(
                                Math.ceil(dailyStats.length / itemsPerPage),
                                currentPage + 1,
                              ),
                            )
                          }
                          disabled={
                            currentPage ===
                            Math.ceil(dailyStats.length / itemsPerPage)
                          }
                          className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded transition-colors"
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-slate-800/50 border-b border-slate-600/30">
                          <th className="text-left px-4 py-2.5 text-xs font-bold text-slate-300 uppercase tracking-wider">
                            <div className="flex items-center gap-2">
                              <Calendar className="w-3.5 h-3.5 text-blue-400" />
                              Date
                            </div>
                          </th>
                          <th className="text-center px-3 py-2.5 text-xs font-bold text-slate-300 uppercase tracking-wider">
                            <div className="flex items-center justify-center gap-1.5">
                              <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
                              Total
                            </div>
                          </th>
                          <th className="text-center px-3 py-2.5 text-xs font-bold text-slate-300 uppercase tracking-wider">
                            <div className="flex items-center justify-center gap-1.5">
                              <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                              Success
                            </div>
                          </th>
                          <th className="text-center px-3 py-2.5 text-xs font-bold text-slate-300 uppercase tracking-wider">
                            <div className="flex items-center justify-center gap-1.5">
                              <XCircle className="w-3.5 h-3.5 text-red-400" />
                              Failed
                            </div>
                          </th>
                          <th className="text-right px-4 py-2.5 text-xs font-bold text-slate-300 uppercase tracking-wider">
                            <div className="flex items-center justify-end gap-1.5">
                              <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                              Earnings
                            </div>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {dailyStats
                          .slice(
                            (currentPage - 1) * itemsPerPage,
                            currentPage * itemsPerPage,
                          )
                          .map((stat, index) => (
                            <tr
                              key={`${stat.date}-${index}`}
                              className="border-b border-slate-700/20 hover:bg-slate-700/30 transition-colors"
                            >
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-2">
                                  <div className="w-1 h-1 rounded-full bg-blue-400"></div>
                                  <span className="text-sm text-slate-200 font-medium">
                                    {stat.date}
                                  </span>
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                <span className="text-sm font-bold text-white">
                                  {stat.totalOrders}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                <span className="text-sm font-bold text-green-400">
                                  {stat.successCount}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                <span className="text-sm font-bold text-red-400">
                                  {stat.failureCount}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                <span className="text-sm font-bold text-emerald-400">
                                  ${stat.totalCommission.toFixed(2)}
                                </span>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>

          <div
            className={activeTab === "transactions" ? "space-y-4" : "hidden"}
          >
            {loadingTransactions ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3">
                <div className="w-10 h-10 border-4 border-slate-600 border-t-blue-500 rounded-full animate-spin"></div>
                <div className="text-slate-400 text-sm">
                  Loading transactions...
                </div>
              </div>
            ) : transactions.length === 0 ? (
              <div className="text-center text-slate-400 py-12">
                No transaction history available
              </div>
            ) : (
              <>
                {/* Data Range Notice */}
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 mb-4">
                  <p className="text-sm text-blue-300">
                    💳 Showing the most recent 100 transactions
                  </p>
                </div>

                {/* Transaction List */}
                <div className="space-y-3">
                  {transactions
                    .slice(
                      (transactionPage - 1) * itemsPerPage,
                      transactionPage * itemsPerPage,
                    )
                    .map((tx) => (
                      <div
                        key={tx.id}
                        className="bg-slate-700/50 rounded-lg p-4 hover:bg-slate-700 transition-colors"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <DollarSign
                                className={`w-5 h-5 ${getTransactionColor(tx.type)}`}
                              />
                              <span className="font-medium text-white">
                                {getTransactionTypeLabel(tx.type)}
                              </span>
                              <span
                                className={`text-lg font-bold ${getTransactionColor(tx.type)}`}
                              >
                                {parseFloat(tx.amount) >= 0 ? "+" : ""}$
                                {parseFloat(tx.amount).toFixed(2)}
                              </span>
                            </div>
                            <div className="text-sm text-slate-400 space-y-1">
                              <div className="flex gap-4">
                                <span>
                                  Before: $
                                  {parseFloat(tx.balance_before).toFixed(2)}
                                </span>
                                <span>→</span>
                                <span>
                                  After: $
                                  {parseFloat(tx.balance_after).toFixed(2)}
                                </span>
                              </div>
                              {tx.remarks && (
                                <div className="mt-2 p-2 bg-slate-800 rounded">
                                  <span className="text-xs text-slate-500">
                                    Note:{" "}
                                  </span>
                                  <span className="text-white">
                                    {tx.remarks}
                                  </span>
                                </div>
                              )}
                              <div className="text-xs text-slate-500 mt-2">
                                {new Date(tx.created_at).toLocaleString(
                                  "zh-CN",
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </>
            )}
          </div>

          <div
            className={activeTab === "verification" ? "space-y-4" : "hidden"}
          >
            {loadingVerification ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3">
                <div className="w-10 h-10 border-4 border-slate-600 border-t-blue-500 rounded-full animate-spin"></div>
                <div className="text-slate-400 text-sm">
                  Loading verification information...
                </div>
              </div>
            ) : !verificationData ? (
              <div className="text-center py-12">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-slate-800 rounded-full mb-4">
                  <FileText className="w-8 h-8 text-slate-600" />
                </div>
                <p className="text-slate-400 text-lg font-medium mb-2">
                  No Verification Submitted
                </p>
                <p className="text-slate-500 text-sm">
                  This employee has not submitted verification information yet.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Status Badge */}
                <div className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 rounded-lg p-4 border border-slate-600/50">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">
                      Verification Status
                    </h3>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold ${
                        verificationData.status === "approved"
                          ? "bg-green-500/20 text-green-400 border border-green-500/50"
                          : verificationData.status === "rejected"
                          ? "bg-red-500/20 text-red-400 border border-red-500/50"
                          : "bg-yellow-500/20 text-yellow-400 border border-yellow-500/50"
                      }`}
                    >
                      {verificationData.status.toUpperCase()}
                    </span>
                  </div>
                  {verificationData.audit_remark && (
                    <div className="mt-3 p-3 bg-slate-800/80 rounded-lg border border-slate-700">
                      <p className="text-xs text-slate-400 mb-1">Admin Remarks:</p>
                      <p className="text-sm text-white">{verificationData.audit_remark}</p>
                    </div>
                  )}
                  {verificationData.audited_at && (
                    <div className="mt-2 text-xs text-slate-500">
                      Reviewed on {new Date(verificationData.audited_at).toLocaleString("zh-CN")}
                    </div>
                  )}
                </div>

                {/* Personal Information */}
                <div className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 rounded-lg border border-slate-600/50 overflow-hidden">
                  <div className="p-4 border-b border-slate-600/50 bg-slate-800/50">
                    <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                      <User className="w-4 h-4 text-blue-400" />
                      Personal Information
                    </h3>
                  </div>
                  <div className="p-4 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                        <div className="flex items-center gap-2 mb-1">
                          <User className="w-4 h-4 text-blue-400" />
                          <span className="text-xs text-slate-400 font-medium">Real Name</span>
                        </div>
                        <p className="text-white font-semibold">{verificationData.real_name}</p>
                      </div>
                      <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                        <div className="flex items-center gap-2 mb-1">
                          <Phone className="w-4 h-4 text-green-400" />
                          <span className="text-xs text-slate-400 font-medium">Phone Number</span>
                        </div>
                        <p className="text-white font-semibold">{verificationData.phone}</p>
                      </div>
                      <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                        <div className="flex items-center gap-2 mb-1">
                          <Mail className="w-4 h-4 text-purple-400" />
                          <span className="text-xs text-slate-400 font-medium">Email Address</span>
                        </div>
                        <p className="text-white font-semibold break-all">{verificationData.email}</p>
                      </div>
                      <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                        <div className="flex items-center gap-2 mb-1">
                          <CreditCard className="w-4 h-4 text-amber-400" />
                          <span className="text-xs text-slate-400 font-medium">Wallet Address</span>
                        </div>
                        <p className="text-white font-mono text-xs break-all">{verificationData.wallet_address}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Document Images */}
                {(verificationData.id_front_url || verificationData.id_back_url || verificationData.selfie_url) && (
                  <div className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 rounded-lg border border-slate-600/50 overflow-hidden">
                    <div className="p-4 border-b border-slate-600/50 bg-slate-800/50">
                      <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                        <FileText className="w-4 h-4 text-blue-400" />
                        Verification Documents
                      </h3>
                    </div>
                    <div className="p-4">
                      <button
                        onClick={openImagePreview}
                        className="w-full px-4 py-3 bg-gradient-to-r from-cyan-600/20 to-blue-600/20 hover:from-cyan-600/30 hover:to-blue-600/30 border border-cyan-500/50 rounded-lg text-cyan-300 font-medium transition-all flex items-center justify-center gap-2 mb-4"
                      >
                        <Eye className="w-4 h-4" />
                        View Verification Documents
                      </button>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {verificationData.id_front_url && (
                          <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                            <p className="text-xs text-slate-400 font-medium mb-2">ID Front</p>
                            <div className="w-full h-24 bg-slate-700/50 rounded border border-slate-600 flex items-center justify-center">
                              <FileText className="w-8 h-8 text-slate-500" />
                            </div>
                          </div>
                        )}
                        {verificationData.id_back_url && (
                          <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                            <p className="text-xs text-slate-400 font-medium mb-2">ID Back</p>
                            <div className="w-full h-24 bg-slate-700/50 rounded border border-slate-600 flex items-center justify-center">
                              <FileText className="w-8 h-8 text-slate-500" />
                            </div>
                          </div>
                        )}
                        {verificationData.selfie_url && (
                          <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                            <p className="text-xs text-slate-400 font-medium mb-2">Selfie Photo</p>
                            <div className="w-full h-24 bg-slate-700/50 rounded border border-slate-600 flex items-center justify-center">
                              <FileText className="w-8 h-8 text-slate-500" />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Submission Date */}
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Clock className="w-4 h-4" />
                    <span>
                      Submitted on {new Date(verificationData.created_at).toLocaleString("zh-CN")}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-slate-700">
          {activeTab === "transactions" && transactions.length > itemsPerPage ? (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setTransactionPage(Math.max(1, transactionPage - 1))}
                disabled={transactionPage === 1}
                className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-lg transition-colors"
              >
                Prev
              </button>
              <span className="text-sm text-slate-400">
                Page {transactionPage} of {Math.ceil(transactions.length / itemsPerPage)}
              </span>
              <button
                onClick={() =>
                  setTransactionPage(
                    Math.min(Math.ceil(transactions.length / itemsPerPage), transactionPage + 1)
                  )
                }
                disabled={transactionPage === Math.ceil(transactions.length / itemsPerPage)}
                className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-lg transition-colors"
              >
                Next
              </button>
              <span className="text-xs text-slate-500 ml-2">
                ({transactions.length} total)
              </span>
            </div>
          ) : (
            <div></div>
          )}
          <button
            onClick={onClose}
            className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
    </>,
    document.body
  );
}
