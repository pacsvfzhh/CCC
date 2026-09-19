import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
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
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Users,
  Wallet,
} from 'lucide-react';
import { getAdminFinancialSessionToken } from '../../lib/auth';
import { formatSupabaseError, supabase } from '../../lib/supabase';
import { sanitizeHTML } from '../../lib/sanitizeHTML';

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
  notify: (type: 'success' | 'error', message: string) => void;
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

export default function NotificationAutomation({ admin, employees, onBack, notify }: Props) {
  const isSuperAdmin = admin.role === 'super_admin' || Boolean(admin.is_super_admin);
  const [dashboard, setDashboard] = useState<AutomationDashboard>({ currency: 'USDC', admin_groups: [], tasks: [], shared_templates: [], executions: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<'tasks' | 'templates' | 'executions'>('tasks');
  const [editorOpen, setEditorOpen] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [form, setForm] = useState<TaskForm>(createDefaultForm());
  const [templateCustomized, setTemplateCustomized] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedAdminId, setSelectedAdminId] = useState('all');
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const [adminMenuPosition, setAdminMenuPosition] = useState({ top: 0, left: 0, width: 244 });
  const adminMenuAnchorRef = useRef<HTMLDivElement>(null);
  const loadRef = useRef<(() => Promise<void>) | null>(null);

  const loadDashboard = async (ownerAdminId = selectedAdminId) => {
    try {
      const { data, error } = await supabase.rpc('get_notification_automation_dashboard', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_owner_admin_id: isSuperAdmin && ownerAdminId !== 'all' ? ownerAdminId : null,
      });
      if (error) throw error;
      setDashboard((data || { currency: 'USDC', admin_groups: [], tasks: [], shared_templates: [], executions: [] }) as unknown as AutomationDashboard);
    } catch (error) {
      notify('error', formatSupabaseError(error) || '無法載入自動化任務');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };
  loadRef.current = loadDashboard;

  useEffect(() => {
    void loadRef.current?.();
  }, []);

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

  const openNewTask = () => {
    const next = createDefaultForm();
    const template = buildEnglishTemplate(next.triggerType, next.rewardEnabled, next.rewardAmount);
    next.titleTemplate = template.title;
    next.contentTemplate = template.content;
    setForm(next);
    setTemplateCustomized(false);
    setReadOnly(false);
    setEditorOpen(true);
  };

  const openTask = (task: AutomationTask, onlyView = false) => {
    setForm(taskToForm(task));
    setTemplateCustomized(true);
    setReadOnly(onlyView || task.owner_admin_id !== admin.id);
    setEditorOpen(true);
  };

  const saveTask = async () => {
    if (!form.name.trim()) {
      notify('error', '請輸入任務名稱');
      return;
    }
    if (!form.titleTemplate.trim() || !form.contentTemplate.trim()) {
      notify('error', '請確認英文通知標題與內容');
      return;
    }
    if (form.triggerType !== 'annual_date' && Number(form.thresholdValue) <= 0) {
      notify('error', '觸發數值必須大於零');
      return;
    }
    if (form.triggerType === 'annual_date') {
      const month = Number(form.annualMonth);
      const day = Number(form.annualDay);
      const maximumDay = new Date(2000, month, 0).getDate();
      if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > maximumDay) {
        notify('error', '請選擇有效的月份與日期');
        return;
      }
    }
    if (form.rewardEnabled && Number(form.rewardAmount) <= 0) {
      notify('error', '獎金金額必須大於零');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.rpc('save_notification_automation_task', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_task_id: form.id,
        p_name: form.name.trim(),
        p_description: form.description.trim(),
        p_trigger_type: form.triggerType,
        p_trigger_mode: form.triggerType === 'annual_date' ? 'reach_once' : form.triggerMode,
        p_threshold_value: form.triggerType === 'annual_date' ? 1 : Number(form.thresholdValue),
        p_minimum_daily_orders: form.triggerType === 'consecutive_work_days' ? Number(form.minimumDailyOrders) : null,
        p_minimum_daily_work_minutes: form.minimumDailyWorkMinutes ? Number(form.minimumDailyWorkMinutes) : null,
        p_annual_month: form.triggerType === 'annual_date' ? Number(form.annualMonth) : null,
        p_annual_day: form.triggerType === 'annual_date' ? Number(form.annualDay) : null,
        p_recipient_scope: form.recipientScope,
        p_recipient_ids: form.recipientScope === 'selected' ? form.recipientIds : [],
        p_title_template: form.titleTemplate.trim(),
        p_content_template: form.contentTemplate.trim(),
        p_message_type: form.messageType,
        p_priority: form.priority,
        p_reward_enabled: form.rewardEnabled,
        p_reward_amount: form.rewardEnabled ? Number(form.rewardAmount) : null,
        p_is_shared_template: form.isSharedTemplate,
        p_starts_at: form.startsAt ? new Date(form.startsAt).toISOString() : null,
        p_ends_at: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      });
      if (error) throw error;
      notify('success', form.id ? '任務已更新並重設為草稿' : '自動化任務已儲存為草稿');
      setEditorOpen(false);
      await loadDashboard();
    } catch (error) {
      notify('error', formatSupabaseError(error) || '儲存任務失敗');
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
      notify('success', status === 'active' ? '任務已啟用，現有進度已設為基準' : status === 'paused' ? '任務已暫停' : '任務狀態已更新');
      await loadDashboard();
    } catch (error) {
      notify('error', formatSupabaseError(error) || '更新任務狀態失敗');
    }
  };

  const copyTemplate = async (task: AutomationTask, activate: boolean) => {
    try {
      const { data, error } = await supabase.rpc('copy_shared_notification_automation_task', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_source_task_id: task.id,
      });
      if (error) throw error;
      const result = data as unknown as { task_id?: string } | null;
      if (activate && result?.task_id) {
        const { error: activateError } = await supabase.rpc('set_notification_automation_task_status', {
          p_admin_session_token: getAdminFinancialSessionToken(),
          p_task_id: result.task_id,
          p_status: 'active',
        });
        if (activateError) throw activateError;
      }
      notify('success', activate ? '已直接套用管理員範本，任務只會作用於你的員工' : '已將管理員範本複製為你的獨立草稿，可進一步修改後啟用');
      if (activate) setSelectedTemplateId(null);
      setView('tasks');
      await loadDashboard();
    } catch (error) {
      notify('error', formatSupabaseError(error) || '套用管理員範本失敗');
    }
  };

  const regenerateTemplate = () => {
    const template = buildEnglishTemplate(form.triggerType, form.rewardEnabled, form.rewardAmount);
    setForm(previous => ({ ...previous, titleTemplate: template.title, contentTemplate: template.content }));
    setTemplateCustomized(false);
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-slate-950">
        <div className="text-center">
          <RefreshCw className="mx-auto h-8 w-8 animate-spin text-cyan-400" />
          <p className="mt-3 text-sm font-semibold text-slate-300">正在載入自動化任務</p>
        </div>
      </div>
    );
  }

  if (editorOpen) {
    const previewTitle = renderPreview(form.titleTemplate, form, dashboard.currency);
    const previewContent = renderPreview(form.contentTemplate, form, dashboard.currency);
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-950 text-slate-100">
        <div className="relative z-10 flex shrink-0 flex-wrap items-center justify-between gap-3 overflow-hidden border-b border-cyan-400/20 bg-gradient-to-r from-slate-950 via-slate-900 to-cyan-950/70 px-4 py-3.5 shadow-lg shadow-slate-950/30 sm:px-5">
          <div className="flex items-center gap-3">
            <button onClick={() => setEditorOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-red-400/40 bg-red-500/15 text-red-300 shadow-sm transition-all duration-200 hover:border-red-300/70 hover:bg-red-500/30 hover:text-red-100 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h2 className="text-base font-black tracking-tight text-white sm:text-lg">{readOnly ? '查看管理員範本' : form.id ? '編輯自動化任務' : '新增自動化任務'}</h2>
              <p className="mt-0.5 text-xs font-medium text-slate-400">通知內容使用英文，管理介面使用繁體中文</p>
            </div>
          </div>
          {!readOnly && (
            <button disabled={saving} onClick={saveTask} className="inline-flex h-9 items-center gap-2 rounded-xl border border-cyan-300/30 bg-gradient-to-r from-cyan-400 via-cyan-500 to-blue-600 px-4 text-sm font-black text-white shadow-lg shadow-cyan-950/50 transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 hover:shadow-cyan-500/20 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:brightness-100">
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              儲存為草稿
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
                    <input disabled={readOnly} value={form.name} onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-all duration-200 placeholder:text-slate-400 hover:border-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/25 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:hover:border-slate-300" placeholder="例如：100 筆訂單鼓勵通知" />
                  </label>
                  <label className="sm:col-span-2">
                    <span className="mb-1.5 block text-xs font-semibold text-slate-400">任務說明</span>
                    <input disabled={readOnly} value={form.description} onChange={event => setForm(previous => ({ ...previous, description: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-all duration-200 placeholder:text-slate-400 hover:border-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/25 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:hover:border-slate-300" placeholder="供管理員查看的內部說明" />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-xs font-semibold text-slate-400">開始時間（選填）</span>
                    <input disabled={readOnly} type="datetime-local" value={form.startsAt} onChange={event => setForm(previous => ({ ...previous, startsAt: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-all duration-200 placeholder:text-slate-400 hover:border-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/25 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:hover:border-slate-300" />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-xs font-semibold text-slate-400">結束時間（選填）</span>
                    <input disabled={readOnly} type="datetime-local" value={form.endsAt} onChange={event => setForm(previous => ({ ...previous, endsAt: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-all duration-200 placeholder:text-slate-400 hover:border-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/25 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:hover:border-slate-300" />
                  </label>
                  <label className="sm:col-span-2 flex cursor-pointer items-center justify-between rounded-xl border border-violet-500/25 bg-violet-500/10 p-3">
                    <div>
                      <p className="text-sm font-bold text-violet-200">提供給所有管理員選用</p>
                      <p className="text-xs text-violet-300/60">共享範本不會直接觸發，其他管理員複製後會在自己的管理範圍內獨立使用</p>
                    </div>
                    <input disabled={readOnly} type="checkbox" checked={form.isSharedTemplate} onChange={event => setForm(previous => ({ ...previous, isSharedTemplate: event.target.checked }))} className="h-4 w-4 rounded bg-white accent-violet-500 shadow-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:opacity-60" />
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

  const selectedTemplate = dashboard.shared_templates.find(task => task.id === selectedTemplateId);
  const selectedAdmin = dashboard.admin_groups.find(group => group.id === selectedAdminId);
  const taskTabLabel = isSuperAdmin
    ? selectedAdmin ? `${selectedAdmin.username} 的任務` : '全部管理員任務'
    : '我的任務';

  const selectAdminGroup = (nextAdminId: string) => {
    setSelectedAdminId(nextAdminId);
    setSelectedTemplateId(null);
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
                    <p className={`mt-0.5 whitespace-nowrap text-lg font-black tabular-nums leading-5 ${item.color}`}>{item.value}</p>
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
                      <span className="truncate">{selectedAdmin ? selectedAdmin.username : '全部管理員'}</span>
                      <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-sky-200 transition-transform duration-200 ${adminMenuOpen ? 'rotate-180' : ''}`} />
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
                <button title={tab.label} key={tab.id} onClick={() => setView(tab.id)} className={`relative flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 ${tab.id === 'tasks' ? 'w-44 justify-center' : ''} ${view === tab.id ? 'bg-gradient-to-r from-cyan-400 to-cyan-500 text-slate-950 shadow-md shadow-cyan-950/40 after:absolute after:inset-x-3 after:-bottom-1 after:h-0.5 after:rounded-full after:bg-cyan-200' : 'text-slate-400 hover:bg-slate-800 hover:text-cyan-100'}`}><tab.icon className="h-4 w-4 shrink-0" /><span className="truncate">{tab.label}</span></button>
              ))}
            </div>
            {view === 'templates' && (
              <button disabled={!selectedTemplate} onClick={() => selectedTemplate && void copyTemplate(selectedTemplate, true)} className="flex h-9 items-center gap-2 rounded-lg border border-emerald-300/30 bg-gradient-to-r from-emerald-400 to-emerald-500 px-4 text-xs font-black text-emerald-950 shadow-md shadow-emerald-950/30 transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:cursor-not-allowed disabled:border-transparent disabled:bg-slate-700 disabled:text-slate-500 disabled:shadow-none disabled:hover:translate-y-0 disabled:hover:brightness-100">
                <Play className="h-4 w-4" />套用所選範本
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
          {view === 'tasks' && (
            dashboard.tasks.length === 0 ? (
              <div className="relative flex min-h-full flex-col items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_center,rgba(6,182,212,0.10),transparent_42%)] px-6 py-16 text-center">
                <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-cyan-500/20 to-blue-500/10 text-cyan-300 shadow-xl shadow-cyan-950/40 ring-1 ring-cyan-300/10"><Bell className="h-8 w-8" /></div>
                <p className="mt-4 text-base font-bold text-slate-200">尚未建立自動化任務</p>
                <p className="mt-1 max-w-md text-sm text-slate-500">建立第一個任務，設定觸發條件、通知內容及可選的績效獎金；新任務會先儲存為草稿。</p>
                <button onClick={openNewTask} className="relative mt-5 inline-flex h-10 items-center gap-2 rounded-lg border border-cyan-300/30 bg-gradient-to-r from-cyan-400 to-blue-500 px-5 text-sm font-black text-slate-950 shadow-lg shadow-cyan-950/40 transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"><Plus className="h-4 w-4" />建立第一個任務</button>
              </div>
            ) : (
              <div className="divide-y divide-slate-800/80">
                {dashboard.tasks.map(task => (
                  <article key={task.id} className={`group grid gap-3 border-l-[3px] px-4 py-3.5 transition-all duration-200 odd:bg-slate-950/20 even:bg-slate-800/15 hover:relative hover:z-[1] hover:-translate-y-px hover:bg-slate-800/55 hover:shadow-lg hover:shadow-cyan-950/15 lg:grid-cols-[minmax(210px,1fr)_minmax(260px,1.35fr)_minmax(130px,.55fr)_minmax(180px,.75fr)_auto] lg:items-center ${task.reward_enabled ? 'border-l-amber-400' : task.is_shared_template ? 'border-l-violet-400' : task.status === 'active' ? 'border-l-emerald-400' : task.status === 'paused' ? 'border-l-amber-400' : 'border-l-cyan-400'}`}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-bold text-white">{task.name}</h3>
                        <span className={`rounded-md border px-2 py-0.5 text-[10px] font-black tracking-wide ${task.status === 'active' ? 'border-emerald-400/20 bg-emerald-500/15 text-emerald-300' : task.status === 'paused' ? 'border-amber-400/20 bg-amber-500/15 text-amber-300' : 'border-slate-600/70 bg-slate-700/80 text-slate-300'}`}>{statusLabels[task.status]}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">{task.owner_username} · V{task.version}{task.is_shared_template ? ' · 共享範本' : ''}{task.source_task_id ? ' · 由範本複製' : ''}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-black tracking-wider text-slate-500">{triggerLabels[task.trigger_type]}</p>
                      <p className="mt-0.5 text-xs font-medium leading-5 text-slate-200">{summarizeTask(task, dashboard.currency)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500">適用範圍</p>
                      <p className="mt-0.5 text-xs font-bold text-white">{task.recipient_scope === 'selected' ? `指定 ${task.recipient_ids?.length || 0} 人` : '全部可管理員工'}</p>
                    </div>
                    <div className="flex gap-5">
                      <div><p className="text-[10px] text-slate-500">執行次數</p><p className="text-sm font-bold text-white">{task.execution_count || 0}</p></div>
                      <div><p className="text-[10px] text-slate-500">每次獎金</p><p className="text-sm font-bold text-amber-300">{task.reward_enabled ? `${Number(task.reward_amount || 0).toFixed(2)} ${dashboard.currency}` : '無'}</p></div>
                    </div>
                    <div className="flex items-center gap-2 lg:justify-end">
                      <button onClick={() => openTask(task)} className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 text-xs font-bold text-cyan-200 transition-all duration-200 hover:border-cyan-300/50 hover:bg-cyan-500/20 hover:text-cyan-100 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"><Edit3 className="h-3.5 w-3.5" />編輯</button>
                      {task.status !== 'active' ? (
                        <button onClick={() => changeStatus(task, 'active')} className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-emerald-400/25 bg-emerald-500/15 px-3 text-xs font-bold text-emerald-300 transition-all duration-200 hover:border-emerald-300/40 hover:bg-emerald-500/25 hover:text-emerald-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"><Play className="h-3.5 w-3.5" />{task.is_shared_template ? '發佈範本' : '啟用'}</button>
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
              <div className="relative flex min-h-full flex-col items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_center,rgba(139,92,246,0.10),transparent_42%)] px-6 py-16 text-center before:absolute before:inset-0 before:bg-[linear-gradient(rgba(148,163,184,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.025)_1px,transparent_1px)] before:bg-[size:28px_28px]"><div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-500/20 to-fuchsia-500/10 text-violet-300 shadow-xl shadow-violet-950/40"><Copy className="h-8 w-8" /></div><p className="mt-4 font-bold text-slate-300">目前沒有可用的管理員範本</p><p className="mt-1 text-sm text-slate-500">管理員發佈共享範本後，可在這裡勾選並直接套用。</p></div>
            ) : (
              <div className="divide-y divide-slate-800/80">
                {dashboard.shared_templates.map(task => {
                  const selected = selectedTemplateId === task.id;
                  return (
                    <article key={task.id} className={`group grid gap-3 border-l-[3px] px-4 py-3.5 transition-all duration-200 lg:grid-cols-[auto_minmax(210px,1fr)_minmax(280px,1.45fr)_minmax(170px,.7fr)_auto] lg:items-center ${selected ? 'border-l-violet-300 bg-gradient-to-r from-violet-500/15 to-violet-500/[0.04] shadow-[inset_0_0_0_1px_rgba(167,139,250,0.12)]' : 'border-l-violet-600 odd:bg-slate-950/20 even:bg-slate-800/15 hover:-translate-y-px hover:bg-slate-800/55 hover:shadow-lg hover:shadow-violet-950/15'}`}>
                      <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-violet-200">
                        <input type="checkbox" checked={selected} onChange={event => setSelectedTemplateId(event.target.checked ? task.id : null)} className="h-4 w-4 cursor-pointer rounded border-slate-300 bg-white accent-violet-500 shadow-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900" />
                        選取
                      </label>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          {task.reward_enabled ? <Gift className="h-4 w-4 shrink-0 text-amber-400" /> : <Bell className="h-4 w-4 shrink-0 text-cyan-400" />}
                          <h3 className="truncate text-sm font-bold text-white">{task.name}</h3>
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-violet-300/70">
                          <span className="inline-flex items-center gap-1 rounded-md border border-violet-400/20 bg-violet-500/10 px-1.5 py-0.5 font-semibold text-violet-200"><ShieldCheck className="h-3 w-3" />範本提供者</span>
                          <span>{task.owner_username} · V{task.version}</span>
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] font-black tracking-wider text-slate-500">{triggerLabels[task.trigger_type]}</p>
                        <p className="mt-0.5 text-xs leading-5 text-slate-300">{summarizeTask(task, dashboard.currency)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-500">獎勵與範圍</p>
                        <p className="mt-0.5 text-xs font-bold text-slate-200">{task.reward_enabled ? `${Number(task.reward_amount || 0).toFixed(2)} ${dashboard.currency}` : '一般通知'} · {task.recipient_scope === 'selected' ? '指定範圍' : '全部員工'}</p>
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
            <div className="min-h-full bg-slate-900">
              <div className="border-b border-slate-700/70 px-5 py-4"><h3 className="font-bold text-white">最近執行記錄</h3><p className="text-xs text-slate-500">保留實際條件、通知、獎金和幣種快照</p></div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[850px] text-left text-xs">
                  <thead className="bg-slate-950/70 text-slate-500"><tr><th className="px-5 py-3">任務</th><th className="px-4 py-3">員工</th><th className="px-4 py-3">階段</th><th className="px-4 py-3">實際數值</th><th className="px-4 py-3">獎金</th><th className="px-4 py-3">狀態</th><th className="px-5 py-3 text-right">執行時間</th></tr></thead>
                  <tbody className="divide-y divide-slate-800">
                    {dashboard.executions.map(execution => (
                      <tr key={execution.id} className="text-slate-300 transition-all duration-200 odd:bg-slate-950/15 hover:bg-slate-800/60"><td className="px-5 py-3 font-semibold text-white">{execution.task_name}</td><td className="px-4 py-3">{execution.employee_username}</td><td className="px-4 py-3">第 {execution.stage} 階段</td><td className="px-4 py-3">{Number(execution.actual_value).toLocaleString()}</td><td className="px-4 py-3 font-bold text-amber-300">{execution.reward_amount ? `${Number(execution.reward_amount).toFixed(2)} ${execution.reward_currency}` : '—'}</td><td className="px-4 py-3"><span className={`rounded-md px-2 py-1 font-bold ${execution.status === 'succeeded' ? 'bg-emerald-500/10 text-emerald-300' : execution.status === 'failed' ? 'bg-red-500/10 text-red-300' : 'bg-blue-500/10 text-blue-300'}`}>{execution.status === 'succeeded' ? '成功' : execution.status === 'failed' ? '失敗' : '處理中'}</span></td><td className="px-5 py-3 text-right text-slate-500">{new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(execution.executed_at))}</td></tr>
                    ))}
                  </tbody>
                </table>
                {dashboard.executions.length === 0 && <div className="py-16 text-center text-sm text-slate-600">尚無執行記錄</div>}
              </div>
            </div>
          )}
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
            <button type="button" role="option" aria-selected={selectedAdminId === 'all'} onClick={() => selectAdminGroup('all')} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-all duration-150 ${selectedAdminId === 'all' ? 'bg-gradient-to-r from-sky-500/25 via-blue-500/15 to-indigo-500/10 text-white shadow-inner ring-1 ring-inset ring-sky-300/30' : 'text-slate-300 hover:bg-gradient-to-r hover:from-slate-800/90 hover:to-sky-950/40 hover:text-white'}`}>
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${selectedAdminId === 'all' ? 'bg-gradient-to-br from-sky-300 to-blue-500 text-blue-950 shadow-sm shadow-sky-950/40' : 'border border-slate-700 bg-slate-800/90 text-sky-300'}`}><Users className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1 truncate text-[11px] font-black">全部管理員</span>
              {selectedAdminId === 'all' && <CheckCircle2 className="h-4 w-4 shrink-0 text-sky-300" />}
            </button>
            {dashboard.admin_groups.map(group => {
              const selected = selectedAdminId === group.id;
              const current = group.id === admin.id;
              return (
                <button key={group.id} type="button" role="option" aria-selected={selected} onClick={() => selectAdminGroup(group.id)} className={`mt-0.5 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-all duration-150 ${selected ? 'bg-gradient-to-r from-sky-500/25 via-blue-500/15 to-indigo-500/10 text-white shadow-inner ring-1 ring-inset ring-sky-300/30' : 'text-slate-300 hover:bg-gradient-to-r hover:from-slate-800/90 hover:to-sky-950/40 hover:text-white'}`}>
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-black uppercase ${selected ? 'bg-gradient-to-br from-sky-300 to-blue-500 text-blue-950 shadow-sm shadow-sky-950/40' : 'border border-slate-700 bg-slate-800/90 text-sky-300'}`}>{group.username.slice(0, 1)}</span>
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
