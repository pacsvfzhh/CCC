import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Send, Search, Check, ChevronDown, Package, DollarSign, Hash, FileText, Sparkles, AlertTriangle, CheckCircle, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { ProductType } from '../../types';
import { useCurrencyUnit } from '../../lib/useCurrencyUnit';
import { useLanguage } from '../../lib/i18n';

interface OrderSubmissionProps {
  employeeId: string;
  adminId?: string | null;
  onNavigateToDispatch?: () => void;
}

export default function OrderSubmission({ employeeId, adminId: propAdminId, onNavigateToDispatch }: OrderSubmissionProps) {
  const { t } = useLanguage();
  const [adminId, setAdminId] = useState<string | null>(propAdminId || null);
  const currencyUnit = useCurrencyUnit(adminId);
  const [productTypes, setProductTypes] = useState<ProductType[]>([]);
  const [filteredProductTypes, setFilteredProductTypes] = useState<ProductType[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedProductType, setSelectedProductType] = useState<ProductType | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [formData, setFormData] = useState({
    userNumber: '',
    productTypeId: '',
    productValue: '',
    orderNumber: '',
    transactionId: '',
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [resultType, setResultType] = useState<'success' | 'error'>('success');
  const [resultMessage, setResultMessage] = useState('');
  const [showSubmitAnimation, setShowSubmitAnimation] = useState(false);
  const [submissionProgress, setSubmissionProgress] = useState(0);
  const [submissionStage, setSubmissionStage] = useState<'encrypting' | 'validating' | 'broadcasting' | 'confirming'>('encrypting');
  const [showValidationAlert, setShowValidationAlert] = useState(false);
  const [validationMessage, setValidationMessage] = useState('');
  const [submitTimeMin, setSubmitTimeMin] = useState(5);
  const [submitTimeMax, setSubmitTimeMax] = useState(20);
  const adminIdRef = useRef<string | null>(propAdminId || null);
  const [activeAssignment, setActiveAssignment] = useState<{ id: string; assignment_id: string } | null>(null);

  useEffect(() => {
    if (propAdminId) {
      setAdminId(propAdminId);
      adminIdRef.current = propAdminId;
      return;
    }
    supabase
      .from('users')
      .select('created_by')
      .eq('id', employeeId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.created_by) {
          setAdminId(data.created_by);
          adminIdRef.current = data.created_by;
        }
      });
  }, [employeeId, propAdminId]);

  // Fetch active assignment only when employee has an active dispatch session
  useEffect(() => {
    const fetchActiveAssignment = async () => {
      const { data: session } = await supabase
        .from('dispatch_sessions')
        .select('id')
        .eq('user_id', employeeId)
        .eq('status', 'online')
        .limit(1)
        .maybeSingle();

      if (!session) {
        setActiveAssignment(null);
        return;
      }

      const { data } = await supabase
        .from('dispatch_assignments')
        .select('id, assignment_id')
        .eq('user_id', employeeId)
        .eq('status', 'accepted')
        .eq('order_submitted', false)
        .not('assignment_id', 'is', null)
        .order('accepted_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      setActiveAssignment(data ? { id: data.id, assignment_id: data.assignment_id } : null);
    };
    fetchActiveAssignment();
    const interval = setInterval(fetchActiveAssignment, 5000);
    return () => clearInterval(interval);
  }, [employeeId]);

  const fetchSubmitTime = async (): Promise<{ min: number; max: number }> => {
    const currentAdminId = adminIdRef.current;

    const { data: empSetting } = await supabase
      .from('employee_submit_time_settings')
      .select('group_id')
      .eq('user_id', employeeId)
      .not('group_id', 'is', null)
      .maybeSingle();

    if (empSetting?.group_id) {
      const { data: group } = await supabase
        .from('submit_time_groups')
        .select('min_seconds, max_seconds')
        .eq('id', empSetting.group_id)
        .maybeSingle();
      if (group) {
        return { min: group.min_seconds, max: group.max_seconds };
      }
    }

    if (!currentAdminId) return { min: 5, max: 20 };

    const { data } = await supabase
      .from('admin_configs')
      .select('config_type, config_value, admin_id')
      .or(`admin_id.eq.${currentAdminId},admin_id.is.null`)
      .in('config_type', ['order_submit_time_min', 'order_submit_time_max']);

    if (!data) return { min: 5, max: 20 };
    const adminConfigs: Record<string, string> = {};
    const globalConfigs: Record<string, string> = {};
    data.forEach((row: any) => {
      if (row.admin_id === currentAdminId) {
        adminConfigs[row.config_type] = row.config_value;
      } else {
        globalConfigs[row.config_type] = row.config_value;
      }
    });
    const min = Math.max(3, parseInt(adminConfigs.order_submit_time_min || globalConfigs.order_submit_time_min || '5', 10));
    const max = Math.max(min, parseInt(adminConfigs.order_submit_time_max || globalConfigs.order_submit_time_max || '20', 10));
    return { min, max };
  };

  useEffect(() => {
    if (!adminId) return;
    fetchSubmitTime().then(({ min, max }) => {
      setSubmitTimeMin(min);
      setSubmitTimeMax(max);
    });
  }, [adminId, employeeId]);

  useEffect(() => {
    loadProductTypes();

    // Subscribe to real-time updates for product types with debouncing
    let reloadTimeout: NodeJS.Timeout | null = null;

    const channel = supabase
      .channel('product_types_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'product_types'
        },
        (payload) => {
          // Debounce to avoid excessive reloads
          if (reloadTimeout) clearTimeout(reloadTimeout);

          reloadTimeout = setTimeout(() => {
            loadProductTypes();

            // Check if selected product type was affected
            if (selectedProductType) {
              if (payload.eventType === 'DELETE' && payload.old?.id === selectedProductType.id) {
                setSelectedProductType(null);
                setFormData(prev => ({ ...prev, productTypeId: '' }));
              } else if (payload.eventType === 'UPDATE' && payload.new?.id === selectedProductType.id) {
                // Check if it was deactivated
                if (payload.new.is_active === false) {
                  setSelectedProductType(null);
                  setFormData(prev => ({ ...prev, productTypeId: '' }));
                  setMessage({
                    type: 'error',
                    text: `"${payload.old?.name}" has been disabled. Please select another product type.`
                  });
                  setTimeout(() => setMessage(null), 5000);
                }
              }
            }
          }, 500); // 500ms debounce
        }
      )
      .subscribe();

    return () => {
      if (reloadTimeout) clearTimeout(reloadTimeout);
      supabase.removeChannel(channel);
    };
  }, [selectedProductType]);

  // Removed body overflow lock to allow background scrolling

  // iOS-compatible scroll lock when modals are open
  useEffect(() => {
    const isAnyModalOpen = showResultModal || showValidationAlert;
    if (isAnyModalOpen) {
      const scrollY = window.scrollY;
      const body = document.body;
      body.style.position = 'fixed';
      body.style.top = `-${scrollY}px`;
      body.style.left = '0';
      body.style.right = '0';
      body.style.overflow = 'hidden';

      return () => {
        body.style.position = '';
        body.style.top = '';
        body.style.left = '';
        body.style.right = '';
        body.style.overflow = '';
        window.scrollTo(0, scrollY);
      };
    }
  }, [showResultModal, showValidationAlert]);

  useEffect(() => {
    const filtered = productTypes.filter(type =>
      type.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
    setFilteredProductTypes(filtered);
  }, [searchQuery, productTypes]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadProductTypes = async () => {
    try {
      const { data, error } = await supabase
        .from('product_types')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;

      const newProductTypes = data || [];
      setProductTypes(newProductTypes);

      // Preserve search query when updating
      if (searchQuery) {
        const filtered = newProductTypes.filter(type =>
          type.name.toLowerCase().includes(searchQuery.toLowerCase())
        );
        setFilteredProductTypes(filtered);
      } else {
        setFilteredProductTypes(newProductTypes);
      }

      // Validate that selected product type is still active
      if (selectedProductType) {
        const stillExists = newProductTypes.find(t => t.id === selectedProductType.id);
        if (!stillExists) {
          setSelectedProductType(null);
          setFormData(prev => ({ ...prev, productTypeId: '' }));
        }
      }
    } catch (error) {
      console.error('Error loading product types:', error);
    }
  };

  const handleProductTypeSelect = (type: ProductType) => {
    setSelectedProductType(type);
    setFormData({ ...formData, productTypeId: type.id });
    setSearchQuery('');
    setShowDropdown(false);
  };

  const showValidationError = (message: string) => {
    setValidationMessage(message);
    setShowValidationAlert(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    // Validate all required fields
    if (!formData.userNumber.trim()) {
      showValidationError(t.orderSubmission.userNumber);
      return;
    }

    if (!selectedProductType || !formData.productTypeId) {
      showValidationError(t.orderSubmission.selectProduct);
      return;
    }

    if (!formData.productValue || parseFloat(formData.productValue) <= 0) {
      showValidationError(t.orderSubmission.enterValidValue);
      return;
    }

    if (!formData.orderNumber.trim()) {
      showValidationError(t.orderSubmission.enterProductNumber);
      return;
    }

    if (formData.orderNumber.length !== 9) {
      showValidationError(t.orderSubmission.productNumberDigits);
      return;
    }

    if (!formData.transactionId.trim()) {
      showValidationError(t.orderSubmission.enterTransactionId);
      return;
    }

    if (formData.transactionId.length !== 11) {
      showValidationError(t.orderSubmission.transactionIdChars);
      return;
    }

    // Final validation: ensure product type is still active
    if (selectedProductType) {
      const currentProductType = productTypes.find(t => t.id === selectedProductType.id);
      if (!currentProductType) {
        showValidationError(t.orderSubmission.productUnavailable);
        setSelectedProductType(null);
        setFormData(prev => ({ ...prev, productTypeId: '' }));
        return;
      }
    }

    setShowConfirmModal(true);
  };

  const handleConfirmSubmit = async () => {
    setShowConfirmModal(false);
    setLoading(true);
    setShowSubmitAnimation(true);
    setSubmissionProgress(0);
    setSubmissionStage('encrypting');

    // Fetch fresh time settings from DB before each submission
    const { min: freshMin, max: freshMax } = await fetchSubmitTime();
    setSubmitTimeMin(freshMin);
    setSubmitTimeMax(freshMax);

    // Calculate random total duration within configured range (in ms)
    const totalDuration = (freshMin + Math.random() * (freshMax - freshMin)) * 1000;

    // Smooth progress animation that runs for exactly the specified duration
    const animateFullProgress = (targetDuration: number): { cancel: () => void; done: Promise<void> } => {
      let cancelled = false;
      const startTime = performance.now();
      let lastDisplayed = 0;
      let lastUpdateTime = 0;
      const stages: { pct: number; label: typeof submissionStage }[] = [
        { pct: 20, label: 'encrypting' },
        { pct: 50, label: 'validating' },
        { pct: 75, label: 'broadcasting' },
        { pct: 100, label: 'confirming' },
      ];

      const done = new Promise<void>((resolve) => {
        const tick = () => {
          if (cancelled) { resolve(); return; }
          const now = performance.now();
          const elapsed = now - startTime;
          const rawProgress = Math.min(100, (elapsed / targetDuration) * 100);

          // Only update display every 200ms to prevent flickering
          if (now - lastUpdateTime >= 200 || rawProgress >= 100) {
            // Ensure progress only moves forward, with slight randomness in speed
            const targetPct = Math.floor(rawProgress);
            const newDisplay = Math.max(lastDisplayed, targetPct);
            if (newDisplay !== lastDisplayed) {
              lastDisplayed = newDisplay;
              setSubmissionProgress(newDisplay);
            }
            lastUpdateTime = now;
          }

          // Update stage label
          for (const stage of stages) {
            if (rawProgress <= stage.pct) {
              setSubmissionStage(stage.label);
              break;
            }
          }

          if (elapsed >= targetDuration) {
            setSubmissionProgress(100);
            resolve();
          } else {
            requestAnimationFrame(tick);
          }
        };
        requestAnimationFrame(tick);
      });

      return { cancel: () => { cancelled = true; }, done };
    };

    // Start the animation immediately - it will run for exactly totalDuration ms
    const animation = animateFullProgress(totalDuration);

    try {
      // Run DB operations in parallel with the animation
      const productValue = parseFloat(formData.productValue);
      const transactionId = formData.transactionId;

      const { data: validDataList, error: validError } = await supabase
        .from('valid_order_data')
        .select('id')
        .eq('product_value', productValue)
        .eq('transaction_id', transactionId)
        .eq('is_active', true);

      if (validError) throw validError;

      if (!validDataList || validDataList.length === 0) {
        await animation.done;
        setShowSubmitAnimation(false);
        setResultType('error');
        setResultMessage(t.orderSubmission.orderInfoError);
        setShowResultModal(true);
        setLoading(false);
        return;
      }

      const validIds = validDataList.map(v => v.id);
      const { data: usedDataList, error: usedError } = await supabase
        .from('used_order_data')
        .select('valid_order_data_id')
        .eq('user_id', employeeId)
        .in('valid_order_data_id', validIds);

      if (usedError) throw usedError;

      const usedIds = new Set(usedDataList?.map(u => u.valid_order_data_id) || []);
      const availableData = validDataList.find(v => !usedIds.has(v.id));

      if (!availableData) {
        await animation.done;
        setShowSubmitAnimation(false);
        setResultType('error');
        setResultMessage(t.orderSubmission.orderExists);
        setShowResultModal(true);
        setLoading(false);
        return;
      }

      const validData = availableData;

      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .insert({
          user_id: employeeId,
          username: formData.userNumber,
          product_type_id: formData.productTypeId,
          product_value: productValue,
          order_number: formData.orderNumber,
          transaction_id: transactionId,
          status: 'processing',
          ...(activeAssignment ? { assignment_id: activeAssignment.assignment_id } : {}),
        })
        .select()
        .single();

      if (orderError) throw orderError;

      // Mark assignment as order_submitted
      if (activeAssignment) {
        await supabase
          .from('dispatch_assignments')
          .update({ order_submitted: true })
          .eq('id', activeAssignment.id)
          .eq('assignment_id', activeAssignment.assignment_id);
      }

      const { error: usageError } = await supabase
        .from('used_order_data')
        .insert({
          user_id: employeeId,
          valid_order_data_id: validData.id,
          order_id: orderData.id,
        });

      if (usageError) {
        await supabase.from('orders').delete().eq('id', orderData.id);
        throw usageError;
      }

      // Wait for animation to complete (it always takes exactly totalDuration)
      await animation.done;
      setShowSubmitAnimation(false);
      setResultType('success');
      setResultMessage(t.orderSubmission.orderSuccessProcessing);
      setShowResultModal(true);

      setFormData({
        userNumber: '',
        productTypeId: '',
        productValue: '',
        orderNumber: '',
        transactionId: '',
      });
      setSelectedProductType(null);
      setSearchQuery('');

      // Auto-return to dispatch tab after submission if there was an active assignment
      if (activeAssignment) {
        setActiveAssignment(null);
        setTimeout(() => {
          onNavigateToDispatch?.();
        }, 1500);
      }

      setTimeout(async () => {
        try {
          await supabase.rpc('process_pending_orders');
        } catch (error) {
          console.error('Error triggering order processing:', error);
        }
      }, 2000);
    } catch (error: any) {
      console.error('Order submission error:', error);
      animation.cancel();
      setSubmissionProgress(100);
      setShowSubmitAnimation(false);
      setResultType('error');
      setResultMessage(error.message || t.orderSubmission.failedRetry);
      setShowResultModal(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative isolate bg-white rounded-xl sm:rounded-3xl border border-blue-200 p-4 sm:p-8 overflow-hidden shadow-sm">
      {/* Header - Mobile Optimized */}
      <div className="relative flex items-center gap-2 sm:gap-3 mb-4 sm:mb-8">
        <div className="relative flex items-center justify-center w-10 h-10 sm:w-11 sm:h-11 bg-blue-50 rounded-lg sm:rounded-xl border border-blue-200 overflow-hidden group/icon flex-shrink-0">
          <Package className="w-5 h-5 text-blue-600 relative z-10" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base sm:text-2xl font-black text-blue-600 relative truncate">
            {t.orderSubmission.title}
          </h2>
          <p className="text-gray-500 text-xs sm:text-sm mt-0.5 sm:mt-1 flex items-center gap-1.5 sm:gap-2">
            <span className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-blue-500 rounded-full animate-pulse flex-shrink-0"></span>
            <span className="truncate">{t.orderSubmission.fillDetails}</span>
          </p>
        </div>
        {activeAssignment ? (
          <div className="flex-shrink-0 inline-flex items-center gap-1.5 sm:gap-2.5 px-2.5 sm:px-4 py-1.5 sm:py-2 bg-blue-50 border-2 border-blue-300 rounded-lg sm:rounded-xl shadow-sm">
            <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-blue-500 rounded-full animate-pulse"></div>
            <span className="hidden sm:inline text-[10px] sm:text-xs font-bold text-blue-600 uppercase tracking-wider">{t.dispatch.assignmentIdLabel}</span>
            <span className="text-xs sm:text-base font-black text-blue-700 font-mono tracking-widest">{activeAssignment.assignment_id}</span>
          </div>
        ) : (
          <div className="relative hidden sm:block flex-shrink-0">
            <Sparkles className="w-6 h-6 text-blue-600 relative z-10" />
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-5">
          {/* User Number - Mobile Optimized */}
          <div className="group relative">
            <label className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm font-semibold text-gray-600 mb-2 sm:mb-3">
              <div className="relative flex-shrink-0">
                <div className="absolute inset-0 bg-blue-400/30 rounded-full blur-sm group-hover:bg-blue-400/50 transition-all hidden sm:block"></div>
                <Hash className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-600 relative z-10" />
              </div>
              {t.orderSubmission.userNumber}
            </label>
            <div className="relative">
              {/* Scanning line effect on focus - Hidden on mobile */}
              <div className="absolute inset-0 overflow-hidden rounded-lg sm:rounded-xl pointer-events-none opacity-0 group-focus-within:opacity-100 transition-opacity hidden sm:block">
                <div className="absolute w-full h-px bg-gradient-to-r from-transparent via-blue-500/50 to-transparent animate-scanLine"></div>
              </div>

              {/* Corner tech accents - Hidden on mobile */}
              <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-blue-500/0 group-focus-within:border-blue-500/60 rounded-tl-lg transition-all duration-300 hidden sm:block"></div>
              <div className="absolute top-0 right-0 w-3 h-3 border-t border-r border-blue-500/0 group-focus-within:border-blue-500/60 rounded-tr-lg transition-all duration-300 hidden sm:block"></div>
              <div className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-blue-500/0 group-focus-within:border-blue-500/60 rounded-bl-lg transition-all duration-300 hidden sm:block"></div>
              <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-blue-500/0 group-focus-within:border-blue-500/60 rounded-br-lg transition-all duration-300 hidden sm:block"></div>

              <input
                type="text"
                value={formData.userNumber}
                onChange={(e) => setFormData({ ...formData, userNumber: e.target.value.replace(/\s+/g, '') })}
                className="w-full px-3 py-2.5 sm:px-4 sm:py-3.5 bg-gray-50 border-2 border-gray-200 rounded-lg sm:rounded-xl text-gray-900 text-sm sm:text-base placeholder-gray-400 focus:outline-none focus:border-blue-400 focus:ring-blue-400 focus:shadow-[0_0_0_3px_rgba(59,130,246,0.1)] transition-all duration-300 relative z-10"
                placeholder={t.orderSubmission.enterUserNumber}
              />
              {/* Animated glow effect - Reduced on mobile */}
              <div className="absolute inset-0 rounded-lg sm:rounded-xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-500 pointer-events-none -z-10 hidden sm:block">
                <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-blue-500/0 via-blue-400/30 to-blue-500/0 blur-2xl animate-pulse"></div>
              </div>
            </div>
          </div>

          {/* Product Type with Search - Mobile Optimized */}
          <div className="group relative" ref={dropdownRef}>
            <label className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm font-semibold text-gray-600 mb-2 sm:mb-3">
              <div className="relative flex-shrink-0">
                <div className="absolute inset-0 bg-blue-400/30 rounded-full blur-sm group-hover:bg-blue-400/50 transition-all hidden sm:block"></div>
                <Package className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-600 relative z-10" />
              </div>
              {t.orderSubmission.productType}
            </label>
            <div className="relative">
              {/* Corner tech accents - Hidden on mobile */}
              <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-blue-500/0 group-focus-within:border-blue-500/60 rounded-tl-lg transition-all duration-300 z-20 hidden sm:block"></div>
              <div className="absolute top-0 right-0 w-3 h-3 border-t border-r border-blue-500/0 group-focus-within:border-blue-500/60 rounded-tr-lg transition-all duration-300 z-20 hidden sm:block"></div>
              <div className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-blue-500/0 group-focus-within:border-blue-500/60 rounded-bl-lg transition-all duration-300 z-20 hidden sm:block"></div>
              <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-blue-500/0 group-focus-within:border-blue-500/60 rounded-br-lg transition-all duration-300 z-20 hidden sm:block"></div>

              <button
                type="button"
                onClick={() => setShowDropdown(!showDropdown)}
                className={`w-full px-3 py-2.5 sm:px-4 sm:py-3.5 bg-gray-50 border-2 rounded-lg sm:rounded-xl text-left text-sm sm:text-base flex items-center justify-between transition-all duration-300 relative z-10 ${
                  showDropdown
                    ? 'border-blue-400 shadow-[0_0_0_3px_rgba(59,130,246,0.1)]'
                    : 'border-gray-200'
                } ${!selectedProductType ? 'text-gray-400' : 'text-gray-900'}`}
              >
                <span className="truncate">
                  {selectedProductType ? selectedProductType.name : t.orderSubmission.selectProduct}
                </span>
                <ChevronDown className={`w-4 h-4 sm:w-5 sm:h-5 text-gray-500 transition-transform duration-300 flex-shrink-0 ${showDropdown ? 'rotate-180' : ''}`} />
              </button>

              {/* Animated glow effect for dropdown - Hidden on mobile */}
              <div className={`absolute inset-0 rounded-lg sm:rounded-xl transition-opacity duration-500 pointer-events-none -z-10 hidden sm:block ${showDropdown ? 'opacity-100' : 'opacity-0'}`}>
                <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-blue-500/0 via-blue-400/30 to-blue-500/0 blur-2xl animate-pulse"></div>
              </div>

              {showDropdown && (
                <div className="absolute z-50 w-full mt-2 bg-white border-2 border-blue-200 rounded-lg sm:rounded-xl shadow-lg overflow-hidden animate-slideDown">
                  {/* Search input */}
                  <div className="p-2 sm:p-3 border-b-2 border-blue-100 bg-gray-50">
                    <div className="relative">
                      <Search className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-500 z-10 pointer-events-none" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={t.orderSubmission.search}
                        className="w-full pl-8 sm:pl-10 pr-8 sm:pr-9 py-2 sm:py-2.5 bg-white border-2 border-gray-200 rounded-lg text-gray-900 text-xs sm:text-sm placeholder-gray-400 focus:outline-none focus:border-blue-400 focus:shadow-[0_0_0_3px_rgba(59,130,246,0.1)] transition-all font-medium relative"
                        autoFocus
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={() => setSearchQuery('')}
                          className="absolute right-2 sm:right-2.5 top-1/2 -translate-y-1/2 p-1 hover:bg-blue-400/10 rounded-md transition-all group/clear z-10"
                          aria-label="Clear search"
                        >
                          <X className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-gray-400 group-hover/clear:text-blue-600 transition-colors" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Options list - Mobile Optimized */}
                  <div className="max-h-56 sm:max-h-64 overflow-y-auto custom-scrollbar p-1.5 sm:p-2 pb-4 sm:pb-6 pr-1.5 sm:pr-2 bg-white">
                    {filteredProductTypes.length > 0 ? (
                      filteredProductTypes.map((type, index) => (
                        <button
                          key={type.id}
                          type="button"
                          onClick={() => handleProductTypeSelect(type)}
                          className={`relative w-full px-3 py-2.5 sm:px-4 sm:py-3.5 text-left transition-all duration-300 flex items-center gap-2 sm:gap-3 group/item overflow-hidden rounded-lg sm:rounded-xl mb-1.5 sm:mb-2 last:mb-0 active:scale-[0.98] ${
                            selectedProductType?.id === type.id
                              ? 'bg-blue-50 border border-blue-400 sm:border-2 shadow-sm sm:scale-[1.02]'
                              : 'bg-gray-50 border border-gray-200 sm:border-2 shadow-sm hover:border-blue-300 hover:bg-blue-50 sm:hover:scale-[1.02] sm:hover:-translate-y-0.5'
                          }`}
                        >
                          {/* Animated border glow - Hidden on mobile */}
                          <div className={`absolute inset-0 rounded-lg sm:rounded-xl transition-opacity duration-300 pointer-events-none hidden sm:block ${
                            selectedProductType?.id === type.id
                              ? 'opacity-100'
                              : 'opacity-0 group-hover/item:opacity-100'
                          }`}>
                            <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-emerald-400/0 via-emerald-400/50 to-cyan-400/0 blur-md animate-pulse"></div>
                          </div>

                          {/* Left border indicator - Thinner on mobile */}
                          <div className={`absolute left-0 top-0 bottom-0 w-1 sm:w-1.5 rounded-l-lg sm:rounded-l-xl transition-all duration-300 ${
                            selectedProductType?.id === type.id
                              ? 'bg-blue-500'
                              : 'bg-gray-300 group-hover/item:bg-blue-400'
                          }`}></div>

                          {/* Number badge - Smaller on mobile */}
                          <div className={`flex-shrink-0 w-7 h-7 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl flex items-center justify-center font-black text-xs sm:text-base transition-all duration-300 relative ${
                            selectedProductType?.id === type.id
                              ? 'bg-blue-100 text-blue-700 border sm:border-2 border-blue-300'
                              : 'bg-gray-100 text-gray-600 border sm:border-2 border-gray-300 group-hover/item:bg-blue-100 group-hover/item:text-blue-700 group-hover/item:border-blue-300'
                          }`}>
                            <span className="relative z-10">{index + 1}</span>
                            {/* Badge inner glow - Hidden on mobile */}
                            <div className={`absolute inset-0 rounded-lg sm:rounded-xl transition-opacity duration-300 hidden sm:block ${
                              selectedProductType?.id === type.id
                                ? 'opacity-100 bg-gradient-to-br from-emerald-200/30 to-transparent'
                                : 'opacity-0 group-hover/item:opacity-100 group-hover/item:bg-gradient-to-br group-hover/item:from-emerald-300/25 group-hover/item:to-transparent'
                            }`}></div>
                          </div>

                          {/* Product name - Smaller on mobile */}
                          <span className={`flex-1 font-bold tracking-wide transition-all duration-300 text-xs sm:text-base truncate min-w-0 ${
                            selectedProductType?.id === type.id
                              ? 'text-blue-700'
                              : 'text-gray-700 group-hover/item:text-blue-700'
                          }`}>
                            {type.name}
                          </span>

                          {/* Selected badge - Simplified on mobile */}
                          {selectedProductType?.id === type.id && (
                            <div className="flex-shrink-0 flex items-center gap-1 sm:gap-1.5 animate-fadeIn">
                              {/* Mobile: Just icon with reduced glow */}
                              <div className="sm:hidden relative w-6 h-6 rounded-full bg-gradient-to-r from-emerald-500/55 via-emerald-600/45 to-cyan-500/40 border border-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.5)] flex items-center justify-center">
                                <span className="text-[10px] font-black text-white relative z-10">✓</span>
                              </div>
                              {/* Desktop: Full badge */}
                              <div className="hidden sm:block relative px-3.5 py-2 rounded-full bg-gradient-to-r from-emerald-500/55 via-emerald-600/45 to-cyan-500/40 border-2 border-emerald-300 shadow-[0_0_24px_rgba(16,185,129,0.8)] overflow-hidden">
                                <span className="text-xs font-black text-white uppercase tracking-widest relative z-10">✓ Selected</span>
                                {/* Badge pulse effect */}
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer"></div>
                              </div>
                            </div>
                          )}

                          {/* Hover arrow indicator - Hidden on mobile */}
                          {selectedProductType?.id !== type.id && (
                            <div className="hidden sm:flex flex-shrink-0 opacity-0 group-hover/item:opacity-100 transition-all duration-300 group-hover/item:translate-x-0 -translate-x-2">
                              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500/40 via-emerald-600/30 to-cyan-500/25 border-2 border-emerald-400/80 flex items-center justify-center shadow-[0_0_18px_rgba(16,185,129,0.6)]">
                                <span className="text-emerald-200 font-black text-lg">→</span>
                              </div>
                            </div>
                          )}

                          {/* Animated gradient overlay on hover - Hidden on mobile */}
                          <div className="absolute inset-0 opacity-0 group-hover/item:opacity-100 transition-opacity duration-500 pointer-events-none rounded-lg sm:rounded-xl overflow-hidden hidden sm:block">
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-emerald-400/25 to-transparent translate-x-[-100%] group-hover/item:translate-x-[100%] transition-transform duration-700"></div>
                          </div>

                          {/* Corner accents for tech feel - Hidden on mobile */}
                          <div className={`absolute top-0 right-0 w-10 h-10 transition-opacity duration-300 hidden sm:block ${
                            selectedProductType?.id === type.id
                              ? 'opacity-100'
                              : 'opacity-0 group-hover/item:opacity-80'
                          }`}>
                            <div className="absolute top-0 right-0 w-4 h-0.5 bg-gradient-to-l from-emerald-400 to-transparent shadow-[0_0_8px_rgba(16,185,129,0.8)]"></div>
                            <div className="absolute top-0 right-0 w-0.5 h-4 bg-gradient-to-b from-emerald-400 to-transparent shadow-[0_0_8px_rgba(16,185,129,0.8)]"></div>
                          </div>
                          <div className={`absolute bottom-0 left-0 w-10 h-10 transition-opacity duration-300 hidden sm:block ${
                            selectedProductType?.id === type.id
                              ? 'opacity-100'
                              : 'opacity-0 group-hover/item:opacity-80'
                          }`}>
                            <div className="absolute bottom-0 left-0 w-4 h-0.5 bg-gradient-to-r from-emerald-400 to-transparent shadow-[0_0_8px_rgba(16,185,129,0.8)]"></div>
                            <div className="absolute bottom-0 left-0 w-0.5 h-4 bg-gradient-to-t from-emerald-400 to-transparent shadow-[0_0_8px_rgba(16,185,129,0.8)]"></div>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="px-4 py-8 text-center text-gray-400 text-sm">
                        {t.orderSubmission.noProductTypes}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Product Value - Mobile Optimized */}
          <div className="group relative">
            <label className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm font-semibold text-gray-600 mb-2 sm:mb-3">
              <div className="relative flex-shrink-0">
                <div className="absolute inset-0 bg-blue-400/30 rounded-full blur-sm group-hover:bg-blue-400/50 transition-all hidden sm:block"></div>
                <DollarSign className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-600 relative z-10" />
              </div>
              <span className="truncate">{t.orderSubmission.productValue} ({currencyUnit})</span>
            </label>
            <div className="relative">
              {/* Corner tech accents - Hidden on mobile */}
              <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-blue-500/0 group-focus-within:border-blue-500/60 rounded-tl-lg transition-all duration-300 hidden sm:block"></div>
              <div className="absolute top-0 right-0 w-3 h-3 border-t border-r border-blue-500/0 group-focus-within:border-blue-500/60 rounded-tr-lg transition-all duration-300 hidden sm:block"></div>
              <div className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-blue-500/0 group-focus-within:border-blue-500/60 rounded-bl-lg transition-all duration-300 hidden sm:block"></div>
              <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-blue-500/0 group-focus-within:border-blue-500/60 rounded-br-lg transition-all duration-300 hidden sm:block"></div>

              <input
                type="number"
                step="0.01"
                min="0.01"
                value={formData.productValue}
                onChange={(e) => setFormData({ ...formData, productValue: e.target.value.replace(/\s+/g, '') })}
                className="w-full px-3 py-2.5 sm:px-4 sm:py-3.5 bg-gray-50 border-2 border-gray-200 rounded-lg sm:rounded-xl text-gray-900 text-sm sm:text-base placeholder-gray-400 focus:outline-none focus:border-blue-400 focus:ring-blue-400 focus:shadow-[0_0_0_3px_rgba(59,130,246,0.1)] transition-all duration-300 relative z-10 number-input-blue"
                placeholder="0.00"
              />
              {/* Animated glow effect - Hidden on mobile */}
              <div className="absolute inset-0 rounded-lg sm:rounded-xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-500 pointer-events-none -z-10 hidden sm:block">
                <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-blue-500/0 via-blue-400/30 to-blue-500/0 blur-2xl animate-pulse"></div>
              </div>
            </div>
          </div>

          {/* Product Number - Mobile Optimized */}
          <div className="group relative">
            <label className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm font-semibold text-gray-600 mb-2 sm:mb-3">
              <div className="relative flex-shrink-0">
                <div className="absolute inset-0 bg-blue-400/30 rounded-full blur-sm group-hover:bg-blue-400/50 transition-all hidden sm:block"></div>
                <Hash className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-600 relative z-10" />
              </div>
              {t.orderSubmission.productNumber}
            </label>
            <div className="relative">
              {/* Corner tech accents - Hidden on mobile */}
              <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-blue-500/0 group-focus-within:border-blue-500/60 rounded-tl-lg transition-all duration-300 hidden sm:block"></div>
              <div className="absolute top-0 right-0 w-3 h-3 border-t border-r border-blue-500/0 group-focus-within:border-blue-500/60 rounded-tr-lg transition-all duration-300 hidden sm:block"></div>
              <div className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-blue-500/0 group-focus-within:border-blue-500/60 rounded-bl-lg transition-all duration-300 hidden sm:block"></div>
              <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-blue-500/0 group-focus-within:border-blue-500/60 rounded-br-lg transition-all duration-300 hidden sm:block"></div>

              <input
                type="text"
                value={formData.orderNumber}
                onChange={(e) => setFormData({ ...formData, orderNumber: e.target.value.replace(/\s+/g, '') })}
                maxLength={9}
                className="w-full px-3 py-2.5 sm:px-4 sm:py-3.5 bg-gray-50 border-2 border-gray-200 rounded-lg sm:rounded-xl text-gray-900 text-sm sm:text-base placeholder-gray-400 focus:outline-none focus:border-blue-400 focus:ring-blue-400 focus:shadow-[0_0_0_3px_rgba(59,130,246,0.1)] transition-all duration-300 relative z-10"
                placeholder={t.orderSubmission.nineDigits}
              />
              {/* Animated glow effect - Hidden on mobile */}
              <div className="absolute inset-0 rounded-lg sm:rounded-xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-500 pointer-events-none -z-10 hidden sm:block">
                <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-blue-500/0 via-blue-400/30 to-blue-500/0 blur-2xl animate-pulse"></div>
              </div>
            </div>
          </div>

          {/* Transaction ID - Mobile Optimized */}
          <div className="md:col-span-2 group relative">
            <label className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm font-semibold text-gray-600 mb-2 sm:mb-3">
              <div className="relative flex-shrink-0">
                <div className="absolute inset-0 bg-blue-400/30 rounded-full blur-sm group-hover:bg-blue-400/50 transition-all hidden sm:block"></div>
                <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-600 relative z-10" />
              </div>
              {t.orderSubmission.transactionId}
            </label>
            <div className="relative">
              {/* Corner tech accents - Hidden on mobile */}
              <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-blue-500/0 group-focus-within:border-blue-500/60 rounded-tl-lg transition-all duration-300 hidden sm:block"></div>
              <div className="absolute top-0 right-0 w-3 h-3 border-t border-r border-blue-500/0 group-focus-within:border-blue-500/60 rounded-tr-lg transition-all duration-300 hidden sm:block"></div>
              <div className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-blue-500/0 group-focus-within:border-blue-500/60 rounded-bl-lg transition-all duration-300 hidden sm:block"></div>
              <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-blue-500/0 group-focus-within:border-blue-500/60 rounded-br-lg transition-all duration-300 hidden sm:block"></div>

              <input
                type="text"
                value={formData.transactionId}
                onChange={(e) => setFormData({ ...formData, transactionId: e.target.value.replace(/\s+/g, '') })}
                maxLength={11}
                className="w-full px-3 py-2.5 sm:px-4 sm:py-3.5 bg-gray-50 border-2 border-gray-200 rounded-lg sm:rounded-xl text-gray-900 text-sm sm:text-base placeholder-gray-400 focus:outline-none focus:border-blue-400 focus:ring-blue-400 focus:shadow-[0_0_0_3px_rgba(59,130,246,0.1)] transition-all duration-300 relative z-10"
                placeholder={t.orderSubmission.elevenChars}
              />
              {/* Animated glow effect - Hidden on mobile */}
              <div className="absolute inset-0 rounded-lg sm:rounded-xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-500 pointer-events-none -z-10 hidden sm:block">
                <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-blue-500/0 via-blue-400/30 to-blue-500/0 blur-2xl animate-pulse"></div>
              </div>
            </div>
          </div>
        </div>

        {/* Success/Error Message */}
        {message && (
          <div
            className={`relative rounded-xl p-4 border animate-slideDown ${
              message.type === 'success'
                ? 'bg-green-500/10 border-green-500/50 text-green-400'
                : 'bg-red-500/10 border-red-500/50 text-red-400'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 ${message.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                {message.type === 'success' ? (
                  <Check className="w-5 h-5" />
                ) : (
                  <span className="text-xl">⚠</span>
                )}
              </div>
              <p className="text-sm font-medium flex-1">{message.text}</p>
            </div>
          </div>
        )}

        {/* Submit Button - Mobile Optimized */}
        <button
          type="submit"
          disabled={loading}
          className="group relative w-full min-h-[44px] bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-600 hover:from-blue-500 hover:via-blue-400 hover:to-cyan-500 text-white py-3 sm:py-4 px-4 sm:px-6 rounded-lg sm:rounded-xl font-bold text-sm sm:text-base shadow-lg sm:shadow-xl shadow-blue-500/30 hover:shadow-blue-500/50 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 sm:gap-3 overflow-hidden active:scale-[0.98]"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
          <Send className={`w-4 h-4 sm:w-5 sm:h-5 relative z-10 flex-shrink-0 ${loading ? 'animate-pulse' : ''}`} />
          <span className="relative z-10 truncate">{loading ? t.orderSubmission.submitting : t.orderSubmission.submit}</span>
        </button>
      </form>


      {/* Confirmation Modal - Light Theme Premium Design */}
      {showConfirmModal && (
        <div className="absolute inset-0 z-[9999] rounded-xl sm:rounded-3xl overflow-hidden flex items-center justify-center bg-white">
          <div className="relative w-full h-full flex flex-col">
            {/* Header */}
            <div className="relative flex-shrink-0 bg-gradient-to-r from-blue-600 to-blue-500 px-4 sm:px-6 py-3 sm:py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 sm:w-10 sm:h-10 bg-white/15 backdrop-blur-sm rounded-xl flex items-center justify-center border border-white/20 flex-shrink-0">
                    <AlertTriangle className="w-4.5 h-4.5 sm:w-5 sm:h-5 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm sm:text-lg font-bold text-white tracking-tight">{t.orderSubmission.confirmSubmission}</h2>
                    <p className="text-[10px] sm:text-xs text-blue-100/70 font-medium">{t.orderSubmission.verifyDetails}</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowConfirmModal(false)}
                  className="flex-shrink-0 w-9 h-9 bg-white/15 hover:bg-white/25 active:bg-white/30 border border-white/20 rounded-xl flex items-center justify-center transition-all duration-200 active:scale-95"
                >
                  <X className="w-4 h-4 text-white/90" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="relative flex-1 px-4 sm:px-6 py-4 sm:py-5 flex flex-col justify-center overflow-hidden">
              <div className="max-w-3xl mx-auto w-full space-y-3 sm:space-y-4">
                {/* Amount Display */}
                <div className="bg-gradient-to-br from-blue-50 to-sky-50 border border-blue-200 rounded-xl sm:rounded-2xl p-4 sm:p-6 text-center">
                  <div className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-1">{t.orderSubmission.totalAmount}</div>
                  <div className="flex items-center justify-center gap-1">
                    <DollarSign className="w-6 h-6 sm:w-7 sm:h-7 text-blue-600" />
                    <span className="text-3xl sm:text-4xl font-black text-gray-900 tabular-nums">
                      {parseFloat(formData.productValue).toFixed(2)}
                    </span>
                  </div>
                  <div className="text-[10px] sm:text-xs text-gray-400 font-medium mt-1">{currencyUnit}</div>
                </div>

                {/* Details Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                  <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg p-2.5 sm:p-3.5">
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="w-7 h-7 bg-blue-100 rounded-lg flex items-center justify-center">
                        <Hash className="w-3.5 h-3.5 text-blue-600" />
                      </div>
                      <span className="text-[11px] sm:text-xs font-semibold text-gray-500 uppercase">{t.orderSubmission.user}</span>
                    </div>
                    <span className="text-sm sm:text-base font-bold text-gray-800 font-mono truncate ml-2">{formData.userNumber}</span>
                  </div>

                  <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg p-2.5 sm:p-3.5">
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="w-7 h-7 bg-emerald-100 rounded-lg flex items-center justify-center">
                        <Package className="w-3.5 h-3.5 text-emerald-600" />
                      </div>
                      <span className="text-[11px] sm:text-xs font-semibold text-gray-500 uppercase">{t.orderSubmission.product}</span>
                    </div>
                    <span className="text-sm sm:text-base font-bold text-gray-800 truncate ml-2">{selectedProductType?.name || 'N/A'}</span>
                  </div>

                  <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg p-2.5 sm:p-3.5">
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="w-7 h-7 bg-sky-100 rounded-lg flex items-center justify-center">
                        <FileText className="w-3.5 h-3.5 text-sky-600" />
                      </div>
                      <span className="text-[11px] sm:text-xs font-semibold text-gray-500 uppercase">{t.orderSubmission.txId}</span>
                    </div>
                    <span className="text-sm sm:text-base font-bold text-gray-800 font-mono truncate ml-2">{formData.transactionId}</span>
                  </div>

                  <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg p-2.5 sm:p-3.5">
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="w-7 h-7 bg-teal-100 rounded-lg flex items-center justify-center">
                        <Hash className="w-3.5 h-3.5 text-teal-600" />
                      </div>
                      <span className="text-[11px] sm:text-xs font-semibold text-gray-500 uppercase">{t.orderSubmission.orderNum}</span>
                    </div>
                    <span className="text-sm sm:text-base font-bold text-gray-800 font-mono truncate ml-2">{formData.orderNumber}</span>
                  </div>
                </div>

                {/* Warning */}
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 sm:p-3 flex items-center gap-2.5">
                  <div className="w-7 h-7 bg-amber-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                  </div>
                  <p className="text-xs sm:text-sm font-semibold text-amber-700">
                    {t.orderSubmission.irreversible} <span className="text-red-600 font-bold">{t.orderSubmission.irreversibleBold}</span> {t.orderSubmission.onceConfirmed}
                  </p>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="relative flex-shrink-0 border-t border-gray-200 bg-gray-50 px-4 sm:px-6 py-3 sm:py-4">
              <div className="max-w-3xl mx-auto grid grid-cols-2 gap-3">
                <button
                  onClick={() => setShowConfirmModal(false)}
                  className="px-4 py-2.5 sm:py-3 min-h-[44px] bg-white border-2 border-gray-300 hover:border-gray-400 text-gray-700 rounded-xl font-semibold text-sm transition-all duration-200 active:scale-[0.97]"
                >
                  {t.common.cancel}
                </button>
                <button
                  onClick={handleConfirmSubmit}
                  disabled={loading}
                  className="px-4 py-2.5 sm:py-3 min-h-[44px] bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white rounded-xl font-bold text-sm transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.97] shadow-lg shadow-blue-500/25"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      {t.orderSubmission.wait}
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-1.5">
                      <Check className="w-4 h-4" />
                      {t.orderSubmission.confirm}
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* Submission Animation - Blue Theme Premium */}
      {showSubmitAnimation && (
        <div className="absolute inset-0 z-50 rounded-xl sm:rounded-3xl overflow-hidden flex items-center justify-center bg-gradient-to-br from-blue-600 via-blue-500 to-sky-500">
          {/* Animated background elements */}
          <div className="absolute inset-0 overflow-hidden">
            {/* Large color orbs */}
            <div className="submit-anim-orb-1 absolute -top-[15%] -right-[10%] w-[55%] h-[55%] bg-gradient-to-bl from-cyan-400/30 via-sky-400/25 to-blue-500/20 rounded-full blur-3xl"></div>
            <div className="submit-anim-orb-2 absolute -bottom-[10%] -left-[8%] w-[50%] h-[50%] bg-gradient-to-tr from-blue-700/30 via-cyan-500/20 to-sky-400/15 rounded-full blur-3xl"></div>
            <div className="submit-anim-orb-3 absolute top-[25%] left-[30%] w-[40%] h-[40%] bg-gradient-to-r from-sky-400/20 via-white/10 to-cyan-400/15 rounded-full blur-2xl"></div>

            {/* Geometric color blocks */}
            <div className="submit-anim-block-1 absolute top-[6%] left-[6%] w-16 h-16 sm:w-22 sm:h-22 bg-gradient-to-br from-white/20 to-cyan-400/25 rounded-2xl rotate-12 border border-white/15"></div>
            <div className="submit-anim-block-2 absolute bottom-[10%] right-[8%] w-12 h-12 sm:w-18 sm:h-18 bg-gradient-to-tl from-blue-400/25 to-white/15 rounded-xl -rotate-6 border border-white/10"></div>
            <div className="submit-anim-block-3 absolute top-[50%] right-[12%] w-9 h-9 sm:w-14 sm:h-14 bg-gradient-to-br from-cyan-300/30 to-blue-400/20 rounded-lg rotate-45 border border-white/15"></div>
            <div className="submit-anim-block-4 absolute top-[12%] right-[28%] w-7 h-7 sm:w-10 sm:h-10 bg-gradient-to-r from-white/25 to-sky-300/30 rounded-md rotate-12 border border-white/10"></div>
            <div className="submit-anim-block-5 absolute bottom-[28%] left-[10%] w-6 h-6 sm:w-9 sm:h-9 bg-gradient-to-br from-cyan-400/25 to-white/15 rounded-md -rotate-12 border border-white/10"></div>

            {/* Dot grid */}
            <div className="submit-anim-dot-drift absolute inset-0 opacity-[0.06]" style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '30px 30px' }}></div>

            {/* Animated sweep line */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              <div className="submit-anim-scan absolute w-full h-[2px] bg-gradient-to-r from-transparent via-white/50 to-transparent"></div>
            </div>

            {/* Floating particles */}
            {[...Array(8)].map((_, i) => (
              <div
                key={`p-${i}`}
                className={`absolute rounded-full submit-anim-float-${i} ${i % 3 === 0 ? 'w-2 h-2 bg-white/40' : i % 3 === 1 ? 'w-1.5 h-1.5 bg-cyan-200/50' : 'w-1 h-1 bg-white/30'}`}
                style={{
                  left: `${8 + i * 11}%`,
                  top: `${12 + (i % 5) * 18}%`,
                }}
              />
            ))}

            {/* Corner accent lines */}
            <div className="absolute top-0 left-0 w-24 h-24 sm:w-32 sm:h-32 overflow-hidden opacity-50">
              <div className="absolute top-4 left-4 w-14 h-[2px] bg-gradient-to-r from-white to-white/10"></div>
              <div className="absolute top-4 left-4 w-[2px] h-14 bg-gradient-to-b from-white to-white/10"></div>
            </div>
            <div className="absolute bottom-0 right-0 w-24 h-24 sm:w-32 sm:h-32 overflow-hidden opacity-50">
              <div className="absolute bottom-4 right-4 w-14 h-[2px] bg-gradient-to-l from-white to-white/10"></div>
              <div className="absolute bottom-4 right-4 w-[2px] h-14 bg-gradient-to-t from-white to-white/10"></div>
            </div>
          </div>

          {/* Main Content */}
          <div className="relative flex flex-col items-center justify-center w-full px-5 sm:px-10 py-6">
            {/* Icon with spinner */}
            <div className="relative mb-4 sm:mb-5">
              <div className="relative flex items-center justify-center" style={{ width: '76px', height: '76px' }}>
                {/* Outer glow */}
                <div className="absolute -inset-4 bg-gradient-to-r from-white/20 via-cyan-200/15 to-white/20 rounded-full blur-xl submit-anim-pulse"></div>
                {/* Background circle */}
                <div className="absolute inset-0 rounded-full bg-white/95 shadow-xl shadow-blue-700/20"></div>
                {/* Rotating ring */}
                <div className="absolute inset-[-3px] rounded-full border-[2.5px] border-white/30"></div>
                <div className="absolute inset-[-3px] rounded-full border-[2.5px] border-transparent border-t-white border-r-cyan-200 submit-anim-spin-slow"></div>
                {/* Second rotating ring */}
                <div className="absolute inset-[-8px] rounded-full border-[1.5px] border-transparent border-b-white/40 border-l-cyan-200/30 submit-anim-spin-reverse"></div>
                {/* Inner icon */}
                <div className="relative bg-gradient-to-br from-blue-600 to-cyan-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-700/25" style={{ width: '44px', height: '44px' }}>
                  <Package className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                </div>
              </div>
            </div>

            {/* Status Text */}
            <div className="text-center mb-5 sm:mb-6">
              <h3 className="text-lg sm:text-xl font-bold text-white mb-1 drop-shadow-sm">
                {submissionStage === 'encrypting' && t.orderSubmission.encryptingData}
                {submissionStage === 'validating' && t.orderSubmission.validatingOrder}
                {submissionStage === 'broadcasting' && t.orderSubmission.broadcastingNetwork}
                {submissionStage === 'confirming' && t.orderSubmission.confirmingTransaction}
              </h3>
              <p className="text-sm text-blue-100/90 font-medium">
                {t.orderSubmission.securelyProcessing}
              </p>
            </div>

            {/* Progress Section */}
            <div className="w-full max-w-[280px] sm:max-w-xs">
              {/* Percentage */}
              <div className="text-center mb-2.5">
                <span className="text-4xl sm:text-5xl font-black text-white tabular-nums drop-shadow-md">
                  {submissionProgress}
                </span>
                <span className="text-2xl sm:text-3xl font-bold text-white/80 ml-0.5">%</span>
              </div>

              {/* Progress Bar */}
              <div className="relative h-3 bg-white/15 rounded-full overflow-hidden border border-white/25">
                <div
                  className="h-full bg-gradient-to-r from-white via-cyan-100 to-white rounded-full transition-all duration-300 ease-out relative"
                  style={{ width: `${submissionProgress}%` }}
                >
                  <div className="submit-anim-shimmer absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent"></div>
                </div>
              </div>

              {/* Stage indicators */}
              <div className="grid grid-cols-4 mt-3.5">
                {[
                  { label: t.orderSubmission.encrypt, progress: 0 },
                  { label: t.orderSubmission.validate, progress: 20 },
                  { label: t.orderSubmission.broadcast, progress: 50 },
                  { label: t.orderSubmission.confirm, progress: 75 }
                ].map((milestone, index) => (
                  <div key={index} className="flex flex-col items-center gap-1">
                    <div className={`w-2.5 h-2.5 rounded-full border-[1.5px] transition-all duration-300 ${
                      submissionProgress >= milestone.progress
                        ? 'bg-white border-white shadow-[0_0_8px_rgba(255,255,255,0.6)] scale-110'
                        : 'bg-white/15 border-white/35'
                    }`}></div>
                    <span className={`text-[9px] sm:text-[10px] font-semibold transition-colors duration-300 whitespace-nowrap ${
                      submissionProgress >= milestone.progress ? 'text-white' : 'text-white/40'
                    }`}>
                      {milestone.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Warning message */}
            <div className="mt-5 sm:mt-6 px-4 py-2.5 bg-white/10 border border-white/20 rounded-xl backdrop-blur-sm">
              <p className="text-xs sm:text-sm text-white/90 text-center font-medium flex items-center justify-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-yellow-300 flex-shrink-0" />
                {t.orderSubmission.doNotClose}
              </p>
            </div>

            {/* Security badges */}
            <div className="mt-3.5 flex items-center justify-center gap-2.5 text-[10px] sm:text-xs font-medium">
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-white/90">
                <div className="w-1.5 h-1.5 bg-emerald-300 rounded-full animate-pulse"></div>
                {t.orderSubmission.encrypted}
              </span>
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-white/90">
                <div className="w-1.5 h-1.5 bg-cyan-300 rounded-full animate-pulse" style={{ animationDelay: '0.5s' }}></div>
                {t.orderSubmission.secure}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Result Modal - portaled to escape stacking context */}
      {showResultModal && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 bg-gray-900/50"
          style={{ touchAction: 'none', overscrollBehavior: 'contain' }}
          onClick={() => setShowResultModal(false)}
        >
          <div
            className="relative bg-white rounded-2xl sm:rounded-3xl w-full max-w-sm shadow-2xl shadow-gray-900/20 border border-gray-200 overflow-hidden animate-slideDown"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top color band */}
            <div className={`h-1.5 w-full ${resultType === 'success' ? 'bg-gradient-to-r from-emerald-400 via-emerald-500 to-teal-500' : 'bg-gradient-to-r from-red-400 via-red-500 to-rose-500'}`}></div>

            <div className="relative px-6 sm:px-8 pt-8 pb-6 sm:pb-8 text-center">
              {/* Subtle background glow */}
              <div className={`absolute top-0 left-1/2 -translate-x-1/2 w-48 h-48 rounded-full blur-3xl opacity-20 ${resultType === 'success' ? 'bg-emerald-300' : 'bg-red-300'}`}></div>

              {/* Icon */}
              <div className="relative inline-flex mb-5">
                <div className={`relative w-16 h-16 sm:w-20 sm:h-20 rounded-2xl flex items-center justify-center ${
                  resultType === 'success'
                    ? 'bg-emerald-50 border-2 border-emerald-200'
                    : 'bg-red-50 border-2 border-red-200'
                }`}>
                  {resultType === 'success' ? (
                    <CheckCircle className="w-8 h-8 sm:w-10 sm:h-10 text-emerald-500" />
                  ) : (
                    <AlertTriangle className="w-8 h-8 sm:w-10 sm:h-10 text-red-500" />
                  )}
                </div>
              </div>

              {/* Title */}
              <h3 className={`text-xl sm:text-2xl font-bold mb-2 ${resultType === 'success' ? 'text-gray-900' : 'text-gray-900'}`}>
                {resultType === 'success' ? t.orderSubmission.orderSubmitted : t.orderSubmission.submissionFailed}
              </h3>

              {/* Message */}
              <p className="text-sm sm:text-base text-gray-500 leading-relaxed mb-7 max-w-[280px] mx-auto">
                {resultMessage}
              </p>

              {/* Button */}
              <button
                onClick={() => setShowResultModal(false)}
                className={`w-full min-h-[44px] py-3 sm:py-3.5 px-4 rounded-xl font-semibold text-sm sm:text-base transition-all duration-200 active:scale-[0.97] ${
                  resultType === 'success'
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/25'
                    : 'bg-gray-900 hover:bg-gray-800 text-white shadow-lg shadow-gray-900/25'
                }`}
              >
                {t.orderSubmission.done}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Validation Error Alert Modal - portaled to escape stacking context */}
      {showValidationAlert && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 bg-gray-900/50"
          style={{ touchAction: 'none', overscrollBehavior: 'contain' }}
          onClick={() => setShowValidationAlert(false)}
        >
          <div
            className="relative bg-white rounded-2xl sm:rounded-3xl w-full max-w-sm shadow-2xl shadow-gray-900/20 border border-gray-200 overflow-hidden animate-slideDown"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top color band */}
            <div className="h-1.5 w-full bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500"></div>

            <div className="relative px-6 sm:px-8 pt-8 pb-6 sm:pb-8 text-center">
              {/* Subtle background glow */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-48 rounded-full blur-3xl opacity-20 bg-amber-300"></div>

              {/* Icon */}
              <div className="relative inline-flex mb-5">
                <div className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-2xl flex items-center justify-center bg-amber-50 border-2 border-amber-200">
                  <AlertTriangle className="w-8 h-8 sm:w-10 sm:h-10 text-amber-500" />
                </div>
              </div>

              {/* Title */}
              <h3 className="text-xl sm:text-2xl font-bold mb-2 text-gray-900">
                {t.orderSubmission.missingInfo}
              </h3>

              {/* Message */}
              <p className="text-sm sm:text-base text-gray-500 leading-relaxed mb-7 max-w-[280px] mx-auto">
                {validationMessage}
              </p>

              {/* Button */}
              <button
                onClick={() => setShowValidationAlert(false)}
                className="w-full min-h-[44px] py-3 sm:py-3.5 px-4 rounded-xl font-semibold text-sm sm:text-base bg-amber-500 hover:bg-amber-400 text-white shadow-lg shadow-amber-500/25 transition-all duration-200 active:scale-[0.97]"
              >
                OK
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <style>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slideDown { animation: slideDown 0.3s ease-out; }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 3px; margin: 4px 0; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
        .number-input-blue::-webkit-inner-spin-button,
        .number-input-blue::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .number-input-blue {
          -moz-appearance: textfield;
        }
      `}</style>
    </div>
  );
}
