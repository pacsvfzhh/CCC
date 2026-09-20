import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  ArrowLeft,
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Edit3,
  Eye,
  FileText,
  Gift,
  History,
  Info,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Users,
  X,
} from 'lucide-react';
import { getAdminFinancialSessionToken } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { useResponsive } from '../../lib/useResponsive';
import EmployeeNotificationDetailPanel from '../employee/EmployeeNotificationDetailPanel';
import AdminPageLoading from './AdminPageLoading';

interface AdminIdentity {
  id: string;
  username: string;
  role: string;
  is_super_admin?: boolean;
}

interface AutomationEmployee {
  id: string;
  username: string;
  employee_id: string;
  created_by: string;
  is_active: boolean;
}

type TriggerType = 'total_orders' | 'daily_orders' | 'work_days' | 'commission_amount' | 'consecutive_work_days' | 'annual_date' | 'first_login';
type TriggerMode = 'reach_once' | 'recurring';
type TaskStatus = 'draft' | 'active' | 'paused' | 'archived';
type EmployeePickerStatusFilter = 'all' | 'active' | 'inactive';

interface AutomationTask {
  id: string;
  owner_admin_id: string;
  owner_username: string;
  source_task_id: string | null;
  source_version: number | null;
  name: string;
  description: string;
  status: TaskStatus;
  is_shared_template: boolean;
  trigger_type: TriggerType;
  trigger_mode: TriggerMode;
  threshold_value: number;
  minimum_daily_orders: number | null;
  minimum_daily_work_minutes: number | null;
  annual_month: number | null;
  annual_day: number | null;
  recipient_scope: 'all_managed' | 'selected';
  recipient_ids?: string[];
  title_template: string;
  content_template: string;
  message_type: 'realtime' | 'login_popup';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  reward_enabled: boolean;
  reward_amount: number | null;
  starts_at: string | null;
  ends_at: string | null;
  version: number;
  execution_count?: number;
  total_rewards?: number;
  updated_at: string;
}

interface AutomationExecution {
  id: string;
  task_name: string;
  employee_username: string;
  owner_username: string | null;
  actual_value: number;
  stage: number;
  reward_amount: number | null;
  reward_currency: string | null;
  status: 'processing' | 'succeeded' | 'failed';
  executed_at: string;
  error_message: string | null;
}

interface AutomationAdminGroup {
  id: string;
  username: string;
  role: string;
}

interface AutomationDashboard {
  currency: string;
  admin_groups: AutomationAdminGroup[];
  tasks: AutomationTask[];
  shared_templates: AutomationTask[];
  executions: AutomationExecution[];
}

interface TaskForm {
  id: string | null;
  name: string;
  triggerType: TriggerType;
  triggerMode: TriggerMode;
  thresholdValue: string;
  minimumDailyOrders: string;
  minimumDailyWorkMinutes: string;
  annualMonth: string;
  annualDay: string;
  recipientScope: 'all_managed' | 'selected';
  recipientIds: string[];
  titleTemplate: string;
  contentTemplate: string;
  messageType: 'realtime' | 'login_popup';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  rewardEnabled: boolean;
  rewardAmount: string;
  isSharedTemplate: boolean;
  startsAt: string;
}

interface Props {
  admin: AdminIdentity;
  employees: AutomationEmployee[];
  onBack: () => void;
}

type AutomationNoticeType = 'success' | 'error' | 'info';
type AutomationNoticeVariant = 'activated' | 'paused';

interface AutomationNotice {
  type: AutomationNoticeType;
  title?: string;
  message: string;
  variant?: AutomationNoticeVariant;
}

const triggerLabels: Record<TriggerType, string> = {
  total_orders: '累計完成訂單數',
  daily_orders: '當天完成訂單數',
  work_days: '累計工作天數',
  commission_amount: '累計佣金金額',
  consecutive_work_days: '連續工作達標',
  annual_date: '每年指定日期',
  first_login: '新員工帳戶第一次登入',
};

const statusLabels: Record<TaskStatus, string> = {
  draft: '草稿',
  active: '已啟用',
  paused: '已暫停',
  archived: '已結束',
};

const messageTypeLabels = {
  realtime: '即時通知',
  login_popup: '登入通知',
} as const;

const statusSortOrder: Record<TaskStatus, number> = {
  active: 0,
  paused: 1,
  draft: 2,
  archived: 3,
};

function compareAutomationTasks(left: AutomationTask, right: AutomationTask) {
  const statusDifference = statusSortOrder[left.status] - statusSortOrder[right.status];
  if (statusDifference !== 0) return statusDifference;

  const updatedDifference = right.updated_at.localeCompare(left.updated_at);
  return updatedDifference || left.name.localeCompare(right.name, 'zh-Hant');
}

function createDefaultForm(): TaskForm {
  return {
    id: null,
    name: '',
    triggerType: 'total_orders',
    triggerMode: 'reach_once',
    thresholdValue: '100',
    minimumDailyOrders: '10',
    minimumDailyWorkMinutes: '',
    annualMonth: '1',
    annualDay: '1',
    recipientScope: 'all_managed',
    recipientIds: [],
    titleTemplate: '',
    contentTemplate: '',
    messageType: 'realtime',
    priority: 'normal',
    rewardEnabled: false,
    rewardAmount: '',
    isSharedTemplate: false,
    startsAt: '',
  };
}

function taskToForm(task: AutomationTask): TaskForm {
  return {
    id: task.id,
    name: task.name,
    triggerType: task.trigger_type,
    triggerMode: task.trigger_mode,
    thresholdValue: String(task.threshold_value),
    minimumDailyOrders: task.minimum_daily_orders ? String(task.minimum_daily_orders) : '',
    minimumDailyWorkMinutes: task.minimum_daily_work_minutes ? String(task.minimum_daily_work_minutes) : '',
    annualMonth: task.annual_month ? String(task.annual_month) : '1',
    annualDay: task.annual_day ? String(task.annual_day) : '1',
    recipientScope: task.recipient_scope,
    recipientIds: task.recipient_ids || [],
    titleTemplate: task.title_template,
    contentTemplate: task.content_template,
    messageType: task.message_type,
    priority: task.priority,
    rewardEnabled: task.reward_enabled,
    rewardAmount: task.reward_amount ? String(task.reward_amount) : '',
    isSharedTemplate: task.is_shared_template,
    startsAt: task.starts_at ? task.starts_at.slice(0, 16) : '',
  };
}

function isTemplateAdded(existing: AutomationTask, source: AutomationTask) {
  return existing.source_task_id === source.id;
}

function buildEnglishTemplate(triggerType: TriggerType, rewardEnabled: boolean, rewardAmount: string) {
  const reward = rewardEnabled && rewardAmount
    ? ` A performance bonus of {{bonus_amount}} {{currency}} has been credited to your wallet.`
    : '';

  switch (triggerType) {
    case 'daily_orders':
      return {
        title: 'Congratulations on Your Daily Achievement',
        content: `<p>Congratulations, {{employee_name}}! You completed at least {{threshold_value}} orders today.${reward} Thank you for your dedication and keep up the excellent work!</p>`,
      };
    case 'work_days':
      return {
        title: 'Congratulations on Your Work Milestone',
        content: `<p>Congratulations, {{employee_name}}! You have completed {{threshold_value}} qualifying working days with at least {{minimum_daily_orders}} orders per day.${reward} Your consistency and dedication are greatly appreciated.</p>`,
      };
    case 'commission_amount':
      return {
        title: 'Congratulations on Your Commission Milestone',
        content: `<p>Congratulations, {{employee_name}}! Your accumulated commission has reached {{threshold_value}} {{currency}}.${reward} Thank you for your outstanding performance!</p>`,
      };
    case 'consecutive_work_days':
      return {
        title: 'Congratulations on Achieving Your Performance Goal',
        content: `<p>Congratulations, {{employee_name}}! You have worked for {{threshold_value}} consecutive days and completed at least {{minimum_daily_orders}} orders each day.${reward} Thank you for your dedication and keep up the excellent work!</p>`,
      };
    case 'annual_date':
      return {
        title: 'A Special Message for You',
        content: `<p>Hello, {{employee_name}}! Today is {{annual_month}}/{{annual_day}}, and we would like to share this special message with you.${reward} Thank you for being an important part of our team!</p>`,
      };
    case 'first_login':
      return {
        title: 'Welcome to the Team',
        content: `<p>Welcome, {{employee_name}}! This is your first login to the employee platform.${reward} We are glad to have you with us.</p>`,
      };
    default:
      return {
        title: 'Congratulations on Your Order Milestone',
        content: `<p>Congratulations, {{employee_name}}! You have completed {{threshold_value}} orders.${reward} Thank you for your continued effort and excellent performance!</p>`,
      };
  }
}

function replaceTemplateToken(value: string, token: string, replacement: string) {
  return value.split(token).join(replacement);
}

function renderPreview(template: string, form: TaskForm, currency: string) {
  let preview = replaceTemplateToken(template, '{{employee_name}}', 'Emily');
  preview = replaceTemplateToken(preview, '{{actual_value}}', form.thresholdValue || '0');
  preview = replaceTemplateToken(preview, '{{threshold_value}}', form.thresholdValue || '0');
  preview = replaceTemplateToken(preview, '{{minimum_daily_orders}}', form.minimumDailyOrders || '0');
  preview = replaceTemplateToken(preview, '{{annual_month}}', form.annualMonth || '1');
  preview = replaceTemplateToken(preview, '{{annual_day}}', form.annualDay || '1');
  preview = replaceTemplateToken(preview, '{{bonus_amount}}', Number(form.rewardAmount || 0).toFixed(2));
  return replaceTemplateToken(preview, '{{currency}}', currency);
}

function summarizeTask(task: AutomationTask, currency: string) {
  const value = task.trigger_type === 'commission_amount'
    ? `${Number(task.threshold_value).toLocaleString()} ${currency}`
    : Number(task.threshold_value).toLocaleString();
  const mode = task.trigger_mode === 'recurring' ? '每達到' : '累計達到';

  if (task.trigger_type === 'annual_date') {
    return `每年 ${task.annual_month || 1} 月 ${task.annual_day || 1} 日依 UTC 伺服器日期執行一次`;
  }
  if (task.trigger_type === 'first_login') {
    return '新員工帳戶第一次登入時發送一次通知';
  }
  if (task.trigger_type === 'consecutive_work_days') {
    const workMinutes = task.minimum_daily_work_minutes && task.minimum_daily_work_minutes > 0
      ? `，且每天至少工作 ${task.minimum_daily_work_minutes} 分鐘`
      : '';
    return `${task.trigger_mode === 'recurring' ? '每連續' : '連續'} ${value} 天，每天至少完成 ${task.minimum_daily_orders || 0} 筆訂單${workMinutes}`;
  }
  if (task.trigger_type === 'daily_orders') {
    return `每天${mode} ${value} 筆成功或失敗訂單`;
  }
  if (task.trigger_type === 'work_days') {
    const workMinutes = task.minimum_daily_work_minutes && task.minimum_daily_work_minutes > 0
      ? `，且每天至少工作 ${task.minimum_daily_work_minutes} 分鐘`
      : '';
    return `${mode} ${value} 個有效工作日，每天至少完成 ${task.minimum_daily_orders || 0} 筆訂單${workMinutes}`;
  }
  if (task.trigger_type === 'commission_amount') {
    return `${mode} ${value} 佣金`;
  }
  return `${mode} ${value} 筆成功或失敗訂單`;
}

export default function NotificationAutomation({ admin, employees, onBack }: Props) {
  const { isDesktop } = useResponsive();
  const isSuperAdmin = admin.role === 'super_admin' || Boolean(admin.is_super_admin);
  const [dashboard, setDashboard] = useState<AutomationDashboard>({ currency: 'USDC', admin_groups: [], tasks: [], shared_templates: [], executions: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<'tasks' | 'templates' | 'executions'>('tasks');
  const [editorOpen, setEditorOpen] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [form, setForm] = useState<TaskForm>(createDefaultForm());
  const [copiedFromName, setCopiedFromName] = useState<string | null>(null);
  const [copySourceTaskId, setCopySourceTaskId] = useState<string | null>(null);
  const [templateCustomized, setTemplateCustomized] = useState(false);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<AutomationTask | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [selectedAdminId, setSelectedAdminId] = useState(admin.id);
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const [adminMenuPosition, setAdminMenuPosition] = useState({ top: 0, left: 0, width: 244 });
  const [notice, setNotice] = useState<AutomationNotice | null>(null);
  const [variableHelpOpen, setVariableHelpOpen] = useState(false);
  const [employeePreviewOpen, setEmployeePreviewOpen] = useState(false);
  const [employeePickerOpen, setEmployeePickerOpen] = useState(false);
  const [employeePickerSearch, setEmployeePickerSearch] = useState('');
  const [employeePickerStatusFilter, setEmployeePickerStatusFilter] = useState<EmployeePickerStatusFilter>('all');
  const [pendingRecipientIds, setPendingRecipientIds] = useState<string[]>([]);
  const adminMenuAnchorRef = useRef<HTMLDivElement>(null);
  const loadRef = useRef<(() => Promise<void>) | null>(null);
  const dashboardRequestIdRef = useRef(0);

  const showNotice = (type: AutomationNoticeType, message: string, title?: string, variant?: AutomationNoticeVariant) => {
    setNotice({ type, message, title, variant });
  };

  const loadDashboard = async (ownerAdminId = selectedAdminId) => {
    const requestId = ++dashboardRequestIdRef.current;

    try {
      const { data, error } = await supabase.rpc('get_notification_automation_dashboard', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_owner_admin_id: isSuperAdmin ? ownerAdminId : null,
      });
      if (error) throw error;
      if (requestId !== dashboardRequestIdRef.current) return;
      setDashboard((data || { currency: 'USDC', admin_groups: [], tasks: [], shared_templates: [], executions: [] }) as unknown as AutomationDashboard);
    } catch {
      if (requestId === dashboardRequestIdRef.current) {
        showNotice('error', '無法載入自動化任務資料，請稍後再試。');
      }
    } finally {
      if (requestId === dashboardRequestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };
  loadRef.current = loadDashboard;

  useEffect(() => {
    void loadRef.current?.();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (templateCustomized || readOnly) return;
    const template = buildEnglishTemplate(form.triggerType, form.rewardEnabled, form.rewardAmount);
    setForm(previous => ({
      ...previous,
      titleTemplate: template.title,
      contentTemplate: template.content,
    }));
  }, [form.triggerType, form.triggerMode, form.thresholdValue, form.minimumDailyOrders, form.annualMonth, form.annualDay, form.rewardEnabled, form.rewardAmount, dashboard.currency, templateCustomized, readOnly]);

  const taskStats = useMemo(() => ({
    total: dashboard.tasks.length,
    active: dashboard.tasks.filter(task => task.status === 'active').length,
    rewards: dashboard.tasks.filter(task => task.reward_enabled).length,
    executions: dashboard.executions.filter(execution => execution.status === 'succeeded').length,
  }), [dashboard]);

  const orderedTasks = useMemo(
    () => [...dashboard.tasks].sort(compareAutomationTasks),
    [dashboard.tasks],
  );
  const orderedSharedTemplates = useMemo(
    () => [...dashboard.shared_templates].sort((left, right) => {
      const leftAdded = dashboard.tasks.some(existing => isTemplateAdded(existing, left));
      const rightAdded = dashboard.tasks.some(existing => isTemplateAdded(existing, right));
      return Number(rightAdded) - Number(leftAdded) || compareAutomationTasks(left, right);
    }),
    [dashboard.shared_templates, dashboard.tasks],
  );
  const selectedEmployees = useMemo(
    () => employees.filter(employee => form.recipientIds.includes(employee.id)),
    [employees, form.recipientIds],
  );
  const employeePickerResults = useMemo(() => {
    const query = employeePickerSearch.trim().toLocaleLowerCase();
    return employees.filter(employee => {
      const matchesQuery = !query
        || employee.username.toLocaleLowerCase().includes(query)
        || employee.employee_id.toLocaleLowerCase().includes(query);
      const matchesStatus = employeePickerStatusFilter === 'all'
        || employee.is_active === (employeePickerStatusFilter === 'active');
      return matchesQuery && matchesStatus;
    });
  }, [employees, employeePickerSearch, employeePickerStatusFilter]);
  const allVisibleEmployeesSelected = employeePickerResults.length > 0
    && employeePickerResults.every(employee => pendingRecipientIds.includes(employee.id));
  const pendingSelectedEmployees = useMemo(
    () => employees.filter(employee => pendingRecipientIds.includes(employee.id)),
    [employees, pendingRecipientIds],
  );

  const togglePendingEmployee = (employeeId: string) => {
    setPendingRecipientIds(previous => previous.includes(employeeId)
      ? previous.filter(id => id !== employeeId)
      : [...previous, employeeId]);
  };

  const openEmployeePicker = (initialRecipientIds = form.recipientIds) => {
    setPendingRecipientIds(initialRecipientIds);
    setEmployeePickerSearch('');
    setEmployeePickerStatusFilter('all');
    setEmployeePickerOpen(true);
  };

  const openNewTask = () => {
    const next = createDefaultForm();
    next.isSharedTemplate = isSuperAdmin;
    const template = buildEnglishTemplate(next.triggerType, next.rewardEnabled, next.rewardAmount);
    next.titleTemplate = template.title;
    next.contentTemplate = template.content;
    setForm(next);
    setCopiedFromName(null);
    setCopySourceTaskId(null);
    setTemplateCustomized(false);
    setReadOnly(false);
    setVariableHelpOpen(false);
    setEmployeePreviewOpen(false);
    setEmployeePickerOpen(false);
    setEditorOpen(true);
  };

  const openTask = (task: AutomationTask, onlyView = false) => {
    setForm(taskToForm(task));
    setCopiedFromName(null);
    setCopySourceTaskId(null);
    setTemplateCustomized(true);
    setReadOnly(onlyView || task.owner_admin_id !== admin.id);
    setVariableHelpOpen(false);
    setEmployeePreviewOpen(false);
    setEmployeePickerOpen(false);
    setEditorOpen(true);
  };

  const saveEmployeePicker = () => {
    if (pendingRecipientIds.length === 0) {
      showNotice('error', '請至少選擇一名員工');
      return;
    }
    setForm(previous => ({
      ...previous,
      recipientScope: 'selected',
      recipientIds: pendingRecipientIds,
    }));
    setEmployeePickerOpen(false);
  };

  const saveTask = async () => {
    if (!form.name.trim()) {
      showNotice('error', '請輸入任務名稱');
      return;
    }
    if (!form.titleTemplate.trim() || !form.contentTemplate.trim()) {
      showNotice('error', '請確認英文通知標題與內容');
      return;
    }
    if (form.triggerType !== 'annual_date' && Number(form.thresholdValue) <= 0) {
      showNotice('error', '觸發數值必須大於零');
      return;
    }
    if ((form.triggerType === 'work_days' || form.triggerType === 'consecutive_work_days') && Number(form.minimumDailyOrders) <= 0) {
      showNotice('error', '請設定每天至少完成訂單數');
      return;
    }
    if (form.triggerType === 'annual_date') {
      const month = Number(form.annualMonth);
      const day = Number(form.annualDay);
      const maximumDay = new Date(2000, month, 0).getDate();
      if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > maximumDay) {
        showNotice('error', '請選擇有效的月份與日期');
        return;
      }
    }
    if (form.rewardEnabled && Number(form.rewardAmount) <= 0) {
      showNotice('error', '獎金金額必須大於零');
      return;
    }
    if (form.triggerType === 'annual_date') {
      showNotice('error', '每年指定日期任務目前尚未啟用，請先選擇其他條件類型');
      return;
    }

    const isTemplateCopy = copySourceTaskId !== null;
    const saveSharedTemplate = !isTemplateCopy && isSuperAdmin && form.isSharedTemplate;
    const taskPayload = {
      p_admin_session_token: getAdminFinancialSessionToken(),
      p_task_id: form.id,
      p_name: form.name.trim(),
      p_description: '',
      p_trigger_type: form.triggerType,
      p_trigger_mode: form.triggerMode,
      p_threshold_value: Number(form.thresholdValue),
      p_minimum_daily_orders: form.triggerType === 'work_days' || form.triggerType === 'consecutive_work_days' ? Number(form.minimumDailyOrders) : null,
      p_minimum_daily_work_minutes: form.minimumDailyWorkMinutes ? Number(form.minimumDailyWorkMinutes) : null,
      p_recipient_scope: form.recipientScope,
      p_recipient_ids: form.recipientScope === 'selected' ? form.recipientIds : [],
      p_title_template: form.titleTemplate.trim(),
      p_content_template: form.contentTemplate.trim(),
      p_message_type: form.messageType,
      p_priority: form.priority,
      p_reward_enabled: form.rewardEnabled,
      p_reward_amount: form.rewardEnabled ? Number(form.rewardAmount) : null,
      p_is_shared_template: isTemplateCopy ? false : form.id ? form.isSharedTemplate : isSuperAdmin,
      p_starts_at: form.startsAt ? new Date(form.startsAt).toISOString() : null,
      p_ends_at: null,
    };

    setSaving(true);
    try {
      const { error } = copySourceTaskId
        ? await supabase.rpc('save_notification_automation_task_copy', {
            ...taskPayload,
            p_source_task_id: copySourceTaskId,
          })
        : await supabase.rpc('save_notification_automation_task', taskPayload);
      if (error) throw error;

      showNotice(
        'success',
        saveSharedTemplate
          ? '管理員範本已儲存'
          : form.id
            ? '任務已更新並重設為草稿'
            : '自動化任務已儲存為草稿',
      );
      setEditorOpen(false);
      setVariableHelpOpen(false);
      setEmployeePreviewOpen(false);
      setEmployeePickerOpen(false);
      setCopiedFromName(null);
      setCopySourceTaskId(null);
      if (saveSharedTemplate) setView('templates');
      const nextAdminId = isSuperAdmin ? admin.id : selectedAdminId;
      setSelectedAdminId(nextAdminId);
      setRefreshing(true);
      await loadDashboard(nextAdminId);
    } catch {
      showNotice('error', '自動化任務儲存失敗，請確認設定後再試。');
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (task: AutomationTask, status: TaskStatus) => {
    try {
      const { error } = await supabase.rpc('set_notification_automation_task_status', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_task_id: task.id,
        p_status: status,
      });
      if (error) throw error;
      if (status === 'active') {
        showNotice('success', '現有進度已設為基準，後續達標將從新基準開始計算。', '任務啟用成功', 'activated');
      } else if (status === 'paused') {
        showNotice('success', '此任務已停止執行，可隨時再次啟用。', '任務已暫停', 'paused');
      } else {
        showNotice('success', '任務狀態已完成更新。', '狀態更新成功');
      }
      setRefreshing(true);
      await loadDashboard();
    } catch {
      showNotice('error', '無法更新任務狀態，請稍後再試。');
    }
  };

  const deleteTask = async () => {
    if (!deleteTarget) return;

    setDeletingTaskId(deleteTarget.id);
    try {
      const { error } = await supabase.rpc('delete_notification_automation_task', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_task_id: deleteTarget.id,
      });
      if (error) throw error;

      setDeleteTarget(null);
      setRefreshing(true);
      showNotice('success', `任務「${deleteTarget.name}」已刪除`);
      await loadDashboard();
    } catch {
      showNotice('error', '無法刪除任務，請稍後再試。');
    } finally {
      setDeletingTaskId(null);
    }
  };

  const copyTemplate = async (task: AutomationTask, activate: boolean) => {
    if (!activate) {
      setForm({
        ...taskToForm(task),
        id: null,
        name: '',
        recipientScope: 'all_managed',
        recipientIds: [],
        isSharedTemplate: false,
      });
      setCopiedFromName(task.name);
      setCopySourceTaskId(task.id);
      setTemplateCustomized(true);
      setReadOnly(false);
      setView('templates');
      setEditorOpen(true);
      return;
    }

    if (dashboard.tasks.some(existing => isTemplateAdded(existing, task))) {
      showNotice('info', '這個管理員範本已經添加到本組任務，不可重複添加。');
      return;
    }

    try {
      const { data, error } = await supabase.rpc('copy_shared_notification_automation_task', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_source_task_id: task.id,
      });
      if (error) throw error;
      const result = data as unknown as { task_id?: string; duplicate?: boolean } | null;
      if (result?.duplicate) {
        showNotice('info', '這個管理員範本已經添加到本組任務，不可重複添加。若要建立不同版本，請使用「複製自訂」並修改內容。');
        return;
      }
      if (!result?.task_id) throw new Error('Template copy did not return a task id.');

      const nextAdminId = isSuperAdmin ? admin.id : selectedAdminId;
      setSelectedAdminId(nextAdminId);

      const { error: activateError } = await supabase.rpc('set_notification_automation_task_status', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_task_id: result.task_id,
        p_status: 'active',
      });
      if (activateError) throw activateError;

      showNotice('success', '已直接套用管理員範本，任務只會作用於你的員工');
      setSelectedTemplateIds(new Set());
      setView('tasks');
      setRefreshing(true);
      await loadDashboard(nextAdminId);
    } catch {
      showNotice('error', '無法套用管理員範本，請重新選擇後再試。');
    }
  };

  const applySelectedTemplates = async (templates: AutomationTask[]) => {
    const duplicateTemplates = templates.filter(template =>
      dashboard.tasks.some(existing => isTemplateAdded(existing, template)),
    );

    if (duplicateTemplates.length > 0) {
      const names = duplicateTemplates.map(template => `「${template.name}」`).join('、');
      showNotice('info', `以下管理員範本已經添加到本組任務：${names}。請先取消勾選這些範本，才能套用其他範本。`);
      return;
    }

    const nextAdminId = isSuperAdmin ? admin.id : selectedAdminId;
    setSelectedAdminId(nextAdminId);
    setRefreshing(true);

    try {
      for (const template of templates) {
        const { data, error } = await supabase.rpc('copy_shared_notification_automation_task', {
          p_admin_session_token: getAdminFinancialSessionToken(),
          p_source_task_id: template.id,
        });
        if (error) throw error;

        const result = data as unknown as { task_id?: string; duplicate?: boolean } | null;
        if (result?.duplicate) {
          showNotice('info', `管理員範本「${template.name}」已經添加到本組任務，請取消勾選後再試。`);
          return;
        }
        if (!result?.task_id) throw new Error('Template copy did not return a task id.');

        const { error: activateError } = await supabase.rpc('set_notification_automation_task_status', {
          p_admin_session_token: getAdminFinancialSessionToken(),
          p_task_id: result.task_id,
          p_status: 'active',
        });
        if (activateError) throw activateError;
      }

      setSelectedTemplateIds(new Set());
      setView('tasks');
      showNotice('success', `已套用 ${templates.length} 個管理員範本，任務只會作用於你的員工`);
      await loadDashboard(nextAdminId);
    } catch {
      setRefreshing(false);
      showNotice('error', '無法套用管理員範本，請重新選擇後再試。');
    }
  };

  const regenerateTemplate = () => {
    const template = buildEnglishTemplate(form.triggerType, form.rewardEnabled, form.rewardAmount);
    setForm(previous => ({ ...previous, titleTemplate: template.title, contentTemplate: template.content }));
    setTemplateCustomized(false);
  };

  const noticeCard = notice && createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-5 z-[150] flex justify-center px-4 sm:justify-end sm:px-6" role={notice.type === 'error' ? 'alert' : 'status'}>
      <div className={`pointer-events-auto relative flex w-full max-w-sm items-start gap-3.5 overflow-hidden rounded-2xl border p-4 shadow-2xl before:absolute before:-right-8 before:-top-10 before:h-28 before:w-28 before:rounded-full before:bg-white/10 after:absolute after:-bottom-12 after:right-16 after:h-24 after:w-24 after:rounded-full after:bg-white/[0.07] ${
        notice.variant === 'activated'
          ? 'border-emerald-100/60 bg-gradient-to-br from-emerald-500 via-teal-600 to-cyan-700 shadow-teal-900/40'
          : notice.variant === 'paused'
            ? 'border-amber-100/60 bg-gradient-to-br from-amber-400 via-orange-500 to-rose-600 shadow-orange-900/40'
            : notice.type === 'success'
              ? 'border-sky-100/60 bg-gradient-to-br from-sky-500 via-blue-600 to-indigo-700 shadow-blue-900/40'
              : notice.type === 'error'
                ? 'border-rose-100/60 bg-gradient-to-br from-rose-500 via-red-600 to-pink-700 shadow-rose-900/40'
                : 'border-amber-100/60 bg-gradient-to-br from-amber-400 via-orange-500 to-yellow-600 shadow-orange-900/40'
      }`}>
        <span className="relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/35 bg-white/20 text-white shadow-lg shadow-black/15 ring-1 ring-inset ring-white/15">
          {notice.variant === 'activated' ? <Play className="h-5 w-5 fill-current" /> : notice.variant === 'paused' ? <Pause className="h-5 w-5 fill-current" /> : notice.type === 'success' ? <CheckCircle2 className="h-6 w-6" /> : notice.type === 'error' ? <AlertCircle className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
        </span>
        <div className="relative z-10 min-w-0 flex-1 pt-0.5 text-white">
          <p className="text-sm font-black tracking-wide">
            {notice.title || (notice.type === 'success' ? '操作成功' : notice.type === 'error' ? '操作未完成' : '操作提示')}
          </p>
          <p className="mt-1.5 text-xs font-semibold leading-5 text-white/90">{notice.message}</p>
        </div>
        <button type="button" onClick={() => setNotice(null)} className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" aria-label="關閉提示">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>,
    document.body,
  );

  const deleteDialog = deleteTarget && createPortal(
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-950/75 px-4 backdrop-blur-sm" role="presentation">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-rose-300/25 bg-gradient-to-b from-slate-900 to-slate-950 shadow-2xl shadow-rose-950/40" role="dialog" aria-modal="true" aria-labelledby="delete-task-title">
        <div className="flex items-start gap-3 border-b border-rose-300/15 bg-rose-500/[0.08] px-5 py-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-rose-300/25 bg-rose-400/15 text-rose-300">
            <Trash2 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 id="delete-task-title" className="text-sm font-black text-white">刪除自動化任務？</h2>
            <p className="mt-1 text-xs leading-5 text-rose-100/70">刪除後將無法在本組任務中恢復，請確認是否繼續。</p>
          </div>
        </div>
        <div className="px-5 py-4">
          <p className="truncate rounded-xl border border-slate-700/80 bg-slate-950/70 px-3 py-2.5 text-sm font-bold text-slate-100" title={deleteTarget.name}>{deleteTarget.name}</p>
          <p className="mt-2 text-xs leading-5 text-slate-500">這只會刪除目前選取的任務，不會影響其他管理員的任務。</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-800/80 px-5 py-3">
          <button type="button" onClick={() => setDeleteTarget(null)} disabled={deletingTaskId !== null} className="h-9 rounded-lg border border-slate-600/80 bg-slate-800 px-4 text-xs font-bold text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50">取消</button>
          <button type="button" onClick={() => void deleteTask()} disabled={deletingTaskId !== null} className="flex h-9 items-center gap-2 rounded-lg border border-rose-300/30 bg-gradient-to-r from-rose-600 to-red-700 px-4 text-xs font-black text-white shadow-lg shadow-rose-950/40 transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60">
            {deletingTaskId ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            {deletingTaskId ? '刪除中……' : '確認刪除'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );

  const variableHelpDialog = variableHelpOpen && createPortal(
    <div
      className="fixed inset-0 z-[170] flex items-center justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-sm"
      role="presentation"
      onMouseDown={() => setVariableHelpOpen(false)}
    >
      <div
        className="flex max-h-[calc(100vh-48px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-cyan-300/25 bg-gradient-to-b from-slate-900 via-slate-950 to-slate-950 shadow-2xl shadow-cyan-950/40"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-variable-help-title"
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-cyan-300/20 bg-gradient-to-r from-blue-950 via-cyan-950 to-blue-950 px-5 py-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-200/30 bg-cyan-400/15 text-cyan-200 shadow-lg shadow-cyan-950/30">
            <Info className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="notification-variable-help-title" className="text-base font-black tracking-tight text-white">英文通知變數說明</h2>
            <p className="mt-1 text-xs leading-5 text-cyan-100/70">這些欄位會在通知發送時，自動替換成當次任務的實際資料。</p>
          </div>
          <button type="button" onClick={() => setVariableHelpOpen(false)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70" aria-label="關閉變數說明">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="dark-panel-scroll min-h-0 flex-1 overflow-y-auto p-5">
          <div className="rounded-xl border border-cyan-300/20 bg-cyan-400/[0.07] p-4">
            <h3 className="text-sm font-black text-cyan-100">使用方式</h3>
            <div className="mt-2 space-y-1.5 text-xs leading-5 text-slate-300">
              <p>1. 將下方任一變數完整複製到「通知標題」或「通知內容」中，格式必須保留兩側的雙大括號，例如 <code className="rounded bg-slate-950/70 px-1.5 py-0.5 font-mono text-cyan-200">{'{{employee_name}}'}</code>。</p>
              <p>2. 儲存任務後，系統會在通知真正發送給員工時替換變數；編輯器中的預覽只會使用示範資料，例如員工名稱 Emily。</p>
              <p>3. 變數名稱區分拼字與底線，請不要改成單大括號、加入空格、翻譯名稱或刪除底線。無法套用的變數會保留原文字，不會影響任務執行。</p>
              <p>4. 變數可以和一般英文文字、數字及貨幣單位一起使用；建議在變數前後保留適當空格，讓員工收到的句子容易閱讀。</p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-slate-700/80 bg-slate-900/70 p-3">
              <code className="font-mono text-xs font-bold text-cyan-200">{'{{employee_name}}'}</code>
              <p className="mt-2 text-xs font-bold text-slate-200">員工名稱</p>
              <p className="mt-1 text-[11px] leading-5 text-slate-400">替換為實際收到通知的員工姓名，用來製作個人化稱呼。這是最適合放在 Congratulations、Hello 或 Thanks 後面的變數。</p>
              <p className="mt-2 rounded-lg border border-slate-700/70 bg-slate-950/70 px-2.5 py-2 text-[11px] leading-5 text-slate-300">範例：Congratulations, <span className="font-bold text-cyan-200">{'{{employee_name}}'}</span>!</p>
            </div>

            <div className="rounded-xl border border-slate-700/80 bg-slate-900/70 p-3">
              <code className="font-mono text-xs font-bold text-cyan-200">{'{{threshold_value}}'}</code>
              <p className="mt-2 text-xs font-bold text-slate-200">任務目標值</p>
              <p className="mt-1 text-[11px] leading-5 text-slate-400">替換為任務設定的達標門檻，例如 100 筆訂單、10 個工作日或 500 USDC。它表示「目標是多少」，不是員工實際完成的數值。</p>
              <p className="mt-2 rounded-lg border border-slate-700/70 bg-slate-950/70 px-2.5 py-2 text-[11px] leading-5 text-slate-300">範例：Your target was <span className="font-bold text-cyan-200">{'{{threshold_value}}'}</span> orders.</p>
            </div>

            <div className="rounded-xl border border-slate-700/80 bg-slate-900/70 p-3">
              <code className="font-mono text-xs font-bold text-cyan-200">{'{{actual_value}}'}</code>
              <p className="mt-2 text-xs font-bold text-slate-200">實際達成值</p>
              <p className="mt-1 text-[11px] leading-5 text-slate-400">替換為本次任務被觸發時記錄的實際數值，適合用來告訴員工「這次實際完成了多少」。它可能高於任務目標值。</p>
              <p className="mt-2 rounded-lg border border-slate-700/70 bg-slate-950/70 px-2.5 py-2 text-[11px] leading-5 text-slate-300">範例：You completed <span className="font-bold text-cyan-200">{'{{actual_value}}'}</span> orders.</p>
            </div>

            <div className="rounded-xl border border-slate-700/80 bg-slate-900/70 p-3">
              <code className="font-mono text-xs font-bold text-cyan-200">{'{{minimum_daily_orders}}'}</code>
              <p className="mt-2 text-xs font-bold text-slate-200">每日最低訂單數</p>
              <p className="mt-1 text-[11px] leading-5 text-slate-400">只適用於「連續工作達標」任務，替換為每天必須完成的最低訂單數。其他觸發條件沒有這項設定，不建議在其他任務中使用。</p>
              <p className="mt-2 rounded-lg border border-slate-700/70 bg-slate-950/70 px-2.5 py-2 text-[11px] leading-5 text-slate-300">範例：at least <span className="font-bold text-cyan-200">{'{{minimum_daily_orders}}'}</span> orders every day.</p>
            </div>

            <div className="rounded-xl border border-slate-700/80 bg-slate-900/70 p-3">
              <code className="font-mono text-xs font-bold text-cyan-200">{'{{annual_month}}'} / {'{{annual_day}}'}</code>
              <p className="mt-2 text-xs font-bold text-slate-200">年度指定日期</p>
              <p className="mt-1 text-[11px] leading-5 text-slate-400">分別替換為任務設定的月份與日期，例如 5 月 20 日。適合用於生日、週年或年度提醒文字；兩個變數可以一起使用。</p>
              <p className="mt-2 rounded-lg border border-slate-700/70 bg-slate-950/70 px-2.5 py-2 text-[11px] leading-5 text-slate-300">範例：Today is <span className="font-bold text-cyan-200">{'{{annual_month}}'}</span>/<span className="font-bold text-cyan-200">{'{{annual_day}}'}</span>.</p>
            </div>

            <div className="rounded-xl border border-slate-700/80 bg-slate-900/70 p-3">
              <code className="font-mono text-xs font-bold text-cyan-200">{'{{bonus_amount}}'} / {'{{currency}}'}</code>
              <p className="mt-2 text-xs font-bold text-slate-200">獎金金額與貨幣</p>
              <p className="mt-1 text-[11px] leading-5 text-slate-400">前者替換為本次績效獎金數字，後者替換為網站目前使用的貨幣代碼，例如 USDC。只有啟用獎金的任務才建議使用這組變數。</p>
              <p className="mt-2 rounded-lg border border-slate-700/70 bg-slate-950/70 px-2.5 py-2 text-[11px] leading-5 text-slate-300">範例：You received <span className="font-bold text-cyan-200">{'{{bonus_amount}}'} {'{{currency}}'}</span>.</p>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-400/[0.07] p-4">
            <h3 className="text-sm font-black text-amber-100">完整通知範例</h3>
            <p className="mt-2 text-xs leading-5 text-slate-300">Congratulations, <span className="font-bold text-cyan-200">{'{{employee_name}}'}</span>! You completed <span className="font-bold text-cyan-200">{'{{actual_value}}'}</span> orders and reached your target of <span className="font-bold text-cyan-200">{'{{threshold_value}}'}</span>. A bonus of <span className="font-bold text-cyan-200">{'{{bonus_amount}}'} {'{{currency}}'}</span> has been added to your wallet.</p>
            <p className="mt-2 text-[11px] leading-5 text-amber-100/70">發送時，系統會把變數換成該名員工與該次任務的實際資料；請保留英文句子的基本結構，再依需求調整前後文字。</p>
          </div>
        </div>

        <div className="flex shrink-0 justify-end border-t border-slate-800/80 px-5 py-3">
          <button type="button" onClick={() => setVariableHelpOpen(false)} className="h-9 rounded-lg border border-cyan-300/30 bg-cyan-500/15 px-4 text-xs font-black text-cyan-100 transition-colors hover:border-cyan-200/60 hover:bg-cyan-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70">了解，關閉說明</button>
        </div>
      </div>
    </div>,
    document.body,
  );

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 bg-slate-950">
        <AdminPageLoading label="自動化任務" />
      </div>
    );
  }

  if (editorOpen) {
    const previewTitle = renderPreview(form.titleTemplate, form, dashboard.currency);
    const previewContent = renderPreview(form.contentTemplate, form, dashboard.currency);
    const employeePreviewDialog = employeePreviewOpen && createPortal(
      <div
        className={`fixed inset-0 z-[180] flex items-center justify-center bg-slate-900/45 backdrop-blur-sm ${isDesktop ? 'p-4' : ''}`}
        role="presentation"
        onMouseDown={() => setEmployeePreviewOpen(false)}
      >
        <div
          className={`pointer-events-auto flex w-full max-w-2xl flex-col overflow-hidden ${isDesktop ? 'h-[82vh] max-h-[88vh] rounded-3xl shadow-2xl shadow-blue-900/20' : 'h-full'}`}
          onMouseDown={event => event.stopPropagation()}
        >
          <EmployeeNotificationDetailPanel
            message={{
              title: previewTitle || 'Notification title',
              content: previewContent,
              message_type: form.messageType,
              priority: form.priority,
              notification_category: form.rewardEnabled ? 'performance_reward' : null,
              reward_amount: form.rewardEnabled ? Number(form.rewardAmount || 0) : null,
              reward_currency: dashboard.currency,
              created_at: new Date().toISOString(),
              is_read: false,
            }}
            onClose={() => setEmployeePreviewOpen(false)}
          />
        </div>
      </div>,
      document.body,
    );
    const employeePickerDialog = employeePickerOpen && createPortal(
      <div
        className="fixed inset-0 z-[190] flex items-center justify-center bg-slate-950/75 px-4 py-3 backdrop-blur-sm"
        role="presentation"
        onMouseDown={() => setEmployeePickerOpen(false)}
      >
        <div
          className="flex h-[min(860px,calc(100vh-24px))] max-h-[calc(100vh-24px)] w-full max-w-4xl flex-col overflow-hidden rounded-[1.35rem] border border-cyan-300/25 bg-gradient-to-br from-slate-900 via-blue-950/95 to-cyan-950/85 shadow-[0_24px_80px_rgba(2,8,23,0.72),0_0_40px_rgba(8,145,178,0.18)] ring-1 ring-inset ring-white/[0.08]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="automation-employee-picker-title"
          onMouseDown={event => event.stopPropagation()}
        >
          <div className="relative flex shrink-0 flex-wrap items-center gap-3 overflow-hidden border-b border-cyan-300/20 bg-gradient-to-r from-blue-950 via-cyan-950 to-blue-950 px-5 py-4">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(103,232,249,0.16),transparent_34%),radial-gradient(circle_at_85%_100%,rgba(59,130,246,0.14),transparent_38%)]" />
            <span className="relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-cyan-200/30 bg-cyan-400/15 text-cyan-200 shadow-lg shadow-cyan-950/30 ring-1 ring-inset ring-white/10">
              <Users className="h-5 w-5" />
            </span>
            <div className="relative z-10 min-w-0 flex-1">
              <p className="text-[9px] font-black uppercase tracking-[0.18em] text-cyan-200/65">Employee targeting</p>
              <h2 id="automation-employee-picker-title" className="mt-0.5 text-lg font-black tracking-tight text-white">選擇指定員工</h2>
              <p className="mt-1 text-xs leading-5 text-cyan-100/70">搜尋帳號或員工 ID，從左側選擇後在右側確認名單。</p>
            </div>
            <div className="relative z-10 w-full shrink-0 sm:w-[min(42%,320px)]">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-700" />
              <input
                autoFocus
                type="text"
                value={employeePickerSearch}
                onChange={event => setEmployeePickerSearch(event.target.value)}
                placeholder="搜尋員工帳號或員工 ID"
                className="w-full rounded-xl border border-cyan-100/80 bg-slate-50 py-2.5 pl-10 pr-10 text-sm font-semibold text-slate-900 outline-none transition-colors placeholder:text-slate-500 shadow-sm shadow-blue-950/20 hover:border-cyan-200 hover:bg-white focus:border-cyan-500 focus:bg-white focus:ring-2 focus:ring-cyan-400/30"
              />
              {employeePickerSearch && (
                <button type="button" onClick={() => setEmployeePickerSearch('')} className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900" aria-label="清除搜尋">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <button type="button" onClick={() => setEmployeePickerOpen(false)} className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 text-slate-400 transition-colors hover:border-cyan-200/30 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70" aria-label="關閉員工選擇">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden bg-gradient-to-br from-blue-950/35 via-slate-900/35 to-cyan-950/30">
            <div className="grid h-full min-h-0 gap-0 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,.8fr)]">
              <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-b border-slate-700/80 bg-slate-900/70 lg:border-b-0 lg:border-r">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/70 bg-gradient-to-r from-slate-950/75 to-slate-900/60 px-3.5 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-500">搜尋結果</p>
                    <p className="mt-0.5 text-sm font-black text-white">可選員工 <span className="ml-1 text-cyan-300">{employeePickerResults.length}</span></p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <SlidersHorizontal className="mr-0.5 h-3.5 w-3.5 text-cyan-300/70" aria-hidden="true" />
                    <button
                      type="button"
                      onClick={() => setEmployeePickerStatusFilter(previous => previous === 'active' ? 'all' : 'active')}
                      className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-black outline-none transition-colors focus-visible:ring-2 focus-visible:ring-emerald-300/60 ${employeePickerStatusFilter === 'active' ? 'border-emerald-200/50 bg-emerald-500/25 text-emerald-100 shadow-sm shadow-emerald-950/30' : 'border-emerald-300/20 bg-emerald-500/[0.08] text-emerald-300/80 hover:border-emerald-200/45 hover:bg-emerald-500/15'}`}
                    >
                      啟用
                    </button>
                    <button
                      type="button"
                      onClick={() => setEmployeePickerStatusFilter(previous => previous === 'inactive' ? 'all' : 'inactive')}
                      className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-black outline-none transition-colors focus-visible:ring-2 focus-visible:ring-rose-300/60 ${employeePickerStatusFilter === 'inactive' ? 'border-rose-200/55 bg-rose-500/25 text-rose-100 shadow-sm shadow-rose-950/30' : 'border-rose-300/25 bg-rose-500/[0.08] text-rose-300/80 hover:border-rose-200/55 hover:bg-rose-500/15 hover:text-rose-100'}`}
                    >
                      停用
                    </button>
                    <button
                      type="button"
                      disabled={employeePickerResults.length === 0}
                      onClick={() => setPendingRecipientIds(previous => {
                        const visibleIds = employeePickerResults.map(employee => employee.id);
                        return allVisibleEmployeesSelected
                          ? previous.filter(id => !visibleIds.includes(id))
                          : Array.from(new Set([...previous, ...visibleIds]));
                      })}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-300/30 bg-cyan-500/10 px-2.5 py-1.5 text-[11px] font-black text-cyan-100 outline-none transition-colors hover:border-cyan-200/70 hover:bg-cyan-500/20 focus-visible:ring-2 focus-visible:ring-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {allVisibleEmployeesSelected ? '取消全選' : '全選結果'}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-[1.75rem_minmax(0,1.25fr)_minmax(0,1fr)_auto] items-center gap-2 border-b border-slate-700/70 bg-slate-950/35 px-3 py-1.5 text-[9px] font-black tracking-wide text-slate-500">
                  <span aria-hidden="true" />
                  <span>員工帳號</span>
                  <span>員工 ID</span>
                  <span>狀態</span>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                {employeePickerResults.length === 0 ? (
                  <div className="flex h-full items-center justify-center px-4 py-10 text-center text-sm text-slate-500">找不到符合的員工帳號或 ID</div>
                ) : (
                  <div className="h-full divide-y divide-slate-700/50 overflow-y-auto overflow-anchor-none bg-slate-950/20 [scrollbar-gutter:stable] dark-panel-scroll">
                    {employeePickerResults.map(employee => {
                      const selected = pendingRecipientIds.includes(employee.id);
                      return (
                        <div
                          key={employee.id}
                          role="checkbox"
                          aria-checked={selected}
                          tabIndex={0}
                          onClick={event => {
                            if (event.target instanceof HTMLInputElement) return;
                            togglePendingEmployee(employee.id);
                          }}
                          onKeyDown={event => {
                            if (event.target instanceof HTMLInputElement) return;
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              togglePendingEmployee(employee.id);
                            }
                          }}
                          className={`group grid cursor-pointer grid-cols-[1.75rem_minmax(0,1.25fr)_minmax(0,1fr)_auto] items-center gap-2 border-l-2 px-3 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 ${selected ? 'border-l-cyan-300 bg-gradient-to-r from-cyan-400/16 via-blue-500/10 to-cyan-500/5 shadow-[inset_0_0_18px_rgba(34,211,238,0.06)]' : 'border-l-transparent bg-slate-950/10 hover:bg-slate-800/60'}`}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={event => setPendingRecipientIds(previous => event.target.checked
                              ? (previous.includes(employee.id) ? previous : [...previous, employee.id])
                              : previous.filter(id => id !== employee.id))}
                            className="peer sr-only"
                          />
                          <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-cyan-400/70 ${selected ? 'border-cyan-200 bg-cyan-500 text-white shadow-[0_0_12px_rgba(34,211,238,0.45)]' : 'border-slate-600 bg-slate-950/80 text-transparent group-hover:border-slate-500'}`}>
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </span>
                          <span className={`min-w-0 truncate text-xs font-black ${selected ? 'text-cyan-50' : 'text-slate-200'}`}>{employee.username}</span>
                          <span className="min-w-0 truncate text-[11px] font-semibold text-slate-400">{employee.employee_id}</span>
                          {employee.is_active ? <span className="shrink-0 rounded-full border border-emerald-300/20 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-black text-emerald-300">啟用</span> : <span className="shrink-0 rounded-full border border-rose-300/20 bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-black text-rose-300">停用</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
                </div>
              </div>

              <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-gradient-to-b from-cyan-950/25 via-slate-900/80 to-slate-950/80 shadow-[inset_0_0_24px_rgba(34,211,238,0.04)]">
                <div className="flex items-center justify-between gap-2 border-b border-cyan-300/15 bg-gradient-to-r from-cyan-400/[0.09] to-blue-500/[0.04] px-3.5 py-3">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.16em] text-cyan-300/65">Selection preview</p>
                    <p className="mt-0.5 text-sm font-black text-white">已選員工</p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-200/30 bg-cyan-500/15 px-2.5 py-1 text-[10px] font-black text-cyan-100">
                    <CheckCircle2 className="h-3.5 w-3.5" />{pendingRecipientIds.length} 名
                  </span>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_1.75rem] items-center gap-2 border-b border-cyan-300/15 bg-slate-950/25 px-3 py-1.5 text-[9px] font-black tracking-wide text-cyan-300/55">
                  <span>員工帳號</span>
                  <span>員工 ID</span>
                  <span className="text-center">操作</span>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                {pendingSelectedEmployees.length === 0 ? (
                  <div className="flex h-full min-h-[210px] flex-col items-center justify-center px-4 py-8 text-center">
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-300/15 bg-cyan-400/[0.07] text-cyan-300/60">
                      <Users className="h-5 w-5" />
                    </span>
                    <p className="mt-3 text-xs font-bold text-slate-300">尚未選擇員工</p>
                    <p className="mt-1 text-[11px] leading-5 text-slate-500">勾選左側員工後，名單會顯示在這裡</p>
                  </div>
                ) : (
                  <div className="h-full divide-y divide-cyan-300/10 overflow-y-auto overflow-anchor-none bg-slate-950/20 [scrollbar-gutter:stable] dark-panel-scroll">
                    {pendingSelectedEmployees.map(employee => (
                      <div key={employee.id} className="group grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_1.75rem] items-center gap-2 border-l-2 border-l-transparent px-3 py-1.5 transition-colors hover:border-l-cyan-300 hover:bg-cyan-950/25">
                        <span className="min-w-0 truncate text-xs font-black text-cyan-50">{employee.username}</span>
                        <span className="min-w-0 truncate text-[11px] font-semibold text-slate-400">{employee.employee_id}</span>
                        <button type="button" onClick={() => togglePendingEmployee(employee.id)} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-transparent text-slate-500 transition-colors hover:border-rose-300/20 hover:bg-rose-500/15 hover:text-rose-300" aria-label={`移除 ${employee.username}`}>
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-cyan-300/15 bg-gradient-to-r from-slate-900/95 via-blue-950/90 to-cyan-950/80 px-5 py-3.5">
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-300">已暫存 {pendingRecipientIds.length} 名員工</p>
              <p className="mt-0.5 text-[10px] text-slate-500">保存後會套用到目前任務</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={() => setEmployeePickerOpen(false)} className="h-9 rounded-lg border border-slate-600/80 bg-slate-800 px-4 text-xs font-bold text-slate-200 transition-all hover:border-slate-500 hover:bg-slate-700 active:scale-[0.98]">取消</button>
              <button type="button" onClick={saveEmployeePicker} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-cyan-200/35 bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-600 px-4 text-xs font-black text-white shadow-lg shadow-cyan-950/30 transition-all hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 active:scale-[0.98]">
                <CheckCircle2 className="h-4 w-4" />保存選擇
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-950 text-slate-100">
        {noticeCard}
        {variableHelpDialog}
        {employeePreviewDialog}
        {employeePickerDialog}
        <div className="relative z-10 flex h-11 shrink-0 items-center justify-between gap-2 overflow-hidden border-b border-cyan-300/25 bg-gradient-to-r from-blue-950 via-cyan-900 to-blue-950 px-3 shadow-lg shadow-blue-950/70">
          <div className="flex min-w-0 items-center gap-2">
            <button onClick={() => { setCopiedFromName(null); setCopySourceTaskId(null); setVariableHelpOpen(false); setEmployeePreviewOpen(false); setEmployeePickerOpen(false); setEditorOpen(false); }} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-red-200/70 bg-red-600 text-white shadow-md shadow-red-950/35 transition-colors hover:border-white hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200/80">
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
            <h2 className="truncate text-base font-black tracking-tight text-white drop-shadow-sm">{readOnly ? '查看管理員範本' : form.id ? '編輯自動化任務' : '新增自動化任務'}</h2>
            <span className="hidden text-[10px] font-bold text-cyan-100/90 drop-shadow-sm md:inline">英文通知 · 繁中設定</span>
          </div>
          {copiedFromName && (
            <div className="flex min-w-0 items-center gap-1.5 rounded-lg border border-amber-300/25 bg-amber-400/10 px-2 py-1 text-[10px] text-amber-100">
              <Copy className="h-3.5 w-3.5 shrink-0 text-amber-300" />
              <span className="shrink-0 font-semibold text-amber-200/80">原任務名稱</span>
              <span className="max-w-[220px] truncate font-black text-white" title={copiedFromName}>{copiedFromName}</span>
            </div>
          )}
          {!readOnly && (
            <button disabled={saving} onClick={saveTask} className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-cyan-300/30 bg-gradient-to-r from-cyan-500 to-blue-600 px-3 text-xs font-black text-white shadow-md shadow-cyan-950/40 transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {isSuperAdmin && form.isSharedTemplate ? '儲存管理員範本' : '儲存為草稿'}
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden bg-slate-900">
          <div className="grid h-full min-h-0 w-full grid-cols-1 overflow-hidden border border-slate-700/70 bg-slate-950/45 xl:grid-cols-2">
            <div className="min-h-0 overflow-y-auto rounded-2xl border border-slate-700/70 bg-slate-900/55 p-3 shadow-inner shadow-slate-950/30 xl:col-start-1 xl:row-start-1 xl:border-r">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-l-2 border-cyan-400 pl-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Settings2 className="h-4 w-4 shrink-0 text-cyan-300" />
                  <div className="min-w-0">
                    <h3 className="text-sm font-black tracking-tight text-white">任務設定</h3>
                    <p className="text-[10px] text-slate-500">設定任務名稱、觸發條件、獎金與適用員工</p>
                  </div>
                </div>
                <div className="flex min-h-[52px] shrink-0 flex-wrap items-center gap-2 rounded-2xl border border-cyan-300/25 bg-gradient-to-r from-cyan-500/[0.1] via-slate-950/75 to-violet-500/[0.1] px-3 py-2 shadow-lg shadow-slate-950/25">
                  <div className="flex items-center gap-2 rounded-xl border border-slate-700/70 bg-slate-900/75 px-2.5 py-1.5">
                    <Bell className="h-4 w-4 text-cyan-300" />
                    <span className="text-[11px] font-black tracking-[0.08em] text-slate-200">通知類型</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => setForm(previous => ({ ...previous, messageType: 'realtime' }))}
                      className={`flex min-h-9 min-w-[7rem] items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-black transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/80 ${form.messageType === 'realtime' ? 'border-blue-200/90 bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-[0_0_18px_rgba(14,165,233,0.28)]' : 'border-blue-700/80 bg-slate-900/80 text-blue-200 hover:border-blue-400/80 hover:bg-blue-950/80'} disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      <Bell className="h-3.5 w-3.5" />
                      {messageTypeLabels.realtime}
                    </button>
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => setForm(previous => ({ ...previous, messageType: 'login_popup' }))}
                      className={`flex min-h-9 min-w-[7rem] items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-black transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/80 ${form.messageType === 'login_popup' ? 'border-violet-200/90 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-[0_0_18px_rgba(139,92,246,0.28)]' : 'border-violet-700/80 bg-slate-900/80 text-violet-200 hover:border-violet-400/80 hover:bg-violet-950/80'} disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      <AlertCircle className="h-3.5 w-3.5" />
                      {messageTypeLabels.login_popup}
                    </button>
                  </div>
                </div>
              </div>
              <div className="min-h-0">
              <section>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="sm:col-span-2">
                    <span className="mb-1.5 block text-xs font-semibold text-slate-400">任務名稱</span>
                    <input disabled={readOnly} value={form.name} onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-all duration-200 placeholder:text-slate-400 hover:border-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/25 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:hover:border-slate-300" placeholder={copiedFromName ? '請輸入新的任務名稱' : '例如：100 筆訂單鼓勵通知'} />
                  </label>
                </div>
              </section>

              <section className="mt-3 flex h-[360px] min-h-[360px] shrink-0 flex-col border-t border-slate-700/60 pt-2.5 sm:h-[220px] sm:min-h-[220px]">
                <div className="mb-2 flex shrink-0 items-center gap-1.5 text-xs font-black text-cyan-200"><Target className="h-3.5 w-3.5" />觸發條件</div>
                <div className="grid min-h-0 flex-1 content-start gap-3 sm:grid-cols-3">
                  <label>
                    <span className="mb-1.5 block text-xs font-semibold text-slate-400">條件類型</span>
                    <select disabled={readOnly} value={form.triggerType} onChange={event => { const triggerType = event.target.value as TriggerType; setTemplateCustomized(false); setForm(previous => ({ ...previous, triggerType, triggerMode: triggerType === 'first_login' ? 'reach_once' : previous.triggerMode, thresholdValue: triggerType === 'first_login' ? '1' : previous.thresholdValue })); }} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-all duration-200 placeholder:text-slate-400 hover:border-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/25 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:hover:border-slate-300">
                      {Object.entries(triggerLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  {form.triggerType !== 'annual_date' && form.triggerType !== 'first_login' ? (
                    <>
                      <label>
                        <span className="mb-1.5 block text-xs font-semibold text-slate-400">觸發方式</span>
                        <select disabled={readOnly} value={form.triggerMode} onChange={event => setForm(previous => ({ ...previous, triggerMode: event.target.value as TriggerMode }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-all duration-200 placeholder:text-slate-400 hover:border-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/25 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:hover:border-slate-300">
                          <option value="reach_once">累計達到一次</option>
                          <option value="recurring">每達到指定數量</option>
                        </select>
                      </label>
                      <label>
                        <span className="mb-1.5 block text-xs font-semibold text-slate-400">{form.triggerType === 'commission_amount' ? `目標金額（${dashboard.currency}）` : form.triggerType.includes('work_days') ? '目標天數' : '目標訂單數'}</span>
                        <input disabled={readOnly} type="number" min={form.triggerType === 'commission_amount' ? '0.01' : '1'} step={form.triggerType === 'commission_amount' ? '0.01' : '1'} value={form.thresholdValue} onChange={event => setForm(previous => ({ ...previous, thresholdValue: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-all duration-200 placeholder:text-slate-400 hover:border-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/25 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:hover:border-slate-300" />
                      </label>
                    </>
                  ) : form.triggerType === 'annual_date' ? (
                    <>
                      <label>
                        <span className="mb-1.5 block text-xs font-semibold text-slate-400">月份</span>
                        <select disabled={readOnly} value={form.annualMonth} onChange={event => setForm(previous => ({ ...previous, annualMonth: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-all duration-200 placeholder:text-slate-400 hover:border-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/25 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:hover:border-slate-300">
                          {Array.from({ length: 12 }, (_, index) => index + 1).map(month => <option key={month} value={month}>{month} 月</option>)}
                        </select>
                      </label>
                      <label>
                        <span className="mb-1.5 block text-xs font-semibold text-slate-400">日期</span>
                        <input disabled={readOnly} type="number" min="1" max={new Date(2000, Number(form.annualMonth), 0).getDate()} step="1" value={form.annualDay} onChange={event => setForm(previous => ({ ...previous, annualDay: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-all duration-200 placeholder:text-slate-400 hover:border-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/25 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:hover:border-slate-300" />
                      </label>
                      <div className="sm:col-span-3 rounded-xl border border-violet-500/20 bg-violet-500/10 p-3 text-xs leading-relaxed text-violet-100/80">
                        系統依 UTC 伺服器日期自動判斷，每年到達所選月日只執行一次，不依賴管理員或員工瀏覽器保持開啟。
                      </div>
                    </>
                  ) : (
                    <div className="sm:col-span-3 rounded-xl border border-violet-500/20 bg-violet-500/10 p-3 text-xs leading-relaxed text-violet-100/80">
                      新員工帳戶第一次登入時只發送一次通知，不需要設定目標數值或日期。
                    </div>
                  )}
                  {(form.triggerType === 'work_days' || form.triggerType === 'consecutive_work_days') && (
                    <label>
                      <span className="mb-1.5 block text-xs font-semibold text-slate-400">每天至少完成訂單數</span>
                      <input disabled={readOnly} type="number" min="1" step="1" value={form.minimumDailyOrders} onChange={event => setForm(previous => ({ ...previous, minimumDailyOrders: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-all duration-200 placeholder:text-slate-400 hover:border-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/25 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:hover:border-slate-300" />
                    </label>
                  )}
                  {(form.triggerType === 'work_days' || form.triggerType === 'consecutive_work_days') && (
                    <label>
                      <span className="mb-1.5 block text-xs font-semibold text-slate-400">每天至少工作分鐘（選填）</span>
                      <input disabled={readOnly} type="number" min="1" step="1" value={form.minimumDailyWorkMinutes} onChange={event => setForm(previous => ({ ...previous, minimumDailyWorkMinutes: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-all duration-200 placeholder:text-slate-400 hover:border-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/25 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:hover:border-slate-300" />
                    </label>
                  )}
                </div>
                <div className="mt-auto shrink-0 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1.5 text-xs text-cyan-100">
                  {summarizeTask({ trigger_type: form.triggerType, trigger_mode: form.triggerType === 'annual_date' ? 'reach_once' : form.triggerMode, threshold_value: Number(form.thresholdValue || 0), minimum_daily_orders: Number(form.minimumDailyOrders || 0), minimum_daily_work_minutes: form.minimumDailyWorkMinutes ? Number(form.minimumDailyWorkMinutes) : null, annual_month: Number(form.annualMonth || 1), annual_day: Number(form.annualDay || 1) } as AutomationTask, dashboard.currency)}
                </div>
              </section>

              </div>

              <div className="mt-3 border-t border-slate-700/60 pt-3">
                <section className={`rounded-2xl border p-3 transition-colors duration-200 ${form.rewardEnabled ? 'border-amber-300/45 bg-gradient-to-br from-amber-500/[0.12] via-orange-500/[0.06] to-slate-900 shadow-[0_10px_28px_rgba(120,53,15,0.16)]' : 'border-slate-700/80 bg-slate-900/65 hover:border-slate-600'}`}>
                  <div className={`flex items-center justify-between gap-2 border-l-2 pl-3 ${form.rewardEnabled ? 'border-amber-300' : 'border-slate-600'}`}>
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <Gift className={`h-5 w-5 shrink-0 ${form.rewardEnabled ? 'text-amber-300' : 'text-slate-500'}`} />
                      <div className="min-w-0 shrink-0">
                        <h3 className={`whitespace-nowrap text-[15px] font-black ${form.rewardEnabled ? 'text-amber-100' : 'text-slate-100'}`}>績效獎金與適用員工</h3>
                        <p className={`text-[10px] ${form.rewardEnabled ? 'text-amber-100/70' : 'text-slate-400'}`}>{form.rewardEnabled ? '已啟用，通知會附帶績效獎金' : '關閉時只發送一般通知'}</p>
                      </div>
                      {form.rewardEnabled && (
                        <div className="flex min-w-0 shrink items-center gap-2 rounded-xl border border-amber-300/35 bg-gradient-to-r from-amber-500/[0.16] to-orange-500/[0.1] px-2 py-1 shadow-sm shadow-amber-950/25">
                          <label className="flex shrink-0 items-center gap-2">
                            <span className="text-[11px] font-black text-amber-100">每次獎金</span>
                            <input
                              disabled={readOnly}
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={form.rewardAmount}
                              onChange={event => setForm(previous => ({ ...previous, rewardAmount: event.target.value }))}
                              aria-label="每次獎金"
                              className="h-9 w-28 rounded-xl border border-amber-300/70 bg-white px-3 text-base font-black text-slate-900 shadow-[0_2px_8px_rgba(120,53,15,0.18)] outline-none transition-colors hover:border-amber-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-400/35 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:hover:border-amber-300"
                            />
                          </label>
                          <span className="inline-flex h-9 shrink-0 items-center rounded-xl border border-amber-200/45 bg-amber-300/20 px-3 text-xs font-black text-amber-100 shadow-sm" title="網站計量貨幣">
                            {dashboard.currency}
                          </span>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={readOnly}
                      aria-pressed={form.rewardEnabled}
                      onClick={() => {
                        setTemplateCustomized(false);
                        setForm(previous => ({ ...previous, rewardEnabled: !previous.rewardEnabled }));
                      }}
                      className={`group inline-flex shrink-0 items-center gap-2 rounded-xl border px-2 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 disabled:cursor-not-allowed disabled:opacity-60 ${form.rewardEnabled ? 'border-amber-200/35 bg-amber-400/[0.1] hover:border-amber-100/60 hover:bg-amber-400/[0.16]' : 'border-slate-700 bg-slate-950/45 hover:border-slate-500 hover:bg-slate-800/70'}`}
                    >
                      <span className={`text-[11px] font-black ${form.rewardEnabled ? 'text-amber-100' : 'text-slate-300'}`}>{form.rewardEnabled ? '已啟用' : '未啟用'}</span>
                      <span className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors ${form.rewardEnabled ? 'border-amber-200/80 bg-gradient-to-r from-amber-300 to-orange-500 shadow-[0_0_14px_rgba(245,158,11,0.32)]' : 'border-slate-600 bg-slate-800'}`}>
                        <span className={`h-5 w-5 rounded-full bg-white shadow-md transition-transform ${form.rewardEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                      </span>
                    </button>
                  </div>
                </section>

              <section className="mt-3 border-t border-slate-700/60 pt-2.5">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-black text-cyan-200"><Users className="h-3.5 w-3.5" />適用員工</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(['all_managed', 'selected'] as const).map(scope => (
                    <button key={scope} type="button" disabled={readOnly} onClick={() => {
                      setForm(previous => ({ ...previous, recipientScope: scope, recipientIds: scope === 'selected' ? previous.recipientIds : [] }));
                      if (scope === 'selected') openEmployeePicker(form.recipientScope === 'selected' ? form.recipientIds : []);
                    }} className={`rounded-lg border px-2.5 py-2 text-left transition-all duration-200 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 ${form.recipientScope === scope ? 'border-cyan-400 bg-gradient-to-br from-cyan-500/15 to-blue-500/5 text-cyan-100 shadow-md shadow-cyan-950/30' : 'border-slate-700 bg-slate-950/80 text-slate-400 hover:border-slate-600 hover:bg-slate-800/70 hover:text-slate-200'} disabled:cursor-not-allowed disabled:opacity-60`}>
                      <p className="text-sm font-bold">{scope === 'all_managed' ? '全部可管理員工' : '指定員工'}</p>
                      <p className="mt-0.5 text-[10px] opacity-60">{scope === 'all_managed' ? '自動包含你權限範圍內的員工' : '只對下方勾選的員工生效'}</p>
                    </button>
                  ))}
                </div>
                {form.recipientScope === 'selected' ? (
                  <div className="mt-2 rounded-xl border border-cyan-300/20 bg-cyan-400/[0.06] p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-bold text-cyan-100">已選擇 {selectedEmployees.length} 名員工</p>
                      <button type="button" disabled={readOnly} onClick={() => openEmployeePicker()} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-cyan-300/30 bg-cyan-500/10 px-2 py-1.5 text-[10px] font-black text-cyan-100 transition-colors hover:border-cyan-200/60 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50">
                        <Users className="h-3 w-3" />{selectedEmployees.length > 0 ? '編輯名單' : '選擇員工'}
                      </button>
                    </div>
                    {selectedEmployees.length > 0 ? (
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() => openEmployeePicker()}
                        className="mt-2 flex w-full flex-wrap gap-1.5 rounded-lg border border-transparent bg-slate-950/30 px-2 py-1.5 text-left transition-colors hover:border-cyan-200/30 hover:bg-cyan-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 disabled:cursor-not-allowed disabled:opacity-60"
                        aria-label="編輯已選員工名單"
                      >
                        <span className="employee-selection-scroll flex max-h-[7rem] w-full flex-wrap content-start gap-1.5 overflow-y-auto pr-1">
                          {selectedEmployees.map(employee => (
                            <span key={employee.id} title={`${employee.username} · ${employee.employee_id}`} className="max-w-[48%] truncate rounded-md border border-cyan-300/20 bg-slate-950/60 px-2 py-1 text-[10px] font-semibold text-slate-200">
                              <span className="font-bold text-cyan-100">{employee.username}</span>
                              <span className="ml-1 text-slate-500">{employee.employee_id}</span>
                            </span>
                          ))}
                        </span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() => openEmployeePicker()}
                        className="mt-2 w-full rounded-lg border border-dashed border-amber-300/25 bg-amber-400/[0.04] px-2.5 py-2 text-left text-[10px] text-amber-200/80 transition-colors hover:border-amber-200/50 hover:bg-amber-400/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        尚未選擇員工，請點擊「選擇員工」開啟名單。
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="mt-2 rounded-lg border border-slate-700/60 bg-slate-950/45 px-2.5 py-2 text-[10px] leading-5 text-slate-500">選擇「指定員工」後，可在彈窗中搜尋帳號或員工 ID 並進行多選。</p>
                )}
              </section>
              </div>
            </div>

              <div className="min-h-0 overflow-hidden xl:col-start-2 xl:row-start-1 xl:border-l xl:border-slate-700/70">
              <section className="flex h-full min-h-0 flex-col overflow-hidden p-3">
                <div className="mb-2 flex min-h-0 shrink-0 flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5 border-l-2 border-cyan-400 pl-2.5">
                    <FileText className="h-4 w-4 shrink-0 text-cyan-300" />
                    <div className="min-w-0">
                      <h3 className="text-sm font-black tracking-tight text-white">英文通知內容</h3>
                      <p className="text-[10px] text-slate-500">動態變數會在發送時替換</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button type="button" onClick={() => setEmployeePreviewOpen(true)} aria-haspopup="dialog" aria-expanded={employeePreviewOpen} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-blue-300/35 bg-blue-500/15 px-2.5 text-[11px] font-bold text-blue-100 transition-colors hover:border-blue-200/70 hover:bg-blue-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/70">
                      <Eye className="h-3.5 w-3.5" />
                      員工端預覽
                    </button>
                    <button type="button" onClick={() => setVariableHelpOpen(true)} aria-haspopup="dialog" aria-expanded={variableHelpOpen} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-cyan-300/30 bg-cyan-500/10 px-2.5 text-[11px] font-bold text-cyan-200 transition-colors hover:border-cyan-200/60 hover:bg-cyan-500/20 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70">
                      <Info className="h-3.5 w-3.5" />
                      變數說明
                    </button>
                    {!readOnly && <button onClick={regenerateTemplate} className="shrink-0 rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-bold text-cyan-200 transition-all duration-200 hover:border-cyan-300/50 hover:bg-cyan-500/20 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70">套用預設範本</button>}
                  </div>
                </div>
                <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
                  <label className="shrink-0">
                    <span className="mb-1.5 block text-xs font-semibold text-slate-400">通知標題</span>
                    <input disabled={readOnly} value={form.titleTemplate} onChange={event => { setTemplateCustomized(true); setForm(previous => ({ ...previous, titleTemplate: event.target.value })); }} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-all duration-200 placeholder:text-slate-400 hover:border-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/25 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:hover:border-slate-300" />
                  </label>
                  <label className="flex min-h-0 flex-1 flex-col">
                    <span className="mb-1 block text-xs font-semibold text-slate-400">通知內容</span>
                    <textarea disabled={readOnly} rows={3} value={form.contentTemplate} onChange={event => { setTemplateCustomized(true); setForm(previous => ({ ...previous, contentTemplate: event.target.value })); }} className="dark-panel-scroll min-h-16 w-full flex-1 resize-none overflow-y-auto rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed text-slate-900 shadow-sm outline-none transition-all duration-200 hover:border-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/25 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:hover:border-slate-300" />
                  </label>
                </div>
              </section>
              </div>
          </div>
        </div>
      </div>
    );
  }

  const selectedTemplates = orderedSharedTemplates.filter(task =>
    selectedTemplateIds.has(task.id)
    && !dashboard.tasks.some(existing => isTemplateAdded(existing, task)),
  );
  const selectedAdmin = dashboard.admin_groups.find(group => group.id === selectedAdminId);
  const taskTabLabel = isSuperAdmin
    ? `${selectedAdmin?.username || admin.username} 的任務`
    : '我的任務';

  const selectAdminGroup = (nextAdminId: string) => {
    setSelectedAdminId(nextAdminId);
    setSelectedTemplateIds(new Set());
    setAdminMenuOpen(false);
    setRefreshing(true);
    void loadDashboard(nextAdminId);
  };

  const toggleAdminMenu = () => {
    if (!adminMenuOpen && adminMenuAnchorRef.current) {
      const bounds = adminMenuAnchorRef.current.getBoundingClientRect();
      const width = Math.min(bounds.width, window.innerWidth - 24);
      setAdminMenuPosition({
        top: bounds.bottom + 4,
        left: bounds.left,
        width,
      });
    }
    setAdminMenuOpen(previous => !previous);
  };

  return (
    <>
    {noticeCard}
    {deleteDialog}
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-950 text-slate-100">
      <div className="relative shrink-0 overflow-hidden border-b border-cyan-400/20 bg-gradient-to-r from-slate-950 via-slate-900 to-cyan-950/80 px-4 py-4 shadow-lg shadow-slate-950/30 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-4">
            <div className="flex shrink-0 items-center gap-3">
              <button onClick={onBack} className="flex h-9 w-9 items-center justify-center rounded-xl border border-red-400/40 bg-red-500/15 text-red-300 shadow-sm transition-all duration-200 hover:border-red-300/70 hover:bg-red-500/30 hover:text-red-100 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"><ArrowLeft className="h-4 w-4" /></button>
              <div className="flex items-center gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400/20 to-blue-500/10 text-cyan-300 shadow-inner ring-1 ring-cyan-300/20"><Sparkles className="h-5 w-5" /></div>
                <h2 className="text-lg font-black tracking-tight text-white sm:text-xl">自動化任務</h2>
              </div>
            </div>
            <div className="flex max-w-full overflow-x-auto rounded-xl border border-cyan-300/25 bg-gradient-to-b from-slate-800/90 to-slate-950/90 shadow-[0_8px_24px_rgba(2,8,23,0.45)] ring-1 ring-inset ring-white/[0.06]">
              {[
                { label: '任務總數', value: taskStats.total, icon: Settings2, color: 'text-cyan-200', surface: 'bg-cyan-500/15 border-cyan-400/20' },
                { label: '已啟用', value: taskStats.active, icon: Play, color: 'text-emerald-200', surface: 'bg-emerald-500/15 border-emerald-400/20' },
                { label: '獎勵任務', value: taskStats.rewards, icon: Gift, color: 'text-amber-200', surface: 'bg-amber-500/15 border-amber-400/20' },
                { label: '成功執行', value: taskStats.executions, icon: CheckCircle2, color: 'text-violet-200', surface: 'bg-violet-500/15 border-violet-400/20' },
              ].map(item => (
                <div key={item.label} className={`flex min-h-[58px] min-w-[156px] items-center gap-3 border-r px-4 py-2 last:border-r-0 ${item.surface}`}>
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-slate-950/40 shadow-inner ${item.color}`}><item.icon className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-nowrap text-[10px] font-bold tracking-wide text-slate-100">{item.label}</p>
                    <p className={`mt-0.5 flex h-5 items-center whitespace-nowrap text-lg font-black tabular-nums leading-5 ${item.color}`}>{item.value}</p>
                  </div>
                </div>
              ))}
              {isSuperAdmin && (
                <div ref={adminMenuAnchorRef} className="flex min-h-[58px] min-w-[244px] items-center gap-3 border-l border-sky-300/25 bg-gradient-to-br from-sky-500/20 via-blue-500/15 to-indigo-500/20 px-4 py-2">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-sky-200/20 bg-gradient-to-br from-sky-300 to-blue-500 text-blue-950 shadow-lg shadow-blue-950/40"><SlidersHorizontal className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1">
                    <span className="block whitespace-nowrap text-[9px] font-black uppercase tracking-[0.12em] text-sky-100/70">管理員分組</span>
                    <button
                      type="button"
                      disabled={refreshing}
                      onClick={toggleAdminMenu}
                      aria-haspopup="listbox"
                      aria-expanded={adminMenuOpen}
                      className={`mt-0.5 flex h-7 w-full items-center justify-between gap-2 rounded-lg border px-2.5 text-left text-[11px] font-black outline-none transition-all duration-200 ${adminMenuOpen ? 'border-sky-300/60 bg-sky-300/15 text-white ring-2 ring-sky-300/20' : 'border-sky-200/20 bg-slate-950/45 text-sky-50 hover:border-sky-300/45 hover:bg-sky-400/10'} disabled:cursor-wait disabled:opacity-60`}
                    >
                      <span className="truncate">{selectedAdmin?.username || admin.username}</span>
                      {refreshing ? (
                        <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-200" />
                      ) : (
                        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-sky-200 transition-transform duration-200 ${adminMenuOpen ? 'rotate-180' : ''}`} />
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button onClick={() => { setRefreshing(true); void loadDashboard(); }} disabled={refreshing} className="flex h-9 items-center gap-2 rounded-xl border border-slate-600/80 bg-slate-800/90 px-3 text-xs font-bold text-slate-200 shadow-sm transition-all duration-200 hover:border-cyan-400/60 hover:bg-slate-700 hover:text-cyan-200 hover:shadow-cyan-950/30 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:cursor-wait disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />刷新</button>
            <button onClick={openNewTask} className="flex h-9 items-center gap-2 rounded-xl border border-cyan-300/30 bg-gradient-to-r from-cyan-400 via-cyan-500 to-blue-600 px-4 text-xs font-black text-white shadow-lg shadow-cyan-950/50 transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 hover:shadow-cyan-500/20 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"><Plus className="h-4 w-4" />新增自動化任務</button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden bg-slate-900">
        <div className="flex h-full w-full flex-col overflow-hidden bg-slate-900">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-700/70 bg-slate-900/95 px-3 py-2.5 shadow-sm">
            <div className="flex gap-1 rounded-xl border border-slate-700/70 bg-slate-950/70 p-1 shadow-inner">
              {[
                { id: 'tasks' as const, label: taskTabLabel, icon: Settings2 },
                { id: 'templates' as const, label: '管理員範本', icon: Copy },
                { id: 'executions' as const, label: '執行記錄', icon: History },
              ].map(tab => (
                <button title={tab.label} key={tab.id} onClick={() => setView(tab.id)} className={`relative flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 ${tab.id === 'tasks' ? 'w-44 justify-center' : ''} ${view === tab.id ? 'bg-gradient-to-r from-cyan-600 to-blue-700 text-white shadow-md shadow-cyan-950/40' : 'text-slate-400 hover:bg-slate-800 hover:text-cyan-100'}`}><tab.icon className="h-4 w-4 shrink-0" /><span className="truncate">{tab.label}</span></button>
              ))}
            </div>
            {view === 'templates' && (
              <button
                type="button"
                aria-disabled={selectedTemplates.length === 0}
                onClick={() => {
                  if (selectedTemplates.length > 0) {
                    void applySelectedTemplates(selectedTemplates);
                    return;
                  }
                  showNotice('info', '請先勾選一個或多個管理員範本，再點擊「套用所選範本」。');
                }}
                className={`group relative flex h-11 min-w-[224px] items-center gap-2.5 overflow-hidden rounded-xl border px-2.5 pr-3 text-left outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-emerald-300/70 ${selectedTemplates.length > 0 ? 'border-emerald-200/45 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-600 text-white shadow-[0_8px_24px_rgba(5,150,105,0.28)] hover:-translate-y-0.5 hover:border-white/50 hover:shadow-[0_10px_28px_rgba(5,150,105,0.34)] active:translate-y-0 active:scale-[0.98]' : 'cursor-pointer border-amber-300/20 bg-gradient-to-r from-slate-800 to-slate-700/80 text-slate-300 shadow-inner hover:border-amber-300/40 hover:from-slate-700 hover:to-amber-950/50 hover:text-amber-100'}`}
              >
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors ${selectedTemplates.length > 0 ? 'border-white/35 bg-white/20 text-white group-hover:bg-white/30' : 'border-slate-600 bg-slate-900/50 text-slate-600'}`}>
                  <Play className="h-3.5 w-3.5 fill-current" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-black leading-4">套用所選範本</span>
                  <span className={`block max-w-[145px] truncate text-[9px] font-bold leading-3 ${selectedTemplates.length > 0 ? 'text-white' : 'text-amber-200/70'}`}>{selectedTemplates.length > 0 ? `已選取 ${selectedTemplates.length} 個範本` : '請先選擇管理員範本'}</span>
                </span>
                <ChevronRight className={`h-4 w-4 shrink-0 transition-transform ${selectedTemplates.length > 0 ? 'text-white group-hover:translate-x-0.5' : 'text-slate-600'}`} />
              </button>
            )}
          </div>

          <div className="relative min-h-0 flex-1 overflow-hidden">
          <div className={`h-full overflow-y-auto transition-opacity duration-300 ${refreshing ? 'pointer-events-none opacity-90' : 'opacity-100'}`}>
          <>
          {view === 'tasks' && (
            dashboard.tasks.length === 0 ? (
              <div className="relative flex h-full min-h-[280px] flex-col items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_center,rgba(6,182,212,0.10),transparent_42%)] px-6 py-16 text-center">
                <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-cyan-500/20 to-blue-500/10 text-cyan-300 shadow-xl shadow-cyan-950/40 ring-1 ring-cyan-300/10"><Bell className="h-8 w-8" /></div>
                <p className="mt-4 text-base font-bold text-slate-200">尚未建立自動化任務</p>
                <p className="mt-1 max-w-md text-sm text-slate-500">建立第一個任務，設定觸發條件、通知內容及可選的績效獎金；新任務會先儲存為草稿。</p>
                <button onClick={openNewTask} className="relative mt-5 inline-flex h-10 items-center gap-2 rounded-lg border border-blue-300/25 bg-gradient-to-r from-blue-500 to-indigo-500 px-5 text-sm font-black text-white transition-colors duration-200 hover:from-blue-400 hover:to-indigo-400 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/70"><Plus className="h-4 w-4" />建立第一個任務</button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[1200px]">
                  <div className="grid grid-cols-[48px_minmax(260px,1.45fr)_minmax(130px,.7fr)_minmax(210px,1.15fr)_minmax(170px,.9fr)_minmax(110px,.55fr)_minmax(130px,.65fr)_128px] border-l-2 border-l-transparent bg-gradient-to-r from-blue-800 via-cyan-800 to-blue-900 px-3 text-[10px] font-black tracking-wider text-white shadow-md shadow-blue-950/40">
                    <div className="px-2 py-2 text-center">序號</div>
                    <div className="px-2 py-2 pl-[54px]">任務</div>
                    <div className="px-2 py-2">通知類型</div>
                    <div className="px-2 py-2">觸發條件</div>
                    <div className="px-2 py-2">適用範圍</div>
                    <div className="px-2 py-2">執行次數</div>
                    <div className="px-2 py-2">每次獎金</div>
                    <div className="px-2 py-2 text-right">操作</div>
                  </div>
                  <div>
                    {orderedTasks.map((task, index) => (
                      <div key={task.id} className={`group relative grid grid-cols-[48px_minmax(260px,1.45fr)_minmax(130px,.7fr)_minmax(210px,1.15fr)_minmax(170px,.9fr)_minmax(110px,.55fr)_minmax(130px,.65fr)_128px] border-b border-l-2 border-l-transparent px-3 transition-all duration-200 before:absolute before:left-0 before:content-[''] ${task.status === 'active' ? 'border-b-orange-800/60 bg-gradient-to-r from-amber-950/70 via-orange-950/55 to-orange-950/30 hover:z-10 hover:from-amber-900/80 hover:via-orange-900/65 hover:to-orange-950/45 hover:shadow-[inset_0_0_0_1px_rgba(251,191,36,0.22),0_6px_18px_rgba(67,20,7,0.22)] before:inset-y-1.5 before:w-2 before:rounded-r-full before:bg-gradient-to-b before:from-yellow-200 before:via-amber-400 before:to-orange-600 before:shadow-[0_0_18px_rgba(251,146,60,0.72)]' : 'border-b-slate-800/80 bg-slate-950/55 hover:z-10 hover:bg-blue-950/55 hover:shadow-[inset_0_0_0_1px_rgba(96,165,250,0.24),0_6px_18px_rgba(7,30,70,0.28)] before:inset-y-2 before:w-1 before:rounded-r-full before:bg-slate-700/80 hover:before:bg-blue-500 hover:before:shadow-[0_0_12px_rgba(59,130,246,0.45)]'}`}>
                        <div className={`flex items-center justify-center px-2 py-2.5 text-xs font-black tabular-nums ${task.status === 'active' ? 'text-amber-300' : 'text-slate-600 group-hover:text-sky-300'}`}>{index + 1}</div>
                        <div className="min-w-0 px-2 py-2.5">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-all duration-200 ${task.status === 'active' ? 'border-amber-300/35 bg-gradient-to-br from-amber-500/30 via-orange-700/25 to-orange-950/80 text-amber-200 shadow-[0_0_14px_rgba(249,115,22,0.20)] ring-1 ring-inset ring-amber-200/10 group-hover:border-amber-200/55 group-hover:from-amber-500/40 group-hover:via-orange-600/35 group-hover:shadow-[0_0_18px_rgba(249,115,22,0.30)]' : 'border-slate-700/80 bg-slate-900/90 text-slate-500 group-hover:border-sky-400/50 group-hover:bg-blue-950/80 group-hover:text-sky-300 group-hover:shadow-[0_0_16px_rgba(59,130,246,0.20)]'}`}>
                              {task.reward_enabled ? <Gift className="h-5 w-5 stroke-[2.5]" /> : <Bell className="h-5 w-5 stroke-[2.5]" />}
                            </span>
                            <div className="min-w-0">
                              <div className="flex min-w-0 items-center gap-2">
                                <h3 className={`truncate text-sm font-black ${task.status === 'active' ? 'text-amber-50' : 'text-white'}`} title={task.name}>{task.name}</h3>
                                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-black ${task.status === 'active' ? 'border-amber-300/30 bg-orange-500/15 text-amber-100' : 'border-slate-700/70 bg-slate-900/70 text-slate-500'}`}>{statusLabels[task.status]}</span>
                              </div>
                              <p className={`mt-0.5 truncate text-[10px] ${task.status === 'active' ? 'text-orange-200/80' : 'text-slate-500/90'}`} title={task.owner_username}>
                                {task.owner_username}
                                {task.is_shared_template && <><span className="px-1 opacity-50">·</span><span className="font-bold">共享範本</span></>}
                                {task.source_task_id && <><span className="px-1 opacity-50">·</span><span>由範本複製</span></>}
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="min-w-0 px-2 py-2.5">
                          <p className={`flex items-center gap-1.5 text-[11px] font-black ${task.status === 'active' ? 'text-cyan-100' : 'text-slate-400'}`}>
                            {task.message_type === 'login_popup' ? <AlertCircle className="h-3.5 w-3.5 shrink-0" /> : <Bell className="h-3.5 w-3.5 shrink-0" />}
                            <span className="truncate">{messageTypeLabels[task.message_type]}</span>
                          </p>
                        </div>
                        <div className="min-w-0 px-2 py-2.5">
                          <p className={`truncate text-[10px] font-black tracking-wide ${task.status === 'active' ? 'text-amber-200/90' : 'text-slate-500'}`}>{triggerLabels[task.trigger_type]}</p>
                          <p className={`mt-0.5 truncate text-[11px] font-semibold ${task.status === 'active' ? 'text-orange-100' : 'text-slate-400'}`} title={summarizeTask(task, dashboard.currency)}>{summarizeTask(task, dashboard.currency)}</p>
                        </div>
                        <div className="min-w-0 px-2 py-2.5">
                          <p className={`truncate text-[11px] font-bold ${task.status === 'active' ? 'text-yellow-200' : 'text-slate-400'}`}>{task.recipient_scope === 'selected' ? `指定 ${task.recipient_ids?.length || 0} 人` : '全部可管理員工'}</p>
                        </div>
                        <div className="px-2 py-2.5">
                          <p className={`text-sm font-black tabular-nums ${task.status === 'active' ? 'text-orange-200' : 'text-slate-300'}`}>{task.execution_count || 0}</p>
                        </div>
                        <div className="min-w-0 px-2 py-2.5">
                          <p className={`truncate text-[11px] font-black ${task.status === 'active' ? 'text-amber-100' : 'text-slate-300'}`}>{task.reward_enabled ? `${Number(task.reward_amount || 0).toFixed(2)} ${dashboard.currency}` : '無'}</p>
                        </div>
                        <div className="flex items-center justify-end gap-1.5 px-2 py-2.5">
                          <button onClick={() => setDeleteTarget(task)} className="group/action relative flex h-7 items-center justify-center rounded-md border border-rose-400/25 bg-rose-500/10 px-2 text-[11px] font-bold text-rose-300 transition-colors hover:border-rose-300/50 hover:bg-rose-500/20 hover:text-rose-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/70" aria-label={`刪除任務 ${task.name}`}><Trash2 className="h-3.5 w-3.5" /><span aria-hidden="true" className="pointer-events-none absolute right-full top-1/2 z-30 mr-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-rose-300/25 bg-rose-950 px-2 py-1 text-[10px] font-bold text-rose-100 opacity-0 shadow-lg transition-opacity group-hover/action:opacity-100 group-focus-visible/action:opacity-100">刪除任務</span></button>
                          <button onClick={() => openTask(task)} className="group/action relative flex h-7 items-center justify-center rounded-md border border-cyan-400/30 bg-cyan-500/10 px-2 text-[11px] font-bold text-cyan-200 transition-colors hover:border-cyan-300/50 hover:bg-cyan-500/20 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70" aria-label={`編輯任務 ${task.name}`}><Edit3 className="h-3.5 w-3.5" /><span aria-hidden="true" className="pointer-events-none absolute right-full top-1/2 z-30 mr-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-cyan-300/25 bg-cyan-950 px-2 py-1 text-[10px] font-bold text-cyan-100 opacity-0 shadow-lg transition-opacity group-hover/action:opacity-100 group-focus-visible/action:opacity-100">編輯任務</span></button>
                          {task.status !== 'active' ? (
                            <button onClick={() => changeStatus(task, 'active')} className="group/action relative flex h-7 items-center justify-center rounded-md border border-emerald-400/25 bg-emerald-500/15 px-2 text-[11px] font-bold text-emerald-300 transition-colors hover:border-emerald-300/40 hover:bg-emerald-500/25 hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70" aria-label={`啟用任務 ${task.name}`}><Play className="h-3.5 w-3.5" /><span aria-hidden="true" className="pointer-events-none absolute right-full top-1/2 z-30 mr-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-emerald-300/25 bg-emerald-950 px-2 py-1 text-[10px] font-bold text-emerald-100 opacity-0 shadow-lg transition-opacity group-hover/action:opacity-100 group-focus-visible/action:opacity-100">啟用任務</span></button>
                          ) : (
                            <button onClick={() => changeStatus(task, 'paused')} className="group/action relative flex h-7 items-center justify-center rounded-md border border-amber-400/25 bg-amber-500/15 px-2 text-[11px] font-bold text-amber-300 transition-colors hover:border-amber-300/40 hover:bg-amber-500/25 hover:text-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70" aria-label={`暫停任務 ${task.name}`}><Pause className="h-3.5 w-3.5" /><span aria-hidden="true" className="pointer-events-none absolute right-full top-1/2 z-30 mr-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-amber-300/25 bg-amber-950 px-2 py-1 text-[10px] font-bold text-amber-100 opacity-0 shadow-lg transition-opacity group-hover/action:opacity-100 group-focus-visible/action:opacity-100">暫停任務</span></button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          )}

          {view === 'templates' && (
            dashboard.shared_templates.length === 0 ? (
              <div className="relative flex h-full min-h-[280px] flex-col items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_center,rgba(139,92,246,0.10),transparent_42%)] px-6 py-16 text-center before:absolute before:inset-0 before:bg-[linear-gradient(rgba(148,163,184,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.025)_1px,transparent_1px)] before:bg-[size:28px_28px]"><div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-500/20 to-fuchsia-500/10 text-violet-300 shadow-xl shadow-violet-950/40"><Copy className="h-8 w-8" /></div><p className="mt-4 font-bold text-slate-300">目前沒有可用的管理員範本</p><p className="mt-1 text-sm text-slate-500">管理員發佈共享範本後，可在這裡勾選並直接套用。</p></div>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[1180px]">
                  <div className="grid grid-cols-[48px_48px_minmax(250px,1.35fr)_minmax(210px,1.05fr)_minmax(120px,.6fr)_minmax(150px,.75fr)_minmax(140px,.7fr)_96px] border-l-2 border-l-transparent bg-gradient-to-r from-blue-800 via-cyan-800 to-blue-900 px-3 text-[10px] font-black tracking-wider text-white shadow-md shadow-blue-950/40">
                    <div className="px-2 py-2 text-center">序號</div>
                    <div className="px-2 py-2 text-center">選取</div>
                    <div className="px-2 py-2 pl-[54px]">管理員範本</div>
                    <div className="px-2 py-2">觸發條件</div>
                    <div className="px-2 py-2">通知類型</div>
                    <div className="px-2 py-2">獎金</div>
                    <div className="px-2 py-2">適用範圍</div>
                    <div className="px-2 py-2 text-right">操作</div>
                  </div>
                  <div>
                    {orderedSharedTemplates.map((task, index) => {
                      const alreadyAdded = dashboard.tasks.some(existing => isTemplateAdded(existing, task));
                      const selected = alreadyAdded || selectedTemplateIds.has(task.id);
                      const rewardAmount = Number(task.reward_amount || 0);
                      const hasReward = task.reward_enabled || rewardAmount > 0;
                      return (
                        <div key={task.id} className={`group relative grid grid-cols-[48px_48px_minmax(250px,1.35fr)_minmax(210px,1.05fr)_minmax(120px,.6fr)_minmax(150px,.75fr)_minmax(140px,.7fr)_96px] border-b border-l-2 border-l-transparent px-3 transition-all duration-200 before:absolute before:left-0 before:content-[''] ${alreadyAdded ? 'border-b-emerald-900/50 bg-emerald-950/35 hover:z-10 hover:bg-emerald-900/45 hover:shadow-[inset_0_0_0_1px_rgba(110,231,183,0.18),0_6px_18px_rgba(2,44,34,0.24)] before:inset-y-1.5 before:w-2 before:rounded-r-full before:bg-gradient-to-b before:from-emerald-300 before:via-emerald-500 before:to-teal-700 before:shadow-[0_0_16px_rgba(16,185,129,0.65)]' : selected ? 'border-b-blue-800/60 bg-gradient-to-r from-blue-950/65 via-sky-950/45 to-slate-950/55 hover:z-10 hover:from-blue-900/75 hover:via-sky-900/55 hover:shadow-[inset_0_0_0_1px_rgba(125,211,252,0.28),0_6px_18px_rgba(7,30,70,0.28)] before:inset-y-1.5 before:w-1.5 before:rounded-r-full before:bg-gradient-to-b before:from-sky-300 before:via-blue-500 before:to-blue-700 before:shadow-[0_0_14px_rgba(59,130,246,0.48)]' : 'border-b-slate-800/80 bg-slate-950/55 hover:z-10 hover:bg-violet-950/50 hover:shadow-[inset_0_0_0_1px_rgba(167,139,250,0.22),0_6px_18px_rgba(46,16,101,0.26)] before:inset-y-2 before:w-1 before:rounded-r-full before:bg-slate-700/80 hover:before:bg-violet-500 hover:before:shadow-[0_0_12px_rgba(139,92,246,0.42)]'}`}>
                          <div className={`flex items-center justify-center px-2 py-2.5 text-xs font-black tabular-nums ${alreadyAdded ? 'text-emerald-300' : selected ? 'text-sky-300' : 'text-slate-600 group-hover:text-violet-300'}`}>{index + 1}</div>
                          <label className={`flex items-center justify-center px-2 py-2.5 ${alreadyAdded ? 'cursor-not-allowed' : 'cursor-pointer'}`} aria-label={alreadyAdded ? `範本 ${task.name} 已添加，不可重複選取` : `${selected ? '取消選取' : '選取'}範本 ${task.name}`} title={alreadyAdded ? '此範本已添加到目前管理員組' : undefined}>
                            <input
                              type="checkbox"
                              checked={selected}
                              disabled={alreadyAdded}
                              onChange={event => setSelectedTemplateIds(previous => {
                                const next = new Set(previous);
                                if (event.target.checked) next.add(task.id);
                                else next.delete(task.id);
                                return next;
                              })}
                              className="peer sr-only"
                            />
                            <span className={`flex h-5 w-5 items-center justify-center rounded-md border bg-slate-950/70 text-transparent shadow-inner transition-all duration-150 peer-focus-visible:ring-2 peer-checked:text-white ${alreadyAdded ? 'border-emerald-300/40 peer-focus-visible:ring-emerald-300/70 peer-checked:border-emerald-200 peer-checked:bg-emerald-500 peer-checked:shadow-emerald-950/40' : 'border-slate-600 peer-focus-visible:ring-sky-300/70 peer-checked:border-sky-200 peer-checked:bg-blue-500 peer-checked:shadow-blue-950/40'}`}>
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            </span>
                          </label>
                          <div className="min-w-0 px-2 py-2.5">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-all duration-200 ${alreadyAdded ? 'border-emerald-300/40 bg-gradient-to-br from-emerald-400/30 via-emerald-700/25 to-emerald-950 text-emerald-200 shadow-[0_0_18px_rgba(16,185,129,0.22)] ring-1 ring-inset ring-emerald-300/15 group-hover:border-emerald-200/55 group-hover:from-emerald-400/40 group-hover:shadow-[0_0_20px_rgba(16,185,129,0.30)]' : selected ? 'border-sky-300/45 bg-gradient-to-br from-sky-500/30 via-blue-700/25 to-blue-950 text-sky-200 shadow-[0_0_16px_rgba(59,130,246,0.24)] ring-1 ring-inset ring-sky-300/10 group-hover:border-sky-200/60 group-hover:shadow-[0_0_20px_rgba(59,130,246,0.32)]' : 'border-slate-700/80 bg-slate-900/90 text-slate-500 group-hover:border-violet-400/50 group-hover:bg-violet-950/75 group-hover:text-violet-300 group-hover:shadow-[0_0_16px_rgba(139,92,246,0.18)]'}`}>
                                {hasReward ? <Gift className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                              </span>
                              <div className="min-w-0">
                                <div className="flex min-w-0 items-center gap-2">
                                  <h3 className="truncate text-sm font-black text-white" title={task.name}>{task.name}</h3>
                                  {alreadyAdded && (
                                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-300/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-black text-emerald-100 shadow-sm shadow-emerald-950/40">
                                      <CheckCircle2 className="h-3.5 w-3.5" />已添加
                                    </span>
                                  )}
                                </div>
                                <p className={`mt-0.5 truncate text-[10px] ${alreadyAdded ? 'text-emerald-200/80' : 'text-slate-500/90'}`} title={task.owner_username}>
                                  <ShieldCheck className="mr-1 inline h-3 w-3" />範本提供者
                                  <span className="px-1 opacity-50">·</span>
                                  <span className="font-bold">{task.owner_username}</span>
                                </p>
                              </div>
                            </div>
                          </div>
                          <div className="min-w-0 px-2 py-2.5">
                            <p className={`truncate text-[10px] font-black tracking-wide ${alreadyAdded ? 'text-cyan-300/80' : 'text-slate-500'}`}>{triggerLabels[task.trigger_type]}</p>
                            <p className={`mt-0.5 truncate text-[11px] font-semibold ${alreadyAdded ? 'text-slate-200' : 'text-slate-400'}`} title={summarizeTask(task, dashboard.currency)}>{summarizeTask(task, dashboard.currency)}</p>
                          </div>
                          <div className="min-w-0 px-2 py-2.5">
                            <p className={`flex items-center gap-1 truncate text-[11px] font-bold ${alreadyAdded ? 'text-cyan-100' : 'text-slate-400'}`}>
                              <Bell className="h-3.5 w-3.5 shrink-0" />
                              {messageTypeLabels[task.message_type]}
                            </p>
                          </div>
                          <div className="min-w-0 px-2 py-2.5">
                            {hasReward ? (
                              <>
                                <p className="flex items-center gap-1 text-[9px] font-black tracking-wide text-amber-300/80"><Gift className="h-3 w-3" />每次獎金</p>
                                <p className="mt-0.5 truncate text-sm font-black tabular-nums text-amber-200" title={`${rewardAmount.toFixed(2)} ${dashboard.currency}`}>{rewardAmount.toFixed(2)} {dashboard.currency}</p>
                              </>
                            ) : (
                              <p className="text-[11px] font-bold text-amber-300/70">無獎金</p>
                            )}
                          </div>
                          <div className="min-w-0 px-2 py-2.5">
                            <p className={`truncate text-[11px] font-bold ${alreadyAdded ? 'text-slate-200' : 'text-slate-400'}`}>{task.recipient_scope === 'selected' ? '指定範圍' : '全部員工'}</p>
                          </div>
                          <div className="flex items-center justify-end gap-1.5 px-2 py-2.5">
                            <button onClick={() => openTask(task, true)} className="group/action relative flex h-7 items-center justify-center rounded-md border border-violet-400/35 bg-violet-500/10 px-2 text-[11px] font-bold text-violet-200 transition-colors hover:border-violet-300/50 hover:bg-violet-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70" aria-label={`查看範本 ${task.name}`}><ChevronRight className="h-3.5 w-3.5" /><span aria-hidden="true" className="pointer-events-none absolute right-full top-1/2 z-30 mr-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-violet-300/25 bg-violet-950 px-2 py-1 text-[10px] font-bold text-violet-100 opacity-0 shadow-lg transition-opacity group-hover/action:opacity-100 group-focus-visible/action:opacity-100">查看範本</span></button>
                            <button onClick={() => copyTemplate(task, false)} className="group/action relative flex h-7 items-center justify-center rounded-md border border-blue-400/30 bg-blue-500/10 px-2 text-[11px] font-bold text-blue-200 transition-colors hover:border-blue-300/50 hover:bg-blue-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70" aria-label={`複製自訂範本 ${task.name}`}><Copy className="h-3.5 w-3.5" /><span aria-hidden="true" className="pointer-events-none absolute right-full top-1/2 z-30 mr-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-blue-300/25 bg-blue-950 px-2 py-1 text-[10px] font-bold text-blue-100 opacity-0 shadow-lg transition-opacity group-hover/action:opacity-100 group-focus-visible/action:opacity-100">複製自訂</span></button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )
          )}

          {view === 'executions' && (
            <div className="flex h-full min-h-[280px] flex-col bg-slate-900">
              <div className="flex min-h-0 flex-1 flex-col overflow-x-auto">
                <table className="w-full min-w-[850px] text-left text-xs">
                  <thead className="bg-gradient-to-r from-blue-800 via-cyan-800 to-blue-900 text-white shadow-md shadow-blue-950/40"><tr><th className="w-16 px-4 py-2 text-center font-black">序號</th><th className="px-5 py-2 font-black">任務</th><th className="px-4 py-2 font-black">員工</th><th className="px-4 py-2 font-black">階段</th><th className="px-4 py-2 font-black">實際數值</th><th className="px-4 py-2 font-black">獎金</th><th className="px-4 py-2 font-black">狀態</th><th className="px-5 py-2 text-right font-black">執行時間</th></tr></thead>
                  <tbody className="divide-y divide-slate-800">
                    {dashboard.executions.map((execution, index) => (
                      <tr key={execution.id} className="text-slate-300 transition-all duration-200 odd:bg-slate-950/15 hover:bg-slate-800/60"><td className="w-16 px-4 py-3 text-center font-black tabular-nums text-cyan-300">{index + 1}</td><td className="px-5 py-3 font-semibold text-white">{execution.task_name}</td><td className="px-4 py-3">{execution.employee_username}</td><td className="px-4 py-3">第 {execution.stage} 階段</td><td className="px-4 py-3">{Number(execution.actual_value).toLocaleString()}</td><td className="px-4 py-3 font-bold text-amber-300">{execution.reward_amount ? `${Number(execution.reward_amount).toFixed(2)} ${execution.reward_currency}` : '—'}</td><td className="px-4 py-3"><span className={`rounded-md px-2 py-1 font-bold ${execution.status === 'succeeded' ? 'bg-emerald-500/10 text-emerald-300' : execution.status === 'failed' ? 'bg-red-500/10 text-red-300' : 'bg-blue-500/10 text-blue-300'}`}>{execution.status === 'succeeded' ? '成功' : execution.status === 'failed' ? '失敗' : '處理中'}</span></td><td className="px-5 py-3 text-right text-slate-500">{new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(execution.executed_at))}</td></tr>
                    ))}
                  </tbody>
                </table>
                {dashboard.executions.length === 0 && (
                  <div className="flex min-h-[280px] flex-1 flex-col items-center justify-center px-6 py-10 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-blue-400/20 bg-gradient-to-br from-blue-500/15 to-cyan-500/10 text-cyan-300 shadow-lg shadow-blue-950/30 ring-1 ring-inset ring-white/[0.04]">
                      <History className="h-6 w-6" />
                    </div>
                    <p className="mt-3 text-sm font-black text-slate-200">尚無執行記錄</p>
                    <p className="mt-1 text-xs text-slate-500">任務成功觸發後，執行資料會顯示在這裡</p>
                  </div>
                )}
              </div>
            </div>
          )}
          </>
          </div>
          </div>
        </div>
      </div>
    </div>
    {isSuperAdmin && adminMenuOpen && createPortal(
      <div className="fixed inset-0 z-[100]" onMouseDown={() => setAdminMenuOpen(false)}>
        <div
          role="listbox"
          aria-label="管理員分組"
          className="fixed overflow-hidden rounded-xl border border-sky-300/40 bg-[linear-gradient(145deg,rgba(30,58,90,0.98),rgba(15,31,55,0.99))] p-1 shadow-[0_18px_50px_rgba(2,8,23,0.78),0_0_28px_rgba(14,165,233,0.16)] ring-1 ring-inset ring-sky-100/[0.08] backdrop-blur-xl before:absolute before:inset-x-3 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-sky-200/90 before:to-transparent"
          style={{ top: adminMenuPosition.top, left: adminMenuPosition.left, width: adminMenuPosition.width }}
          onMouseDown={event => event.stopPropagation()}
        >
          <div className="relative max-h-48 overflow-y-auto py-0.5 [scrollbar-color:rgba(125,211,252,0.65)_rgba(15,23,42,0.35)] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-sky-300/60 [&::-webkit-scrollbar-track]:bg-slate-950/30 [&::-webkit-scrollbar]:w-1.5">
            {dashboard.admin_groups.map(group => {
              const selected = selectedAdminId === group.id;
              const current = group.id === admin.id;
              return (
                <button key={group.id} type="button" role="option" aria-selected={selected} onClick={() => selectAdminGroup(group.id)} className={`group mt-0.5 flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-all duration-150 ${selected ? 'border-sky-300/25 bg-gradient-to-r from-sky-500/25 via-blue-500/15 to-indigo-500/10 text-white shadow-inner ring-1 ring-inset ring-sky-300/30' : 'border-transparent bg-slate-950/10 text-slate-300 hover:border-white/15 hover:bg-gradient-to-r hover:from-slate-600/45 hover:to-slate-700/35 hover:text-white hover:shadow-[0_4px_12px_rgba(2,8,23,0.22)]'}`}>
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-black uppercase transition-all duration-150 ${selected ? 'bg-gradient-to-br from-sky-300 to-blue-500 text-blue-950 shadow-sm shadow-sky-950/40' : 'border border-slate-700 bg-slate-800/90 text-sky-300 group-hover:border-slate-400/50 group-hover:bg-slate-600 group-hover:text-white'}`}>{group.username.slice(0, 1)}</span>
                  <span className="min-w-0 flex-1 truncate text-[11px] font-black">{group.username}</span>
                  {current && <span className="rounded-full border border-amber-300/25 bg-amber-400/10 px-1.5 py-0.5 text-[8px] font-black text-amber-200">目前</span>}
                  {selected && <CheckCircle2 className="h-4 w-4 shrink-0 text-sky-300" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>,
      document.body,
    )}
    </>
  );
}
