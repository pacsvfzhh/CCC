import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  CheckCircle2,
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
  Search,
  Settings2,
  ShieldCheck,
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

interface AutomationDashboard {
  currency: string;
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
  const [dashboard, setDashboard] = useState<AutomationDashboard>({ currency: 'USDC', tasks: [], shared_templates: [], executions: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<'tasks' | 'templates' | 'executions'>('tasks');
  const [search, setSearch] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [form, setForm] = useState<TaskForm>(createDefaultForm());
  const [templateCustomized, setTemplateCustomized] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const loadRef = useRef<(() => Promise<void>) | null>(null);
  const isSuperAdmin = admin.role === 'super_admin' || Boolean(admin.is_super_admin);

  const loadDashboard = async () => {
    try {
      const { data, error } = await supabase.rpc('get_notification_automation_dashboard', {
        p_admin_session_token: getAdminFinancialSessionToken(),
      });
      if (error) throw error;
      setDashboard((data || { currency: 'USDC', tasks: [], shared_templates: [], executions: [] }) as unknown as AutomationDashboard);
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

  const visibleTasks = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return dashboard.tasks;
    return dashboard.tasks.filter(task =>
      task.name.toLowerCase().includes(query)
      || task.owner_username.toLowerCase().includes(query)
      || triggerLabels[task.trigger_type].toLowerCase().includes(query)
    );
  }, [dashboard.tasks, search]);

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
        p_is_shared_template: isSuperAdmin && form.isSharedTemplate,
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
      notify('success', activate ? '已直接套用範本，任務只會作用於你的員工' : '已複製為你的獨立草稿，可進一步修改後啟用');
      if (activate) setSelectedTemplateId(null);
      setView('tasks');
      await loadDashboard();
    } catch (error) {
      notify('error', formatSupabaseError(error) || '套用範本失敗');
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
        <div className="z-10 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-700/70 bg-slate-900 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-3">
            <button onClick={() => setEditorOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h2 className="font-bold text-white">{readOnly ? '查看超級管理員範本' : form.id ? '編輯自動化任務' : '新增自動化任務'}</h2>
              <p className="text-xs text-slate-500">通知內容使用英文，管理介面使用繁體中文</p>
            </div>
          </div>
          {!readOnly && (
            <button disabled={saving} onClick={saveTask} className="inline-flex h-9 items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 text-sm font-bold text-white shadow-lg shadow-cyan-950/40 disabled:opacity-50">
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              儲存為草稿
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden p-3 sm:p-4">
          <div className="mx-auto grid h-full max-w-[1500px] items-start overflow-y-auto rounded-xl border border-slate-700/70 bg-slate-900 shadow-xl xl:grid-cols-[minmax(0,1fr)_390px]">
            <div className="min-w-0 px-4 sm:px-5 xl:border-r xl:border-slate-700/70">
              <section className="border-b border-slate-700/60 py-4">
                <div className="mb-3 flex items-center gap-2">
                  <Settings2 className="h-5 w-5 text-cyan-400" />
                  <h3 className="font-bold text-white">基本設定</h3>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="sm:col-span-2">
                    <span className="mb-1.5 block text-xs font-semibold text-slate-400">任務名稱</span>
                    <input disabled={readOnly} value={form.name} onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500" placeholder="例如：100 筆訂單鼓勵通知" />
                  </label>
                  <label className="sm:col-span-2">
                    <span className="mb-1.5 block text-xs font-semibold text-slate-400">任務說明</span>
                    <input disabled={readOnly} value={form.description} onChange={event => setForm(previous => ({ ...previous, description: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500" placeholder="供管理員查看的內部說明" />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-xs font-semibold text-slate-400">開始時間（選填）</span>
                    <input disabled={readOnly} type="datetime-local" value={form.startsAt} onChange={event => setForm(previous => ({ ...previous, startsAt: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500" />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-xs font-semibold text-slate-400">結束時間（選填）</span>
                    <input disabled={readOnly} type="datetime-local" value={form.endsAt} onChange={event => setForm(previous => ({ ...previous, endsAt: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500" />
                  </label>
                  {isSuperAdmin && (
                    <label className="sm:col-span-2 flex cursor-pointer items-center justify-between rounded-xl border border-violet-500/25 bg-violet-500/10 p-3">
                      <div>
                        <p className="text-sm font-bold text-violet-200">提供給二級管理員選用</p>
                        <p className="text-xs text-violet-300/60">共享範本不會直接觸發，二級管理員複製後獨立使用</p>
                      </div>
                      <input disabled={readOnly} type="checkbox" checked={form.isSharedTemplate} onChange={event => setForm(previous => ({ ...previous, isSharedTemplate: event.target.checked }))} className="h-4 w-4 bg-white accent-violet-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:opacity-60" />
                    </label>
                  )}
                </div>
              </section>

              <section className="border-b border-slate-700/60 py-4">
                <div className="mb-3 flex items-center gap-2">
                  <Target className="h-5 w-5 text-cyan-400" />
                  <h3 className="font-bold text-white">觸發條件</h3>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label>
                    <span className="mb-1.5 block text-xs font-semibold text-slate-400">條件類型</span>
                    <select disabled={readOnly} value={form.triggerType} onChange={event => { setTemplateCustomized(false); setForm(previous => ({ ...previous, triggerType: event.target.value as TriggerType })); }} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">
                      {Object.entries(triggerLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  {form.triggerType !== 'annual_date' ? (
                    <>
                      <label>
                        <span className="mb-1.5 block text-xs font-semibold text-slate-400">觸發方式</span>
                        <select disabled={readOnly} value={form.triggerMode} onChange={event => setForm(previous => ({ ...previous, triggerMode: event.target.value as TriggerMode }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">
                          <option value="reach_once">累計達到一次</option>
                          <option value="recurring">每達到指定數量</option>
                        </select>
                      </label>
                      <label>
                        <span className="mb-1.5 block text-xs font-semibold text-slate-400">{form.triggerType === 'commission_amount' ? `目標金額（${dashboard.currency}）` : form.triggerType.includes('work_days') ? '目標天數' : '目標訂單數'}</span>
                        <input disabled={readOnly} type="number" min={form.triggerType === 'commission_amount' ? '0.01' : '1'} step={form.triggerType === 'commission_amount' ? '0.01' : '1'} value={form.thresholdValue} onChange={event => setForm(previous => ({ ...previous, thresholdValue: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500" />
                      </label>
                    </>
                  ) : (
                    <>
                      <label>
                        <span className="mb-1.5 block text-xs font-semibold text-slate-400">月份</span>
                        <select disabled={readOnly} value={form.annualMonth} onChange={event => setForm(previous => ({ ...previous, annualMonth: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">
                          {Array.from({ length: 12 }, (_, index) => index + 1).map(month => <option key={month} value={month}>{month} 月</option>)}
                        </select>
                      </label>
                      <label>
                        <span className="mb-1.5 block text-xs font-semibold text-slate-400">日期</span>
                        <input disabled={readOnly} type="number" min="1" max={new Date(2000, Number(form.annualMonth), 0).getDate()} step="1" value={form.annualDay} onChange={event => setForm(previous => ({ ...previous, annualDay: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500" />
                      </label>
                      <div className="sm:col-span-2 rounded-xl border border-violet-500/20 bg-violet-500/10 p-3 text-xs leading-relaxed text-violet-100/80">
                        系統依 UTC 伺服器日期自動判斷，每年到達所選月日只執行一次，不依賴管理員或員工瀏覽器保持開啟。
                      </div>
                    </>
                  )}
                  {form.triggerType === 'consecutive_work_days' && (
                    <label>
                      <span className="mb-1.5 block text-xs font-semibold text-slate-400">每天至少完成訂單數</span>
                      <input disabled={readOnly} type="number" min="1" step="1" value={form.minimumDailyOrders} onChange={event => setForm(previous => ({ ...previous, minimumDailyOrders: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500" />
                    </label>
                  )}
                  {(form.triggerType === 'work_days' || form.triggerType === 'consecutive_work_days') && (
                    <label>
                      <span className="mb-1.5 block text-xs font-semibold text-slate-400">每天至少工作分鐘（選填）</span>
                      <input disabled={readOnly} type="number" min="1" step="1" value={form.minimumDailyWorkMinutes} onChange={event => setForm(previous => ({ ...previous, minimumDailyWorkMinutes: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500" />
                    </label>
                  )}
                </div>
                <div className="mt-4 rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-sm text-cyan-100">
                  {summarizeTask({ trigger_type: form.triggerType, trigger_mode: form.triggerType === 'annual_date' ? 'reach_once' : form.triggerMode, threshold_value: Number(form.thresholdValue || 0), minimum_daily_orders: Number(form.minimumDailyOrders || 0), annual_month: Number(form.annualMonth || 1), annual_day: Number(form.annualDay || 1) } as AutomationTask, dashboard.currency)}
                </div>
              </section>

              <section className="border-b border-slate-700/60 py-4">
                <label className="flex cursor-pointer items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${form.rewardEnabled ? 'bg-amber-400 text-amber-950 shadow-lg shadow-amber-900/40' : 'bg-slate-800 text-slate-500'}`}>
                      <Gift className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className={form.rewardEnabled ? 'font-bold text-amber-100' : 'font-bold text-white'}>發放績效獎金</h3>
                      <p className="text-xs text-slate-500">不勾選時只發送一般通知，不會修改錢包</p>
                    </div>
                  </div>
                  <input disabled={readOnly} type="checkbox" checked={form.rewardEnabled} onChange={event => { setTemplateCustomized(false); setForm(previous => ({ ...previous, rewardEnabled: event.target.checked })); }} className="h-5 w-5 bg-white accent-amber-400 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:opacity-60" />
                </label>
                {form.rewardEnabled && (
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <label>
                      <span className="mb-1.5 block text-xs font-semibold text-amber-200/70">每次獎金</span>
                      <input disabled={readOnly} type="number" min="0.01" step="0.01" value={form.rewardAmount} onChange={event => setForm(previous => ({ ...previous, rewardAmount: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500" />
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
                <div className="mb-3 flex items-center gap-2">
                  <Users className="h-5 w-5 text-cyan-400" />
                  <h3 className="font-bold text-white">適用員工</h3>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(['all_managed', 'selected'] as const).map(scope => (
                    <button key={scope} disabled={readOnly} onClick={() => setForm(previous => ({ ...previous, recipientScope: scope }))} className={`rounded-xl border p-3 text-left ${form.recipientScope === scope ? 'border-cyan-400 bg-cyan-500/10 text-cyan-100' : 'border-slate-700 bg-slate-950 text-slate-400'} disabled:opacity-60`}>
                      <p className="text-sm font-bold">{scope === 'all_managed' ? '全部可管理員工' : '指定員工'}</p>
                      <p className="mt-1 text-xs opacity-60">{scope === 'all_managed' ? '自動包含你權限範圍內的員工' : '只對下方勾選的員工生效'}</p>
                    </button>
                  ))}
                </div>
                {form.recipientScope === 'selected' && (
                  <div className="mt-3 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-300 bg-slate-50 p-2">
                    {employees.map(employee => (
                      <label key={employee.id} className="flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 hover:bg-white">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{employee.username}</p>
                          <p className="text-[11px] text-slate-500">{employee.employee_id}</p>
                        </div>
                        <input disabled={readOnly} type="checkbox" checked={form.recipientIds.includes(employee.id)} onChange={event => setForm(previous => ({ ...previous, recipientIds: event.target.checked ? [...previous.recipientIds, employee.id] : previous.recipientIds.filter(id => id !== employee.id) }))} className="h-4 w-4 bg-white accent-cyan-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:opacity-60" />
                      </label>
                    ))}
                  </div>
                )}
              </section>

              <section className="border-b border-slate-700/60 py-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-cyan-400" />
                    <div>
                      <h3 className="font-bold text-white">英文通知內容</h3>
                      <p className="text-xs text-slate-500">可以直接修改，動態變數會在發送時替換</p>
                    </div>
                  </div>
                  {!readOnly && <button onClick={regenerateTemplate} className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-bold text-cyan-200 hover:bg-cyan-500/20">重新產生內容</button>}
                </div>
                <div className="space-y-4">
                  <label>
                    <span className="mb-1.5 block text-xs font-semibold text-slate-400">通知標題</span>
                    <input disabled={readOnly} value={form.titleTemplate} onChange={event => { setTemplateCustomized(true); setForm(previous => ({ ...previous, titleTemplate: event.target.value })); }} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500" />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-xs font-semibold text-slate-400">通知內容</span>
                    <textarea disabled={readOnly} rows={6} value={form.contentTemplate} onChange={event => { setTemplateCustomized(true); setForm(previous => ({ ...previous, contentTemplate: event.target.value })); }} className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed text-slate-900 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500" />
                  </label>
                  <p className="text-[11px] text-slate-500">可用變數：{'{{employee_name}}'}、{'{{threshold_value}}'}、{'{{actual_value}}'}、{'{{minimum_daily_orders}}'}、{'{{annual_month}}'}、{'{{annual_day}}'}、{'{{bonus_amount}}'}、{'{{currency}}'}</p>
                </div>
              </section>
            </div>

            <aside className="p-4 xl:sticky xl:top-0 xl:self-start">
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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-950 text-slate-100">
      <div className="shrink-0 border-b border-slate-700/70 bg-slate-900 px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"><ArrowLeft className="h-4 w-4" /></button>
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-cyan-400" />
                <h2 className="font-bold text-white">自動化任務</h2>
              </div>
              <p className="text-xs text-slate-500">根據員工表現自動發送通知，並可選擇發放績效獎金</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { setRefreshing(true); void loadDashboard(); }} className="flex h-9 items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3 text-xs font-bold text-slate-300 hover:bg-slate-700"><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />重新整理</button>
            <button onClick={openNewTask} className="flex h-9 items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 text-xs font-bold text-white shadow-lg shadow-cyan-950/40"><Plus className="h-4 w-4" />新增自動化任務</button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-3 sm:p-4">
        <div className="mx-auto flex h-full max-w-[1600px] flex-col overflow-hidden rounded-xl border border-slate-700/70 bg-slate-900 shadow-xl">
          <div className="flex shrink-0 divide-x divide-slate-700/70 overflow-x-auto border-b border-slate-700/70">
            {[
              { label: '任務總數', value: taskStats.total, icon: Settings2, iconClass: 'text-cyan-400' },
              { label: '已啟用', value: taskStats.active, icon: Play, iconClass: 'text-emerald-400' },
              { label: '獎勵任務', value: taskStats.rewards, icon: Gift, iconClass: 'text-amber-400' },
              { label: '成功執行', value: taskStats.executions, icon: CheckCircle2, iconClass: 'text-violet-400' },
            ].map(item => (
              <div key={item.label} className="flex min-w-[145px] flex-1 items-center gap-3 px-4 py-2.5">
                <item.icon className={`h-4 w-4 ${item.iconClass}`} />
                <p className="text-xs font-semibold text-slate-500">{item.label}</p>
                <p className="ml-auto text-lg font-black text-white">{item.value}</p>
              </div>
            ))}
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-700/70 px-3 py-2">
            <div className="flex gap-1">
              {[
                { id: 'tasks' as const, label: '我的任務', icon: Settings2 },
                ...(!isSuperAdmin ? [{ id: 'templates' as const, label: '超級管理員範本', icon: Copy }] : []),
                { id: 'executions' as const, label: '執行記錄', icon: History },
              ].map(tab => (
                <button key={tab.id} onClick={() => setView(tab.id)} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold ${view === tab.id ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}><tab.icon className="h-4 w-4" />{tab.label}</button>
              ))}
            </div>
            {view === 'tasks' && (
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜尋任務或管理員" className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs text-slate-900 outline-none placeholder:text-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20" />
              </div>
            )}
            {view === 'templates' && (
              <button disabled={!selectedTemplate} onClick={() => selectedTemplate && void copyTemplate(selectedTemplate, true)} className="flex h-9 items-center gap-2 rounded-lg bg-emerald-500 px-4 text-xs font-black text-emerald-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500">
                <Play className="h-4 w-4" />套用所選範本
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
          {view === 'tasks' && (
            visibleTasks.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-900/50 py-20 text-center">
                <Bell className="mx-auto h-10 w-10 text-slate-600" />
                <p className="mt-4 font-bold text-slate-300">尚未建立自動化任務</p>
                <p className="mt-1 text-sm text-slate-600">新增任務後預設為草稿，不會立即發送通知或獎金</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-800">
                {visibleTasks.map(task => (
                  <article key={task.id} className={`grid gap-3 border-l-2 px-4 py-3 transition hover:bg-slate-800/35 lg:grid-cols-[minmax(210px,1fr)_minmax(260px,1.35fr)_minmax(130px,.55fr)_minmax(180px,.75fr)_auto] lg:items-center ${task.reward_enabled ? 'border-l-amber-400' : task.is_shared_template ? 'border-l-violet-400' : 'border-l-cyan-400'}`}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-bold text-white">{task.name}</h3>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${task.status === 'active' ? 'bg-emerald-500/15 text-emerald-300' : task.status === 'paused' ? 'bg-amber-500/15 text-amber-300' : 'bg-slate-700 text-slate-300'}`}>{statusLabels[task.status]}</span>
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
                      <button onClick={() => openTask(task)} className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 text-xs font-bold text-slate-300 hover:bg-slate-700"><Edit3 className="h-3.5 w-3.5" />編輯</button>
                      {task.status !== 'active' ? (
                        <button onClick={() => changeStatus(task, 'active')} className="flex h-8 items-center justify-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 text-xs font-bold text-emerald-300 hover:bg-emerald-500/25"><Play className="h-3.5 w-3.5" />{task.is_shared_template ? '發佈範本' : '啟用'}</button>
                      ) : (
                        <button onClick={() => changeStatus(task, 'paused')} className="flex h-8 items-center justify-center gap-1.5 rounded-lg bg-amber-500/15 px-3 text-xs font-bold text-amber-300 hover:bg-amber-500/25"><Pause className="h-3.5 w-3.5" />暫停</button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )
          )}

          {view === 'templates' && (
            dashboard.shared_templates.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-violet-500/20 bg-violet-500/5 py-20 text-center"><Copy className="mx-auto h-10 w-10 text-violet-500" /><p className="mt-4 font-bold text-slate-300">目前沒有可用的超級管理員範本</p></div>
            ) : (
              <div className="divide-y divide-slate-800">
                {dashboard.shared_templates.map(task => {
                  const selected = selectedTemplateId === task.id;
                  return (
                    <article key={task.id} className={`grid gap-3 border-l-2 px-4 py-3 transition lg:grid-cols-[auto_minmax(210px,1fr)_minmax(280px,1.45fr)_minmax(170px,.7fr)_auto] lg:items-center ${selected ? 'border-l-violet-300 bg-violet-500/10' : 'border-l-violet-600 hover:bg-slate-800/35'}`}>
                      <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-violet-200">
                        <input type="checkbox" checked={selected} onChange={event => setSelectedTemplateId(event.target.checked ? task.id : null)} className="h-4 w-4 rounded border-slate-300 bg-white accent-violet-500" />
                        選取
                      </label>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          {task.reward_enabled ? <Gift className="h-4 w-4 shrink-0 text-amber-400" /> : <Bell className="h-4 w-4 shrink-0 text-cyan-400" />}
                          <h3 className="truncate text-sm font-bold text-white">{task.name}</h3>
                        </div>
                        <p className="mt-1 text-[11px] text-violet-300/60">{task.owner_username} · V{task.version}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-black tracking-wider text-slate-500">{triggerLabels[task.trigger_type]}</p>
                        <p className="mt-0.5 text-xs leading-5 text-slate-300">{summarizeTask(task, dashboard.currency)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-500">獎勵與範圍</p>
                        <p className="mt-0.5 text-xs font-bold text-slate-200">{task.reward_enabled ? `${Number(task.reward_amount || 0).toFixed(2)} ${dashboard.currency}` : '一般通知'} · {task.recipient_scope === 'selected' ? `${task.recipient_ids?.length || 0} 人` : '全部員工'}</p>
                      </div>
                      <div className="flex items-center gap-2 lg:justify-end">
                        <button onClick={() => openTask(task, true)} className="flex h-8 items-center justify-center gap-1 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 text-xs font-bold text-violet-200">查看<ChevronRight className="h-3.5 w-3.5" /></button>
                        <button onClick={() => copyTemplate(task, false)} className="flex h-8 items-center justify-center gap-1 rounded-lg bg-slate-800 px-3 text-xs font-bold text-slate-200 hover:bg-slate-700"><Copy className="h-3.5 w-3.5" />複製自訂</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )
          )}

          {view === 'executions' && (
            <div className="overflow-hidden rounded-2xl border border-slate-700/70 bg-slate-900/80">
              <div className="border-b border-slate-700/70 px-5 py-4"><h3 className="font-bold text-white">最近執行記錄</h3><p className="text-xs text-slate-500">保留實際條件、通知、獎金和幣種快照</p></div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[850px] text-left text-xs">
                  <thead className="bg-slate-950/70 text-slate-500"><tr><th className="px-5 py-3">任務</th><th className="px-4 py-3">員工</th><th className="px-4 py-3">階段</th><th className="px-4 py-3">實際數值</th><th className="px-4 py-3">獎金</th><th className="px-4 py-3">狀態</th><th className="px-5 py-3 text-right">執行時間</th></tr></thead>
                  <tbody className="divide-y divide-slate-800">
                    {dashboard.executions.map(execution => (
                      <tr key={execution.id} className="text-slate-300"><td className="px-5 py-3 font-semibold text-white">{execution.task_name}</td><td className="px-4 py-3">{execution.employee_username}</td><td className="px-4 py-3">第 {execution.stage} 階段</td><td className="px-4 py-3">{Number(execution.actual_value).toLocaleString()}</td><td className="px-4 py-3 font-bold text-amber-300">{execution.reward_amount ? `${Number(execution.reward_amount).toFixed(2)} ${execution.reward_currency}` : '—'}</td><td className="px-4 py-3"><span className={`rounded-md px-2 py-1 font-bold ${execution.status === 'succeeded' ? 'bg-emerald-500/10 text-emerald-300' : execution.status === 'failed' ? 'bg-red-500/10 text-red-300' : 'bg-blue-500/10 text-blue-300'}`}>{execution.status === 'succeeded' ? '成功' : execution.status === 'failed' ? '失敗' : '處理中'}</span></td><td className="px-5 py-3 text-right text-slate-500">{new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(execution.executed_at))}</td></tr>
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
  );
}
