import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { sanitizeHTML } from '../../lib/sanitizeHTML';
import TiptapEditor from './TiptapEditor';
import {
  Send, Users, Bell, AlertCircle, X, Search,
  CheckSquare, Square, Eye, Trash2, AlertTriangle,
  UserCheck, UserX, Pencil, Save, ChevronDown,
  Tag, ChevronRight, Bookmark, Plus, Clock, Radio, Globe
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
    is_super_admin: boolean;
  };
  initialEmployee?: { id: string; username: string } | null;
  onConsumeInitialEmployee?: () => void;
}

export default function MessageManagement({ admin, initialEmployee, onConsumeInitialEmployee }: Props) {
  const [adminGroups, setAdminGroups] = useState<AdminGroup[]>([]);
  const [allEmployees, setAllEmployees] = useState<Map<string, Employee[]>>(new Map());
  const [selectedAdminId, setSelectedAdminId] = useState<string>('');
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

  const [sentMessages, setSentMessages] = useState<Message[]>([]);
  const [selectedMessageDetail, setSelectedMessageDetail] = useState<Message | null>(null);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messageStats, setMessageStats] = useState<Map<string, MessageStats>>(new Map());
  const [recipientDetails, setRecipientDetails] = useState<Map<string, { read: Employee[]; unread: Employee[] }>>(new Map());
  const [loadingRecipientDetails, setLoadingRecipientDetails] = useState(false);
  const [recipientUsernames, setRecipientUsernames] = useState<Map<string, string[]>>(new Map());

  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [deleteMode, setDeleteMode] = useState<'selected' | 'all' | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [editingMessage, setEditingMessage] = useState(false);
  const [editForm, setEditForm] = useState({ title: '', content: '' });
  const [saving, setSaving] = useState(false);

  const [messageTypeFilter, setMessageTypeFilter] = useState<'all' | 'realtime' | 'login_popup'>('all');
  const [messageScopeFilter, setMessageScopeFilter] = useState<'all' | 'broadcast' | 'targeted'>('all');
  const [readStatusFilter, setReadStatusFilter] = useState<'all' | 'read' | 'unread'>('all');
  const [sentMessagesSearchQuery, setSentMessagesSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const messagesPerPage = 15;

  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);


  const [showTagDropdown, setShowTagDropdown] = useState(false);

  const [templates, setTemplates] = useState<Array<{id:string; name:string; title:string; content:string; message_type:string; priority:string}>>([]);
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateEditorContent, setTemplateEditorContent] = useState('');
  const [templateFormTitle, setTemplateFormTitle] = useState('');
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const templateEditorRef2 = useRef<any>(null);

  const composeEditorRef = useRef<any>(null);
  const editEditorRef = useRef<any>(null);
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  const templateDropdownRef = useRef<HTMLDivElement>(null);

  const hasInitiallyLoaded = useRef(false);
  const selectedAdminIdRef = useRef(selectedAdminId);
  const userDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recipientDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { selectedAdminIdRef.current = selectedAdminId; }, [selectedAdminId]);

  useEffect(() => {
    if (initialEmployee) {
      setSelectedEmployeeIds(new Set([initialEmployee.id]));
      onConsumeInitialEmployee?.();
    }
  }, [initialEmployee]);

  useEffect(() => {
    loadAllData();
    loadSentMessages();
    loadTemplates();

    const debouncedLoadAllData = () => {
      if (userDebounceTimer.current) clearTimeout(userDebounceTimer.current);
      userDebounceTimer.current = setTimeout(() => loadAllData(true), 3000);
    };

    const debouncedLoadSentMessages = () => {
      if (recipientDebounceTimer.current) clearTimeout(recipientDebounceTimer.current);
      recipientDebounceTimer.current = setTimeout(() => loadSentMessages(true), 2000);
    };

    const usersChannel = supabase
      .channel('msg-users-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, debouncedLoadAllData)
      .subscribe();

    const adminsChannel = supabase
      .channel('msg-admins-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admins' }, debouncedLoadAllData)
      .subscribe();

    const recipientsChannel = supabase
      .channel('msg-recipients-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_recipients' }, debouncedLoadSentMessages)
      .subscribe();

    return () => {
      if (userDebounceTimer.current) clearTimeout(userDebounceTimer.current);
      if (recipientDebounceTimer.current) clearTimeout(recipientDebounceTimer.current);
      supabase.removeChannel(usersChannel);
      supabase.removeChannel(adminsChannel);
      supabase.removeChannel(recipientsChannel);
    };
  }, []);

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
    if (!isBackgroundRefresh) setLoading(true);
    try {
      const { data: allAdmins, error: adminsError } = await supabase
        .from('admins')
        .select('id, username, role')
        .eq('is_active', true)
        .neq('role', 'emergency_admin')
        .order('role', { ascending: false })
        .order('username');

      if (adminsError) throw adminsError;

      let employeesQuery = supabase
        .from('users')
        .select('id, username, employee_id, is_active, is_verified, total_income, created_by, tags, remarks, is_pinned')
        .order('is_pinned', { ascending: false })
        .order('username');

      if (admin.role === 'secondary_admin') {
        employeesQuery = employeesQuery.eq('created_by', admin.id);
      }

      const { data: employeesData, error: employeesError } = await employeesQuery;
      if (employeesError) throw employeesError;

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

      setAdminGroups(filteredGroups);
      setAllEmployees(employeesByAdmin);

      if (filteredGroups.length > 0 && !selectedAdminId) {
        setSelectedAdminId(filteredGroups[0].id);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
      hasInitiallyLoaded.current = true;
    }
  };

  const loadTemplates = async () => {
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
      console.error('Error loading templates:', error);
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
    } catch (error: any) {
      setNotification({ type: 'error', message: error.message || 'Failed to save template' });
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

    await sendMessage();
  };

  const sendMessage = async () => {
    setSending(true);
    setSendProgress({ sent: 0, total: selectedEmployeeIds.size });

    try {
      const htmlContent = composeEditorRef.current?.getContent() || '';

      const { data: message, error: msgError } = await supabase
        .from('messages')
        .insert({
          sender_id: admin.id,
          sender_username: admin.username,
          title: messageForm.title.trim(),
          content: htmlContent,
          message_type: messageForm.messageType,
          priority: messageForm.priority
        })
        .select()
        .single();

      if (msgError) throw msgError;

      const recipientIds = Array.from(selectedEmployeeIds);
      const batchSize = 100;
      let successCount = 0;

      for (let i = 0; i < recipientIds.length; i += batchSize) {
        const batch = recipientIds.slice(i, i + batchSize);
        const recipients = batch.map(recipientId => ({
          message_id: message.id,
          recipient_id: recipientId
        }));

        const { error } = await supabase
          .from('message_recipients')
          .insert(recipients);

        if (!error) {
          successCount += batch.length;
          setSendProgress({ sent: successCount, total: recipientIds.length });
        }

        if (i + batchSize < recipientIds.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      setNotification({
        type: 'success',
        message: `Message sent successfully to ${successCount} employee${successCount > 1 ? 's' : ''}!`
      });

      setMessageForm({ title: '', content: '', messageType: 'realtime', priority: 'normal' });
      composeEditorRef.current?.getEditor()?.commands.clearContent();
      setSelectedEmployeeIds(new Set());

      loadSentMessages();
    } catch (error: any) {
      console.error('Error sending message:', error);
      setNotification({ type: 'error', message: error.message || 'Failed to send message' });
    } finally {
      setSending(false);
      setSendProgress(null);
    }
  };

  const loadSentMessages = async (isBackgroundRefresh = false) => {
    if (!isBackgroundRefresh) setMessagesLoading(true);
    try {
      const currentAdminId = selectedAdminIdRef.current;
      let query = supabase
        .from('messages')
        .select('*')
        .order('created_at', { ascending: false });

      if (currentAdminId) {
        query = query.eq('sender_id', currentAdminId);
      } else if (admin.is_super_admin) {
        // Super admin can see all
      } else {
        query = query.eq('sender_id', admin.id);
      }

      const { data, error } = await query;
      if (error) throw error;

      const messageIds = (data || []).map(msg => msg.id);
      const { data: allRecipients } = messageIds.length > 0
        ? await supabase
            .from('message_recipients')
            .select('message_id, recipient_id, is_read')
            .in('message_id', messageIds)
        : { data: [] };

      const recipientIds = Array.from(new Set((allRecipients || []).map(r => r.recipient_id)));
      const { data: recipientUsers } = recipientIds.length > 0
        ? await supabase.from('users').select('id, username').in('id', recipientIds)
        : { data: [] };

      const recipientUsernameMap = new Map(recipientUsers?.map(u => [u.id, u.username]) || []);

      const recipientsByMessage = new Map<string, string[]>();
      const statsByMessage = new Map<string, MessageStats>();
      const recipientUsernamesByMessage = new Map<string, string[]>();

      messageIds.forEach(msgId => {
        recipientsByMessage.set(msgId, []);
        recipientUsernamesByMessage.set(msgId, []);
        statsByMessage.set(msgId, { total_recipients: 0, read_count: 0, unread_count: 0, read_percentage: 0 });
      });

      (allRecipients || []).forEach(recipient => {
        const recipientList = recipientsByMessage.get(recipient.message_id)!;
        recipientList.push(recipient.recipient_id);

        const username = recipientUsernameMap.get(recipient.recipient_id);
        if (username) {
          const usernameList = recipientUsernamesByMessage.get(recipient.message_id)!;
          usernameList.push(username);
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
      if (!isBackgroundRefresh) setSelectedMessageIds(new Set());
    } catch (error) {
      console.error('Error loading messages:', error);
    } finally {
      if (!isBackgroundRefresh) setMessagesLoading(false);
    }
  };

  const loadRecipientDetails = async (messageId: string) => {
    if (recipientDetails.has(messageId)) return;

    setLoadingRecipientDetails(true);
    try {
      const { data: recipients, error } = await supabase
        .from('message_recipients')
        .select('recipient_id, is_read')
        .eq('message_id', messageId);

      if (error) throw error;

      const rIds = recipients?.map(r => r.recipient_id) || [];
      if (rIds.length === 0) {
        setRecipientDetails(prev => new Map(prev).set(messageId, { read: [], unread: [] }));
        return;
      }

      const { data: employees, error: empError } = await supabase
        .from('users')
        .select('id, username, employee_id, is_verified')
        .in('id', rIds);

      if (empError) throw empError;

      const employeeMap = new Map(employees?.map(e => [e.id, e]) || []);
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
      console.error('Error loading recipient details:', error);
    } finally {
      setLoadingRecipientDetails(false);
    }
  };

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
    } catch (error: any) {
      console.error('Error updating message:', error);
      setNotification({ type: 'error', message: error.message || 'Failed to update message' });
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

  const filteredMessages = sentMessages.filter(msg => {
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
  }, [messageTypeFilter, messageScopeFilter, readStatusFilter, sentMessagesSearchQuery]);

  useEffect(() => {
    if (paginatedMessages.length > 0) {
      paginatedMessages.forEach(msg => {
        if (msg.recipient_ids && msg.recipient_ids.length > 0 && !recipientDetails.has(msg.id)) {
          loadRecipientDetails(msg.id);
        }
      });
    }
  }, [paginatedMessages.map(m => m.id).join(',')]);

  const messageStats_filtered = {
    total: sentMessages.length,
    realtime: sentMessages.filter(m => m.message_type === 'realtime').length,
    loginPopup: sentMessages.filter(m => m.message_type === 'login_popup').length,
    broadcast: sentMessages.filter(m => !m.recipient_ids || m.recipient_ids.length === 0).length,
    targeted: sentMessages.filter(m => m.recipient_ids && m.recipient_ids.length > 0).length,
    read: sentMessages.filter(m => {
      const stats = messageStats.get(m.id);
      return (stats?.total_recipients || 0) > 0 && stats?.read_count === stats?.total_recipients;
    }).length,
    unread: sentMessages.filter(m => {
      const stats = messageStats.get(m.id);
      return (stats?.total_recipients || 0) === 0 || (stats?.read_count || 0) < (stats?.total_recipients || 0);
    }).length,
  };

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
      case 'high': return 'text-orange-400 bg-orange-500/10 border-orange-500/30';
      case 'normal': return 'text-blue-400 bg-blue-500/10 border-blue-500/30';
      case 'low': return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
      default: return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
    }
  };

  const getPriorityBorderColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'border-l-red-500';
      case 'high': return 'border-l-orange-500';
      case 'normal': return 'border-l-blue-500';
      case 'low': return 'border-l-slate-500';
      default: return 'border-l-slate-500';
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-blue-400/30 border-t-blue-400 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Loading message center...</p>
        </div>
      </div>
    );
  }

  const allEmployeesFlat = Array.from(allEmployees.values()).flat();
  const totalEmployees = allEmployeesFlat.length;
  const filteredEmployees = getFilteredEmployees();
  const selectedGroup = adminGroups.find(g => g.id === selectedAdminId);
  const allCurrentSelected = filteredEmployees.length > 0 && filteredEmployees.every(e => selectedEmployeeIds.has(e.id));
  const allEmployeesSelected = allEmployeesFlat.length > 0 && allEmployeesFlat.every(emp => selectedEmployeeIds.has(emp.id));

  return (
    <div className="flex flex-col flex-1 min-h-0">
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
      <div className="flex items-center justify-between px-4 py-1.5 bg-slate-900 border-b border-slate-700/50">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-blue-600 rounded-lg shadow-sm shadow-blue-600/20">
            <Send className="w-3.5 h-3.5 text-white" />
          </div>
          <h2 className="text-sm font-bold text-white tracking-tight">Messages</h2>
          <span className="text-[11px] text-slate-500 font-medium">
            {selectedEmployeeIds.size > 0 ? `${selectedEmployeeIds.size} recipient${selectedEmployeeIds.size > 1 ? 's' : ''} selected` : `${totalEmployees} employees total`}
          </span>
        </div>
        {selectedEmployeeIds.size > 0 && (
          <button onClick={clearSelection} className="flex items-center gap-1.5 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[11px] font-bold transition-all border border-slate-600/50 hover:border-slate-500">
            <X className="w-3 h-3" />
            Clear
          </button>
        )}
      </div>

      {/* 4-Panel Horizontal Layout */}
      <div className="flex flex-1 min-h-0 border border-slate-700/40 rounded-lg overflow-hidden bg-slate-950/60">

        {/* Panel 1: Admin Groups */}
        {admin.role !== 'secondary_admin' && (
          <div className="w-56 flex-shrink-0 bg-slate-900 border-r border-slate-700/50 flex flex-col">
            <div className="px-3.5 py-3 border-b border-slate-700/50 flex items-center justify-between bg-slate-800/40">
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
                    onClick={() => setSelectedAdminId(group.id)}
                    className={`group w-full text-left px-3 py-3 rounded-xl transition-all duration-200 border ${
                      isActive
                        ? 'bg-blue-600/30 border-blue-400/70 ring-2 ring-blue-400/40 shadow-lg shadow-blue-500/20 border-l-[3px] border-l-blue-400'
                        : 'bg-slate-800/40 border-slate-700/40 hover:bg-slate-800/70 hover:border-slate-600/60'
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
        <div className="w-64 flex-shrink-0 bg-slate-900 border-r border-slate-700/50 flex flex-col">
          <div className="px-3 py-2.5 border-b border-slate-700/50 space-y-2 bg-slate-800/30">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search employees..."
                className="w-full pl-9 pr-9 py-2.5 text-xs bg-slate-700/70 border border-slate-500/50 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 focus:bg-slate-700 transition-all"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-all">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Status + Tag filters row */}
            <div className="flex items-center gap-2">
              <div className="flex gap-1 flex-1 bg-slate-800 rounded-lg p-1 border border-slate-700/50">
                {(['all', 'active', 'verified'] as const).map(status => (
                  <button key={status} onClick={() => setFilterStatus(status)}
                    className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-bold transition-all duration-150 ${
                      filterStatus === status
                        ? 'bg-blue-600/30 text-blue-200 shadow-sm border border-blue-500/40'
                        : 'text-slate-300 bg-slate-700/40 hover:text-white hover:bg-slate-700/70 border border-slate-600/40 hover:border-slate-500/50'
                    }`}>
                    {status === 'all' ? 'All' : status === 'active' ? 'Active' : 'Verified'}
                  </button>
                ))}
              </div>

              {/* Tag dropdown */}
              {allAvailableTags.length > 0 && (
                <div className="relative" ref={tagDropdownRef}>
                  <button onClick={() => setShowTagDropdown(!showTagDropdown)}
                    className={`flex items-center gap-1 px-2.5 py-2 rounded-lg text-[11px] font-bold transition-all duration-150 border ${
                      selectedTags.size > 0
                        ? 'bg-teal-600/20 text-teal-200 border-teal-500/40'
                        : 'bg-slate-700/50 text-slate-300 border-slate-600/50 hover:text-white hover:bg-slate-700 hover:border-slate-500/60'
                    }`}>
                    <Tag className="w-3.5 h-3.5" />
                    {selectedTags.size > 0 && <span className="bg-teal-500/30 px-1 rounded text-[10px]">{selectedTags.size}</span>}
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  {showTagDropdown && (
                    <div className="absolute top-full right-0 mt-1.5 bg-slate-800/95 backdrop-blur-sm border border-slate-500/50 rounded-xl shadow-2xl shadow-black/40 z-50 w-56 max-h-60 overflow-y-auto">
                      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-600/60 bg-slate-700/30">
                        <span className="text-xs text-slate-100 font-bold">Filter by Tag</span>
                        {selectedTags.size > 0 && (
                          <button onClick={() => { clearTagFilter(); setShowTagDropdown(false); }} className="text-[11px] text-red-300 hover:text-red-200 font-bold px-2.5 py-1 rounded-md bg-red-500/15 border border-red-500/25 hover:bg-red-500/25 transition-all">
                            Clear
                          </button>
                        )}
                      </div>
                      <div className="p-1.5 space-y-0.5">
                        {allAvailableTags.map(tag => (
                          <button key={tag} onClick={() => toggleTagFilter(tag)}
                            className={`flex items-center gap-2.5 w-full px-3 py-2.5 text-xs rounded-lg transition-all ${
                              selectedTags.has(tag)
                                ? 'bg-teal-600/20 border border-teal-500/30'
                                : 'hover:bg-slate-700/60 border border-transparent'
                            }`}>
                            {selectedTags.has(tag) ? <CheckSquare className="w-4 h-4 text-teal-400 flex-shrink-0" /> : <Square className="w-4 h-4 text-slate-500 flex-shrink-0" />}
                            <span className={selectedTags.has(tag) ? 'text-teal-200 font-semibold' : 'text-slate-300'}>{tag}</span>
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
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-300 font-medium">{filteredEmployees.length} found</span>
                  {selectedEmployeeIds.size > 0 && (
                    <span className="text-[11px] px-2 py-0.5 rounded-md bg-emerald-600/25 text-emerald-200 font-bold border border-emerald-500/30">{selectedEmployeeIds.size} sel</span>
                  )}
                </div>
                {filteredEmployees.length > 0 && (
                  <button onClick={selectAllCurrentGroup}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all duration-150 border ${
                      allCurrentSelected
                        ? 'bg-slate-700 text-slate-300 border-slate-600 hover:bg-slate-600'
                        : 'bg-emerald-600/20 text-emerald-200 border-emerald-500/40 hover:bg-emerald-600/30 hover:border-emerald-400/50'
                    }`}>
                    {allCurrentSelected ? <><CheckSquare className="w-3.5 h-3.5" /> Deselect</> : <><Square className="w-3.5 h-3.5" /> Select All</>}
                  </button>
                )}
              </div>
            )}

          </div>

          {/* Employee List */}
          <div className="flex-1 overflow-y-auto scrollbar-dark">
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
              <div className="p-2 space-y-1">
                {filteredEmployees.map(emp => {
                  const isSelected = selectedEmployeeIds.has(emp.id);
                  return (
                    <div
                      key={emp.id}
                      onClick={() => toggleEmployeeSelection(emp.id)}
                      className={`cursor-pointer rounded-xl px-3 py-2.5 transition-all duration-150 group border ${
                        isSelected
                          ? 'bg-emerald-600/25 border-emerald-400/60 ring-2 ring-emerald-400/35 shadow-lg shadow-emerald-500/15 border-l-[3px] border-l-emerald-400'
                          : 'bg-slate-800/30 border-slate-700/30 hover:bg-slate-800/60 hover:border-slate-600/50'
                      } ${emp.is_pinned && !isSelected ? 'border-l-[3px] border-l-amber-400/60' : ''}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center transition-all duration-150 border ${
                          isSelected
                            ? 'bg-emerald-500/40 border-emerald-400/60'
                            : 'bg-slate-800 border-slate-600/50 group-hover:bg-slate-700 group-hover:border-slate-500/50'
                        }`}>
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-emerald-200" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-500 group-hover:text-slate-300" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[13px] font-semibold truncate ${isSelected ? 'text-white' : 'text-slate-200 group-hover:text-white'}`}>
                              {emp.username}
                            </span>
                            {emp.is_pinned && (
                              <Bookmark className="w-3.5 h-3.5 text-amber-400 fill-amber-400/40 flex-shrink-0" />
                            )}
                            {!emp.is_active && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-red-500/20 text-red-300 font-bold flex-shrink-0 border border-red-500/20">OFF</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[11px] font-mono text-slate-500">{emp.employee_id}</span>
                            {emp.tags && emp.tags.length > 0 && (
                              <div className="flex gap-1">
                                {emp.tags.slice(0, 2).map((tag, idx) => (
                                  <span key={idx} className="text-[10px] px-1.5 py-px rounded-md bg-teal-500/15 text-teal-300 border border-teal-500/15 font-medium">
                                    {tag}
                                  </span>
                                ))}
                                {emp.tags.length > 2 && (
                                  <span className="text-[10px] text-slate-500 font-semibold">+{emp.tags.length - 2}</span>
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
          <div className="px-2 py-1.5 border-t border-slate-700/40 flex gap-1 bg-slate-800/20">
            <button onClick={selectAllEmployees} disabled={allEmployeesSelected}
              className="flex-1 px-2 py-1 bg-emerald-600/80 hover:bg-emerald-600 disabled:bg-slate-800 disabled:opacity-40 text-white rounded-md text-[10px] font-semibold transition-all">
              All
            </button>
            <button onClick={clearSelection} disabled={selectedEmployeeIds.size === 0}
              className="flex-1 px-2 py-1 bg-slate-700/80 hover:bg-slate-700 disabled:opacity-40 text-slate-300 rounded-md text-[10px] font-semibold transition-all">
              Clear
            </button>
          </div>
        </div>

        {/* Panel 3: Compose Message */}
        <div className="flex-1 min-w-0 bg-gradient-to-b from-slate-900/90 to-slate-900/70 border-r border-slate-700/40 flex flex-col">
          <div className="flex-1 min-h-0 flex flex-col p-3 gap-3">
            {/* Type + Priority + Template row */}
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              {/* Type selector */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Type</span>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setMessageForm({ ...messageForm, messageType: 'realtime' })}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[11px] font-bold transition-all duration-200 border-2 ${
                      messageForm.messageType === 'realtime'
                        ? 'bg-blue-600 text-white border-blue-400 shadow-lg shadow-blue-600/40 scale-[1.02]'
                        : 'bg-blue-950/40 text-blue-400 border-blue-500/30 hover:bg-blue-900/40 hover:border-blue-500/50'
                    }`}>
                    <Bell className="w-3.5 h-3.5" />
                    Realtime
                  </button>
                  <button
                    onClick={() => setMessageForm({ ...messageForm, messageType: 'login_popup' })}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[11px] font-bold transition-all duration-200 border-2 ${
                      messageForm.messageType === 'login_popup'
                        ? 'bg-violet-600 text-white border-violet-400 shadow-lg shadow-violet-600/40 scale-[1.02]'
                        : 'bg-violet-950/40 text-violet-400 border-violet-500/30 hover:bg-violet-900/40 hover:border-violet-500/50'
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
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold capitalize transition-all duration-200 border-2 ${
                          isActive
                            ? `${c.activeBg} text-white ${c.activeBorder} shadow-lg ${c.activeShadow} scale-[1.02]`
                            : `${c.inactiveBg} ${c.inactiveText} ${c.inactiveBorder} ${c.hoverBg} ${c.hoverBorder}`
                        }`}>
                        <div className={`w-2 h-2 rounded-full ${c.dot} ${isActive ? 'animate-pulse' : 'opacity-60'}`} />
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
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[11px] font-bold transition-all duration-200 border-2 ${
                      showTemplateDropdown
                        ? 'bg-teal-600 text-white border-teal-400 shadow-lg shadow-teal-600/40 scale-[1.02]'
                        : 'bg-teal-950/40 text-teal-400 border-teal-500/30 hover:bg-teal-900/40 hover:border-teal-500/50'
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
                className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-all shadow-sm"
              />
            </div>

            {/* TipTap Editor - fills all remaining space */}
            <div className="flex-1 min-h-0 flex flex-col">
              <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1.5 shrink-0">Content</label>
              <div className="flex-1 min-h-0 [&>div]:h-full [&>div]:flex [&>div]:flex-col">
                <TiptapEditor
                  ref={composeEditorRef}
                  content=""
                  onChange={(html: string) => setMessageForm(prev => ({ ...prev, content: html }))}
                  placeholder="Write your message here..."
                  theme="light"
                  adminId=""
                />
              </div>
            </div>
          </div>

          {/* Send Button - prominent */}
          <div className="px-3 py-2.5 border-t border-slate-700/40 bg-slate-800/20">
            <button
              onClick={validateAndSendMessage}
              disabled={sending || selectedEmployeeIds.size === 0 || !messageForm.title.trim()}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-bold shadow-lg shadow-blue-600/25 disabled:opacity-30 disabled:shadow-none disabled:cursor-not-allowed transition-all active:scale-[0.98]"
            >
              <Send className="w-4 h-4" />
              {sending ? 'Sending...' : selectedEmployeeIds.size === 0 ? 'Select recipients to send' : `Send to ${selectedEmployeeIds.size} recipient${selectedEmployeeIds.size !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>

        {/* Panel 4: Sent Messages */}
        <div className="w-72 flex-shrink-0 bg-gradient-to-b from-slate-900/90 to-slate-900/70 flex flex-col">
          {/* Header */}
          <div className="px-2.5 py-2 border-b border-slate-700/40 space-y-1.5 bg-slate-800/20">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Sent</h3>
              {sentMessages.length > 0 && !selectionMode && (
                <div className="flex items-center gap-1">
                  <button onClick={enterSelectionMode}
                    className="flex items-center gap-1 px-2 py-1 hover:bg-white/10 text-slate-400 hover:text-white rounded-md transition-all text-[10px] font-medium" title="Select messages">
                    <CheckSquare className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => { setDeleteMode('all'); setShowDeleteConfirm(true); }}
                    className="flex items-center gap-1 px-2 py-1 hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded-md transition-all text-[10px] font-medium" title="Clear all messages">
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
                  className="w-full pl-7 pr-7 py-1.5 text-[11px] bg-slate-800/80 border border-slate-600/50 rounded-md text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500/70 focus:border-blue-500/50 transition-all"
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
                <div className="flex bg-slate-800/60 rounded-lg p-0.5">
                  {([['all', 'All'], ['realtime', 'Realtime'], ['login_popup', 'Popup']] as const).map(([val, label]) => (
                    <button key={val} onClick={() => setMessageTypeFilter(val as any)}
                      className={`flex-1 px-1 py-1 text-[10px] font-semibold rounded-md transition-all ${
                        messageTypeFilter === val ? 'bg-blue-600/30 text-blue-300 shadow-sm' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                      }`}>{label}</button>
                  ))}
                </div>
                <div className="flex bg-slate-800/60 rounded-lg p-0.5">
                  {([['all', 'All'], ['read', 'Read'], ['unread', 'Unread']] as const).map(([val, label]) => (
                    <button key={val} onClick={() => setReadStatusFilter(val as any)}
                      className={`flex-1 px-1 py-1 text-[10px] font-semibold rounded-md transition-all ${
                        readStatusFilter === val ? 'bg-blue-600/30 text-blue-300 shadow-sm' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                      }`}>{label}</button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Message List */}
          <div className="flex-1 overflow-y-auto scrollbar-dark p-1 space-y-0.5">
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
                        setEditingMessage(false);
                        loadRecipientDetails(msg.id);
                      }
                    }}
                    className={`cursor-pointer rounded-lg border-l-[3px] px-2.5 py-2.5 transition-all duration-150 ${getPriorityBorderColor(msg.priority)} ${
                      selectionMode && isSelectedMsg
                        ? 'bg-blue-600/15 ring-1 ring-blue-500/30'
                        : 'bg-slate-800/30 hover:bg-slate-800/60'
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
                              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                              : 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
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
                            {new Date(msg.created_at).toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}
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
            <div className="px-2.5 py-1.5 border-t border-slate-700/40 flex items-center justify-between bg-slate-800/20">
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
                    <button onClick={handleSaveEdit} disabled={saving}
                      className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                      {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button onClick={handleCancelEdit} disabled={saving}
                      className="flex items-center gap-1.5 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                      <X className="w-4 h-4" /> Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => handleStartEdit(selectedMessageDetail)}
                      className="flex items-center gap-1.5 px-4 py-2 bg-blue-600/20 hover:bg-blue-600/40 border border-blue-500/30 rounded-lg transition-colors text-blue-300 hover:text-blue-200 text-sm font-medium">
                      <Pencil className="w-4 h-4" /> Edit
                    </button>
                    <button onClick={() => { setSelectedMessageIds(new Set([selectedMessageDetail.id])); setDeleteMode('selected'); setShowDeleteConfirm(true); }}
                      className="flex items-center gap-1.5 px-4 py-2 bg-red-600/20 hover:bg-red-600/40 border border-red-500/30 rounded-lg transition-colors text-red-300 hover:text-red-200 text-sm font-medium">
                      <Trash2 className="w-4 h-4" /> Delete
                    </button>
                    <button onClick={() => { setSelectedMessageDetail(null); setEditingMessage(false); }}
                      className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-white">
                      <X className="w-5 h-5" />
                    </button>
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
                          ? 'bg-amber-100 text-amber-700 border border-amber-300'
                          : 'bg-cyan-100 text-cyan-700 border border-cyan-300'
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
                        minHeight="100%"
                        maxHeight="100%"
                        bucket="announcement-images"
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
              <div className="w-[40%] flex flex-col min-h-0 border-l border-slate-700/50 bg-slate-800/30 overflow-y-auto scrollbar-dark">
                {/* Message Info */}
                <div className="p-5 border-b border-slate-700/40 space-y-3">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-widest">Message Info</h4>
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-3">
                      <Clock className="w-4 h-4 text-slate-500 flex-shrink-0" />
                      <div>
                        <p className="text-[10px] text-slate-500 font-medium">Sent</p>
                        <p className="text-xs text-slate-200 font-medium">{new Date(selectedMessageDetail.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {selectedMessageDetail.message_type === 'login_popup'
                        ? <Bell className="w-4 h-4 text-amber-400 flex-shrink-0" />
                        : <Radio className="w-4 h-4 text-cyan-400 flex-shrink-0" />}
                      <div>
                        <p className="text-[10px] text-slate-500 font-medium">Type</p>
                        <p className="text-xs text-slate-200 font-medium">{selectedMessageDetail.message_type === 'login_popup' ? 'Login Popup' : 'Realtime'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <AlertCircle className="w-4 h-4 text-slate-500 flex-shrink-0" />
                      <div>
                        <p className="text-[10px] text-slate-500 font-medium">Priority</p>
                        <span className={`inline-block text-xs px-2 py-0.5 rounded-full border font-semibold ${getPriorityColor(selectedMessageDetail.priority)}`}>
                          {selectedMessageDetail.priority.charAt(0).toUpperCase() + selectedMessageDetail.priority.slice(1)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Recipients Section */}
                <div className="p-5 border-b border-slate-700/40 space-y-3">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-widest">Recipients</h4>
                  {(!selectedMessageDetail.recipient_ids || selectedMessageDetail.recipient_ids.length === 0) ? (
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-700/30 rounded-lg">
                      <Globe className="w-4 h-4 text-blue-400" />
                      <span className="text-sm text-blue-300 font-medium">All Employees (Broadcast)</span>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Users className="w-4 h-4 text-teal-400" />
                        <span className="text-sm text-teal-300 font-medium">
                          Sent to {selectedMessageDetail.recipient_ids.length} employee{selectedMessageDetail.recipient_ids.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      {recipientUsernames.get(selectedMessageDetail.id) && (
                        <div className="max-h-60 overflow-y-auto scrollbar-dark space-y-0.5">
                          {recipientUsernames.get(selectedMessageDetail.id)!.map((name, i) => (
                            <div key={i} className="px-2.5 py-1 bg-slate-700/40 rounded text-xs text-slate-300 truncate">{name}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Read Status */}
                {messageStats.has(selectedMessageDetail.id) && !editingMessage && (() => {
                  const stats = messageStats.get(selectedMessageDetail.id)!;
                  const details = recipientDetails.get(selectedMessageDetail.id);
                  return (
                    <div className="p-5 space-y-4">
                      <h4 className="text-xs font-bold text-slate-300 uppercase tracking-widest">Read Status</h4>

                      <div className="flex items-baseline gap-2">
                        <span className={`text-3xl font-black ${stats.read_percentage === 100 ? 'text-emerald-400' : stats.read_percentage >= 50 ? 'text-amber-400' : 'text-slate-400'}`}>
                          {stats.read_percentage}%
                        </span>
                        <span className="text-sm text-slate-400">read</span>
                      </div>
                      <p className="text-xs text-slate-400">
                        {stats.read_count} of {stats.total_recipients} employee{stats.total_recipients !== 1 ? 's' : ''} have read this message
                      </p>

                      <div className="h-2.5 bg-slate-700 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${stats.read_percentage === 100 ? 'bg-emerald-500' : 'bg-gradient-to-r from-blue-500 to-cyan-500'}`} style={{ width: `${stats.read_percentage}%` }} />
                      </div>

                      {loadingRecipientDetails ? (
                        <div className="flex items-center justify-center py-6">
                          <div className="w-6 h-6 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" />
                        </div>
                      ) : details && (details.read.length > 0 || details.unread.length > 0) && (
                        <div className="grid grid-cols-2 gap-3 pt-2">
                          <div>
                            <div className="flex items-center gap-1.5 mb-2">
                              <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                              <span className="text-[11px] font-bold text-emerald-400">Read ({details.read.length})</span>
                            </div>
                            <div className="max-h-48 overflow-y-auto scrollbar-dark space-y-0.5">
                              {details.read.length === 0 ? (
                                <p className="text-[11px] text-slate-500 italic">None</p>
                              ) : (
                                details.read.map(emp => (
                                  <div key={emp.id} className="px-2 py-1.5 bg-slate-700/40 rounded text-[11px] text-slate-300 truncate font-medium">
                                    {emp.username}
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5 mb-2">
                              <UserX className="w-3.5 h-3.5 text-slate-400" />
                              <span className="text-[11px] font-bold text-slate-400">Unread ({details.unread.length})</span>
                            </div>
                            <div className="max-h-48 overflow-y-auto scrollbar-dark space-y-0.5">
                              {details.unread.length === 0 ? (
                                <p className="text-[11px] text-slate-500 italic">All read</p>
                              ) : (
                                details.unread.map(emp => (
                                  <div key={emp.id} className="px-2 py-1.5 bg-slate-700/40 rounded text-[11px] text-slate-300 truncate font-medium">
                                    {emp.username}
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        </div>
                      )}
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
