import React, { useState, useEffect, useRef } from 'react';
import { formatSupabaseError, isSupabaseAbortError, supabase } from '../../lib/supabase';
import { sanitizeHTML } from '../../lib/sanitizeHTML';
import { getAdminFinancialSessionToken } from '../../lib/auth';
import { useCurrencyUnit } from '../../lib/useCurrencyUnit';
import TiptapEditor, { type TiptapEditorRef } from './TiptapEditor';
import NotificationAutomation from './NotificationAutomation';
import {
  Send, Users, Bell, AlertCircle, X, Search,
  Check, CheckSquare, Square, Trash2, AlertTriangle,
  Pencil, Save, ChevronDown,
  Tag, Bookmark, Plus, Clock, Radio, Globe, Gift, Sparkles
} from 'lucide-react';

interface AdminGroup {
  id: string;
  username: string;
  role: string;
  total_employees: number;
  active_employees: number;
  verified_employees: number;
}

interface Employee {
  id: string;
  username: string;
  employee_id: string;
  is_active: boolean;
  is_verified: boolean;
  total_income: number;
  created_by: string;
  tags: string[];
  remarks: string;
  is_pinned: boolean;
}

interface Message {
  id: string;
  sender_id: string;
  sender_username: string;
  title: string;
  content: string;
  message_type: 'realtime' | 'login_popup';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  created_at: string;
  recipient_ids?: string[];
}

interface MessageStats {
  total_recipients: number;
  read_count: number;
  unread_count: number;
  read_percentage: number;
}

interface Props {
  admin: {
    id: string;
    username: string;
    role: string;
    is_super_admin?: boolean;
  };
  isActive?: boolean;
  initialEmployee?: {
    id: string;
    username: string;
    employeeId: string;
    adminId: string;
    adminUsername?: string;
    isVerified: boolean;
    isActive: boolean;
    remarks: string;
    tags: string[];
  } | null;
  onConsumeInitialEmployee?: () => void;
}

const formatMessageDateTime = (value: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value));

const getMessageTypeTone = (messageType: Message['message_type']) =>
  messageType === 'login_popup'
    ? {
        card: 'border-violet-800/90 bg-gradient-to-br from-violet-950/80 via-slate-800 to-slate-900',
        accent: 'bg-violet-400',
        icon: 'bg-violet-900/80 text-violet-200 ring-1 ring-violet-700/60',
        label: 'text-violet-200/70',
        value: 'text-violet-100',
      }
    : {
        card: 'border-blue-800/90 bg-gradient-to-br from-blue-950/80 via-slate-800 to-slate-900',
        accent: 'bg-blue-400',
        icon: 'bg-blue-900/80 text-blue-200 ring-1 ring-blue-700/60',
        label: 'text-blue-200/70',
        value: 'text-blue-100',
      };

const getMessagePriorityTone = (priority: Message['priority']) => {
  switch (priority) {
    case 'urgent':
      return { card: 'border-red-800/90 bg-gradient-to-br from-red-950/80 via-slate-800 to-slate-900', accent: 'bg-red-400', icon: 'bg-red-900/80 text-red-200 ring-1 ring-red-700/60', label: 'text-red-200/70', value: 'text-red-100' };
    case 'high':
      return { card: 'border-amber-800/90 bg-gradient-to-br from-amber-950/80 via-slate-800 to-slate-900', accent: 'bg-amber-400', icon: 'bg-amber-900/80 text-amber-200 ring-1 ring-amber-700/60', label: 'text-amber-200/70', value: 'text-amber-100' };
    case 'normal':
      return { card: 'border-emerald-800/90 bg-gradient-to-br from-emerald-950/80 via-slate-800 to-slate-900', accent: 'bg-emerald-400', icon: 'bg-emerald-900/80 text-emerald-200 ring-1 ring-emerald-700/60', label: 'text-emerald-200/70', value: 'text-emerald-100' };
    default:
      return { card: 'border-slate-700 bg-gradient-to-br from-slate-800 via-slate-800 to-slate-900', accent: 'bg-slate-400', icon: 'bg-slate-700 text-slate-200 ring-1 ring-slate-600', label: 'text-slate-300/70', value: 'text-slate-100' };
  }
};

export default function MessageManagement({ admin, isActive = true, initialEmployee, onConsumeInitialEmployee }: Props) {
  const [adminGroups, setAdminGroups] = useState<AdminGroup[]>([]);
  const [allEmployees, setAllEmployees] = useState<Map<string, Employee[]>>(new Map());
  const [selectedAdminId, setSelectedAdminId] = useState<string>('');
  const selectedAdminIdRef = useRef('');
  selectedAdminIdRef.current = selectedAdminId;
  const [loading, setLoading] = useState(true);

  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'verified'>('all');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [allAvailableTags, setAllAvailableTags] = useState<string[]>([]);

  const [messageForm, setMessageForm] = useState({
    title: '',
    content: '',
    messageType: 'realtime' as 'realtime' | 'login_popup',
    priority: 'normal' as 'low' | 'normal' | 'high' | 'urgent'
  });
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState<{ sent: number; total: number } | null>(null);
  const [showAutomation, setShowAutomation] = useState(false);
  const [manualRewardEnabled, setManualRewardEnabled] = useState(false);
  const [manualRewardAmount, setManualRewardAmount] = useState('');
  const [showRewardConfirm, setShowRewardConfirm] = useState(false);
  const currencyUnit = useCurrencyUnit(admin.id);

  const [sentMessages, setSentMessages] = useState<Message[]>([]);
  const [selectedMessageDetail, setSelectedMessageDetail] = useState<Message | null>(null);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messageStats, setMessageStats] = useState<Map<string, MessageStats>>(new Map());
  const [recipientDetails, setRecipientDetails] = useState<Map<string, { read: Employee[]; unread: Employee[] }>>(new Map());
  const [loadingRecipientDetails, setLoadingRecipientDetails] = useState(false);
  const [recipientUsernames, setRecipientUsernames] = useState<Map<string, string[]>>(new Map());
  const [recipientSearchQuery, setRecipientSearchQuery] = useState('');
  const [recipientStatusFilter, setRecipientStatusFilter] = useState<'all' | 'read' | 'unread'>('all');

  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [deleteMode, setDeleteMode] = useState<'selected' | 'all' | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [editingMessage, setEditingMessage] = useState(false);
  const [editForm, setEditForm] = useState({ title: '', content: '' });
  const [saving, setSaving] = useState(false);

  const [messageTypeFilter, setMessageTypeFilter] = useState<'all' | 'realtime' | 'login_popup'>('all');
  const [messageScopeFilter] = useState<'all' | 'broadcast' | 'targeted'>('all');
  const [readStatusFilter, setReadStatusFilter] = useState<'all' | 'read' | 'unread'>('all');
  const [sentMessagesSearchQuery, setSentMessagesSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const messagesPerPage = 15;

  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [showTagDropdown, setShowTagDropdown] = useState(false);

  const [templates, setTemplates] = useState<Array<{id:string; name:string; title:string; content:string; message_type:string; priority:string}>>([]);
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateEditorContent, setTemplateEditorContent] = useState('');
  const [templateFormTitle, setTemplateFormTitle] = useState('');
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const templateEditorRef2 = useRef<TiptapEditorRef>(null);

  const composeEditorRef = useRef<TiptapEditorRef>(null);
  const editEditorRef = useRef<TiptapEditorRef>(null);
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  const templateDropdownRef = useRef<HTMLDivElement>(null);

  const hasInitiallyLoaded = useRef(false);
  const initialDataRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialDataRetryCountRef = useRef(0);
  const wasActiveRef = useRef(false);
  const userDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recipientDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onConsumeInitialEmployeeRef = useRef<(() => void) | undefined>(undefined);
  const loadAllDataRef = useRef<((isBackgroundRefresh?: boolean) => Promise<void>) | null>(null);
  const loadSentMessagesRef = useRef<((isBackgroundRefresh?: boolean) => Promise<void>) | null>(null);
  const loadTemplatesRef = useRef<(() => Promise<void>) | null>(null);
  const loadRecipientDetailsRef = useRef<((messageId: string) => Promise<void>) | null>(null);
  const recipientDetailsRequestsRef = useRef(new Set<string>());
  const recipientDetailsLoadingCountRef = useRef(0);
  const scopedEmployeeIdsRef = useRef(new Set<string>());
  const sentMessageIdsRef = useRef(new Set<string>());
  const allDataLoadingRef = useRef(false);
  const templatesLoadingRef = useRef(false);
  const sentMessagesLoadingRef = useRef(false);
  const sentMessagesRefreshPendingRef = useRef(false);
  onConsumeInitialEmployeeRef.current = onConsumeInitialEmployee;

  useEffect(() => {
    if (isActive && !wasActiveRef.current && !initialEmployee) {
      setSelectedEmployeeIds(new Set());
    }

    wasActiveRef.current = isActive;
  }, [isActive, initialEmployee]);

  useEffect(() => {
    if (!isActive || !initialEmployee) return;

    selectedAdminIdRef.current = initialEmployee.adminId;
    setSelectedAdminId(initialEmployee.adminId);
    setAdminGroups(previous => previous.some(group => group.id === initialEmployee.adminId)
      ? previous
      : [{
          id: initialEmployee.adminId,
          username: initialEmployee.adminUsername || '管理員群組',
          role: 'secondary_admin',
          total_employees: 1,
          active_employees: initialEmployee.isActive ? 1 : 0,
          verified_employees: initialEmployee.isVerified ? 1 : 0,
        }, ...previous]);
    setAllEmployees(previous => {
      const groupEmployees = previous.get(initialEmployee.adminId) || [];
      if (groupEmployees.some(employee => employee.id === initialEmployee.id)) return previous;

      const next = new Map(previous);
      next.set(initialEmployee.adminId, [{
        id: initialEmployee.id,
        username: initialEmployee.username,
        employee_id: initialEmployee.employeeId,
        is_active: initialEmployee.isActive,
        is_verified: initialEmployee.isVerified,
        total_income: 0,
        created_by: initialEmployee.adminId,
        tags: initialEmployee.tags,
        remarks: initialEmployee.remarks,
        is_pinned: false,
      }, ...groupEmployees]);
      return next;
    });
    setSearchQuery('');
    setFilterStatus('all');
    setSelectedTags(new Set());
    setSelectedEmployeeIds(new Set([initialEmployee.id]));

    if (loading) return;

    const targetGroup = Array.from(allEmployees.entries()).find(([, employees]) =>
      employees.some(employee => employee.id === initialEmployee.id),
    );
    if (!targetGroup) return;

    onConsumeInitialEmployeeRef.current?.();
  }, [isActive, initialEmployee, loading, allEmployees]);

  useEffect(() => {
    void loadAllDataRef.current?.();
    const auxiliaryDataTimer = globalThis.setTimeout(() => {
      void loadSentMessagesRef.current?.();
      void loadTemplatesRef.current?.();
    }, 250);

    const debouncedLoadAllData = () => {
      if (userDebounceTimer.current) clearTimeout(userDebounceTimer.current);
      userDebounceTimer.current = setTimeout(() => { void loadAllDataRef.current?.(true); }, 3000);
    };

    const debouncedLoadSentMessages = () => {
      if (recipientDebounceTimer.current) clearTimeout(recipientDebounceTimer.current);
      recipientDebounceTimer.current = setTimeout(() => { void loadSentMessagesRef.current?.(true); }, 2000);
    };

    const usersChannel = supabase
      .channel('msg-users-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, payload => {
        if (admin.role === 'secondary_admin') {
          const changedEmployee = (payload.new && Object.keys(payload.new).length > 0
            ? payload.new
            : payload.old) as { id?: unknown; created_by?: unknown };
          const employeeId = typeof changedEmployee?.id === 'string' ? changedEmployee.id : null;
          const createdBy = typeof changedEmployee?.created_by === 'string' ? changedEmployee.created_by : null;
          if (createdBy !== admin.id && (!employeeId || !scopedEmployeeIdsRef.current.has(employeeId))) return;
        }
        debouncedLoadAllData();
      })
      .subscribe();

    const adminsChannel = supabase
      .channel('msg-admins-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admins' }, payload => {
        if (admin.role === 'secondary_admin') {
          const changedAdmin = (payload.new && Object.keys(payload.new).length > 0
            ? payload.new
            : payload.old) as { id?: unknown };
          if (changedAdmin?.id !== admin.id) return;
        }
        debouncedLoadAllData();
      })
      .subscribe();

    const recipientsChannel = supabase
      .channel('msg-recipients-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_recipients' }, payload => {
        if (admin.role === 'secondary_admin') {
          const changedRecipient = (payload.new && Object.keys(payload.new).length > 0
            ? payload.new
            : payload.old) as { message_id?: unknown };
          const messageId = typeof changedRecipient?.message_id === 'string' ? changedRecipient.message_id : null;
          if (payload.eventType !== 'DELETE' && (!messageId || !sentMessageIdsRef.current.has(messageId))) return;
        }
        debouncedLoadSentMessages();
      })
      .subscribe();

    return () => {
      globalThis.clearTimeout(auxiliaryDataTimer);
      if (userDebounceTimer.current) clearTimeout(userDebounceTimer.current);
      if (recipientDebounceTimer.current) clearTimeout(recipientDebounceTimer.current);
      if (initialDataRetryTimerRef.current) clearTimeout(initialDataRetryTimerRef.current);
      initialDataRetryTimerRef.current = null;
      supabase.removeChannel(usersChannel);
      supabase.removeChannel(adminsChannel);
      supabase.removeChannel(recipientsChannel);
    };
  }, [admin.id, admin.role]);

  // Close tag dropdown on outside click
  useEffect(() => {
    if (!showTagDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) {
        setShowTagDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showTagDropdown]);

  // Close template dropdown on outside click
  useEffect(() => {
    if (!showTemplateDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (templateDropdownRef.current && !templateDropdownRef.current.contains(e.target as Node)) {
        setShowTemplateDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showTemplateDropdown]);

  const loadAllData = async (isBackgroundRefresh = false) => {
    if (allDataLoadingRef.current) return;

    allDataLoadingRef.current = true;
    if (!isBackgroundRefresh) setLoading(true);
    try {
      let adminsQuery = supabase
        .from('admins')
        .select('id, username, role')
        .eq('is_active', true)
        .neq('role', 'emergency_admin')
        .order('role', { ascending: false })
        .order('username');

      if (admin.role === 'secondary_admin') {
        adminsQuery = adminsQuery.eq('id', admin.id);
      }

      let employeesQuery = supabase
        .from('users')
        .select('id, username, employee_id, is_active, is_verified, total_income, created_by, tags, remarks, is_pinned')
        .order('is_pinned', { ascending: false })
        .order('username');

      if (admin.role === 'secondary_admin') {
        employeesQuery = employeesQuery.eq('created_by', admin.id);
      }

      const [
        { data: allAdmins, error: adminsError },
        { data: employeesData, error: employeesError },
      ] = await Promise.all([adminsQuery, employeesQuery]);

      if (adminsError) throw adminsError;
      if (employeesError) throw employeesError;

      scopedEmployeeIdsRef.current = admin.role === 'secondary_admin'
        ? new Set((employeesData || []).map(employee => employee.id))
        : new Set();

      const tagsSet = new Set<string>();
      employeesData?.forEach(emp => {
        if (emp.tags && Array.isArray(emp.tags)) {
          emp.tags.forEach((tag: string) => tagsSet.add(tag));
        }
      });
      setAllAvailableTags(Array.from(tagsSet).sort());

      const employeesByAdmin = new Map<string, Employee[]>();
      const countsByAdmin = new Map<string, { total: number; active: number; verified: number }>();

      employeesData?.forEach(emp => {
        const current = employeesByAdmin.get(emp.created_by) || [];
        current.push(emp);
        employeesByAdmin.set(emp.created_by, current);

        const counts = countsByAdmin.get(emp.created_by) || { total: 0, active: 0, verified: 0 };
        counts.total++;
        if (emp.is_active) counts.active++;
        if (emp.is_verified) counts.verified++;
        countsByAdmin.set(emp.created_by, counts);
      });

      const groups: AdminGroup[] = allAdmins?.map(a => ({
        id: a.id,
        username: a.username,
        role: a.role,
        total_employees: countsByAdmin.get(a.id)?.total || 0,
        active_employees: countsByAdmin.get(a.id)?.active || 0,
        verified_employees: countsByAdmin.get(a.id)?.verified || 0
      })) || [];

      const filteredGroups = admin.role === 'secondary_admin'
        ? groups.filter(g => g.id === admin.id)
        : groups;

      initialDataRetryCountRef.current = 0;
      if (initialDataRetryTimerRef.current) {
        clearTimeout(initialDataRetryTimerRef.current);
        initialDataRetryTimerRef.current = null;
      }
      setAdminGroups(filteredGroups);
      setAllEmployees(employeesByAdmin);

      if (admin.role === 'secondary_admin' && sentMessageIdsRef.current.size > 0) {
        void loadSentMessagesRef.current?.(true);
      }

      if (filteredGroups.length > 0 && !selectedAdminIdRef.current) {
        selectedAdminIdRef.current = filteredGroups[0].id;
        setSelectedAdminId(filteredGroups[0].id);
      }
    } catch (error) {
      if (!isSupabaseAbortError(error)) {
        console.error('Error loading data:', formatSupabaseError(error));
      }

      if (initialDataRetryCountRef.current < 3) {
        initialDataRetryCountRef.current += 1;
        const retryDelay = Math.min(1000 * 2 ** (initialDataRetryCountRef.current - 1), 8000);
        if (initialDataRetryTimerRef.current) clearTimeout(initialDataRetryTimerRef.current);
        initialDataRetryTimerRef.current = setTimeout(() => {
          initialDataRetryTimerRef.current = null;
          void loadAllDataRef.current?.(true);
        }, retryDelay);
      }
    } finally {
      allDataLoadingRef.current = false;
      setLoading(false);
      hasInitiallyLoaded.current = true;
    }
  };
  loadAllDataRef.current = loadAllData;

  const loadTemplates = async () => {
    if (templatesLoadingRef.current) return;

    templatesLoadingRef.current = true;
    try {
      const { data, error } = await supabase
        .from('message_templates')
        .select('id, name, title, content, message_type, priority')
        .eq('admin_id', admin.id)
        .order('sort_order')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setTemplates(data || []);
    } catch (error) {
      if (!isSupabaseAbortError(error)) {
        console.error('Error loading templates:', formatSupabaseError(error));
      }
    } finally {
      templatesLoadingRef.current = false;
    }
  };

  const saveAsTemplate = async () => {
    if (!newTemplateName.trim()) return;
    setSavingTemplate(true);
    try {
      const htmlContent = templateEditorRef2.current?.getContent() || templateEditorContent;
      if (editingTemplateId) {
        const { error } = await supabase.from('message_templates').update({
          name: newTemplateName.trim(),
          title: templateFormTitle,
          content: htmlContent,
        }).eq('id', editingTemplateId);
        if (error) throw error;
        setNotification({ type: 'success', message: `Template updated!` });
      } else {
        const { error } = await supabase.from('message_templates').insert({
          admin_id: admin.id,
          name: newTemplateName.trim(),
          title: templateFormTitle,
          content: htmlContent,
        });
        if (error) throw error;
        setNotification({ type: 'success', message: `Template "${newTemplateName.trim()}" saved!` });
      }
      setEditingTemplateId(null);
      setShowSaveTemplateModal(false);
      setNewTemplateName('');
      setTemplateEditorContent('');
      setTemplateFormTitle('');
      loadTemplates();
    } catch (error: unknown) {
      setNotification({ type: 'error', message: formatSupabaseError(error) || 'Failed to save template' });
    } finally {
      setSavingTemplate(false);
    }
  };

  const startEditTemplate = (tpl: typeof templates[0]) => {
    setEditingTemplateId(tpl.id);
    setNewTemplateName(tpl.name);
    setTemplateFormTitle(tpl.title);
    setTemplateEditorContent(tpl.content);
    templateEditorRef2.current?.getEditor()?.commands.setContent(tpl.content);
  };

  const applyTemplate = (template: typeof templates[0]) => {
    setMessageForm(prev => ({
      ...prev,
      title: template.title,
      content: template.content,
    }));
    composeEditorRef.current?.getEditor()?.commands.setContent(template.content);
    setShowTemplateDropdown(false);
    setNotification({ type: 'success', message: `Template "${template.name}" applied` });
  };

  const deleteTemplate = async (templateId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const { error } = await supabase.from('message_templates').delete().eq('id', templateId);
      if (error) throw error;
      loadTemplates();
    } catch (error) {
      console.error('Error deleting template:', error);
    }
  };

  const selectAllCurrentGroup = () => {
    if (!selectedAdminId) return;
    const employees = getFilteredEmployees();
    const employeeIds = employees.map(e => e.id);
    const allSelected = employees.length > 0 && employees.every(e => selectedEmployeeIds.has(e.id));

    if (allSelected) {
      setSelectedEmployeeIds(prev => {
        const next = new Set(prev);
        employeeIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      setSelectedEmployeeIds(prev => new Set([...Array.from(prev), ...employeeIds]));
    }
  };

  const toggleEmployeeSelection = (employeeId: string) => {
    setSelectedEmployeeIds(prev => {
      const next = new Set(prev);
      if (next.has(employeeId)) {
        next.delete(employeeId);
      } else {
        next.add(employeeId);
      }
      return next;
    });
  };

  const selectAllEmployees = () => {
    const allIds: string[] = [];
    adminGroups.forEach(group => {
      const employees = allEmployees.get(group.id) || [];
      employees.forEach(emp => allIds.push(emp.id));
    });
    setSelectedEmployeeIds(new Set(allIds));
  };

  const clearSelection = () => {
    setSelectedEmployeeIds(new Set());
  };

  const getFilteredEmployees = (): Employee[] => {
    if (!selectedAdminId) return [];
    const employees = allEmployees.get(selectedAdminId) || [];
    let filtered = employees;

    if (filterStatus === 'active') {
      filtered = filtered.filter(e => e.is_active);
    } else if (filterStatus === 'verified') {
      filtered = filtered.filter(e => e.is_verified);
    }

    if (selectedTags.size > 0) {
      filtered = filtered.filter(e => {
        if (!e.tags || !Array.isArray(e.tags)) return false;
        return Array.from(selectedTags).some(tag => e.tags.includes(tag));
      });
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(e =>
        e.username.toLowerCase().includes(query) ||
        e.employee_id.toLowerCase().includes(query)
      );
    }

    filtered.sort((a, b) => {
      const aSelected = selectedEmployeeIds.has(a.id) ? 0 : 1;
      const bSelected = selectedEmployeeIds.has(b.id) ? 0 : 1;
      return aSelected - bSelected;
    });

    return filtered;
  };

  const toggleTagFilter = (tag: string) => {
    setSelectedTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  };

  const clearTagFilter = () => {
    setSelectedTags(new Set());
  };

  const validateAndSendMessage = async () => {
    if (!messageForm.title.trim()) {
      setNotification({ type: 'error', message: 'Please enter a message title' });
      return;
    }

    const content = composeEditorRef.current?.getContent() || '';
    if (!content.trim() || content === '<p></p>') {
      setNotification({ type: 'error', message: 'Please enter message content' });
      return;
    }

    if (selectedEmployeeIds.size === 0) {
      setNotification({ type: 'error', message: 'Please select at least one recipient' });
      return;
    }

    if (admin.role === 'secondary_admin') {
      const myEmployees = allEmployees.get(admin.id) || [];
      const myEmployeeIds = new Set(myEmployees.map(e => e.id));
      const unauthorized = Array.from(selectedEmployeeIds).filter(id => !myEmployeeIds.has(id));

      if (unauthorized.length > 0) {
        setNotification({
          type: 'error',
          message: `Cannot send to ${unauthorized.length} employee(s) not under your management`
        });
        return;
      }
    }

    if (manualRewardEnabled) {
      const amount = Number(manualRewardAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        setNotification({ type: 'error', message: '請輸入有效的績效獎金金額' });
        return;
      }
      setShowRewardConfirm(true);
      return;
    }

    await sendMessage();
  };

  const sendMessage = async () => {
    setSending(true);
    setSendProgress({ sent: 0, total: selectedEmployeeIds.size });

    try {
      const htmlContent = composeEditorRef.current?.getContent() || '';
      const rewardAmount = manualRewardEnabled ? Number(manualRewardAmount) : null;
      if (manualRewardEnabled && (!Number.isFinite(rewardAmount) || Number(rewardAmount) <= 0)) {
        throw new Error('請輸入有效的績效獎金金額');
      }

      const { data, error } = await supabase.rpc('send_admin_message_secure', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_recipient_ids: Array.from(selectedEmployeeIds),
        p_title: messageForm.title.trim(),
        p_content: htmlContent,
        p_message_type: messageForm.messageType,
        p_priority: messageForm.priority,
        p_reward_amount: rewardAmount,
        p_operation_id: crypto.randomUUID(),
      });
      if (error) throw error;

      const result = data as { sent_count?: number; total_reward?: number; currency?: string | null } | null;
      const successCount = Number(result?.sent_count || 0);
      setSendProgress({ sent: successCount, total: selectedEmployeeIds.size });
      setNotification({
        type: 'success',
        message: manualRewardEnabled
          ? `已向 ${successCount} 名員工發送通知並發放 ${Number(result?.total_reward || 0).toFixed(2)} ${result?.currency || currencyUnit}`
          : `訊息已成功發送給 ${successCount} 名員工`,
      });

      setMessageForm({ title: '', content: '', messageType: 'realtime', priority: 'normal' });
      setManualRewardEnabled(false);
      setManualRewardAmount('');
      composeEditorRef.current?.getEditor()?.commands.clearContent();
      setSelectedEmployeeIds(new Set());
      await loadSentMessages();
    } catch (error: unknown) {
      console.error('Error sending message:', formatSupabaseError(error));
      setNotification({ type: 'error', message: formatSupabaseError(error) || '訊息發送失敗' });
    } finally {
      setSending(false);
      setSendProgress(null);
    }
  };
  loadTemplatesRef.current = loadTemplates;

  const loadSentMessages = async (isBackgroundRefresh = false) => {
    if (sentMessagesLoadingRef.current) {
      sentMessagesRefreshPendingRef.current = true;
      return;
    }

    sentMessagesLoadingRef.current = true;
    if (!isBackgroundRefresh) setMessagesLoading(true);
    try {
      let query = supabase
        .from('messages')
        .select('*')
        .order('created_at', { ascending: false });

      if (admin.role !== 'super_admin' && !admin.is_super_admin) {
        query = query.eq('sender_id', admin.id);
      }

      const { data, error } = await query;
      if (error) throw error;

      const messageIds = (data || []).map(msg => msg.id);
      sentMessageIdsRef.current = new Set(messageIds);

      let allRecipients: Array<{ message_id: string; recipient_id: string; is_read: boolean | null }> = [];
      if (messageIds.length > 0 && (admin.role !== 'secondary_admin' || scopedEmployeeIdsRef.current.size > 0)) {
        let recipientsQuery = supabase
          .from('message_recipients')
          .select('message_id, recipient_id, is_read')
          .in('message_id', messageIds);
        if (admin.role === 'secondary_admin') {
          recipientsQuery = recipientsQuery.in('recipient_id', Array.from(scopedEmployeeIdsRef.current));
        }
        const { data: recipients, error: recipientsError } = await recipientsQuery;
        if (recipientsError) throw recipientsError;
        allRecipients = recipients || [];
      }

      const recipientIds = Array.from(new Set(allRecipients.map(recipient => recipient.recipient_id)));
      let recipientUsers: Array<{ id: string; username: string; employee_id: string; is_verified: boolean }> = [];
      if (recipientIds.length > 0) {
        let recipientUsersQuery = supabase
          .from('users')
          .select('id, username, employee_id, is_verified')
          .in('id', recipientIds);
        if (admin.role === 'secondary_admin') {
          recipientUsersQuery = recipientUsersQuery.eq('created_by', admin.id);
        }
        const { data: users, error: recipientUsersError } = await recipientUsersQuery;
        if (recipientUsersError) throw recipientUsersError;
        recipientUsers = users || [];
      }

      const recipientEmployeeMap = new Map(recipientUsers?.map(user => [user.id, user]) || []);
      const recipientsByMessage = new Map<string, string[]>();
      const statsByMessage = new Map<string, MessageStats>();
      const recipientUsernamesByMessage = new Map<string, string[]>();
      const recipientDetailsByMessage = new Map<string, { read: Employee[]; unread: Employee[] }>();

      messageIds.forEach(msgId => {
        recipientsByMessage.set(msgId, []);
        recipientUsernamesByMessage.set(msgId, []);
        recipientDetailsByMessage.set(msgId, { read: [], unread: [] });
        statsByMessage.set(msgId, { total_recipients: 0, read_count: 0, unread_count: 0, read_percentage: 0 });
      });

      (allRecipients || []).forEach(recipient => {
        const recipientList = recipientsByMessage.get(recipient.message_id)!;
        recipientList.push(recipient.recipient_id);

        const employee = recipientEmployeeMap.get(recipient.recipient_id);
        if (employee) {
          const details = recipientDetailsByMessage.get(recipient.message_id)!;
          if (recipient.is_read) details.read.push(employee as Employee);
          else details.unread.push(employee as Employee);
        }

        if (employee?.username) {
          const usernameList = recipientUsernamesByMessage.get(recipient.message_id)!;
          usernameList.push(employee.username);
        }

        const stats = statsByMessage.get(recipient.message_id)!;
        stats.total_recipients++;
        if (recipient.is_read) stats.read_count++;
        else stats.unread_count++;
        stats.read_percentage = Math.round((stats.read_count / stats.total_recipients) * 100);
      });

      const messagesWithRecipients = (data || []).map(msg => ({
        ...msg,
        recipient_ids: recipientsByMessage.get(msg.id) || []
      }));

      setSentMessages(messagesWithRecipients);
      setMessageStats(statsByMessage);
      setRecipientUsernames(recipientUsernamesByMessage);
      setRecipientDetails(recipientDetailsByMessage);
      if (!isBackgroundRefresh) setSelectedMessageIds(new Set());
    } catch (error) {
      if (!isSupabaseAbortError(error)) {
        console.error('Error loading messages:', formatSupabaseError(error));
      }
    } finally {
      sentMessagesLoadingRef.current = false;
      if (!isBackgroundRefresh) setMessagesLoading(false);

      if (sentMessagesRefreshPendingRef.current) {
        sentMessagesRefreshPendingRef.current = false;
        void loadSentMessages(true);
      }
    }
  };
  loadSentMessagesRef.current = loadSentMessages;

  const loadRecipientDetails = async (messageId: string) => {
    if (recipientDetails.has(messageId) || recipientDetailsRequestsRef.current.has(messageId)) return;

    recipientDetailsRequestsRef.current.add(messageId);
    recipientDetailsLoadingCountRef.current += 1;
    setLoadingRecipientDetails(true);
    try {
      let recipientsQuery = supabase
        .from('message_recipients')
        .select('recipient_id, is_read')
        .eq('message_id', messageId);
      if (admin.role === 'secondary_admin') {
        const scopedEmployeeIds = Array.from(scopedEmployeeIdsRef.current);
        if (scopedEmployeeIds.length === 0) {
          setRecipientDetails(prev => new Map(prev).set(messageId, { read: [], unread: [] }));
          return;
        }
        recipientsQuery = recipientsQuery.in('recipient_id', scopedEmployeeIds);
      }

      const { data: recipients, error } = await recipientsQuery;

      if (error) throw error;

      const rIds = recipients?.map(r => r.recipient_id) || [];
      if (rIds.length === 0) {
        setRecipientDetails(prev => new Map(prev).set(messageId, { read: [], unread: [] }));
        return;
      }

      const employeeMap = new Map(
        Array.from(allEmployees.values())
          .flat()
          .map(employee => [employee.id, employee] as const),
      );
      const missingRecipientIds = rIds.filter(recipientId => !employeeMap.has(recipientId));

      if (missingRecipientIds.length > 0) {
        let employeesQuery = supabase
          .from('users')
          .select('id, username, employee_id, is_verified')
          .in('id', missingRecipientIds);
        if (admin.role === 'secondary_admin') {
          employeesQuery = employeesQuery.eq('created_by', admin.id);
        }
        const { data: employees, error: empError } = await employeesQuery;

        if (empError) throw empError;
        employees?.forEach(employee => employeeMap.set(employee.id, employee as Employee));
      }
      const read: Employee[] = [];
      const unread: Employee[] = [];

      recipients?.forEach(r => {
        const emp = employeeMap.get(r.recipient_id);
        if (emp) {
          if (r.is_read) read.push(emp as Employee);
          else unread.push(emp as Employee);
        }
      });

      setRecipientDetails(prev => new Map(prev).set(messageId, { read, unread }));
    } catch (error) {
      if (!isSupabaseAbortError(error)) {
        console.error('Error loading recipient details:', formatSupabaseError(error));
      }
    } finally {
      recipientDetailsRequestsRef.current.delete(messageId);
      recipientDetailsLoadingCountRef.current = Math.max(0, recipientDetailsLoadingCountRef.current - 1);
      setLoadingRecipientDetails(recipientDetailsLoadingCountRef.current > 0);
    }
  };
  loadRecipientDetailsRef.current = loadRecipientDetails;

  const handleDeleteSelected = async () => {
    if (selectedMessageIds.size === 0) return;
    setDeleting(true);
    try {
      const messageIdsArray = Array.from(selectedMessageIds);
      const { data, error } = await supabase.rpc('delete_messages', {
        message_ids: messageIdsArray,
        requesting_admin_id: admin.id
      });
      if (error) throw error;

      const result = data as { success: boolean; deleted_count: number; failed_count: number };
      if (result.success) {
        setNotification({ type: 'success', message: `Successfully deleted ${result.deleted_count} message(s)` });
        await loadSentMessages();
        setShowDeleteConfirm(false);
        setDeleteMode(null);
        setSelectedMessageDetail(null);
        exitSelectionMode();
      }
    } catch (error) {
      console.error('Error deleting messages:', error);
      setNotification({ type: 'error', message: 'Failed to delete messages' });
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteAll = async () => {
    setDeleting(true);
    try {
      const targetAdminId = selectedAdminId || admin.id;
      const { data, error } = await supabase.rpc('delete_all_messages_for_admin', {
        requesting_admin_id: admin.id,
        target_admin_id: targetAdminId
      });
      if (error) throw error;

      const result = data as { success: boolean; deleted_count: number; error?: string };
      if (result.success) {
        setNotification({ type: 'success', message: `Successfully deleted ${result.deleted_count} message(s)` });
        await loadSentMessages();
        setShowDeleteConfirm(false);
        setDeleteMode(null);
        exitSelectionMode();
      } else {
        setNotification({ type: 'error', message: result.error || 'Failed to delete messages' });
      }
    } catch (error) {
      console.error('Error deleting all messages:', error);
      setNotification({ type: 'error', message: 'Failed to delete messages' });
    } finally {
      setDeleting(false);
    }
  };

  const handleConfirmDelete = () => {
    if (deleteMode === 'selected') handleDeleteSelected();
    else if (deleteMode === 'all') handleDeleteAll();
  };

  const handleStartEdit = (msg: Message) => {
    setEditForm({ title: msg.title, content: msg.content });
    setEditingMessage(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedMessageDetail) return;
    const htmlContent = editEditorRef.current?.getContent() || '';
    if (!editForm.title.trim() || !htmlContent.trim() || htmlContent === '<p></p>') {
      setNotification({ type: 'error', message: 'Title and content cannot be empty' });
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('messages')
        .update({ title: editForm.title.trim(), content: htmlContent })
        .eq('id', selectedMessageDetail.id);

      if (error) throw error;

      setSelectedMessageDetail({ ...selectedMessageDetail, title: editForm.title.trim(), content: htmlContent });
      setEditingMessage(false);
      setNotification({ type: 'success', message: 'Message updated successfully' });
      loadSentMessages();
    } catch (error: unknown) {
      console.error('Error updating message:', formatSupabaseError(error));
      setNotification({ type: 'error', message: formatSupabaseError(error) || 'Failed to update message' });
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingMessage(false);
    setEditForm({ title: '', content: '' });
  };

  const toggleMessageSelection = (messageId: string) => {
    const newSelection = new Set(selectedMessageIds);
    if (newSelection.has(messageId)) newSelection.delete(messageId);
    else newSelection.add(messageId);
    setSelectedMessageIds(newSelection);
  };

  const enterSelectionMode = () => {
    setSelectionMode(true);
    setSelectedMessageIds(new Set());
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedMessageIds(new Set());
  };

  const selectedGroupEmployeeIds = new Set(
    (selectedAdminId ? allEmployees.get(selectedAdminId) || [] : []).map(employee => employee.id),
  );

  const filteredMessages = sentMessages.filter(msg => {
    if (selectedAdminId) {
      const recipientIds = msg.recipient_ids || [];
      if (!recipientIds.some(recipientId => selectedGroupEmployeeIds.has(recipientId))) return false;
    }
    if (messageTypeFilter !== 'all') {
      if (messageTypeFilter === 'realtime' && msg.message_type !== 'realtime') return false;
      if (messageTypeFilter === 'login_popup' && msg.message_type !== 'login_popup') return false;
    }
    if (messageScopeFilter !== 'all') {
      const isBroadcast = !msg.recipient_ids || msg.recipient_ids.length === 0;
      if (messageScopeFilter === 'broadcast' && !isBroadcast) return false;
      if (messageScopeFilter === 'targeted' && isBroadcast) return false;
    }
    if (readStatusFilter !== 'all') {
      const stats = messageStats.get(msg.id);
      const totalRecipients = stats?.total_recipients || 0;
      const readCount = stats?.read_count || 0;
      if (readStatusFilter === 'read' && (totalRecipients === 0 || readCount !== totalRecipients)) return false;
      if (readStatusFilter === 'unread' && readCount === totalRecipients) return false;
    }
    if (sentMessagesSearchQuery.trim()) {
      const query = sentMessagesSearchQuery.toLowerCase();
      const matchesTitle = msg.title.toLowerCase().includes(query);
      const matchesContent = msg.content.toLowerCase().includes(query);
      const matchesSender = msg.sender_username.toLowerCase().includes(query);
      const recipientNames = recipientUsernames.get(msg.id) || [];
      const matchesRecipient = recipientNames.some(name => name.toLowerCase().includes(query));
      if (!matchesTitle && !matchesContent && !matchesSender && !matchesRecipient) return false;
    }
    return true;
  });

  const totalPages = Math.ceil(filteredMessages.length / messagesPerPage);
  const paginatedMessages = filteredMessages.slice(
    (currentPage - 1) * messagesPerPage,
    currentPage * messagesPerPage
  );
  useEffect(() => {
    setCurrentPage(1);
    setSelectedMessageIds(new Set());
  }, [selectedAdminId, messageTypeFilter, messageScopeFilter, readStatusFilter, sentMessagesSearchQuery]);

  const toggleSelectAll = () => {
    if (selectedMessageIds.size === filteredMessages.length && filteredMessages.every(m => selectedMessageIds.has(m.id))) {
      const newSelection = new Set(selectedMessageIds);
      filteredMessages.forEach(m => newSelection.delete(m.id));
      setSelectedMessageIds(newSelection);
    } else {
      const newSelection = new Set(selectedMessageIds);
      filteredMessages.forEach(m => newSelection.add(m.id));
      setSelectedMessageIds(newSelection);
    }
  };

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'text-red-400 bg-red-500/10 border-red-500/30';
      case 'high': return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
      case 'normal': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
      case 'low': return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
      default: return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
    }
  };

  const getPriorityBorderColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'border-l-red-500';
      case 'high': return 'border-l-amber-500';
      case 'normal': return 'border-l-emerald-500';
      case 'low': return 'border-l-slate-500';
      default: return 'border-l-slate-500';
    }
  };

  if (loading && !initialEmployee) {
    return (
      <div className="flex min-h-[280px] flex-1 flex-col items-center justify-center gap-4 text-center text-slate-400">
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-300/25 bg-cyan-400/10 shadow-[0_0_30px_rgba(34,211,238,0.12)]">
          <span className="absolute inset-1 animate-ping rounded-xl border border-cyan-300/25 [animation-duration:1.6s]" />
          <span className="relative h-8 w-8 animate-spin rounded-full border-[3px] border-cyan-300/25 border-t-cyan-300" />
        </div>
        <div>
          <p className="text-sm font-semibold text-cyan-100">正在載入訊息</p>
          <p className="mt-1 text-[11px] text-slate-500">正在準備頁面資料，請稍候……</p>
        </div>
      </div>
    );
  }

  const allEmployeesFlat = Array.from(allEmployees.values()).flat();
  const totalEmployees = allEmployeesFlat.length;
  const filteredEmployees = getFilteredEmployees();
  const allCurrentSelected = filteredEmployees.length > 0 && filteredEmployees.every(e => selectedEmployeeIds.has(e.id));
  const allEmployeesSelected = allEmployeesFlat.length > 0 && allEmployeesFlat.every(emp => selectedEmployeeIds.has(emp.id));
  const messageTypeTone = getMessageTypeTone(selectedMessageDetail?.message_type || 'realtime');
  const messagePriorityTone = getMessagePriorityTone(selectedMessageDetail?.priority || 'normal');

  if (showAutomation) {
    return (
      <NotificationAutomation
        admin={admin}
        employees={allEmployeesFlat}
        onBack={() => setShowAutomation(false)}
        notify={(type, message) => setNotification({ type, message })}
      />
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {showRewardConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-amber-400/30 bg-slate-900 shadow-2xl shadow-amber-950/50">
            <div className="bg-gradient-to-r from-amber-500/20 to-orange-500/10 p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-400 text-amber-950"><Gift className="h-5 w-5" /></div>
                <div><h3 className="font-bold text-amber-100">確認發放績效獎金</h3><p className="mt-1 text-xs leading-5 text-amber-200/60">獎金會在訊息發送時立即加入員工錢包，不需要員工點擊領取。</p></div>
              </div>
            </div>
            <div className="space-y-3 p-5">
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="rounded-xl bg-slate-950 p-3"><p className="text-[10px] text-slate-500">收件員工</p><p className="mt-1 text-lg font-black text-white">{selectedEmployeeIds.size} 人</p></div>
                <div className="rounded-xl bg-slate-950 p-3"><p className="text-[10px] text-slate-500">每人獎金</p><p className="mt-1 text-lg font-black text-amber-300">{Number(manualRewardAmount || 0).toFixed(2)} {currencyUnit}</p></div>
              </div>
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-center"><p className="text-[10px] font-bold uppercase tracking-wider text-amber-300/60">預計發放總額</p><p className="mt-1 text-2xl font-black text-amber-200">{(Number(manualRewardAmount || 0) * selectedEmployeeIds.size).toFixed(2)} {currencyUnit}</p></div>
            </div>
            <div className="flex gap-3 border-t border-slate-700 p-4">
              <button onClick={() => setShowRewardConfirm(false)} className="h-10 flex-1 rounded-xl border border-slate-700 bg-slate-800 text-sm font-bold text-slate-300 hover:bg-slate-700">取消</button>
              <button onClick={() => { setShowRewardConfirm(false); void sendMessage(); }} className="h-10 flex-1 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 text-sm font-black text-amber-950 shadow-lg shadow-amber-950/40">確認發放</button>
            </div>
          </div>
        </div>
      )}

      {/* Notification */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-6 py-4 rounded-lg shadow-2xl border backdrop-blur-xl transition-all duration-300 ${
          notification.type === 'success'
            ? 'bg-green-900/90 border-green-500/50 text-green-100'
            : 'bg-red-900/90 border-red-500/50 text-red-100'
        }`}>
          {notification.type === 'success' ? <Bell className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          <span className="font-medium">{notification.message}</span>
          <button onClick={() => setNotification(null)} className="ml-2 text-white/60 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Send Progress */}
      {sendProgress && (
        <div className="fixed bottom-4 right-4 bg-slate-800 rounded-xl p-4 shadow-2xl border border-blue-500/30 z-50">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <div>
              <div className="font-bold text-white">Sending Messages...</div>
              <div className="text-sm text-slate-400">{sendProgress.sent} of {sendProgress.total} sent</div>
            </div>
          </div>
          <div className="w-64 h-2 bg-slate-700 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 transition-all duration-300" style={{ width: `${(sendProgress.sent / sendProgress.total) * 100}%` }} />
          </div>
        </div>
      )}

      {/* Top Bar */}
      <div className="flex items-center justify-between px-5 py-2.5 bg-slate-900/95 border-b border-slate-700/60">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 shadow-sm shadow-blue-900/40">
            <Send className="h-4 w-4 text-white" />
          </div>
          <h2 className="text-base font-bold tracking-tight text-white">Messages</h2>
          <span className="text-[11px] font-medium text-slate-400">
            {selectedEmployeeIds.size > 0 ? `${selectedEmployeeIds.size} recipient${selectedEmployeeIds.size > 1 ? 's' : ''} selected` : `${totalEmployees} employees total`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {selectedEmployeeIds.size > 0 && (
            <button onClick={clearSelection} className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 text-[11px] font-bold text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-700 hover:text-white">
              <X className="w-3 h-3" />
              Clear
            </button>
          )}
          <button onClick={() => setShowAutomation(true)} className="flex h-8 items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 text-[11px] font-bold text-cyan-200 transition-colors hover:border-cyan-300/50 hover:bg-cyan-500/20">
            <Sparkles className="h-3.5 w-3.5" />
            自動化任務
          </button>
        </div>
      </div>

      {/* 4-Panel Horizontal Layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden rounded-xl border border-slate-700/60 bg-slate-950/80 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.95)]">

        {/* Panel 1: Admin Groups */}
        {admin.role !== 'secondary_admin' && (
          <div className="flex w-56 flex-shrink-0 flex-col border-r border-slate-700/60 bg-slate-900/95">
            <div className="flex items-center justify-between border-b border-slate-700/60 bg-slate-800/45 px-3.5 py-3">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-4 rounded-full bg-blue-500"></div>
                <h3 className="text-[11px] font-bold text-slate-200 uppercase tracking-wider">Groups</h3>
              </div>
              <span className="text-[10px] min-w-[24px] text-center py-0.5 px-1.5 rounded-md bg-blue-600/20 text-blue-300 font-bold border border-blue-500/20">{adminGroups.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-dark p-2 space-y-1.5">
              {adminGroups.map(group => {
                const groupEmployees = allEmployees.get(group.id) || [];
                const selectedInGroup = groupEmployees.filter(e => selectedEmployeeIds.has(e.id)).length;
                const isActive = selectedAdminId === group.id;
                return (
                  <button
                    key={group.id}
                    onClick={() => {
                      setSelectedAdminId(group.id);
                      setSelectedMessageIds(new Set());
                      setSelectedMessageDetail(null);
                    }}
                    className={`group w-full text-left px-3 py-3 rounded-xl transition-all duration-200 border ${
                      isActive
                        ? 'bg-blue-600/20 border-blue-400/60 ring-1 ring-blue-400/30 shadow-md shadow-blue-900/20 border-l-[3px] border-l-blue-400'
                        : 'bg-slate-800/45 border-slate-700/50 hover:bg-slate-800/75 hover:border-slate-600/70'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 mb-2">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-bold flex-shrink-0 transition-colors border ${
                        isActive
                          ? 'bg-blue-500/40 text-white border-blue-400/60'
                          : group.role === 'super_admin'
                            ? 'bg-blue-500/15 text-blue-400 border-blue-500/20 group-hover:bg-blue-500/25'
                            : 'bg-teal-500/15 text-teal-400 border-teal-500/20 group-hover:bg-teal-500/25'
                      }`}>
                        {group.role === 'super_admin' ? 'S' : 'A'}
                      </div>
                      <span className={`text-[13px] font-semibold truncate flex-1 transition-colors ${
                        isActive ? 'text-white' : 'text-slate-200 group-hover:text-white'
                      }`}>{group.username}</span>
                    </div>
                    <div className="flex items-center justify-between pl-[42px] text-[11px]">
                      <div className="flex items-center gap-1">
                        <Users className="w-3 h-3 text-slate-500" />
                        <span className={isActive ? 'text-slate-200 font-medium' : 'text-slate-400'}>{group.total_employees}</span>
                      </div>
                      {selectedInGroup > 0 && (
                        <span className="font-bold text-blue-200 bg-blue-500/25 px-2 py-0.5 rounded-md border border-blue-400/30 text-[11px]">{selectedInGroup} selected</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Panel 2: Employees */}
        <div className="flex w-64 flex-shrink-0 flex-col border-r border-slate-700/70 bg-slate-950/35">
          <div className="space-y-1 border-b border-slate-700/70 bg-slate-900/85 px-2.5 py-1.5">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
              <input
                type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search employees..."
                className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-8 text-[11px] font-medium text-slate-900 placeholder-slate-400 outline-none transition-colors duration-150 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Status + Tag filters row */}
            <div className="flex items-center gap-1.5">
              <div className="flex flex-1 gap-0.5 rounded-lg border border-slate-700/80 bg-slate-950/65 p-0.5">
                {(['all', 'active', 'verified'] as const).map(status => (
                  <button key={status} onClick={() => setFilterStatus(status)}
                    className={`flex-1 rounded-md border px-1 py-1 text-[10px] font-bold transition-colors duration-150 ${
                      filterStatus === status
                        ? status === 'active'
                          ? 'border-emerald-400/70 bg-emerald-500/25 text-emerald-100'
                          : status === 'verified'
                            ? 'border-violet-400/70 bg-violet-500/25 text-violet-100'
                            : 'border-blue-400/70 bg-blue-500/25 text-blue-100'
                        : 'border-slate-700/60 bg-slate-900/40 text-slate-400 hover:border-slate-500 hover:bg-slate-800 hover:text-slate-100'
                    }`}>
                    {status === 'all' ? 'All' : status === 'active' ? 'Active' : 'Verified'}
                  </button>
                ))}
              </div>

              {/* Tag dropdown */}
              {allAvailableTags.length > 0 && (
                <div className="relative" ref={tagDropdownRef}>
                  <button onClick={() => setShowTagDropdown(!showTagDropdown)}
                    aria-expanded={showTagDropdown}
                    aria-haspopup="menu"
                    className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold transition-colors duration-150 ${
                      selectedTags.size > 0
                        ? 'border-teal-400/70 bg-teal-500/25 text-teal-100'
                        : 'border-slate-600/80 bg-slate-900/60 text-slate-300 hover:border-teal-500/60 hover:bg-slate-800 hover:text-teal-100'
                    }`}>
                    <Tag className="h-3 w-3" />
                    <span className="hidden min-[1380px]:inline">Tags</span>
                    {selectedTags.size > 0 && <span className="min-w-[18px] rounded border border-teal-300/50 bg-teal-400/25 px-1 text-center text-[9px] font-bold text-teal-50">{selectedTags.size}</span>}
                    <ChevronDown className={`h-2.5 w-2.5 transition-transform duration-150 ${showTagDropdown ? 'rotate-180' : ''}`} />
                  </button>
                  {showTagDropdown && (
                    <div className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-2xl border border-teal-400/30 bg-slate-900/[0.98] shadow-2xl shadow-slate-950/70 ring-1 ring-white/[0.04] backdrop-blur-xl">
                      <div className="border-b border-teal-300/15 bg-gradient-to-r from-teal-500/15 via-slate-800/70 to-transparent px-3.5 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="flex h-6 w-6 items-center justify-center rounded-lg border border-teal-300/25 bg-teal-400/15 text-teal-300">
                              <Tag className="h-3.5 w-3.5" />
                            </span>
                            <span className="text-xs font-black text-slate-100">Filter by tag</span>
                          </div>
                          <span className="rounded-md border border-slate-600/60 bg-slate-950/60 px-1.5 py-0.5 text-[9px] font-bold tabular-nums text-slate-400">{allAvailableTags.length}</span>
                        </div>
                        <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">Choose one or more tags to narrow recipients.</p>
                        {selectedTags.size > 0 && (
                          <button onClick={() => { clearTagFilter(); setShowTagDropdown(false); }} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-red-400/70 bg-red-500/20 px-2 py-1.5 text-[10px] font-extrabold text-red-100 transition-colors hover:border-red-300 hover:bg-red-500/35">
                            <X className="h-3 w-3" />
                            Clear selected tags
                          </button>
                        )}
                      </div>
                      <div className="max-h-56 space-y-1 overflow-y-auto p-2 scrollbar-dark">
                        {allAvailableTags.map(tag => (
                          <button key={tag} onClick={() => toggleTagFilter(tag)}
                            className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[11px] transition-colors duration-150 ${
                              selectedTags.has(tag)
                                ? 'border-teal-300/70 bg-teal-500/25 text-teal-50'
                                : 'border-slate-700/70 bg-slate-800/55 text-slate-300 hover:border-slate-500 hover:bg-slate-700/80 hover:text-white'
                            }`}>
                            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${selectedTags.has(tag) ? 'border-teal-300/50 bg-teal-400/20 text-teal-200' : 'border-slate-600 bg-slate-800/80 text-slate-500'}`}>
                              {selectedTags.has(tag) ? <Check className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                            </span>
                            <span className={selectedTags.has(tag) ? 'font-bold text-teal-100' : 'font-medium'}>{tag}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Employee count + Select */}
            {selectedAdminId && (
              <div className="flex items-center justify-between gap-1.5 border-t border-slate-800/80 px-0.5 pt-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="text-[8px] font-bold uppercase tracking-[0.1em] text-slate-600">Visible</span>
                  <span className="min-w-[22px] rounded border border-blue-400/60 bg-blue-500/20 px-1.5 py-px text-center text-[10px] font-extrabold tabular-nums text-blue-100">{filteredEmployees.length}</span>
                  {selectedEmployeeIds.size > 0 && (
                    <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-px text-[9px] font-semibold tabular-nums text-emerald-300">{selectedEmployeeIds.size} selected</span>
                  )}
                </div>
                {filteredEmployees.length > 0 && (
                  <button onClick={selectAllCurrentGroup}
                    className={`flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-bold transition-colors duration-150 ${
                      allCurrentSelected
                        ? 'border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700'
                        : 'border-slate-600 bg-slate-800/80 text-slate-300 hover:border-slate-500 hover:bg-slate-700'
                    }`}>
                    {allCurrentSelected ? <><CheckSquare className="h-3.5 w-3.5" /> Deselect</> : <><Square className="h-3.5 w-3.5" /> Select all</>}
                  </button>
                )}
              </div>
            )}

          </div>

          {/* Employee List */}
          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-dark">
            {!selectedAdminId ? (
              <div className="px-4 py-14 text-center">
                <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center mx-auto mb-3 border border-slate-700/50">
                  <Users className="w-6 h-6 text-slate-500" />
                </div>
                <p className="text-sm text-slate-400 font-medium">Select a group</p>
              </div>
            ) : filteredEmployees.length === 0 ? (
              <div className="px-4 py-14 text-center">
                <p className="text-sm text-slate-400 font-medium">No employees found</p>
              </div>
            ) : (
              <div className="space-y-0.5 p-1.5">
                {filteredEmployees.map(emp => {
                  const isSelected = selectedEmployeeIds.has(emp.id);
                  return (
                    <div
                      key={emp.id}
                      onClick={() => toggleEmployeeSelection(emp.id)}
                      aria-pressed={isSelected}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          toggleEmployeeSelection(emp.id);
                        }
                      }}
                      className={`group relative cursor-pointer overflow-hidden rounded-lg border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400/60 ${
                        isSelected
                          ? 'border-emerald-400/70 border-l-2 border-l-emerald-300 bg-emerald-500/20 px-2.5 py-2'
                          : 'border-slate-800 bg-slate-900/45 px-2 py-1.5 hover:border-slate-700 hover:bg-slate-800/80'
                      } ${emp.is_pinned && !isSelected ? 'border-l-2 border-l-amber-500/70' : ''}`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border transition-colors duration-150 ${
                          isSelected
                            ? 'border-emerald-300/80 bg-emerald-400/25 text-emerald-50'
                            : 'border-slate-700 bg-slate-950/70 text-slate-600 group-hover:border-slate-600 group-hover:text-slate-300'
                        }`}>
                          {isSelected ? (
                            <Check className="h-4 w-4" strokeWidth={3} />
                          ) : (
                            <Square className="h-4 w-4" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={`truncate tracking-tight ${isSelected ? 'text-[13px] font-bold text-white' : 'text-[11px] font-semibold text-slate-300 group-hover:text-white'}`}>
                              {emp.username}
                            </span>
                            {emp.is_pinned && (
                              <Bookmark className="w-3.5 h-3.5 text-amber-400 fill-amber-400/40 flex-shrink-0" />
                            )}
                            {!emp.is_active && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-red-500/20 text-red-300 font-bold flex-shrink-0 border border-red-500/20">OFF</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={`font-mono ${isSelected ? 'text-[11px] font-semibold text-emerald-100/90' : 'text-[10px] text-slate-500'}`}>{emp.employee_id}</span>
                            {emp.tags && emp.tags.length > 0 && (
                              <div className="flex min-w-0 gap-1 overflow-hidden">
                                {emp.tags.slice(0, 2).map((tag, idx) => (
                                  <span key={idx} className={`max-w-[76px] truncate rounded-md border px-1.5 py-px text-[9px] font-bold ${isSelected ? 'border-emerald-300/40 bg-emerald-400/20 text-emerald-50' : 'border-teal-400/15 bg-teal-500/10 text-teal-300'}`}>
                                    {tag}
                                  </span>
                                ))}
                                {emp.tags.length > 2 && (
                                  <span className={`shrink-0 text-[10px] font-bold ${isSelected ? 'text-emerald-100/80' : 'text-slate-500'}`}>+{emp.tags.length - 2}</span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex gap-1.5 border-t border-slate-700/70 bg-slate-900/95 px-2 py-2">
            <button onClick={selectAllEmployees} disabled={allEmployeesSelected}
              className="flex flex-1 items-center justify-center gap-1 rounded-md border border-blue-400/60 bg-blue-600/25 px-2 py-1.5 text-[10px] font-bold text-blue-50 transition-colors duration-150 hover:border-blue-300/80 hover:bg-blue-600/40 disabled:cursor-not-allowed disabled:border-emerald-500/30 disabled:bg-emerald-500/10 disabled:text-emerald-200">
              {allEmployeesSelected ? <><CheckSquare className="h-3.5 w-3.5" /> All selected</> : <><Users className="h-3.5 w-3.5" /> Select all</>}
            </button>
            <button onClick={clearSelection} disabled={selectedEmployeeIds.size === 0}
              className="flex flex-1 items-center justify-center gap-1 rounded-md border border-red-400/55 bg-red-500/15 px-2 py-1.5 text-[10px] font-bold text-red-100 transition-colors duration-150 hover:border-red-300/80 hover:bg-red-500/25 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-slate-950 disabled:text-slate-600">
              <X className="h-3.5 w-3.5" />
              Clear selection
            </button>
          </div>
        </div>

        {/* Panel 3: Compose Message */}
        <div className="flex min-w-0 flex-1 flex-col border-r border-slate-700/60 bg-slate-900/95">
          <div className="flex-1 min-h-0 flex flex-col p-3 gap-3">
            {/* Type + Priority + Template row */}
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              {/* Type selector */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Type</span>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setMessageForm({ ...messageForm, messageType: 'realtime' })}
                    className={`flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[11px] font-bold transition-colors duration-200 ${
                      messageForm.messageType === 'realtime'
                        ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                        : 'bg-slate-800 text-blue-300 border-blue-800/80 hover:bg-blue-950/80 hover:border-blue-700'
                    }`}>
                    <Bell className="w-3.5 h-3.5" />
                    Realtime
                  </button>
                  <button
                    onClick={() => setMessageForm({ ...messageForm, messageType: 'login_popup' })}
                    className={`flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[11px] font-bold transition-colors duration-200 ${
                      messageForm.messageType === 'login_popup'
                        ? 'bg-violet-600 text-white border-violet-500 shadow-sm'
                        : 'bg-slate-800 text-violet-300 border-violet-800/80 hover:bg-violet-950/80 hover:border-violet-700'
                    }`}>
                    <AlertCircle className="w-3.5 h-3.5" />
                    Login Popup
                  </button>
                </div>
              </div>

              {/* Priority selector */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Priority</span>
                <div className="flex gap-1">
                  {(['low', 'normal', 'high', 'urgent'] as const).map((priority) => {
                    const isActive = messageForm.priority === priority;
                    const config: Record<string, { activeBg: string; activeBorder: string; activeShadow: string; inactiveBg: string; inactiveText: string; inactiveBorder: string; hoverBg: string; hoverBorder: string; dot: string }> = {
                      low:    { activeBg: 'bg-slate-600', activeBorder: 'border-slate-400', activeShadow: 'shadow-slate-600/30', inactiveBg: 'bg-slate-800/60', inactiveText: 'text-slate-400', inactiveBorder: 'border-slate-600/50', hoverBg: 'hover:bg-slate-700/60', hoverBorder: 'hover:border-slate-500/60', dot: 'bg-slate-400' },
                      normal: { activeBg: 'bg-emerald-600', activeBorder: 'border-emerald-400', activeShadow: 'shadow-emerald-600/30', inactiveBg: 'bg-emerald-950/30', inactiveText: 'text-emerald-400', inactiveBorder: 'border-emerald-500/30', hoverBg: 'hover:bg-emerald-900/40', hoverBorder: 'hover:border-emerald-500/50', dot: 'bg-emerald-400' },
                      high:   { activeBg: 'bg-amber-600', activeBorder: 'border-amber-400', activeShadow: 'shadow-amber-600/30', inactiveBg: 'bg-amber-950/30', inactiveText: 'text-amber-400', inactiveBorder: 'border-amber-500/30', hoverBg: 'hover:bg-amber-900/40', hoverBorder: 'hover:border-amber-500/50', dot: 'bg-amber-400' },
                      urgent: { activeBg: 'bg-red-600', activeBorder: 'border-red-400', activeShadow: 'shadow-red-600/30', inactiveBg: 'bg-red-950/30', inactiveText: 'text-red-400', inactiveBorder: 'border-red-500/30', hoverBg: 'hover:bg-red-900/40', hoverBorder: 'hover:border-red-500/50', dot: 'bg-red-400' },
                    };
                    const c = config[priority];
                    return (
                      <button key={priority}
                        onClick={() => setMessageForm({ ...messageForm, priority })}
                        className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-bold capitalize transition-colors duration-200 ${
                          isActive
                            ? `${c.activeBg} text-white ${c.activeBorder} shadow-sm`
                            : `${c.inactiveBg} ${c.inactiveText} ${c.inactiveBorder} ${c.hoverBg} ${c.hoverBorder}`
                        }`}>
                        <div className={`h-2 w-2 rounded-full ${c.dot} ${isActive ? 'opacity-100' : 'opacity-60'}`} />
                        {priority}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Template button */}
              <div className="flex items-center gap-1 ml-auto" ref={templateDropdownRef}>
                <div className="relative">
                  <button
                    onClick={() => { setShowTemplateDropdown(!showTemplateDropdown); }}
                    className={`flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[11px] font-bold transition-colors duration-200 ${
                      showTemplateDropdown
                        ? 'bg-teal-600 text-white border-teal-500 shadow-sm'
                        : 'bg-slate-800 text-teal-300 border-teal-800/80 hover:bg-teal-950/80 hover:border-teal-700'
                    }`}>
                    <Bookmark className="w-3.5 h-3.5" />
                    Templates
                    {templates.length > 0 && (
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${showTemplateDropdown ? 'bg-white/20 text-white' : 'bg-teal-500/20 text-teal-300'}`}>{templates.length}</span>
                    )}
                    <ChevronDown className={`w-3 h-3 transition-transform ${showTemplateDropdown ? 'rotate-180' : ''}`} />
                  </button>

                  {showTemplateDropdown && (
                    <div className="absolute top-full right-0 mt-1.5 bg-slate-800 border border-slate-600/80 rounded-xl shadow-2xl z-50 w-72 overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-700/80 bg-slate-800/80">
                        <span className="text-[11px] text-slate-300 font-bold">Message Templates</span>
                        <button
                          onClick={() => { setShowTemplateDropdown(false); setShowSaveTemplateModal(true); setEditingTemplateId(null); setNewTemplateName(''); setTemplateEditorContent(composeEditorRef.current?.getContent() || ''); setTemplateFormTitle(messageForm.title); }}
                          className="flex items-center gap-1 px-2.5 py-1 bg-teal-600 hover:bg-teal-500 text-white text-[10px] font-bold rounded-lg transition-colors shadow-sm">
                          <Plus className="w-3 h-3" /> New Template
                        </button>
                      </div>
                      {templates.length === 0 ? (
                        <div className="px-3 py-6 text-center">
                          <Bookmark className="w-6 h-6 text-slate-600 mx-auto mb-2" />
                          <p className="text-[11px] text-slate-500">No templates yet</p>
                          <p className="text-[10px] text-slate-600 mt-0.5">Click "New Template" to create one</p>
                        </div>
                      ) : (
                        <div className="max-h-72 overflow-y-auto scrollbar-dark p-2 space-y-1.5">
                          {templates.map(tpl => (
                            <div key={tpl.id}
                              onClick={() => applyTemplate(tpl)}
                              className="bg-slate-700/40 rounded-lg p-2.5 hover:bg-slate-700/70 cursor-pointer transition-all group border border-slate-600/30 hover:border-slate-500/50">
                              <div className="flex items-start gap-2.5">
                                <div className="p-1.5 bg-teal-500/10 rounded-md flex-shrink-0 mt-0.5">
                                  <Bookmark className="w-3 h-3 text-teal-400" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-[11px] font-bold text-white truncate">{tpl.name}</div>
                                  {tpl.title && <div className="text-[10px] text-slate-400 truncate mt-0.5">{tpl.title}</div>}
                                </div>
                                <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button onClick={(e) => { e.stopPropagation(); setShowTemplateDropdown(false); setShowSaveTemplateModal(true); startEditTemplate(tpl); }}
                                    className="p-1 hover:bg-blue-500/20 rounded-md text-slate-500 hover:text-blue-400 transition-all">
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                  <button onClick={(e) => deleteTemplate(tpl.id, e)}
                                    className="p-1 hover:bg-red-500/20 rounded-md text-slate-500 hover:text-red-400 transition-all">
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Title - light input */}
            <div className="shrink-0">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] font-semibold text-slate-400 uppercase">Title</label>
                <span className="text-[10px] text-slate-600">{messageForm.title.length}/200</span>
              </div>
              <input type="text" value={messageForm.title}
                onChange={(e) => setMessageForm({ ...messageForm, title: e.target.value.slice(0, 200) })}
                placeholder="Enter message title..."
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div className={`shrink-0 rounded-xl border p-3 ${manualRewardEnabled ? 'border-amber-400/40 bg-gradient-to-r from-amber-950/70 to-slate-900' : 'border-slate-700 bg-slate-800/45'}`}>
              <label className="flex cursor-pointer items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${manualRewardEnabled ? 'bg-amber-400 text-amber-950' : 'bg-slate-700 text-slate-400'}`}>
                    <Gift className="h-4 w-4" />
                  </div>
                  <div>
                    <p className={`text-[11px] font-bold ${manualRewardEnabled ? 'text-amber-100' : 'text-slate-300'}`}>發放績效獎金</p>
                    <p className="text-[9px] text-slate-500">未勾選時只發送一般通知，不會修改錢包</p>
                  </div>
                </div>
                <input type="checkbox" checked={manualRewardEnabled} onChange={event => setManualRewardEnabled(event.target.checked)} className="h-4 w-4 accent-amber-400" />
              </label>
              {manualRewardEnabled && (
                <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <input type="number" min="0.01" step="0.01" value={manualRewardAmount} onChange={event => setManualRewardAmount(event.target.value)} placeholder="每名員工的獎金金額" className="min-w-0 rounded-lg border border-amber-500/30 bg-slate-950 px-3 py-2 text-xs font-bold text-amber-100 outline-none focus:border-amber-400" />
                  <div className="flex items-center rounded-lg border border-amber-500/20 bg-amber-400/10 px-3 text-xs font-black text-amber-200">{currencyUnit}</div>
                  <p className="col-span-2 text-[9px] text-amber-200/60">發送後立即入帳。{selectedEmployeeIds.size > 0 && manualRewardAmount ? `預計總額：${(Number(manualRewardAmount) * selectedEmployeeIds.size).toFixed(2)} ${currencyUnit}` : ''}</p>
                </div>
              )}
            </div>

            {/* TipTap Editor - fills all remaining space */}
            <div className="flex-1 min-h-0 flex flex-col">
              <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1.5 shrink-0">Content</label>
              <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm [&>div]:h-full [&>div]:flex [&>div]:flex-col">
                <TiptapEditor
                  ref={composeEditorRef}
                  content=""
                  onChange={(html: string) => setMessageForm(prev => ({ ...prev, content: html }))}
                  placeholder="Write your message here..."
                  theme="light"
                  adminId=""
                  enableQuickCopy
                />
              </div>
            </div>
          </div>

          {/* Send Button - prominent */}
          <div className="border-t border-slate-700/60 bg-slate-800/35 px-3 py-2.5">
            <button
              onClick={validateAndSendMessage}
              disabled={sending || selectedEmployeeIds.size === 0 || !messageForm.title.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-bold text-white shadow-md shadow-blue-950/30 transition-colors hover:bg-blue-500 active:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-35 disabled:shadow-none"
            >
              <Send className="w-4 h-4" />
              {sending ? 'Sending...' : selectedEmployeeIds.size === 0 ? 'Select recipients to send' : `Send to ${selectedEmployeeIds.size} recipient${selectedEmployeeIds.size !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>

        {/* Panel 4: Sent Messages */}
        <div className="flex w-72 flex-shrink-0 flex-col border-l border-slate-700/60 bg-slate-900/95">
          {/* Header */}
          <div className="space-y-1.5 border-b border-slate-700/60 bg-slate-800/45 px-3 py-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-200">Sent messages</h3>
              {sentMessages.length > 0 && !selectionMode && (
                <div className="flex items-center gap-1">
                  <button onClick={enterSelectionMode}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-700 bg-slate-800 text-slate-400 transition-colors hover:border-blue-700 hover:bg-blue-950/70 hover:text-blue-200" title="Select messages">
                    <CheckSquare className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => { setDeleteMode('all'); setShowDeleteConfirm(true); }}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-700 bg-slate-800 text-slate-400 transition-colors hover:border-red-700 hover:bg-red-950/70 hover:text-red-200" title="Clear all messages">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
            {selectionMode && (
              <div className="flex items-center gap-1">
                <button onClick={toggleSelectAll}
                  className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-all ${
                    selectedMessageIds.size === filteredMessages.length && filteredMessages.length > 0 && filteredMessages.every(m => selectedMessageIds.has(m.id))
                      ? 'bg-blue-600/30 text-blue-300'
                      : 'bg-slate-700/50 text-slate-300 hover:bg-slate-700/80 hover:text-white'
                  }`}>
                  {selectedMessageIds.size === filteredMessages.length && filteredMessages.length > 0 && filteredMessages.every(m => selectedMessageIds.has(m.id))
                    ? <><CheckSquare className="w-3.5 h-3.5" /> Deselect</>
                    : <><Square className="w-3.5 h-3.5" /> All</>
                  }
                </button>
                {selectedMessageIds.size > 0 && (
                  <button onClick={() => { setDeleteMode('selected'); setShowDeleteConfirm(true); }}
                    className="flex items-center gap-1 px-2 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-[10px] font-semibold rounded-md transition-all">
                    <Trash2 className="w-3.5 h-3.5" /> Delete {selectedMessageIds.size}
                  </button>
                )}
                <button onClick={exitSelectionMode}
                  className="ml-auto flex items-center gap-1 px-2 py-1 hover:bg-white/10 text-slate-400 hover:text-white rounded-md transition-all text-[10px] font-medium">
                  <X className="w-3.5 h-3.5" /> Cancel
                </button>
              </div>
            )}

            {/* Search */}
            {sentMessages.length > 0 && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
                <input type="text" value={sentMessagesSearchQuery} onChange={(e) => setSentMessagesSearchQuery(e.target.value)}
                  placeholder="Search sent..."
                  className="w-full rounded-lg border border-slate-600/70 bg-slate-800/90 py-2 pl-7 pr-7 text-[11px] text-white placeholder-slate-500 outline-none transition-colors focus:border-blue-500/70 focus:bg-slate-800 focus:ring-1 focus:ring-blue-400/50"
                />
                {sentMessagesSearchQuery && (
                  <button onClick={() => setSentMessagesSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}

            {/* Filter tabs */}
            {sentMessages.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <p className="w-[58px] shrink-0 px-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-slate-500">Message type</p>
                  <div className="flex min-w-0 flex-1 rounded-md border border-slate-700/60 bg-slate-950/35 p-0.5">
                    {([['all', 'All'], ['realtime', 'Realtime'], ['login_popup', 'Popup']] as const).map(([val, label]) => {
                      const activeClass = val === 'realtime'
                        ? 'border-blue-500 bg-blue-600 text-white'
                        : val === 'login_popup'
                          ? 'border-violet-500 bg-violet-600 text-white'
                          : 'border-slate-600 bg-slate-700 text-slate-100';
                      const idleClass = val === 'realtime'
                        ? 'text-blue-300/80 hover:bg-blue-950/70 hover:text-blue-100'
                        : val === 'login_popup'
                          ? 'text-violet-300/80 hover:bg-violet-950/70 hover:text-violet-100'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100';
                      return (
                        <button key={val} onClick={() => setMessageTypeFilter(val)}
                          className={`min-w-0 flex-1 rounded border px-1 py-1 text-[9px] font-bold transition-colors ${messageTypeFilter === val ? activeClass : `border-transparent ${idleClass}`}`}>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <p className="w-[58px] shrink-0 px-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-slate-500">Read status</p>
                  <div className="flex min-w-0 flex-1 rounded-md border border-slate-700/60 bg-slate-950/35 p-0.5">
                    {([['all', 'All'], ['read', 'Read'], ['unread', 'Unread']] as const).map(([val, label]) => {
                      const activeClass = val === 'read'
                        ? 'border-emerald-500 bg-emerald-600 text-white'
                        : val === 'unread'
                          ? 'border-slate-500 bg-slate-600 text-white'
                          : 'border-slate-600 bg-slate-700 text-slate-100';
                      const idleClass = val === 'read'
                        ? 'text-emerald-300/80 hover:bg-emerald-950/70 hover:text-emerald-100'
                        : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100';
                      return (
                        <button key={val} onClick={() => setReadStatusFilter(val)}
                          className={`min-w-0 flex-1 rounded border px-1 py-1 text-[9px] font-bold transition-colors ${readStatusFilter === val ? activeClass : `border-transparent ${idleClass}`}`}>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Message List */}
          <div className="flex-1 space-y-1 overflow-y-auto p-1.5 scrollbar-dark">
            {messagesLoading ? (
              <div className="text-center py-10 text-slate-500 text-xs">Loading...</div>
            ) : sentMessages.length === 0 ? (
              <div className="text-center py-10 text-slate-600 text-xs font-medium">No messages yet</div>
            ) : filteredMessages.length === 0 ? (
              <div className="text-center py-10 text-slate-600 text-xs font-medium">No matches</div>
            ) : (
              paginatedMessages.map(msg => {
                const stats = messageStats.get(msg.id);
                const isSelectedMsg = selectedMessageIds.has(msg.id);

                return (
                  <div
                    key={msg.id}
                    onClick={() => {
                      if (selectionMode) {
                        toggleMessageSelection(msg.id);
                      } else {
                        setSelectedMessageDetail(msg);
                        setRecipientSearchQuery('');
                        setRecipientStatusFilter('all');
                        setEditingMessage(false);
                        void loadRecipientDetailsRef.current?.(msg.id);
                      }
                    }}
                    className={`cursor-pointer rounded-lg border border-slate-700/40 border-l-[3px] px-2.5 py-2.5 transition-colors duration-150 ${getPriorityBorderColor(msg.priority)} ${
                      selectionMode && isSelectedMsg
                        ? 'bg-blue-600/15 ring-1 ring-blue-500/30'
                        : 'bg-slate-800/45 hover:border-slate-600/70 hover:bg-slate-800/75'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {selectionMode && (
                        <div className="flex-shrink-0 mt-0.5">
                          {isSelectedMsg ? <CheckSquare className="w-3.5 h-3.5 text-blue-400" /> : <Square className="w-3.5 h-3.5 text-slate-600" />}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <h4 className="text-[11px] font-bold text-slate-100 truncate mb-1.5">{msg.title}</h4>
                        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                          <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-bold border ${getPriorityColor(msg.priority)}`}>
                            {msg.priority.charAt(0).toUpperCase() + msg.priority.slice(1)}
                          </span>
                          <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-semibold ${
                            msg.message_type === 'login_popup'
                              ? 'bg-violet-500/15 text-violet-400 border border-violet-500/30'
                              : 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                          }`}>
                            {msg.message_type === 'login_popup' ? 'Login Popup' : 'Realtime'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          {stats ? (
                            <div className="flex items-center gap-1.5">
                              <div className="w-12 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all ${stats.read_percentage === 100 ? 'bg-emerald-500' : stats.read_percentage >= 50 ? 'bg-amber-500' : 'bg-slate-500'}`}
                                  style={{ width: `${stats.read_percentage}%` }} />
                              </div>
                              <span className={`text-[9px] font-bold ${stats.read_percentage === 100 ? 'text-emerald-400' : stats.read_percentage >= 50 ? 'text-amber-400' : 'text-slate-500'}`}>
                                {stats.read_count}/{stats.total_recipients}
                              </span>
                            </div>
                          ) : <div />}
                          <span className="text-[9px] text-slate-500 font-medium">
                            {formatMessageDateTime(msg.created_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-700/60 bg-slate-800/35 px-3 py-2">
              <span className="text-[9px] text-slate-500 font-medium">{currentPage}/{totalPages}</span>
              <div className="flex items-center gap-0.5">
                <button onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={currentPage === 1}
                  className="px-2 py-0.5 text-[9px] font-semibold hover:bg-white/10 disabled:opacity-30 text-slate-300 rounded-md transition-all">
                  Prev
                </button>
                <button onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages}
                  className="px-2 py-0.5 text-[9px] font-semibold hover:bg-white/10 disabled:opacity-30 text-slate-300 rounded-md transition-all">
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Message Detail Modal */}
      {selectedMessageDetail && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) { setSelectedMessageDetail(null); setEditingMessage(false); } }}>
          <div className="bg-slate-900 rounded-2xl border border-slate-700/50 shadow-2xl max-w-7xl w-full h-[90vh] overflow-hidden flex flex-col">
            {/* Slim Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700/50 flex-shrink-0">
              <h3 className="text-sm font-bold text-white truncate mr-4">
                {editingMessage ? 'Editing Message' : selectedMessageDetail.title}
              </h3>
              <div className="flex items-center gap-2 flex-shrink-0">
                {editingMessage ? (
                  <>
                    <button type="button" onClick={handleSaveEdit} disabled={saving}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-700 bg-emerald-600 px-3.5 text-xs font-bold text-white transition-colors hover:border-emerald-600 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">
                      {saving ? <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-emerald-100/30 border-t-emerald-100" /> : <Save className="h-3.5 w-3.5" />}
                      {saving ? 'Saving...' : 'Save changes'}
                    </button>
                    <button type="button" onClick={handleCancelEdit} disabled={saving}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-700 px-3.5 text-xs font-bold text-white transition-colors hover:border-slate-500 hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50">
                      <X className="h-3.5 w-3.5" /> Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => handleStartEdit(selectedMessageDetail)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-blue-700 bg-blue-600 px-3.5 text-xs font-bold text-white transition-colors hover:border-blue-600 hover:bg-blue-500">
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                    <button type="button" onClick={() => { setSelectedMessageIds(new Set([selectedMessageDetail.id])); setDeleteMode('selected'); setShowDeleteConfirm(true); }}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-700 bg-red-600 px-3.5 text-xs font-bold text-white transition-colors hover:border-red-600 hover:bg-red-500">
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </button>
                    <div className="ml-1 border-l border-slate-700/80 pl-2">
                      <button type="button" onClick={() => { setSelectedMessageDetail(null); setEditingMessage(false); }}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-600 bg-slate-700 text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-600 hover:text-white"
                        aria-label="Close message details"
                        title="Close">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Two-column body */}
            <div className="flex-1 flex min-h-0 overflow-hidden">
              {/* Left: Content */}
              <div className={`w-[60%] flex flex-col min-h-0 ${editingMessage ? 'bg-white' : 'bg-white'}`}>
                {!editingMessage ? (
                  <div className="px-8 pt-6 pb-4 border-b border-gray-200 flex-shrink-0">
                    <h2 className="text-xl font-bold text-gray-900 mb-3 leading-tight">{selectedMessageDetail.title}</h2>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2.5 py-1 rounded-full border font-semibold ${getPriorityColor(selectedMessageDetail.priority)}`}>
                        {selectedMessageDetail.priority.charAt(0).toUpperCase() + selectedMessageDetail.priority.slice(1)}
                      </span>
                      <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                        selectedMessageDetail.message_type === 'login_popup'
                          ? 'bg-violet-100 text-violet-700 border border-violet-300'
                          : 'bg-blue-100 text-blue-700 border border-blue-300'
                      }`}>
                        {selectedMessageDetail.message_type === 'login_popup' ? 'Login Popup' : 'Realtime'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="px-8 pt-6 pb-4 border-b border-gray-200 flex-shrink-0">
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Title</label>
                    <input type="text" value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value.slice(0, 200) })}
                      className="w-full text-base font-bold bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Message title..."
                    />
                  </div>
                )}

                <div className="flex-1 min-h-0 overflow-y-auto scrollbar-dark">
                  {editingMessage ? (
                    <div className="px-8 py-6 h-full [&>div]:h-full [&>div]:flex [&>div]:flex-col">
                      <TiptapEditor
                        ref={editEditorRef}
                        content={editForm.content}
                        onChange={(html: string) => setEditForm(prev => ({ ...prev, content: html }))}
                        placeholder="Edit message content..."
                        theme="light"
                        adminId={admin.id}
                        enableQuickCopy
                      />
                    </div>
                  ) : (
                    <div className="px-8 py-6">
                      <div className="prose prose-gray max-w-none">
                        <div
                          className="text-gray-700 leading-relaxed text-[15px] [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-lg [&_img]:my-3 [&_b]:font-bold [&_u]:underline [&_p]:mb-3"
                          dangerouslySetInnerHTML={{ __html: sanitizeHTML(selectedMessageDetail.content, {
                            allowedTags: ['p', 'br', 'div', 'span', 'strong', 'em', 'u', 'b', 'i', 'font', 'img'],
                            allowedAttributes: ['style', 'class', 'size', 'src', 'alt', 'width', 'height']
                          }) }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Right: Stats & Info */}
              <div className="w-[40%] flex flex-col min-h-0 overflow-hidden border-l border-slate-700/50 bg-slate-800/30">
                {/* Message details and recipients */}
                <div className="order-1 relative flex min-h-0 flex-1 flex-col overflow-hidden border-b border-teal-400/20 bg-gradient-to-br from-teal-950/70 via-slate-900 to-cyan-950/45 p-4 shadow-[inset_0_1px_0_rgba(94,234,212,0.08)]">
                  <div className="pointer-events-none absolute -right-12 -top-14 h-32 w-32 rounded-full bg-teal-400/10 blur-2xl" />
                  <div className="pointer-events-none absolute -bottom-16 -left-12 h-32 w-32 rounded-full bg-cyan-400/10 blur-2xl" />
                  <div className="relative flex min-h-0 flex-1 flex-col gap-3">
                    <div className="shrink-0 border-b border-teal-200/15 pb-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <h4 className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-300">Message details</h4>
                        <span
                          className="inline-flex min-h-7 max-w-[55%] items-center truncate rounded-lg border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-100 shadow-sm shadow-slate-950/30"
                          title={selectedMessageDetail.sender_username}
                        >
                          {selectedMessageDetail.sender_username}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="relative min-h-[82px] min-w-0 overflow-hidden rounded-lg border border-slate-700 bg-gradient-to-br from-slate-800 via-slate-800 to-slate-900 px-2.5 py-2 shadow-[0_8px_18px_-14px_rgba(15,23,42,0.9)]">
                          <div className="absolute inset-x-0 top-0 h-0.5 bg-slate-400" />
                          <div className="mb-2 flex items-center justify-between gap-1.5">
                            <p className="truncate text-[9px] font-black uppercase tracking-[0.14em] text-slate-300/75">Sent</p>
                            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-700 text-slate-200 ring-1 ring-slate-600">
                              <Clock className="h-3.5 w-3.5" />
                            </div>
                          </div>
                          <p className="whitespace-nowrap text-[9px] font-bold text-white" title={formatMessageDateTime(selectedMessageDetail.created_at)}>{formatMessageDateTime(selectedMessageDetail.created_at)}</p>
                          <p className="mt-0.5 text-[8px] font-medium text-slate-400">Date &amp; time</p>
                        </div>
                        <div className={`relative min-h-[82px] min-w-0 overflow-hidden rounded-lg border ${messageTypeTone.card} px-2.5 py-2 shadow-[0_8px_18px_-14px_rgba(15,23,42,0.9)]`}>
                          <div className={`absolute inset-x-0 top-0 h-0.5 ${messageTypeTone.accent}`} />
                          <div className="mb-2 flex items-center justify-between gap-1.5">
                            <p className={`truncate text-[9px] font-black uppercase tracking-[0.14em] ${messageTypeTone.label}`}>Type</p>
                            <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${messageTypeTone.icon}`}>
                              {selectedMessageDetail.message_type === 'login_popup'
                                ? <Bell className="h-3.5 w-3.5" />
                                : <Radio className="h-3.5 w-3.5" />}
                            </div>
                          </div>
                          <p className={`truncate text-[10px] font-black ${messageTypeTone.value}`}>{selectedMessageDetail.message_type === 'login_popup' ? 'Login Popup' : 'Realtime'}</p>
                          <p className={`mt-0.5 truncate text-[8px] font-medium ${messageTypeTone.label}`}>Delivery channel</p>
                        </div>
                        <div className={`relative min-h-[82px] min-w-0 overflow-hidden rounded-lg border ${messagePriorityTone.card} px-2.5 py-2 shadow-[0_8px_18px_-14px_rgba(15,23,42,0.9)]`}>
                          <div className={`absolute inset-x-0 top-0 h-0.5 ${messagePriorityTone.accent}`} />
                          <div className="mb-2 flex items-center justify-between gap-1.5">
                            <p className={`truncate text-[9px] font-black uppercase tracking-[0.14em] ${messagePriorityTone.label}`}>Priority</p>
                            <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${messagePriorityTone.icon}`}>
                              <AlertCircle className="h-3.5 w-3.5" />
                            </div>
                          </div>
                          <p className={`truncate text-[10px] font-black ${messagePriorityTone.value}`}>
                            {selectedMessageDetail.priority.charAt(0).toUpperCase() + selectedMessageDetail.priority.slice(1)}
                          </p>
                          <p className={`mt-0.5 truncate text-[8px] font-medium ${messagePriorityTone.label}`}>Message level</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-teal-300/30 bg-teal-400/15 shadow-lg shadow-teal-950/40">
                          <Users className="h-5 w-5 text-teal-200" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-teal-300/80">Primary recipients</p>
                          <h4 className="truncate text-base font-black text-white">Sent to employees</h4>
                        </div>
                      </div>
                      <span className="shrink-0 rounded-full border border-teal-200/30 bg-teal-300/15 px-2.5 py-1 text-xs font-black text-teal-100">
                        {selectedMessageDetail.recipient_ids?.length || 'ALL'}
                      </span>
                    </div>

                    {selectedMessageDetail.recipient_ids && selectedMessageDetail.recipient_ids.length > 0 && (
                      <>
                        <div className="relative shrink-0">
                          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-teal-300/70" />
                          <input
                            type="text"
                            value={recipientSearchQuery}
                            onChange={event => {
                              setRecipientSearchQuery(event.target.value);
                              setRecipientStatusFilter('all');
                            }}
                            placeholder="Search employee or account ID..."
                            className="h-9 w-full rounded-lg border border-teal-300/20 bg-slate-950/35 pl-9 pr-8 text-xs font-medium text-slate-100 outline-none transition-colors placeholder:text-teal-100/35 focus:border-teal-300/55 focus:bg-slate-950/60 focus:ring-2 focus:ring-teal-300/15"
                          />
                          {recipientSearchQuery && (
                            <button
                              type="button"
                              onClick={() => {
                                setRecipientSearchQuery('');
                                setRecipientStatusFilter('all');
                              }}
                              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-teal-200/70 transition-colors hover:bg-teal-300/10 hover:text-white"
                              aria-label="Clear recipient search"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        <div className="grid shrink-0 grid-cols-3 gap-1.5" role="group" aria-label="Filter recipients by read status">
                          {(() => {
                            const stats = messageStats.get(selectedMessageDetail.id);
                            const hasSearch = recipientSearchQuery.trim().length > 0;
                            const allActive = !hasSearch && recipientStatusFilter === 'all';
                            const readActive = !hasSearch && recipientStatusFilter === 'read';
                            const unreadActive = !hasSearch && recipientStatusFilter === 'unread';
                            const baseClass = 'flex min-w-0 items-center justify-between gap-1 rounded-lg border px-2 py-1.5 text-[10px] font-bold transition-colors';

                            return (
                              <>
                                <button
                                  type="button"
                                  aria-pressed={allActive}
                                  onClick={() => {
                                    setRecipientSearchQuery('');
                                    setRecipientStatusFilter('all');
                                  }}
                                  className={`${baseClass} ${allActive ? 'border-teal-300/50 bg-teal-300/15 text-teal-100' : 'border-slate-600/60 bg-slate-900/35 text-slate-400 hover:border-teal-300/30 hover:text-teal-100'}`}
                                >
                                  <span>All</span>
                                  <span className="font-black">{stats?.total_recipients ?? 0}</span>
                                </button>
                                <button
                                  type="button"
                                  aria-pressed={readActive}
                                  onClick={() => {
                                    setRecipientSearchQuery('');
                                    setRecipientStatusFilter(prev => prev === 'read' ? 'all' : 'read');
                                  }}
                                  className={`${baseClass} ${readActive ? 'border-emerald-300/50 bg-emerald-300/15 text-emerald-100' : 'border-slate-600/60 bg-slate-900/35 text-slate-400 hover:border-emerald-300/30 hover:text-emerald-100'}`}
                                >
                                  <span>Read</span>
                                  <span className="font-black">{stats?.read_count ?? 0}</span>
                                </button>
                                <button
                                  type="button"
                                  aria-pressed={unreadActive}
                                  onClick={() => {
                                    setRecipientSearchQuery('');
                                    setRecipientStatusFilter(prev => prev === 'unread' ? 'all' : 'unread');
                                  }}
                                  className={`${baseClass} ${unreadActive ? 'border-slate-500 bg-slate-700 text-slate-100' : 'border-slate-600/60 bg-slate-900/35 text-slate-400 hover:border-slate-500 hover:text-slate-200'}`}
                                >
                                  <span>Unread</span>
                                  <span className="font-black">{stats?.unread_count ?? 0}</span>
                                </button>
                              </>
                            );
                          })()}
                        </div>
                      </>
                    )}

                    {(!selectedMessageDetail.recipient_ids || selectedMessageDetail.recipient_ids.length === 0) ? (
                      <div className="flex items-center gap-3 rounded-xl border border-blue-300/25 bg-blue-400/10 px-3.5 py-3">
                        <Globe className="h-5 w-5 shrink-0 text-blue-300" />
                        <div>
                          <p className="text-sm font-bold text-blue-100">All Employees</p>
                          <p className="text-[10px] font-medium text-blue-300/80">Broadcast notification</p>
                        </div>
                      </div>
                    ) : (
                      (() => {
                        const details = recipientDetails.get(selectedMessageDetail.id);
                        const employees = details ? [...details.read, ...details.unread] : [];
                        const readIds = new Set(details?.read.map(employee => employee.id) || []);
                        const usernames = recipientUsernames.get(selectedMessageDetail.id) || [];
                        const query = recipientSearchQuery.trim().toLowerCase();
                        const visibleEmployees = employees.filter(employee => {
                          const matchesSearch = !query || employee.username.toLowerCase().includes(query) || employee.employee_id.toLowerCase().includes(query);
                          const matchesStatus = query.length > 0 || recipientStatusFilter === 'all' || (recipientStatusFilter === 'read' ? readIds.has(employee.id) : !readIds.has(employee.id));
                          return matchesSearch && matchesStatus;
                        });
                        const visibleUsernames = usernames.filter(name => !query || name.toLowerCase().includes(query));

                        if (employees.length > 0) {
                          return (
                            <div className="min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-dark">
                              {visibleEmployees.length > 0 ? (
                                <div className="overflow-hidden rounded-xl border border-teal-300/15 bg-slate-950/25 divide-y divide-teal-200/10">
                                  {visibleEmployees.map(employee => {
                                    const isRead = readIds.has(employee.id);
                                    return (
                                      <div key={employee.id} className={`flex items-center gap-2.5 px-2.5 py-2 transition-colors ${isRead ? 'bg-emerald-950/45 hover:bg-emerald-900/55' : 'bg-slate-950/60 hover:bg-slate-900/75'}`}>
                                        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-black ring-1 ${isRead ? 'bg-emerald-900/80 text-emerald-300 ring-emerald-700/60' : 'bg-slate-800 text-slate-500 ring-slate-700'}`}>
                                          {employee.username.slice(0, 1).toUpperCase()}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                          <p className={`truncate text-xs font-bold ${isRead ? 'text-emerald-50' : 'text-slate-400'}`}>{employee.username}</p>
                                          <p className={`truncate font-mono text-[9px] ${isRead ? 'text-emerald-300/70' : 'text-slate-600'}`}>{employee.employee_id}</p>
                                        </div>
                                        <span className={`shrink-0 text-[9px] font-black uppercase tracking-wide ${isRead ? 'text-emerald-300' : 'text-slate-500'}`}>
                                          {isRead ? 'Read' : 'Unread'}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <p className="rounded-xl border border-slate-500/25 bg-slate-950/25 px-3 py-3 text-xs text-slate-400">No matching employee accounts.</p>
                              )}
                            </div>
                          );
                        }

                        if (usernames.length > 0) {
                          return (
                            <div className="min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-dark">
                              {visibleUsernames.length > 0 ? (
                                <div className="overflow-hidden rounded-xl border border-teal-300/15 bg-slate-950/25 divide-y divide-teal-200/10">
                                  {visibleUsernames.map(name => (
                                    <div key={name} className="flex items-center gap-2.5 px-2.5 py-2">
                                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-700 text-[10px] font-black text-slate-300">
                                        {name.slice(0, 1).toUpperCase()}
                                      </div>
                                      <p className="min-w-0 flex-1 truncate text-xs font-bold text-white">{name}</p>
                                      <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-slate-500">Employee</span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="rounded-xl border border-slate-500/25 bg-slate-950/25 px-3 py-3 text-xs text-slate-400">No matching employee accounts.</p>
                              )}
                            </div>
                          );
                        }

                        return loadingRecipientDetails ? (
                          <div className="flex items-center justify-center rounded-xl border border-teal-300/15 bg-slate-950/25 py-6">
                            <div className="h-6 w-6 animate-spin rounded-full border-2 border-teal-400/30 border-t-teal-300" />
                          </div>
                        ) : (
                          <p className="rounded-xl border border-slate-500/25 bg-slate-950/25 px-3 py-3 text-xs text-slate-400">Employee account details unavailable.</p>
                        );
                      })()
                    )}
                  </div>
                </div>

                {messageStats.has(selectedMessageDetail.id) && !editingMessage && (() => {
                  const stats = messageStats.get(selectedMessageDetail.id)!;
                  return (
                    <div className="order-3 shrink-0 border-t border-slate-700/40 bg-slate-900/45 px-4 py-2.5">
                      <div className="mb-1.5 flex items-center justify-between gap-3">
                        <h4 className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Delivery progress</h4>
                        <span className="text-[9px] font-bold text-slate-400">{stats.read_count}/{stats.total_recipients} read</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-700">
                        <div className={`h-full rounded-full transition-all ${stats.read_percentage === 100 ? 'bg-emerald-500' : 'bg-gradient-to-r from-blue-500 to-cyan-400'}`} style={{ width: `${stats.read_percentage}%` }} />
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Save Template Modal - Full Editor Panel */}
      {showSaveTemplateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) { setShowSaveTemplateModal(false); setEditingTemplateId(null); setNewTemplateName(''); setTemplateEditorContent(''); setTemplateFormTitle(''); } }}>
          <div onClick={(e) => e.stopPropagation()} className="bg-slate-900 rounded-2xl border border-slate-700/50 w-full max-w-7xl h-[92vh] flex flex-col shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700/50 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-xl ${editingTemplateId ? 'bg-blue-600/20' : 'bg-teal-600/20'}`}>
                  {editingTemplateId ? <Pencil className="w-5 h-5 text-blue-400" /> : <Bookmark className="w-5 h-5 text-teal-400" />}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">{editingTemplateId ? 'Edit Template' : 'Create Message Template'}</h3>
                  <p className="text-[11px] text-slate-500">{editingTemplateId ? 'Modify this template\'s name, title, and content' : 'Configure all settings and content for this template'}</p>
                </div>
              </div>
              <button onClick={() => { setShowSaveTemplateModal(false); setEditingTemplateId(null); setNewTemplateName(''); setTemplateEditorContent(''); setTemplateFormTitle(''); }} className="p-2 hover:bg-slate-800 rounded-lg transition-colors">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            {/* Body: Left editor / Right preview */}
            <div className="flex-1 flex min-h-0 overflow-hidden">
              {/* Left: Editor */}
              <div className="w-[65%] flex flex-col border-r border-slate-700/50 p-5 gap-4">
                {/* Template name */}
                <div className="flex items-center gap-3 flex-shrink-0">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide whitespace-nowrap">Name</label>
                  <input
                    type="text"
                    value={newTemplateName}
                    onChange={(e) => setNewTemplateName(e.target.value.slice(0, 50))}
                    className="flex-1 min-w-0 px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-teal-400 placeholder:text-slate-400 shadow-sm"
                    placeholder="Template name (e.g., Welcome Message, Shift Reminder...)"
                    autoFocus
                  />
                </div>

                {/* Title */}
                <div className="flex-shrink-0">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Title</label>
                    <span className="text-[10px] text-slate-600">{templateFormTitle.length}/200</span>
                  </div>
                  <input type="text" value={templateFormTitle}
                    onChange={(e) => setTemplateFormTitle(e.target.value.slice(0, 200))}
                    placeholder="Enter message title..."
                    className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400/40 focus:border-teal-400 transition-all shadow-sm"
                  />
                </div>

                {/* Content Editor */}
                <div className="flex-1 min-h-0 flex flex-col">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1.5 shrink-0">Content</label>
                  <div className="flex-1 min-h-0 [&>div]:h-full [&>div]:flex [&>div]:flex-col">
                    <TiptapEditor
                      ref={templateEditorRef2}
                      content={templateEditorContent}
                      onChange={(html: string) => setTemplateEditorContent(html)}
                      placeholder="Write your template content here..."
                      theme="light"
                      adminId=""
                      enableQuickCopy
                    />
                  </div>
                </div>
              </div>

              {/* Right: Existing templates list */}
              <div className="w-[35%] flex flex-col bg-slate-950/40">
                <div className="px-4 py-3 border-b border-slate-700/50 flex-shrink-0">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wide">Existing Templates</h4>
                  <p className="text-[10px] text-slate-500 mt-0.5">{templates.length} template{templates.length !== 1 ? 's' : ''} saved</p>
                </div>
                <div className="flex-1 overflow-y-auto scrollbar-dark p-3 space-y-2">
                  {templates.length === 0 ? (
                    <div className="text-center py-12">
                      <Bookmark className="w-10 h-10 text-slate-700 mx-auto mb-3" />
                      <p className="text-xs text-slate-500 font-medium">No templates yet</p>
                      <p className="text-[10px] text-slate-600 mt-1">Fill in the form and save your first template</p>
                    </div>
                  ) : (
                    templates.map(tpl => {
                      const isEditing = editingTemplateId === tpl.id;
                      return (
                      <div key={tpl.id} className={`rounded-xl p-3.5 group transition-all border ${isEditing ? 'bg-blue-600/15 border-blue-500/40 ring-1 ring-blue-500/20' : 'bg-slate-800/50 border-slate-700/30 hover:bg-slate-800/80 hover:border-slate-600/50'}`}>
                        <div className="flex items-start gap-3">
                          <div className={`p-1.5 rounded-lg flex-shrink-0 mt-0.5 ${isEditing ? 'bg-blue-500/20' : 'bg-teal-500/10'}`}>
                            <Bookmark className={`w-3.5 h-3.5 ${isEditing ? 'text-blue-400' : 'text-teal-400/70'}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className={`text-xs font-bold truncate ${isEditing ? 'text-blue-200' : 'text-slate-200'}`}>{tpl.name}</div>
                            {tpl.title && <div className="text-[10px] text-slate-400 truncate mt-0.5">{tpl.title}</div>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 mt-2.5 pt-2 border-t border-slate-700/30">
                          <button onClick={() => startEditTemplate(tpl)}
                            className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all ${isEditing ? 'bg-blue-600/30 text-blue-300' : 'bg-slate-700/50 text-slate-400 hover:bg-blue-600/20 hover:text-blue-300'}`}>
                            <Pencil className="w-3 h-3" /> Edit
                          </button>
                          <button onClick={() => deleteTemplate(tpl.id, { stopPropagation: () => {} } as React.MouseEvent)}
                            className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] font-bold bg-slate-700/50 text-slate-400 hover:bg-red-600/20 hover:text-red-400 transition-all">
                            <Trash2 className="w-3 h-3" /> Delete
                          </button>
                        </div>
                      </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-slate-700/50 flex-shrink-0 bg-slate-900/80">
              <div className="flex items-center gap-2">
                <button onClick={() => { setShowSaveTemplateModal(false); setEditingTemplateId(null); setNewTemplateName(''); setTemplateEditorContent(''); setTemplateFormTitle(''); }}
                  className="px-5 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors">
                  Cancel
                </button>
                {editingTemplateId && (
                  <button onClick={() => { setEditingTemplateId(null); setNewTemplateName(''); setTemplateFormTitle(''); setTemplateEditorContent(''); templateEditorRef2.current?.getEditor()?.commands.setContent(''); }}
                    className="px-4 py-2.5 bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 rounded-lg text-sm font-medium transition-colors border border-slate-600/50">
                    New Instead
                  </button>
                )}
              </div>
              <button onClick={saveAsTemplate} disabled={savingTemplate || !newTemplateName.trim()}
                className={`flex items-center gap-2 px-6 py-2.5 text-white rounded-lg text-sm font-bold transition-all disabled:opacity-30 shadow-lg ${editingTemplateId ? 'bg-blue-600 hover:bg-blue-500 shadow-blue-600/25' : 'bg-teal-600 hover:bg-teal-500 shadow-teal-600/25'}`}>
                {savingTemplate ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : editingTemplateId ? <Save className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
                {savingTemplate ? 'Saving...' : editingTemplateId ? 'Update Template' : 'Save Template'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && deleteMode && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 rounded-2xl border border-red-500/30 shadow-2xl max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-red-500/10 rounded-full">
                  <AlertTriangle className="w-6 h-6 text-red-400" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Confirm Deletion</h3>
                  <p className="text-sm text-slate-400">This action cannot be undone</p>
                </div>
              </div>
              <div className="bg-slate-800/50 rounded-lg p-4 mb-6">
                {deleteMode === 'selected' ? (
                  <p className="text-sm text-slate-300">
                    You are about to delete <span className="font-semibold text-white">{selectedMessageIds.size}</span> selected message{selectedMessageIds.size !== 1 ? 's' : ''}.
                  </p>
                ) : (
                  <p className="text-sm text-slate-300">
                    You are about to delete <span className="font-semibold text-white">all messages</span> for the selected admin group.
                    {sentMessages.length > 0 && (
                      <span className="block mt-1 text-slate-400">({sentMessages.length} message{sentMessages.length !== 1 ? 's' : ''} will be deleted)</span>
                    )}
                  </p>
                )}
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setShowDeleteConfirm(false); setDeleteMode(null); }} disabled={deleting}
                  className="flex-1 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50">
                  Cancel
                </button>
                <button onClick={handleConfirmDelete} disabled={deleting}
                  className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                  {deleting ? (
                    <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Deleting...</>
                  ) : (
                    <><Trash2 className="w-4 h-4" /> Delete</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
