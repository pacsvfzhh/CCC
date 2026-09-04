import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import { Users, Plus, Send, Trash2, CreditCard as Edit2, User, MessageCircle, ArrowLeft, ChevronRight, TrendingUp, X, Search, Tag, Filter, Image, Paperclip, Star, History, Clock, Bold, Underline, Strikethrough, Type, Pencil, Check, Gift, DollarSign, MessageSquarePlus, FileText, BookOpen, Highlighter, Pin, Upload, Zap, CheckCheck, Eye, ZoomIn, ZoomOut, RotateCcw, Megaphone, FileUp, AlignLeft, AlignCenter, AlignRight, Palette } from 'lucide-react';
import { sanitizeAnnouncementContent } from '../../lib/sanitizeHTML';
import CustomerAutoMessages from './CustomerAutoMessages';
import TiptapEditor, { TiptapEditorRef } from './TiptapEditor';
import { supabase } from '../../lib/supabase';
import { stripTailwindStyles, sanitizeChatMessage } from '../../lib/sanitizeHTML';
import { processContentImages } from '../../lib/imageOptimizer';
import { cleanupContentImages } from '../../lib/storageCleanup';

const AdminChatImage = memo(({ src, isUploading, uploadProgress, onClickImage }: {
  src: string;
  isUploading: boolean;
  uploadProgress: number;
  onClickImage: (url: string) => void;
}) => {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  return (
    <div className="relative w-[340px] h-[340px] flex-shrink-0 rounded-lg overflow-hidden">
      {!loaded && !errored && (
        <div className="absolute inset-0 bg-slate-800/60 flex items-center justify-center z-[1]">
          <div className="flex flex-col items-center gap-2">
            <div className="w-10 h-10 border-3 border-slate-600 border-t-blue-400 rounded-full animate-spin" />
            <span className="text-xs text-slate-400">Loading...</span>
          </div>
        </div>
      )}
      {errored && (
        <div className="absolute inset-0 bg-slate-800/60 flex items-center justify-center z-[1]">
          <div className="flex flex-col items-center gap-2 text-slate-400">
            <Image className="w-8 h-8 opacity-50" />
            <span className="text-xs">Failed to load</span>
          </div>
        </div>
      )}
      <img
        ref={imgRef}
        src={src}
        alt="Shared image"
        className={`w-[340px] h-[340px] object-cover cursor-pointer hover:opacity-90 transition-opacity shadow-sm ${
          loaded ? 'opacity-100' : 'opacity-0'
        }`}
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
        onClick={(e: React.MouseEvent) => { if (!isUploading && loaded) { e.stopPropagation(); e.preventDefault(); onClickImage(src); } }}
      />
      {isUploading && (
        <div className="absolute inset-0 bg-black/20 backdrop-blur-[1px] flex flex-col items-center justify-center z-10">
          <div className="relative w-14 h-14">
            <svg className="w-14 h-14 -rotate-90" viewBox="0 0 44 44">
              <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="3" />
              <circle
                cx="22" cy="22" r="18" fill="none" stroke="white"
                strokeWidth="3"
                strokeDasharray={`${uploadProgress * 1.13}, 113`}
                strokeLinecap="round"
                className="drop-shadow-sm"
                style={{ transition: 'stroke-dasharray 0.15s ease-out' }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-white text-xs font-bold drop-shadow-sm">{uploadProgress}%</span>
            </div>
          </div>
          <div className="text-white/80 text-[10px] font-medium mt-1.5 tracking-wide">
            {uploadProgress < 20 ? 'Preparing...' :
             uploadProgress < 85 ? 'Uploading...' :
             uploadProgress < 100 ? 'Processing...' : 'Done!'}
          </div>
        </div>
      )}
    </div>
  );
});

interface AdminGroup {
  admin_id: string;
  admin_username: string;
  admin_role: string;
  employee_count: number;
  customer_count: number;
  conversation_count: number;
}

interface SimulatedCustomer {
  id: string;
  admin_id: string;
  customer_name: string;
  customer_id: string;
  customer_avatar: string;
  is_active: boolean;
  created_at: string;
  is_super?: boolean;
  super_customer_title?: string;
  badge_type?: 'diamond' | 'crown' | 'star' | 'vip' | 'premium';
  custom_avatar_url?: string;
  is_pinned?: boolean;
  vip_label?: string;
  remarks?: string;
  employee_pin_top?: boolean;
  employee_always_visible?: boolean;
  target_employee_id?: string | null;
  target_employee_ids?: string[] | null;
}

interface Employee {
  id: string;
  username: string;
  employee_id: string;
  is_verified: boolean;
  is_active: boolean;
  remarks?: string;
  tags?: string[];
}

interface Message {
  id: string;
  customer_id: string;
  employee_id: string;
  sender_type: 'customer' | 'employee';
  message_content: string;
  message_type?: 'text' | 'image' | 'rating_request' | 'rating_result' | 'tip' | 'rich_card';
  title?: string | null;
  subtitle?: string | null;
  image_url?: string;
  rating_data?: {
    rating?: number;
    comment?: string;
    employee_id?: string;
    status?: string;
    tip_amount?: number;
  };
  is_read: boolean;
  read_at?: string | null;
  created_at: string;
  rich_card_content_id?: string | null;
}

interface ConversationHistory {
  employee_id: string;
  employee_username: string;
  employee_number: string;
  message_count: number;
  last_message: string;
  last_message_time: string;
  unread_count: number;
  customer_id?: string;
  customer_name?: string;
  customer_avatar?: string;
  custom_avatar_url?: string;
}

interface MessageTemplate {
  id: string;
  admin_id: string;
  name: string;
  title: string | null;
  subtitle: string | null;
  content: string;
  content_type: 'text' | 'richtext' | 'rich_card';
  sort_order: number;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
}

interface CccServiceManagementProps {
  adminId: string;
  isSuperAdmin: boolean;
  isActive: boolean;
  initialEmployee?: { id: string; username: string } | null;
  onConsumeInitialEmployee?: () => void;
}

export default function CccServiceManagement({ adminId, isSuperAdmin, isActive, initialEmployee, onConsumeInitialEmployee }: CccServiceManagementProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wasActiveRef = useRef(false);
  const [adminGroups, setAdminGroups] = useState<AdminGroup[]>([]);
  const [selectedAdminId, setSelectedAdminId] = useState<string | null>(null);
  const [selectedAdminName, setSelectedAdminName] = useState<string>('');
  const [customers, setCustomers] = useState<SimulatedCustomer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<SimulatedCustomer | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [conversationHistory, setConversationHistory] = useState<ConversationHistory[]>([]);
  const [allConversationHistory, setAllConversationHistory] = useState<ConversationHistory[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const MESSAGE_PAGE_SIZE = 50;
  const [messageInput, setMessageInput] = useState('');
  const [serviceTicketNumber, setServiceTicketNumber] = useState<string>('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const uploadingTempIdRef = useRef<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [adminImageZoom, setAdminImageZoom] = useState(1);
  const [adminImageDrag, setAdminImageDrag] = useState({ x: 0, y: 0 });
  const [adminIsDragging, setAdminIsDragging] = useState(false);
  const adminDragStartRef = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const [uploadingEditImage, setUploadingEditImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const replaceImageInputRef = useRef<HTMLInputElement>(null);
  const replacingImageMsgIdRef = useRef<string | null>(null);
  const [replacingImageMsgId, setReplacingImageMsgId] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const [editorFontSize, setEditorFontSize] = useState<'normal' | 'large' | 'xlarge' | null>(null);
  const [isBoldActive, setIsBoldActive] = useState(false);
  const [isUnderlineActive, setIsUnderlineActive] = useState(false);
  const [showBgColorPicker, setShowBgColorPicker] = useState<'main' | 'edit' | 'template' | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [isEditBoldActive, setIsEditBoldActive] = useState(false);
  const [isEditUnderlineActive, setIsEditUnderlineActive] = useState(false);
  const [editEditorFontSize, setEditEditorFontSize] = useState<'normal' | 'large' | 'xlarge' | null>(null);
  const editEditorRef = useRef<HTMLDivElement>(null);
  const [pendingRating, setPendingRating] = useState<any>(null);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [ratingValue, setRatingValue] = useState(0);
  const [ratingComment, setRatingComment] = useState('');
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [customerForm, setCustomerForm] = useState({
    name: '',
    avatar: '🧑',
    isSuper: false,
    superTitle: '',
    customId: '',
    badgeType: '' as '' | 'diamond' | 'crown' | 'star' | 'vip' | 'premium',
    vipLabel: 'VIP',
    customAvatarFile: null as File | null,
    useCustomAvatar: false,
    remarks: '',
    employeePinTop: false,
    employeeAlwaysVisible: false,
    targetEmployeeIds: [] as string[],
    _empSearch: ''
  });
  const [editingCustomer, setEditingCustomer] = useState<SimulatedCustomer | null>(null);
  const avatarFileInputRef = useRef<HTMLInputElement>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmDialog, setConfirmDialog] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showHistoryView, setShowHistoryView] = useState(true);
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [fromHistorySource, setFromHistorySource] = useState<'none' | 'customer' | 'all'>('none');
  const [fromHistoryFilterMode, setFromHistoryFilterMode] = useState<'all' | 'history' | 'new'>('all');
  const [historyScope, setHistoryScope] = useState<'customer' | 'all'>('all');
  const allCustomersRef = useRef<SimulatedCustomer[]>([]);
  const allEmployeesRef = useRef<Employee[]>([]);
  const [historyFilterMode, setHistoryFilterMode] = useState<'all' | 'history' | 'new'>('all');
  const [employeeGroupFilter, setEmployeeGroupFilter] = useState<'all' | 'chatted' | 'not_chatted'>('all');
  const [customerFilter, setCustomerFilter] = useState<'all' | 'super' | 'regular'>('all');
  const [customerUnreadCounts, setCustomerUnreadCounts] = useState<Record<string, number>>({});
  const [adminUnreadCounts, setAdminUnreadCounts] = useState<Record<string, number>>({});
  const [showTipModal, setShowTipModal] = useState(false);
  const [tipAmount, setTipAmount] = useState('');
  const [sendingTip, setSendingTip] = useState(false);
  const [messageTemplates, setMessageTemplates] = useState<MessageTemplate[]>([]);
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [showTemplatePopup, setShowTemplatePopup] = useState(false);
  const [showRichCardPopup, setShowRichCardPopup] = useState(false);
  const [templateManagerMode, setTemplateManagerMode] = useState<'richtext' | 'rich_card'>('richtext');
  const [templateForm, setTemplateForm] = useState({ name: '', title: '', subtitle: '', content: '', content_type: 'richtext' as 'text' | 'richtext' | 'rich_card' });
  const templateEditorRef = useRef<HTMLDivElement>(null);
  const templateImageInputRef = useRef<HTMLInputElement>(null);
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null);
  const [uploadingTemplateImage, setUploadingTemplateImage] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [docImportProgress, setDocImportProgress] = useState<{ phase: string; pct: number } | null>(null);
  const [templateBoldActive, setTemplateBoldActive] = useState(false);
  const [templateUnderlineActive, setTemplateUnderlineActive] = useState(false);
  const [templateStrikethroughActive, setTemplateStrikethroughActive] = useState(false);
  const [templateFontSize, setTemplateFontSize] = useState<string | null>(null);
  const [templateAlign, setTemplateAlign] = useState<'left' | 'center' | 'right'>('left');
  const [showTextColorPicker, setShowTextColorPicker] = useState<'template' | null>(null);
  const [templateTextColor, setTemplateTextColor] = useState<string | null>(null);
  const [sendingRichCard, setSendingRichCard] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<string | null>(null);
  const richCardEditorRef = useRef<TiptapEditorRef>(null);
  const [richCardContent, setRichCardContent] = useState('');
  const [viewingRichCard, setViewingRichCard] = useState<Message | null>(null);
  const [richCardFullContent, setRichCardFullContent] = useState<string | null>(null);
  const [loadingRichCardContent, setLoadingRichCardContent] = useState(false);

  const openRichCardViewer = useCallback(async (msg: Message) => {
    setViewingRichCard(msg);
    setRichCardFullContent(null);
    setLoadingRichCardContent(true);

    const fetchFromRichCardContents = async (contentId: string): Promise<string | null> => {
      try {
        const { data, error } = await supabase
          .from('rich_card_contents')
          .select('html_content')
          .eq('id', contentId)
          .maybeSingle();
        return (!error && data) ? data.html_content : null;
      } catch {
        return null;
      }
    };

    const fetchFromTemplate = async (templateId: string): Promise<string | null> => {
      try {
        const { data, error } = await supabase
          .from('cs_message_templates')
          .select('content')
          .eq('id', templateId)
          .maybeSingle();
        return (!error && data) ? data.content : null;
      } catch {
        return null;
      }
    };

    const fetchFromAutoMessage = async (autoMsgId: string): Promise<string | null> => {
      try {
        const { data, error } = await supabase
          .from('customer_auto_messages')
          .select('content')
          .eq('id', autoMsgId)
          .maybeSingle();
        return (!error && data) ? data.content : null;
      } catch {
        return null;
      }
    };

    try {
      let html: string | null = null;
      const anyMsg = msg as any;
      if (anyMsg.source_template_id) {
        html = await fetchFromTemplate(anyMsg.source_template_id);
      } else if (anyMsg.source_auto_message_id) {
        html = await fetchFromAutoMessage(anyMsg.source_auto_message_id);
      } else if (msg.rich_card_content_id) {
        html = await fetchFromRichCardContents(msg.rich_card_content_id);
      } else if (msg.message_type === 'rich_card') {
        for (let i = 0; i < 4; i++) {
          await new Promise(r => setTimeout(r, 500));
          const { data: fresh } = await supabase
            .from('customer_employee_conversations')
            .select('rich_card_content_id, source_template_id, source_auto_message_id')
            .eq('id', msg.id)
            .maybeSingle();
          if (fresh?.source_template_id) {
            html = await fetchFromTemplate(fresh.source_template_id);
            break;
          }
          if (fresh?.source_auto_message_id) {
            html = await fetchFromAutoMessage(fresh.source_auto_message_id);
            break;
          }
          if (fresh?.rich_card_content_id) {
            html = await fetchFromRichCardContents(fresh.rich_card_content_id);
            break;
          }
        }
      }
      setRichCardFullContent(html || msg.message_content);
    } catch {
      setRichCardFullContent(msg.message_content);
    } finally {
      setLoadingRichCardContent(false);
    }
  }, []);

  const cartoonAvatars = [
    { emoji: '🧑', label: 'Person' },
    { emoji: '👨', label: 'Man' },
    { emoji: '👩', label: 'Woman' },
    { emoji: '🧒', label: 'Child' },
    { emoji: '👦', label: 'Boy' },
    { emoji: '👧', label: 'Girl' },
    { emoji: '👴', label: 'Old Man' },
    { emoji: '👵', label: 'Old Woman' },
    { emoji: '👨‍💼', label: 'Businessman' },
    { emoji: '👩‍💼', label: 'Businesswoman' },
    { emoji: '👨‍🔧', label: 'Mechanic' },
    { emoji: '👩‍🔧', label: 'Woman Mechanic' },
    { emoji: '👨‍⚕️', label: 'Doctor' },
    { emoji: '👩‍⚕️', label: 'Woman Doctor' },
    { emoji: '👨‍🎓', label: 'Graduate' },
    { emoji: '👩‍🎓', label: 'Woman Graduate' },
    { emoji: '👨‍🏫', label: 'Teacher' },
    { emoji: '👩‍🏫', label: 'Woman Teacher' },
    { emoji: '👨‍🌾', label: 'Farmer' },
    { emoji: '👩‍🌾', label: 'Woman Farmer' },
    { emoji: '👨‍🍳', label: 'Chef' },
    { emoji: '👩‍🍳', label: 'Woman Chef' },
    { emoji: '👨‍🎨', label: 'Artist' },
    { emoji: '👩‍🎨', label: 'Woman Artist' },
    { emoji: '👨‍💻', label: 'Programmer' },
    { emoji: '👩‍💻', label: 'Woman Programmer' },
    { emoji: '🦸‍♂️', label: 'Superhero' },
    { emoji: '🦸‍♀️', label: 'Superheroine' },
    { emoji: '🧙‍♂️', label: 'Wizard' },
    { emoji: '🧙‍♀️', label: 'Woman Wizard' },
    { emoji: '🧚‍♂️', label: 'Fairy' },
    { emoji: '🧚‍♀️', label: 'Woman Fairy' },
    { emoji: '🧛‍♂️', label: 'Vampire' },
    { emoji: '🧛‍♀️', label: 'Woman Vampire' },
    { emoji: '🧜‍♂️', label: 'Merman' },
    { emoji: '🧜‍♀️', label: 'Mermaid' },
    { emoji: '🧝‍♂️', label: 'Elf' },
    { emoji: '🧝‍♀️', label: 'Woman Elf' },
    { emoji: '👼', label: 'Angel' },
    { emoji: '🤴', label: 'Prince' },
    { emoji: '👸', label: 'Princess' },
    { emoji: '🤵', label: 'Groom' },
    { emoji: '👰', label: 'Bride' },
    { emoji: '🤶', label: 'Mrs Claus' },
    { emoji: '🎅', label: 'Santa' },
    { emoji: '🤠', label: 'Cowboy' },
    { emoji: '🥷', label: 'Ninja' },
    { emoji: '👮', label: 'Police' },
    { emoji: '🕵️', label: 'Detective' },
    { emoji: '💂', label: 'Guard' },
  ];

  // Get all unique tags from employees
  const allTags = Array.from(
    new Set(
      employees.flatMap(emp => emp.tags || [])
    )
  ).sort();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Filter employees based on search, tags, and chat history
  const filteredEmployees = useMemo(() => employees.filter(emp => {
    // Search filter
    const matchesSearch = debouncedSearchQuery === '' ||
      emp.username.toLowerCase().includes(debouncedSearchQuery.toLowerCase()) ||
      emp.employee_id.toLowerCase().includes(debouncedSearchQuery.toLowerCase()) ||
      (emp.remarks && emp.remarks.toLowerCase().includes(debouncedSearchQuery.toLowerCase()));

    // Tag filter
    const matchesTags = selectedTags.length === 0 ||
      (emp.tags && selectedTags.some(tag => emp.tags!.includes(tag)));

    // Chat history filter
    const hasChatted = conversationHistory.some(h => h.employee_id === emp.id);
    const matchesGroupFilter =
      employeeGroupFilter === 'all' ||
      (employeeGroupFilter === 'chatted' && hasChatted) ||
      (employeeGroupFilter === 'not_chatted' && !hasChatted);

    return matchesSearch && matchesTags && matchesGroupFilter;
  }).sort((a, b) => {
    const aSelected = selectedEmployee?.id === a.id ? 0 : 1;
    const bSelected = selectedEmployee?.id === b.id ? 0 : 1;
    return aSelected - bSelected;
  }), [employees, debouncedSearchQuery, selectedTags, employeeGroupFilter, conversationHistory, selectedEmployee]);

  const loadMessagesRef = useRef<() => void>();
  const justSentRef = useRef(false);
  const loadConversationHistoryRef = useRef<() => void>();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isInitialLoadRef = useRef(true);
  const preserveScrollUntilRef = useRef(0);
  const loadOlderMessagesRef = useRef<() => void>();
  const historyListRef = useRef<HTMLDivElement>(null);
  const historyScrollTopRef = useRef(0);

  const messagesContainerCallbackRef = (node: HTMLDivElement | null) => {
    if (node) {
      messagesContainerRef.current = node;
    }
  };

  const loadAdminUnreadCounts = async (adminIds: string[]) => {
    try {
      const { data: customers, error: customersError } = await supabase
        .from('simulated_customers')
        .select('id, admin_id')
        .in('admin_id', adminIds)
        .eq('source_type', 'ccc_service');

      if (customersError) throw customersError;

      if (!customers || customers.length === 0) {
        setAdminUnreadCounts({});
        return;
      }

      const customerIds = customers.map(c => c.id);

      const { data: messages, error: messagesError } = await supabase
        .from('customer_employee_conversations')
        .select('customer_id')
        .in('customer_id', customerIds)
        .eq('sender_type', 'employee')
        .eq('is_read', false);

      if (messagesError) throw messagesError;

      const counts: Record<string, number> = {};
      messages?.forEach(msg => {
        const customer = customers.find(c => c.id === msg.customer_id);
        if (customer) {
          counts[customer.admin_id] = (counts[customer.admin_id] || 0) + 1;
        }
      });


      setAdminUnreadCounts(prev => {
        const hasChanged = adminIds.some(id => (prev[id] || 0) !== (counts[id] || 0));
        return hasChanged ? counts : prev;
      });
    } catch (error) {
      console.error('Error loading admin unread counts:', error);
    }
  };

  const loadAdminGroups = useCallback(async (targetEmployee?: { id: string; username: string } | null) => {
    let autoSelected = false;
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('get_admin_groups_for_customer_service', { p_source_type: 'ccc_service' });
      if (error) throw error;
      setAdminGroups(data || []);

      if (data && data.length > 0) {
        loadAdminUnreadCounts(data.map(g => g.admin_id));

        if (targetEmployee) {
          const { data: userData } = await supabase.from('users').select('created_by').eq('id', targetEmployee.id).maybeSingle();
          if (userData?.created_by) {
            const group = data.find((g: AdminGroup) => g.admin_id === userData.created_by);
            if (group) {
              setSelectedAdminId(group.admin_id);
              setSelectedAdminName(group.admin_username);
              autoSelected = true;
              loadAdminData(group.admin_id);
              return;
            }
          }
        }
      }
    } catch (error) {
      console.error('Error loading admin groups:', error);
      setNotification({ type: 'error', text: 'Failed to load admin groups' });
    } finally {
      if (!autoSelected) {
        setLoading(false);
      }
    }
  }, []);

  const loadConversationHistoryForCustomer = useCallback(async (customer: SimulatedCustomer) => {
    if (employees.length === 0) return;

    try {
      const employeeIds = employees.map(e => e.id);
      const { data, error } = await supabase
        .from('customer_employee_conversations')
        .select('employee_id, sender_type, message_type, is_read')
        .eq('customer_id', customer.id)
        .in('employee_id', employeeIds);

      if (error) throw error;

      const { data: lastMsgs } = await supabase
        .from('customer_employee_conversations')
        .select('employee_id, message_content, message_type, created_at')
        .eq('customer_id', customer.id)
        .in('employee_id', employeeIds)
        .order('created_at', { ascending: false });

      const lastMsgMap = new Map<string, { message_content: string; message_type: string; created_at: string }>();
      for (const msg of lastMsgs || []) {
        if (!lastMsgMap.has(msg.employee_id)) {
          lastMsgMap.set(msg.employee_id, msg);
        }
      }

      const historyMap = new Map<string, ConversationHistory>();

      for (const msg of data || []) {
        const employee = employees.find(e => e.id === msg.employee_id);
        if (!employee) continue;

        if (!historyMap.has(msg.employee_id)) {
          const lastMsg = lastMsgMap.get(msg.employee_id);
          historyMap.set(msg.employee_id, {
            employee_id: msg.employee_id,
            employee_username: employee.username,
            employee_number: employee.employee_id,
            customer_id: customer.id,
            customer_name: customer.customer_name,
            customer_avatar: customer.customer_avatar,
            custom_avatar_url: customer.custom_avatar_url,
            message_count: 0,
            last_message: lastMsg ? (lastMsg.message_type === 'image' ? '__IMAGE__' : lastMsg.message_content) : '',
            last_message_time: lastMsg?.created_at || '',
            unread_count: 0,
          });
        }

        const history = historyMap.get(msg.employee_id)!;
        history.message_count++;

        if (msg.sender_type === 'employee' && !msg.is_read) {
          history.unread_count++;
        }
      }

      setConversationHistory(Array.from(historyMap.values()));
    } catch (error) {
      console.error('Error loading conversation history:', error);
    }
  }, [employees]);

  const loadConversationHistory = useCallback(async () => {
    if (!selectedCustomer) return;
    return loadConversationHistoryForCustomer(selectedCustomer);
  }, [selectedCustomer, loadConversationHistoryForCustomer]);

  const loadAllConversationHistory = useCallback(async (overrideAdminId?: string) => {
    const adminIdToUse = overrideAdminId || selectedAdminId;
    if (!adminIdToUse) return;
    try {
      const { data, error } = await supabase.rpc('get_ccc_conversation_summaries', {
        p_admin_id: adminIdToUse
      });

      if (error) throw error;

      const allHistory: ConversationHistory[] = (data || []).map((row: any) => ({
        employee_id: row.employee_id,
        employee_username: row.employee_username,
        employee_number: row.employee_number,
        customer_id: row.customer_id,
        customer_name: row.customer_name,
        customer_avatar: row.customer_avatar,
        custom_avatar_url: row.custom_avatar_url,
        message_count: Number(row.message_count),
        last_message: row.last_message_type === 'image' ? '__IMAGE__' : (row.last_message || ''),
        last_message_time: row.last_message_time,
        unread_count: Number(row.unread_count),
      }));

      setConversationHistory(allHistory);
      setAllConversationHistory(allHistory);
    } catch (error) {
      console.error('Error loading all conversation history:', error);
    }
  }, [selectedAdminId]);

  const loadOlderMessages = useCallback(async () => {
    if (!selectedCustomer || !selectedEmployee || loadingOlderMessages || !hasMoreMessages) return;
    if (messages.length === 0) return;

    setLoadingOlderMessages(true);
    try {
      const oldestTime = messages[0]?.created_at;
      const { data, error } = await supabase
        .from('customer_employee_conversations')
        .select('*')
        .eq('customer_id', selectedCustomer.id)
        .eq('employee_id', selectedEmployee.id)
        .lt('created_at', oldestTime)
        .order('created_at', { ascending: false })
        .limit(MESSAGE_PAGE_SIZE);

      if (error) throw error;
      if (data && data.length > 0) {
        preserveScrollUntilRef.current = Date.now() + 500;
        setMessages(prev => [...data.reverse(), ...prev]);
        setHasMoreMessages(data.length >= MESSAGE_PAGE_SIZE);
      } else {
        setHasMoreMessages(false);
      }
    } catch (error) {
      console.error('Error loading older messages:', error);
    } finally {
      setLoadingOlderMessages(false);
    }
  }, [selectedCustomer, selectedEmployee, messages, loadingOlderMessages, hasMoreMessages]);

  const loadMessages = useCallback(async (markAsRead: boolean = true) => {
    if (!selectedCustomer || !selectedEmployee) return;

    try {
      const { data, error } = await supabase
        .from('customer_employee_conversations')
        .select('*')
        .eq('customer_id', selectedCustomer.id)
        .eq('employee_id', selectedEmployee.id)
        .order('created_at', { ascending: false })
        .limit(MESSAGE_PAGE_SIZE);

      if (error) throw error;
      const sorted = (data || []).reverse();
      setMessages(sorted);
      setHasMoreMessages((data || []).length >= MESSAGE_PAGE_SIZE);
      setMessagesLoading(false);

      if (markAsRead) {
        await supabase
          .from('customer_employee_conversations')
          .update({ is_read: true })
          .eq('customer_id', selectedCustomer.id)
          .eq('employee_id', selectedEmployee.id)
          .eq('sender_type', 'employee')
          .eq('is_read', false);

        // Update unread count for this customer
        if (selectedCustomer) {
          loadCustomerUnreadCounts([selectedCustomer.id]);
        }
      }

      const { data: sessionData } = await supabase.rpc('get_or_create_service_session', {
        p_customer_id: selectedCustomer.id,
        p_employee_id: selectedEmployee.id
      });

      if (sessionData && sessionData.length > 0) {
        setServiceTicketNumber(sessionData[0].service_ticket_number);
      }
    } catch (error) {
      console.error('Error loading messages:', error);
      setMessagesLoading(false);
    }
  }, [selectedCustomer, selectedEmployee]);

  useEffect(() => {
    loadMessagesRef.current = loadMessages;
    loadConversationHistoryRef.current = loadConversationHistory;
  }, [loadMessages, loadConversationHistory]);

  // Reset to first panel when tab becomes active (unless navigating with initial employee)
  useEffect(() => {
    if (isActive && !wasActiveRef.current && !initialEmployee) {
      setSelectedCustomer(null);
      setSelectedEmployee(null);
      setMessages([]);
      setConversationHistory([]);
      setShowHistoryView(true);
      setHistoryScope('all');
      setHistoryFilterMode('all');
      if (selectedAdminId) {
        loadAllConversationHistory();
      }
    }

    wasActiveRef.current = isActive;
  }, [isActive, initialEmployee]);

  useEffect(() => {
    if (isSuperAdmin) {
      loadAdminGroups(initialEmployee);
    } else {
      setSelectedAdminId(adminId);
      loadAdminData(adminId);
    }
  }, [adminId, isSuperAdmin, loadAdminGroups]);

  // Handle initial employee navigation from other tabs
  useEffect(() => {
    if (!initialEmployee || loading) return;
    if (employees.length > 0) {
      const found = employees.find(e => e.id === initialEmployee.id);
      if (found) {
        setSelectedEmployee(found);
        onConsumeInitialEmployee?.();
      }
    }
  }, [initialEmployee, loading, employees]);

  // Auto-load all conversation history when admin is selected and no customer is focused
  useEffect(() => {
    if (selectedAdminId && !selectedCustomer && !selectedEmployee && showHistoryView && historyScope === 'all') {
      loadAllConversationHistory(selectedAdminId);
    }
  }, [selectedAdminId]);

  // Subscribe to realtime updates for admins table
  useEffect(() => {
    if (isSuperAdmin) {
      const channel = supabase
        .channel('customer_service_admins_realtime')
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'admins'
        }, () => {
          loadAdminGroups();
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [isSuperAdmin, loadAdminGroups]);

  // Subscribe to realtime updates for admin unread counts
  useEffect(() => {
    if (isSuperAdmin && adminGroups.length > 0) {
      const adminIds = adminGroups.map(g => g.admin_id);
      const channel = supabase
        .channel('admin_unread_counts_realtime')
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'customer_employee_conversations'
        }, () => {
          loadAdminUnreadCounts(adminIds);
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [isSuperAdmin, adminGroups.length]);



  useEffect(() => {
    if (selectedAdminId && selectedCustomer?.id) {
      const channel = supabase
        .channel(`customer_conversations_${selectedCustomer.id}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'customer_employee_conversations',
          filter: `customer_id=eq.${selectedCustomer.id}`
        }, (payload: any) => {
          if (selectedEmployee?.id && !(justSentRef.current && payload?.new?.sender_type === 'customer')) {
            loadMessagesRef.current?.();
          }
          loadConversationHistoryRef.current?.();
        })
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'customer_employee_conversations',
          filter: `customer_id=eq.${selectedCustomer.id}`
        }, () => {
          if (selectedEmployee?.id) {
            loadMessagesRef.current?.();
          }
          loadConversationHistoryRef.current?.();
        })
        .on('postgres_changes', {
          event: 'DELETE',
          schema: 'public',
          table: 'customer_employee_conversations',
          filter: `customer_id=eq.${selectedCustomer.id}`
        }, () => {
          if (selectedEmployee?.id) {
            loadMessagesRef.current?.();
          }
          loadConversationHistoryRef.current?.();
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [selectedAdminId, selectedCustomer?.id, selectedEmployee?.id]);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    };
  }, []);

  useEffect(() => {
    if (selectedAdminId && customers.length > 0) {
      const customerIds = customers.map(c => c.id);
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      const channel = supabase
        .channel(`customer_unread_counts_${selectedAdminId}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'customer_employee_conversations'
        }, () => {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            loadCustomerUnreadCounts(customerIds);
            loadAllConversationHistory();
          }, 400);
        })
        .subscribe();

      return () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        supabase.removeChannel(channel);
      };
    }
  }, [selectedAdminId, customers]);

  // Subscribe to realtime updates for employees (users table)
  useEffect(() => {
    if (selectedAdminId) {
      const channel = supabase
        .channel(`employees_realtime_${selectedAdminId}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'users'
        }, () => {
          // Reload employees when users table changes
          supabase.rpc('get_admin_employees', { p_admin_id: selectedAdminId })
            .then(({ data, error }) => {
              if (!error && data) {
                setEmployees(data);
              }
            });
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [selectedAdminId]);

  useEffect(() => {
    if (selectedCustomer?.id && selectedEmployee?.id) {
      const channel = supabase
        .channel(`rating_requests_${selectedCustomer.id}_${selectedEmployee.id}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'rating_requests',
          filter: `customer_id=eq.${selectedCustomer.id}`
        }, () => {
          checkPendingRating();
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [selectedCustomer?.id, selectedEmployee?.id]);

  useEffect(() => {
    if (selectedCustomer?.id && employees.length > 0) {
      loadConversationHistory();
    }
  }, [selectedCustomer?.id, employees.length, loadConversationHistory]);

  // Remove redundant reload - loadAllConversationHistory is already called via realtime subscription
  // useEffect for customers/employees count change is not needed

  useEffect(() => {
    if (selectedEmployee?.id && selectedCustomer?.id) {
      isInitialLoadRef.current = true;
      setMessagesLoading(true);
      loadMessages();
      checkPendingRating();
    }
  }, [selectedEmployee?.id, selectedCustomer?.id, loadMessages]);

  const scrollToBottom = useCallback((smooth: boolean = true) => {
    const container = messagesContainerRef.current;
    if (container) {
      if (smooth) {
        container.scrollTo({
          top: 0,
          behavior: 'smooth'
        });
      } else {
        container.scrollTop = 0;
      }
    }
  }, []);

  const prevMessageCountRef = useRef(0);

  useEffect(() => {
    if (messages.length > 0) {
      if (Date.now() < preserveScrollUntilRef.current) {
        prevMessageCountRef.current = messages.length;
        return;
      }
      const hadNewMessage = messages.length > prevMessageCountRef.current;
      prevMessageCountRef.current = messages.length;
      if (isInitialLoadRef.current || hadNewMessage) {
        scrollToBottom(false);
      }
      if (isInitialLoadRef.current) {
        isInitialLoadRef.current = false;
      }
    }
  }, [messages, scrollToBottom]);

  useEffect(() => {
    loadOlderMessagesRef.current = loadOlderMessages;
  }, [loadOlderMessages]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const maxScroll = container.scrollHeight - container.clientHeight;
      if (maxScroll > 0 && maxScroll - container.scrollTop < 100 && hasMoreMessages && !loadingOlderMessages) {
        loadOlderMessagesRef.current?.();
      }
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [hasMoreMessages, loadingOlderMessages]);

  const pendingScrollRestoreRef = useRef(false);

  useEffect(() => {
    if (showHistoryView && pendingScrollRestoreRef.current && historyScrollTopRef.current > 0) {
      requestAnimationFrame(() => {
        if (historyListRef.current) {
          historyListRef.current.scrollTop = historyScrollTopRef.current;
        }
        pendingScrollRestoreRef.current = false;
      });
    }
  }, [showHistoryView, conversationHistory]);

  const checkPendingRating = async () => {
    if (!selectedCustomer || !selectedEmployee) return;

    try {
      const { data, error } = await supabase
        .from('customer_employee_conversations')
        .select('*')
        .eq('customer_id', selectedCustomer.id)
        .eq('employee_id', selectedEmployee.id)
        .eq('message_type', 'rating_request')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        const hasRating = messages.some(
          m => m.message_type === 'rating_result' &&
          new Date(m.created_at) > new Date(data.created_at)
        );

        if (!hasRating) {
          setPendingRating(data);
        } else {
          setPendingRating(null);
        }
      } else {
        setPendingRating(null);
      }
    } catch (error) {
      console.error('Error checking pending rating:', error);
    }
  };

  const handleSubmitRating = async () => {
    if (!selectedCustomer || !selectedEmployee || ratingValue === 0) return;

    try {
      const { error } = await supabase
        .from('customer_employee_conversations')
        .insert({
          customer_id: selectedCustomer.id,
          employee_id: selectedEmployee.id,
          sender_type: 'customer',
          message_type: 'rating_result',
          message_content: 'Rating submitted',
          rating_data: {
            rating: ratingValue,
            comment: ratingComment.trim() || null,
            employee_id: selectedEmployee.id,
          },
          is_read: false,
          source_type: 'ccc_service',
        });

      if (error) throw error;

      setNotification({ type: 'success', text: 'Rating submitted successfully!' });
      setShowRatingModal(false);
      setRatingValue(0);
      setRatingComment('');
      setPendingRating(null);
      loadMessages();
    } catch (error: any) {
      setNotification({ type: 'error', text: error.message || 'Failed to submit rating' });
    }
  };

  const handleSendTip = async () => {
    if (!selectedCustomer || !selectedEmployee || !tipAmount) return;
    const amount = parseFloat(tipAmount);
    if (isNaN(amount) || amount <= 0) {
      setNotification({ type: 'error', text: 'Please enter a valid tip amount' });
      return;
    }

    setSendingTip(true);
    try {
      const { data: msgData, error: msgError } = await supabase
        .from('customer_employee_conversations')
        .insert({
          customer_id: selectedCustomer.id,
          employee_id: selectedEmployee.id,
          sender_type: 'customer',
          message_type: 'tip',
          message_content: `Tip: ${amount.toFixed(2)}`,
          rating_data: { tip_amount: amount },
          is_read: false,
          source_type: 'ccc_service',
        })
        .select('id')
        .single();

      if (msgError) throw msgError;

      const { data: tipResult, error: tipError } = await supabase
        .rpc('process_customer_service_tip', {
          p_employee_id: selectedEmployee.id,
          p_amount: amount,
          p_message_id: msgData.id,
        });

      if (tipError) throw tipError;
      if (!tipResult?.success) throw new Error(tipResult?.error || 'Failed to process tip');

      setNotification({ type: 'success', text: `Tip of $${amount.toFixed(2)} sent to ${selectedEmployee.username}!` });
      setShowTipModal(false);
      setTipAmount('');
      loadMessages();
    } catch (error: any) {
      setNotification({ type: 'error', text: error.message || 'Failed to send tip' });
    } finally {
      setSendingTip(false);
    }
  };

  const loadTemplates = useCallback(async () => {
    if (!selectedAdminId) return;
    try {
      const { data, error } = await supabase
        .from('cs_message_templates')
        .select('id, admin_id, name, title, subtitle, content_type, sort_order, is_pinned, created_at, updated_at, source_type')
        .eq('admin_id', selectedAdminId)
        .eq('source_type', 'ccc_service')
        .order('is_pinned', { ascending: false })
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false });
      if (error) throw error;
      setMessageTemplates((data || []).map(t => ({ ...t, content: '' })) as MessageTemplate[]);
    } catch (error) {
      console.error('Error loading templates:', error);
    }
  }, [selectedAdminId]);

  const fetchTemplateContent = useCallback(async (templateId: string): Promise<string | null> => {
    try {
      const { data, error } = await supabase
        .from('cs_message_templates')
        .select('content')
        .eq('id', templateId)
        .maybeSingle();
      if (error || !data) return null;
      return data.content;
    } catch {
      return null;
    }
  }, []);

  const getTemplateContent = (): string => {
    if (templateForm.content_type === 'rich_card') {
      return richCardEditorRef.current?.getContent() || richCardContent || templateForm.content;
    }
    if (templateForm.content_type === 'richtext' && templateEditorRef.current) {
      return stripTailwindStyles(templateEditorRef.current.innerHTML);
    }
    return templateForm.content;
  };

  const isTemplateContentEmpty = (): boolean => {
    if (templateForm.content_type === 'rich_card') {
      const content = richCardEditorRef.current?.getContent() || richCardContent || templateForm.content;
      const stripped = content.replace(/<[^>]*>/g, '').trim();
      const hasMedia = /<(img|video|iframe|source)\s/i.test(content);
      return !stripped && !hasMedia;
    }
    if (templateForm.content_type === 'richtext' && templateEditorRef.current) {
      const hasText = (templateEditorRef.current.textContent || '').trim().length > 0;
      const hasMedia = templateEditorRef.current.querySelectorAll('img, video, iframe, source').length > 0;
      return !hasText && !hasMedia;
    }
    return !templateForm.content.trim();
  };

  const handleCreateTemplate = async () => {
    if (!selectedAdminId || !templateForm.name.trim()) return;
    const content = getTemplateContent();
    if (isTemplateContentEmpty()) return;
    setSavingTemplate(true);
    try {
      const folder = templateForm.content_type === 'rich_card' ? 'rich-cards' : 'templates';
      const optimizedContent = (templateForm.content_type === 'richtext' || templateForm.content_type === 'rich_card')
        ? await processContentImages(content, folder)
        : content.trim();
      const { error } = await supabase
        .from('cs_message_templates')
        .insert({
          admin_id: selectedAdminId,
          name: templateForm.name.trim(),
          title: templateForm.content_type === 'rich_card' && templateForm.title.trim() ? templateForm.title.trim() : null,
          subtitle: templateForm.content_type === 'rich_card' && templateForm.subtitle.trim() ? templateForm.subtitle.trim() : null,
          content: optimizedContent,
          content_type: templateForm.content_type,
          sort_order: messageTemplates.length,
          source_type: 'ccc_service',
        });
      if (error) throw error;
      setTemplateForm({ name: '', title: '', subtitle: '', content: '', content_type: 'richtext' });
      if (templateEditorRef.current) templateEditorRef.current.innerHTML = '';
      setRichCardContent(''); { const rce = richCardEditorRef.current?.getEditor(); if (rce) rce.commands.setContent(''); }
      setNotification({ type: 'success', text: 'Template created!' });
      loadTemplates();
    } catch (error: any) {
      setNotification({ type: 'error', text: error.message || 'Failed to create template' });
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleUpdateTemplate = async () => {
    if (!editingTemplate || !templateForm.name.trim()) return;
    const content = getTemplateContent();
    if (isTemplateContentEmpty()) return;
    setSavingTemplate(true);
    try {
      const folder = templateForm.content_type === 'rich_card' ? 'rich-cards' : 'templates';
      const optimizedContent = (templateForm.content_type === 'richtext' || templateForm.content_type === 'rich_card')
        ? await processContentImages(content, folder)
        : content.trim();
      const { error } = await supabase
        .from('cs_message_templates')
        .update({
          name: templateForm.name.trim(),
          title: templateForm.content_type === 'rich_card' && templateForm.title.trim() ? templateForm.title.trim() : null,
          subtitle: templateForm.content_type === 'rich_card' && templateForm.subtitle.trim() ? templateForm.subtitle.trim() : null,
          content: optimizedContent,
          content_type: templateForm.content_type,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingTemplate.id);
      if (error) throw error;
      setEditingTemplate(null);
      setTemplateForm({ name: '', title: '', subtitle: '', content: '', content_type: 'richtext' });
      if (templateEditorRef.current) templateEditorRef.current.innerHTML = '';
      setRichCardContent(''); { const rce = richCardEditorRef.current?.getEditor(); if (rce) rce.commands.setContent(''); }
      setNotification({ type: 'success', text: 'Template updated!' });
      loadTemplates();
    } catch (error: any) {
      setNotification({ type: 'error', text: error.message || 'Failed to update template' });
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    try {
      const tpl = messageTemplates.find(t => t.id === id);
      if (tpl?.content) {
        await cleanupContentImages(tpl.content).catch(() => {});
      }
      await supabase.from('rich_card_contents').delete().eq('source_template_id', id).then(() => {});
      const { error } = await supabase
        .from('cs_message_templates')
        .delete()
        .eq('id', id);
      if (error) throw error;
      setNotification({ type: 'success', text: 'Template deleted!' });
      loadTemplates();
    } catch (error: any) {
      setNotification({ type: 'error', text: error.message || 'Failed to delete template' });
    }
  };

  const handleToggleTemplatePin = async (tpl: MessageTemplate) => {
    try {
      const { error } = await supabase
        .from('cs_message_templates')
        .update({ is_pinned: !tpl.is_pinned, updated_at: new Date().toISOString() })
        .eq('id', tpl.id);
      if (error) throw error;
      loadTemplates();
    } catch (error: any) {
      setNotification({ type: 'error', text: error.message || 'Failed to update pin' });
    }
  };

  const handleTemplateImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !templateEditorRef.current) return;
    setUploadingTemplateImage(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `template_${Date.now()}.${fileExt}`;
      const filePath = `chat-images/${fileName}`;
      const { error: uploadError } = await supabase.storage.from('chat-images').upload(filePath, file);
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from('chat-images').getPublicUrl(filePath);
      const img = document.createElement('img');
      img.src = urlData.publicUrl;
      img.style.maxWidth = '100%';
      img.style.borderRadius = '8px';
      img.style.margin = '4px 0';
      templateEditorRef.current.focus();
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(img);
        range.setStartAfter(img);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        templateEditorRef.current.appendChild(img);
      }
      setTemplateForm(prev => ({ ...prev, content: templateEditorRef.current?.innerHTML || '' }));
    } catch (error: any) {
      setNotification({ type: 'error', text: error.message || 'Failed to upload image' });
    } finally {
      setUploadingTemplateImage(false);
      if (templateImageInputRef.current) templateImageInputRef.current.value = '';
    }
  };

  const handleTemplateFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      if (file.name.endsWith('.txt')) {
        const text = await file.text();
        if (templateEditorRef.current) {
          templateEditorRef.current.innerHTML = text.replace(/\n/g, '<br>');
          setTemplateForm(prev => ({ ...prev, content: templateEditorRef.current?.innerHTML || '', content_type: 'richtext' }));
        }
      } else if (file.name.endsWith('.docx') || file.name.endsWith('.doc')) {
        setDocImportProgress({ phase: 'Reading file...', pct: 10 });
        const arrayBuffer = await file.arrayBuffer();
        setDocImportProgress({ phase: 'Loading converter...', pct: 30 });
        const mammoth = await import('mammoth');
        setDocImportProgress({ phase: 'Converting document...', pct: 60 });
        const result = await mammoth.convertToHtml({ arrayBuffer });
        setDocImportProgress({ phase: 'Applying content...', pct: 90 });
        if (templateEditorRef.current) {
          templateEditorRef.current.innerHTML = result.value;
          setTemplateForm(prev => ({ ...prev, content: result.value, content_type: 'richtext' }));
        }
        setDocImportProgress({ phase: 'Done!', pct: 100 });
        setTimeout(() => setDocImportProgress(null), 800);
      } else {
        setNotification({ type: 'error', text: 'Unsupported file type. Use .txt or .docx files.' });
      }
    } catch (error: any) {
      setDocImportProgress(null);
      setNotification({ type: 'error', text: error.message || 'Failed to import file' });
    }
    e.target.value = '';
  };

  useEffect(() => {
    if (selectedAdminId) {
      loadTemplates();
    }
  }, [selectedAdminId, loadTemplates]);

  const loadAdminData = async (targetAdminId: string, silent = false) => {
    try {
      if (!silent) setLoading(true);

      const [customersRes, employeesRes, unreadRes] = await Promise.all([
        supabase
          .from('simulated_customers')
          .select('*')
          .eq('admin_id', targetAdminId)
          .eq('source_type', 'ccc_service')
          .order('created_at', { ascending: false }),
        supabase.rpc('get_admin_employees', { p_admin_id: targetAdminId }),
        supabase
          .from('customer_employee_conversations')
          .select('customer_id, simulated_customers!inner(admin_id)')
          .eq('simulated_customers.admin_id', targetAdminId)
          .eq('sender_type', 'employee')
          .eq('is_read', false)
      ]);

      if (customersRes.error) throw customersRes.error;
      if (employeesRes.error) throw employeesRes.error;

      setCustomers(customersRes.data || []);
      setEmployees(employeesRes.data || []);
      allCustomersRef.current = customersRes.data || [];
      allEmployeesRef.current = employeesRes.data || [];

      if (!unreadRes.error && unreadRes.data) {
        const counts: Record<string, number> = {};
        unreadRes.data.forEach((msg: { customer_id: string }) => {
          counts[msg.customer_id] = (counts[msg.customer_id] || 0) + 1;
        });
        setCustomerUnreadCounts(counts);
      }
    } catch (error) {
      console.error('Error loading admin data:', error);
      setNotification({ type: 'error', text: 'Failed to load data' });
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadCustomerUnreadCounts = async (customerIds: string[]) => {
    try {
      const { data, error } = await supabase
        .from('customer_employee_conversations')
        .select('customer_id')
        .in('customer_id', customerIds)
        .eq('sender_type', 'employee')
        .eq('is_read', false);

      if (error) throw error;

      // Count unread messages per customer
      const counts: Record<string, number> = {};
      data?.forEach(msg => {
        counts[msg.customer_id] = (counts[msg.customer_id] || 0) + 1;
      });


      // Only update state if counts have actually changed to prevent unnecessary re-renders
      setCustomerUnreadCounts(prev => {
        const hasChanged = customerIds.some(id => (prev[id] || 0) !== (counts[id] || 0));
        return hasChanged ? counts : prev;
      });
    } catch (error) {
      console.error('Error loading unread counts:', error);
    }
  };

  const handleAdminGroupSelect = (group: AdminGroup) => {
    setSelectedAdminId(group.admin_id);
    setSelectedAdminName(group.admin_username);
    setSelectedCustomer(null);
    setSelectedEmployee(null);
    setMessages([]);
    setConversationHistory([]);
    setShowHistoryView(true);
    setHistoryScope('all');
    setHistoryFilterMode('all');
    historyScrollTopRef.current = 0;
    loadAdminData(group.admin_id);
    loadAllConversationHistory(group.admin_id);
  };

  const handleBackToGroups = () => {
    setSelectedAdminId(null);
    setSelectedAdminName('');
    setSelectedCustomer(null);
    setSelectedEmployee(null);
    setMessages([]);
    setConversationHistory([]);
    historyScrollTopRef.current = 0;
    setCustomers([]);
    setEmployees([]);
    // Don't reload admin groups - keep existing data to prevent UI flashing
  };

  const handleSelectCustomer = async (customer: SimulatedCustomer) => {
    historyScrollTopRef.current = 0;
    if (selectedCustomer?.id === customer.id) {
      setSelectedCustomer(null);
      setMessages([]);
      setConversationHistory([]);
      setShowHistoryView(false);
      return;
    }
    setSelectedCustomer(customer);
    setMessages([]);
    if (selectedEmployee) setMessagesLoading(true);
    setConversationHistory([]);
    setShowHistoryView(!selectedEmployee);
    setHistoryFilterMode('all');
    setHistoryScope('customer');
    loadConversationHistoryForCustomer(customer);
  };

  const handleSelectEmployee = (employee: Employee) => {
    if (selectedEmployee?.id === employee.id) {
      setSelectedEmployee(null);
      setMessages([]);
      return;
    }
    setMessages([]);
    setMessagesLoading(true);
    setSelectedEmployee(employee);
    setShowHistoryView(false);
    setFromHistorySource('none');
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdminId) return;

    if (customerForm.isSuper) {
      if (!customerForm.name.trim()) {
        setNotification({ type: 'error', text: 'Please enter a customer name' });
        return;
      }
      if (!customerForm.badgeType) {
        setNotification({ type: 'error', text: 'Please select a badge type' });
        return;
      }
    }

    try {
      let customAvatarUrl = null;

      if (customerForm.customAvatarFile && customerForm.isSuper && customerForm.useCustomAvatar) {
        const fileExt = customerForm.customAvatarFile.name.split('.').pop();
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
        const filePath = `avatars/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('super-customer-avatars')
          .upload(filePath, customerForm.customAvatarFile);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('super-customer-avatars')
          .getPublicUrl(filePath);

        customAvatarUrl = publicUrl;
      }

      const insertData: any = {
        admin_id: selectedAdminId,
        customer_name: customerForm.name,
        customer_avatar: customerForm.avatar,
        is_super: customerForm.isSuper,
        super_customer_title: customerForm.isSuper ? customerForm.superTitle : null,
        badge_type: customerForm.isSuper && customerForm.badgeType ? customerForm.badgeType : null,
        vip_label: customerForm.isSuper ? ((customerForm.vipLabel || '').trim() || 'VIP') : null,
        custom_avatar_url: customerForm.useCustomAvatar ? customAvatarUrl : null,
        remarks: (customerForm.remarks || '').trim() || null,
        employee_pin_top: customerForm.employeePinTop,
        employee_always_visible: customerForm.employeeAlwaysVisible,
        target_employee_ids: customerForm.targetEmployeeIds.length > 0 ? customerForm.targetEmployeeIds : null,
        source_type: 'ccc_service',
      };

      if (customerForm.isSuper && (customerForm.customId || '').trim()) {
        insertData.customer_id = (customerForm.customId || '').trim();
      }

      const { error } = await supabase
        .from('simulated_customers')
        .insert(insertData);

      if (error) throw error;

      setNotification({ type: 'success', text: 'Customer created successfully!' });
      setShowCustomerForm(false);
      setCustomerForm({ name: '', avatar: '🧑', isSuper: false, superTitle: '', customId: '', badgeType: '', vipLabel: 'VIP', customAvatarFile: null, useCustomAvatar: false, remarks: '', employeePinTop: false, employeeAlwaysVisible: false, targetEmployeeIds: [], _empSearch: '' });
      loadAdminData(selectedAdminId, true);
    } catch (error: any) {
      const msg = (error.message || '').includes('customer_id_unique') ? 'This Custom ID is already in use. Please use a different one.' : (error.message || 'Failed to create customer');
      setNotification({ type: 'error', text: msg });
    }
  };

  const handleUpdateCustomer = async () => {
    if (!editingCustomer || !selectedAdminId) return;

    if (customerForm.isSuper) {
      if (!customerForm.name.trim()) {
        setNotification({ type: 'error', text: 'Please enter a customer name' });
        return;
      }
      if (!customerForm.badgeType) {
        setNotification({ type: 'error', text: 'Please select a badge type' });
        return;
      }
    }

    try {
      let customAvatarUrl = editingCustomer.custom_avatar_url;

      if (customerForm.useCustomAvatar) {
        if (customerForm.customAvatarFile && customerForm.isSuper) {
          if (editingCustomer.custom_avatar_url) {
            const oldPath = editingCustomer.custom_avatar_url.split('/').slice(-2).join('/');
            await supabase.storage
              .from('super-customer-avatars')
              .remove([oldPath]);
          }

          const fileExt = customerForm.customAvatarFile.name.split('.').pop();
          const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
          const filePath = `avatars/${fileName}`;

          const { error: uploadError } = await supabase.storage
            .from('super-customer-avatars')
            .upload(filePath, customerForm.customAvatarFile);

          if (uploadError) throw uploadError;

          const { data: { publicUrl } } = supabase.storage
            .from('super-customer-avatars')
            .getPublicUrl(filePath);

          customAvatarUrl = publicUrl;
        }
      } else {
        if (editingCustomer.custom_avatar_url) {
          const oldPath = editingCustomer.custom_avatar_url.split('/').slice(-2).join('/');
          await supabase.storage
            .from('super-customer-avatars')
            .remove([oldPath]);
        }
        customAvatarUrl = null;
      }

      const updateData: any = {
        customer_name: customerForm.name,
        customer_avatar: customerForm.avatar,
        is_super: customerForm.isSuper,
        super_customer_title: customerForm.isSuper ? customerForm.superTitle : null,
        badge_type: customerForm.isSuper && customerForm.badgeType ? customerForm.badgeType : null,
        vip_label: customerForm.isSuper ? ((customerForm.vipLabel || '').trim() || 'VIP') : null,
        custom_avatar_url: customerForm.useCustomAvatar ? customAvatarUrl : null,
        remarks: (customerForm.remarks || '').trim() || null,
        employee_pin_top: customerForm.employeePinTop,
        employee_always_visible: customerForm.employeeAlwaysVisible,
        target_employee_ids: customerForm.targetEmployeeIds.length > 0 ? customerForm.targetEmployeeIds : null,
        updated_at: new Date().toISOString(),
      };

      if (customerForm.isSuper && (customerForm.customId || '').trim()) {
        updateData.customer_id = (customerForm.customId || '').trim();
      }

      const { error } = await supabase
        .from('simulated_customers')
        .update(updateData)
        .eq('id', editingCustomer.id);

      if (error) throw error;

      // Sync customer info to all related conversations
      const conversationUpdateData: any = {
        customer_name: customerForm.name,
        customer_avatar: customerForm.avatar,
        is_super: customerForm.isSuper,
        super_customer_title: customerForm.isSuper ? customerForm.superTitle : null,
        badge_type: customerForm.isSuper && customerForm.badgeType ? customerForm.badgeType : null,
        custom_avatar_url: customerForm.useCustomAvatar ? customAvatarUrl : null,
      };

      if (customerForm.isSuper && (customerForm.customId || '').trim()) {
        conversationUpdateData.customer_id = (customerForm.customId || '').trim();
      }

      await supabase
        .from('customer_employee_conversations')
        .update(conversationUpdateData)
        .eq('simulated_customer_id', editingCustomer.id);

      setNotification({ type: 'success', text: 'Customer updated successfully!' });
      setEditingCustomer(null);
      setCustomerForm({ name: '', avatar: '🧑', isSuper: false, superTitle: '', customId: '', badgeType: '', vipLabel: 'VIP', customAvatarFile: null, useCustomAvatar: false, remarks: '', employeePinTop: false, employeeAlwaysVisible: false, targetEmployeeIds: [], _empSearch: '' });
      loadAdminData(selectedAdminId, true);
    } catch (error: any) {
      const msg = (error.message || '').includes('customer_id_unique') ? 'This Custom ID is already in use. Please use a different one.' : (error.message || 'Failed to update customer');
      setNotification({ type: 'error', text: msg });
    }
  };

  const handleToggleCustomerPin = async (customer: SimulatedCustomer) => {
    try {
      const { error } = await supabase
        .from('simulated_customers')
        .update({ is_pinned: !customer.is_pinned })
        .eq('id', customer.id);
      if (error) throw error;
      setCustomers(prev => prev.map(c => c.id === customer.id ? { ...c, is_pinned: !c.is_pinned } : c));
    } catch (error: any) {
      setNotification({ type: 'error', text: error.message || 'Failed to update pin' });
    }
  };

  const handleDeleteCustomer = async (customerId: string) => {
    const customerToDelete = customers.find(c => c.id === customerId);

    setConfirmDialog({
      show: true,
      title: 'Delete Customer',
      message: `Are you sure you want to delete customer "${customerToDelete?.customer_name || 'this customer'}"? All conversation history will be permanently deleted.`,
      onConfirm: async () => {
        try {
          const { data: convos } = await supabase
            .from('customer_employee_conversations')
            .select('id, image_url, rich_card_content_id')
            .eq('customer_id', customerId);

          if (convos?.length) {
            const imageUrls = convos
              .filter(c => c.image_url)
              .map(c => c.image_url as string);
            if (imageUrls.length) {
              const paths = imageUrls
                .map(url => {
                  const marker = '/storage/v1/object/public/chat-images/';
                  const idx = url.indexOf(marker);
                  return idx >= 0 ? url.slice(idx + marker.length) : null;
                })
                .filter((p): p is string => !!p);
              if (paths.length) {
                await supabase.storage.from('chat-images').remove(paths).catch(() => {});
              }
            }
            const rcIds = convos
              .filter(c => c.rich_card_content_id)
              .map(c => c.rich_card_content_id as string);
            if (rcIds.length) {
              const { data: rcRows } = await supabase
                .from('rich_card_contents')
                .select('id, html_content')
                .in('id', rcIds);
              if (rcRows?.length) {
                for (const rc of rcRows) {
                  await cleanupContentImages(rc.html_content).catch(() => {});
                }
              }
            }
          }

          await supabase.from('rich_card_contents').delete().eq('customer_id', customerId).then(() => {});

          const { error } = await supabase
            .from('simulated_customers')
            .delete()
            .eq('id', customerId);

          if (error) throw error;

          setNotification({ type: 'success', text: 'Customer deleted successfully!' });
          if (selectedCustomer?.id === customerId) {
            setSelectedCustomer(null);
            setSelectedEmployee(null);
          }
          setCustomers(prev => prev.filter(c => c.id !== customerId));
          setConfirmDialog(null);
        } catch (error: any) {
          setNotification({ type: 'error', text: error.message || 'Failed to delete customer' });
          setConfirmDialog(null);
        }
      }
    });
  };

  const animateProgressTo = (from: number, target: number, duration: number = 800) => {
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    let current = from;
    const steps = Math.max(Math.ceil(duration / 50), 1);
    const increment = (target - current) / steps;
    if (increment === 0) { setUploadProgress(target); return; }
    progressIntervalRef.current = setInterval(() => {
      current += increment;
      if ((increment > 0 && current >= target) || (increment <= 0 && current <= target)) {
        current = target;
        if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      setUploadProgress(Math.round(current));
    }, 50);
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedCustomer || !selectedEmployee) return;

    if (!file.type.startsWith('image/')) {
      setNotification({ type: 'error', text: 'Please select an image file' });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setNotification({ type: 'error', text: 'Image must be less than 5MB' });
      return;
    }

    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = (event) => resolve(event.target?.result as string);
      reader.readAsDataURL(file);
    });

    const tempId = `temp-${Date.now()}`;
    const tempMessage: Message = {
      id: tempId,
      customer_id: selectedCustomer.id,
      employee_id: selectedEmployee.id,
      sender_type: 'customer',
      message_content: '[Image]',
      message_type: 'image',
      image_url: dataUrl,
      is_read: false,
      created_at: new Date().toISOString(),
    };

    setMessages(prev => [...prev, tempMessage]);
    scrollToBottom(false);
    uploadingTempIdRef.current = tempId;
    setUploadingImage(true);
    setUploadProgress(0);
    animateProgressTo(0, 20, 600);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${selectedCustomer.id}_${selectedEmployee.id}_${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`;

      const startTime = Date.now();
      const { error: uploadError } = await supabase.storage
        .from('chat-images')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      animateProgressTo(20, 90, 200);
      await new Promise(r => setTimeout(r, 200));

      const { data: { publicUrl } } = supabase.storage
        .from('chat-images')
        .getPublicUrl(filePath);

      animateProgressTo(90, 100, 150);
      await new Promise(r => setTimeout(r, 150));

      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, image_url: publicUrl } : m));
      uploadingTempIdRef.current = null;
      setUploadingImage(false);
      setUploadProgress(0);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);

      supabase
        .from('customer_employee_conversations')
        .insert({
          customer_id: selectedCustomer.id,
          employee_id: selectedEmployee.id,
          sender_type: 'customer',
          message_content: '[Image]',
          message_type: 'image',
          image_url: publicUrl,
          source_type: 'ccc_service',
        })
        .then(({ error: insertError }) => {
          if (insertError) {
            console.error('Failed to save message:', insertError);
            setMessages(prev => prev.filter(m => m.id !== tempId));
            setNotification({ type: 'error', text: 'Failed to save image message' });
          }
          loadMessages();
          loadConversationHistory();
        });
    } catch (error: any) {
      setNotification({ type: 'error', text: error.message || 'Failed to upload image' });
      setMessages(prev => prev.filter(m => m.id !== tempId));
      uploadingTempIdRef.current = null;
      setUploadingImage(false);
      setUploadProgress(0);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const renderMessageContent = (msg: Message) => {
    if (msg.message_type === 'image' && !msg.image_url) {
      return (
        <div className="relative w-[340px] h-[340px] flex-shrink-0 rounded-lg overflow-hidden">
          <div className="absolute inset-0 bg-slate-800/60 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <div className="w-10 h-10 border-3 border-slate-600 border-t-blue-400 rounded-full animate-spin" />
              <span className="text-xs text-slate-400">Loading...</span>
            </div>
          </div>
        </div>
      );
    }
    if (msg.message_type === 'image' && msg.image_url) {
      const isUploading = uploadingImage && uploadingTempIdRef.current === msg.id;
      return (
        <AdminChatImage
          src={msg.image_url}
          isUploading={isUploading}
          uploadProgress={uploadProgress}
          onClickImage={(url) => { setPreviewImage(url); setAdminImageZoom(1); setAdminImageDrag({ x: 0, y: 0 }); }}
        />
      );
    }

    if (msg.message_type === 'rating_request') {
      const hasRating = messages.some(
        m => m.message_type === 'rating_result' &&
        new Date(m.created_at) > new Date(msg.created_at)
      );

      return (
        <div className="my-2">
          <div className="relative bg-white border border-blue-200 rounded-xl px-4 py-3 shadow-sm overflow-hidden" style={{ boxShadow: '0 2px 8px rgba(59,130,246,0.1)' }}>
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-400 via-cyan-400 to-blue-500"></div>
            <div className="flex items-center gap-2 mb-2.5 mt-0.5">
              <div className="p-1.5 bg-blue-500 rounded-lg">
                <Star className="w-3.5 h-3.5 text-white fill-white" />
              </div>
              <span className="text-xs font-bold text-blue-700">Rating Request</span>
              {hasRating ? (
                <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 border border-emerald-200 rounded-full">
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></div>
                  <span className="text-[10px] text-emerald-700 font-semibold">Rated</span>
                </div>
              ) : (
                <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 border border-amber-200 rounded-full">
                  <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse"></div>
                  <span className="text-[10px] text-amber-700 font-semibold">Pending</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 mb-2.5 px-1">
              {[1, 2, 3, 4, 5].map((s) => (
                <Star key={s} className="w-4 h-4 fill-slate-200 text-slate-300" />
              ))}
              <span className="ml-1.5 text-xs text-slate-400">Awaiting response</span>
            </div>
            {!hasRating && msg.sender_type === 'employee' && (
              <button
                onClick={() => setShowRatingModal(true)}
                className="w-full px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors"
              >
                Submit Rating
              </button>
            )}
          </div>
        </div>
      );
    }

    if (msg.message_type === 'rating_result' && msg.rating_data) {
      const { rating = 0, comment } = msg.rating_data;
      return (
        <div className="my-2">
          <div className="w-[260px] rounded-xl overflow-hidden shadow-md" style={{ boxShadow: '0 4px 12px rgba(16,185,129,0.25)' }}>
            <div className="bg-gradient-to-r from-emerald-500 to-green-500 px-4 py-2.5 flex items-center gap-2">
              <div className="p-1 bg-white/20 rounded-md">
                <Star className="w-3.5 h-3.5 text-white fill-white" />
              </div>
              <span className="text-sm font-bold text-white">Service Rating</span>
              <div className="ml-auto px-2 py-0.5 bg-white/20 rounded-full">
                <span className="text-[10px] text-white font-semibold">Completed</span>
              </div>
            </div>
            <div className="bg-white px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      className={`w-5 h-5 ${
                        star <= rating
                          ? 'text-amber-400 fill-amber-400'
                          : 'text-slate-200 fill-slate-200'
                      }`}
                    />
                  ))}
                </div>
                <span className="text-xl font-bold text-emerald-600">{rating}.0</span>
              </div>
              {comment && (
                <div className="mt-2.5 pt-2.5 border-t border-emerald-100">
                  <p className="text-xs text-slate-600 leading-relaxed italic">"{comment}"</p>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    if (msg.message_type === 'rich_card') {
      return (
        <div className="my-1.5">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); openRichCardViewer(msg); }}
            className="w-[240px] text-left rounded-2xl overflow-hidden transition-all duration-250 group shadow-[0_2px_12px_rgba(37,99,246,0.15)] hover:shadow-[0_8px_24px_rgba(37,99,246,0.22)] hover:scale-[1.015]"
          >
            <div className="relative bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700 px-4 pt-4 pb-3.5">
              <div className="absolute top-0 right-0 w-20 h-20 bg-white/[0.07] rounded-full -translate-y-8 translate-x-8" />
              <div className="absolute bottom-0 left-0 w-14 h-14 bg-white/[0.05] rounded-full translate-y-6 -translate-x-6" />
              <div className="relative flex items-start gap-2.5">
                <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center">
                  <Megaphone className="w-3.5 h-3.5 text-white" />
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <span className="text-[12.5px] font-semibold text-white block truncate leading-snug">{msg.title || 'View details'}</span>
                  {msg.subtitle && <span className="text-[11px] text-blue-100/80 block truncate mt-1 leading-snug">{msg.subtitle}</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between px-4 py-2 bg-white border-t border-blue-100">
              <span className="text-[10.5px] text-blue-600 font-medium">View details</span>
              <ChevronRight className="w-3.5 h-3.5 text-blue-400 group-hover:text-blue-600 group-hover:translate-x-0.5 transition-all duration-200" />
            </div>
          </button>
        </div>
      );
    }

    if (msg.message_type === 'tip' && msg.rating_data) {
      const tipAmt = msg.rating_data.tip_amount || 0;
      return (
        <div className="my-1.5">
          <div className="w-[200px] rounded-md overflow-hidden shadow-lg shadow-amber-900/25">
            <div className="relative bg-gradient-to-br from-amber-600 via-amber-500 to-yellow-600 p-[2px]">
              <div className="relative bg-gradient-to-br from-amber-500 via-yellow-500 to-amber-600 rounded-sm px-3 py-2.5 overflow-hidden">
                <div className="absolute inset-0 opacity-[0.08]" style={{
                  backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.5) 2px, rgba(255,255,255,0.5) 3px),
                    repeating-linear-gradient(-45deg, transparent, transparent 2px, rgba(255,255,255,0.5) 2px, rgba(255,255,255,0.5) 3px)`
                }}></div>
                <div className="absolute top-0 left-2 right-2 h-[1.5px] bg-gradient-to-r from-transparent via-white/35 to-transparent"></div>
                <div className="absolute bottom-0 left-2 right-2 h-[1.5px] bg-gradient-to-r from-transparent via-white/35 to-transparent"></div>
                <div className="relative">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <Gift className="w-3 h-3 text-amber-100" />
                      <span className="text-[9px] font-bold text-amber-100 uppercase tracking-widest">Tip Sent</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-center py-1">
                    <span className="text-[22px] font-black mr-0.5 text-white leading-none" style={{ textShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>$</span>
                    <span className="text-[26px] font-black tracking-tight leading-none text-white" style={{ textShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>{tipAmt.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    const content = msg.message_content;
    const hasHtml = /<[a-z][\s\S]*>/i.test(content);
    if (hasHtml) {
      const sanitized = sanitizeChatMessage(content);
      const hasImgTag = /<img\s/i.test(content);
      return (
        <div
          className={`text-sm break-words chat-rich-content${hasImgTag ? ' [&_img]:cursor-pointer [&_img]:rounded-lg [&_img]:w-[260px] [&_img]:h-[260px] [&_img]:object-cover [&_img]:hover:opacity-90 [&_img]:transition-opacity [&_img]:shadow-sm' : ''}`}
          style={{ overflowWrap: 'anywhere' }}
          dangerouslySetInnerHTML={{ __html: sanitized }}
          onClick={(e) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'IMG') {
              e.stopPropagation();
              e.preventDefault();
              const imgSrc = (target as HTMLImageElement).src;
              if (imgSrc) {
                setPreviewImage(imgSrc);
                setAdminImageZoom(1);
                setAdminImageDrag({ x: 0, y: 0 });
              }
            }
          }}
        />
      );
    }
    return <div className="text-sm whitespace-pre-wrap break-words" style={{ overflowWrap: 'anywhere' }}>{content}</div>;
  };

  const ensureEditorFocus = (editor: HTMLDivElement) => {
    if (document.activeElement !== editor) editor.focus();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !editor.contains(sel.anchorNode)) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  };

  const syncMainFormatState = () => {
    setIsBoldActive(document.queryCommandState('bold'));
    setIsUnderlineActive(document.queryCommandState('underline'));
  };

  const applyFormat = (command: string, value?: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    ensureEditorFocus(editor);
    document.execCommand(command, false, value);
    if (command === 'bold') setIsBoldActive(prev => !prev);
    else if (command === 'underline') setIsUnderlineActive(prev => !prev);
  };

  const getEditorContent = (): string => {
    if (!editorRef.current) return '';
    return stripTailwindStyles(editorRef.current.innerHTML);
  };

  const isEditorEmpty = (): boolean => {
    if (!editorRef.current) return true;
    const text = editorRef.current.textContent || '';
    const hasImages = editorRef.current.querySelector('img') !== null;
    return text.trim().length === 0 && !hasImages;
  };

  const getEditorHasContent = (): boolean => {
    if (!editorRef.current) return false;
    const text = (editorRef.current.textContent || '').trim();
    const hasImages = editorRef.current.querySelector('img') !== null;
    return text.length > 0 || hasImages;
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer || !selectedEmployee) return;

    const htmlContent = getEditorContent();
    if (isEditorEmpty()) return;

    const tempMessage: Message = {
      id: `temp-${Date.now()}`,
      customer_id: selectedCustomer.id,
      employee_id: selectedEmployee.id,
      sender_type: 'customer',
      message_content: htmlContent,
      message_type: 'text',
      is_read: true,
      created_at: new Date().toISOString(),
    };

    setMessages(prev => [...prev, tempMessage]);
    if (editorRef.current) editorRef.current.innerHTML = '';
    setMessageInput('');
    justSentRef.current = true;
    setTimeout(() => { justSentRef.current = false; }, 3000);

    try {
      const { data: newMsg, error } = await supabase
        .from('customer_employee_conversations')
        .insert({
          customer_id: selectedCustomer.id,
          employee_id: selectedEmployee.id,
          sender_type: 'customer',
          message_content: htmlContent,
          message_type: 'text',
          source_type: 'ccc_service',
        })
        .select()
        .single();

      if (error) {
        setMessages(prev => prev.filter(m => m.id !== tempMessage.id));
        throw error;
      }

      if (newMsg) {
        setMessages(prev => prev.map(m => m.id === tempMessage.id ? newMsg : m));
      }
      loadConversationHistory();
    } catch (error: any) {
      setNotification({ type: 'error', text: error.message || 'Failed to send message' });
    }
  };

  const extractStoragePath = (publicUrl: string): string | null => {
    try {
      const marker = '/object/public/chat-images/';
      const idx = publicUrl.indexOf(marker);
      if (idx !== -1) return publicUrl.substring(idx + marker.length);
      return null;
    } catch { return null; }
  };

  const cleanupStorageImage = async (imageUrl: string) => {
    const path = extractStoragePath(imageUrl);
    if (!path) return;
    try {
      await supabase.storage.from('chat-images').remove([path]);
    } catch {}
  };

  const handleDeleteMessage = (messageId: string) => {
    setConfirmDialog({
      show: true,
      title: 'Delete Message',
      message: 'Are you sure you want to delete this message?',
      onConfirm: async () => {
        try {
          const { data, error } = await supabase
            .from('customer_employee_conversations')
            .delete()
            .eq('id', messageId)
            .select();

          if (error) throw error;

          if (data?.[0]?.message_type === 'image' && data[0].image_url) {
            await cleanupStorageImage(data[0].image_url);
          }

          setNotification({ type: 'success', text: 'Message deleted successfully' });
          loadMessages();
          loadConversationHistory();
        } catch (error: any) {
          setNotification({ type: 'error', text: error.message || 'Failed to delete message' });
        }
        setConfirmDialog(null);
      },
    });
  };

  const handleStartEdit = (msg: Message) => {
    if (msg.message_type === 'image') {
      replacingImageMsgIdRef.current = msg.id;
      replaceImageInputRef.current?.click();
      return;
    }
    setEditingMessageId(msg.id);
    setEditingContent(msg.message_content);
    setTimeout(() => {
      if (editEditorRef.current) {
        editEditorRef.current.innerHTML = msg.message_content;
        editEditorRef.current.focus();
      }
    }, 50);
  };

  const handleReplaceImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const msgId = replacingImageMsgIdRef.current;
    if (!file || !msgId) return;
    if (file.size > 5 * 1024 * 1024) {
      setNotification({ type: 'error', text: 'Image must be less than 5MB' });
      return;
    }
    setReplacingImageMsgId(msgId);
    try {
      const { data: oldMsg } = await supabase
        .from('customer_employee_conversations')
        .select('image_url')
        .eq('id', msgId)
        .maybeSingle();
      const oldImageUrl = oldMsg?.image_url;

      const fileExt = file.name.split('.').pop();
      const fileName = `chat-replace-${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;
      const { data, error: uploadError } = await supabase.storage.from('chat-images').upload(fileName, file);
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('chat-images').getPublicUrl(data.path);
      const { error: updateError } = await supabase
        .from('customer_employee_conversations')
        .update({ image_url: publicUrl })
        .eq('id', msgId);
      if (updateError) throw updateError;

      if (oldImageUrl) await cleanupStorageImage(oldImageUrl);

      setNotification({ type: 'success', text: 'Image replaced successfully' });
      preserveScrollUntilRef.current = Date.now() + 2000;
      loadMessages();
    } catch (error: any) {
      setNotification({ type: 'error', text: error.message || 'Failed to replace image' });
    } finally {
      replacingImageMsgIdRef.current = null;
      setReplacingImageMsgId(null);
      if (replaceImageInputRef.current) replaceImageInputRef.current.value = '';
    }
  };

  const handleSaveEdit = async () => {
    if (!editingMessageId || !editEditorRef.current) return;
    const newContent = editEditorRef.current.innerHTML;
    const textOnly = editEditorRef.current.textContent || '';
    const hasImages = editEditorRef.current.querySelector('img') !== null;
    if (!textOnly.trim() && !hasImages) return;

    try {
      const { error } = await supabase
        .from('customer_employee_conversations')
        .update({ message_content: newContent })
        .eq('id', editingMessageId);

      if (error) throw error;

      setEditingMessageId(null);
      setEditingContent('');
      preserveScrollUntilRef.current = Date.now() + 2000;
      loadMessages();
    } catch (error: any) {
      setNotification({ type: 'error', text: error.message || 'Failed to update message' });
    }
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditingContent('');
    setIsEditBoldActive(false);
    setIsEditUnderlineActive(false);
    setEditEditorFontSize(null);
  };

  const handleEditImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editEditorRef.current) return;
    if (file.size > 5 * 1024 * 1024) {
      setNotification({ type: 'error', text: 'Image must be less than 5MB' });
      return;
    }
    setUploadingEditImage(true);
    try {
      const fileName = `chat-edit-${Date.now()}-${Math.random().toString(36).slice(2)}.${file.name.split('.').pop()}`;
      const { data, error } = await supabase.storage.from('chat-images').upload(fileName, file);
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('chat-images').getPublicUrl(data.path);
      const img = document.createElement('img');
      img.src = publicUrl;
      img.style.maxWidth = '100%';
      img.style.borderRadius = '8px';
      img.style.margin = '4px 0';
      editEditorRef.current.appendChild(img);
    } catch (error: any) {
      setNotification({ type: 'error', text: error.message || 'Failed to upload image' });
    } finally {
      setUploadingEditImage(false);
      if (editFileInputRef.current) editFileInputRef.current.value = '';
    }
  };

  const applyEditFormat = (command: string, value?: string) => {
    const editor = editEditorRef.current;
    if (!editor) return;
    ensureEditorFocus(editor);
    document.execCommand(command, false, value);
    if (command === 'bold') setIsEditBoldActive(prev => !prev);
    else if (command === 'underline') setIsEditUnderlineActive(prev => !prev);
  };

  const updateEditFormatState = () => {
    setIsEditBoldActive(document.queryCommandState('bold'));
    setIsEditUnderlineActive(document.queryCommandState('underline'));
  };

  const BG_COLORS = [
    { color: '#fef08a', label: 'Yellow' },
    { color: '#bbf7d0', label: 'Green' },
    { color: '#bfdbfe', label: 'Blue' },
    { color: '#fecaca', label: 'Red' },
    { color: '#e9d5ff', label: 'Purple' },
    { color: '#fed7aa', label: 'Orange' },
    { color: '#99f6e4', label: 'Teal' },
    { color: '#fce7f3', label: 'Pink' },
  ];

  const TEXT_COLORS = [
    { color: '#000000', label: 'Black' },
    { color: '#dc2626', label: 'Red' },
    { color: '#2563eb', label: 'Blue' },
    { color: '#16a34a', label: 'Green' },
    { color: '#d97706', label: 'Orange' },
    { color: '#7c3aed', label: 'Purple' },
    { color: '#0891b2', label: 'Cyan' },
    { color: '#be185d', label: 'Pink' },
  ];

  const ensureEditorSelection = (editor: HTMLDivElement) => {
    if (document.activeElement !== editor) editor.focus();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !editor.contains(sel.anchorNode)) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  };

  const syncTemplateFormatState = () => {
    setTemplateBoldActive(document.queryCommandState('bold'));
    setTemplateUnderlineActive(document.queryCommandState('underline'));
    setTemplateStrikethroughActive(document.queryCommandState('strikeThrough'));
  };

  const execTemplateCmd = (cmd: string, value?: string) => {
    const editor = templateEditorRef.current;
    if (!editor) return;
    ensureEditorSelection(editor);
    document.execCommand(cmd, false, value);
    if (cmd === 'bold') setTemplateBoldActive(prev => !prev);
    else if (cmd === 'underline') setTemplateUnderlineActive(prev => !prev);
    else if (cmd === 'strikeThrough') setTemplateStrikethroughActive(prev => !prev);
  };

  const applyBgColor = (color: string | null, target: 'main' | 'edit' | 'template') => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setShowBgColorPicker(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const walkUp = (node: Node | null): HTMLSpanElement | null => {
      while (node && node !== editorRef.current && node !== editEditorRef.current && node !== templateEditorRef.current) {
        if (node instanceof HTMLSpanElement && node.style.backgroundColor) return node;
        node = node.parentNode;
      }
      return null;
    };
    const existingSpan = walkUp(container.nodeType === Node.TEXT_NODE ? container.parentNode : container);
    if (existingSpan) {
      if (color) {
        existingSpan.style.backgroundColor = color;
      } else {
        const parent = existingSpan.parentNode;
        if (parent) {
          while (existingSpan.firstChild) parent.insertBefore(existingSpan.firstChild, existingSpan);
          parent.removeChild(existingSpan);
        }
      }
    } else if (color) {
      const span = document.createElement('span');
      span.style.backgroundColor = color;
      range.surroundContents(span);
    }
    setShowBgColorPicker(null);
    if (target === 'main') editorRef.current?.focus();
    else if (target === 'edit') editEditorRef.current?.focus();
    else templateEditorRef.current?.focus();
  };

  const handleDeleteConversation = () => {
    if (!selectedCustomer || !selectedEmployee) return;
    setConfirmDialog({
      show: true,
      title: 'Delete Conversation',
      message: `Delete entire conversation with ${selectedEmployee.username}? This cannot be undone.`,
      onConfirm: async () => {
        try {
          console.log('Deleting conversation:', {
            customerId: selectedCustomer.id,
            employeeId: selectedEmployee.id
          });

          const { data, error } = await supabase
            .from('customer_employee_conversations')
            .delete()
            .eq('customer_id', selectedCustomer.id)
            .eq('employee_id', selectedEmployee.id)
            .select();

          console.log('Delete conversation response:', { data, error });

          if (error) {
            console.error('Delete conversation error:', error);
            throw error;
          }

          setNotification({ type: 'success', text: `Conversation deleted (${data?.length || 0} messages removed)` });
          setMessages([]);
          loadConversationHistory();
        } catch (error: any) {
          console.error('Delete conversation failed:', error);
          setNotification({ type: 'error', text: error.message || 'Failed to delete conversation' });
        }
        setConfirmDialog(null);
      },
    });
  };

  const handleDeleteAllConversations = () => {
    if (!selectedCustomer) return;
    setConfirmDialog({
      show: true,
      title: 'Delete All Conversations',
      message: 'Delete ALL conversations for this customer? This will permanently remove all chat history with all employees. This cannot be undone.',
      onConfirm: async () => {
        try {
          console.log('Deleting all conversations for customer:', selectedCustomer.id);

          const { data, error } = await supabase
            .from('customer_employee_conversations')
            .delete()
            .eq('customer_id', selectedCustomer.id)
            .select();

          console.log('Delete all conversations response:', { data, error });

          if (error) {
            console.error('Delete all conversations error:', error);
            throw error;
          }

          setNotification({ type: 'success', text: `All conversations deleted (${data?.length || 0} messages removed)` });
          setMessages([]);
          setConversationHistory([]);
          setSelectedEmployee(null);
        } catch (error: any) {
          console.error('Delete all conversations failed:', error);
          setNotification({ type: 'error', text: error.message || 'Failed to delete conversations' });
        }
        setConfirmDialog(null);
      },
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-white text-lg">Loading...</div>
      </div>
    );
  }

  if (isSuperAdmin && !selectedAdminId && !initialEmployee) {
    return (
      <div className="space-y-6">
        <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-blue-500/20 p-6">

          <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-800/80">
                  <th className="text-left py-4 px-6 text-slate-300 font-semibold">Admin</th>
                  <th className="text-center py-4 px-6 text-slate-300 font-semibold">Role</th>
                  <th className="text-center py-4 px-6 text-slate-300 font-semibold">Employees</th>
                  <th className="text-center py-4 px-6 text-slate-300 font-semibold">Customers</th>
                  <th className="text-center py-4 px-6 text-slate-300 font-semibold">Messages</th>
                  <th className="text-right py-4 px-6 text-slate-300 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {adminGroups.map((group, index) => (
                  <tr
                    key={group.admin_id}
                    className={`border-t border-slate-700/50 hover:bg-slate-700/30 transition-colors ${
                      index % 2 === 0 ? 'bg-slate-800/20' : 'bg-slate-800/10'
                    }`}
                  >
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-blue-600/30 to-cyan-600/30 rounded-lg flex items-center justify-center">
                          <User className="w-5 h-5 text-blue-400" />
                        </div>
                        <span className="text-white font-medium">{group.admin_username}</span>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-center">
                      <span className="inline-block px-3 py-1 bg-blue-500/20 text-blue-400 rounded-full text-xs font-medium">
                        {group.admin_role}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-center">
                      <span className="text-white font-semibold">{group.employee_count}</span>
                    </td>
                    <td className="py-4 px-6 text-center">
                      <span className="text-white font-semibold">{group.customer_count}</span>
                    </td>
                    <td className="py-4 px-6 text-center">
                      <span className="text-white font-semibold">{group.conversation_count}</span>
                    </td>
                    <td className="py-4 px-6 text-right">
                      <div className="relative inline-block">
                        <button
                          onClick={() => handleAdminGroupSelect(group)}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white rounded-lg transition-all font-medium"
                        >
                          Manage
                          <ChevronRight className="w-4 h-4" />
                        </button>
                        {/* Unread Messages Badge */}
                        {adminUnreadCounts[group.admin_id] && adminUnreadCounts[group.admin_id] > 0 && (
                          <div className="absolute -top-2 -right-2 min-w-[24px] h-6 px-1.5 bg-gradient-to-br from-red-500 to-red-600 rounded-full flex items-center justify-center shadow-xl shadow-red-500/60 border-2 border-slate-900 z-10 animate-pulse">
                            <span className="text-xs font-bold text-white leading-none">
                              {adminUnreadCounts[group.admin_id] > 99 ? '99+' : adminUnreadCounts[group.admin_id]}
                            </span>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {adminGroups.length === 0 && (
              <div className="text-center py-12 text-slate-400">
                <Users className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p>No admin groups found</p>
              </div>
            )}
          </div>
        </div>

        {notification && createPortal(
          <div className={`fixed top-4 right-4 z-[100000] px-4 py-3 rounded-xl shadow-2xl border backdrop-blur-md transition-all animate-[slideInRight_0.3s_ease-out] ${
            notification.type === 'success'
              ? 'bg-green-500/90 text-white border-green-400/50 shadow-green-500/30'
              : 'bg-red-500/90 text-white border-red-400/50 shadow-red-500/30'
          }`}>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{notification.text}</span>
              <button onClick={() => setNotification(null)} className="ml-2 p-0.5 hover:bg-white/20 rounded transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>,
          document.body
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="space-y-2 relative rounded-xl p-2 flex flex-col overflow-hidden" style={{
      height: 'calc(100vh - 90px)',
      background: ` style={{
        radial-gradient(ellipse 80% 60% at 15% 20%, rgba(34,197,94,0.25) 0%, transparent 50%),
        radial-gradient(ellipse 70% 50% at 75% 15%, rgba(59,130,246,0.25) 0%, transparent 50%),
        radial-gradient(ellipse 60% 70% at 50% 60%, rgba(245,158,11,0.2) 0%, transparent 50%),
        radial-gradient(ellipse 90% 40% at 85% 80%, rgba(236,72,153,0.2) 0%, transparent 50%),
        radial-gradient(ellipse 50% 80% at 25% 85%, rgba(139,92,246,0.2) 0%, transparent 50%),
        radial-gradient(ellipse 40% 40% at 60% 35%, rgba(6,182,212,0.2) 0%, transparent 50%),
        radial-gradient(ellipse 55% 55% at 40% 50%, rgba(248,113,113,0.15) 0%, transparent 50%),
        linear-gradient(135deg, #1a1a2e 0%, #16213e 25%, #1a1a2e 50%, #0f3460 75%, #1a1a2e 100%)
      `
    }}>
      {/* Info Bar + History/New Buttons in one row */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {isSuperAdmin && selectedAdminId && (
          <button
            type="button"
            onClick={handleBackToGroups}
            className="flex items-center gap-1.5 px-3 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg transition-colors text-xs font-medium flex-shrink-0 border border-orange-400/60 shadow-md shadow-orange-600/30"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
        )}
        {isSuperAdmin && selectedAdminId && (
          <div className="flex items-center gap-2 px-3 h-10 bg-blue-900/30 border border-blue-500/30 rounded-lg flex-shrink-0">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse flex-shrink-0"></div>
            <span className="text-[10px] font-bold text-blue-300 uppercase tracking-wider flex-shrink-0">Managing</span>
            <div className="h-4 w-px bg-blue-500/30 flex-shrink-0"></div>
            <div className="p-1 bg-gradient-to-br from-blue-500 to-cyan-500 rounded flex-shrink-0">
              <User className="w-3 h-3 text-white" />
            </div>
            <span className="text-sm font-bold text-white truncate">{selectedAdminName}</span>
          </div>
        )}
        {selectedEmployee && (
          <div className="flex items-center gap-2 px-3 h-10 bg-[#15803d] border border-[#15803d] rounded-lg flex-shrink-0">
            <div className="w-7 h-7 bg-[#dcfce7] rounded-md flex items-center justify-center flex-shrink-0">
              <MessageCircle className="w-3.5 h-3.5 text-[#15803d]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-white leading-none truncate" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>{selectedEmployee?.username} <span className="text-[10px] font-medium text-[#bbf7d0]">ID: {selectedEmployee?.employee_id}</span></div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedEmployee(null)}
              className="ml-1 p-1 hover:bg-[#166534] rounded-md transition-colors text-[#bbf7d0] hover:text-white"
              title="Clear selection"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
          {(() => {
            const totalUnread = allConversationHistory.filter(h => h.unread_count > 0).length;
            return (
              <>
                <button
                  type="button"
                  onClick={() => { loadAllConversationHistory(); setSelectedEmployee(null); setSelectedCustomer(null); setShowHistoryView(true); setHistoryFilterMode('all'); setHistoryScope('all'); historyScrollTopRef.current = 0; }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all border-2 ${
                    showHistoryView && historyScope === 'all' && historyFilterMode !== 'new'
                      ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/40 border-cyan-400'
                      : 'bg-cyan-600/20 hover:bg-cyan-500/30 border-cyan-500/40 hover:border-cyan-400/60 text-cyan-300 hover:text-cyan-100 shadow-lg shadow-cyan-900/20 hover:shadow-cyan-800/30'
                  }`}
                >
                  <Clock className="w-4 h-4" />
                  <span>All History</span>
                  {allConversationHistory.length > 0 && (
                    <span className={`ml-1 px-2 py-0.5 rounded-full text-xs font-black min-w-[24px] text-center ${
                      showHistoryView && historyScope === 'all' && historyFilterMode !== 'new'
                        ? 'bg-white text-cyan-700'
                        : 'bg-cyan-500 text-white'
                    }`}>{allConversationHistory.length}</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => { loadAllConversationHistory(); setSelectedEmployee(null); setSelectedCustomer(null); setShowHistoryView(true); setHistoryFilterMode('new'); setHistoryScope('all'); historyScrollTopRef.current = 0; }}
                  className={`relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all border-2 ${
                    showHistoryView && historyScope === 'all' && historyFilterMode === 'new'
                      ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/40 border-orange-400'
                      : 'bg-orange-600/20 hover:bg-orange-500/30 border-orange-500/40 hover:border-orange-400/60 text-orange-300 hover:text-orange-100 shadow-lg shadow-orange-900/20 hover:shadow-orange-800/30'
                  }`}
                >
                  <MessageSquarePlus className="w-4 h-4" />
                  <span>All New</span>
                  {totalUnread > 0 && (
                    <span className={`ml-1 px-2 py-0.5 rounded-full text-xs font-black min-w-[24px] text-center ${
                      showHistoryView && historyScope === 'all' && historyFilterMode === 'new'
                        ? 'bg-white text-orange-700'
                        : 'bg-orange-500 text-white'
                    }`}>{totalUnread}</span>
                  )}
                  {totalUnread > 0 && !(showHistoryView && historyScope === 'all' && historyFilterMode === 'new') && (
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-orange-500 rounded-full animate-pulse"></span>
                  )}
                </button>
              </>
            );
          })()}
        </div>
      </div>

      {/* 3-Panel Layout: Customer Sidebar | Employee List | Chat */}
      <div className="flex gap-3 flex-1 min-h-0">

        {/* Left: Customer Sidebar */}
        <div className="w-80 flex-shrink-0 bg-slate-900/80 backdrop-blur-xl rounded-xl border border-slate-700/50 flex flex-col overflow-hidden">
          {/* Sidebar Header */}
          <div className="p-3 border-b border-slate-700/50 bg-slate-800/60">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold text-white flex items-center gap-1.5 uppercase tracking-wider">
                <Users className="w-3.5 h-3.5 text-blue-400" />
                Customers
              </h3>
              <button
                type="button"
                onClick={() => setShowCustomerForm(!showCustomerForm)}
                className="p-1 bg-blue-600 hover:bg-blue-700 text-white rounded transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex gap-0.5 bg-slate-800/60 p-0.5 rounded-lg">
              <button
                onClick={() => setCustomerFilter('all')}
                className={`flex-1 px-2 py-1.5 text-[10px] font-bold rounded-md transition-all duration-200 flex items-center justify-center gap-1 ${
                  customerFilter === 'all'
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 ring-1 ring-blue-400/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/60'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setCustomerFilter('super')}
                className={`flex-1 px-2 py-1.5 text-[10px] font-bold rounded-md transition-all duration-200 flex items-center justify-center gap-1 ${
                  customerFilter === 'super'
                    ? 'bg-gradient-to-r from-amber-600 to-yellow-500 text-white shadow-md shadow-amber-600/30 ring-1 ring-amber-400/30'
                    : 'text-slate-400 hover:text-amber-300 hover:bg-amber-900/20'
                }`}
              >
                <Star className="w-2.5 h-2.5" fill={customerFilter === 'super' ? 'currentColor' : 'none'} />
                VIP
              </button>
              <button
                onClick={() => setCustomerFilter('regular')}
                className={`flex-1 px-2 py-1.5 text-[10px] font-bold rounded-md transition-all duration-200 flex items-center justify-center gap-1 ${
                  customerFilter === 'regular'
                    ? 'bg-teal-600 text-white shadow-md shadow-teal-600/30 ring-1 ring-teal-400/30'
                    : 'text-slate-400 hover:text-teal-300 hover:bg-teal-900/20'
                }`}
              >
                Reg
              </button>
            </div>
          </div>

          {/* Customer List - Scrollable */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-dark">
            {customers
              .filter(customer => {
                if (customerFilter === 'super') return customer.is_super === true;
                if (customerFilter === 'regular') return !customer.is_super;
                return true;
              })
              .sort((a, b) => {
                const aPinned = a.is_pinned ? 1 : 0;
                const bPinned = b.is_pinned ? 1 : 0;
                if (aPinned !== bPinned) return bPinned - aPinned;
                const aUnread = customerUnreadCounts[a.id] || 0;
                const bUnread = customerUnreadCounts[b.id] || 0;
                if (aUnread > 0 && bUnread === 0) return -1;
                if (aUnread === 0 && bUnread > 0) return 1;
                if (aUnread !== bUnread) return bUnread - aUnread;
                if (a.is_super && !b.is_super) return -1;
                if (!a.is_super && b.is_super) return 1;
                return 0;
              })
              .map((customer) => (
              <div
                key={customer.id}
                className={`relative rounded-lg cursor-pointer transition-all duration-200 group min-h-[72px] ${
                  customer.is_super
                    ? selectedCustomer?.id === customer.id
                      ? 'p-3.5 bg-gradient-to-br from-amber-600 via-yellow-500 to-amber-500 border-2 border-yellow-300/70 shadow-lg shadow-amber-500/30 ring-1 ring-amber-300/40'
                      : 'p-3 bg-gradient-to-br from-slate-800 to-slate-800/90 border-2 border-amber-500/50 hover:border-amber-400/70 hover:shadow-md hover:shadow-amber-500/10'
                    : selectedCustomer?.id === customer.id
                      ? 'p-2.5 bg-blue-600 border border-blue-400/40 shadow-lg shadow-blue-600/20'
                      : 'p-2 bg-slate-800/60 border border-slate-600/40 hover:border-slate-500/60 hover:bg-slate-700/60'
                }`}
                onClick={() => handleSelectCustomer(customer)}
              >
                {/* Remarks - top right corner */}
                {customer.remarks && (
                  <span className="absolute top-1 right-7 text-[11px] font-medium text-white truncate max-w-[45%] z-10 pointer-events-none leading-tight" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8), 0 0 6px rgba(0,0,0,0.5)' }} title={customer.remarks}>{customer.remarks}</span>
                )}
                {/* Pinned indicator - top left corner */}
                {customer.is_pinned && (
                  <div className="absolute -top-1.5 -left-1.5 w-5 h-5 bg-teal-500 rounded-full flex items-center justify-center z-20 shadow-md shadow-teal-500/40 ring-1 ring-teal-400/60">
                    <Pin className="w-3 h-3 text-white" style={{ transform: 'rotate(-45deg)' }} />
                  </div>
                )}
                {/* Unread Badge */}
                {(() => {
                  const count = customerUnreadCounts[customer.id] || 0;
                  return count > 0 && (
                    <div className="absolute -top-2 -right-2 min-w-[22px] h-[22px] px-1.5 bg-red-500 rounded-full flex items-center justify-center z-20 shadow-lg shadow-red-500/40 ring-2 ring-slate-900/80">
                      <span className="text-[10px] font-bold text-white leading-none">{count > 99 ? '99+' : count}</span>
                    </div>
                  );
                })()}
                <div className={`flex items-center ${customer.is_super ? 'gap-3' : selectedCustomer?.id === customer.id ? 'gap-2.5' : 'gap-2'}`}>
                  <div className="relative flex-shrink-0">
                    {customer.is_super && customer.badge_type && (
                      <div className={`absolute -top-1 -left-1 ${customer.is_super ? 'w-5 h-5 text-[10px]' : 'w-4 h-4 text-[8px]'} bg-amber-500 rounded-full flex items-center justify-center z-10`}>
                        {customer.badge_type === 'diamond' ? '💎' : customer.badge_type === 'crown' ? '👑' : customer.badge_type === 'star' ? '⭐' : customer.badge_type === 'vip' ? '🏆' : '✨'}
                      </div>
                    )}
                    <div className={`rounded-full flex items-center justify-center overflow-hidden ${
                      customer.is_super
                        ? selectedCustomer?.id === customer.id ? 'w-11 h-11 text-2xl' : 'w-10 h-10 text-xl'
                        : selectedCustomer?.id === customer.id ? 'w-9 h-9 text-xl' : 'w-8 h-8 text-lg'
                    } ${
                      selectedCustomer?.id === customer.id
                        ? customer.is_super ? 'bg-amber-800/40 ring-2 ring-white/50' : 'bg-white/20 ring-1 ring-white/30'
                        : customer.is_super ? 'bg-amber-900/50 ring-2 ring-amber-400/50' : 'bg-slate-700 ring-1 ring-slate-500/40'
                    }`}>
                      {customer.custom_avatar_url ? (
                        <img src={customer.custom_avatar_url} alt={customer.customer_name} className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        customer.customer_avatar
                      )}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    {customer.is_super && customer.super_customer_title && (
                      <span className={`font-bold block leading-tight truncate ${
                        selectedCustomer?.id === customer.id ? 'text-[12px]' : 'text-[11px]'
                      } ${
                        selectedCustomer?.id === customer.id ? 'text-amber-950/90' : 'text-amber-400'
                      }`} style={customer.is_super ? { textShadow: selectedCustomer?.id === customer.id ? 'none' : '0 1px 3px rgba(0,0,0,0.5)' } : undefined}>{customer.super_customer_title}</span>
                    )}
                    <span className={`font-semibold block truncate leading-tight ${
                      customer.is_super
                        ? selectedCustomer?.id === customer.id ? 'text-sm' : 'text-sm'
                        : selectedCustomer?.id === customer.id ? 'text-[13px]' : 'text-xs'
                    } ${
                      selectedCustomer?.id === customer.id
                        ? customer.is_super ? 'text-white' : 'text-white'
                        : customer.is_super ? 'text-slate-100' : 'text-slate-200'
                    }`} style={{ textShadow: customer.is_super ? (selectedCustomer?.id === customer.id ? '0 2px 6px rgba(0,0,0,0.5), 0 1px 2px rgba(0,0,0,0.3)' : '0 1px 3px rgba(0,0,0,0.5)') : (selectedCustomer?.id === customer.id ? '0 2px 6px rgba(0,0,0,0.45), 0 1px 2px rgba(0,0,0,0.3)' : '0 1px 2px rgba(0,0,0,0.4)') }} title={customer.customer_name}>{customer.customer_name}</span>
                    <span className={`font-mono block truncate ${
                      customer.is_super
                        ? selectedCustomer?.id === customer.id ? 'text-[12px] font-semibold' : 'text-[10px]'
                        : selectedCustomer?.id === customer.id ? 'text-[11px]' : 'text-[9px]'
                    } ${
                      selectedCustomer?.id === customer.id
                        ? customer.is_super ? 'text-amber-950/80' : 'text-blue-100'
                        : customer.is_super ? 'text-amber-300/70' : 'text-slate-400'
                    }`} style={{ textShadow: customer.is_super ? (selectedCustomer?.id === customer.id ? 'none' : '0 1px 2px rgba(0,0,0,0.4)') : (selectedCustomer?.id === customer.id ? '0 2px 4px rgba(0,0,0,0.35), 0 1px 1px rgba(0,0,0,0.2)' : '0 1px 2px rgba(0,0,0,0.3)') }}>{customer.customer_id}</span>
                    {/* Employee display setting indicators */}
                    {(customer.employee_pin_top || customer.employee_always_visible || (customer.target_employee_ids && customer.target_employee_ids.length > 0)) && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {customer.employee_pin_top && (
                          <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                            selectedCustomer?.id === customer.id ? 'bg-white/20 text-white' : 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
                          }`}>
                            <Pin className="w-2.5 h-2.5" style={{ transform: 'rotate(-45deg)' }} />TOP
                          </span>
                        )}
                        {customer.employee_always_visible && (
                          <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                            selectedCustomer?.id === customer.id ? 'bg-white/20 text-white' : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                          }`}>
                            <Eye className="w-2.5 h-2.5" />SHOW
                          </span>
                        )}
                        {customer.target_employee_ids && customer.target_employee_ids.length > 0 && (
                          <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                            selectedCustomer?.id === customer.id ? 'bg-white/20 text-white' : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                          }`}>
                            <User className="w-2.5 h-2.5" />
                            {customer.target_employee_ids.length === 1
                              ? (employees.find(e => e.id === customer.target_employee_ids![0])?.username || 'Specific')
                              : `${customer.target_employee_ids.length} employees`}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {/* Pin/Edit/Delete on hover - bottom right corner */}
                <div className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 transition-all duration-200 flex items-center gap-0.5 z-10">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleCustomerPin(customer);
                      }}
                      className={`p-1 rounded transition-all duration-150 border ${customer.is_pinned ? 'bg-teal-600 border-teal-400 text-white' : 'bg-slate-600 border-slate-500 text-white hover:bg-teal-600 hover:border-teal-400'}`}
                      title={customer.is_pinned ? 'Unpin' : 'Pin to top'}
                    >
                      <Pin className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingCustomer(customer);
                        setCustomerForm({
                          name: customer.customer_name,
                          avatar: customer.customer_avatar,
                          isSuper: customer.is_super || false,
                          superTitle: customer.super_customer_title || '',
                          customId: customer.customer_id || '',
                          badgeType: customer.badge_type || '',
                          vipLabel: customer.vip_label || 'VIP',
                          customAvatarFile: null,
                          useCustomAvatar: !!customer.custom_avatar_url,
                          remarks: customer.remarks || '',
                        employeePinTop: customer.employee_pin_top || false,
                        employeeAlwaysVisible: customer.employee_always_visible || false,
                        targetEmployeeIds: customer.target_employee_ids || [],
                        _empSearch: ''
                        });
                      }}
                      className={`p-1 rounded transition-all duration-150 border ${selectedCustomer?.id === customer.id ? (customer.is_super ? 'bg-blue-600 border-blue-400 text-white hover:bg-blue-500' : 'bg-emerald-600 border-emerald-400 text-white hover:bg-emerald-500') : 'bg-slate-600 border-slate-500 text-white hover:bg-blue-600 hover:border-blue-500'}`}
                      title="Edit"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteCustomer(customer.id);
                      }}
                      className={`p-1 rounded transition-all duration-150 border ${selectedCustomer?.id === customer.id ? (customer.is_super ? 'bg-red-600 border-red-400 text-white hover:bg-red-500' : 'bg-red-500 border-red-300 text-white hover:bg-red-400') : 'bg-slate-600 border-slate-500 text-white hover:bg-red-600 hover:border-red-500'}`}
                      title="Delete"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
              </div>
            ))}
            {customers.length === 0 && (
              <div className="text-center py-6 text-slate-400">
                <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-[10px]">No customers yet</p>
              </div>
            )}
          </div>
        </div>

        {/* Middle: Employee List */}
        <div className="w-72 flex-shrink-0 bg-slate-900/80 backdrop-blur-xl rounded-xl border border-slate-700/50 overflow-hidden flex flex-col">
          {/* Employee Header */}
          <div className="p-2 border-b border-slate-700/50 bg-slate-800/60 space-y-1.5">
            {/* Search + Tag dropdown row */}
            <div className="flex gap-1">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#94a3b8]" />
                <input
                  type="text"
                  placeholder="Search employee..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-8 py-2 bg-[#e8ecf1] border border-[#cbd5e1] rounded-lg text-[#1e293b] placeholder-[#94a3b8] text-xs focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6] transition-all"
                />
                {searchQuery && (
                  <button type="button" onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded-full bg-slate-600/50 text-slate-300 hover:bg-slate-500/60 hover:text-white transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              {allTags.length > 0 && (
                <div className="relative flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowTagDropdown(!showTagDropdown)}
                    className={`relative flex items-center gap-1 px-2.5 py-1.5 rounded-lg border transition-all text-xs font-medium ${selectedTags.length > 0 ? 'bg-[#2563eb] border-[#2563eb] text-white' : 'bg-[#e8ecf1] border-[#cbd5e1] text-[#3b82f6] hover:bg-[#dbeafe] hover:border-[#93c5fd]'}`}
                    title="Filter by tags"
                  >
                    <Tag className="w-3.5 h-3.5" />
                    {selectedTags.length > 0 && (
                      <span className="min-w-[16px] h-4 px-1 bg-blue-500 rounded text-[9px] font-bold text-white flex items-center justify-center">{selectedTags.length}</span>
                    )}
                  </button>
                  {selectedTags.length > 0 && (
                    <button
                      type="button"
                      onClick={() => { setSelectedTags([]); setShowTagDropdown(false); }}
                      className="flex items-center gap-0.5 px-1.5 py-1.5 rounded-lg bg-[#ef4444] border border-[#ef4444] text-white hover:bg-[#dc2626] transition-all"
                      title="Clear all tags"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {showTagDropdown && (
                    <>
                      <div className="fixed inset-0 z-20" onMouseDown={() => setShowTagDropdown(false)} />
                      <div className="absolute right-0 top-full mt-1.5 z-30 bg-[#e8ecf1] border border-[#cbd5e1] rounded-xl shadow-2xl shadow-black/20 p-2 min-w-[160px] max-h-48 overflow-y-auto">
                        {allTags.map((tag) => {
                          const isSelected = selectedTags.includes(tag);
                          return (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => isSelected ? setSelectedTags(selectedTags.filter(t => t !== tag)) : setSelectedTags([...selectedTags, tag])}
                              className={`flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg cursor-pointer transition-all text-xs font-medium mb-0.5 ${
                                isSelected
                                  ? 'bg-[#2563eb] text-white shadow-sm shadow-blue-500/25 ring-1 ring-blue-400/50'
                                  : 'bg-transparent text-[#334155] hover:bg-[#dbeafe] hover:text-[#1d4ed8]'
                              }`}
                            >
                              <span className={`w-3.5 h-3.5 rounded flex items-center justify-center flex-shrink-0 border transition-colors ${
                                isSelected
                                  ? 'bg-white border-white/80'
                                  : 'border-[#94a3b8] bg-white'
                              }`}>
                                {isSelected && <Check className="w-2.5 h-2.5 text-[#2563eb]" />}
                              </span>
                              {tag}
                            </button>
                          );
                        })}
                        {selectedTags.length > 0 && (
                          <button type="button" onClick={() => { setSelectedTags([]); setShowTagDropdown(false); }} className="w-full mt-1.5 px-2 py-1.5 rounded-lg text-xs font-medium bg-[#ef4444] text-white hover:bg-[#dc2626] text-center transition-colors">Clear all</button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Filter row */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-400 tabular-nums flex-shrink-0">{filteredEmployees.length}<span className="text-slate-600">/{employees.length}</span></span>
              <div className="flex items-center gap-1 flex-1">
                <button type="button" onClick={() => setEmployeeGroupFilter('all')} className={`flex-1 px-2 py-1 rounded-lg text-[11px] font-bold transition-all border ${employeeGroupFilter === 'all' ? 'bg-blue-500 text-white border-blue-400 shadow-md shadow-blue-500/30' : 'bg-slate-800/60 border-slate-700/40 text-slate-400 hover:text-slate-200 hover:border-slate-600'}`}>All</button>
                <button type="button" onClick={() => setEmployeeGroupFilter('chatted')} className={`flex-1 px-2 py-1 rounded-lg text-[11px] font-bold transition-all border ${employeeGroupFilter === 'chatted' ? 'bg-emerald-500 text-white border-emerald-400 shadow-md shadow-emerald-500/30' : 'bg-slate-800/60 border-slate-700/40 text-slate-400 hover:text-slate-200 hover:border-slate-600'}`}>Chatted</button>
                <button type="button" onClick={() => setEmployeeGroupFilter('not_chatted')} className={`flex-1 px-2 py-1 rounded-lg text-[11px] font-bold transition-all border ${employeeGroupFilter === 'not_chatted' ? 'bg-amber-500 text-white border-amber-400 shadow-md shadow-amber-500/30' : 'bg-slate-800/60 border-slate-700/40 text-slate-400 hover:text-slate-200 hover:border-slate-600'}`}>New</button>
              </div>
            </div>
          </div>

            {/* Employee List - Scrollable */}
            <div className="flex-1 overflow-y-auto p-1.5 scrollbar-dark">
              <div className="space-y-0.5">
                {filteredEmployees.map((emp) => (
                  <button
                    type="button"
                    key={emp.id}
                    onClick={() => handleSelectEmployee(emp)}
                    className={`group w-full rounded-lg transition-all duration-150 text-left ${
                      selectedEmployee?.id === emp.id
                        ? 'px-2.5 py-2.5 bg-green-600 border border-green-400/50 shadow-md shadow-green-900/40 ring-1 ring-green-400/30'
                        : 'px-2 py-1.5 border border-transparent hover:bg-[#334155]'
                    }`}
                  >
                    <div className={`flex items-center ${selectedEmployee?.id === emp.id ? 'gap-2' : 'gap-1.5'}`}>
                      <div className="relative flex-shrink-0">
                        <div className={`rounded flex items-center justify-center ${
                          selectedEmployee?.id === emp.id ? 'w-9 h-9 bg-green-500/30' : 'w-6 h-6 bg-[#475569]'
                        }`}>
                          <User className={`${selectedEmployee?.id === emp.id ? 'w-4.5 h-4.5' : 'w-3 h-3'} ${selectedEmployee?.id === emp.id ? 'text-white' : 'text-slate-400'}`} />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <span className={`font-bold truncate ${selectedEmployee?.id === emp.id ? 'text-[15px] text-white' : 'text-[11px] text-slate-200'}`} style={selectedEmployee?.id === emp.id ? { textShadow: '0 2px 6px rgba(0,0,0,0.5), 0 1px 2px rgba(0,0,0,0.3)' } : undefined}>{emp.username}</span>

                          {selectedEmployee?.id === emp.id && <span className="ml-auto flex-shrink-0 px-1.5 py-0.5 bg-white/25 rounded text-[9px] font-bold text-white leading-relaxed" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>ACTIVE</span>}
                        </div>
                        <div className={`font-mono leading-tight ${selectedEmployee?.id === emp.id ? 'text-[12px] text-green-100' : 'text-[8px] text-slate-500'}`} style={selectedEmployee?.id === emp.id ? { textShadow: '0 2px 4px rgba(0,0,0,0.45), 0 1px 1px rgba(0,0,0,0.25)' } : undefined}>{emp.employee_id}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {filteredEmployees.length === 0 && employees.length > 0 && (
                <div className="text-center py-4 text-slate-400">
                  <Filter className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-[10px] font-medium mb-1">No matches</p>
                  <button type="button" onClick={() => { setSearchQuery(''); setSelectedTags([]); }} className="text-[10px] text-blue-400 hover:text-blue-300">Clear filters</button>
                </div>
              )}

              {employees.length === 0 && (
                <div className="text-center py-4 text-slate-400">
                  <User className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-[10px]">No employees</p>
                </div>
              )}
            </div>
          </div>

          {/* Right: Chat Interface or History View */}
          <div className="flex-1 min-w-0 flex flex-col relative">
          {/* History / Sessions Panel */}
          <div className={`absolute inset-0 transition-all duration-300 ease-in-out ${
            showHistoryView || (selectedCustomer && !selectedEmployee)
              ? 'opacity-100 translate-y-0 z-10 pointer-events-auto'
              : 'opacity-0 translate-y-2 z-0 pointer-events-none'
          }`}>
            <div className="bg-slate-900/80 backdrop-blur-xl rounded-xl border border-slate-700/50 overflow-hidden flex flex-col h-full">
              {/* Active Sessions Header */}
              <div className="bg-slate-800/60 px-4 border-b border-slate-700/50 h-[68px] flex items-center">
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-3">
                    {selectedCustomer ? (
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-xl overflow-hidden bg-slate-700/50 ring-2 ring-slate-600/50 flex-shrink-0">
                        {selectedCustomer?.custom_avatar_url ? (
                          <img src={selectedCustomer.custom_avatar_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          selectedCustomer?.customer_avatar
                        )}
                      </div>
                    ) : (
                      <div className="p-2 bg-blue-600 rounded-lg flex-shrink-0">
                        <MessageCircle className="w-5 h-5 text-white" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <h3 className="text-base font-bold text-white leading-tight truncate">{selectedCustomer ? selectedCustomer.customer_name : 'Active Sessions'}</h3>
                      {selectedCustomer?.is_super && selectedCustomer?.super_customer_title ? (
                        <p className="text-[11px] text-amber-400 font-medium leading-tight mt-0.5 truncate">{selectedCustomer?.super_customer_title}</p>
                      ) : null}
                      <p className="text-[11px] text-emerald-400 font-mono leading-tight mt-0.5">{selectedCustomer ? `CUS-${selectedCustomer.customer_id}` : 'Select a conversation to continue'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                  {historyScope === 'customer' && (
                  <div className="flex items-center gap-2">
                      {(() => {
                        const scoped = selectedEmployee ? conversationHistory.filter(h => h.employee_id === selectedEmployee.id) : conversationHistory;
                        const scopedNew = scoped.filter(h => h.unread_count > 0).length;
                        return (
                          <>
                            <button type="button" onClick={() => setHistoryFilterMode('all')} className={`relative flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${historyFilterMode !== 'new' ? 'bg-emerald-600 text-white' : 'bg-slate-700/50 text-slate-300 ring-1 ring-slate-600/50 hover:bg-slate-600/50 hover:text-white'}`}>
                              <span>All</span>
                              {scoped.length > 0 && (
                                <span className={`inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full text-[11px] font-black ${historyFilterMode !== 'new' ? 'bg-white text-emerald-700' : 'bg-slate-500/50 text-slate-200'}`}>{scoped.length}</span>
                              )}
                            </button>
                            <button type="button" onClick={() => setHistoryFilterMode('new')} className={`relative flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${historyFilterMode === 'new' ? 'bg-orange-500 text-white' : 'bg-slate-700/50 text-slate-300 ring-1 ring-slate-600/50 hover:bg-slate-600/50 hover:text-white'}`}>
                              {scopedNew > 0 && historyFilterMode !== 'new' && (
                                <span className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-orange-500 rounded-full ring-2 ring-slate-900" />
                              )}
                              <span>New</span>
                              {scopedNew > 0 ? (
                                <span className={`inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full text-[11px] font-black ${historyFilterMode === 'new' ? 'bg-white text-orange-600' : 'bg-orange-500 text-white'}`}>{scopedNew}</span>
                              ) : (
                                <span className={`inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full text-[11px] font-black ${historyFilterMode === 'new' ? 'bg-white/20 text-white/70' : 'bg-slate-500/50 text-slate-400'}`}>0</span>
                              )}
                            </button>
                          </>
                        );
                      })()}
                    </div>
                  )}

                  </div>
                </div>
              </div>

              {/* Active Sessions List */}
              <div ref={historyListRef} className="flex-1 overflow-y-auto p-2 scrollbar-dark">
                {conversationHistory.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-400">
                    <MessageCircle className="w-16 h-16 mb-4 opacity-50" />
                    <p>No active sessions</p>
                    <p className="text-xs mt-2">Start a conversation to see it here</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {conversationHistory
                      .filter((h) => {
                        if (selectedEmployee) {
                          if (h.employee_id !== selectedEmployee.id) return false;
                        }
                        if (historyFilterMode === 'new') return h.unread_count > 0;
                        return true;
                      })
                      .sort((a, b) => {
                        if (a.unread_count !== b.unread_count) {
                          return b.unread_count - a.unread_count;
                        }
                        return new Date(b.last_message_time).getTime() - new Date(a.last_message_time).getTime();
                      })
                      .map((history) => {
                        const employee = employees.find(e => e.id === history.employee_id);
                        const historyCustomer = history.customer_id ? customers.find(c => c.id === history.customer_id) : null;
                        const isSelected = selectedEmployee?.id === history.employee_id && selectedCustomer?.id === history.customer_id;
                        const cardKey = `${history.customer_id || ''}_${history.employee_id}`;
                        const lastTime = new Date(history.last_message_time);
                        const timeStr = `${lastTime.getFullYear()}/${String(lastTime.getMonth() + 1).padStart(2, '0')}/${String(lastTime.getDate()).padStart(2, '0')} ${lastTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                        const hasUnread = history.unread_count > 0;
                        const hasImg = /<img\s/i.test(history.last_message);
                        const plainMessage = history.last_message.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
                        const isPhoto = history.last_message === '__IMAGE__' || (!plainMessage && hasImg);
                        return (
                          <div key={cardKey} className="relative">
                            <button
                              type="button"
                              onClick={() => {
                                const emp = employee
                                  || allEmployeesRef.current.find(e => e.id === history.employee_id);
                                if (emp) {
                                  if (historyListRef.current) {
                                    historyScrollTopRef.current = historyListRef.current.scrollTop;
                                  }
                                  setMessages([]);
                                  setMessagesLoading(true);
                                  isInitialLoadRef.current = true;
                                  if (history.customer_id) {
                                    const cust = customers.find(c => c.id === history.customer_id)
                                      || allCustomersRef.current.find(c => c.id === history.customer_id);
                                    if (cust) setSelectedCustomer(cust);
                                  }
                                  handleSelectEmployee(emp);
                                  setFromHistoryFilterMode(historyFilterMode);
                                  setFromHistorySource(historyScope);
                                }
                              }}
                              className={`w-full px-3 py-2.5 rounded-lg transition-all duration-200 text-left group relative overflow-hidden ${
                                isSelected
                                  ? 'bg-blue-600/15 border border-blue-500/40 shadow-sm shadow-blue-500/10'
                                  : hasUnread
                                    ? 'bg-gradient-to-r from-orange-950/30 to-amber-950/20 border border-orange-500/40 hover:border-orange-400/60 shadow-sm shadow-orange-500/15'
                                    : 'bg-slate-800/30 hover:bg-slate-700/40 border border-slate-700/30 hover:border-slate-600/50'
                              }`}
                            >
                              {isSelected ? (
                                <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-blue-400" />
                              ) : hasUnread ? (
                                <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-orange-400 animate-pulse" />
                              ) : null}
                              <div className="flex items-start gap-2.5">
                                {/* Avatar */}
                                <div className="relative flex-shrink-0 mt-0.5">
                                  {history.customer_name ? (
                                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-base ring-2 overflow-hidden ${
                                      isSelected ? 'ring-blue-500/40 bg-blue-950/50' : 'ring-slate-600/30 bg-slate-700/50'
                                    }`}>
                                      {history.custom_avatar_url ? (
                                        <img src={history.custom_avatar_url} alt={history.customer_name || ''} className="w-full h-full object-cover" loading="lazy" />
                                      ) : (
                                        history.customer_avatar || <User className="w-4 h-4 text-slate-400" />
                                      )}
                                    </div>
                                  ) : (
                                    <div className={`w-9 h-9 rounded-full flex items-center justify-center ring-2 ${
                                      isSelected ? 'ring-blue-500/40 bg-blue-950/50' : 'ring-slate-600/30 bg-slate-700/50'
                                    }`}>
                                      <User className={`w-4 h-4 ${isSelected ? 'text-blue-300' : 'text-slate-400'}`} />
                                    </div>
                                  )}
                                  {hasUnread && (
                                    <div className="absolute -top-1.5 -right-1.5 min-w-[22px] h-[22px] px-1 bg-gradient-to-br from-orange-500 to-red-500 rounded-full flex items-center justify-center border-2 border-slate-900 shadow-md shadow-orange-500/40 animate-pulse">
                                      <span className="text-[10px] font-black text-white leading-none drop-shadow-sm">{history.unread_count > 99 ? '99+' : history.unread_count}</span>
                                    </div>
                                  )}
                                </div>

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-2 mb-0.5">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      {history.customer_name && (
                                        <span className={`text-[11px] font-bold truncate ${isSelected ? 'text-blue-300' : 'text-emerald-400'}`}>{history.customer_name}</span>
                                      )}
                                    </div>
                                    <span className={`text-[10px] flex-shrink-0 tabular-nums whitespace-nowrap ${
                                      hasUnread ? 'text-orange-400 font-bold' : 'text-slate-500'
                                    }`}>{timeStr}</span>
                                  </div>

                                  <div className="flex items-center gap-1.5 mb-1">
                                    <span className={`text-xs font-semibold truncate ${isSelected ? 'text-slate-200' : 'text-slate-300'}`}>{history.employee_username}</span>
                                    {history.employee_number && (
                                      <span className="text-[9px] text-slate-500 font-mono flex-shrink-0">#{history.employee_number}</span>
                                    )}
                                  </div>

                                  <p className={`text-[11px] leading-relaxed truncate ${
                                    hasUnread ? 'text-orange-200 font-semibold' : 'text-slate-500'
                                  }`}>{hasUnread && <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-400 mr-1 mb-px" />}{isPhoto ? <span className="inline-flex items-center gap-1"><Image className="w-3 h-3" />Photo</span> : (plainMessage || 'No messages')}</p>
                                </div>
                              </div>
                            </button>
                          </div>
                        );
                      })}
                    {historyFilterMode === 'new' && conversationHistory.filter(h => h.unread_count > 0).length === 0 && (
                      <div className="text-center py-6 text-slate-500">
                        <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p className="text-[10px]">No new messages</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          {/* Chat Panel */}
          <div className={`absolute inset-0 transition-all duration-300 ease-in-out ${
            selectedEmployee && selectedCustomer && !showHistoryView
              ? 'opacity-100 translate-y-0 z-10 pointer-events-auto'
              : 'opacity-0 translate-y-2 z-0 pointer-events-none'
          }`}>
            <div className="bg-slate-900/80 backdrop-blur-xl rounded-xl border border-slate-700/50 overflow-hidden flex flex-col h-full">
              {/* Chat Header */}
              <div className="bg-slate-800/60 px-4 border-b border-slate-700/50 h-[68px] flex items-center">
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        if (fromHistorySource === 'all') {
                          pendingScrollRestoreRef.current = true;
                          setConversationHistory(allConversationHistory);
                          setSelectedEmployee(null);
                          setSelectedCustomer(null);
                          setShowHistoryView(true);
                          setHistoryFilterMode(fromHistoryFilterMode);
                          setHistoryScope('all');
                          loadAllConversationHistory();
                        } else if (fromHistorySource === 'customer') {
                          pendingScrollRestoreRef.current = true;
                          setSelectedEmployee(null);
                          setShowHistoryView(true);
                          setHistoryFilterMode(fromHistoryFilterMode);
                          setHistoryScope('customer');
                          loadConversationHistory();
                        } else {
                          setSelectedEmployee(null);
                        }
                      }}
                      className="flex items-center gap-1 px-2 py-1.5 bg-orange-600 hover:bg-orange-500 text-white rounded-md transition-colors border border-orange-400/60 shadow-sm shadow-orange-600/30 text-xs font-medium flex-shrink-0"
                      title="Back"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Back</span>
                    </button>
                    <div className="flex items-center gap-2">
                      <div className="w-11 h-11 rounded-full flex items-center justify-center text-xl overflow-hidden bg-slate-700/50 border border-slate-600/50 flex-shrink-0">
                        {selectedCustomer?.custom_avatar_url ? (
                          <img src={selectedCustomer?.custom_avatar_url || ''} alt={selectedCustomer?.customer_name} className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          selectedCustomer?.customer_avatar
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm text-slate-100 font-bold leading-tight truncate">{selectedCustomer?.customer_name}</div>
                        {selectedCustomer?.is_super && selectedCustomer?.super_customer_title ? (
                          <div className="text-[11px] text-amber-400 font-medium leading-tight mt-0.5 truncate">{selectedCustomer?.super_customer_title}</div>
                        ) : null}
                        <div className="text-[10px] font-mono text-emerald-400 leading-tight mt-0.5">CUS-{selectedCustomer?.customer_id}</div>
                      </div>
                    </div>
                    <div className="h-8 w-px bg-slate-600/50 mx-1 flex-shrink-0"></div>
                    <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
                      <User className="w-5 h-5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-white text-sm font-bold leading-tight truncate">{selectedEmployee?.username}</div>
                      <div className="text-[11px] text-blue-400 leading-tight mt-0.5">ID: {selectedEmployee?.employee_id}</div>
                    </div>
                    {serviceTicketNumber && (
                      <div className="flex items-center gap-1.5 ml-2 px-2.5 py-1.5 bg-gradient-to-r from-blue-600/20 to-cyan-600/15 border border-blue-500/40 rounded-lg flex-shrink-0">
                        <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse"></div>
                        <span className="text-[11px] text-blue-300 font-mono font-bold tracking-wide">{serviceTicketNumber}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {(() => {
                      const totalUnread = conversationHistory.reduce((sum, h) => sum + h.unread_count, 0);
                      return (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => { setSelectedEmployee(null); setShowHistoryView(true); setHistoryFilterMode('all'); setFromHistorySource('none'); setHistoryScope('customer'); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 border border-blue-400/60 rounded-lg text-xs font-bold text-white shadow-md shadow-blue-600/30 hover:shadow-blue-500/40 transition-all"
                            title="History messages"
                          >
                            <Clock className="w-4 h-4" />
                            <span>History</span>
                            {conversationHistory.length > 0 && <span className="px-1.5 py-px bg-white/20 rounded text-[10px] font-black">{conversationHistory.length}</span>}
                          </button>
                          {totalUnread > 0 && (
                            <div className="absolute -top-2.5 -right-2.5 min-w-[22px] h-[22px] px-1 bg-orange-500 rounded-full flex items-center justify-center animate-pulse border-2 border-slate-900 shadow-lg shadow-orange-500/40">
                              <span className="text-[11px] font-black text-white">{totalUnread > 99 ? '99+' : totalUnread}</span>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {messages.length > 0 && (
                      <button
                        type="button"
                        onClick={handleDeleteConversation}
                        className="flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg border border-red-400/60 shadow-md shadow-red-600/30 hover:shadow-red-500/40 transition-all text-xs font-bold"
                        title="Clear Chat"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>Clear</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Messages */}
              <div ref={messagesContainerCallbackRef} className="flex-1 overflow-y-auto flex flex-col-reverse scrollbar-dark" style={{
                background: 'linear-gradient(180deg, #1a2332 0%, #15202e 40%, #1a2332 100%)',
                backgroundImage: `linear-gradient(180deg, #1a2332 0%, #15202e 40%, #1a2332 100%), radial-gradient(circle at 20% 50%, rgba(59,130,246,0.04) 0%, transparent 50%), radial-gradient(circle at 80% 30%, rgba(16,185,129,0.04) 0%, transparent 50%)`
              }}>
                <div className="p-4 space-y-3 mb-auto">
                {messages.length === 0 ? (
                  !messagesLoading && (
                  <div className="flex flex-col items-center justify-center h-full text-slate-400">
                    <MessageCircle className="w-16 h-16 mb-4 opacity-30 text-slate-500" />
                    <p className="text-slate-400 font-medium">No messages yet</p>
                    <p className="text-sm mt-2 text-slate-500">Send the first message</p>
                  </div>
                  )
                ) : (
                  <>
                {loadingOlderMessages && (
                  <div className="flex justify-center py-3">
                    <div className="w-5 h-5 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
                  </div>
                )}
                {messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex group ${msg.sender_type === 'customer' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div className={`flex items-start gap-2 min-w-0 ${editingMessageId === msg.id ? 'max-w-[90%]' : 'max-w-[80%]'}`}>
                          {/* Action buttons for customer (admin-sent) messages */}
                          {msg.sender_type === 'customer' && editingMessageId !== msg.id && msg.message_type !== 'tip' && msg.message_type !== 'rating_request' && msg.message_type !== 'rating_result' && (
                            <div className="flex flex-col gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-all">
                              {msg.message_type !== 'rich_card' && (
                                <button
                                  type="button"
                                  onClick={() => handleStartEdit(msg)}
                                  className="p-1 bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 rounded transition-all"
                                  title={msg.message_type === 'image' ? 'Replace image' : 'Edit message'}
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleDeleteMessage(msg.id)}
                                className="p-1 bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded transition-all"
                                title="Delete message"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                          {/* Action buttons for employee messages */}
                          {msg.sender_type === 'employee' && editingMessageId !== msg.id && msg.message_type !== 'tip' && msg.message_type !== 'rating_request' && msg.message_type !== 'rating_result' && (
                            <div className="flex flex-col gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-all order-last">
                              {msg.message_type !== 'rich_card' && (
                              <button
                                type="button"
                                onClick={() => handleStartEdit(msg)}
                                className="p-1 bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 rounded transition-all"
                                title={msg.message_type === 'image' ? 'Replace image' : 'Edit message'}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleDeleteMessage(msg.id)}
                                className="p-1 bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded transition-all"
                                title="Delete message"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                          {(msg.message_type === 'tip' || msg.message_type === 'rich_card') ? (
                            <div className="relative z-10">
                              {renderMessageContent(msg)}
                              <div className={`text-[10px] mt-1.5 ${msg.sender_type === 'customer' ? 'text-slate-500 text-right' : 'text-slate-500'}`}>
                                {new Date(msg.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) + ' ' + new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </div>
                              {msg.sender_type === 'customer' && (
                                <div className={`flex items-center justify-end gap-1 mt-0.5 text-[10px] ${
                                  msg.is_read ? 'text-emerald-500' : 'text-slate-400'
                                }`}>
                                  {msg.is_read ? (
                                    <>
                                      <CheckCheck className="w-3 h-3" />
                                      <span>Read {msg.read_at ? new Date(msg.read_at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' + new Date(msg.read_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                                    </>
                                  ) : (
                                    <>
                                      <Eye className="w-3 h-3" />
                                      <span>Unread</span>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : msg.message_type === 'image' && msg.image_url ? (
                          <div className="rounded-2xl overflow-hidden shadow-sm" style={{ boxShadow: msg.sender_type === 'customer' ? '0 2px 8px rgba(0,0,0,0.08)' : '0 2px 8px rgba(59,130,246,0.3)' }}>
                            <div className="relative z-10">
                              {renderMessageContent(msg)}
                              {replacingImageMsgId === msg.id && (
                                <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-2 rounded-2xl">
                                  <div className="w-8 h-8 border-3 border-white/30 border-t-white rounded-full animate-spin" />
                                  <span className="text-white text-xs font-medium">Replacing...</span>
                                </div>
                              )}
                            </div>
                            <div className={`text-[10px] px-3 py-1.5 ${msg.sender_type === 'customer' ? 'text-slate-400 text-right bg-white' : 'text-white/60 bg-blue-500'}`}>
                              {new Date(msg.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) + ' ' + new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                            {msg.sender_type === 'customer' && (
                              <div className={`flex items-center justify-end gap-1 px-3 pb-1.5 text-[10px] ${
                                msg.is_read ? 'text-emerald-500' : 'text-slate-400'
                              } ${msg.sender_type === 'customer' ? 'bg-white' : 'bg-blue-500'}`}>
                                {msg.is_read ? (
                                  <>
                                    <CheckCheck className="w-3 h-3" />
                                    <span>Read {msg.read_at ? new Date(msg.read_at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' + new Date(msg.read_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                                  </>
                                ) : (
                                  <>
                                    <Eye className="w-3 h-3" />
                                    <span>Unread</span>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                          ) : (
                          <div
                            className={`relative px-4 py-3 shadow-sm ${
                              editingMessageId === msg.id
                                ? 'bg-white text-slate-800 rounded-2xl border-2 border-blue-400 ring-2 ring-blue-100'
                                : msg.sender_type === 'customer'
                                  ? 'bg-white text-slate-800 rounded-2xl rounded-tr-md border border-slate-200/60'
                                  : 'bg-blue-500 text-white rounded-2xl rounded-tl-md'
                            }`}
                            style={editingMessageId === msg.id ? {
                              boxShadow: '0 0 0 2px rgba(96,165,250,0.15)'
                            } : msg.sender_type === 'customer' ? {
                              boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
                            } : {
                              boxShadow: '0 2px 8px rgba(59,130,246,0.3)'
                            }}
                          >
                            <div className="relative z-10">
                              <div className={`text-xs font-semibold flex items-center gap-1.5 pb-1.5 mb-1.5 ${
                                msg.sender_type === 'customer'
                                  ? 'border-b border-slate-200'
                                  : 'border-b border-white/25'
                              }`}>
                                {msg.sender_type === 'customer' && selectedCustomer?.is_super && (
                                  <span className="text-[10px]">
                                    {selectedCustomer.badge_type === 'diamond' ? '💎' : selectedCustomer.badge_type === 'crown' ? '👑' : selectedCustomer.badge_type === 'star' ? '⭐' : selectedCustomer.badge_type === 'vip' ? '🏆' : '✨'}
                                  </span>
                                )}
                                <span className={msg.sender_type === 'employee' ? 'text-white' : selectedCustomer?.is_super ? 'text-amber-600 font-bold' : 'text-blue-600 font-semibold'}>{msg.sender_type === 'customer' ? selectedCustomer?.customer_name : selectedEmployee?.username}</span>
                                {msg.sender_type === 'customer' && selectedCustomer?.is_super && selectedCustomer?.super_customer_title && (
                                  <span className="text-[9px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full font-bold">{selectedCustomer?.super_customer_title}</span>
                                )}
                              </div>
                              {editingMessageId === msg.id ? (
                                <div className="min-w-[320px] max-w-full">
                                  <input
                                    ref={editFileInputRef}
                                    type="file"
                                    accept="image/*"
                                    onChange={handleEditImageSelect}
                                    className="hidden"
                                  />
                                  <div className="rounded-xl border border-slate-300 bg-white overflow-hidden focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400/40 transition-all shadow-sm">
                                    <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-slate-200 bg-slate-50/80">
                                      <button type="button" onMouseDown={(e) => { e.preventDefault(); applyEditFormat('bold'); }} className={`p-1.5 rounded-md transition-all ${isEditBoldActive ? 'bg-blue-500 text-white shadow-sm shadow-blue-500/30' : 'text-slate-500 hover:bg-slate-200 hover:text-slate-800'}`} title="Bold (Ctrl+B)">
                                        <Bold className="w-3.5 h-3.5" strokeWidth={2.5} />
                                      </button>
                                      <button type="button" onMouseDown={(e) => { e.preventDefault(); applyEditFormat('underline'); }} className={`p-1.5 rounded-md transition-all ${isEditUnderlineActive ? 'bg-blue-500 text-white shadow-sm shadow-blue-500/30' : 'text-slate-500 hover:bg-slate-200 hover:text-slate-800'}`} title="Underline (Ctrl+U)">
                                        <Underline className="w-3.5 h-3.5" strokeWidth={2.5} />
                                      </button>
                                      <button type="button" onMouseDown={(e) => { e.preventDefault(); applyEditFormat('strikeThrough'); }} className="p-1.5 rounded-md transition-all text-slate-500 hover:bg-slate-200 hover:text-slate-800" title="Strikethrough">
                                        <Strikethrough className="w-3.5 h-3.5" strokeWidth={2.5} />
                                      </button>
                                      <div className="w-px h-5 bg-slate-200 mx-1" />
                                      <div className="flex items-center bg-slate-100 rounded-md p-0.5 gap-0.5">
                                        <button type="button" onMouseDown={(e) => { e.preventDefault(); setEditEditorFontSize(editEditorFontSize === 'normal' ? null : 'normal'); applyEditFormat('fontSize', '3'); }} className={`px-1.5 py-0.5 text-[10px] rounded transition-all ${editEditorFontSize === 'normal' ? 'bg-blue-500 text-white font-bold shadow-sm shadow-blue-500/30' : 'text-slate-400 font-semibold hover:text-slate-700 hover:bg-slate-200'}`} title="Normal size">A</button>
                                        <button type="button" onMouseDown={(e) => { e.preventDefault(); setEditEditorFontSize(editEditorFontSize === 'large' ? null : 'large'); applyEditFormat('fontSize', '5'); }} className={`px-1.5 py-0.5 text-xs rounded transition-all ${editEditorFontSize === 'large' ? 'bg-blue-500 text-white font-bold shadow-sm shadow-blue-500/30' : 'text-slate-400 font-semibold hover:text-slate-700 hover:bg-slate-200'}`} title="Large size">A</button>
                                        <button type="button" onMouseDown={(e) => { e.preventDefault(); setEditEditorFontSize(editEditorFontSize === 'xlarge' ? null : 'xlarge'); applyEditFormat('fontSize', '7'); }} className={`px-1.5 py-0.5 text-sm rounded transition-all ${editEditorFontSize === 'xlarge' ? 'bg-blue-500 text-white font-bold shadow-sm shadow-blue-500/30' : 'text-slate-400 font-bold hover:text-slate-700 hover:bg-slate-200'}`} title="Extra large size">A</button>
                                      </div>
                                      <div className="relative">
                                        <button
                                          type="button"
                                          onMouseDown={(e) => { e.preventDefault(); setShowBgColorPicker(showBgColorPicker === 'edit' ? null : 'edit'); }}
                                          className={`p-1.5 rounded-md transition-all ${showBgColorPicker === 'edit' ? 'bg-yellow-100 text-yellow-700' : 'text-slate-500 hover:bg-slate-200 hover:text-slate-800'}`}
                                          title="Background color"
                                        >
                                          <Highlighter className="w-3.5 h-3.5" strokeWidth={2.5} />
                                        </button>
                                        {showBgColorPicker === 'edit' && (
                                          <>
                                            <div className="fixed inset-0 z-40" onMouseDown={() => setShowBgColorPicker(null)} />
                                            <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-50 p-2 grid grid-cols-4 gap-1.5 w-[140px]">
                                              {BG_COLORS.map((c) => (
                                                <button key={c.color} type="button" onMouseDown={(e) => { e.preventDefault(); applyBgColor(c.color, 'edit'); }} className="w-7 h-7 rounded-md border border-slate-200 hover:scale-110 transition-transform" style={{ backgroundColor: c.color }} title={c.label} />
                                              ))}
                                              <button type="button" onMouseDown={(e) => { e.preventDefault(); applyBgColor(null, 'edit'); }} className="col-span-4 mt-1.5 px-2 py-1.5 text-[11px] font-bold text-red-500 bg-red-50 border border-red-200 hover:bg-red-100 hover:border-red-300 rounded-md transition-all text-center tracking-wide">Clear</button>
                                            </div>
                                          </>
                                        )}
                                      </div>
                                      <div className="w-px h-5 bg-slate-200 mx-1" />
                                      <button
                                        type="button"
                                        onClick={() => editFileInputRef.current?.click()}
                                        disabled={uploadingEditImage}
                                        className="p-1.5 hover:bg-slate-200 disabled:opacity-50 rounded-md text-slate-500 hover:text-slate-800 transition-colors"
                                        title="Upload image"
                                      >
                                        {uploadingEditImage ? (
                                          <div className="w-3.5 h-3.5 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin" />
                                        ) : (
                                          <Image className="w-3.5 h-3.5" strokeWidth={2.5} />
                                        )}
                                      </button>
                                    </div>
                                    <div
                                      ref={editEditorRef}
                                      contentEditable
                                      suppressContentEditableWarning
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' && e.ctrlKey) {
                                          e.preventDefault();
                                          handleSaveEdit();
                                        }
                                        if (e.key === 'Escape') {
                                          handleCancelEdit();
                                        }
                                      }}
                                      onKeyUp={updateEditFormatState}
                                      onMouseUp={updateEditFormatState}
                                      onSelect={updateEditFormatState}
                                      className="min-h-[60px] max-h-[260px] overflow-y-auto px-3 py-2.5 text-sm text-slate-800 focus:outline-none chat-rich-content"
                                      style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                                    />
                                  </div>
                                  <div className="flex items-center gap-2 mt-2">
                                    <button
                                      type="button"
                                      onClick={handleSaveEdit}
                                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm shadow-blue-500/25"
                                    >
                                      <Check className="w-3 h-3" />
                                      Save
                                    </button>
                                    <button
                                      type="button"
                                      onClick={handleCancelEdit}
                                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold rounded-lg transition-colors"
                                    >
                                      Cancel
                                    </button>
                                    <span className="text-[10px] text-slate-400 ml-auto">Ctrl+Enter / Esc</span>
                                  </div>
                                </div>
                              ) : (
                                renderMessageContent(msg)
                              )}
                              <div className={`text-[10px] mt-1.5 ${
                                msg.sender_type === 'customer'
                                  ? 'text-slate-400 text-right'
                                  : 'text-white/60'
                              }`}>
                                {new Date(msg.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) + ' ' + new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </div>
                              {msg.sender_type === 'customer' && (
                                <div className={`flex items-center justify-end gap-1 mt-0.5 text-[10px] ${
                                  msg.is_read ? 'text-emerald-500' : 'text-slate-400'
                                }`}>
                                  {msg.is_read ? (
                                    <>
                                      <CheckCheck className="w-3 h-3" />
                                      <span>Read {msg.read_at ? new Date(msg.read_at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' + new Date(msg.read_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                                    </>
                                  ) : (
                                    <>
                                      <Eye className="w-3 h-3" />
                                      <span>Unread</span>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                          )}
                        </div>
                      </div>
                    ))}

                    <div ref={messagesEndRef} />
                  </>
                )}
                </div>
              </div>

              {/* Message Input */}
              <form onSubmit={handleSendMessage} className="px-3 py-2.5 border-t border-slate-700/50 relative">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageSelect}
                  className="hidden"
                />
                <input
                  ref={replaceImageInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleReplaceImageSelect}
                  className="hidden"
                />
                {showTemplatePopup && (() => {
                  const filteredTemplates = messageTemplates.filter(t => t.content_type !== 'rich_card');
                  return (
                  <>
                    <div className="fixed inset-0 z-40" onMouseDown={() => setShowTemplatePopup(false)} />
                    <div className="absolute bottom-full left-0 right-0 mb-2 px-1 z-50">
                      <div className="bg-slate-700 border border-slate-500/40 rounded-xl shadow-2xl shadow-black/40 max-h-[340px] overflow-hidden flex flex-col">
                        <div className="px-3.5 py-2.5 border-b border-slate-600/60 flex items-center justify-between flex-shrink-0">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-lg bg-teal-500 flex items-center justify-center shadow-sm shadow-teal-600/30">
                              <Zap className="w-3 h-3 text-white" />
                            </div>
                            <span className="text-[13px] font-bold text-slate-100 tracking-tight">Quick Send</span>
                            <span className="min-w-[20px] h-5 flex items-center justify-center text-[11px] text-white font-bold bg-teal-500 px-1.5 rounded-full shadow-sm shadow-teal-600/30">{filteredTemplates.length}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => { setShowTemplatePopup(false); setTemplateManagerMode('richtext'); setShowTemplateManager(true); loadTemplates(); }}
                              className="flex items-center gap-1 text-[11px] text-white font-semibold px-2.5 py-1 rounded-lg bg-teal-600 hover:bg-teal-500 border border-teal-500/50 hover:border-teal-400/60 transition-all duration-150 shadow-sm shadow-teal-700/30"
                            >
                              <Pencil className="w-3 h-3" />
                              Manage
                            </button>
                            <button type="button" onClick={() => setShowTemplatePopup(false)} className="p-1 hover:bg-slate-600 rounded-md transition-colors">
                              <X className="w-3.5 h-3.5 text-slate-400 hover:text-slate-200" />
                            </button>
                          </div>
                        </div>
                        {filteredTemplates.length > 0 ? (
                          <div className="overflow-y-auto p-2.5 space-y-2 scrollbar-dark bg-slate-800/50">
                            {filteredTemplates.map((tpl) => {
                              return (
                                <button
                                  key={tpl.id}
                                  type="button"
                                  onClick={async () => {
                                    if (editorRef.current) {
                                      const fullContent = await fetchTemplateContent(tpl.id);
                                      if (!fullContent) return;
                                      const content = tpl.content_type === 'richtext' ? fullContent : fullContent.replace(/\n/g, '<br>');
                                      editorRef.current.innerHTML = content;
                                      const hasText = (editorRef.current.textContent || '').trim().length > 0;
                                      const hasImgs = editorRef.current.querySelector('img') !== null;
                                      setMessageInput(hasText ? editorRef.current.textContent! : hasImgs ? '_img_' : '');
                                    }
                                    setShowTemplatePopup(false);
                                  }}
                                  className={`w-full text-left px-3 py-2.5 rounded-xl transition-all duration-150 group border shadow-sm ${
                                    tpl.content_type === 'rich_card'
                                      ? 'bg-gradient-to-r from-blue-900/50 to-indigo-900/40 border-blue-500/40 hover:border-blue-400/60 hover:from-blue-800/60 hover:to-indigo-800/50 shadow-blue-900/20'
                                      : tpl.is_pinned
                                      ? 'bg-gradient-to-r from-teal-800/60 to-teal-900/40 border-teal-500/40 hover:border-teal-400/60 hover:from-teal-800/80 hover:to-teal-800/50 shadow-teal-900/20'
                                      : 'bg-slate-600/90 border-slate-500/40 hover:bg-slate-500/80 hover:border-slate-400/50 shadow-slate-900/20'
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    {tpl.is_pinned && (
                                      <div className="w-5 h-5 rounded bg-teal-500/20 flex items-center justify-center flex-shrink-0">
                                        <Pin className="w-2.5 h-2.5 text-teal-400" />
                                      </div>
                                    )}
                                    <span className={`text-[13px] font-semibold truncate flex-1 ${tpl.is_pinned ? 'text-teal-200 group-hover:text-teal-100' : 'text-slate-200 group-hover:text-white'}`}>{tpl.name}</span>
                                    {tpl.content_type === 'richtext' && (
                                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 flex-shrink-0">Rich</span>
                                    )}
                                    <div className="w-5 h-5 rounded-full bg-teal-500/0 group-hover:bg-teal-500 flex items-center justify-center flex-shrink-0 transition-all opacity-0 group-hover:opacity-100" title="Fill into input">
                                      <Pencil className="w-2.5 h-2.5 text-white" />
                                    </div>
                                  </div>
                                  <div className={`mt-1 ${tpl.is_pinned ? 'pl-7' : ''}`}>
                                    <p className="text-[11px] text-slate-400 group-hover:text-slate-300 truncate leading-relaxed">{tpl.name}</p>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="p-6 text-center">
                            <div className="w-10 h-10 rounded-xl bg-slate-600 flex items-center justify-center mx-auto mb-2.5">
                              <FileText className="w-5 h-5 text-slate-400" />
                            </div>
                            <p className="text-sm text-slate-200 mb-1 font-semibold">No templates yet</p>
                            <p className="text-[11px] text-slate-400 mb-3">Create templates for quick replies</p>
                            <button
                              type="button"
                              onClick={() => { setShowTemplatePopup(false); setTemplateManagerMode('richtext'); setShowTemplateManager(true); loadTemplates(); }}
                              className="text-xs text-white font-semibold px-3.5 py-1.5 rounded-lg bg-teal-500 hover:bg-teal-600 transition-colors shadow-sm shadow-teal-600/30"
                            >
                              Create Template
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                  );
                })()}
                {showRichCardPopup && (() => {
                  const richCardTemplates = messageTemplates.filter(t => t.content_type === 'rich_card');
                  return (
                  <>
                    <div className="fixed inset-0 z-40" onMouseDown={() => setShowRichCardPopup(false)} />
                    <div className="absolute bottom-full left-0 right-0 mb-2 px-1 z-50">
                      <div className="bg-slate-700 border border-blue-500/40 rounded-xl shadow-2xl shadow-black/40 max-h-[340px] overflow-hidden flex flex-col">
                        <div className="px-3.5 py-2.5 border-b border-slate-600/60 flex items-center justify-between flex-shrink-0">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-lg bg-blue-500 flex items-center justify-center shadow-sm shadow-blue-600/30">
                              <Megaphone className="w-3 h-3 text-white" />
                            </div>
                            <span className="text-[13px] font-bold text-slate-100 tracking-tight">Rich Card</span>
                            <span className="min-w-[20px] h-5 flex items-center justify-center text-[11px] text-white font-bold bg-blue-500 px-1.5 rounded-full shadow-sm shadow-blue-600/30">{richCardTemplates.length}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => { setShowRichCardPopup(false); setTemplateManagerMode('rich_card'); setTemplateForm({ name: '', title: '', subtitle: '', content: '', content_type: 'rich_card' }); setShowTemplateManager(true); loadTemplates(); }}
                              className="flex items-center gap-1 text-[11px] text-white font-semibold px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 border border-blue-500/50 hover:border-blue-400/60 transition-all duration-150 shadow-sm shadow-blue-700/30"
                            >
                              <Pencil className="w-3 h-3" />
                              Manage
                            </button>
                            <button type="button" onClick={() => setShowRichCardPopup(false)} className="p-1 hover:bg-slate-600 rounded-md transition-colors">
                              <X className="w-3.5 h-3.5 text-slate-400 hover:text-slate-200" />
                            </button>
                          </div>
                        </div>
                        {richCardTemplates.length > 0 ? (
                          <div className="overflow-y-auto p-2.5 space-y-2 scrollbar-dark bg-slate-800/50">
                            {richCardTemplates.map((tpl) => {
                              return (
                                <button
                                  key={tpl.id}
                                  type="button"
                                  onClick={async () => {
                                    if (!selectedCustomer || !selectedEmployee || sendingRichCard) return;
                                    setSendingRichCard(true);
                                    setShowRichCardPopup(false);
                                    const optimisticId = `optimistic-${Date.now()}`;
                                    const optimisticMsg: Message = {
                                      id: optimisticId,
                                      customer_id: selectedCustomer.id,
                                      employee_id: selectedEmployee.id,
                                      sender_type: 'customer',
                                      message_content: tpl.name,
                                      message_type: 'rich_card',
                                      title: tpl.title || null,
                                      subtitle: tpl.subtitle || null,
                                      source_type: 'ccc_service',
                                      created_at: new Date().toISOString(),
                                      is_read: true,
                                    };
                                    setMessages(prev => [...prev, optimisticMsg]);
                                    try {
                                      const { data: msgRow, error: msgErr } = await supabase.from('customer_employee_conversations').insert({
                                        customer_id: selectedCustomer.id,
                                        employee_id: selectedEmployee.id,
                                        sender_type: 'customer',
                                        message_content: tpl.name || '',
                                        message_type: 'rich_card',
                                        title: tpl.title || null,
                                        subtitle: tpl.subtitle || null,
                                        source_type: 'ccc_service',
                                        source_template_id: tpl.id,
                                      }).select('id').single();
                                      if (msgErr) {
                                        setMessages(prev => prev.filter(m => m.id !== optimisticId));
                                        setNotification({ type: 'error', text: msgErr.message || 'Failed to send rich card' });
                                      } else {
                                        loadMessages();
                                        loadConversationHistory();
                                      }
                                    } catch (err: any) {
                                      setMessages(prev => prev.filter(m => m.id !== optimisticId));
                                      setNotification({ type: 'error', text: err.message || 'Failed to send rich card' });
                                    } finally { setSendingRichCard(false); }
                                  }}
                                  className="w-full text-left px-3 py-2.5 rounded-xl transition-all duration-150 group border shadow-sm bg-gradient-to-r from-blue-900/50 to-indigo-900/40 border-blue-500/40 hover:border-blue-400/60 hover:from-blue-800/60 hover:to-indigo-800/50 shadow-blue-900/20"
                                >
                                  <div className="flex items-center gap-2">
                                    {tpl.is_pinned && (
                                      <div className="w-5 h-5 rounded bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                                        <Pin className="w-2.5 h-2.5 text-blue-400" />
                                      </div>
                                    )}
                                    <span className="text-[13px] font-semibold truncate flex-1 text-blue-200 group-hover:text-blue-100">{tpl.name}</span>
                                    {tpl.title && (
                                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-300 border border-blue-400/30 flex-shrink-0 truncate max-w-[120px]">{tpl.title}</span>
                                    )}
                                    <div className="w-5 h-5 rounded-full bg-blue-500/0 group-hover:bg-blue-500 flex items-center justify-center flex-shrink-0 transition-all opacity-0 group-hover:opacity-100" title="Send directly">
                                      <Send className="w-2.5 h-2.5 text-white" />
                                    </div>
                                  </div>

                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="p-6 text-center">
                            <div className="w-10 h-10 rounded-xl bg-slate-600 flex items-center justify-center mx-auto mb-2.5">
                              <Megaphone className="w-5 h-5 text-slate-400" />
                            </div>
                            <p className="text-sm text-slate-200 mb-1 font-semibold">No Rich Card templates</p>
                            <p className="text-[11px] text-slate-400 mb-3">Create rich card templates to send directly</p>
                            <button
                              type="button"
                              onClick={() => { setShowRichCardPopup(false); setTemplateManagerMode('rich_card'); setTemplateForm({ name: '', title: '', subtitle: '', content: '', content_type: 'rich_card' }); setShowTemplateManager(true); loadTemplates(); }}
                              className="text-xs text-white font-semibold px-3.5 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 transition-colors shadow-sm shadow-blue-600/30"
                            >
                              Create Rich Card
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                  );
                })()}
                <div className="flex gap-2 items-end">
                  <div className="flex-1 min-w-0 rounded-xl border border-slate-300 bg-white focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400/40 transition-all shadow-sm">
                    {/* Toolbar row */}
                    <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-slate-200 bg-slate-50/80 flex-wrap">
                      <button type="button" onMouseDown={(e) => { e.preventDefault(); applyFormat('bold'); }} className={`p-1.5 rounded-md transition-all ${isBoldActive ? 'bg-blue-500 text-white shadow-sm shadow-blue-500/30' : 'text-slate-500 hover:bg-slate-200 hover:text-slate-800'}`} title="Bold (Ctrl+B)">
                        <Bold className="w-3.5 h-3.5" strokeWidth={2.5} />
                      </button>
                      <button type="button" onMouseDown={(e) => { e.preventDefault(); applyFormat('underline'); }} className={`p-1.5 rounded-md transition-all ${isUnderlineActive ? 'bg-blue-500 text-white shadow-sm shadow-blue-500/30' : 'text-slate-500 hover:bg-slate-200 hover:text-slate-800'}`} title="Underline (Ctrl+U)">
                        <Underline className="w-3.5 h-3.5" strokeWidth={2.5} />
                      </button>
                      <button type="button" onMouseDown={(e) => { e.preventDefault(); applyFormat('strikeThrough'); }} className={`p-1.5 rounded-md transition-all text-slate-500 hover:bg-slate-200 hover:text-slate-800`} title="Strikethrough">
                        <Strikethrough className="w-3.5 h-3.5" strokeWidth={2.5} />
                      </button>
                      <div className="w-px h-5 bg-slate-200 mx-1" />
                      <div className="flex items-center bg-slate-100 rounded-md p-0.5 gap-0.5">
                        <button type="button" onMouseDown={(e) => { e.preventDefault(); setEditorFontSize(editorFontSize === 'normal' ? null : 'normal'); applyFormat('fontSize', '3'); }} className={`px-1.5 py-0.5 text-[10px] rounded transition-all ${editorFontSize === 'normal' ? 'bg-blue-500 text-white font-bold shadow-sm shadow-blue-500/30' : 'text-slate-400 font-semibold hover:text-slate-700 hover:bg-slate-200'}`} title="Normal size">A</button>
                        <button type="button" onMouseDown={(e) => { e.preventDefault(); setEditorFontSize(editorFontSize === 'large' ? null : 'large'); applyFormat('fontSize', '5'); }} className={`px-1.5 py-0.5 text-xs rounded transition-all ${editorFontSize === 'large' ? 'bg-blue-500 text-white font-bold shadow-sm shadow-blue-500/30' : 'text-slate-400 font-semibold hover:text-slate-700 hover:bg-slate-200'}`} title="Large size">A</button>
                        <button type="button" onMouseDown={(e) => { e.preventDefault(); setEditorFontSize(editorFontSize === 'xlarge' ? null : 'xlarge'); applyFormat('fontSize', '7'); }} className={`px-1.5 py-0.5 text-sm rounded transition-all ${editorFontSize === 'xlarge' ? 'bg-blue-500 text-white font-bold shadow-sm shadow-blue-500/30' : 'text-slate-400 font-bold hover:text-slate-700 hover:bg-slate-200'}`} title="Extra large size">A</button>
                      </div>
                      <div className="relative">
                        <button
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); setShowBgColorPicker(showBgColorPicker === 'main' ? null : 'main'); }}
                          className={`p-1.5 rounded-md transition-all ${showBgColorPicker === 'main' ? 'bg-yellow-100 text-yellow-700' : 'text-slate-500 hover:bg-slate-200 hover:text-slate-800'}`}
                          title="Background color"
                        >
                          <Highlighter className="w-3.5 h-3.5" strokeWidth={2.5} />
                        </button>
                        {showBgColorPicker === 'main' && (
                          <>
                            <div className="fixed inset-0 z-40" onMouseDown={() => setShowBgColorPicker(null)} />
                            <div className="absolute bottom-full left-0 mb-1 bg-white border border-slate-200 rounded-lg shadow-xl z-50 p-2 grid grid-cols-4 gap-1.5 w-[140px]">
                              {BG_COLORS.map((c) => (
                                <button key={c.color} type="button" onMouseDown={(e) => { e.preventDefault(); applyBgColor(c.color, 'main'); }} className="w-7 h-7 rounded-md border border-slate-200 hover:scale-110 transition-transform" style={{ backgroundColor: c.color }} title={c.label} />
                              ))}
                              <button type="button" onMouseDown={(e) => { e.preventDefault(); applyBgColor(null, 'main'); }} className="col-span-4 mt-1.5 px-2 py-1.5 text-[11px] font-bold text-red-500 bg-red-50 border border-red-200 hover:bg-red-100 hover:border-red-300 rounded-md transition-all text-center tracking-wide">Clear</button>
                            </div>
                          </>
                        )}
                      </div>
                      <div className="w-px h-5 bg-slate-200 mx-1" />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingImage}
                        className="p-1.5 hover:bg-slate-200 disabled:opacity-50 rounded-md text-slate-500 hover:text-slate-800 transition-colors"
                        title="Upload image"
                      >
                        {uploadingImage ? (
                          <div className="relative w-3.5 h-3.5">
                            <svg className="w-3.5 h-3.5 -rotate-90" viewBox="0 0 16 16">
                              <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-300" />
                              <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-500" strokeDasharray={`${uploadProgress * 0.377}, 37.7`} strokeLinecap="round" style={{ transition: 'stroke-dasharray 0.3s ease' }} />
                            </svg>
                          </div>
                        ) : (
                          <Image className="w-3.5 h-3.5" strokeWidth={2.5} />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => { loadTemplates(); setShowTemplatePopup(!showTemplatePopup); setShowRichCardPopup(false); }}
                        className={`p-1.5 rounded-md transition-colors ${showTemplatePopup ? 'bg-teal-100 text-teal-600' : 'hover:bg-teal-50 text-teal-500 hover:text-teal-600'}`}
                        title="Quick send template"
                      >
                        <FileText className="w-3.5 h-3.5" strokeWidth={2.5} />
                      </button>
                      <button
                        type="button"
                        onClick={() => { loadTemplates(); setShowRichCardPopup(!showRichCardPopup); setShowTemplatePopup(false); }}
                        className={`p-1.5 rounded-md transition-colors ${showRichCardPopup ? 'bg-blue-100 text-blue-600' : 'hover:bg-blue-50 text-blue-500 hover:text-blue-600'}`}
                        title="Rich Card templates"
                      >
                        <Megaphone className="w-3.5 h-3.5" strokeWidth={2.5} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowTipModal(true)}
                        className="p-1.5 hover:bg-amber-50 rounded-md text-amber-500 hover:text-amber-600 transition-colors"
                        title="Send tip to employee"
                      >
                        <Gift className="w-3.5 h-3.5" strokeWidth={2.5} />
                      </button>
                    </div>
                    {/* Editor area */}
                    <div
                      ref={editorRef}
                      contentEditable
                      suppressContentEditableWarning
                      onInput={() => { setMessageInput(getEditorHasContent() ? (editorRef.current?.textContent || '_img_') : ''); syncMainFormatState(); }}
                      onKeyUp={() => { syncMainFormatState(); setIsBoldActive(document.queryCommandState('bold')); setIsUnderlineActive(document.queryCommandState('underline')); }}
                      onMouseUp={() => { syncMainFormatState(); setIsBoldActive(document.queryCommandState('bold')); setIsUnderlineActive(document.queryCommandState('underline')); }}
                      onSelect={() => { syncMainFormatState(); setIsBoldActive(document.queryCommandState('bold')); setIsUnderlineActive(document.queryCommandState('underline')); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey && e.ctrlKey) {
                          e.preventDefault();
                          handleSendMessage(e as unknown as React.FormEvent);
                        }
                      }}
                      className="min-h-[40px] max-h-[160px] overflow-y-auto px-3 py-2 text-slate-800 focus:outline-none text-sm [&_b]:font-bold [&_u]:underline [&_font[size='5']]:text-lg [&_font[size='7']]:text-xl"
                      data-placeholder={`Message as ${selectedCustomer?.customer_name || 'customer'}... (Ctrl+Enter to send)`}
                      style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                    />
                  </div>
                  <div className="flex flex-col gap-2.5 flex-shrink-0">
                    <button
                      type="submit"
                      disabled={!messageInput.trim()}
                      className="px-8 py-2.5 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 disabled:from-slate-300 disabled:to-slate-300 disabled:text-slate-400 text-white rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-blue-600/20 disabled:shadow-none min-w-[64px]"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
          {/* Empty State Panel */}
          <div className={`absolute inset-0 transition-all duration-300 ease-in-out ${
            !showHistoryView && !(selectedEmployee && selectedCustomer) && !(selectedCustomer && !selectedEmployee)
              ? 'opacity-100 translate-y-0 z-10 pointer-events-auto'
              : 'opacity-0 translate-y-2 z-0 pointer-events-none'
          }`}>
            <div className="bg-slate-900/80 backdrop-blur-xl rounded-xl border border-slate-700/50 flex flex-col h-full">
              {/* Header with action buttons */}
              <div className="bg-slate-800/60 px-3 py-2 border-b border-slate-700/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-blue-600 rounded-md">
                      <MessageCircle className="w-3.5 h-3.5 text-white" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white leading-tight">
                        {selectedEmployee ? selectedEmployee.username : 'Customer Service'}
                      </h3>
                      <p className="text-[10px] text-slate-400">
                        {selectedEmployee ? `ID: ${selectedEmployee.employee_id}` : 'Select an employee to begin'}
                      </p>
                    </div>
                  </div>

                </div>
              </div>
              <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-slate-400">
                {selectedEmployee ? (
                  <>
                    <div className="w-14 h-14 mx-auto mb-3 bg-blue-600/15 rounded-xl flex items-center justify-center ring-1 ring-blue-500/30">
                      <User className="w-7 h-7 text-blue-400" />
                    </div>
                    <p className="text-sm font-bold text-white mb-0.5">{selectedEmployee?.username}</p>
                    <p className="text-[10px] text-blue-400 font-mono mb-3">ID: {selectedEmployee?.employee_id}</p>
                    <p className="text-xs text-slate-400">Select a customer to start chatting</p>
                  </>
                ) : (
                  <>
                    <MessageCircle className="w-14 h-14 mx-auto mb-3 opacity-20" />
                    <p className="text-sm font-semibold mb-1">Select an Employee</p>
                    <p className="text-xs">Choose an employee from the left panel</p>
                  </>
                )}
              </div>
              </div>
            </div>
          </div>
          </div>
        </div>

      {/* Modals rendered via portal to escape stacking context and cover full viewport */}
      {createPortal(<>
      {/* Rating Modal */}
      {showRatingModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
          <div className="bg-slate-900 border-2 border-yellow-500/30 rounded-3xl p-8 max-w-md w-full shadow-2xl">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-gradient-to-br from-yellow-600/30 to-orange-600/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Star className="w-8 h-8 text-yellow-400" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">Rate Service</h3>
              <p className="text-slate-400">How was your experience with {selectedEmployee?.username}?</p>
            </div>

            <div className="mb-6">
              <div className="flex justify-center gap-2 mb-6">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRatingValue(star)}
                    className="transition-transform hover:scale-110"
                  >
                    <Star
                      className={`w-10 h-10 ${
                        star <= ratingValue
                          ? 'fill-yellow-400 text-yellow-400'
                          : 'text-slate-600'
                      }`}
                    />
                  </button>
                ))}
              </div>

              <textarea
                value={ratingComment}
                onChange={(e) => setRatingComment(e.target.value)}
                placeholder="Share your feedback (optional)..."
                className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-yellow-500 resize-none"
                rows={4}
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleSubmitRating}
                disabled={ratingValue === 0}
                className="flex-1 px-6 py-3 bg-gradient-to-r from-yellow-600 to-orange-600 hover:from-yellow-700 hover:to-orange-700 disabled:from-slate-700 disabled:to-slate-700 text-white font-semibold rounded-xl transition-all disabled:cursor-not-allowed"
              >
                Submit Rating
              </button>
              <button
                onClick={() => {
                  setShowRatingModal(false);
                  setRatingValue(0);
                  setRatingComment('');
                }}
                className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rich Card Viewer Modal */}
      {viewingRichCard && createPortal(
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center p-0 xl:p-6"
          onClick={() => setViewingRichCard(null)}
          style={{ background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)', animation: 'fadeIn 0.2s ease-out' }}
        >
          <div
            className="relative w-full h-full xl:max-w-3xl xl:max-h-[85vh] xl:w-[680px] xl:h-auto bg-white rounded-none xl:rounded-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
            style={{ animation: 'scaleIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)', boxShadow: '0 25px 60px -12px rgba(0, 0, 0, 0.25)' }}
          >
            <div className="relative flex-shrink-0 overflow-hidden" style={{ padding: '24px 20px 20px', background: 'linear-gradient(135deg, #1e40af 0%, #2563eb 40%, #3b82f6 70%, #1d4ed8 100%)' }}>
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/5 rounded-full blur-2xl"></div>
                <div className="absolute -bottom-8 -left-8 w-32 h-32 bg-blue-300/10 rounded-full blur-xl"></div>
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>
              </div>
              <button onClick={() => setViewingRichCard(null)} className="absolute top-4 right-4 z-20 flex items-center justify-center w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 border border-white/20 transition-all">
                <X className="w-4 h-4 text-white" />
              </button>
              <div className="relative z-10">
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white/15 rounded-full border border-white/20 w-fit mb-3">
                  <Clock className="w-3 h-3 text-blue-100" />
                  <span className="text-[10px] sm:text-xs text-blue-50 font-medium">
                    {new Date(viewingRichCard.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 p-2.5 bg-white/15 backdrop-blur-sm rounded-xl border border-white/20 shadow-lg shadow-blue-900/20">
                    <Megaphone className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1 pr-8">
                    <h2 className="text-lg sm:text-xl font-bold text-white leading-snug break-words">{viewingRichCard.title || 'Notice'}</h2>
                    {viewingRichCard.subtitle && <p className="text-sm text-blue-100/80 mt-1 break-words">{viewingRichCard.subtitle}</p>}
                  </div>
                </div>
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-blue-400/30 via-blue-300/50 to-blue-400/30"></div>
            </div>
            <div className="relative flex-1 overflow-y-auto min-h-0 p-6" style={{ WebkitOverflowScrolling: 'touch' }}>
              {loadingRichCardContent ? (
                <div className="flex flex-col items-center justify-center" style={{ minHeight: '40vh', animation: 'fadeIn 0.3s ease-out' }}>
                  <div className="relative mb-6">
                    <div className="w-14 h-14 rounded-full border-4 border-blue-100" style={{ animation: 'pulse 2s ease-in-out infinite' }}></div>
                    <div className="absolute inset-0 w-14 h-14 rounded-full border-4 border-transparent border-t-blue-500 border-r-blue-400 animate-spin"></div>
                    <div className="absolute inset-2 w-10 h-10 rounded-full border-4 border-transparent border-b-blue-300 border-l-blue-200" style={{ animation: 'spin 1.2s linear infinite reverse' }}></div>
                  </div>
                  <div className="w-40 h-1.5 bg-blue-100 rounded-full overflow-hidden mb-3">
                    <div className="h-full w-full bg-gradient-to-r from-blue-400 via-blue-500 to-blue-400 rounded-full" style={{ backgroundSize: '200% 100%', animation: 'shimmer 1.5s ease-in-out infinite' }}></div>
                  </div>
                  <div className="flex items-center gap-1 text-blue-500">
                    <span className="text-sm font-medium">Loading content</span>
                    <span className="flex gap-0.5">
                      <span className="w-1 h-1 bg-blue-400 rounded-full" style={{ animation: 'bounce 1.4s ease-in-out infinite' }}></span>
                      <span className="w-1 h-1 bg-blue-400 rounded-full" style={{ animation: 'bounce 1.4s ease-in-out infinite 0.2s' }}></span>
                      <span className="w-1 h-1 bg-blue-400 rounded-full" style={{ animation: 'bounce 1.4s ease-in-out infinite 0.4s' }}></span>
                    </span>
                  </div>
                </div>
              ) : (
                <div
                  className="announcement-content"
                  style={{ fontSize: '15px', lineHeight: '1.75', color: '#374151' }}
                  dangerouslySetInnerHTML={{ __html: sanitizeAnnouncementContent(richCardFullContent || viewingRichCard.message_content) }}
                />
              )}
            </div>
            <div className="relative flex-shrink-0 border-t border-slate-100 bg-slate-50/80 px-5 py-3">
              <button onClick={() => setViewingRichCard(null)} className="w-full px-5 py-3 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white font-semibold text-sm rounded-xl transition-all shadow-md shadow-blue-600/20">
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Tip Modal */}
      {showTipModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
          <div className="bg-slate-900 border-2 border-amber-500/30 rounded-3xl p-8 max-w-md w-full shadow-2xl">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-gradient-to-br from-amber-500/20 to-orange-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4 ring-2 ring-amber-500/30">
                <Gift className="w-8 h-8 text-amber-400" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">Send Tip</h3>
              <p className="text-slate-400">Send a tip to <span className="text-amber-300 font-semibold">{selectedEmployee?.username}</span></p>
            </div>

            <div className="mb-6">
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Tip Amount ($)</label>
              <div className="relative">
                <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-amber-400" />
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={tipAmount}
                  onChange={(e) => setTipAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-12 pr-4 py-4 bg-slate-800/50 border border-slate-700 rounded-xl text-white text-2xl font-bold placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  autoFocus
                />
              </div>
              <div className="flex gap-2 mt-3">
                {[5, 10, 20, 50, 100].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setTipAmount(preset.toString())}
                    className="flex-1 px-2 py-1.5 bg-slate-800 hover:bg-amber-600/20 border border-slate-700 hover:border-amber-500/50 text-slate-300 hover:text-amber-300 rounded-lg text-sm font-medium transition-all"
                  >
                    ${preset}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleSendTip}
                disabled={!tipAmount || parseFloat(tipAmount) <= 0 || sendingTip}
                className="flex-1 px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:from-slate-700 disabled:to-slate-700 text-white font-semibold rounded-xl transition-all disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {sendingTip ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                ) : (
                  <>
                    <Gift className="w-5 h-5" strokeWidth={2.5} />
                    Send Tip
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  setShowTipModal(false);
                  setTipAmount('');
                }}
                className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer Create/Edit Modal */}
      {(showCustomerForm || editingCustomer) && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) { setShowCustomerForm(false); setEditingCustomer(null); setCustomerForm({ name: '', avatar: '🧑', isSuper: false, superTitle: '', customId: '', badgeType: '', vipLabel: 'VIP', customAvatarFile: null, useCustomAvatar: false, remarks: '', employeePinTop: false, employeeAlwaysVisible: false, targetEmployeeIds: [], _empSearch: '' }); } }}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={editingCustomer ? (e) => { e.preventDefault(); handleUpdateCustomer(); } : handleCreateCustomer} className={`bg-slate-900 rounded-xl border border-slate-700/50 p-5 shadow-2xl ${customerForm.isSuper ? 'max-w-[95vw]' : 'max-w-5xl'} w-full max-h-[95vh] overflow-y-auto transition-all duration-200`}>
            <h3 className="text-lg font-bold text-white mb-4">{editingCustomer ? 'Edit Customer' : 'Create Customer'}</h3>
            {/* Super Customer Toggle */}
            <div className="mb-4 p-3 bg-gradient-to-r from-amber-900/30 to-orange-900/30 border border-amber-500/30 rounded-lg">
              <label className="flex items-center gap-3 cursor-pointer">
                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${customerForm.isSuper ? 'bg-amber-500 border-amber-400' : 'border-amber-500/60 bg-transparent'}`}>
                  {customerForm.isSuper && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <input
                  type="checkbox"
                  checked={customerForm.isSuper}
                  onChange={(e) => setCustomerForm({ ...customerForm, isSuper: e.target.checked })}
                  className="sr-only"
                />
                <div className="flex items-center gap-2">
                  <Star className="w-5 h-5 text-amber-400" fill="currentColor" />
                  <span className="text-sm font-bold text-amber-200">Super Customer (VIP)</span>
                </div>
              </label>
            </div>

            {customerForm.isSuper ? (
            <>
              <div className="grid grid-cols-4 gap-4">
                {/* Left column: basic info + avatar */}
                <div className="min-w-0 p-3 bg-slate-800/40 border border-blue-500/30 rounded-xl">
                  <div className="mb-3">
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">Customer Name</label>
                    <input
                      type="text"
                      value={customerForm.name}
                      onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                      className="w-full px-3 py-2.5 bg-slate-900/50 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      placeholder="Customer name"
                      required
                    />
                  </div>

                  {/* Avatar */}
                  <div className="mb-3">
                    <label className="flex items-center gap-2 cursor-pointer p-2.5 bg-amber-900/20 border border-amber-500/30 rounded-lg hover:bg-amber-900/30 transition-all">
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${customerForm.useCustomAvatar ? 'bg-amber-500 border-amber-400' : 'border-amber-500/60 bg-transparent'}`}>
                        {customerForm.useCustomAvatar && (
                          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <input
                        type="checkbox"
                        checked={customerForm.useCustomAvatar}
                        onChange={(e) => setCustomerForm({ ...customerForm, useCustomAvatar: e.target.checked })}
                        className="sr-only"
                      />
                      <div className="flex items-center gap-1.5">
                        <Image className="w-4 h-4 text-amber-400" />
                        <span className="text-xs font-medium text-amber-200">Custom Photo Avatar</span>
                      </div>
                    </label>
                  </div>

                  {customerForm.useCustomAvatar ? (
                    <div className="mb-3">
                      <input
                        ref={avatarFileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) setCustomerForm({ ...customerForm, customAvatarFile: file });
                        }}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => avatarFileInputRef.current?.click()}
                        className="w-full px-3 py-2.5 bg-amber-900/20 border-2 border-amber-500/50 rounded-lg text-amber-200 hover:bg-amber-900/30 transition-all flex items-center justify-center gap-2 text-sm font-medium"
                      >
                        <Image className="w-4 h-4" />
                        {customerForm.customAvatarFile ? customerForm.customAvatarFile.name : 'Upload Photo'}
                      </button>
                      {customerForm.customAvatarFile && (
                        <div className="mt-1.5 p-2 bg-slate-900/50 rounded-lg flex items-center gap-2">
                          <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                            <Image className="w-5 h-5 text-amber-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-amber-200 font-medium truncate">{customerForm.customAvatarFile.name}</p>
                            <p className="text-[10px] text-amber-400">{(customerForm.customAvatarFile.size / 1024).toFixed(1)} KB</p>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-medium text-amber-300 mb-1.5">VIP Emoji Avatar</label>
                      <div className="grid grid-cols-6 gap-1.5 p-1.5 bg-amber-900/10 border border-amber-500/20 rounded-lg">
                        {['👨‍💼', '👩‍💼', '🧑‍💼', '👨‍🎓', '👩‍🎓', '🧑‍🎓', '👨‍⚖️', '👩‍⚖️', '🧑‍⚖️', '👨‍🔬', '👩‍🔬', '🧑‍🔬', '🤵', '🤵‍♂️', '🤵‍♀️', '👰', '👰‍♂️', '👰‍♀️', '🤴', '👸', '🦸‍♂️', '🦸‍♀️', '🦸', '🧙‍♂️', '🧙‍♀️', '🧙', '🧚‍♂️', '🧚‍♀️', '🧚', '🧛‍♂️', '🧛‍♀️', '🧛'].map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => setCustomerForm({ ...customerForm, avatar: emoji })}
                            className={`aspect-square rounded-lg flex items-center justify-center text-xl transition-all hover:scale-110 ${
                              customerForm.avatar === emoji
                                ? 'bg-amber-600 scale-110 ring-2 ring-amber-400 shadow-lg shadow-amber-500/50'
                                : 'bg-slate-800/50 hover:bg-amber-900/30 border border-amber-700/30'
                            }`}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Center column: VIP settings */}
                <div className="min-w-0 p-3 bg-amber-950/30 border border-amber-500/30 rounded-xl">
                  <div className="mb-3">
                    <label className="block text-xs font-medium text-amber-300 mb-1.5">
                      Custom ID <span className="text-amber-500/70 text-[10px]">(Optional)</span>
                    </label>
                    <input
                      type="text"
                      value={customerForm.customId}
                      onChange={(e) => setCustomerForm({ ...customerForm, customId: e.target.value })}
                      className="w-full px-3 py-2.5 bg-amber-900/20 border border-amber-500/30 rounded-lg text-amber-200 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 placeholder:text-amber-600/50 truncate"
                      placeholder="e.g., VIP-001"
                      maxLength={30}
                    />
                  </div>

                  <div className="mb-3">
                    <label className="block text-xs font-medium text-amber-300 mb-1.5">
                      Title Prefix
                    </label>
                    <input
                      type="text"
                      value={customerForm.superTitle}
                      onChange={(e) => setCustomerForm({ ...customerForm, superTitle: e.target.value })}
                      className="w-full px-3 py-2.5 bg-amber-900/20 border border-amber-500/30 rounded-lg text-amber-200 font-bold text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 placeholder:text-amber-600/50 truncate"
                      placeholder="e.g., Diamond, VIP Gold"
                      maxLength={30}
                      style={{ textShadow: '0 0 10px rgba(251, 191, 36, 0.5)' }}
                    />
                    {customerForm.superTitle && (
                      <div className="mt-1.5 p-1.5 bg-slate-900/50 rounded-lg overflow-hidden">
                        <p className="text-[10px] text-slate-400 mb-0.5">Preview:</p>
                        <p className="text-sm font-black bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 bg-clip-text text-transparent break-all leading-snug">{customerForm.superTitle}</p>
                        <p className="text-sm text-white break-all leading-snug">{customerForm.name || 'Name'}</p>
                      </div>
                    )}
                  </div>

                  <div className="mb-3">
                    <label className="block text-xs font-medium text-amber-300 mb-1.5">Badge Type</label>
                    <div className="grid grid-cols-5 gap-1.5">
                      {[
                        { value: 'diamond', icon: '💎', label: 'Diamond' },
                        { value: 'crown', icon: '👑', label: 'Crown' },
                        { value: 'star', icon: '⭐', label: 'Star' },
                        { value: 'vip', icon: '🏆', label: 'VIP' },
                        { value: 'premium', icon: '✨', label: 'Premium' }
                      ].map((badge) => (
                        <button
                          key={badge.value}
                          type="button"
                          onClick={() => setCustomerForm({ ...customerForm, badgeType: badge.value as any })}
                          className={`p-2 rounded-lg flex flex-col items-center gap-0.5 transition-all ${
                            customerForm.badgeType === badge.value
                              ? 'bg-amber-600 scale-105 ring-2 ring-amber-400'
                              : 'bg-slate-800 hover:bg-slate-700'
                          }`}
                        >
                          <span className="text-lg">{badge.icon}</span>
                          <span className={`text-[9px] text-white ${customerForm.badgeType === badge.value ? 'font-bold' : 'font-medium'}`}>{badge.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mb-3">
                    <label className="block text-xs font-medium text-amber-300 mb-1.5">VIP Badge Label</label>
                    <input
                      type="text"
                      value={customerForm.vipLabel}
                      onChange={(e) => setCustomerForm({ ...customerForm, vipLabel: e.target.value })}
                      placeholder="VIP"
                      maxLength={30}
                      className="w-full px-3 py-2.5 bg-slate-800 border border-amber-500/30 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 placeholder-gray-500"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">Badge text on chat cards (e.g. VIP, SVIP, GOLD)</p>
                  </div>

                  <div className="pt-3 mt-auto border-t border-amber-500/20">
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Remarks (optional)</label>
                    <input
                      type="text"
                      value={customerForm.remarks}
                      onChange={(e) => setCustomerForm({ ...customerForm, remarks: e.target.value })}
                      placeholder="Add a note to identify this customer..."
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      maxLength={100}
                    />
                  </div>
                </div>

                {/* Right column: Employee Display Settings */}
                <div className="min-w-0 p-3 bg-gradient-to-br from-teal-900/30 to-cyan-900/30 border border-teal-500/30 rounded-xl flex flex-col">
                  <div className="flex items-center gap-2 mb-3">
                    <Eye className="w-4 h-4 text-teal-400" />
                    <span className="text-sm font-bold text-teal-200">Employee Display</span>
                  </div>

                  <div className="space-y-2 mb-3">
                    <label className="flex items-center gap-2 cursor-pointer p-2 bg-slate-800/60 border border-teal-500/20 rounded-lg hover:bg-slate-800/80 transition-colors">
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${customerForm.employeePinTop ? 'bg-teal-500 border-teal-400' : 'border-teal-500/60 bg-transparent'}`}>
                        {customerForm.employeePinTop && (
                          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                        )}
                      </div>
                      <input type="checkbox" checked={customerForm.employeePinTop} onChange={(e) => setCustomerForm({ ...customerForm, employeePinTop: e.target.checked })} className="sr-only" />
                      <div>
                        <span className="text-xs font-medium text-slate-200 leading-tight block">Pin to top</span>
                        <p className="text-[10px] text-slate-400 leading-tight">Pinned at top of chat list</p>
                      </div>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer p-2 bg-slate-800/60 border border-teal-500/20 rounded-lg hover:bg-slate-800/80 transition-colors">
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${customerForm.employeeAlwaysVisible ? 'bg-teal-500 border-teal-400' : 'border-teal-500/60 bg-transparent'}`}>
                        {customerForm.employeeAlwaysVisible && (
                          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                        )}
                      </div>
                      <input type="checkbox" checked={customerForm.employeeAlwaysVisible} onChange={(e) => setCustomerForm({ ...customerForm, employeeAlwaysVisible: e.target.checked })} className="sr-only" />
                      <div>
                        <span className="text-xs font-medium text-slate-200 leading-tight block">Always visible</span>
                        <p className="text-[10px] text-slate-400 leading-tight">Show even without messages</p>
                      </div>
                    </label>
                  </div>

                  {/* Visible to - dual panel picker */}
                  <div className="flex-1 min-h-0 flex flex-col">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-teal-300">Visible to</span>
                      <button
                        type="button"
                        onClick={() => setCustomerForm({ ...customerForm, targetEmployeeIds: [] })}
                        className={`text-[11px] px-3 py-1.5 rounded-lg font-semibold transition-all shadow-sm ${customerForm.targetEmployeeIds.length === 0 ? 'bg-teal-600 text-white border border-teal-500' : 'bg-amber-600 text-white border border-amber-500 hover:bg-amber-700'}`}
                      >
                        {customerForm.targetEmployeeIds.length === 0 ? 'All employees' : 'Reset to all'}
                      </button>
                    </div>

                    <div className="relative mb-2">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                      <input
                        type="text"
                        value={customerForm._empSearch || ''}
                        onChange={(e) => setCustomerForm({ ...customerForm, _empSearch: e.target.value })}
                        className="w-full pl-7 pr-2 py-1.5 bg-slate-900/60 border border-slate-600/50 rounded-lg text-white text-[11px] focus:outline-none focus:ring-1 focus:ring-teal-500/50 placeholder:text-slate-500"
                        placeholder="Search employees..."
                      />
                    </div>

                    <div className="grid grid-rows-2 gap-2" style={{ height: '360px' }}>
                      {/* Available employees */}
                      <div className="min-h-0 flex flex-col bg-slate-900/40 border border-slate-600/30 rounded-lg overflow-hidden">
                        <div className="px-2 py-1 bg-slate-800/80 border-b border-slate-600/30 flex-shrink-0">
                          <span className="text-[10px] font-medium text-slate-400">Available ({employees.filter(emp => !customerForm.targetEmployeeIds.includes(emp.id) && (!customerForm._empSearch || emp.username.toLowerCase().includes((customerForm._empSearch || '').toLowerCase()) || emp.employee_id.toLowerCase().includes((customerForm._empSearch || '').toLowerCase()))).length})</span>
                        </div>
                        <div className="flex-1 overflow-y-auto p-1 space-y-0.5 scrollbar-thin">
                          {employees.filter(emp => !customerForm.targetEmployeeIds.includes(emp.id) && (!customerForm._empSearch || emp.username.toLowerCase().includes((customerForm._empSearch || '').toLowerCase()) || emp.employee_id.toLowerCase().includes((customerForm._empSearch || '').toLowerCase()))).map(emp => (
                            <button
                              key={emp.id}
                              type="button"
                              onClick={() => setCustomerForm({ ...customerForm, targetEmployeeIds: [...customerForm.targetEmployeeIds, emp.id] })}
                              className="w-full flex items-center gap-1.5 py-1.5 px-2 rounded-md hover:bg-teal-500/20 transition-colors text-left group"
                            >
                              <div className="w-4 h-4 rounded-full bg-teal-500/20 border border-teal-500/40 flex items-center justify-center flex-shrink-0 group-hover:bg-teal-500/40 group-hover:border-teal-400 transition-all">
                                <Plus className="w-2.5 h-2.5 text-teal-400" strokeWidth={3} />
                              </div>
                              <span className="text-[11px] text-white font-medium truncate">{emp.username}</span>
                              <span className="text-[10px] text-cyan-400/70 font-mono flex-shrink-0 ml-auto">{emp.employee_id}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* Selected employees */}
                      <div className="min-h-0 flex flex-col bg-teal-900/20 border border-teal-500/20 rounded-lg overflow-hidden">
                        <div className="px-2 py-1 bg-teal-900/40 border-b border-teal-500/20 flex-shrink-0">
                          <span className="text-[10px] font-medium text-teal-300">Selected ({customerForm.targetEmployeeIds.length})</span>
                        </div>
                        <div className="flex-1 overflow-y-auto p-1 space-y-0.5 scrollbar-thin">
                          {customerForm.targetEmployeeIds.length === 0 ? (
                            <div className="flex items-center justify-center h-full">
                              <span className="text-[10px] text-teal-400/60 italic">All employees (none specifically selected)</span>
                            </div>
                          ) : (
                            customerForm.targetEmployeeIds.filter(id => {
                              if (!customerForm._empSearch) return true;
                              const emp = employees.find(e => e.id === id);
                              if (!emp) return false;
                              const q = (customerForm._empSearch || '').toLowerCase();
                              return emp.username.toLowerCase().includes(q) || emp.employee_id.toLowerCase().includes(q);
                            }).map(id => {
                              const emp = employees.find(e => e.id === id);
                              if (!emp) return null;
                              return (
                                <button
                                  key={id}
                                  type="button"
                                  onClick={() => setCustomerForm({ ...customerForm, targetEmployeeIds: customerForm.targetEmployeeIds.filter(eid => eid !== id) })}
                                  className="w-full flex items-center gap-1.5 py-1.5 px-2 rounded-md hover:bg-red-500/20 transition-colors text-left group"
                                >
                                  <div className="w-4 h-4 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center flex-shrink-0 group-hover:bg-red-500/40 group-hover:border-red-400 transition-all">
                                    <X className="w-2.5 h-2.5 text-red-400" strokeWidth={3} />
                                  </div>
                                  <span className="text-[11px] text-white font-medium truncate">{emp.username}</span>
                                  <span className="text-[10px] text-cyan-400/70 font-mono flex-shrink-0 ml-auto">{emp.employee_id}</span>
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              {/* 4th column: Auto Messages */}
                <CustomerAutoMessages
                  customerId={editingCustomer?.id || null}
                  adminId={selectedAdminId || adminId}
                  sourceType="ccc_service"
                />
              </div>
            </>
            ) : (
              <>
                <div className="grid grid-cols-[1fr_1fr_1fr] gap-4">
                  {/* Left: Name, Avatar, Remarks */}
                  <div className="min-w-0">
                    <div className="mb-4">
                      <input
                        type="text"
                        value={customerForm.name}
                        onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                        className="w-full px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Customer name"
                        required
                      />
                    </div>

                    <div className="mb-4">
                      <label className="block text-sm font-medium text-slate-400 mb-3">Select Emoji Avatar</label>
                      <div className="grid grid-cols-8 gap-2 p-2 bg-slate-900/30 rounded-lg">
                        {cartoonAvatars.map((avatar) => (
                          <button
                            key={avatar.emoji}
                            type="button"
                            onClick={() => setCustomerForm({ ...customerForm, avatar: avatar.emoji })}
                            className={`aspect-square rounded-lg flex items-center justify-center text-2xl transition-all hover:scale-110 ${
                              customerForm.avatar === avatar.emoji
                                ? 'bg-blue-600 scale-110 ring-2 ring-blue-400'
                                : 'bg-slate-800 hover:bg-slate-700'
                            }`}
                            title={avatar.label}
                          >
                            {avatar.emoji}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1.5">Remarks (optional)</label>
                      <input
                        type="text"
                        value={customerForm.remarks}
                        onChange={(e) => setCustomerForm({ ...customerForm, remarks: e.target.value })}
                        placeholder="Add a note to identify this customer..."
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        maxLength={100}
                      />
                    </div>
                  </div>

                  {/* Right: Employee Display Settings */}
                  <div className="min-w-0 p-3 bg-gradient-to-br from-teal-900/30 to-cyan-900/30 border border-teal-500/30 rounded-xl flex flex-col">
                    <div className="flex items-center gap-2 mb-3">
                      <Eye className="w-4 h-4 text-teal-400" />
                      <span className="text-sm font-bold text-teal-200">Employee Display</span>
                    </div>

                    <div className="space-y-2 mb-3">
                      <label className="flex items-center gap-2 cursor-pointer p-2 bg-slate-800/60 border border-teal-500/20 rounded-lg hover:bg-slate-800/80 transition-colors">
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${customerForm.employeePinTop ? 'bg-teal-500 border-teal-400' : 'border-teal-500/60 bg-transparent'}`}>
                          {customerForm.employeePinTop && (
                            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                          )}
                        </div>
                        <input type="checkbox" checked={customerForm.employeePinTop} onChange={(e) => setCustomerForm({ ...customerForm, employeePinTop: e.target.checked })} className="sr-only" />
                        <div>
                          <span className="text-xs font-medium text-slate-200 leading-tight block">Pin to top</span>
                          <p className="text-[10px] text-slate-400 leading-tight">Pinned at top of chat list</p>
                        </div>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer p-2 bg-slate-800/60 border border-teal-500/20 rounded-lg hover:bg-slate-800/80 transition-colors">
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${customerForm.employeeAlwaysVisible ? 'bg-teal-500 border-teal-400' : 'border-teal-500/60 bg-transparent'}`}>
                          {customerForm.employeeAlwaysVisible && (
                            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                          )}
                        </div>
                        <input type="checkbox" checked={customerForm.employeeAlwaysVisible} onChange={(e) => setCustomerForm({ ...customerForm, employeeAlwaysVisible: e.target.checked })} className="sr-only" />
                        <div>
                          <span className="text-xs font-medium text-slate-200 leading-tight block">Always visible</span>
                          <p className="text-[10px] text-slate-400 leading-tight">Show even without messages</p>
                        </div>
                      </label>
                    </div>

                    {/* Visible to - dual panel picker */}
                    <div className="flex-1 min-h-0 flex flex-col">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-medium text-teal-300">Visible to</span>
                        <button
                          type="button"
                          onClick={() => setCustomerForm({ ...customerForm, targetEmployeeIds: [] })}
                          className={`text-[11px] px-3 py-1.5 rounded-lg font-semibold transition-all shadow-sm ${customerForm.targetEmployeeIds.length === 0 ? 'bg-teal-600 text-white border border-teal-500' : 'bg-amber-600 text-white border border-amber-500 hover:bg-amber-700'}`}
                        >
                          {customerForm.targetEmployeeIds.length === 0 ? 'All employees' : 'Reset to all'}
                        </button>
                      </div>

                      <div className="relative mb-2">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                        <input
                          type="text"
                          value={customerForm._empSearch || ''}
                          onChange={(e) => setCustomerForm({ ...customerForm, _empSearch: e.target.value })}
                          className="w-full pl-7 pr-2 py-1.5 bg-slate-900/60 border border-slate-600/50 rounded-lg text-white text-[11px] focus:outline-none focus:ring-1 focus:ring-teal-500/50 placeholder:text-slate-500"
                          placeholder="Search employees..."
                        />
                      </div>

                      <div className="grid grid-rows-2 gap-2" style={{ height: '360px' }}>
                        {/* Available employees */}
                        <div className="min-h-0 flex flex-col bg-slate-900/40 border border-slate-600/30 rounded-lg overflow-hidden">
                          <div className="px-2 py-1 bg-slate-800/80 border-b border-slate-600/30 flex-shrink-0">
                            <span className="text-[10px] font-medium text-slate-400">Available ({employees.filter(emp => !customerForm.targetEmployeeIds.includes(emp.id) && (!customerForm._empSearch || emp.username.toLowerCase().includes((customerForm._empSearch || '').toLowerCase()) || emp.employee_id.toLowerCase().includes((customerForm._empSearch || '').toLowerCase()))).length})</span>
                          </div>
                          <div className="flex-1 overflow-y-auto p-1 space-y-0.5 scrollbar-thin">
                            {employees.filter(emp => !customerForm.targetEmployeeIds.includes(emp.id) && (!customerForm._empSearch || emp.username.toLowerCase().includes((customerForm._empSearch || '').toLowerCase()) || emp.employee_id.toLowerCase().includes((customerForm._empSearch || '').toLowerCase()))).map(emp => (
                              <button
                                key={emp.id}
                                type="button"
                                onClick={() => setCustomerForm({ ...customerForm, targetEmployeeIds: [...customerForm.targetEmployeeIds, emp.id] })}
                                className="w-full flex items-center gap-1.5 py-1.5 px-2 rounded-md hover:bg-teal-500/20 transition-colors text-left group"
                              >
                                <div className="w-4 h-4 rounded-full bg-teal-500/20 border border-teal-500/40 flex items-center justify-center flex-shrink-0 group-hover:bg-teal-500/40 group-hover:border-teal-400 transition-all">
                                  <Plus className="w-2.5 h-2.5 text-teal-400" strokeWidth={3} />
                                </div>
                                <span className="text-[11px] text-white font-medium truncate">{emp.username}</span>
                                <span className="text-[10px] text-cyan-400/70 font-mono flex-shrink-0 ml-auto">{emp.employee_id}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                        {/* Selected employees */}
                        <div className="min-h-0 flex flex-col bg-teal-900/20 border border-teal-500/20 rounded-lg overflow-hidden">
                          <div className="px-2 py-1 bg-teal-900/40 border-b border-teal-500/20 flex-shrink-0">
                            <span className="text-[10px] font-medium text-teal-300">Selected ({customerForm.targetEmployeeIds.length})</span>
                          </div>
                          <div className="flex-1 overflow-y-auto p-1 space-y-0.5 scrollbar-thin">
                            {customerForm.targetEmployeeIds.length === 0 ? (
                              <div className="flex items-center justify-center h-full">
                                <span className="text-[10px] text-teal-400/60 italic">All employees (none specifically selected)</span>
                              </div>
                            ) : (
                              customerForm.targetEmployeeIds.filter(id => {
                                if (!customerForm._empSearch) return true;
                                const emp = employees.find(e => e.id === id);
                                if (!emp) return false;
                                const q = (customerForm._empSearch || '').toLowerCase();
                                return emp.username.toLowerCase().includes(q) || emp.employee_id.toLowerCase().includes(q);
                              }).map(id => {
                                const emp = employees.find(e => e.id === id);
                                if (!emp) return null;
                                return (
                                  <button
                                    key={id}
                                    type="button"
                                    onClick={() => setCustomerForm({ ...customerForm, targetEmployeeIds: customerForm.targetEmployeeIds.filter(eid => eid !== id) })}
                                    className="w-full flex items-center gap-1.5 py-1.5 px-2 rounded-md hover:bg-red-500/20 transition-colors text-left group"
                                  >
                                    <div className="w-4 h-4 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center flex-shrink-0 group-hover:bg-red-500/40 group-hover:border-red-400 transition-all">
                                      <X className="w-2.5 h-2.5 text-red-400" strokeWidth={3} />
                                    </div>
                                    <span className="text-[11px] text-white font-medium truncate">{emp.username}</span>
                                    <span className="text-[10px] text-cyan-400/70 font-mono flex-shrink-0 ml-auto">{emp.employee_id}</span>
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                {/* 3rd column: Auto Messages (regular customer) */}
                <CustomerAutoMessages
                  customerId={editingCustomer?.id || null}
                  adminId={selectedAdminId || adminId}
                  sourceType="ccc_service"
                />
                </div>
              </>
            )}

            <div className="flex gap-2 mt-4">
              <button
                type="submit"
                className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white rounded-lg transition-all font-medium"
              >
                {editingCustomer ? 'Save' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCustomerForm(false);
                  setEditingCustomer(null);
                  setCustomerForm({ name: '', avatar: '🧑', isSuper: false, superTitle: '', customId: '', badgeType: '', vipLabel: 'VIP', customAvatarFile: null, useCustomAvatar: false, remarks: '', employeePinTop: false, employeeAlwaysVisible: false, targetEmployeeIds: [], _empSearch: '' });
                }}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-all"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {showTemplateManager && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) { setShowTemplateManager(false); setEditingTemplate(null); setTemplateForm({ name: '', title: '', subtitle: '', content: '', content_type: 'richtext' }); if (templateEditorRef.current) templateEditorRef.current.innerHTML = ''; setRichCardContent(''); const rce = richCardEditorRef.current?.getEditor(); if (rce) rce.commands.setContent(''); } }}>
          <div onClick={(e) => e.stopPropagation()} className={`bg-slate-900 rounded-2xl border border-slate-700/50 w-full h-[92vh] flex flex-col shadow-2xl transition-all duration-300 ${templateForm.content_type === 'rich_card' ? 'max-w-[90vw]' : 'max-w-5xl'}`}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700/50 flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className={`p-1.5 rounded-lg ${templateManagerMode === 'rich_card' ? 'bg-blue-600/20' : 'bg-teal-600/20'}`}>
                  {templateManagerMode === 'rich_card' ? <Megaphone className="w-4 h-4 text-blue-400" /> : <BookOpen className="w-4 h-4 text-teal-400" />}
                </div>
                <h3 className="text-sm font-bold text-white">{templateManagerMode === 'rich_card' ? 'Rich Card Templates' : 'Message Templates'}</h3>
                <span className="text-[11px] text-slate-500 font-medium ml-1">{messageTemplates.filter(t => templateManagerMode === 'rich_card' ? t.content_type === 'rich_card' : t.content_type !== 'rich_card').length} template{messageTemplates.filter(t => templateManagerMode === 'rich_card' ? t.content_type === 'rich_card' : t.content_type !== 'rich_card').length !== 1 ? 's' : ''}</span>
              </div>
              <button onClick={() => { setShowTemplateManager(false); setEditingTemplate(null); setTemplateForm({ name: '', title: '', subtitle: '', content: '', content_type: 'richtext' }); if (templateEditorRef.current) templateEditorRef.current.innerHTML = ''; }} className="p-1.5 hover:bg-slate-800 rounded-lg transition-colors">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            {/* Left/Right body */}
            <div className="flex-1 flex min-h-0 overflow-hidden">
              {/* Left: Editor */}
              <div className={`flex flex-col border-r border-slate-700/50 p-4 gap-3 ${templateForm.content_type === 'rich_card' ? 'w-[72%]' : 'w-1/2'}`}>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <h4 className="text-sm font-bold text-white flex items-center gap-2 whitespace-nowrap">
                    {editingTemplate ? <Pencil className="w-3.5 h-3.5 text-blue-400" /> : <Plus className="w-3.5 h-3.5 text-teal-400" />}
                    {editingTemplate ? 'Edit Template' : 'New Template'}
                  </h4>
                  <input
                    type="text"
                    value={templateForm.name}
                    onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
                    className="flex-1 min-w-0 px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 placeholder:text-slate-400 shadow-sm"
                    placeholder="Template name (e.g., Welcome, FAQ, Follow-up...)"
                  />
                </div>
                <input ref={templateImageInputRef} type="file" accept="image/*" onChange={handleTemplateImageUpload} className="hidden" />
                <input id="templateFileImport" type="file" accept=".txt,.doc,.docx" onChange={handleTemplateFileImport} className="hidden" />
                {/* Content type toggle */}
                {templateManagerMode !== 'rich_card' && (
                <div className="flex items-center gap-1 p-1 bg-slate-800 rounded-lg flex-shrink-0">
                  <button type="button" onClick={() => { setTemplateForm(f => ({ ...f, content_type: 'richtext' })); }} className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${templateForm.content_type === 'richtext' ? 'bg-teal-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}>
                    Rich Text
                  </button>
                  <button type="button" onClick={() => { setTemplateForm(f => ({ ...f, content_type: 'rich_card' })); }} className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 ${templateForm.content_type === 'rich_card' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}>
                    <Megaphone className="w-3 h-3" />
                    Rich Card
                  </button>
                </div>
                )}
                {templateForm.content_type === 'rich_card' ? (
                  <>
                  <div className="flex flex-row gap-3 items-center bg-blue-500 rounded-t-xl px-3 py-2 flex-shrink-0">
                    <Megaphone className="w-4 h-4 text-white/80 flex-shrink-0" />
                    <input
                      type="text"
                      value={templateForm.title}
                      onChange={(e) => setTemplateForm(f => ({ ...f, title: e.target.value }))}
                      className="flex-1 bg-white text-slate-800 text-sm font-semibold placeholder:text-slate-400 focus:outline-none rounded px-2.5 py-1.5 shadow-sm"
                      placeholder="Main title (e.g. Important Notice)..."
                    />
                    <input
                      type="text"
                      value={templateForm.subtitle}
                      onChange={(e) => setTemplateForm(f => ({ ...f, subtitle: e.target.value }))}
                      className="flex-1 bg-white/90 text-slate-600 text-xs placeholder:text-slate-400 focus:outline-none rounded px-2.5 py-1.5 shadow-sm"
                      placeholder="Subtitle (optional)..."
                    />
                  </div>
                  <div className="flex-1 min-h-0 rounded-b-xl border border-t-0 border-slate-300 bg-white overflow-hidden shadow-sm flex flex-col focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400/40 transition-all">
                    <div className="flex-1 min-h-0 overflow-hidden">
                      <TiptapEditor
                        ref={richCardEditorRef}
                        content={richCardContent}
                        onChange={(c) => { setRichCardContent(c); setTemplateForm(f => ({ ...f, content: c })); }}
                        placeholder="Write rich card content (images, formatting, headings)..."
                        adminId={adminId}
                        theme="light"
                      />
                    </div>
                  </div>
                  </>
                ) : (
                <>
                {docImportProgress && (
                  <div className="px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg flex-shrink-0 mb-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold text-blue-700">{docImportProgress.phase}</span>
                      <span className="text-[10px] font-bold text-blue-500">{docImportProgress.pct}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-blue-100 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full transition-all duration-300 ease-out" style={{ width: `${docImportProgress.pct}%` }} />
                    </div>
                  </div>
                )}
                {/* Unified toolbar + editor (light theme, matches chat input) */}
                <div className="flex-1 min-h-0 rounded-xl border border-slate-300 bg-white overflow-hidden focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400/40 transition-all shadow-sm flex flex-col">
                  <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-slate-200 bg-slate-50/80 flex-shrink-0 flex-wrap">
                    <button type="button" onMouseDown={(e) => { e.preventDefault(); execTemplateCmd('bold'); }} className={`p-1.5 rounded-md transition-all ${templateBoldActive ? 'bg-blue-500 text-white shadow-sm shadow-blue-500/30' : 'text-slate-500 hover:bg-slate-200 hover:text-slate-800'}`} title="Bold (Ctrl+B)">
                      <Bold className="w-3.5 h-3.5" strokeWidth={2.5} />
                    </button>
                    <button type="button" onMouseDown={(e) => { e.preventDefault(); execTemplateCmd('underline'); }} className={`p-1.5 rounded-md transition-all ${templateUnderlineActive ? 'bg-blue-500 text-white shadow-sm shadow-blue-500/30' : 'text-slate-500 hover:bg-slate-200 hover:text-slate-800'}`} title="Underline (Ctrl+U)">
                      <Underline className="w-3.5 h-3.5" strokeWidth={2.5} />
                    </button>
                    <button type="button" onMouseDown={(e) => { e.preventDefault(); execTemplateCmd('strikeThrough'); }} className={`p-1.5 rounded-md transition-all ${templateStrikethroughActive ? 'bg-blue-500 text-white shadow-sm shadow-blue-500/30' : 'text-slate-500 hover:bg-slate-200 hover:text-slate-800'}`} title="Strikethrough">
                      <Strikethrough className="w-3.5 h-3.5" strokeWidth={2.5} />
                    </button>
                    <div className="w-px h-5 bg-slate-200 mx-1" />
                    <div className="flex items-center bg-slate-100 rounded-md p-0.5 gap-0.5">
                      <button type="button" onMouseDown={(e) => { e.preventDefault(); const next = templateFontSize === 'normal' ? null : 'normal'; execTemplateCmd('fontSize', next ? '3' : '3'); setTemplateFontSize(next); }} className={`px-1.5 py-0.5 text-[10px] rounded transition-all ${templateFontSize === 'normal' ? 'bg-blue-500 text-white font-bold shadow-sm shadow-blue-500/30' : 'text-slate-400 font-semibold hover:text-slate-700 hover:bg-slate-200'}`} title="Normal size">A</button>
                      <button type="button" onMouseDown={(e) => { e.preventDefault(); const next = templateFontSize === 'large' ? null : 'large'; execTemplateCmd('fontSize', next ? '5' : '3'); setTemplateFontSize(next); }} className={`px-1.5 py-0.5 text-xs rounded transition-all ${templateFontSize === 'large' ? 'bg-blue-500 text-white font-bold shadow-sm shadow-blue-500/30' : 'text-slate-400 font-semibold hover:text-slate-700 hover:bg-slate-200'}`} title="Large size">A</button>
                      <button type="button" onMouseDown={(e) => { e.preventDefault(); const next = templateFontSize === 'xlarge' ? null : 'xlarge'; execTemplateCmd('fontSize', next ? '7' : '3'); setTemplateFontSize(next); }} className={`px-1.5 py-0.5 text-sm rounded transition-all ${templateFontSize === 'xlarge' ? 'bg-blue-500 text-white font-bold shadow-sm shadow-blue-500/30' : 'text-slate-400 font-bold hover:text-slate-700 hover:bg-slate-200'}`} title="Extra large">A</button>
                    </div>
                    <div className="w-px h-5 bg-slate-200 mx-1" />
                    <div className="flex items-center bg-slate-100 rounded-md p-0.5 gap-0.5">
                      <button type="button" onMouseDown={(e) => { e.preventDefault(); execTemplateCmd('justifyLeft'); setTemplateAlign('left'); }} className={`p-1 rounded transition-all ${templateAlign === 'left' ? 'bg-blue-500 text-white shadow-sm shadow-blue-500/30' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-200'}`} title="Align left">
                        <AlignLeft className="w-3 h-3" strokeWidth={2.5} />
                      </button>
                      <button type="button" onMouseDown={(e) => { e.preventDefault(); execTemplateCmd('justifyCenter'); setTemplateAlign('center'); }} className={`p-1 rounded transition-all ${templateAlign === 'center' ? 'bg-blue-500 text-white shadow-sm shadow-blue-500/30' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-200'}`} title="Align center">
                        <AlignCenter className="w-3 h-3" strokeWidth={2.5} />
                      </button>
                      <button type="button" onMouseDown={(e) => { e.preventDefault(); execTemplateCmd('justifyRight'); setTemplateAlign('right'); }} className={`p-1 rounded transition-all ${templateAlign === 'right' ? 'bg-blue-500 text-white shadow-sm shadow-blue-500/30' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-200'}`} title="Align right">
                        <AlignRight className="w-3 h-3" strokeWidth={2.5} />
                      </button>
                    </div>
                    <div className="relative">
                      <button
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); setShowTextColorPicker(showTextColorPicker === 'template' ? null : 'template'); setShowBgColorPicker(null); }}
                        className={`p-1.5 rounded-md transition-all ${showTextColorPicker === 'template' ? 'bg-blue-500/20 text-blue-600' : 'text-slate-500 hover:bg-slate-200 hover:text-slate-800'}`}
                        title="Text color"
                      >
                        <Palette className="w-3.5 h-3.5" strokeWidth={2.5} />
                      </button>
                      {showTextColorPicker === 'template' && (
                        <>
                          <div className="fixed inset-0 z-[60]" onMouseDown={() => setShowTextColorPicker(null)} />
                          <div className="absolute top-full left-0 mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-xl z-[61] p-2 grid grid-cols-4 gap-1.5 w-[140px]">
                            {TEXT_COLORS.map((c) => (
                              <button key={c.color} type="button" onMouseDown={(e) => { e.preventDefault(); execTemplateCmd('foreColor', c.color); setTemplateTextColor(c.color); setShowTextColorPicker(null); }} className="w-7 h-7 rounded-md border border-slate-600 hover:scale-110 transition-transform flex items-center justify-center" title={c.label}>
                                <span className="text-sm font-bold" style={{ color: c.color }}>A</span>
                              </button>
                            ))}
                            <button type="button" onMouseDown={(e) => { e.preventDefault(); execTemplateCmd('removeFormat'); setTemplateTextColor(null); setShowTextColorPicker(null); }} className="col-span-4 mt-1.5 px-2 py-1.5 text-[11px] font-bold text-red-500 bg-red-50 border border-red-200 hover:bg-red-100 hover:border-red-300 rounded-md transition-all text-center tracking-wide">Clear</button>
                          </div>
                        </>
                      )}
                    </div>
                    <div className="relative">
                      <button
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); setShowBgColorPicker(showBgColorPicker === 'template' ? null : 'template'); setShowTextColorPicker(null); }}
                        className={`p-1.5 rounded-md transition-all ${showBgColorPicker === 'template' ? 'bg-yellow-500/30 text-yellow-600' : 'text-slate-500 hover:bg-slate-200 hover:text-slate-800'}`}
                        title="Background color"
                      >
                        <Highlighter className="w-3.5 h-3.5" strokeWidth={2.5} />
                      </button>
                      {showBgColorPicker === 'template' && (
                        <>
                          <div className="fixed inset-0 z-[60]" onMouseDown={() => setShowBgColorPicker(null)} />
                          <div className="absolute top-full left-0 mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-xl z-[61] p-2 grid grid-cols-4 gap-1.5 w-[140px]">
                            {BG_COLORS.map((c) => (
                              <button key={c.color} type="button" onMouseDown={(e) => { e.preventDefault(); applyBgColor(c.color, 'template'); }} className="w-7 h-7 rounded-md border border-slate-600 hover:scale-110 transition-transform" style={{ backgroundColor: c.color }} title={c.label} />
                            ))}
                            <button type="button" onMouseDown={(e) => { e.preventDefault(); applyBgColor(null, 'template'); }} className="col-span-4 mt-1.5 px-2 py-1.5 text-[11px] font-bold text-red-500 bg-red-50 border border-red-200 hover:bg-red-100 hover:border-red-300 rounded-md transition-all text-center tracking-wide">Clear</button>
                          </div>
                        </>
                      )}
                    </div>
                    <div className="w-px h-5 bg-slate-200 mx-1" />
                    <button
                      type="button"
                      onClick={() => templateImageInputRef.current?.click()}
                      disabled={uploadingTemplateImage}
                      className="p-1.5 rounded-md text-slate-500 hover:bg-slate-200 hover:text-slate-800 transition-colors disabled:opacity-50"
                      title="Insert image"
                    >
                      {uploadingTemplateImage ? (
                        <div className="w-3.5 h-3.5 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin" />
                      ) : (
                        <Image className="w-3.5 h-3.5" strokeWidth={2.5} />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => document.getElementById('templateFileImport')?.click()}
                      className="p-1.5 rounded-md text-slate-500 hover:bg-slate-200 hover:text-slate-800 transition-colors"
                      title="Import from .txt or .docx"
                    >
                      <Upload className="w-3.5 h-3.5" strokeWidth={2.5} />
                    </button>
                  </div>
                  <div
                    ref={templateEditorRef}
                    contentEditable
                    suppressContentEditableWarning
                    onInput={() => {
                      if (templateEditorRef.current) {
                        setTemplateForm(prev => ({ ...prev, content: templateEditorRef.current?.innerHTML || '' }));
                        syncTemplateFormatState();
                      }
                    }}
                    onKeyUp={syncTemplateFormatState}
                    onMouseUp={syncTemplateFormatState}
                    onSelect={syncTemplateFormatState}
                    className="flex-1 min-h-[200px] overflow-y-auto px-3 py-2.5 text-slate-800 text-sm focus:outline-none chat-rich-content"
                    style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                    data-placeholder="Enter template content, paste formatted text, or import a file..."
                  />
                </div>
                </>
                )}
                {/* Action buttons */}
                <div className="flex gap-2 flex-shrink-0 flex-col">
                  {savingTemplate && (
                    <div className="bg-slate-800 rounded-lg px-3 py-2 border border-teal-500/30">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] font-semibold text-teal-400">Saving template...</span>
                        <div className="w-3.5 h-3.5 border-2 border-teal-500/30 border-t-teal-400 rounded-full animate-spin" />
                      </div>
                      <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-teal-400 to-cyan-400 rounded-full" style={{ width: '100%', backgroundSize: '200% 100%', animation: 'shimmer 1.2s ease-in-out infinite' }} />
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={editingTemplate ? handleUpdateTemplate : handleCreateTemplate}
                    disabled={!templateForm.name.trim() || isTemplateContentEmpty() || savingTemplate}
                    className="flex-1 px-4 py-2.5 bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 disabled:from-slate-600 disabled:to-slate-600 disabled:text-slate-400 text-white rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2"
                  >
                    {savingTemplate ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        Saving...
                      </>
                    ) : (
                      editingTemplate ? 'Save Changes' : 'Add Template'
                    )}
                  </button>
                  {editingTemplate && (
                    <button
                      type="button"
                      onClick={() => { setEditingTemplate(null); setTemplateForm({ name: '', title: '', subtitle: '', content: '', content_type: 'richtext' }); if (templateEditorRef.current) templateEditorRef.current.innerHTML = ''; setRichCardContent(''); const rce = richCardEditorRef.current?.getEditor(); if (rce) rce.commands.setContent(''); }}
                      className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-semibold text-sm transition-all"
                    >
                      Cancel
                    </button>
                  )}
                  </div>
                </div>
              </div>

              {/* Right: Saved Templates */}
              <div className={`flex flex-col p-4 overflow-hidden ${templateForm.content_type === 'rich_card' ? 'w-[28%]' : 'w-1/2'}`}>
                {(() => {
                  const filteredTpls = messageTemplates.filter(t => templateManagerMode === 'rich_card' ? t.content_type === 'rich_card' : t.content_type !== 'rich_card');
                  return (<>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex-shrink-0">
                  Saved Templates ({filteredTpls.length})
                </h4>
                {filteredTpls.length > 0 ? (
                  <div className="flex-1 overflow-y-auto space-y-2 scrollbar-dark pr-1">
                    {filteredTpls.map((tpl) => (
                      <div key={tpl.id} className={`rounded-xl border-2 p-3 transition-all cursor-pointer ${editingTemplate?.id === tpl.id ? 'border-blue-500 bg-blue-500/10 shadow-lg shadow-blue-500/10' : tpl.is_pinned ? 'bg-slate-800/80 border-teal-600/50 hover:border-teal-500/70' : 'bg-slate-800/50 border-slate-700/50 hover:border-slate-500/70 hover:bg-slate-800/70'}`}
                        onClick={async () => {
                          setEditingTemplate(tpl);
                          setTemplateForm({ name: tpl.name, title: tpl.title || '', subtitle: tpl.subtitle || '', content: '', content_type: tpl.content_type as 'text' | 'richtext' | 'rich_card' });
                          const fullContent = await fetchTemplateContent(tpl.id);
                          if (fullContent) {
                            setTemplateForm(prev => ({ ...prev, content: fullContent }));
                            if (tpl.content_type === 'rich_card') {
                              setRichCardContent(fullContent);
                              requestAnimationFrame(() => { const editor = richCardEditorRef.current?.getEditor(); if (editor) editor.commands.setContent(fullContent); });
                            } else {
                              requestAnimationFrame(() => { if (templateEditorRef.current) templateEditorRef.current.innerHTML = fullContent; });
                            }
                          }
                        }}
                      >
                        <div className="flex items-start gap-2.5">
                          <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center mt-0.5 ${tpl.content_type === 'rich_card' ? 'bg-blue-500/20' : 'bg-teal-500/20'}`}>
                            {tpl.content_type === 'rich_card' ? <Megaphone className="w-4 h-4 text-blue-400" /> : <FileText className="w-4 h-4 text-teal-400" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              {tpl.is_pinned && <Pin className="w-3 h-3 text-teal-400 flex-shrink-0" />}
                              <span className="text-[13px] font-semibold text-slate-100 truncate">{tpl.name}</span>
                            </div>
                            {tpl.title && templateManagerMode === 'rich_card' && (
                              <p className="text-[11px] text-slate-400 truncate mt-0.5">{tpl.title}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              type="button"
                              onClick={async (e) => {
                                e.stopPropagation();
                                setEditingTemplate(tpl);
                                setTemplateForm({ name: tpl.name, title: tpl.title || '', subtitle: tpl.subtitle || '', content: '', content_type: tpl.content_type as 'text' | 'richtext' | 'rich_card' });
                                const fullContent = await fetchTemplateContent(tpl.id);
                                if (fullContent) {
                                  setTemplateForm(prev => ({ ...prev, content: fullContent }));
                                  if (tpl.content_type === 'rich_card') {
                                    setRichCardContent(fullContent);
                                    requestAnimationFrame(() => { const editor = richCardEditorRef.current?.getEditor(); if (editor) editor.commands.setContent(fullContent); });
                                  } else {
                                    requestAnimationFrame(() => { if (templateEditorRef.current) templateEditorRef.current.innerHTML = fullContent; });
                                  }
                                }
                              }}
                              className="p-1.5 rounded-lg bg-slate-700/60 text-slate-400 hover:text-blue-400 hover:bg-blue-500/20 transition-all"
                              title="Edit"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleToggleTemplatePin(tpl); }}
                              className={`p-1.5 rounded-lg transition-all ${tpl.is_pinned ? 'bg-teal-500/20 text-teal-400 hover:text-teal-300' : 'bg-slate-700/60 text-slate-400 hover:text-teal-400 hover:bg-teal-500/20'}`}
                              title={tpl.is_pinned ? 'Unpin' : 'Pin'}
                            >
                              <Pin className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setTemplateToDelete(tpl.id); }}
                              className="p-1.5 rounded-lg bg-slate-700/60 text-slate-400 hover:text-red-400 hover:bg-red-500/20 transition-all"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center">
                    {templateManagerMode === 'rich_card' ? <Megaphone className="w-12 h-12 text-slate-700 mb-3" /> : <FileText className="w-12 h-12 text-slate-700 mb-3" />}
                    <p className="text-sm text-slate-500 font-medium">No templates yet</p>
                    <p className="text-xs text-slate-600 mt-1">Create your first template using the editor on the left</p>
                  </div>
                )}
                </>);
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
          <div className="bg-slate-900 border-2 border-red-500/50 rounded-2xl p-6 max-w-md w-full shadow-2xl shadow-red-500/20">
            <h3 className="text-xl font-bold text-white mb-3">{confirmDialog.title}</h3>
            <p className="text-slate-300 mb-6">{confirmDialog.message}</p>
            <div className="flex gap-3">
              <button
                onClick={confirmDialog.onConfirm}
                className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition-colors"
              >
                Delete
              </button>
              <button
                onClick={() => setConfirmDialog(null)}
                className="flex-1 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-semibold transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {notification && createPortal(
        <div className={`fixed top-4 right-4 z-[100000] px-4 py-3 rounded-xl shadow-2xl border backdrop-blur-md transition-all animate-[slideInRight_0.3s_ease-out] ${
          notification.type === 'success'
            ? 'bg-green-500/90 text-white border-green-400/50 shadow-green-500/30'
            : 'bg-red-500/90 text-white border-red-400/50 shadow-red-500/30'
        }`}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{notification.text}</span>
            <button onClick={() => setNotification(null)} className="ml-2 p-0.5 hover:bg-white/20 rounded transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>,
        document.body
      )}
      {previewImage && (
        <div
          className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) { setPreviewImage(null); setAdminImageZoom(1); setAdminImageDrag({ x: 0, y: 0 }); } }}
        >
          <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
            <button
              onClick={() => setAdminImageZoom(z => Math.max(0.5, z - 0.25))}
              className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <ZoomOut className="w-5 h-5" />
            </button>
            <span className="text-white/70 text-xs font-mono min-w-[3rem] text-center">{Math.round(adminImageZoom * 100)}%</span>
            <button
              onClick={() => setAdminImageZoom(z => Math.min(5, z + 0.25))}
              className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <ZoomIn className="w-5 h-5" />
            </button>
            <button
              onClick={() => { setAdminImageZoom(1); setAdminImageDrag({ x: 0, y: 0 }); }}
              className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <RotateCcw className="w-5 h-5" />
            </button>
            <button
              onClick={() => { setPreviewImage(null); setAdminImageZoom(1); setAdminImageDrag({ x: 0, y: 0 }); }}
              className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div
            className="w-full h-full flex items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing"
            onMouseDown={(e) => { setAdminIsDragging(true); adminDragStartRef.current = { x: e.clientX, y: e.clientY, ox: adminImageDrag.x, oy: adminImageDrag.y }; }}
            onMouseMove={(e) => { if (!adminIsDragging) return; setAdminImageDrag({ x: adminDragStartRef.current.ox + e.clientX - adminDragStartRef.current.x, y: adminDragStartRef.current.oy + e.clientY - adminDragStartRef.current.y }); }}
            onMouseUp={() => setAdminIsDragging(false)}
            onMouseLeave={() => setAdminIsDragging(false)}
          >
            <img
              src={previewImage}
              alt="Preview"
              className="max-w-[85vw] max-h-[85vh] object-contain select-none"
              style={{
                transform: `scale(${adminImageZoom}) translate(${adminImageDrag.x / adminImageZoom}px, ${adminImageDrag.y / adminImageZoom}px)`,
                transition: adminIsDragging ? 'none' : 'transform 0.2s ease-out',
              }}
              draggable={false}
            />
          </div>
        </div>
      )}
      </>, document.body)}

      {templateToDelete && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setTemplateToDelete(null)}>
          <div className="bg-slate-800 rounded-xl p-6 max-w-sm w-full mx-4 border border-slate-700 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-2">Delete Template</h3>
            <p className="text-sm text-slate-400 mb-6">Are you sure you want to delete this template? This action cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setTemplateToDelete(null)}
                className="px-4 py-2 text-sm rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { handleDeleteTemplate(templateToDelete); setTemplateToDelete(null); }}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      , document.body)}
    </div>
  );
}