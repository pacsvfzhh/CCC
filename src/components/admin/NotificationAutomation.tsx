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
  FileText,
  Gift,
  History,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { getAdminFinancialSessionToken } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { sanitizeHTML } from '../../lib/sanitizeHTML';
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

type TriggerType = 'total_orders' | 'daily_orders' | 'work_days' | 'commission_amount' | 'consecutive_work_days' | 'annual_date';
type TriggerMode = 'reach_once' | 'recurring';
type TaskStatus = 'draft' | 'active' | 'paused' | 'archived';

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
  description: string;
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
  endsAt: string;
}

interface Props {
  admin: AdminIdentity;
  employees: AutomationEmployee[];
  onBack: () => void;
}

type AutomationNoticeType = 'success' | 'error' | 'info';

interface AutomationNotice {
  type: AutomationNoticeType;
  message: string;
}

const triggerLabels: Record<TriggerType, string> = {
  total_orders: '累計完成訂單數',
  daily_orders: '當天完成訂單數',
  work_days: '累計工作天數',
  commission_amount: '累計佣金金額',
  consecutive_work_days: '連續工作達標',
  annual_date: '每年指定日期',
};

const statusLabels: Record<TaskStatus, string> = {
  draft: '草稿',
  active: '已啟用',
  paused: '已暫停',
  archived: '已結束',
};

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
    description: '',
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
    endsAt: '',
  };
}

function taskToForm(task: AutomationTask): TaskForm {
  return {
    id: task.id,
    name: task.name,
    description: task.description || '',
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
    endsAt: task.ends_at ? task.ends_at.slice(0, 16) : '',
  };
}

function isSameTemplateCopy(existing: AutomationTask, source: AutomationTask) {
  if (existing.id === source.id) return true;

  return existing.source_task_id === source.id
    && existing.name === source.name
    && existing.description === source.description
    && existing.trigger_type === source.trigger_type
    && existing.trigger_mode === source.trigger_mode
    && Number(existing.threshold_value) === Number(source.threshold_value)
    && existing.minimum_daily_orders === source.minimum_daily_orders
    && existing.minimum_daily_work_minutes === source.minimum_daily_work_minutes
    && existing.recipient_scope === 'all_managed'
    && existing.title_template === source.title_template
    && existing.content_template === source.content_template
    && existing.message_type === source.message_type
    && existing.priority === source.priority
    && existing.reward_enabled === source.reward_enabled
    && existing.reward_amount === source.reward_amount
    && existing.starts_at === source.starts_at
    && existing.ends_at === source.ends_at;
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
        content: `<p>Congratulations, {{employee_name}}! You have completed {{threshold_value}} working days.${reward} Your consistency and dedication are greatly appreciated.</p>`,
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
  if (task.trigger_type === 'consecutive_work_days') {
    return `${task.trigger_mode === 'recurring' ? '每連續' : '連續'} ${value} 天，且每天至少完成 ${task.minimum_daily_orders || 0} 筆訂單`;
  }
  if (task.trigger_type === 'daily_orders') {
    return `每天${mode} ${value} 筆成功或失敗訂單`;
  }
  if (task.trigger_type === 'work_days') {
    return `${mode} ${value} 個有效工作日`;
  }
  if (task.trigger_type === 'commission_amount') {
    return `${mode} ${value} 佣金`;
  }
  return `${mode} ${value} 筆成功或失敗訂單`;
}

export default function NotificationAutomation({ admin, employees, onBack }: Props) {
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
  const [templateCustomized, setTemplateCustomized] = useState(false);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<AutomationTask | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [selectedAdminId, setSelectedAdminId] = useState(admin.id);
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const [adminMenuPosition, setAdminMenuPosition] = useState({ top: 0, left: 0, width: 244 });
  const [notice, setNotice] = useState<AutomationNotice | null>(null);
  const adminMenuAnchorRef = useRef<HTMLDivElement>(null);
  const loadRef = useRef<(() => Promise<void>) | null>(null);
  const dashboardRequestIdRef = useRef(0);

  const showNotice = (type: AutomationNoticeType, message: string) => {
    setNotice({ type, message });
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
    () => [...dashboard.shared_templates].sort(compareAutomationTasks),
    [dashboard.shared_templates],
  );

  const openNewTask = () => {
    const next = createDefaultForm();
    next.isSharedTemplate = isSuperAdmin;
    const template = buildEnglishTemplate(next.triggerType, next.rewardEnabled, next.rewardAmount);
    next.titleTemplate = template.title;
    next.contentTemplate = template.content;
    setForm(next);
    setCopiedFromName(null);
    setTemplateCustomized(false);
    setReadOnly(false);
    setEditorOpen(true);
  };

  const openTask = (task: AutomationTask, onlyView = false) => {
    setForm(taskToForm(task));
    setCopiedFromName(null);
    setTemplateCustomized(true);
    setReadOnly(onlyView || task.owner_admin_id !== admin.id);
    setEditorOpen(true);
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

    const saveSharedTemplate = isSuperAdmin && form.isSharedTemplate;

    setSaving(true);
    try {
      const { error } = await supabase.rpc('save_notification_automation_task', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_task_id: form.id,
        p_name: form.name.trim(),
        p_description: form.description.trim(),
        p_trigger_type: form.triggerType,
        p_trigger_mode: form.triggerMode,
        p_threshold_value: Number(form.thresholdValue),
        p_minimum_daily_orders: form.triggerType === 'consecutive_work_days' ? Number(form.minimumDailyOrders) : null,
        p_minimum_daily_work_minutes: form.minimumDailyWorkMinutes ? Number(form.minimumDailyWorkMinutes) : null,
        p_recipient_scope: form.recipientScope,
        p_recipient_ids: form.recipientScope === 'selected' ? form.recipientIds : [],
        p_title_template: form.titleTemplate.trim(),
        p_content_template: form.contentTemplate.trim(),
        p_message_type: form.messageType,
        p_priority: form.priority,
        p_reward_enabled: form.rewardEnabled,
        p_reward_amount: form.rewardEnabled ? Number(form.rewardAmount) : null,
        p_is_shared_template: form.id ? form.isSharedTemplate : isSuperAdmin,
        p_starts_at: form.startsAt ? new Date(form.startsAt).toISOString() : null,
        p_ends_at: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      });
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
      setCopiedFromName(null);
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
      showNotice('success', status === 'active' ? '任務已啟用，現有進度已設為基準' : status === 'paused' ? '任務已暫停' : '任務狀態已更新');
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
    if (activate && dashboard.tasks.some(existing => isSameTemplateCopy(existing, task))) {
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
      if (activate && result?.duplicate) {
        showNotice('info', '這個管理員範本已經添加到本組任務，不可重複添加。若要建立不同版本，請使用「複製自訂」並修改內容。');
        return;
      }
      if (!result?.task_id) throw new Error('Template copy did not return a task id.');

      const nextAdminId = isSuperAdmin ? admin.id : selectedAdminId;
      setSelectedAdminId(nextAdminId);

      if (activate) {
        const { error: activateError } = await supabase.rpc('set_notification_automation_task_status', {
          p_admin_session_token: getAdminFinancialSessionToken(),
          p_task_id: result.task_id,
          p_status: 'active',
        });
        if (activateError) throw activateError;
        showNotice('success', '已直接套用管理員範本，任務只會作用於你的員工');
        setSelectedTemplateIds(new Set());
        setView('tasks');
      } else {
        const copiedTask: AutomationTask = {
          ...task,
          id: result.task_id,
          owner_admin_id: admin.id,
          owner_username: admin.username,
          source_task_id: task.id,
          source_version: task.version,
          status: 'draft',
          is_shared_template: false,
          execution_count: 0,
          total_rewards: 0,
          updated_at: new Date().toISOString(),
        };
        setForm({ ...taskToForm(copiedTask), name: '' });
        setCopiedFromName(task.name);
        setTemplateCustomized(true);
        setReadOnly(false);
        setView('templates');
        setEditorOpen(true);
      }

      setRefreshing(true);
      await loadDashboard(nextAdminId);
    } catch {
      showNotice('error', '無法套用管理員範本，請重新選擇後再試。');
    }
  };

  const applySelectedTemplates = async (templates: AutomationTask[]) => {
    const duplicateTemplates = templates.filter(template =>
      dashboard.tasks.some(existing => isSameTemplateCopy(existing, template)),
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
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[150] flex justify-center px-4 sm:justify-end" role={notice.type === 'error' ? 'alert' : 'status'}>
      <div className={`pointer-events-auto flex w-full max-w-md items-start gap-3 overflow-hidden rounded-2xl border p-3.5 shadow-2xl backdrop-blur-xl ${
        notice.type === 'success'
          ? 'border-emerald-300/35 bg-gradient-to-r from-emerald-950/95 to-teal-950/95 text-emerald-50 shadow-emerald-950/50'
          : notice.type === 'error'
            ? 'border-red-300/35 bg-gradient-to-r from-red-950/95 to-rose-950/95 text-red-50 shadow-red-950/50'
            : 'border-amber-300/35 bg-gradient-to-r from-amber-950/95 to-slate-950/95 text-amber-50 shadow-amber-950/50'
      }`}>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
          notice.type === 'success'
            ? 'border-emerald-300/25 bg-emerald-400/15 text-emerald-300'
            : notice.type === 'error'
              ? 'border-red-300/25 bg-red-400/15 text-red-300'
              : 'border-amber-300/25 bg-amber-400/15 text-amber-300'
        }`}>
          {notice.type === 'success' ? <CheckCircle2 className="h-5 w-5" /> : notice.type === 'error' ? <AlertCircle className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-xs font-black tracking-wide">{notice.type === 'success' ? '操作成功' : notice.type === 'error' ? '操作未完成' : '操作提示'}</p>
          <p className="mt-1 text-xs font-medium leading-5 opacity-80">{notice.message}</p>
        </div>
        <button type="button" onClick={() => setNotice(null)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/55 transition-colors hover:bg-white/10 hover:text-white" aria-label="關閉提示">
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
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-950 text-slate-100">
        {noticeCard}
        <div className="relative z-10 flex shrink-0 flex-wrap items-center justify-between gap-3 overflow-hidden border-b border-cyan-400/20 bg-gradient-to-r from-slate-950 via-slate-900 to-cyan-950/70 px-4 py-3.5 shadow-lg shadow-slate-950/30 sm:px-5">
          <div className="flex items-center gap-3">
            <button onClick={() => { setCopiedFromName(null); setEditorOpen(false); }} className="flex h-9 w-9 items-center justify-center rounded-xl border border-red-400/40 bg-red-500/15 text-red-300 shadow-sm transition-all duration-200 hover:border-red-300/70 hover:bg-red-500/30 hover:text-red-100 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h2 className="text-base font-black tracking-tight text-white sm:text-lg">{readOnly ? '查看管理員範本' : form.id ? '編輯自動化任務' : '新增自動化任務'}</h2>
              <p className="mt-0.5 text-xs font-medium text-slate-400">通知內容使用英文，管理介面使用繁體中文</p>
            </div>
          </div>
          {copiedFromName && (
            <div className="flex min-w-0 items-center gap-2 rounded-xl border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-100 shadow-inner">
              <Copy className="h-3.5 w-3.5 shrink-0 text-amber-300" />
              <span className="shrink-0 font-semibold text-amber-200/80">原任務名稱</span>
              <span className="max-w-[220px] truncate font-black text-white" title={copiedFromName}>{copiedFromName}</span>
              <span className="hidden text-amber-200/70 sm:inline">請重新設定名稱後儲存</span>
            </div>
          )}
          {!readOnly && (
            <button disabled={saving} onClick={saveTask} className="inline-flex h-9 items-center gap-2 rounded-xl border border-cyan-300/30 bg-gradient-to-r from-cyan-400 via-cyan-500 to-blue-600 px-4 text-sm font-black text-white shadow-lg shadow-cyan-950/50 transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 hover:shadow-cyan-500/20 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:brightness-100">
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {isSuperAdmin && form.isSharedTemplate ? '儲存管理員範本' : '儲存為草稿'}
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden bg-slate-900">
          <div className="grid h-full w-full items-start overflow-y-auto bg-slate-900 xl:grid-cols-[minmax(0,1fr)_400px]">
            <div className="min-w-0 px-4 sm:px-5 xl:border-r xl:border-slate-700/70">
              <section className="border-b border-slate-700/60 py-4">
                <div className="mb-3 flex items-center gap-2.5 border-l-2 border-cyan-400 pl-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400/20 to-blue-500/10 text-cyan-300 ring-1 ring-cyan-400/20"><Settings2 className="h-4 w-4" /></div>
                  <h3 className="font-black tracking-tight text-white">基本設定</h3>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="sm:col-span-2">
                    <span className="mb-1.5 block text-xs font-semibold text-slate-400">任務名稱</span>
                    <input disabled={readOnly} value={form.name} onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-all duration-200 placeholder:text-slate-400 hover:border-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/25 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:hover:border-slate-300" placeholder={copiedFromName ? '請輸入新的任務名稱' : '例如：100 筆訂單鼓勵通知'} />
                  </label>
                  <label className="sm:col-span-2">
                    <span className="mb-1.5 block text-xs font-semibold text-slate-400">任務說明</span>
                    <input disabled={readOnly} value={form.description} onChange={event => setForm(previous => ({ ...previous, description: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-all duration-200 placeholder:text-slate-400 hover:border-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/25 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:hover:border-slate-300" placeholder="供管理員查看的內部說明" />
                  </label>
                  <label className="sm:col-span-2">
                    <span className="mb-1.5 block text-xs font-semibold text-slate-400">結束時間（選填）</span>
                    <input disabled={readOnly} type="datetime-local" value={form.endsAt} onChange={event => setForm(previous => ({ ...previous, endsAt: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-all duration-200 placeholder:text-slate-400 hover:border-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/25 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:hover:border-slate-300" />
                  </label>
                </div>
              </section>

              <section className="border-b border-slate-700/60 py-4">
                <div className="mb-3 flex items-center gap-2.5 border-l-2 border-cyan-400 pl-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400/20 to-blue-500/10 text-cyan-300 ring-1 ring-cyan-400/20"><Target className="h-4 w-4" /></div>
                  <h3 className="font-black tracking-tight text-white">觸發條件</h3>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label>
                    <span className="mb-1.5 block text-xs font-semibold text-slate-400">條件類型</span>
                    <select disabled={readOnly} value={form.triggerType} onChange={event => { setTemplateCustomized(false); setForm(previous => ({ ...previous, triggerType: event.target.value as TriggerType })); }} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-all duration-200 placeholder:text-slate-400 hover:border-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/25 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:hover:border-slate-300">
                      {Object.entries(triggerLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  {form.triggerType !== 'annual_date' ? (
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
                  ) : (
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
                      <div className="sm:col-span-2 rounded-xl border border-violet-500/20 bg-violet-500/10 p-3 text-xs leading-relaxed text-violet-100/80">
                        系統依 UTC 伺服器日期自動判斷，每年到達所選月日只執行一次，不依賴管理員或員工瀏覽器保持開啟。
                      </div>
                    </>
                  )}
                  {form.triggerType === 'consecutive_work_days' && (
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
                <div className="mt-4 rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-sm text-cyan-100">
                  {summarizeTask({ trigger_type: form.triggerType, trigger_mode: form.triggerType === 'annual_date' ? 'reach_once' : form.triggerMode, threshold_value: Number(form.thresholdValue || 0), minimum_daily_orders: Number(form.minimumDailyOrders || 0), annual_month: Number(form.annualMonth || 1), annual_day: Number(form.annualDay || 1) } as AutomationTask, dashboard.currency)}
                </div>
              </section>

              <section className="border-b border-slate-700/60 py-4">
                <label className={`flex cursor-pointer items-center justify-between gap-4 rounded-xl border px-3 py-3 transition-all duration-200 ${form.rewardEnabled ? 'border-amber-400/20 bg-gradient-to-r from-amber-500/10 to-transparent' : 'border-slate-700/60 bg-gradient-to-r from-slate-800/50 to-transparent hover:border-slate-600'}`}>
                  <div className="flex items-center gap-3">
                    <div className={`flex h-11 w-11 items-center justify-center rounded-xl ring-1 transition-all duration-200 ${form.rewardEnabled ? 'bg-gradient-to-br from-amber-300 to-amber-500 text-amber-950 shadow-lg shadow-amber-900/40 ring-amber-200/30' : 'bg-slate-800 text-slate-500 ring-slate-700'}`}>
                      <Gift className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className={form.rewardEnabled ? 'font-bold text-amber-100' : 'font-bold text-white'}>發放績效獎金</h3>
                      <p className="text-xs text-slate-500">不勾選時只發送一般通知，不會修改錢包</p>
                    </div>
                  </div>
                  <input disabled={readOnly} type="checkbox" checked={form.rewardEnabled} onChange={event => { setTemplateCustomized(false); setForm(previous => ({ ...previous, rewardEnabled: event.target.checked })); }} className="h-5 w-5 rounded bg-white accent-amber-400 shadow-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:opacity-60" />
                </label>
                {form.rewardEnabled && (
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <label>
                      <span className="mb-1.5 block text-xs font-semibold text-amber-200/70">每次獎金</span>
                      <input disabled={readOnly} type="number" min="0.01" step="0.01" value={form.rewardAmount} onChange={event => setForm(previous => ({ ...previous, rewardAmount: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-900 shadow-sm outline-none transition-all duration-200 hover:border-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/25 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:hover:border-slate-300" />
                    </label>
                    <div>
                      <span className="mb-1.5 block text-xs font-semibold text-amber-200/70">網站計量貨幣</span>
                      <div className="flex h-[42px] items-center rounded-xl border border-amber-500/20 bg-amber-400/10 px-3 font-black text-amber-200">{dashboard.currency}</div>
                    </div>
                    <div className="sm:col-span-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-100/80">
                      達標後獎金會立即寫入員工錢包、資金流水及 Daily Breakdown 的 Tips，不需要員工點擊通知領取。
                    </div>
                  </div>
                )}
              </section>

              <section className="border-b border-slate-700/60 py-4">
                <div className="mb-3 flex items-center gap-2.5 border-l-2 border-cyan-400 pl-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400/20 to-blue-500/10 text-cyan-300 ring-1 ring-cyan-400/20"><Users className="h-4 w-4" /></div>
                  <h3 className="font-black tracking-tight text-white">適用員工</h3>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(['all_managed', 'selected'] as const).map(scope => (
                    <button key={scope} disabled={readOnly} onClick={() => setForm(previous => ({ ...previous, recipientScope: scope }))} className={`rounded-xl border p-3 text-left transition-all duration-200 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 ${form.recipientScope === scope ? 'border-cyan-400 bg-gradient-to-br from-cyan-500/15 to-blue-500/5 text-cyan-100 shadow-md shadow-cyan-950/30' : 'border-slate-700 bg-slate-950/80 text-slate-400 hover:border-slate-600 hover:bg-slate-800/70 hover:text-slate-200'} disabled:cursor-not-allowed disabled:opacity-60`}>
                      <p className="text-sm font-bold">{scope === 'all_managed' ? '全部可管理員工' : '指定員工'}</p>
                      <p className="mt-1 text-xs opacity-60">{scope === 'all_managed' ? '自動包含你權限範圍內的員工' : '只對下方勾選的員工生效'}</p>
                    </button>
                  ))}
                </div>
                {form.recipientScope === 'selected' && (
                  <div className="mt-3 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-300 bg-slate-50 p-2">
                    {employees.map(employee => (
                      <label key={employee.id} className="flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 transition-all duration-200 hover:bg-white hover:shadow-sm">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{employee.username}</p>
                          <p className="text-[11px] text-slate-500">{employee.employee_id}</p>
                        </div>
                        <input disabled={readOnly} type="checkbox" checked={form.recipientIds.includes(employee.id)} onChange={event => setForm(previous => ({ ...previous, recipientIds: event.target.checked ? [...previous.recipientIds, employee.id] : previous.recipientIds.filter(id => id !== employee.id) }))} className="h-4 w-4 rounded bg-white accent-cyan-500 shadow-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:opacity-60" />
                      </label>
                    ))}
                  </div>
                )}
              </section>

              <section className="border-b border-slate-700/60 py-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 border-l-2 border-cyan-400 pl-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400/20 to-blue-500/10 text-cyan-300 ring-1 ring-cyan-400/20"><FileText className="h-4 w-4" /></div>
                    <div>
                      <h3 className="font-black tracking-tight text-white">英文通知內容</h3>
                      <p className="text-xs text-slate-500">可以直接修改，動態變數會在發送時替換</p>
                    </div>
                  </div>
                  {!readOnly && <button onClick={regenerateTemplate} className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-bold text-cyan-200 transition-all duration-200 hover:border-cyan-300/50 hover:bg-cyan-500/20 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70">重新產生內容</button>}
                </div>
                <div className="space-y-4">
                  <label>
                    <span className="mb-1.5 block text-xs font-semibold text-slate-400">通知標題</span>
                    <input disabled={readOnly} value={form.titleTemplate} onChange={event => { setTemplateCustomized(true); setForm(previous => ({ ...previous, titleTemplate: event.target.value })); }} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-all duration-200 placeholder:text-slate-400 hover:border-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/25 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:hover:border-slate-300" />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-xs font-semibold text-slate-400">通知內容</span>
                    <textarea disabled={readOnly} rows={6} value={form.contentTemplate} onChange={event => { setTemplateCustomized(true); setForm(previous => ({ ...previous, contentTemplate: event.target.value })); }} className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed text-slate-900 shadow-sm outline-none transition-all duration-200 hover:border-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/25 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:hover:border-slate-300" />
                  </label>
                  <p className="text-[11px] text-slate-500">可用變數：{'{{employee_name}}'}、{'{{threshold_value}}'}、{'{{actual_value}}'}、{'{{minimum_daily_orders}}'}、{'{{annual_month}}'}、{'{{annual_day}}'}、{'{{bonus_amount}}'}、{'{{currency}}'}</p>
                </div>
              </section>
            </div>

            <aside className="border-t border-slate-700/70 p-4 xl:sticky xl:top-0 xl:self-start xl:border-t-0">
              <div className={`overflow-hidden rounded-xl border shadow-xl ${form.rewardEnabled ? 'border-amber-400/30 bg-gradient-to-b from-amber-950 via-slate-900 to-slate-950 shadow-amber-950/40' : 'border-cyan-500/20 bg-gradient-to-b from-cyan-950 via-slate-900 to-slate-950 shadow-cyan-950/40'}`}>
                <div className={`p-4 ${form.rewardEnabled ? 'bg-gradient-to-br from-amber-400/20 to-orange-500/5' : 'bg-gradient-to-br from-cyan-400/15 to-blue-500/5'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${form.rewardEnabled ? 'bg-amber-400 text-amber-950' : 'bg-cyan-500 text-white'}`}>
                        {form.rewardEnabled ? <Gift className="h-6 w-6" /> : <Bell className="h-6 w-6" />}
                      </div>
                      <div>
                        <span className={`text-[10px] font-black uppercase tracking-[0.18em] ${form.rewardEnabled ? 'text-amber-300' : 'text-cyan-300'}`}>{form.rewardEnabled ? 'Performance Reward' : 'Achievement Notice'}</span>
                        <p className="mt-1 text-xs text-slate-400">員工端通知預覽</p>
                      </div>
                    </div>
                    <ShieldCheck className="h-5 w-5 text-emerald-400" />
                  </div>
                  {form.rewardEnabled && (
                    <div className="mt-6 rounded-2xl border border-amber-300/20 bg-amber-400/10 p-4 text-center">
                      <p className="text-xs font-semibold uppercase tracking-widest text-amber-300/70">Credited to Your Wallet</p>
                      <p className="mt-1 text-3xl font-black text-amber-200">+{Number(form.rewardAmount || 0).toFixed(2)} <span className="text-lg">{dashboard.currency}</span></p>
                    </div>
                  )}
                </div>
                <div className="space-y-3 p-4">
                  <h3 className="text-xl font-bold leading-snug text-white">{previewTitle || 'Notification title'}</h3>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-sm leading-7 text-slate-300" dangerouslySetInnerHTML={{ __html: sanitizeHTML(previewContent) }} />
                  <div className="rounded-xl border border-slate-700/70 bg-slate-950/60 p-3">
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Trigger condition</p>
                    <p className="mt-1 text-sm font-semibold text-slate-200">{summarizeTask({ trigger_type: form.triggerType, trigger_mode: form.triggerType === 'annual_date' ? 'reach_once' : form.triggerMode, threshold_value: Number(form.thresholdValue || 0), minimum_daily_orders: Number(form.minimumDailyOrders || 0), annual_month: Number(form.annualMonth || 1), annual_day: Number(form.annualDay || 1) } as AutomationTask, dashboard.currency)}</p>
                  </div>
                  {form.rewardEnabled && (
                    <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
                      <Wallet className="h-5 w-5 text-emerald-400" />
                      <div>
                        <p className="text-xs font-bold text-emerald-200">Performance Bonus / 業績獎金</p>
                        <p className="text-[11px] text-emerald-300/60">Wallet and Daily Statistics updated automatically</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    );
  }

  const selectedTemplates = orderedSharedTemplates.filter(task => selectedTemplateIds.has(task.id));
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
              <div className="space-y-2 p-2 sm:p-3">
                {orderedTasks.map(task => (
                  <article key={task.id} className={`group relative grid gap-3 overflow-hidden rounded-xl border border-l-4 px-3 py-2.5 transition-all duration-200 hover:-translate-y-px hover:shadow-xl lg:grid-cols-[minmax(210px,1fr)_minmax(420px,1.8fr)_auto] lg:items-center ${task.status === 'active' ? 'border-emerald-300/20 border-l-emerald-400 bg-gradient-to-br from-emerald-950/45 via-slate-900 to-slate-950 shadow-lg shadow-emerald-950/20 hover:border-emerald-200/35' : task.status === 'paused' ? 'border-amber-300/20 border-l-amber-400 bg-gradient-to-br from-amber-950/35 via-slate-900 to-slate-950 shadow-lg shadow-amber-950/15 hover:border-amber-200/35' : task.status === 'archived' ? 'border-slate-600/60 border-l-slate-500 bg-slate-900/80 hover:border-slate-500' : task.is_shared_template ? 'border-violet-300/20 border-l-violet-400 bg-gradient-to-br from-violet-950/35 via-slate-900 to-slate-950 shadow-lg shadow-violet-950/15 hover:border-violet-200/35' : 'border-cyan-300/20 border-l-cyan-400 bg-gradient-to-br from-cyan-950/30 via-slate-900 to-slate-950 shadow-lg shadow-cyan-950/15 hover:border-cyan-200/35'}`}>
                    <div className="min-w-0">
                      <div className="flex items-start gap-2">
                        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${task.status === 'active' ? 'border-emerald-300/25 bg-emerald-400/15 text-emerald-300' : task.status === 'paused' ? 'border-amber-300/25 bg-amber-400/15 text-amber-300' : task.is_shared_template ? 'border-violet-300/25 bg-violet-400/15 text-violet-300' : 'border-cyan-300/25 bg-cyan-400/15 text-cyan-300'}`}>
                          {task.reward_enabled ? <Gift className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-sm font-black text-white">{task.name}</h3>
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black tracking-wide ${task.status === 'active' ? 'border-emerald-300/25 bg-emerald-400/15 text-emerald-200' : task.status === 'paused' ? 'border-amber-300/25 bg-amber-400/15 text-amber-200' : task.status === 'archived' ? 'border-slate-500/50 bg-slate-700/70 text-slate-300' : 'border-cyan-300/20 bg-cyan-400/10 text-cyan-200'}`}>{statusLabels[task.status]}</span>
                            {task.reward_enabled && <span className="rounded-full border border-amber-300/25 bg-amber-400/10 px-2 py-0.5 text-[10px] font-black text-amber-200">獎勵</span>}
                          </div>
                          <p className="mt-0.5 text-[10px] text-slate-400">{task.owner_username} · V{task.version}{task.is_shared_template ? ' · 共享範本' : ''}{task.source_task_id ? ' · 由範本複製' : ''}</p>
                        </div>
                      </div>
                    </div>
                    <div className="min-w-0 overflow-hidden rounded-lg border border-slate-600/60 bg-slate-950/45 px-2 py-1.5 sm:grid sm:grid-cols-[3fr_1fr_0.7fr_0.5fr] sm:divide-x sm:divide-slate-700/70">
                      <div className="min-w-0 px-2 sm:col-span-1">
                        <p className="text-[9px] font-black tracking-wider text-cyan-300/80">{triggerLabels[task.trigger_type]}</p>
                        <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-200" title={summarizeTask(task, dashboard.currency)}>{summarizeTask(task, dashboard.currency)}</p>
                      </div>
                      <div className="min-w-0 px-2">
                        <p className="text-[9px] font-black tracking-wider text-blue-200/65">適用範圍</p>
                        <p className="mt-0.5 truncate text-[11px] font-bold text-blue-100">{task.recipient_scope === 'selected' ? `指定 ${task.recipient_ids?.length || 0} 人` : '全部可管理員工'}</p>
                      </div>
                      <div className="min-w-0 px-2">
                        <p className="text-[9px] font-black tracking-wider text-violet-200/65">執行次數</p>
                        <p className="mt-0.5 text-sm font-black tabular-nums text-violet-100">{task.execution_count || 0}</p>
                      </div>
                      <div className="min-w-0 px-2">
                        <p className="text-[9px] font-black tracking-wider text-amber-200/65">每次獎金</p>
                        <p className="mt-0.5 truncate text-[11px] font-black text-amber-100">{task.reward_enabled ? `${Number(task.reward_amount || 0).toFixed(2)} ${dashboard.currency}` : '無'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 lg:justify-end">
                      <button onClick={() => setDeleteTarget(task)} className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 text-xs font-bold text-rose-300 transition-all duration-200 hover:border-rose-300/50 hover:bg-rose-500/20 hover:text-rose-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/70" aria-label={`刪除任務 ${task.name}`}><Trash2 className="h-3.5 w-3.5" />刪除</button>
                      <button onClick={() => openTask(task)} className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 text-xs font-bold text-cyan-200 transition-all duration-200 hover:border-cyan-300/50 hover:bg-cyan-500/20 hover:text-cyan-100 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"><Edit3 className="h-3.5 w-3.5" />編輯</button>
                      {task.status !== 'active' ? (
                        <button onClick={() => changeStatus(task, 'active')} className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-emerald-400/25 bg-emerald-500/15 px-3 text-xs font-bold text-emerald-300 transition-all duration-200 hover:border-emerald-300/40 hover:bg-emerald-500/25 hover:text-emerald-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"><Play className="h-3.5 w-3.5" />啟用</button>
                      ) : (
                        <button onClick={() => changeStatus(task, 'paused')} className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-amber-400/25 bg-amber-500/15 px-3 text-xs font-bold text-amber-300 transition-all duration-200 hover:border-amber-300/40 hover:bg-amber-500/25 hover:text-amber-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70"><Pause className="h-3.5 w-3.5" />暫停</button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )
          )}

          {view === 'templates' && (
            dashboard.shared_templates.length === 0 ? (
              <div className="relative flex h-full min-h-[280px] flex-col items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_center,rgba(139,92,246,0.10),transparent_42%)] px-6 py-16 text-center before:absolute before:inset-0 before:bg-[linear-gradient(rgba(148,163,184,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.025)_1px,transparent_1px)] before:bg-[size:28px_28px]"><div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-500/20 to-fuchsia-500/10 text-violet-300 shadow-xl shadow-violet-950/40"><Copy className="h-8 w-8" /></div><p className="mt-4 font-bold text-slate-300">目前沒有可用的管理員範本</p><p className="mt-1 text-sm text-slate-500">管理員發佈共享範本後，可在這裡勾選並直接套用。</p></div>
            ) : (
              <div className="space-y-2 p-2 sm:p-3">
                {orderedSharedTemplates.map(task => {
                  const selected = selectedTemplateIds.has(task.id);
                  const alreadyAdded = dashboard.tasks.some(existing => isSameTemplateCopy(existing, task));
                  return (
                    <article key={task.id} className={`group relative grid gap-3 overflow-hidden rounded-xl border border-l-4 px-3 py-2.5 transition-all duration-200 hover:-translate-y-px hover:shadow-xl lg:grid-cols-[auto_minmax(210px,1fr)_minmax(420px,1.8fr)_auto] lg:items-center ${selected ? 'border-violet-200/40 border-l-violet-300 bg-gradient-to-br from-violet-500/20 via-violet-950/30 to-slate-950 shadow-lg shadow-violet-950/25' : alreadyAdded ? 'border-rose-300/25 border-l-rose-400 bg-gradient-to-br from-rose-950/35 via-slate-900 to-slate-950 shadow-lg shadow-rose-950/15 hover:border-rose-200/40' : task.status === 'active' ? 'border-emerald-300/20 border-l-emerald-400 bg-gradient-to-br from-emerald-950/35 via-slate-900 to-slate-950 shadow-lg shadow-emerald-950/15 hover:border-emerald-200/35' : task.status === 'paused' ? 'border-amber-300/20 border-l-amber-400 bg-gradient-to-br from-amber-950/30 via-slate-900 to-slate-950 shadow-lg shadow-amber-950/15 hover:border-amber-200/35' : 'border-violet-300/20 border-l-violet-500 bg-gradient-to-br from-violet-950/30 via-slate-900 to-slate-950 shadow-lg shadow-violet-950/15 hover:border-violet-200/35'}`}>
                      <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-violet-100">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={event => setSelectedTemplateIds(previous => {
                            const next = new Set(previous);
                            if (event.target.checked) next.add(task.id);
                            else next.delete(task.id);
                            return next;
                          })}
                          className="peer sr-only"
                        />
                        <span className="flex h-5 w-5 items-center justify-center rounded-md border border-violet-300/35 bg-slate-950/70 text-transparent shadow-inner transition-all duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-violet-300/70 peer-checked:border-violet-200 peer-checked:bg-violet-500 peer-checked:text-white peer-checked:shadow-violet-950/40">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </span>
                        <span className="hidden sm:inline">{selected ? '已選取' : '選取'}</span>
                        {alreadyAdded && <span className="rounded-full border border-rose-300/30 bg-rose-400/10 px-2 py-0.5 text-[9px] font-black text-rose-200">已添加</span>}
                      </label>
                      <div className="min-w-0">
                        <div className="flex items-start gap-3">
                          <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${alreadyAdded ? 'border-rose-300/25 bg-rose-400/15 text-rose-300' : task.status === 'active' ? 'border-emerald-300/25 bg-emerald-400/15 text-emerald-300' : task.status === 'paused' ? 'border-amber-300/25 bg-amber-400/15 text-amber-300' : 'border-violet-300/25 bg-violet-400/15 text-violet-300'}`}>
                            {task.reward_enabled ? <Gift className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                          </span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="truncate text-sm font-black text-white">{task.name}</h3>
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black tracking-wide ${task.status === 'active' ? 'border-emerald-300/25 bg-emerald-400/15 text-emerald-200' : task.status === 'paused' ? 'border-amber-300/25 bg-amber-400/15 text-amber-200' : 'border-violet-300/20 bg-violet-400/10 text-violet-200'}`}>{statusLabels[task.status]}</span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-violet-200/70">
                              <span className="inline-flex items-center gap-1 rounded-md border border-violet-400/20 bg-violet-500/10 px-1.5 py-0.5 font-semibold text-violet-100"><ShieldCheck className="h-3 w-3" />範本提供者</span>
                              <span>{task.owner_username} · V{task.version}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="min-w-0 overflow-hidden rounded-lg border border-violet-300/20 bg-slate-950/45 px-2 py-1.5 sm:grid sm:grid-cols-[1.4fr_1fr_1fr] sm:divide-x sm:divide-violet-300/15">
                        <div className="min-w-0 px-2">
                          <p className="text-[9px] font-black tracking-wider text-violet-200/80">{triggerLabels[task.trigger_type]}</p>
                          <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-200" title={summarizeTask(task, dashboard.currency)}>{summarizeTask(task, dashboard.currency)}</p>
                        </div>
                        <div className="min-w-0 px-2">
                          <p className="text-[9px] font-black tracking-wider text-amber-200/65">獎勵</p>
                          <p className="mt-0.5 truncate text-[11px] font-black text-amber-100">{task.reward_enabled ? `${Number(task.reward_amount || 0).toFixed(2)} ${dashboard.currency}` : '一般通知'}</p>
                        </div>
                        <div className="min-w-0 px-2">
                          <p className="text-[9px] font-black tracking-wider text-blue-200/65">適用範圍</p>
                          <p className="mt-0.5 truncate text-[11px] font-bold text-blue-100">{task.recipient_scope === 'selected' ? '指定範圍' : '全部員工'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 lg:justify-end">
                        <button onClick={() => openTask(task, true)} className="flex h-8 items-center justify-center gap-1 rounded-lg border border-violet-400/35 bg-violet-500/10 px-3 text-xs font-bold text-violet-200 transition-all duration-200 hover:border-violet-300/50 hover:bg-violet-500/20 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70">查看<ChevronRight className="h-3.5 w-3.5" /></button>
                        <button onClick={() => copyTemplate(task, false)} className="flex h-8 items-center justify-center gap-1 rounded-lg border border-blue-400/30 bg-blue-500/10 px-3 text-xs font-bold text-blue-200 transition-all duration-200 hover:border-blue-300/50 hover:bg-blue-500/20 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70"><Copy className="h-3.5 w-3.5" />複製自訂</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )
          )}

          {view === 'executions' && (
            <div className="flex h-full min-h-[280px] flex-col bg-slate-900">
              <div className="flex min-h-0 flex-1 flex-col overflow-x-auto">
                <table className="w-full min-w-[850px] text-left text-xs">
                  <thead className="bg-gradient-to-r from-blue-800 via-cyan-800 to-blue-900 text-white shadow-md shadow-blue-950/40"><tr><th className="px-5 py-2 font-black">任務</th><th className="px-4 py-2 font-black">員工</th><th className="px-4 py-2 font-black">階段</th><th className="px-4 py-2 font-black">實際數值</th><th className="px-4 py-2 font-black">獎金</th><th className="px-4 py-2 font-black">狀態</th><th className="px-5 py-2 text-right font-black">執行時間</th></tr></thead>
                  <tbody className="divide-y divide-slate-800">
                    {dashboard.executions.map(execution => (
                      <tr key={execution.id} className="text-slate-300 transition-all duration-200 odd:bg-slate-950/15 hover:bg-slate-800/60"><td className="px-5 py-3 font-semibold text-white">{execution.task_name}</td><td className="px-4 py-3">{execution.employee_username}</td><td className="px-4 py-3">第 {execution.stage} 階段</td><td className="px-4 py-3">{Number(execution.actual_value).toLocaleString()}</td><td className="px-4 py-3 font-bold text-amber-300">{execution.reward_amount ? `${Number(execution.reward_amount).toFixed(2)} ${execution.reward_currency}` : '—'}</td><td className="px-4 py-3"><span className={`rounded-md px-2 py-1 font-bold ${execution.status === 'succeeded' ? 'bg-emerald-500/10 text-emerald-300' : execution.status === 'failed' ? 'bg-red-500/10 text-red-300' : 'bg-blue-500/10 text-blue-300'}`}>{execution.status === 'succeeded' ? '成功' : execution.status === 'failed' ? '失敗' : '處理中'}</span></td><td className="px-5 py-3 text-right text-slate-500">{new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(execution.executed_at))}</td></tr>
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
