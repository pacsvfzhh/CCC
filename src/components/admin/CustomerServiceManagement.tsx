import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import { Users, Plus, Send, Trash2, CreditCard as Edit2, User, MessageCircle, ArrowLeft, X, Search, Tag, Filter, Image, Star, Clock, Bold, Underline, Strikethrough, Pencil, Check, Gift, DollarSign, MessageSquarePlus, FileText, BookOpen, Highlighter, Pin, Upload, Zap, CheckCheck, Eye, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { invalidateAdminWorkspaceDataCache, prefetchAdminGroups, prefetchAdminWorkspaceData, prefetchConversationSummaries } from '../../lib/serviceWorkspaceCache';
import { clearConversationRead, isConversationReadThrough, markConversationRead } from '../../lib/conversationReadState';
import { stripTailwindStyles, sanitizeChatMessage } from '../../lib/sanitizeHTML';
import AdminGroupPicker, { type AdminGroup } from './AdminGroupPicker';
import CustomerAvatarPicker, { CustomerAvatarDisplay } from './CustomerAvatarPicker';
import CustomerAutoMessages, { type AutoMessageDraft } from './CustomerAutoMessages';
import EmployeeMetadataPopover from './EmployeeMetadataPopover';

function extractImageOnlyUrl(content: string): string | null {
  const container = document.createElement('div');
  container.innerHTML = sanitizeChatMessage(content);
  const images = container.querySelectorAll('img');
  const text = (container.textContent || '').replace(/\u00a0/g, ' ').trim();

  if (images.length !== 1 || text) return null;
  return images[0].getAttribute('src') || null;
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
  image_url?: string | null;
  rating_data?: {
    rating?: number;
    comment?: string | null;
    employee_id?: string;
    status?: string;
    tip_amount?: number;
  } | null;
  is_read: boolean;
  source_type?: string;
  read_at?: string | null;
  created_at: string;
}

interface ConversationHistory {
  employee_id: string;
  employee_username: string;
  employee_number: string;
  employee_tags?: string[];
  employee_remarks?: string;
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
  content: string;
  content_type: 'text' | 'richtext' | 'rich_card';
  sort_order: number;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
}

interface CustomerServiceManagementProps {
  adminId: string;
  isSuperAdmin: boolean;
  isActive: boolean;
  initialEmployee?: { id: string; username: string } | null;
  onConsumeInitialEmployee?: () => void;
  onUnreadCountChange?: (delta: number) => void;
  unreadCount?: number;
}

function CustomerServiceManagement({ adminId, isSuperAdmin, isActive, initialEmployee, onConsumeInitialEmployee, onUnreadCountChange, unreadCount = 0 }: CustomerServiceManagementProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wasActiveRef = useRef(false);
  const [adminGroups, setAdminGroups] = useState<AdminGroup[]>([]);
  const [selectedAdminId, setSelectedAdminId] = useState<string | null>(null);
  const selectedAdminIdRef = useRef<string | null>(null);
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
  const pendingImageMessagesRef = useRef(new Map<string, Message>());
  const conversationMessagesCacheRef = useRef(new Map<string, Message[]>());
  const pendingConversationMessageRequestsRef = useRef(new Map<string, Promise<void>>());
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
  const [, setEditingContent] = useState('');
  const [isEditBoldActive, setIsEditBoldActive] = useState(false);
  const [isEditUnderlineActive, setIsEditUnderlineActive] = useState(false);
  const [editEditorFontSize, setEditEditorFontSize] = useState<'normal' | 'large' | 'xlarge' | null>(null);
  const editEditorRef = useRef<HTMLDivElement>(null);
  const [, setPendingRating] = useState<any>(null);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [ratingValue, setRatingValue] = useState(0);
  const [ratingComment, setRatingComment] = useState('');
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [customerForm, setCustomerForm] = useState({
    name: '',
    avatar: 'customer-avatar:regular:0',
    isSuper: false,
    superTitle: '',
    customId: '',
    badgeType: '' as '' | 'diamond' | 'crown' | 'star' | 'vip' | 'premium',
    vipLabel: 'VIP',
    customAvatarFile: null as File | null,
    useCustomAvatar: false,
    remarks: ''
  });
  const [editingCustomer, setEditingCustomer] = useState<SimulatedCustomer | null>(null);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [autoMessageDrafts, setAutoMessageDrafts] = useState<AutoMessageDraft[]>([]);
  const [autoMessageDraftMasterEnabled, setAutoMessageDraftMasterEnabled] = useState(false);
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
  const conversationHistoryRef = useRef<ConversationHistory[]>([]);
  const conversationHistoryLoadRequestRef = useRef(0);
  const workspaceLoadRequestRef = useRef(0);
  const allConversationHistoryRef = useRef<ConversationHistory[]>([]);
  const customerUnreadCountsRef = useRef<Record<string, number>>({});
  const conversationUnreadCountsRef = useRef<Record<string, number>>({});
  const conversationUnreadCountsLoadedRef = useRef(false);
  const customerUnreadRequestRef = useRef(0);
  const adminUnreadRequestRef = useRef(0);
  const locallyReadConversationKeysRef = useRef(new Set<string>());
  const realtimeConversationIdsRef = useRef(new Set<string>());
  const [historyFilterMode, setHistoryFilterMode] = useState<'all' | 'history' | 'new'>('all');
  const [historySearchQuery, setHistorySearchQuery] = useState('');
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
  const [templateForm, setTemplateForm] = useState({ name: '', content: '', content_type: 'richtext' as 'text' | 'richtext' | 'rich_card' });
  const templateEditorRef = useRef<HTMLDivElement>(null);
  const templateImageInputRef = useRef<HTMLInputElement>(null);
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null);
  const [uploadingTemplateImage, setUploadingTemplateImage] = useState(false);
  const [templateBoldActive, setTemplateBoldActive] = useState(false);
  const [templateUnderlineActive, setTemplateUnderlineActive] = useState(false);
  const [templateFontSize, setTemplateFontSize] = useState<string | null>(null);

  conversationHistoryRef.current = conversationHistory;
  allConversationHistoryRef.current = allConversationHistory;
  customerUnreadCountsRef.current = customerUnreadCounts;

  const workspaceCustomerIds = useMemo(
    () => new Set(customers.map(customer => customer.id)),
    [customers],
  );
  const workspaceEmployeeIds = useMemo(
    () => new Set(employees.map(employee => employee.id)),
    [employees],
  );
  const workspaceEmployeesById = useMemo(
    () => new Map(employees.map(employee => [employee.id, employee])),
    [employees],
  );
  const workspaceCustomersById = useMemo(
    () => new Map(customers.map(customer => [customer.id, customer])),
    [customers],
  );
  const workspaceConversationHistory = useMemo(
    () => allConversationHistory.filter(history =>
      Boolean(history.customer_id) &&
      workspaceCustomerIds.has(history.customer_id!) &&
      workspaceEmployeeIds.has(history.employee_id)
    ),
    [allConversationHistory, workspaceCustomerIds, workspaceEmployeeIds],
  );
  const customerUnreadCountsForCards = useMemo(() => {
    const historyCounts: Record<string, number> = {};

    workspaceConversationHistory.forEach(history => {
      if (!history.customer_id) return;
      historyCounts[history.customer_id] = (historyCounts[history.customer_id] || 0) + history.unread_count;
    });

    return { ...customerUnreadCounts, ...historyCounts };
  }, [customerUnreadCounts, workspaceConversationHistory]);
  const conversationHistoryForView = useMemo(() => {
    const source = historyScope === 'all' ? workspaceConversationHistory : conversationHistory;
    return source.filter(history =>
      Boolean(history.customer_id) &&
      workspaceCustomerIds.has(history.customer_id!) &&
      workspaceEmployeeIds.has(history.employee_id)
    );
  }, [conversationHistory, historyScope, workspaceConversationHistory, workspaceCustomerIds, workspaceEmployeeIds]);
  const chattedEmployeeIds = useMemo(
    () => new Set(conversationHistoryForView.map(history => history.employee_id)),
    [conversationHistoryForView],
  );

  const allTags = useMemo(
    () => Array.from(new Set(employees.flatMap(employee => employee.tags || []))).sort(),
    [employees],
  );

  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchQuery(searchQuery), 80);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Filter employees based on search, tags, and chat history
  const filteredEmployees = useMemo(() => employees.filter(emp => {
    // Search filter
    const query = debouncedSearchQuery.toLowerCase();
    const matchesSearch = query === '' ||
      emp.username.toLowerCase().includes(query) ||
      emp.employee_id.toLowerCase().includes(query) ||
      (emp.tags || []).some(tag => tag.toLowerCase().includes(query)) ||
      (emp.remarks && emp.remarks.toLowerCase().includes(query));

    // Tag filter
    const matchesTags = selectedTags.length === 0 ||
      (emp.tags && selectedTags.some(tag => emp.tags!.includes(tag)));

    // Chat history filter
    const hasChatted = chattedEmployeeIds.has(emp.id);
    const matchesGroupFilter =
      employeeGroupFilter === 'all' ||
      (employeeGroupFilter === 'chatted' && hasChatted) ||
      (employeeGroupFilter === 'not_chatted' && !hasChatted);

    return matchesSearch && matchesTags && matchesGroupFilter;
  }).sort((a, b) => {
    const aSelected = selectedEmployee?.id === a.id ? 0 : 1;
    const bSelected = selectedEmployee?.id === b.id ? 0 : 1;
    return aSelected - bSelected;
  }), [employees, debouncedSearchQuery, selectedTags, employeeGroupFilter, chattedEmployeeIds, selectedEmployee]);

  const visibleConversationHistory = useMemo(() => {
    const query = historySearchQuery.trim().toLowerCase();

    return conversationHistoryForView
      .filter((history) => {
        if (historyScope === 'customer' && history.customer_id !== selectedCustomer?.id) return false;
        if (selectedEmployee && history.employee_id !== selectedEmployee.id) return false;
        if (historyFilterMode === 'new' && history.unread_count <= 0) return false;
        if (!query) return true;

        const employee = workspaceEmployeesById.get(history.employee_id);
        const employeeTags = employee?.tags?.length
          ? employee.tags
          : history.employee_tags || [];
        const employeeNote = employee?.remarks?.trim()
          || history.employee_remarks?.trim()
          || '';
        const searchableText = [
          history.customer_name,
          history.employee_username,
          history.employee_number,
          ...employeeTags,
          employeeNote,
        ].filter(Boolean).join(' ').toLowerCase();

        return searchableText.includes(query);
      })
      .sort((a, b) => {
        if (a.unread_count !== b.unread_count) {
          return b.unread_count - a.unread_count;
        }
        return new Date(b.last_message_time).getTime() - new Date(a.last_message_time).getTime();
      });
  }, [conversationHistoryForView, workspaceEmployeesById, historyFilterMode, historySearchQuery, historyScope, selectedCustomer?.id, selectedEmployee]);

  const loadMessagesRef = useRef<(markAsRead?: boolean) => void>();
  const messagesLoadRequestRef = useRef(0);
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  selectedAdminIdRef.current = selectedAdminId;
  const justSentRef = useRef(false);
  const loadConversationHistoryRef = useRef<() => void>();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const isInitialLoadRef = useRef(true);
  const preserveScrollUntilRef = useRef(0);
  const loadOlderMessagesRef = useRef<() => void>();
  const historyListRef = useRef<HTMLDivElement>(null);
  const employeeListRef = useRef<HTMLDivElement>(null);
  const historyScrollTopRef = useRef(0);

  const messagesContainerCallbackRef = (node: HTMLDivElement | null) => {
    if (node) {
      messagesContainerRef.current = node;
    }
  };

  useEffect(() => {
    if (!selectedEmployee?.id) return;
    employeeListRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [selectedEmployee?.id]);

  const applyRealtimeConversation = useCallback((payload: { eventType?: string; new?: Partial<Message> }) => {
    const message = payload.new;
    if (!message?.id || !message.customer_id || !message.employee_id || !message.created_at) return;
    if (message.source_type && message.source_type !== 'aaa_service') return;
    if (!workspaceCustomerIds.has(message.customer_id) || !workspaceEmployeeIds.has(message.employee_id)) return;

    if (payload.eventType === 'INSERT') {
      if (realtimeConversationIdsRef.current.has(message.id)) return;
      realtimeConversationIdsRef.current.add(message.id);
    }

    const conversationKey = `${message.customer_id}:${message.employee_id}`;
    const isUnreadEmployeeMessage = message.sender_type === 'employee' &&
      message.is_read === false &&
      !isConversationReadThrough('aaa_service', message.customer_id, message.employee_id, message.created_at);
    const lastMessage = message.message_type === 'image' ? '__IMAGE__' : message.message_content || '';
    const updateHistory = (history: ConversationHistory[]) => {
      const existingIndex = history.findIndex(item => `${item.customer_id}:${item.employee_id}` === conversationKey);
      const existing = existingIndex >= 0 ? history[existingIndex] : null;
      const customer = allCustomersRef.current.find(item => item.id === message.customer_id);
      const employee = allEmployeesRef.current.find(item => item.id === message.employee_id);
      if (!existing && (!customer || !employee)) return history;

      const nextEntry: ConversationHistory = {
        employee_id: message.employee_id as string,
        employee_username: existing?.employee_username || employee?.username || 'Employee',
        employee_number: existing?.employee_number || employee?.employee_id || '',
        employee_tags: existing?.employee_tags || employee?.tags || [],
        employee_remarks: existing?.employee_remarks || employee?.remarks || '',
        message_count: (existing?.message_count || 0) + (payload.eventType === 'INSERT' ? 1 : 0),
        last_message: lastMessage,
        last_message_time: message.created_at as string,
        unread_count: (existing?.unread_count || 0) + (payload.eventType === 'INSERT' && isUnreadEmployeeMessage ? 1 : 0),
        customer_id: message.customer_id,
        customer_name: existing?.customer_name || customer?.customer_name,
        customer_avatar: existing?.customer_avatar || customer?.customer_avatar,
        custom_avatar_url: existing?.custom_avatar_url || customer?.custom_avatar_url,
      };

      const nextHistory = existingIndex >= 0
        ? history.map((item, index) => index === existingIndex ? { ...item, ...nextEntry } : item)
        : [...history, nextEntry];
      return nextHistory.sort((a, b) => new Date(b.last_message_time).getTime() - new Date(a.last_message_time).getTime());
    };

    const nextAllHistory = updateHistory(allConversationHistoryRef.current);
    const nextConversationHistory = selectedCustomer?.id && selectedCustomer.id !== message.customer_id
      ? conversationHistoryRef.current
      : updateHistory(conversationHistoryRef.current);
    allConversationHistoryRef.current = nextAllHistory;
    conversationHistoryRef.current = nextConversationHistory;
    setAllConversationHistory(nextAllHistory);
    setConversationHistory(nextConversationHistory);

    if (payload.eventType === 'INSERT' && isUnreadEmployeeMessage) {
      const nextConversationCounts = { ...conversationUnreadCountsRef.current };
      nextConversationCounts[conversationKey] = (nextConversationCounts[conversationKey] || 0) + 1;
      conversationUnreadCountsRef.current = nextConversationCounts;

      const nextCustomerCounts = { ...customerUnreadCountsRef.current };
      nextCustomerCounts[message.customer_id] = (nextCustomerCounts[message.customer_id] || 0) + 1;
      customerUnreadCountsRef.current = nextCustomerCounts;
      setCustomerUnreadCounts(nextCustomerCounts);
    }
  }, [selectedCustomer?.id, workspaceCustomerIds, workspaceEmployeeIds]);

  const loadCustomerUnreadCounts = useCallback(async (customerIds: string[]) => {
    if (!selectedAdminId || customerIds.length === 0) return;
    const requestAdminId = selectedAdminId;
    const requestId = ++customerUnreadRequestRef.current;
    const employeeIds = allEmployeesRef.current.map(employee => employee.id);
    if (employeeIds.length === 0) return;

    try {
      const { data, error } = await supabase
        .from('customer_employee_conversations')
        .select('customer_id, employee_id, created_at')
        .in('customer_id', customerIds)
        .in('employee_id', employeeIds)
        .eq('source_type', 'aaa_service')
        .eq('sender_type', 'employee')
        .eq('is_read', false);

      if (error) throw error;

      const counts: Record<string, number> = {};
      const conversationCounts: Record<string, number> = {};
      data?.forEach(msg => {
        const conversationKey = `${msg.customer_id}:${msg.employee_id}`;
        if (isConversationReadThrough('aaa_service', msg.customer_id, msg.employee_id, msg.created_at)) {
          return;
        }
        counts[msg.customer_id] = (counts[msg.customer_id] || 0) + 1;
        conversationCounts[conversationKey] = (conversationCounts[conversationKey] || 0) + 1;
      });

      if (requestId !== customerUnreadRequestRef.current || selectedAdminIdRef.current !== requestAdminId) return;

      const knownConversationKeys = new Set(
        [...conversationHistoryRef.current, ...allConversationHistoryRef.current]
          .map(history => `${history.customer_id}:${history.employee_id}`),
      );
      const missingConversationKeys = Object.keys(conversationCounts)
        .filter(key => !knownConversationKeys.has(key));
      const latestMessagesByConversation = new Map<string, {
        message_content: string;
        message_type: string | null;
        created_at: string;
      }>();

      if (missingConversationKeys.length > 0) {
        const { data: latestMessages, error: latestMessagesError } = await supabase
          .from('customer_employee_conversations')
          .select('customer_id, employee_id, message_content, message_type, created_at')
          .in('customer_id', customerIds)
          .in('employee_id', employeeIds)
          .eq('source_type', 'aaa_service')
          .order('created_at', { ascending: false });

        if (latestMessagesError) throw latestMessagesError;
        latestMessages?.forEach(message => {
          const key = `${message.customer_id}:${message.employee_id}`;
          if (!latestMessagesByConversation.has(key)) {
            latestMessagesByConversation.set(key, message);
          }
        });
      }

      if (requestId !== customerUnreadRequestRef.current || selectedAdminIdRef.current !== requestAdminId) return;

      customerUnreadCountsRef.current = counts;
      conversationUnreadCountsRef.current = conversationCounts;
      conversationUnreadCountsLoadedRef.current = true;
      const applyUnreadCounts = (history: ConversationHistory) => ({
        ...history,
        unread_count: conversationCounts[`${history.customer_id}:${history.employee_id}`] || 0,
      });
      const nextConversationHistory = conversationHistoryRef.current.map(applyUnreadCounts);
      const nextAllConversationHistory = allConversationHistoryRef.current.map(applyUnreadCounts);

      for (const conversationKey of missingConversationKeys) {
        const [customerId, employeeId] = conversationKey.split(':');
        const customer = allCustomersRef.current.find(item => item.id === customerId);
        const employee = allEmployeesRef.current.find(item => item.id === employeeId);
        const latestMessage = latestMessagesByConversation.get(conversationKey);
        if (!customer || !employee || !latestMessage) continue;

        nextAllConversationHistory.push({
          customer_id: customer.id,
          customer_name: customer.customer_name,
          customer_avatar: customer.customer_avatar,
          custom_avatar_url: customer.custom_avatar_url,
          employee_id: employee.id,
          employee_username: employee.username,
          employee_number: employee.employee_id,
          employee_tags: employee.tags || [],
          employee_remarks: employee.remarks || '',
          message_count: conversationCounts[conversationKey] || 0,
          last_message: latestMessage.message_type === 'image' ? '__IMAGE__' : latestMessage.message_content,
          last_message_time: latestMessage.created_at,
          unread_count: conversationCounts[conversationKey] || 0,
        });
      }

      nextAllConversationHistory.sort((a, b) =>
        new Date(b.last_message_time).getTime() - new Date(a.last_message_time).getTime(),
      );
      conversationHistoryRef.current = nextConversationHistory;
      allConversationHistoryRef.current = nextAllConversationHistory;
      setConversationHistory(nextConversationHistory);
      setAllConversationHistory(nextAllConversationHistory);

      setCustomerUnreadCounts(prev => {
        const previousIds = Object.keys(prev);
        const countIds = Object.keys(counts);
        const hasChanged = previousIds.length !== countIds.length ||
          previousIds.some(id => prev[id] !== counts[id]);
        return hasChanged ? counts : prev;
      });
    } catch (error) {
      console.error('Error loading unread counts:', error);
    }
  }, [selectedAdminId]);

  const loadAdminUnreadCounts = async (adminIds: string[]) => {
    const requestId = ++adminUnreadRequestRef.current;
    try {
      const counts: Record<string, number> = {};
      adminIds.forEach(id => { counts[id] = 0; });

      const [{ data: customers, error: customersError }, { data: employees, error: employeesError }] = await Promise.all([
        supabase
          .from('simulated_customers')
          .select('id, admin_id')
          .in('admin_id', adminIds)
          .eq('source_type', 'aaa_service'),
        supabase
          .from('users')
          .select('id, created_by')
          .in('created_by', adminIds),
      ]);

      if (customersError) throw customersError;
      if (employeesError) throw employeesError;

      const customerIds = (customers || []).map(customer => customer.id);
      const employeeIds = (employees || []).map(employee => employee.id);
      if (customerIds.length === 0 || employeeIds.length === 0) {
        if (requestId !== adminUnreadRequestRef.current) return;
        setAdminUnreadCounts(prev =>
          adminIds.some(id => prev[id] !== counts[id]) || Object.keys(prev).length !== adminIds.length
            ? counts
            : prev
        );
        return;
      }

      const { data: messages, error: messagesError } = await supabase
        .from('customer_employee_conversations')
        .select('customer_id, employee_id')
        .in('customer_id', customerIds)
        .in('employee_id', employeeIds)
        .eq('source_type', 'aaa_service')
        .eq('sender_type', 'employee')
        .eq('is_read', false);

      if (messagesError) throw messagesError;

      const customersById = new Map((customers || []).map(customer => [customer.id, customer.admin_id]));
      const employeesById = new Map((employees || []).map(employee => [employee.id, employee.created_by]));
      messages?.forEach(message => {
        const customerAdminId = customersById.get(message.customer_id);
        if (customerAdminId && employeesById.get(message.employee_id) === customerAdminId) {
          counts[customerAdminId]++;
        }
      });

      if (requestId !== adminUnreadRequestRef.current) return;
      setAdminUnreadCounts(prev =>
        adminIds.some(id => prev[id] !== counts[id]) || Object.keys(prev).length !== adminIds.length
          ? counts
          : prev
      );
    } catch (error) {
      console.error('Error loading admin unread counts:', error);
    }
  };

  const loadAdminGroups = useCallback(async (targetEmployee?: { id: string; username: string } | null, silent = false, force = false) => {
    let autoSelected = false;
    try {
      if (!silent) setLoading(true);
      const data = await prefetchAdminGroups(adminId, 'customer', force);
      setAdminGroups(data);

      if (data.length > 0) {
        void loadAdminUnreadCounts(data.map(g => g.admin_id));

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
      } else {
        setAdminUnreadCounts({});
      }
    } catch (error) {
      console.error('Error loading admin groups:', error);
      setNotification({ type: 'error', text: 'Failed to load admin groups' });
    } finally {
      if (!autoSelected && !silent) {
        setLoading(false);
      }
    }
  }, [adminId]);

  const loadConversationHistoryForCustomer = useCallback(async (customer: SimulatedCustomer) => {
    if (employees.length === 0) return;

    const requestId = ++conversationHistoryLoadRequestRef.current;

    try {
      const employeeById = new Map(employees.map(employee => [employee.id, employee]));
      const { data, error } = await supabase
        .from('customer_employee_conversations')
        .select('employee_id, sender_type, message_content, message_type, is_read, created_at, simulated_customers!inner(source_type)')
        .eq('customer_id', customer.id)
        .in('employee_id', employees.map(employee => employee.id))
        .eq('simulated_customers.source_type', 'aaa_service')
        .order('created_at', { ascending: false });

      if (requestId !== conversationHistoryLoadRequestRef.current) return;
      if (error) throw error;

      const historyMap = new Map<string, ConversationHistory>();
      for (const msg of data || []) {
        const employee = employeeById.get(msg.employee_id);
        if (!employee) continue;

        if (!historyMap.has(msg.employee_id)) {
          historyMap.set(msg.employee_id, {
            employee_id: msg.employee_id,
            employee_username: employee.username,
            employee_number: employee.employee_id,
            employee_tags: employee.tags || [],
            employee_remarks: employee.remarks || '',
            customer_id: customer.id,
            customer_name: customer.customer_name,
            customer_avatar: customer.customer_avatar,
            custom_avatar_url: customer.custom_avatar_url,
            message_count: 0,
            last_message: msg.message_type === 'image' ? '__IMAGE__' : msg.message_content,
            last_message_time: msg.created_at,
            unread_count: 0,
          });
        }

        const history = historyMap.get(msg.employee_id)!;
        history.message_count++;

        if (
          msg.sender_type === 'employee' &&
          !msg.is_read &&
          !isConversationReadThrough('aaa_service', customer.id, msg.employee_id, msg.created_at)
        ) {
          history.unread_count++;
        }
      }

      if (requestId !== conversationHistoryLoadRequestRef.current) return;
      const nextHistory = Array.from(historyMap.values());
      conversationHistoryRef.current = nextHistory;
      setConversationHistory(nextHistory);
    } catch (error) {
      console.error('Error loading conversation history:', error);
    }
  }, [employees]);

  const loadConversationHistory = useCallback(async () => {
    if (!selectedCustomer) return;
    return loadConversationHistoryForCustomer(selectedCustomer);
  }, [selectedCustomer, loadConversationHistoryForCustomer]);

  const loadAllConversationHistory = useCallback(async (force = false) => {
    if (!selectedAdminId) return;
    const requestId = ++conversationHistoryLoadRequestRef.current;
    try {
      void loadCustomerUnreadCounts(allCustomersRef.current.map(customer => customer.id));
      const data = await prefetchConversationSummaries(
        selectedAdminId,
        'customer',
        async () => {
          const { data: summaries, error } = await supabase.rpc('get_ccc_conversation_summaries', {
            p_admin_id: selectedAdminId,
            p_source_type: 'aaa_service'
          });

          if (error) throw error;
          return summaries || [];
        },
        force,
      );

      if (requestId !== conversationHistoryLoadRequestRef.current) return;

      const employeeIds = data.map((row: any) => row.employee_id).filter(Boolean);
      const employeeMetaById = new Map<string, { id: string; tags?: string[]; remarks?: string }>();
      allEmployeesRef.current.forEach(employee => {
        employeeMetaById.set(employee.id, employee);
      });
      const missingEmployeeIds = employeeIds.filter((employeeId: string) => !employeeMetaById.has(employeeId));
      if (missingEmployeeIds.length > 0) {
        const { data: employeeMeta } = await supabase.from('users').select('*').in('id', missingEmployeeIds);
        (employeeMeta || []).forEach(employee => {
          employeeMetaById.set(employee.id, employee);
        });
      }

      const customerIds = new Set(allCustomersRef.current.map(customer => customer.id));
      const employeeIdsInWorkspace = new Set(allEmployeesRef.current.map(employee => employee.id));
      const summaryHistory: ConversationHistory[] = (data || [])
        .filter((row: any) => customerIds.has(row.customer_id) && employeeIdsInWorkspace.has(row.employee_id))
        .map((row: any) => {
        const employee = employeeMetaById.get(row.employee_id);
        const customer = allCustomersRef.current.find(item => item.id === row.customer_id);
        return {
        employee_id: row.employee_id,
        employee_username: row.employee_username,
        employee_number: row.employee_number,
        employee_tags: employee?.tags || [],
        employee_remarks: employee?.remarks || '',
        customer_id: row.customer_id,
        customer_name: row.customer_name,
        customer_avatar: customer?.customer_avatar || row.customer_avatar,
        custom_avatar_url: customer?.custom_avatar_url || row.custom_avatar_url,
        message_count: Number(row.message_count),
        last_message: row.last_message_type === 'image' ? '__IMAGE__' : (row.last_message || ''),
        last_message_time: row.last_message_time,
        unread_count: isConversationReadThrough('aaa_service', row.customer_id, row.employee_id, row.last_message_time)
          ? 0
          : conversationUnreadCountsLoadedRef.current
            ? conversationUnreadCountsRef.current[`${row.customer_id}:${row.employee_id}`] || 0
            : Number(row.unread_count),
        };
      });
      const summaryKeys = new Set(summaryHistory.map(history => `${history.customer_id}:${history.employee_id}`));
      const supplementalHistory = allConversationHistoryRef.current.filter(history => {
        const key = `${history.customer_id}:${history.employee_id}`;
        return customerIds.has(history.customer_id || '') &&
          employeeIdsInWorkspace.has(history.employee_id) &&
          history.unread_count > 0 &&
          !summaryKeys.has(key);
      });
      const allHistory = [...summaryHistory, ...supplementalHistory].sort((a, b) =>
        new Date(b.last_message_time).getTime() - new Date(a.last_message_time).getTime(),
      );

      if (requestId !== conversationHistoryLoadRequestRef.current) return;
      conversationHistoryRef.current = allHistory;
      allConversationHistoryRef.current = allHistory;
      setConversationHistory(allHistory);
      setAllConversationHistory(allHistory);
    } catch (error) {
      console.error('Error loading all conversation history:', error);
    }
  }, [selectedAdminId, loadCustomerUnreadCounts]);

  const loadOlderMessages = useCallback(async () => {
    if (!selectedCustomer || !selectedEmployee || loadingOlderMessages || !hasMoreMessages) return;
    if (messages.length === 0) return;

    setLoadingOlderMessages(true);
    const messageRequestId = messagesLoadRequestRef.current;
    try {
      const oldestTime = messages[0]?.created_at;
      const { data, error } = await supabase
        .from('customer_employee_conversations')
        .select('*, simulated_customers!inner(source_type)')
        .eq('customer_id', selectedCustomer.id)
        .eq('employee_id', selectedEmployee.id)
        .eq('simulated_customers.source_type', 'aaa_service')
        .lt('created_at', oldestTime)
        .order('created_at', { ascending: false })
        .limit(MESSAGE_PAGE_SIZE);

      if (error) throw error;
      if (messagesLoadRequestRef.current !== messageRequestId) return;
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
      if (messagesLoadRequestRef.current === messageRequestId) {
        setLoadingOlderMessages(false);
      }
    }
  }, [selectedCustomer, selectedEmployee, messages, loadingOlderMessages, hasMoreMessages]);

  const clearUnreadConversationLocally = useCallback((customerId: string, employeeId: string) => {
    locallyReadConversationKeysRef.current.add(`${customerId}:${employeeId}`);
    markConversationRead('aaa_service', customerId, employeeId);

    const threadUnreadCount = Math.max(
      conversationHistoryRef.current.find(history => history.customer_id === customerId && history.employee_id === employeeId)?.unread_count || 0,
      allConversationHistoryRef.current.find(history => history.customer_id === customerId && history.employee_id === employeeId)?.unread_count || 0,
    );

    const nextConversationHistory = conversationHistoryRef.current.map(history => (
      history.customer_id === customerId && history.employee_id === employeeId
        ? { ...history, unread_count: 0 }
        : history
    ));
    const nextAllConversationHistory = allConversationHistoryRef.current.map(history => (
      history.customer_id === customerId && history.employee_id === employeeId
        ? { ...history, unread_count: 0 }
        : history
    ));
    conversationHistoryRef.current = nextConversationHistory;
    allConversationHistoryRef.current = nextAllConversationHistory;
    setConversationHistory(nextConversationHistory);
    setAllConversationHistory(nextAllConversationHistory);

    const currentCount = customerUnreadCountsRef.current[customerId] || 0;
    const remainingCount = Math.max(0, currentCount - threadUnreadCount);
    const nextConversationUnreadCounts = { ...conversationUnreadCountsRef.current };
    delete nextConversationUnreadCounts[`${customerId}:${employeeId}`];
    conversationUnreadCountsRef.current = nextConversationUnreadCounts;

    const nextCustomerUnreadCounts = { ...customerUnreadCountsRef.current };
    if (remainingCount === 0) {
      delete nextCustomerUnreadCounts[customerId];
    } else {
      nextCustomerUnreadCounts[customerId] = remainingCount;
    }
    customerUnreadCountsRef.current = nextCustomerUnreadCounts;
    setCustomerUnreadCounts(nextCustomerUnreadCounts);

    if (threadUnreadCount > 0) {
      onUnreadCountChange?.(-threadUnreadCount);
    }
  }, [onUnreadCountChange]);

  const restoreCachedMessages = useCallback((customerId: string, employeeId: string) => {
    const cacheKey = `${customerId}:${employeeId}`;
    const cachedMessages = conversationMessagesCacheRef.current.get(cacheKey);
    if (!cachedMessages) return false;

    const pendingMessages = Array.from(pendingImageMessagesRef.current.values()).filter(message =>
      message.customer_id === customerId &&
      message.employee_id === employeeId &&
      !cachedMessages.some(cached => cached.image_url && cached.image_url === message.image_url)
    );
    const visibleMessages = [...cachedMessages, ...pendingMessages]
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    setMessages(visibleMessages);
    setHasMoreMessages(cachedMessages.length >= MESSAGE_PAGE_SIZE);
    setMessagesLoading(false);
    return true;
  }, []);

  const prefetchMessages = useCallback(async (customerId: string, employeeId: string) => {
    const cacheKey = `${customerId}:${employeeId}`;
    if (conversationMessagesCacheRef.current.has(cacheKey)) return;

    const pending = pendingConversationMessageRequestsRef.current.get(cacheKey);
    if (pending) return pending;

    const request = Promise.resolve(
      supabase
        .from('customer_employee_conversations')
      .select('*, simulated_customers!inner(source_type)')
      .eq('customer_id', customerId)
      .eq('employee_id', employeeId)
      .eq('simulated_customers.source_type', 'aaa_service')
      .order('created_at', { ascending: false })
      .limit(MESSAGE_PAGE_SIZE)
      .then(
        ({ data, error }) => {
          if (!error && data) {
            conversationMessagesCacheRef.current.set(cacheKey, data.reverse());
          }
          pendingConversationMessageRequestsRef.current.delete(cacheKey);
        },
        (error: unknown) => {
          console.error('Error prefetching messages:', error);
          pendingConversationMessageRequestsRef.current.delete(cacheKey);
        },
      ),
    );

    pendingConversationMessageRequestsRef.current.set(cacheKey, request);
    return request;
  }, []);

  const loadMessages = useCallback(async (markAsRead: boolean = true) => {
    if (!selectedCustomer || !selectedEmployee) return;

    const cacheKey = `${selectedCustomer.id}:${selectedEmployee.id}`;
    restoreCachedMessages(selectedCustomer.id, selectedEmployee.id);
    const requestId = ++messagesLoadRequestRef.current;
    try {
      const { data, error } = await supabase
        .from('customer_employee_conversations')
        .select('*, simulated_customers!inner(source_type)')
        .eq('customer_id', selectedCustomer.id)
        .eq('employee_id', selectedEmployee.id)
        .eq('simulated_customers.source_type', 'aaa_service')
        .order('created_at', { ascending: false })
        .limit(MESSAGE_PAGE_SIZE);

      if (error) throw error;
      if (requestId !== messagesLoadRequestRef.current) return;
      const sorted = (data || []).reverse();
      const pendingMessages = Array.from(pendingImageMessagesRef.current.values()).filter(message =>
        message.customer_id === selectedCustomer.id && message.employee_id === selectedEmployee.id
      );
      const confirmedPendingIds = new Set(
        pendingMessages
          .filter(pending => sorted.some(message => message.image_url === pending.image_url))
          .map(message => message.id)
      );
      confirmedPendingIds.forEach(messageId => pendingImageMessagesRef.current.delete(messageId));
      const visibleMessages = [...sorted, ...pendingMessages.filter(message => !confirmedPendingIds.has(message.id))]
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      conversationMessagesCacheRef.current.set(cacheKey, sorted);
      setMessages(visibleMessages);
      setHasMoreMessages((data || []).length >= MESSAGE_PAGE_SIZE);
      setMessagesLoading(false);

      if (markAsRead && isActiveRef.current) {
        const customerId = selectedCustomer.id;
        const employeeId = selectedEmployee.id;
        clearUnreadConversationLocally(customerId, employeeId);

        const { error: markReadError } = await supabase
          .from('customer_employee_conversations')
          .update({ is_read: true, read_at: new Date().toISOString() })
          .eq('customer_id', customerId)
          .eq('employee_id', employeeId)
          .eq('sender_type', 'employee')
          .eq('is_read', false);

        if (markReadError) {
          console.error('Error marking conversation as read:', markReadError);
          locallyReadConversationKeysRef.current.delete(`${customerId}:${employeeId}`);
          clearConversationRead('aaa_service', customerId, employeeId);
          void loadAllConversationHistory(true);
        } else {
          void loadAllConversationHistory(true);
        }
      }

      if (requestId !== messagesLoadRequestRef.current) return;

      const { data: sessionData } = await supabase.rpc('get_or_create_service_session', {
        p_customer_id: selectedCustomer.id,
        p_employee_id: selectedEmployee.id
      });

      if (requestId !== messagesLoadRequestRef.current) return;
      if (sessionData && sessionData.length > 0) {
        setServiceTicketNumber(sessionData[0].service_ticket_number);
      }
    } catch (error) {
      if (requestId !== messagesLoadRequestRef.current) return;
      console.error('Error loading messages:', error);
      setMessagesLoading(false);
    }
  }, [clearUnreadConversationLocally, loadAllConversationHistory, restoreCachedMessages, selectedCustomer, selectedEmployee]);

  useEffect(() => {
    loadMessagesRef.current = loadMessages;
    loadConversationHistoryRef.current = loadConversationHistory;
  }, [loadMessages, loadConversationHistory]);

  // Reset to first panel when tab becomes active (unless navigating with initial employee)
  useEffect(() => {
    if (isActive && !wasActiveRef.current && !initialEmployee) {
      console.log('[CustomerService] Tab became active, resetting to first panel');
      setSelectedCustomer(null);
      setSelectedEmployee(null);
      setMessages([]);
      setConversationHistory(allConversationHistoryRef.current);
      setShowHistoryView(true);
      setHistoryScope('all');
      setHistoryFilterMode('all');
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
    if (isActive && selectedAdminId && customers.length > 0 && employees.length > 0 && !selectedCustomer && !selectedEmployee && showHistoryView && historyScope === 'all') {
      void loadAllConversationHistory(true);
    }
  }, [isActive, selectedAdminId, customers.length, employees.length, selectedCustomer, selectedEmployee, showHistoryView, historyScope, loadAllConversationHistory]);

  // Subscribe to realtime updates for admins table
  useEffect(() => {
    if (isActive && isSuperAdmin) {
      const channel = supabase
        .channel('customer_service_admins_realtime')
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'admins'
        }, () => {
          loadAdminGroups(null, false, true);
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [isActive, isSuperAdmin, loadAdminGroups]);

  // Refresh summary counts while the workspace picker is visible
  useEffect(() => {
    if (!isActive || !isSuperAdmin || selectedAdminId || adminGroups.length === 0) return;

    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        void loadAdminGroups(null, true, true);
      }, 300);
    };

    const channel = supabase
      .channel('customer_service_workspace_summary_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'simulated_customers' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customer_employee_conversations' }, scheduleRefresh)
      .subscribe();

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [isActive, isSuperAdmin, selectedAdminId, adminGroups.length, loadAdminGroups]);

  // Subscribe to realtime updates for admin unread counts
  useEffect(() => {
    if (isActive && isSuperAdmin && adminGroups.length > 0) {
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
  }, [isActive, isSuperAdmin, adminGroups.length]);



  useEffect(() => {
    if (!isActive || !selectedAdminId || !selectedCustomer?.id) return;

    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshMessages = false;
    const scheduleRefresh = (shouldRefreshMessages: boolean) => {
      refreshMessages = refreshMessages || shouldRefreshMessages;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        const shouldLoadMessages = refreshMessages;
        refreshMessages = false;
        refreshTimer = null;
        if (shouldLoadMessages && selectedEmployee?.id) {
          loadMessagesRef.current?.(isActive);
        }
        loadConversationHistoryRef.current?.();
      }, 120);
    };

    const channel = supabase
      .channel(`customer_conversations_${selectedCustomer.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'customer_employee_conversations',
        filter: `customer_id=eq.${selectedCustomer.id}`
      }, (payload: any) => {
        if (payload?.new?.sender_type === 'employee' && payload?.new?.is_read === false && payload?.new?.customer_id && payload?.new?.employee_id) {
          locallyReadConversationKeysRef.current.delete(`${payload.new.customer_id}:${payload.new.employee_id}`);
          clearConversationRead('aaa_service', payload.new.customer_id, payload.new.employee_id);
        }
        scheduleRefresh(!(justSentRef.current && payload?.new?.sender_type === 'customer'));
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'customer_employee_conversations',
        filter: `customer_id=eq.${selectedCustomer.id}`
      }, () => scheduleRefresh(true))
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'customer_employee_conversations',
        filter: `customer_id=eq.${selectedCustomer.id}`
      }, () => scheduleRefresh(true))
      .subscribe();

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [isActive, selectedAdminId, selectedCustomer?.id, selectedEmployee?.id]);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  useEffect(() => {
    if (isActive && selectedAdminId && customers.length > 0) {
      const customerIds = customers.map(c => c.id);
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      const fallbackTimer = window.setInterval(() => {
        void loadCustomerUnreadCounts(customerIds);
        void loadAllConversationHistory(true);
      }, 15000);
      const channel = supabase
        .channel(`customer_unread_counts_${selectedAdminId}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'customer_employee_conversations'
        }, (payload: any) => {
          customerUnreadRequestRef.current += 1;
          conversationHistoryLoadRequestRef.current += 1;
          if (payload?.new?.sender_type === 'employee' && payload?.new?.is_read === false && payload?.new?.customer_id && payload?.new?.employee_id) {
            locallyReadConversationKeysRef.current.delete(`${payload.new.customer_id}:${payload.new.employee_id}`);
            clearConversationRead('aaa_service', payload.new.customer_id, payload.new.employee_id);
          }
          applyRealtimeConversation(payload);
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            loadCustomerUnreadCounts(customerIds);
            loadAllConversationHistory(true);
          }, 400);
        })
        .subscribe();

      return () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        window.clearInterval(fallbackTimer);
        supabase.removeChannel(channel);
      };
    }
  }, [isActive, selectedAdminId, customers, applyRealtimeConversation, loadAllConversationHistory, loadCustomerUnreadCounts]);

  // Subscribe to realtime updates for employees (users table)
  useEffect(() => {
    if (isActive && selectedAdminId) {
      const employeeRequestId = workspaceLoadRequestRef.current;
      const channel = supabase
        .channel(`employees_realtime_${selectedAdminId}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'users'
        }, () => {
          // Reload employees when users table changes
          supabase
            .from('users')
            .select('*')
            .eq('created_by', selectedAdminId)
            .order('username')
            .then(
              ({ data, error }) => {
                if (employeeRequestId !== workspaceLoadRequestRef.current) return;
                if (!error && data) {
                  setEmployees(data);
                  allEmployeesRef.current = data;
                }
              },
              (error: unknown) => {
                console.error('Error loading employees:', error);
              },
            );
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [isActive, selectedAdminId]);

  useEffect(() => {
    if (isActive && selectedCustomer?.id && selectedEmployee?.id) {
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
  }, [isActive, selectedCustomer?.id, selectedEmployee?.id]);

  useEffect(() => {
    if (isActive && selectedCustomer?.id && employees.length > 0) {
      loadConversationHistory();
    }
  }, [isActive, selectedCustomer?.id, employees.length, loadConversationHistory]);

  // Remove redundant reload - loadAllConversationHistory is already called via realtime subscription

  useEffect(() => {
    if (isActive && selectedEmployee?.id && selectedCustomer?.id) {
      isInitialLoadRef.current = true;
      setMessagesLoading(true);
      loadMessages();
      checkPendingRating();
    }
  }, [isActive, selectedEmployee?.id, selectedCustomer?.id, loadMessages]);

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

  useEffect(() => {
    if (messages.length > 0) {
      if (isInitialLoadRef.current) {
        isInitialLoadRef.current = false;
      }
    }
  }, [messages]);

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
          source_type: 'aaa_service',
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
          source_type: 'aaa_service',
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
        .select('*')
        .eq('admin_id', selectedAdminId)
        .eq('source_type', 'aaa_service')
        .order('is_pinned', { ascending: false })
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false });
      if (error) throw error;
      setMessageTemplates(data || []);
    } catch (error) {
      console.error('Error loading templates:', error);
    }
  }, [selectedAdminId]);

  const getTemplateContent = (): string => {
    if (templateForm.content_type === 'richtext' && templateEditorRef.current) {
      return stripTailwindStyles(templateEditorRef.current.innerHTML);
    }
    return templateForm.content;
  };

  const isTemplateContentEmpty = (): boolean => {
    if (templateForm.content_type === 'richtext' && templateEditorRef.current) {
      const hasText = (templateEditorRef.current.textContent || '').trim().length > 0;
      const hasImages = templateEditorRef.current.querySelectorAll('img').length > 0;
      return !hasText && !hasImages;
    }
    return !templateForm.content.trim();
  };

  const handleCreateTemplate = async () => {
    if (!selectedAdminId || !templateForm.name.trim()) return;
    const content = getTemplateContent();
    if (isTemplateContentEmpty()) return;
    try {
      const { error } = await supabase
        .from('cs_message_templates')
        .insert({
          admin_id: selectedAdminId,
          name: templateForm.name.trim(),
          content: templateForm.content_type === 'richtext' ? content : content.trim(),
          content_type: templateForm.content_type,
          sort_order: messageTemplates.length,
          source_type: 'aaa_service',
        });
      if (error) throw error;
      setTemplateForm({ name: '', content: '', content_type: 'richtext' });
      if (templateEditorRef.current) templateEditorRef.current.innerHTML = '';
      setNotification({ type: 'success', text: 'Template created!' });
      loadTemplates();
    } catch (error: any) {
      setNotification({ type: 'error', text: error.message || 'Failed to create template' });
    }
  };

  const handleUpdateTemplate = async () => {
    if (!editingTemplate || !templateForm.name.trim()) return;
    const content = getTemplateContent();
    if (isTemplateContentEmpty()) return;
    try {
      const { error } = await supabase
        .from('cs_message_templates')
        .update({
          name: templateForm.name.trim(),
          content: templateForm.content_type === 'richtext' ? content : content.trim(),
          content_type: templateForm.content_type,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingTemplate.id);
      if (error) throw error;
      setEditingTemplate(null);
      setTemplateForm({ name: '', content: '', content_type: 'richtext' });
      if (templateEditorRef.current) templateEditorRef.current.innerHTML = '';
      setNotification({ type: 'success', text: 'Template updated!' });
      loadTemplates();
    } catch (error: any) {
      setNotification({ type: 'error', text: error.message || 'Failed to update template' });
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    try {
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
        const mammoth = await import('mammoth');
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        if (templateEditorRef.current) {
          templateEditorRef.current.innerHTML = result.value;
          setTemplateForm(prev => ({ ...prev, content: result.value, content_type: 'richtext' }));
        }
      } else {
        setNotification({ type: 'error', text: 'Unsupported file type. Use .txt or .docx files.' });
      }
    } catch (error: any) {
      setNotification({ type: 'error', text: error.message || 'Failed to import file' });
    }
    e.target.value = '';
  };

  useEffect(() => {
    if (selectedAdminId) {
      loadTemplates();
    }
  }, [selectedAdminId, loadTemplates]);

  const loadAdminData = async (targetAdminId: string, silent = false, force = false) => {
    const requestId = ++workspaceLoadRequestRef.current;
    customerUnreadRequestRef.current += 1;
    try {
      if (!silent) setLoading(true);

      void prefetchConversationSummaries(
        targetAdminId,
        'customer',
        async () => {
          const { data, error } = await supabase.rpc('get_ccc_conversation_summaries', {
            p_admin_id: targetAdminId,
            p_source_type: 'aaa_service',
          });
          if (error) throw error;
          return data || [];
        },
      ).catch(error => {
        console.warn('Unable to prefetch customer service sessions:', error);
      });

      const { customers, employees } = await prefetchAdminWorkspaceData<SimulatedCustomer, Employee>(
        targetAdminId,
        'customer',
        force,
      );

      if (requestId !== workspaceLoadRequestRef.current) return;

      setCustomers(customers);
      setEmployees(employees);
      allCustomersRef.current = customers;
      allEmployeesRef.current = employees;

      if (!silent) setLoading(false);

      if (customers.length === 0 || employees.length === 0) {
        customerUnreadCountsRef.current = {};
        conversationUnreadCountsRef.current = {};
        conversationUnreadCountsLoadedRef.current = true;
        setCustomerUnreadCounts({});
        return;
      }

    } catch (error) {
      if (requestId !== workspaceLoadRequestRef.current) return;
      console.error('Error loading admin data:', error);
      setNotification({ type: 'error', text: 'Failed to load data' });
    } finally {
      if (!silent && requestId === workspaceLoadRequestRef.current) setLoading(false);
    }
  };

  const handleAdminGroupSelect = (group: AdminGroup) => {
    workspaceLoadRequestRef.current += 1;
    customerUnreadRequestRef.current += 1;
    conversationUnreadCountsLoadedRef.current = false;
    conversationUnreadCountsRef.current = {};
    conversationHistoryLoadRequestRef.current += 1;
    messagesLoadRequestRef.current += 1;
    setSelectedAdminId(group.admin_id);
    setSelectedAdminName(group.admin_username);
    setSelectedCustomer(null);
    setSelectedEmployee(null);
    setMessages([]);
    setMessagesLoading(false);
    setLoadingOlderMessages(false);
    setHasMoreMessages(false);
    setConversationHistory([]);
    setAllConversationHistory([]);
    conversationHistoryRef.current = [];
    allConversationHistoryRef.current = [];
    setCustomers([]);
    setEmployees([]);
    historyScrollTopRef.current = 0;
    loadAdminData(group.admin_id);
  };

  const handleBackToGroups = () => {
    workspaceLoadRequestRef.current += 1;
    customerUnreadRequestRef.current += 1;
    conversationUnreadCountsLoadedRef.current = false;
    conversationUnreadCountsRef.current = {};
    conversationHistoryLoadRequestRef.current += 1;
    messagesLoadRequestRef.current += 1;
    setSelectedAdminId(null);
    setSelectedAdminName('');
    setSelectedCustomer(null);
    setSelectedEmployee(null);
    setMessages([]);
    setMessagesLoading(false);
    setLoadingOlderMessages(false);
    setHasMoreMessages(false);
    setConversationHistory([]);
    setAllConversationHistory([]);
    conversationHistoryRef.current = [];
    allConversationHistoryRef.current = [];
    historyScrollTopRef.current = 0;
    setCustomers([]);
    setEmployees([]);
    void loadAdminGroups(null, true, true);
  };

  const handleSelectCustomer = async (customer: SimulatedCustomer) => {
    historyScrollTopRef.current = 0;
    messagesLoadRequestRef.current += 1;
    if (selectedCustomer?.id === customer.id) {
      setSelectedCustomer(null);
      setMessages([]);
      setConversationHistory([]);
      setShowHistoryView(false);
      return;
    }
    setSelectedCustomer(customer);
    setMessages([]);
    setLoadingOlderMessages(false);
    setHasMoreMessages(false);
    if (selectedEmployee) setMessagesLoading(true);
    const cachedHistory = allConversationHistoryRef.current.filter(history => history.customer_id === customer.id);
    setConversationHistory(cachedHistory);
    conversationHistoryRef.current = cachedHistory;
    setShowHistoryView(!selectedEmployee);
    setHistoryFilterMode('all');
    setHistoryScope('customer');
  };

  const handleSelectEmployee = (employee: Employee) => {
    messagesLoadRequestRef.current += 1;
    if (selectedEmployee?.id === employee.id) {
      setSelectedEmployee(null);
      setMessages([]);
      return;
    }
    setMessages([]);
    setMessagesLoading(true);
    setLoadingOlderMessages(false);
    setHasMoreMessages(false);
    if (selectedCustomer) {
      restoreCachedMessages(selectedCustomer.id, employee.id);
    }
    setSelectedEmployee(employee);
    setShowHistoryView(false);
    setFromHistorySource('none');
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdminId || savingCustomer) return;

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

    setSavingCustomer(true);
    try {
      const customId = customerForm.isSuper ? (customerForm.customId || '').trim() : '';
      if (customId) {
        const { data: existingCustomer, error: existingCustomerError } = await supabase
          .from('simulated_customers')
          .select('id')
          .eq('customer_id', customId)
          .eq('source_type', 'aaa_service')
          .maybeSingle();

        if (existingCustomerError) throw existingCustomerError;
        if (existingCustomer) {
          setNotification({ type: 'error', text: 'This Custom ID is already in use. Please use a different one.' });
          return;
        }
      }

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
        source_type: 'aaa_service',
      };

      if (customId) {
        insertData.customer_id = customId;
      }

      const { data: createdCustomer, error } = await supabase
        .from('simulated_customers')
        .insert(insertData)
        .select('id')
        .single();

      if (error) throw error;

      if (createdCustomer) {
        if (autoMessageDrafts.length > 0) {
          const { error: autoMessagesError } = await supabase
            .from('customer_auto_messages')
            .insert(autoMessageDrafts.map(({ message_type, name, title, subtitle, content, content_type, sort_order, is_enabled }) => ({
              customer_id: createdCustomer.id,
              admin_id: selectedAdminId,
              message_type,
              name,
              title,
              subtitle,
              content,
              content_type,
              sort_order,
              is_enabled,
            })));
          if (autoMessagesError) throw autoMessagesError;
        }

        const { error: autoMessagesSettingError } = await supabase
          .from('simulated_customers')
          .update({ auto_messages_enabled: autoMessageDraftMasterEnabled })
          .eq('id', createdCustomer.id);
        if (autoMessagesSettingError) throw autoMessagesSettingError;
      }

      setNotification({ type: 'success', text: 'Customer created successfully!' });
      setShowCustomerForm(false);
      setEditingCustomer(null);
      setAutoMessageDrafts([]);
      setAutoMessageDraftMasterEnabled(false);
      setCustomerForm({ name: '', avatar: 'customer-avatar:regular:0', isSuper: false, superTitle: '', customId: '', badgeType: '', vipLabel: 'VIP', customAvatarFile: null, useCustomAvatar: false, remarks: '' });
      loadAdminData(selectedAdminId, true, true);
    } catch (error: any) {
      const msg = (error.message || '').includes('customer_id_unique') ? 'This Custom ID is already in use. Please use a different one.' : (error.message || 'Failed to create customer');
      setNotification({ type: 'error', text: msg });
    } finally {
      setSavingCustomer(false);
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
      let customAvatarUrl: string | null = editingCustomer.custom_avatar_url ?? null;

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

      setNotification({ type: 'success', text: 'Customer updated successfully!' });
      setEditingCustomer(null);
      setCustomerForm({ name: '', avatar: 'customer-avatar:regular:0', isSuper: false, superTitle: '', customId: '', badgeType: '', vipLabel: 'VIP', customAvatarFile: null, useCustomAvatar: false, remarks: '' });
      loadAdminData(selectedAdminId, true, true);
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
          const { error } = await supabase
            .from('simulated_customers')
            .delete()
            .eq('id', customerId);

          if (error) throw error;

          invalidateAdminWorkspaceDataCache(selectedAdminId || adminId, 'customer');
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

    pendingImageMessagesRef.current.set(tempId, tempMessage);
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

      const elapsed = Date.now() - startTime;
      if (elapsed < 400) await new Promise(r => setTimeout(r, 400 - elapsed));

      animateProgressTo(20, 85, 400);
      await new Promise(r => setTimeout(r, 400));

      const { data: { publicUrl } } = supabase.storage
        .from('chat-images')
        .getPublicUrl(filePath);

      animateProgressTo(85, 100, 400);
      await new Promise(r => setTimeout(r, 400));

      const pendingMessage = pendingImageMessagesRef.current.get(tempId);
      if (pendingMessage) {
        pendingImageMessagesRef.current.set(tempId, { ...pendingMessage, image_url: publicUrl });
      }
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, image_url: publicUrl } : m));

      justSentRef.current = true;
      setTimeout(() => { justSentRef.current = false; }, 3000);

      const { error: insertError } = await supabase
        .from('customer_employee_conversations')
        .insert({
          customer_id: selectedCustomer.id,
          employee_id: selectedEmployee.id,
          sender_type: 'customer',
          message_content: '[Image]',
          message_type: 'image',
          image_url: publicUrl,
          is_read: false,
          source_type: 'aaa_service',
        });

      if (insertError) throw insertError;

      uploadingTempIdRef.current = null;
      setUploadingImage(false);
      setUploadProgress(0);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      void loadConversationHistory();
    } catch (error: any) {
      pendingImageMessagesRef.current.delete(tempId);
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
    if (msg.message_type === 'image' && msg.image_url) {
      const isUploading = uploadingImage && uploadingTempIdRef.current === msg.id;
      return (
        <div className="relative inline-flex w-fit max-w-full flex-col overflow-hidden rounded-lg" style={{ width: 'fit-content', height: 'fit-content', maxWidth: '200px', backgroundColor: 'transparent' }}>
          <img
            src={msg.image_url}
            alt="Shared image"
            className="block rounded-lg object-contain cursor-pointer hover:opacity-90 transition-opacity shadow-sm"
            style={{ width: 'auto', height: 'auto', maxWidth: '200px', maxHeight: '250px' }}
            loading="lazy"
            onClick={(e: React.MouseEvent) => { if (!isUploading) { e.stopPropagation(); e.preventDefault(); setPreviewImage(msg.image_url || null); setAdminImageZoom(1); setAdminImageDrag({ x: 0, y: 0 }); } }}
          />
          {isUploading && (
            <div className="absolute inset-0 bg-black/20 backdrop-blur-[1px] flex flex-col items-center justify-center rounded-lg z-10">
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

    if (msg.message_type === 'tip' && msg.rating_data) {
      const tipAmt = msg.rating_data.tip_amount || 0;
      return (
        <div className="my-2">
          <div className="w-[232px] overflow-hidden rounded-2xl border border-amber-300/45 bg-gradient-to-br from-amber-300/80 via-orange-400 to-amber-700 p-px shadow-xl shadow-amber-950/35">
            <div className="relative overflow-hidden rounded-[15px] bg-gradient-to-br from-amber-950 via-orange-900 to-amber-950 px-4 py-3.5">
              <div className="absolute -right-8 -top-10 h-28 w-28 rounded-full bg-amber-300/15 blur-2xl" />
              <div className="absolute -bottom-10 -left-8 h-24 w-24 rounded-full bg-orange-300/10 blur-2xl" />
              <div className="absolute inset-0 opacity-[0.07]" style={{
                backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(255,255,255,0.65) 3px, rgba(255,255,255,0.65) 4px),
                  repeating-linear-gradient(-45deg, transparent, transparent 3px, rgba(255,255,255,0.4) 3px, rgba(255,255,255,0.4) 4px)`
              }} />
              <div className="relative">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="flex h-6 w-6 items-center justify-center rounded-lg border border-amber-200/30 bg-amber-200/15">
                      <Gift className="h-3.5 w-3.5 text-amber-100" />
                    </span>
                    <span className="text-[9px] font-black uppercase tracking-[0.16em] text-amber-100">Tip Sent</span>
                  </div>
                  <span className="rounded-full border border-amber-200/25 bg-white/10 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider text-amber-100/90">Thank you</span>
                </div>
                <div className="py-3 text-center">
                  <div className="flex items-baseline justify-center text-white" style={{ textShadow: '0 3px 8px rgba(0,0,0,0.3)' }}>
                    <span className="mr-0.5 text-xl font-black">$</span>
                    <span className="text-[30px] font-black leading-none tracking-tight">{tipAmt.toFixed(2)}</span>
                  </div>
                  <p className="mt-1 text-[10px] font-medium text-amber-100/75">Service appreciation</p>
                </div>
                <div className="flex items-center justify-center gap-1 border-t border-amber-100/15 pt-2 text-[9px] font-semibold tracking-wide text-amber-100/80">
                  <Star className="h-3 w-3 fill-amber-200/70 text-amber-200" />
                  <span>Sent with appreciation</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    const content = msg.message_content;
    const hasHtml = /<[a-z][\s\S]*>/i.test(content);
    const imageOnlyUrl = hasHtml ? extractImageOnlyUrl(content) : null;
    if (imageOnlyUrl) {
      return (
        <div className="relative inline-flex w-fit max-w-full flex-col overflow-hidden rounded-lg" style={{ width: 'fit-content', height: 'fit-content', maxWidth: '200px', backgroundColor: 'transparent' }}>
          <img
            src={imageOnlyUrl}
            alt="Shared image"
            className="block rounded-lg object-contain cursor-pointer hover:opacity-90 transition-opacity shadow-sm"
            style={{ width: 'auto', height: 'auto', maxWidth: '200px', maxHeight: '250px' }}
            loading="lazy"
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); setPreviewImage(imageOnlyUrl); setAdminImageZoom(1); setAdminImageDrag({ x: 0, y: 0 }); }}
          />
        </div>
      );
    }
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
          is_read: false,
          source_type: 'aaa_service',
        })
        .select()
        .single();

      if (error) {
        setMessages(prev => prev.filter(m => m.id !== tempMessage.id));
        throw error;
      }

      if (newMsg) {
        const cacheKey = `${selectedCustomer.id}:${selectedEmployee.id}`;
        const cachedMessages = conversationMessagesCacheRef.current.get(cacheKey) || [];
        conversationMessagesCacheRef.current.set(cacheKey, [
          ...cachedMessages.filter(message => message.id !== tempMessage.id && message.id !== newMsg.id),
          newMsg,
        ]);
        setMessages(prev => prev.map(m => m.id === tempMessage.id ? newMsg : m));
      }
      loadConversationHistory();
    } catch (error: any) {
      setNotification({ type: 'error', text: error.message || 'Failed to send message' });
    }
  };

  const handleDeleteMessage = (messageId: string) => {
    setConfirmDialog({
      show: true,
      title: 'Delete Message',
      message: 'Are you sure you want to delete this message?',
      onConfirm: async () => {
        try {
          console.log('Attempting to delete message:', messageId);
          const { data, error } = await supabase
            .from('customer_employee_conversations')
            .delete()
            .eq('id', messageId)
            .select();

          console.log('Delete response:', { data, error });

          if (error) {
            console.error('Delete error:', error);
            throw error;
          }

          setNotification({ type: 'success', text: 'Message deleted successfully' });
          loadMessages();
          loadConversationHistory();
        } catch (error: any) {
          console.error('Delete failed:', error);
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

  const extractStoragePath = (publicUrl: string): string | null => {
    const marker = '/object/public/chat-images/';
    const idx = publicUrl.indexOf(marker);
    return idx === -1 ? null : publicUrl.substring(idx + marker.length);
  };

  const cleanupStorageImage = async (imageUrl: string) => {
    const path = extractStoragePath(imageUrl);
    if (!path) return;
    try {
      await supabase.storage.from('chat-images').remove([path]);
    } catch {}
  };

  const handleReplaceImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const msgId = replacingImageMsgIdRef.current;
    if (!file || !msgId) return;
    if (!file.type.startsWith('image/')) {
      setNotification({ type: 'error', text: 'Please select an image file' });
      return;
    }
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
          conversationMessagesCacheRef.current.delete(`${selectedCustomer.id}:${selectedEmployee.id}`);
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

  if (loading && isSuperAdmin && !selectedAdminId && !initialEmployee) {
    return (
      <AdminGroupPicker
        service="customer"
        groups={adminGroups}
        unreadCounts={adminUnreadCounts}
        fallbackUnreadCount={unreadCount}
        loading
        onSelect={handleAdminGroupSelect}
        onRefresh={() => { void loadAdminGroups(null, false, true); }}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-orange-400/20 border-t-orange-400" />
          <span className="text-sm">Loading workspace...</span>
        </div>
      </div>
    );
  }

  if (isSuperAdmin && !selectedAdminId && !initialEmployee) {
    return (
      <AdminGroupPicker
        service="customer"
        groups={adminGroups}
        unreadCounts={adminUnreadCounts}
        fallbackUnreadCount={unreadCount}
        loading={false}
        onSelect={handleAdminGroupSelect}
        onRefresh={() => { void loadAdminGroups(null, false, true); }}
      />
    );
  }

  return (
    <div ref={containerRef} className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden px-2 pb-2 pt-3 sm:px-3 sm:pb-3 sm:pt-4">
      {/* Info Bar + History/New Buttons in one row */}
      <div className="flex min-h-10 min-w-0 flex-shrink-0 flex-wrap items-center gap-2">
        {isSuperAdmin && selectedAdminId && (
          <button
            type="button"
            onClick={handleBackToGroups}
            className="flex items-center gap-1.5 px-3 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg transition-colors text-xs font-medium flex-shrink-0 border border-orange-300/70 shadow-md shadow-orange-600/30"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
        )}
        {isSuperAdmin && selectedAdminId && (
          <div className="flex items-center gap-2 px-3 h-10 bg-orange-950/50 border border-orange-400/50 rounded-lg flex-shrink-0">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse flex-shrink-0"></div>
            <span className="text-[10px] font-bold text-orange-200 uppercase tracking-wider flex-shrink-0">Managing</span>
            <div className="h-4 w-px bg-orange-400/40 flex-shrink-0"></div>
            <div className="p-1 bg-gradient-to-br from-orange-500 to-amber-500 rounded flex-shrink-0">
              <User className="w-3 h-3 text-white" />
            </div>
            <span className="text-sm font-bold text-white truncate">{selectedAdminName}</span>
          </div>
        )}
        {selectedEmployee && (
          <div className="flex items-center gap-2 px-3 h-10 bg-orange-700 border border-orange-400/70 rounded-lg flex-shrink-0">
            <div className="w-7 h-7 bg-orange-100 rounded-md flex items-center justify-center flex-shrink-0">
              <MessageCircle className="w-3.5 h-3.5 text-orange-700" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-white leading-none truncate" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>{selectedEmployee?.username} <span className="text-[10px] font-medium text-orange-100">ID: {selectedEmployee?.employee_id}</span></div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedEmployee(null)}
              className="ml-1 p-1 hover:bg-orange-800 rounded-md transition-colors text-orange-100 hover:text-white"
              title="Clear selection"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="ml-auto flex max-w-full flex-shrink-0 flex-wrap items-center justify-end gap-2">
          {(() => {
            const sessionUnreadCount = workspaceConversationHistory.reduce((total, history) => total + history.unread_count, 0);
            const totalUnread = Math.max(sessionUnreadCount, unreadCount);
            return (
              <>
                <button
                  type="button"
                  onClick={() => { setSelectedEmployee(null); setSelectedCustomer(null); setShowHistoryView(true); setHistoryFilterMode('all'); setHistoryScope('all'); historyScrollTopRef.current = 0; void loadAllConversationHistory(true); }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all border-2 ${
                    showHistoryView && historyScope === 'all' && historyFilterMode !== 'new'
                      ? 'bg-orange-600 text-white shadow-lg shadow-orange-500/40 border-orange-300'
                      : 'bg-orange-950/50 hover:bg-orange-800/50 border-orange-500/50 hover:border-orange-300/70 text-orange-200 hover:text-orange-100 shadow-lg shadow-orange-950/30 hover:shadow-orange-900/40'
                  }`}
                >
                  <Clock className="w-4 h-4" />
                  <span>All History</span>
                  {workspaceConversationHistory.length > 0 && (
                    <span className={`ml-1 px-2 py-0.5 rounded-full text-xs font-black min-w-[24px] text-center ${
                      showHistoryView && historyScope === 'all' && historyFilterMode !== 'new'
                        ? 'bg-white text-orange-700'
                        : 'bg-orange-500 text-white'
                    }`}>{workspaceConversationHistory.length}</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => { setSelectedEmployee(null); setSelectedCustomer(null); setShowHistoryView(true); setHistoryFilterMode('new'); setHistoryScope('all'); historyScrollTopRef.current = 0; void loadAllConversationHistory(true); }}
                  className={`relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all border-2 ${
                    totalUnread > 0
                      ? `${showHistoryView && historyScope === 'all' && historyFilterMode === 'new'
                        ? 'bg-orange-600 text-white shadow-lg shadow-orange-500/40 border-orange-300'
                        : 'bg-orange-950/50 hover:bg-orange-800/50 border-orange-500/50 hover:border-orange-300/70 text-orange-200 hover:text-orange-100 shadow-lg shadow-orange-950/30 hover:shadow-orange-900/40'} session-unread-action`
                      : showHistoryView && historyScope === 'all' && historyFilterMode === 'new'
                        ? 'bg-orange-600 text-white shadow-lg shadow-orange-500/40 border-orange-300'
                        : 'bg-orange-950/50 hover:bg-orange-800/50 border-orange-500/50 hover:border-orange-300/70 text-orange-200 hover:text-orange-100 shadow-lg shadow-orange-950/30 hover:shadow-orange-900/40'
                  }`}
                >
                  <MessageSquarePlus className="w-4 h-4" />
                  <span>All New</span>
                  {totalUnread > 0 && (
                    <span className={`ml-1 px-2 py-0.5 rounded-full text-xs font-black min-w-[24px] text-center ${
                      showHistoryView && historyScope === 'all' && historyFilterMode === 'new'
                        ? 'bg-white text-orange-700'
                        : 'bg-orange-500 text-white'
                    } ${totalUnread > 0 ? 'session-unread-count' : ''}`}>{totalUnread}</span>
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
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto lg:flex-row lg:overflow-hidden">

        {/* Left: Customer Sidebar */}
        <div className="flex h-[260px] w-full flex-shrink-0 flex-col overflow-hidden rounded-2xl border border-orange-300/30 bg-gradient-to-b from-slate-900 via-slate-900/95 to-orange-950/35 shadow-2xl shadow-orange-950/25 ring-1 ring-white/[0.03] backdrop-blur-xl lg:h-auto lg:w-[clamp(13rem,20vw,18rem)]">
          {/* Sidebar Header */}
          <div className="border-b border-orange-300/20 bg-gradient-to-r from-orange-500/10 via-slate-800/70 to-transparent p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.12em] text-orange-50">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg border border-orange-300/30 bg-orange-500/15 shadow-sm shadow-orange-950/20">
                  <Users className="h-3.5 w-3.5 text-orange-200" />
                </span>
                Customers
              </h3>
              <button
                type="button"
                onClick={() => setShowCustomerForm(!showCustomerForm)}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-orange-200/30 bg-orange-500/80 text-white shadow-md shadow-orange-950/30 transition-all duration-200 hover:-translate-y-0.5 hover:border-orange-100/70 hover:bg-orange-400 hover:shadow-lg hover:shadow-orange-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-200/70"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex gap-1 rounded-xl border border-white/[0.06] bg-slate-950/60 p-1 shadow-inner shadow-black/20">
              <button
                onClick={() => setCustomerFilter('all')}
                className={`flex-1 px-2 py-1.5 text-[10px] font-bold rounded-md transition-all duration-200 flex items-center justify-center gap-1 ${
                  customerFilter === 'all'
                    ? 'bg-orange-500/90 text-white shadow-md shadow-orange-950/35 ring-1 ring-orange-200/30'
                    : 'text-slate-400 hover:bg-orange-500/10 hover:text-orange-100'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setCustomerFilter('super')}
                className={`flex-1 px-2 py-1.5 text-[10px] font-bold rounded-md transition-all duration-200 flex items-center justify-center gap-1 ${
                  customerFilter === 'super'
                    ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md shadow-amber-950/35 ring-1 ring-amber-200/30'
                    : 'text-slate-400 hover:bg-amber-500/10 hover:text-amber-100'
                }`}
              >
                <Star className="w-2.5 h-2.5" fill={customerFilter === 'super' ? 'currentColor' : 'none'} />
                VIP
              </button>
              <button
                onClick={() => setCustomerFilter('regular')}
                className={`flex-1 px-2 py-1.5 text-[10px] font-bold rounded-md transition-all duration-200 flex items-center justify-center gap-1 ${
                  customerFilter === 'regular'
                    ? 'bg-emerald-500/90 text-white shadow-md shadow-emerald-950/35 ring-1 ring-emerald-200/30'
                    : 'text-slate-400 hover:bg-emerald-500/10 hover:text-emerald-100'
                }`}
              >
                Reg
              </button>
            </div>
          </div>

          {/* Customer List - Scrollable */}
          <div className="flex-1 overflow-y-auto bg-gradient-to-b from-slate-950/20 via-transparent to-orange-950/10 p-2.5 space-y-1.5 scrollbar-dark">
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
                const aUnread = customerUnreadCountsForCards[a.id] || 0;
                const bUnread = customerUnreadCountsForCards[b.id] || 0;
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
                className={`group relative cursor-pointer rounded-xl transition-all duration-200 hover:-translate-y-px focus-within:ring-2 focus-within:ring-orange-300/60 ${
                  customer.is_super
                    ? selectedCustomer?.id === customer.id
                      ? 'border border-amber-200/80 bg-gradient-to-br from-amber-500 via-orange-500 to-amber-600 p-3.5 shadow-xl shadow-amber-950/40 ring-1 ring-amber-100/30'
                      : 'border border-amber-400/35 bg-gradient-to-br from-slate-800/95 to-amber-950/35 p-3 shadow-md shadow-amber-950/20 hover:border-amber-300/75 hover:shadow-lg hover:shadow-amber-950/35'
                    : selectedCustomer?.id === customer.id
                      ? 'border border-orange-200/80 bg-gradient-to-r from-orange-600 via-orange-500 to-amber-500 p-2.5 shadow-xl shadow-orange-950/40 ring-1 ring-orange-100/30'
                      : 'border border-slate-700/60 bg-slate-800/55 p-2 hover:border-orange-300/65 hover:bg-orange-950/35 hover:shadow-lg hover:shadow-orange-950/35'
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
                  const count = customerUnreadCountsForCards[customer.id] || 0;
                  return count > 0 && (
                    <div className="absolute -top-2 -right-2 min-w-[22px] h-[22px] px-1.5 bg-orange-500 rounded-full flex items-center justify-center z-20 shadow-lg shadow-orange-500/40 ring-2 ring-slate-900/80">
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
                    <CustomerAvatarDisplay
                      avatar={customer.customer_avatar}
                      isVip={customer.is_super}
                      customAvatarUrl={customer.custom_avatar_url}
                      alt={customer.customer_name}
                      className={`rounded-full ${
                        customer.is_super
                          ? selectedCustomer?.id === customer.id ? 'w-11 h-11' : 'w-10 h-10'
                          : selectedCustomer?.id === customer.id ? 'w-9 h-9' : 'w-8 h-8'
                      } ${
                        selectedCustomer?.id === customer.id
                          ? customer.is_super ? 'bg-amber-800/40 ring-2 ring-white/50' : 'bg-white/20 ring-1 ring-white/30'
                          : customer.is_super ? 'bg-amber-900/50 ring-2 ring-amber-400/50' : 'bg-slate-700 ring-1 ring-slate-500/40'
                      }`}
                    />
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
                          remarks: customer.remarks || ''
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
        <div className="flex h-[240px] w-full flex-shrink-0 flex-col overflow-hidden rounded-xl border border-orange-400/30 bg-gradient-to-b from-orange-950/25 via-slate-900/90 to-slate-950/80 shadow-xl shadow-orange-950/20 backdrop-blur-xl lg:h-auto lg:w-[clamp(11rem,17vw,16rem)]">
          {/* Employee Header */}
          <div className="p-2 border-b border-orange-500/40 bg-slate-800/60 space-y-1.5">
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
                  <button
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      setSearchQuery('');
                    }}
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear employee search"
                    className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md border border-orange-300/60 bg-orange-700/80 text-orange-50 shadow-sm transition-colors hover:bg-orange-600 hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              {allTags.length > 0 && (
                <div className="relative flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowTagDropdown(!showTagDropdown)}
                    className={`relative flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-bold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70 ${selectedTags.length > 0 ? 'border-orange-300/70 bg-orange-500/25 text-orange-50 shadow-md shadow-orange-950/30' : 'border-orange-300/30 bg-slate-900/55 text-orange-200 hover:border-orange-200/70 hover:bg-orange-500/15 hover:text-orange-100'}`}
                    title="Filter by tags"
                  >
                    <Tag className="w-3.5 h-3.5" />
                    {selectedTags.length > 0 && (
                      <span className="flex h-4 min-w-[18px] items-center justify-center rounded-md border border-orange-200/30 bg-orange-300 px-1 text-[9px] font-black text-orange-950 shadow-sm">{selectedTags.length}</span>
                    )}
                  </button>
                  {selectedTags.length > 0 && (
                    <button
                      type="button"
                      onClick={() => { setSelectedTags([]); setShowTagDropdown(false); }}
                      className="flex items-center justify-center rounded-xl border border-rose-300/35 bg-rose-500/10 px-1.5 py-1.5 text-rose-200 shadow-sm shadow-rose-950/20 transition-all duration-200 hover:-translate-y-0.5 hover:border-rose-200/80 hover:bg-rose-500 hover:text-white hover:shadow-md hover:shadow-rose-950/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/70"
                      title="Clear all tags"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {showTagDropdown && (
                    <>
                      <div className="fixed inset-0 z-20" onMouseDown={() => setShowTagDropdown(false)} />
                      <div className="absolute right-0 top-full z-30 mt-2 min-w-[180px] max-h-56 overflow-y-auto rounded-2xl border border-orange-300/35 bg-slate-900 p-2 shadow-2xl shadow-orange-950/35 ring-1 ring-orange-200/10 scrollbar-dark">
                        {allTags.map((tag) => {
                          const isSelected = selectedTags.includes(tag);
                          return (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => isSelected ? setSelectedTags(selectedTags.filter(t => t !== tag)) : setSelectedTags([...selectedTags, tag])}
                              className={`flex w-full cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-xs font-semibold transition-all duration-200 mb-1 last:mb-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70 ${
                                isSelected
                                  ? 'border-orange-300/45 bg-orange-500/20 text-orange-50 shadow-sm shadow-orange-950/25'
                                  : 'border-transparent bg-transparent text-slate-300 hover:border-orange-300/20 hover:bg-orange-500/10 hover:text-orange-100'
                              }`}
                            >
                              <span className={`w-3.5 h-3.5 rounded flex items-center justify-center flex-shrink-0 border transition-colors ${
                                isSelected
                                  ? 'border-orange-100 bg-orange-100'
                                  : 'border-orange-300/40 bg-white'
                              }`}>
                                {isSelected && <Check className="h-2.5 w-2.5 text-orange-600" />}
                              </span>
                              {tag}
                            </button>
                          );
                        })}
                        {selectedTags.length > 0 && (
                          <button type="button" onClick={() => { setSelectedTags([]); setShowTagDropdown(false); }} className="mt-2 w-full rounded-xl border border-rose-300/30 bg-rose-500/10 px-2 py-1.5 text-center text-xs font-bold text-rose-200 transition-all duration-200 hover:border-rose-200/70 hover:bg-rose-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/70">Clear all</button>
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
            <div ref={employeeListRef} className="flex-1 overflow-y-auto p-1.5 scrollbar-dark">
              <div className="space-y-0.5">
                {filteredEmployees.map((emp) => (
                  <button
                    type="button"
                    key={emp.id}
                    onMouseEnter={() => {
                      if (selectedCustomer) void prefetchMessages(selectedCustomer.id, emp.id);
                    }}
                    onClick={() => handleSelectEmployee(emp)}
                    className={`group relative min-h-[72px] w-full rounded-xl border px-2 py-2 text-left transition-all duration-200 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70 ${
                      selectedEmployee?.id === emp.id
                        ? 'border-orange-200/70 bg-gradient-to-r from-orange-600 via-orange-500 to-amber-500 shadow-lg shadow-orange-950/40 ring-1 ring-orange-200/40'
                        : 'border-slate-700/60 bg-slate-800/45 hover:border-orange-400/60 hover:bg-orange-950/45 hover:shadow-md hover:shadow-orange-950/35'
                    }`}
                  >
                    <div className={`flex min-w-0 items-center pr-1 ${selectedEmployee?.id === emp.id ? 'gap-2' : 'gap-1.5'}`}>
                      <div className="relative flex-shrink-0">
                        <div className={`rounded flex items-center justify-center ${
                          selectedEmployee?.id === emp.id ? 'h-9 w-9 bg-white/15 ring-1 ring-white/25' : 'h-7 w-7 border border-slate-700/70 bg-slate-900/70 group-hover:border-orange-400/50 group-hover:bg-orange-950/40'
                        }`}>
                          <User className={`${selectedEmployee?.id === emp.id ? 'h-4 w-4' : 'h-3 w-3'} ${selectedEmployee?.id === emp.id ? 'text-white' : 'text-slate-400 group-hover:text-orange-200'}`} />
                        </div>
                      </div>
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex min-w-0 items-center gap-1 leading-4">
                          <span className={`truncate font-bold leading-4 ${selectedEmployee?.id === emp.id ? 'text-[15px] text-white' : 'text-[11px] text-slate-200'}`} style={selectedEmployee?.id === emp.id ? { textShadow: '0 2px 6px rgba(0,0,0,0.5), 0 1px 2px rgba(0,0,0,0.3)' } : undefined}>{emp.username}</span>
                          {selectedEmployee?.id === emp.id && <span className="ml-auto flex-shrink-0 rounded bg-white/25 px-1.5 py-0.5 text-[9px] font-bold leading-relaxed text-white" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>ACTIVE</span>}
                        </div>
                        <div className={`truncate font-mono leading-3 ${selectedEmployee?.id === emp.id ? 'text-[11px] text-orange-100' : 'text-[10px] text-slate-400 group-hover:text-orange-200/80'}`} style={selectedEmployee?.id === emp.id ? { textShadow: '0 2px 4px rgba(0,0,0,0.45), 0 1px 1px rgba(0,0,0,0.25)' } : undefined}>ID: {emp.employee_id || '—'}</div>
                        <EmployeeMetadataPopover
                          kind="tag"
                          theme="orange"
                          values={emp.tags}
                          selected={selectedEmployee?.id === emp.id}
                          className="w-full max-w-full leading-3"
                        />
                        <EmployeeMetadataPopover
                          kind="note"
                          theme="orange"
                          value={emp.remarks}
                          selected={selectedEmployee?.id === emp.id}
                          className="w-full max-w-full leading-3"
                        />
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
          <div className="relative flex min-h-[420px] min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-orange-400/30 bg-slate-950/75 shadow-2xl shadow-orange-950/15 backdrop-blur-xl">
          {/* History / Sessions Panel */}
          <div className={`absolute inset-0 transition-all duration-300 ease-in-out ${
            showHistoryView || (selectedCustomer && !selectedEmployee)
              ? 'opacity-100 translate-y-0 z-10 pointer-events-auto'
              : 'opacity-0 translate-y-2 z-0 pointer-events-none'
          }`}>
            <div className="flex h-full flex-col overflow-hidden rounded-xl border border-orange-400/35 bg-gradient-to-b from-orange-950/20 via-slate-900/90 to-slate-950/95 shadow-2xl shadow-orange-950/20 backdrop-blur-xl">
              {/* Active Sessions Header */}
              <div className="flex h-[72px] min-h-[72px] shrink-0 items-center overflow-hidden border-b border-orange-400/35 bg-gradient-to-r from-slate-900 via-slate-800/95 to-orange-950/25 px-3 py-2">
                <div className="flex min-w-0 w-full flex-nowrap items-center gap-2">
                  <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-hidden">
                    {selectedCustomer ? (
                      <CustomerAvatarDisplay
                        avatar={selectedCustomer?.customer_avatar}
                        isVip={selectedCustomer?.is_super}
                        customAvatarUrl={selectedCustomer?.custom_avatar_url}
                        alt={selectedCustomer?.customer_name}
                        className="h-10 w-10 flex-shrink-0 rounded-full bg-slate-700/50 ring-2 ring-slate-600/50"
                      />
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
                  <div className="flex min-w-0 max-w-[58%] items-center gap-1">
                    <div className="relative min-w-0 flex-1 basis-[120px]">
                      <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-orange-300/90" />
                      <input
                        type="text"
                        value={historySearchQuery}
                        onChange={(event) => setHistorySearchQuery(event.target.value)}
                        placeholder="Search sessions..."
                        aria-label="Search active sessions"
                        className="h-8 w-full min-w-0 rounded-lg border border-orange-700/80 bg-slate-700/90 pl-7 pr-7 text-[10px] font-semibold text-slate-100 outline-none transition-colors placeholder:text-slate-400 focus:border-orange-400/80 focus:bg-slate-700 focus:ring-2 focus:ring-orange-400/30"
                      />
                      {historySearchQuery && (
                        <button
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            setHistorySearchQuery('');
                          }}
                          onClick={() => setHistorySearchQuery('')}
                          aria-label="Clear session search"
                          className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border border-slate-400/60 bg-slate-800 text-slate-100 shadow-sm transition-colors hover:border-orange-300/80 hover:bg-orange-700/80 hover:text-white"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  {historyScope === 'customer' && (
                  <div className="flex items-center gap-2">
                      {(() => {
                        const customerHistory = selectedCustomer
                          ? conversationHistoryForView.filter(history => history.customer_id === selectedCustomer.id)
                          : [];
                        const scoped = selectedEmployee
                          ? customerHistory.filter(history => history.employee_id === selectedEmployee.id)
                          : customerHistory;
                        const scopedNew = scoped.filter(history => history.unread_count > 0).length;
                        return (
                          <>
                            <button type="button" onClick={() => setHistoryFilterMode('all')} className={`relative flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${historyFilterMode !== 'new' ? 'bg-emerald-600 text-white' : 'bg-slate-700/50 text-slate-300 ring-1 ring-slate-600/50 hover:bg-slate-600/50 hover:text-white'}`}>
                              <span>All</span>
                              {scoped.length > 0 && (
                                <span className={`inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full text-[11px] font-black ${historyFilterMode !== 'new' ? 'bg-white text-emerald-700' : 'bg-slate-500/50 text-slate-200'}`}>{scoped.length}</span>
                              )}
                            </button>
                            <button type="button" onClick={() => setHistoryFilterMode('new')} className={`relative flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${scopedNew > 0 ? 'session-unread-action text-white shadow-lg shadow-orange-500/30' : historyFilterMode === 'new' ? 'bg-orange-500 text-white' : 'bg-slate-700/50 text-slate-300 ring-1 ring-slate-600/50 hover:bg-slate-600/50 hover:text-white'}`}>
                              {scopedNew > 0 && historyFilterMode !== 'new' && (
                                <span className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-orange-500 rounded-full ring-2 ring-slate-900" />
                              )}
                              <span>New</span>
                              {scopedNew > 0 ? (
                                <span className={`inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full text-[11px] font-black ${historyFilterMode === 'new' ? 'bg-white text-orange-600' : 'bg-orange-500 text-white'} ${scopedNew > 0 ? 'session-unread-count' : ''}`}>{scopedNew}</span>
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
                {visibleConversationHistory.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-400">
                    <MessageCircle className="w-16 h-16 mb-4 opacity-50" />
                    <p>No active sessions</p>
                    <p className="text-xs mt-2">Start a conversation to see it here</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {visibleConversationHistory.map((history) => {
                        const employee = workspaceEmployeesById.get(history.employee_id);
                        const historyCustomer = history.customer_id
                          ? workspaceCustomersById.get(history.customer_id)
                            || allCustomersRef.current.find(c => c.id === history.customer_id)
                          : null;
                        const isSelected = selectedEmployee?.id === history.employee_id && selectedCustomer?.id === history.customer_id;
                        const cardKey = `${history.customer_id || ''}_${history.employee_id}`;
                        const lastTime = new Date(history.last_message_time);
                        const timeStr = `${lastTime.getFullYear()}/${String(lastTime.getMonth() + 1).padStart(2, '0')}/${String(lastTime.getDate()).padStart(2, '0')} ${lastTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                        const hasUnread = history.unread_count > 0;
                        const employeeTags = employee?.tags?.length
                          ? employee.tags
                          : history.employee_tags || [];
                        const employeeNote = employee?.remarks?.trim()
                          || history.employee_remarks?.trim()
                          || '';
                        const hasImg = /<img\s/i.test(history.last_message);
                        const plainMessage = history.last_message.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
                        const isPhoto = history.last_message === '__IMAGE__' || (!plainMessage && hasImg);
                        return (
                          <div key={cardKey} className="relative">
                            <button
                              type="button"
                              onMouseEnter={() => {
                                if (history.customer_id) void prefetchMessages(history.customer_id, history.employee_id);
                              }}
                              onClick={() => {
                                const emp = employee
                                  || workspaceEmployeesById.get(history.employee_id)
                                  || allEmployeesRef.current.find(e => e.id === history.employee_id)
                                  || {
                                    id: history.employee_id,
                                    username: history.employee_username || 'Employee',
                                    employee_id: history.employee_number || '',
                                    is_verified: true,
                                    is_active: true,
                                    remarks: history.employee_remarks || '',
                                    tags: history.employee_tags || [],
                                  };
                                const cust = history.customer_id
                                  ? workspaceCustomersById.get(history.customer_id)
                                    || allCustomersRef.current.find(c => c.id === history.customer_id)
                                    || {
                                      id: history.customer_id,
                                      admin_id: selectedAdminId || adminId,
                                      customer_name: history.customer_name || 'Customer',
                                      customer_id: history.customer_id,
                                      customer_avatar: history.customer_avatar || 'customer-avatar:regular:0',
                                      is_active: true,
                                      created_at: history.last_message_time || new Date().toISOString(),
                                      is_super: history.customer_avatar?.startsWith('customer-avatar:vip:') || false,
                                      custom_avatar_url: history.custom_avatar_url,
                                    }
                                  : null;
                                if (!cust) return;

                                if (historyListRef.current) {
                                  historyScrollTopRef.current = historyListRef.current.scrollTop;
                                }
                                setMessages([]);
                                setMessagesLoading(true);
                                restoreCachedMessages(cust.id, emp.id);
                                isInitialLoadRef.current = true;
                                clearUnreadConversationLocally(cust.id, emp.id);
                                setSelectedCustomer(cust);
                                handleSelectEmployee(emp);
                                setFromHistoryFilterMode(historyFilterMode);
                                setFromHistorySource(historyScope);
                              }}
                              className={`w-full px-3 py-2.5 rounded-lg transition-all duration-200 text-left group relative ${
                                isSelected
                                  ? 'bg-orange-500/20 border border-orange-300/70 shadow-md shadow-orange-500/20'
                                  : hasUnread
                                    ? 'bg-gradient-to-r from-orange-950/40 to-amber-950/25 border border-orange-400/60 hover:border-orange-200/90 shadow-sm shadow-orange-500/20'
                                    : 'bg-slate-800/30 hover:bg-orange-900/25 border border-slate-700/40 hover:border-orange-400/60 hover:shadow-md hover:shadow-orange-950/30'
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
                                      <CustomerAvatarDisplay
                                        avatar={historyCustomer?.customer_avatar || history.customer_avatar}
                                        isVip={historyCustomer?.is_super || (historyCustomer?.customer_avatar || history.customer_avatar)?.startsWith('customer-avatar:vip:')}
                                        customAvatarUrl={historyCustomer?.custom_avatar_url || history.custom_avatar_url}
                                        alt={history.customer_name || 'Customer avatar'}
                                        className="h-9 w-9 rounded-full"
                                      />
                                    </div>
                                  ) : (
                                    <div className={`w-9 h-9 rounded-full flex items-center justify-center ring-2 ${
                                      isSelected ? 'ring-blue-500/40 bg-blue-950/50' : 'ring-slate-600/30 bg-slate-700/50'
                                    }`}>
                                      <User className={`w-4 h-4 ${isSelected ? 'text-blue-300' : 'text-slate-400'}`} />
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
                                      hasUnread ? 'text-orange-300 font-bold' : 'text-orange-200/90 font-semibold'
                                    }`}>{timeStr}</span>
                                  </div>
                                  {hasUnread && (
                                    <div className="absolute right-3 top-1/2 z-10 flex min-w-[30px] h-[30px] -translate-y-1/2 items-center justify-center rounded-full border-2 border-slate-900 bg-gradient-to-br from-orange-500 to-amber-500 px-2 shadow-md shadow-orange-500/40 animate-pulse">
                                      <span className="text-[12px] font-black leading-none text-white drop-shadow-sm">{history.unread_count > 99 ? '99+' : history.unread_count}</span>
                                    </div>
                                  )}

                                  <div className="flex items-center gap-1.5 mb-1">
                                    <span className={`text-xs font-semibold truncate ${isSelected ? 'text-slate-200' : 'text-slate-300'}`}>{history.employee_username}</span>
                                    <span className="text-[10px] text-orange-200/90 font-mono flex-shrink-0">ID: {history.employee_number || '—'}</span>
                                  </div>

                                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 pr-1">
                                    <EmployeeMetadataPopover
                                      kind="tag"
                                      theme="orange"
                                      values={employeeTags}
                                      selected={isSelected}
                                      className="relative min-w-0 max-w-[48%]"
                                    />
                                    <EmployeeMetadataPopover
                                      kind="note"
                                      theme="orange"
                                      value={employeeNote}
                                      selected={isSelected}
                                      className="relative min-w-0 max-w-[48%]"
                                    />
                                  </div>

                                  <p className={`mt-1 text-[11px] leading-relaxed truncate ${
                                    hasUnread ? 'text-orange-200 font-semibold' : 'text-slate-500'
                                  }`}>{hasUnread && <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-400 mr-1 mb-px" />}{isPhoto ? <span className="inline-flex items-center gap-1"><Image className="w-3 h-3" />Photo</span> : (plainMessage || 'No messages')}</p>
                                </div>
                              </div>
                            </button>
                          </div>
                        );
                      })}
                    {visibleConversationHistory.length === 0 && (
                      <div className="text-center py-6 text-slate-500">
                        <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p className="text-[10px]">
                          {historySearchQuery.trim()
                            ? 'No matching sessions'
                            : historyFilterMode === 'new'
                              ? 'No new messages'
                              : 'No sessions found'}
                        </p>
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
            <div className="flex h-full flex-col overflow-hidden rounded-xl border border-orange-400/35 bg-gradient-to-b from-orange-950/20 via-slate-900/90 to-slate-950/95 shadow-2xl shadow-orange-950/20 backdrop-blur-xl">
              {/* Chat Header */}
              <div className="flex h-[72px] min-h-[72px] shrink-0 items-center overflow-hidden border-b border-orange-400/35 bg-gradient-to-r from-slate-900 via-slate-800/95 to-orange-950/25 px-3 py-2">
                <div className="flex min-w-0 w-full flex-nowrap items-center gap-2">
                  <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => {
                        if (fromHistorySource === 'all') {
                          pendingScrollRestoreRef.current = true;
                          const cachedHistory = allConversationHistoryRef.current;
                          setConversationHistory(cachedHistory);
                          setAllConversationHistory(cachedHistory);
                          setSelectedEmployee(null);
                          setSelectedCustomer(null);
                          setShowHistoryView(true);
                          setHistoryFilterMode(fromHistoryFilterMode);
                          setHistoryScope('all');
                          void loadAllConversationHistory(true);
                        } else if (fromHistorySource === 'customer') {
                          pendingScrollRestoreRef.current = true;
                          const cachedHistory = conversationHistoryRef.current;
                          setConversationHistory(cachedHistory);
                          setSelectedEmployee(null);
                          setShowHistoryView(true);
                          setHistoryFilterMode(fromHistoryFilterMode);
                          setHistoryScope('customer');
                          void loadConversationHistory();
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
                    <div className="flex min-w-0 items-center gap-2">
                      <CustomerAvatarDisplay
                        avatar={selectedCustomer?.customer_avatar}
                        isVip={selectedCustomer?.is_super}
                        customAvatarUrl={selectedCustomer?.custom_avatar_url}
                        alt={selectedCustomer?.customer_name}
                        className="h-11 w-11 flex-shrink-0 rounded-full border border-slate-600/50 bg-slate-700/50"
                      />
                      <div className="min-w-0">
                        <div className="text-sm text-slate-100 font-bold leading-tight truncate">{selectedCustomer?.customer_name}</div>
                        {selectedCustomer?.is_super && selectedCustomer?.super_customer_title ? (
                          <div className="text-[11px] text-amber-400 font-medium leading-tight mt-0.5 truncate">{selectedCustomer?.super_customer_title}</div>
                        ) : null}
                        <div className="text-[10px] font-mono text-emerald-400 leading-tight mt-0.5">CUS-{selectedCustomer?.customer_id}</div>
                      </div>
                    </div>
                    <div className="h-8 w-px bg-orange-500/50 mx-1 flex-shrink-0"></div>
                    <div className="w-9 h-9 flex-shrink-0 rounded-lg border border-orange-300/30 bg-orange-500/20 flex items-center justify-center">
                      <User className="w-5 h-5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-white text-sm font-bold leading-tight truncate">{selectedEmployee?.username}</div>
                      <div className="text-[11px] text-orange-300 leading-tight mt-0.5 truncate">ID: {selectedEmployee?.employee_id}</div>
                    </div>
                    {serviceTicketNumber && (
                      <div className="flex max-w-[96px] items-center gap-1.5 rounded-lg border border-orange-400/30 bg-gradient-to-r from-orange-500/15 to-amber-500/10 px-2 py-1.5 ml-1 flex-shrink-0">
                        <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse"></div>
                        <span className="truncate text-[11px] text-orange-200 font-mono font-bold tracking-wide">{serviceTicketNumber}</span>
                      </div>
                    )}
                  </div>
                  <div className="ml-auto flex shrink-0 flex-nowrap items-center justify-end gap-1">
                    {(() => {
                      const customerHistory = selectedCustomer
                        ? conversationHistoryForView.filter(history => history.customer_id === selectedCustomer.id)
                        : [];
                      const totalUnread = customerHistory.reduce((sum, history) => sum + history.unread_count, 0);
                      return (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => {
                              const cachedHistory = Array.from(new Map(
                                [...allConversationHistoryRef.current, ...conversationHistoryRef.current]
                                  .filter(history => history.customer_id === selectedCustomer?.id)
                                  .map(history => [`${history.customer_id}:${history.employee_id}`, history] as const)
                              ).values());
                              setConversationHistory(cachedHistory);
                              conversationHistoryRef.current = cachedHistory;
                              setSelectedEmployee(null);
                              setShowHistoryView(true);
                              setHistoryFilterMode('all');
                              setFromHistorySource('none');
                              setHistoryScope('customer');
                              void loadConversationHistory();
                            }}
                            className="flex items-center gap-1.5 rounded-lg border border-orange-300/60 bg-orange-600 px-2.5 py-1.5 text-xs font-bold text-white shadow-md shadow-orange-600/30 transition-all hover:bg-orange-500 hover:shadow-orange-500/40"
                            title="History messages"
                          >
                            <Clock className="w-4 h-4" />
                            <span>History</span>
                            {customerHistory.length > 0 && <span className="px-1.5 py-px bg-white/20 rounded text-[10px] font-black">{customerHistory.length}</span>}
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
              <div className="flex min-h-9 shrink-0 items-center gap-2 overflow-hidden border-b border-orange-400/25 bg-slate-900/80 px-3 py-1.5">
                <span className="flex min-w-0 max-w-[45%] items-center gap-1.5 truncate rounded-md border border-orange-300/35 bg-orange-500/15 px-2 py-1 text-[10px] font-bold text-orange-100" title={selectedEmployee?.tags?.join(' · ') || 'No tag'}>
                  <Tag className="h-3 w-3 shrink-0 text-orange-300" />
                  <span className="truncate">{selectedEmployee?.tags?.length ? selectedEmployee.tags.join(' · ') : 'No tag'}</span>
                </span>
                <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate rounded-md border border-slate-500/45 bg-slate-800/70 px-2 py-1 text-[10px] font-medium text-slate-200" title={selectedEmployee?.remarks || 'No note'}>
                  <FileText className="h-3 w-3 shrink-0 text-slate-400" />
                  <span className="truncate">{selectedEmployee?.remarks?.trim() || 'No note'}</span>
                </span>
              </div>

              {/* Messages */}
              <div ref={messagesContainerCallbackRef} className="relative flex-1 overflow-y-auto flex flex-col-reverse scrollbar-dark" style={{
                background: 'linear-gradient(180deg, #24170f 0%, #1b1513 40%, #24170f 100%)',
                backgroundImage: `linear-gradient(180deg, #24170f 0%, #1b1513 40%, #24170f 100%), radial-gradient(circle at 20% 50%, rgba(249,115,22,0.05) 0%, transparent 50%), radial-gradient(circle at 80% 30%, rgba(245,158,11,0.04) 0%, transparent 50%)`
              }}>
                <div className="p-4 space-y-3 mb-auto">
                {messages.length === 0 ? (
                  !messagesLoading && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
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
                            <div className="mt-1 flex shrink-0 flex-col gap-1 rounded-xl border border-orange-200/20 bg-slate-950/70 p-1 opacity-70 shadow-lg shadow-black/20 backdrop-blur-sm transition-all duration-200 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                              <button
                                type="button"
                                onClick={() => handleStartEdit(msg)}
                                className="flex h-7 w-7 items-center justify-center rounded-lg border border-orange-300/20 bg-orange-500/10 text-orange-200 transition-all hover:-translate-y-0.5 hover:border-orange-200/70 hover:bg-orange-500 hover:text-white hover:shadow-md hover:shadow-orange-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
                                title={msg.message_type === 'image' ? 'Replace image' : 'Edit message'}
                                aria-label={msg.message_type === 'image' ? 'Replace image' : 'Edit message'}
                              >
                                {msg.message_type === 'image' ? <Image className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteMessage(msg.id)}
                                className="flex h-7 w-7 items-center justify-center rounded-lg border border-rose-300/20 bg-rose-500/10 text-rose-200 transition-all hover:-translate-y-0.5 hover:border-rose-200/70 hover:bg-rose-500 hover:text-white hover:shadow-md hover:shadow-rose-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/70"
                                title="Delete message"
                                aria-label="Delete message"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                          {/* Action buttons for employee messages */}
                          {msg.sender_type === 'employee' && editingMessageId !== msg.id && msg.message_type !== 'tip' && msg.message_type !== 'rating_request' && msg.message_type !== 'rating_result' && (
                            <div className="order-last mt-1 flex shrink-0 flex-col gap-1 rounded-xl border border-orange-200/20 bg-slate-950/70 p-1 opacity-70 shadow-lg shadow-black/20 backdrop-blur-sm transition-all duration-200 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                              <button
                                type="button"
                                onClick={() => handleStartEdit(msg)}
                                className="flex h-7 w-7 items-center justify-center rounded-lg border border-orange-300/20 bg-orange-500/10 text-orange-200 transition-all hover:-translate-y-0.5 hover:border-orange-200/70 hover:bg-orange-500 hover:text-white hover:shadow-md hover:shadow-orange-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
                                title={msg.message_type === 'image' ? 'Replace image' : 'Edit message'}
                                aria-label={msg.message_type === 'image' ? 'Replace image' : 'Edit message'}
                              >
                                {msg.message_type === 'image' ? <Image className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                              </button>
                            </div>
                          )}
                          {msg.message_type === 'tip' ? (
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
                          ) : (msg.message_type === 'image' && msg.image_url) || (msg.message_type === 'text' && extractImageOnlyUrl(msg.message_content)) ? (
                          <div className={`relative inline-flex w-fit max-w-full flex-col overflow-hidden rounded-[20px] border-2 shadow-lg transition-all duration-200 ${
                            msg.sender_type === 'customer'
                              ? 'border-orange-200/80 shadow-slate-950/20'
                              : 'border-orange-300/30 shadow-orange-950/35'
                          }`} style={{ width: 'fit-content', height: 'fit-content', maxWidth: '100%', backgroundColor: 'transparent' }}>
                            <div className="relative inline-flex w-fit max-w-full flex-col" style={{ width: 'fit-content', height: 'fit-content', maxWidth: '100%' }}>
                              {renderMessageContent(msg)}
                              {replacingImageMsgId === msg.id && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl bg-slate-950/65 backdrop-blur-[2px]">
                                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-orange-300" />
                                  <span className="text-xs font-semibold text-white">Replacing image...</span>
                                </div>
                              )}
                            </div>
                            <div className={`border-t px-3 py-1.5 text-[10px] ${msg.sender_type === 'customer' ? 'border-slate-100 bg-white text-right text-slate-500' : 'border-orange-200/10 bg-slate-950/25 text-orange-100/60'}`}>
                              {new Date(msg.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) + ' ' + new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                            {msg.sender_type === 'customer' && (
                              <div className={`flex items-center justify-end gap-1 px-3 pb-1.5 text-[10px] ${
                                msg.is_read ? 'text-emerald-500' : 'text-slate-400'
                              } bg-white`}>
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
                            className={`relative overflow-hidden px-4 py-3 transition-all duration-200 ${
                              editingMessageId === msg.id
                                ? 'rounded-[20px] border-2 border-orange-400 bg-white text-slate-800 ring-2 ring-orange-100 shadow-[0_12px_28px_rgba(249,115,22,0.18)]'
                                : msg.sender_type === 'customer'
                                  ? 'rounded-[20px] rounded-tr-[6px] border-2 border-orange-200/80 bg-white text-slate-800 shadow-[0_10px_24px_rgba(15,23,42,0.2)]'
                                  : 'rounded-[20px] rounded-tl-[6px] border-2 border-orange-300/35 bg-gradient-to-br from-slate-800 via-slate-800 to-orange-950/70 text-slate-100 shadow-[0_10px_24px_rgba(67,32,10,0.34)]'
                            }`}
                          >
                            <div className="relative z-10">
                              <div className={`text-xs font-semibold flex items-center gap-1.5 pb-1.5 mb-1.5 ${
                                msg.sender_type === 'customer'
                                  ? 'border-b border-slate-200/90'
                                  : 'border-b border-orange-200/15'
                              }`}>
                                {msg.sender_type === 'customer' && selectedCustomer?.is_super && (
                                  <span className="text-[10px]">
                                    {selectedCustomer.badge_type === 'diamond' ? '💎' : selectedCustomer.badge_type === 'crown' ? '👑' : selectedCustomer.badge_type === 'star' ? '⭐' : selectedCustomer.badge_type === 'vip' ? '🏆' : '✨'}
                                  </span>
                                )}
                                <span className={msg.sender_type === 'employee' ? 'text-orange-100' : selectedCustomer?.is_super ? 'text-amber-600 font-bold' : 'text-blue-700 font-semibold'}>{msg.sender_type === 'customer' ? selectedCustomer?.customer_name : selectedEmployee?.username}</span>
                                {msg.sender_type === 'customer' && selectedCustomer?.is_super && selectedCustomer?.super_customer_title && (
                                  <span className="text-[9px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full font-bold">{selectedCustomer?.super_customer_title}</span>
                                )}
                              </div>
                              {editingMessageId === msg.id ? (
                                <div className="min-w-0 max-w-full">
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
                                      className="min-h-[60px] max-h-[216px] overflow-y-auto px-3 py-2.5 text-sm text-slate-800 focus:outline-none chat-rich-content"
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
                                  ? 'text-slate-500 text-right'
                                  : 'text-orange-100/60'
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
                {showTemplatePopup && (
                  <>
                    <div className="fixed inset-0 z-40" onMouseDown={() => setShowTemplatePopup(false)} />
                    <div className="absolute bottom-full left-0 right-0 mb-2 px-1 z-50">
                      <div className="relative flex max-h-[360px] flex-col overflow-hidden rounded-2xl border border-orange-300/25 bg-gradient-to-b from-slate-900/98 via-slate-900/96 to-orange-950/75 shadow-2xl shadow-orange-950/30 ring-1 ring-orange-200/10 backdrop-blur-xl">
                        <div className="flex shrink-0 items-center justify-between border-b border-orange-200/15 bg-gradient-to-r from-orange-500/15 via-slate-900/40 to-transparent px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex h-7 w-7 items-center justify-center rounded-xl border border-orange-300/25 bg-orange-500/20 shadow-lg shadow-orange-900/20">
                              <Zap className="w-3 h-3 text-white" />
                            </div>
                            <span className="text-[13px] font-bold text-slate-100 tracking-tight">Quick Send</span>
                            <span className="flex h-5 min-w-5 items-center justify-center rounded-full border border-orange-300/30 bg-orange-500/20 px-1.5 text-[11px] font-bold text-orange-100">{messageTemplates.length}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => { setShowTemplatePopup(false); setShowTemplateManager(true); loadTemplates(); }}
                              className="flex items-center gap-1 rounded-lg border border-orange-300/35 bg-orange-500/15 px-2.5 py-1 text-[11px] font-semibold text-orange-50 shadow-sm shadow-orange-950/20 transition-all duration-150 hover:border-orange-200/70 hover:bg-orange-500 hover:shadow-orange-500/25"
                            >
                              <Pencil className="w-3 h-3" />
                              Manage
                            </button>
                            <button type="button" onClick={() => setShowTemplatePopup(false)} className="rounded-lg p-1.5 transition-colors hover:bg-orange-500/15" aria-label="Close Quick Send">
                              <X className="h-3.5 w-3.5 text-orange-200/70 hover:text-orange-100" />
                            </button>
                          </div>
                        </div>
                        {messageTemplates.length > 0 ? (
                          <div className="overflow-y-auto bg-slate-950/25 p-2.5 space-y-2 scrollbar-dark">
                            {messageTemplates.map((tpl) => {
                              const hasImages = /<img\s/i.test(tpl.content);
                              const plainPreview = tpl.content_type === 'richtext'
                                ? tpl.content.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()
                                : tpl.content;
                              return (
                                <button
                                  key={tpl.id}
                                  type="button"
                                  onClick={() => {
                                    if (editorRef.current) {
                                      const content = tpl.content_type === 'richtext' ? tpl.content : tpl.content.replace(/\n/g, '<br>');
                                      editorRef.current.innerHTML = content;
                                      const hasText = (editorRef.current.textContent || '').trim().length > 0;
                                      const hasImgs = editorRef.current.querySelector('img') !== null;
                                      setMessageInput(hasText ? editorRef.current.textContent! : hasImgs ? '_img_' : '');
                                    }
                                    setShowTemplatePopup(false);
                                  }}
                                  className={`group w-full rounded-xl border px-3 py-2.5 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70 ${
                                    tpl.is_pinned
                                      ? 'border-orange-400/45 bg-gradient-to-r from-orange-900/55 via-orange-950/35 to-slate-900/70 shadow-orange-950/25 hover:border-orange-300/75 hover:from-orange-800/70 hover:via-orange-900/45 hover:to-slate-900/60'
                                      : 'border-slate-700/70 bg-slate-800/75 hover:border-orange-300/45 hover:bg-slate-800'
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    {tpl.is_pinned && (
                                      <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border border-orange-300/25 bg-orange-500/15">
                                        <Pin className="h-2.5 w-2.5 text-orange-300" />
                                      </div>
                                    )}
                                    <span className={`flex-1 truncate text-[13px] font-semibold ${tpl.is_pinned ? 'text-orange-100 group-hover:text-orange-50' : 'text-slate-200 group-hover:text-white'}`}>{tpl.name}</span>
                                    {hasImages && (
                                      <span className="flex items-center gap-0.5 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 flex-shrink-0">
                                        <Image className="w-2.5 h-2.5" />
                                        IMG
                                      </span>
                                    )}
                                    {tpl.content_type === 'richtext' && (
                                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 flex-shrink-0">Rich</span>
                                    )}
                                    <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg border border-orange-300/0 bg-orange-500/0 opacity-0 transition-all group-hover:border-orange-300/40 group-hover:bg-orange-500 group-hover:opacity-100" title="Fill into input">
                                      <Pencil className="w-2.5 h-2.5 text-white" />
                                    </div>
                                  </div>
                                  <div className={`mt-1 ${tpl.is_pinned ? 'pl-7' : ''}`}>
                                    {plainPreview && (
                                      <p className="text-[11px] text-slate-400 group-hover:text-slate-300 truncate leading-relaxed">{plainPreview.substring(0, 100)}</p>
                                    )}
                                    {hasImages && !plainPreview && (
                                      <p className="text-[11px] text-amber-400/70 group-hover:text-amber-300/80 truncate leading-relaxed flex items-center gap-1">
                                        <Image className="w-3 h-3 inline" /> Contains image{tpl.content.match(/<img\s/gi)!.length > 1 ? 's' : ''}
                                      </p>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="p-6 text-center">
                            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-orange-300/20 bg-orange-500/10 shadow-lg shadow-orange-950/20">
                              <FileText className="h-5 w-5 text-orange-300" />
                            </div>
                            <p className="mb-1 text-sm font-semibold text-slate-100">No templates yet</p>
                            <p className="mb-3 text-[11px] text-slate-400">Create templates for quick replies</p>
                            <button
                              type="button"
                              onClick={() => { setShowTemplatePopup(false); setShowTemplateManager(true); loadTemplates(); }}
                              className="rounded-lg border border-orange-300/35 bg-orange-500/20 px-3.5 py-1.5 text-xs font-semibold text-orange-50 shadow-sm shadow-orange-950/20 transition-all hover:border-orange-200/70 hover:bg-orange-500 hover:shadow-orange-500/25"
                            >
                              Create Template
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
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
                      <button type="button" onMouseDown={(e) => { e.preventDefault(); applyFormat('strikeThrough'); }} className="p-1.5 rounded-md transition-all text-slate-500 hover:bg-slate-200 hover:text-slate-800" title="Strikethrough">
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
                          <div className="flex items-center gap-1">
                            <div className="w-3.5 h-3.5 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin"></div>
                            <span className="text-[10px] text-blue-400 font-bold">{uploadProgress}%</span>
                          </div>
                        ) : (
                          <Image className="w-3.5 h-3.5" strokeWidth={2.5} />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => { loadTemplates(); setShowTemplatePopup(!showTemplatePopup); }}
                        className={`group flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.04em] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/70 ${showTemplatePopup ? 'border-orange-300 bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md shadow-orange-500/30' : 'border-orange-300/70 bg-orange-50 text-orange-700 shadow-sm shadow-orange-200/50 hover:-translate-y-0.5 hover:border-orange-500 hover:bg-orange-100 hover:text-orange-800 hover:shadow-md hover:shadow-orange-300/40'}`}
                        title="Quick send template"
                        aria-label="Open Quick Send templates"
                        aria-pressed={showTemplatePopup}
                      >
                        <span className={`flex h-5 w-5 items-center justify-center rounded-md ${showTemplatePopup ? 'bg-white/20' : 'bg-orange-200/70 group-hover:bg-orange-300/70'}`}>
                          <FileText className="h-3.5 w-3.5" strokeWidth={2.5} />
                        </span>
                        <span>Quick Send</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowTipModal(true)}
                        className="group flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-amber-400/80 bg-amber-50 px-2.5 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.04em] text-amber-800 shadow-sm shadow-amber-200/60 transition-all duration-200 hover:-translate-y-0.5 hover:border-amber-500 hover:bg-amber-100 hover:shadow-md hover:shadow-amber-300/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70"
                        title="Send tip to employee"
                        aria-label="Open Send Tip"
                      >
                        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-amber-200/80 transition-colors group-hover:bg-amber-300/80">
                          <Gift className="h-3.5 w-3.5 text-amber-800" strokeWidth={2.5} />
                        </span>
                        <span>Send Tip</span>
                      </button>
                    </div>
                    {/* Editor area */}
                    <div
                      ref={editorRef}
                      contentEditable
                      suppressContentEditableWarning
                      onInput={() => setMessageInput(getEditorHasContent() ? (editorRef.current?.textContent || '_img_') : '')}
                      onSelect={() => {
                        setIsBoldActive(document.queryCommandState('bold'));
                        setIsUnderlineActive(document.queryCommandState('underline'));
                      }}
                      onKeyUp={() => {
                        setIsBoldActive(document.queryCommandState('bold'));
                        setIsUnderlineActive(document.queryCommandState('underline'));
                      }}
                      onMouseUp={() => {
                        setIsBoldActive(document.queryCommandState('bold'));
                        setIsUnderlineActive(document.queryCommandState('underline'));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey && e.ctrlKey) {
                          e.preventDefault();
                          handleSendMessage(e as unknown as React.FormEvent);
                        }
                      }}
                      className="min-h-[40px] max-h-[216px] overflow-y-auto px-3 py-2 text-slate-800 focus:outline-none text-sm leading-5 [&_b]:font-bold [&_u]:underline [&_font[size='5']]:text-lg [&_font[size='7']]:text-xl"
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

      {/* Tip Modal */}
      {showTipModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md">
          <div className="relative w-full max-w-md overflow-hidden rounded-[28px] border border-orange-300/25 bg-gradient-to-b from-slate-900 via-slate-900 to-orange-950/70 shadow-2xl shadow-orange-950/40 ring-1 ring-orange-200/10">
            <div className="absolute -right-16 -top-20 h-48 w-48 rounded-full bg-orange-500/15 blur-3xl" />
            <div className="absolute -bottom-20 -left-16 h-48 w-48 rounded-full bg-amber-500/10 blur-3xl" />
            <div className="relative p-6 sm:p-7">
              <button
                type="button"
                onClick={() => { setShowTipModal(false); setTipAmount(''); }}
                className="absolute right-4 top-4 rounded-xl p-2 text-slate-400 transition-all hover:bg-orange-500/15 hover:text-orange-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
                aria-label="Close Send Tip"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-3 pr-8">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-orange-300/30 bg-gradient-to-br from-orange-500/30 to-amber-500/10 shadow-lg shadow-orange-950/30">
                  <Gift className="h-6 w-6 text-orange-200" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-black tracking-tight text-white">Send Tip</h3>
                    <span className="rounded-full border border-orange-300/25 bg-orange-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-orange-200">Appreciation</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-400">Send a tip to <span className="font-semibold text-orange-200">{selectedEmployee?.username}</span></p>
                </div>
              </div>

              <div className="mt-7 rounded-2xl border border-orange-200/15 bg-slate-950/35 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-[11px] font-bold uppercase tracking-[0.14em] text-orange-100/80">Tip Amount</label>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">USD</span>
                </div>
                <div className="relative">
                  <DollarSign className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-orange-300" />
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={tipAmount}
                    onChange={(e) => setTipAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-xl border border-orange-200/20 bg-slate-900/80 py-4 pl-12 pr-16 text-3xl font-black tracking-tight text-white placeholder-slate-700 outline-none transition-all focus:border-orange-300/70 focus:ring-2 focus:ring-orange-400/20"
                    autoFocus
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-orange-200/60">USD</span>
                </div>
                <p className="mt-2 text-[10px] text-slate-500">Choose a preset or enter a custom amount.</p>
                <div className="mt-3 grid grid-cols-5 gap-2">
                  {[5, 10, 20, 50, 100].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setTipAmount(preset.toString())}
                      className={`rounded-lg border px-2 py-2 text-xs font-bold transition-all ${tipAmount === preset.toString() ? 'border-orange-300 bg-orange-500/25 text-orange-100 shadow-sm shadow-orange-500/20' : 'border-slate-700/80 bg-slate-900/70 text-slate-400 hover:border-orange-300/60 hover:bg-orange-500/10 hover:text-orange-100'}`}
                    >
                      ${preset}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-6 flex gap-2.5">
                <button
                  type="button"
                  onClick={handleSendTip}
                  disabled={!tipAmount || parseFloat(tipAmount) <= 0 || sendingTip}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-orange-300/50 bg-gradient-to-r from-orange-500 to-amber-500 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-orange-600/25 transition-all hover:-translate-y-0.5 hover:from-orange-400 hover:to-amber-400 hover:shadow-orange-500/35 disabled:cursor-not-allowed disabled:border-slate-700 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 disabled:shadow-none"
                >
                  {sendingTip ? <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <><Gift className="h-4 w-4" strokeWidth={2.5} /> Send Tip</>}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowTipModal(false); setTipAmount(''); }}
                  className="rounded-xl border border-slate-700/80 bg-slate-800/70 px-5 py-3 text-sm font-semibold text-slate-300 transition-all hover:border-slate-600 hover:bg-slate-700 hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Customer Create/Edit Modal */}
      {(showCustomerForm || editingCustomer) && (
        <div className="fixed inset-0 flex items-center justify-center z-[9999] overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-md" onMouseDown={(e) => { if (e.target === e.currentTarget) { setShowCustomerForm(false); setEditingCustomer(null); setAutoMessageDrafts([]); setAutoMessageDraftMasterEnabled(false); setCustomerForm({ name: '', avatar: 'customer-avatar:regular:0', isSuper: false, superTitle: '', customId: '', badgeType: '', vipLabel: 'VIP', customAvatarFile: null, useCustomAvatar: false, remarks: '' }); } }}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={editingCustomer ? (e) => { e.preventDefault(); handleUpdateCustomer(); } : handleCreateCustomer} className={`create-customer-modal create-customer-modal--orange w-full max-h-[calc(100vh-2rem)] rounded-2xl border p-5 shadow-2xl ${customerForm.isSuper ? 'max-w-[95vw]' : 'max-w-3xl'} transition-all duration-200`}>
            <h3 className="mb-4 border-b border-orange-200/15 pb-3 text-lg font-black tracking-tight text-white">{editingCustomer ? 'Edit Customer' : 'Create Customer'}</h3>
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
                  onChange={(e) => setCustomerForm({ ...customerForm, isSuper: e.target.checked, avatar: e.target.checked ? 'customer-avatar:vip:0' : 'customer-avatar:regular:0' })}
                  className="sr-only"
                />
                <div className="flex items-center gap-2">
                  <Star className="w-5 h-5 text-amber-400" fill="currentColor" />
                  <span className="text-sm font-bold text-amber-200">Super Customer (VIP)</span>
                </div>
              </label>
            </div>

            {customerForm.isSuper ? (
              <div className="flex flex-col gap-4 md:flex-row">
                {/* Left column: basic info + avatar */}
                <div className="flex-1 min-w-0 p-3 bg-slate-800/40 border border-blue-500/30 rounded-xl">
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
                        className="flex w-full min-w-0 items-center justify-center gap-2 overflow-hidden rounded-lg border-2 border-amber-500/50 bg-amber-900/20 px-3 py-2.5 text-sm font-medium text-amber-200 transition-all hover:bg-amber-900/30"
                        title={customerForm.customAvatarFile?.name || 'Upload Photo'}
                      >
                        <Image className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 truncate">
                          {customerForm.customAvatarFile ? customerForm.customAvatarFile.name : 'Upload Photo'}
                        </span>
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
                      <label className="block text-xs font-medium text-amber-300 mb-1.5">VIP Character Avatar</label>
                      <CustomerAvatarPicker
                        value={customerForm.avatar}
                        onChange={(avatar) => setCustomerForm({ ...customerForm, avatar })}
                        theme="orange"
                        variant="vip"
                      />
                    </div>
                  )}
                </div>

                {/* Right column: VIP settings */}
                <div className="flex-1 min-w-0 p-3 bg-amber-950/30 border border-amber-500/30 rounded-xl">
                  <div className="mb-3">
                    <label className="block text-xs font-medium text-amber-300 mb-1.5">
                      Custom ID <span className="text-amber-500/70 text-[10px]">(Optional)</span>
                    </label>
                    <input
                      type="text"
                      value={customerForm.customId}
                      onChange={(e) => setCustomerForm({ ...customerForm, customId: e.target.value })}
                      className="w-full px-3 py-2.5 bg-amber-900/20 border border-amber-500/30 rounded-lg text-amber-200 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 placeholder:text-amber-600/50"
                      placeholder="e.g., VIP-001"
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
                <CustomerAutoMessages
                  customerId={editingCustomer?.id || null}
                  adminId={selectedAdminId || adminId}
                  sourceType="aaa_service"
                  draftMessages={autoMessageDrafts}
                  draftMasterEnabled={autoMessageDraftMasterEnabled}
                  onDraftMessagesChange={setAutoMessageDrafts}
                  onDraftMasterEnabledChange={setAutoMessageDraftMasterEnabled}
                />
              </div>
            ) : (
              <>
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
                  <label className="block text-sm font-medium text-orange-200 mb-3">Select Character Avatar</label>
                  <CustomerAvatarPicker
                    value={customerForm.avatar}
                    onChange={(avatar) => setCustomerForm({ ...customerForm, avatar })}
                    theme="orange"
                    variant="regular"
                  />
                </div>

                <div className="mb-4">
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
                <CustomerAutoMessages
                  customerId={editingCustomer?.id || null}
                  adminId={selectedAdminId || adminId}
                  sourceType="aaa_service"
                  draftMessages={autoMessageDrafts}
                  draftMasterEnabled={autoMessageDraftMasterEnabled}
                  onDraftMessagesChange={setAutoMessageDrafts}
                  onDraftMasterEnabledChange={setAutoMessageDraftMasterEnabled}
                />
              </>
            )}

            <div className="create-customer-modal__actions flex gap-2 mt-4">
              <button
                type="submit"
                disabled={savingCustomer}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white rounded-lg transition-all font-medium disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingCustomer ? 'Saving...' : editingCustomer ? 'Save' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCustomerForm(false);
                  setEditingCustomer(null);
                  setAutoMessageDrafts([]);
                  setAutoMessageDraftMasterEnabled(false);
                  setCustomerForm({ name: '', avatar: 'customer-avatar:regular:0', isSuper: false, superTitle: '', customId: '', badgeType: '', vipLabel: 'VIP', customAvatarFile: null, useCustomAvatar: false, remarks: '' });
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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) { setShowTemplateManager(false); setEditingTemplate(null); setTemplateForm({ name: '', content: '', content_type: 'richtext' }); if (templateEditorRef.current) templateEditorRef.current.innerHTML = ''; } }}>
          <div onClick={(e) => e.stopPropagation()} className="bg-slate-900 rounded-2xl border border-slate-700/50 w-full max-w-5xl h-[85vh] flex flex-col shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/50 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-teal-600/20 rounded-lg">
                  <BookOpen className="w-5 h-5 text-teal-400" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Message Templates</h3>
                  <p className="text-xs text-slate-400 mt-0.5">{messageTemplates.length} template{messageTemplates.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
              <button onClick={() => { setShowTemplateManager(false); setEditingTemplate(null); setTemplateForm({ name: '', content: '', content_type: 'richtext' }); if (templateEditorRef.current) templateEditorRef.current.innerHTML = ''; }} className="p-2 hover:bg-slate-800 rounded-lg transition-colors">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            {/* Left/Right body */}
            <div className="flex-1 flex min-h-0 overflow-hidden">
              {/* Left: Editor */}
              <div className="w-1/2 flex flex-col border-r border-slate-700/50 p-4 gap-3">
                <h4 className="text-sm font-bold text-white flex items-center gap-2 flex-shrink-0">
                  {editingTemplate ? <Pencil className="w-3.5 h-3.5 text-blue-400" /> : <Plus className="w-3.5 h-3.5 text-teal-400" />}
                  {editingTemplate ? 'Edit Template' : 'New Template'}
                </h4>
                <input
                  type="text"
                  value={templateForm.name}
                  onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
                  className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 placeholder:text-slate-400 flex-shrink-0 shadow-sm"
                  placeholder="Template name (e.g., Welcome, FAQ, Follow-up...)"
                />
                <input ref={templateImageInputRef} type="file" accept="image/*" onChange={handleTemplateImageUpload} className="hidden" />
                <input id="templateFileImport" type="file" accept=".txt,.doc,.docx" onChange={handleTemplateFileImport} className="hidden" />
                {/* Unified toolbar + editor (light theme, matches chat input) */}
                <div className="flex-1 min-h-0 rounded-xl border border-slate-300 bg-white overflow-hidden focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400/40 transition-all shadow-sm flex flex-col">
                  <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-slate-200 bg-slate-50/80 flex-shrink-0 flex-wrap">
                    <button type="button" onMouseDown={(e) => { e.preventDefault(); ensureEditorFocus(templateEditorRef.current!); document.execCommand('bold'); setTemplateBoldActive(prev => !prev); }} className={`p-1.5 rounded-md transition-all ${templateBoldActive ? 'bg-blue-500 text-white shadow-sm shadow-blue-500/30' : 'text-slate-500 hover:bg-slate-200 hover:text-slate-800'}`} title="Bold (Ctrl+B)">
                      <Bold className="w-3.5 h-3.5" strokeWidth={2.5} />
                    </button>
                    <button type="button" onMouseDown={(e) => { e.preventDefault(); ensureEditorFocus(templateEditorRef.current!); document.execCommand('underline'); setTemplateUnderlineActive(prev => !prev); }} className={`p-1.5 rounded-md transition-all ${templateUnderlineActive ? 'bg-blue-500 text-white shadow-sm shadow-blue-500/30' : 'text-slate-500 hover:bg-slate-200 hover:text-slate-800'}`} title="Underline (Ctrl+U)">
                      <Underline className="w-3.5 h-3.5" strokeWidth={2.5} />
                    </button>
                    <button type="button" onMouseDown={(e) => { e.preventDefault(); ensureEditorFocus(templateEditorRef.current!); document.execCommand('strikeThrough'); }} className="p-1.5 rounded-md transition-all text-slate-500 hover:bg-slate-200 hover:text-slate-800" title="Strikethrough">
                      <Strikethrough className="w-3.5 h-3.5" strokeWidth={2.5} />
                    </button>
                    <div className="w-px h-5 bg-slate-200 mx-1" />
                    <div className="flex items-center bg-slate-100 rounded-md p-0.5 gap-0.5">
                      <button type="button" onMouseDown={(e) => { e.preventDefault(); setTemplateFontSize(templateFontSize === 'normal' ? null : 'normal'); document.execCommand('fontSize', false, '3'); templateEditorRef.current?.focus(); }} className={`px-1.5 py-0.5 text-[10px] rounded transition-all ${templateFontSize === 'normal' ? 'bg-blue-500 text-white font-bold shadow-sm shadow-blue-500/30' : 'text-slate-400 font-semibold hover:text-slate-700 hover:bg-slate-200'}`} title="Normal size">A</button>
                      <button type="button" onMouseDown={(e) => { e.preventDefault(); setTemplateFontSize(templateFontSize === 'large' ? null : 'large'); document.execCommand('fontSize', false, '5'); templateEditorRef.current?.focus(); }} className={`px-1.5 py-0.5 text-xs rounded transition-all ${templateFontSize === 'large' ? 'bg-blue-500 text-white font-bold shadow-sm shadow-blue-500/30' : 'text-slate-400 font-semibold hover:text-slate-700 hover:bg-slate-200'}`} title="Large size">A</button>
                      <button type="button" onMouseDown={(e) => { e.preventDefault(); setTemplateFontSize(templateFontSize === 'xlarge' ? null : 'xlarge'); document.execCommand('fontSize', false, '7'); templateEditorRef.current?.focus(); }} className={`px-1.5 py-0.5 text-sm rounded transition-all ${templateFontSize === 'xlarge' ? 'bg-blue-500 text-white font-bold shadow-sm shadow-blue-500/30' : 'text-slate-400 font-bold hover:text-slate-700 hover:bg-slate-200'}`} title="Extra large">A</button>
                    </div>
                    <div className="relative">
                      <button
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); setShowBgColorPicker(showBgColorPicker === 'template' ? null : 'template'); }}
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
                      }
                    }}
                    onKeyUp={() => { setTemplateBoldActive(document.queryCommandState('bold')); setTemplateUnderlineActive(document.queryCommandState('underline')); }}
                    onMouseUp={() => { setTemplateBoldActive(document.queryCommandState('bold')); setTemplateUnderlineActive(document.queryCommandState('underline')); }}
                    className="flex-1 min-h-[200px] overflow-y-auto px-3 py-2.5 text-slate-800 text-sm focus:outline-none chat-rich-content"
                    style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                    data-placeholder="Enter template content, paste formatted text, or import a file..."
                  />
                </div>
                {/* Action buttons */}
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={editingTemplate ? handleUpdateTemplate : handleCreateTemplate}
                    disabled={!templateForm.name.trim() || isTemplateContentEmpty()}
                    className="flex-1 px-4 py-2.5 bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 disabled:from-slate-600 disabled:to-slate-600 disabled:text-slate-400 text-white rounded-lg font-semibold text-sm transition-all"
                  >
                    {editingTemplate ? 'Save Changes' : 'Add Template'}
                  </button>
                  {editingTemplate && (
                    <button
                      type="button"
                      onClick={() => { setEditingTemplate(null); setTemplateForm({ name: '', content: '', content_type: 'richtext' }); if (templateEditorRef.current) templateEditorRef.current.innerHTML = ''; }}
                      className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-semibold text-sm transition-all"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>

              {/* Right: Saved Templates */}
              <div className="w-1/2 flex flex-col p-4 overflow-hidden">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex-shrink-0">
                  Saved Templates ({messageTemplates.length})
                </h4>
                {messageTemplates.length > 0 ? (
                  <div className="flex-1 overflow-y-auto space-y-2 scrollbar-dark pr-1">
                    {messageTemplates.map((tpl) => (
                      <div key={tpl.id} className={`rounded-xl border p-3 transition-all group ${tpl.is_pinned ? 'bg-teal-900/20 border-teal-700/50' : 'bg-slate-800/40 border-slate-700/50 hover:border-slate-600/50'}`}>
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              {tpl.is_pinned && (
                                <Pin className="w-3 h-3 text-teal-400 flex-shrink-0" />
                              )}
                              <span className="text-sm font-bold text-white truncate">{tpl.name}</span>
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase flex-shrink-0 ${
                                tpl.content_type === 'richtext' ? 'bg-blue-500/20 text-blue-400' : 'bg-teal-500/20 text-teal-400'
                              }`}>{tpl.content_type === 'richtext' ? 'RTF' : 'TXT'}</span>
                            </div>
                            {tpl.content_type === 'richtext' ? (
                              <div className="text-xs text-slate-400 line-clamp-2 chat-rich-content" dangerouslySetInnerHTML={{ __html: sanitizeChatMessage(tpl.content) }} />
                            ) : (
                              <p className="text-xs text-slate-400 line-clamp-2">{tpl.content}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => handleToggleTemplatePin(tpl)}
                              className={`p-1.5 rounded-md transition-all ${tpl.is_pinned ? 'bg-teal-600 text-white' : 'bg-slate-700 hover:bg-teal-600 text-slate-300 hover:text-white'}`}
                              title={tpl.is_pinned ? 'Unpin' : 'Pin to top'}
                            >
                              <Pin className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingTemplate(tpl);
                                setTemplateForm({ name: tpl.name, content: tpl.content, content_type: tpl.content_type });
                                requestAnimationFrame(() => { if (templateEditorRef.current) templateEditorRef.current.innerHTML = tpl.content; });
                              }}
                              className="p-1.5 bg-slate-700 hover:bg-blue-600 text-slate-300 hover:text-white rounded-md transition-all"
                              title="Edit"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteTemplate(tpl.id)}
                              className="p-1.5 bg-slate-700 hover:bg-red-600 text-slate-300 hover:text-white rounded-md transition-all"
                              title="Delete"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center">
                    <FileText className="w-12 h-12 text-slate-700 mb-3" />
                    <p className="text-sm text-slate-500 font-medium">No templates yet</p>
                    <p className="text-xs text-slate-600 mt-1">Create your first template using the editor on the left</p>
                  </div>
                )}
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
    </div>
  );
}

export default memo(CustomerServiceManagement);
