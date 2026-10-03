import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Search, Trash2, UserRoundX, X } from 'lucide-react';
import { getAdminFinancialSessionToken } from '../../lib/auth';
import { sanitizeHTML } from '../../lib/sanitizeHTML';
import { formatSupabaseError, supabase } from '../../lib/supabase';
import EmployeeNotificationDetailPanel from '../employee/EmployeeNotificationDetailPanel';

type DeletedEmployee = {
  id: string;
  operation_id: string;
  employee_id: string;
  account_username: string | null;
  employee_number: string | null;
  account_created_at: string | null;
  account_remarks: string | null;
  owner_admin_id: string;
  owner_username: string | null;
  actor_admin_id: string;
  actor_username: string;
  actor_role: string;
  deletion_source: 'employee_delete' | 'admin_delete';
  deleted_at: string;
  cleared_at: string | null;
  cleared_username?: string | null;
  clear_reason?: string | null;
};
type RelatedEvidence = { id: string; operation_id: string; entity_type: 'aaa_service' | 'ccc_service'; action: 'edit' | 'delete' | 'conversation_delete' | 'customer_delete' | 'employee_delete' | 'admin_delete' | 'source_edit' | 'source_delete'; occurred_at: string; cleared_at: string | null };
type EmployeeDetail = DeletedEmployee & { account_summary: { is_verified: boolean; total_income: number; available_balance: number | null; frozen_balance: number | null; total_orders: number } | null; related_total: number; related_counts: { aaa_service: number; ccc_service: number }; related_items: RelatedEvidence[] };
type NotificationRow = { id: string; title: string | null; sender_username: string | null; sent_at: string | null; is_read: string | null; audit_origin: string | null; cleared_at: string | null };
type NotificationDetail = { id: string; message_data: Record<string, unknown> | null; recipient_data: Record<string, unknown> | null; cleared_at: string | null };
type Filters = { owner: string; search: string; source: '' | 'employee_delete' | 'admin_delete'; from: string; to: string };
type Section = 'profile' | 'notifications' | 'aaa_service' | 'ccc_service';

const emptyFilters: Filters = { owner: '', search: '', source: '', from: '', to: '' };
const PAGE_SIZE = 30;
const RELATED_PAGE_SIZE = 20;
const inputClass = 'mt-1.5 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus-visible:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400/30';
const focusClass = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950';

function displayTime(value: string | null): string {
  if (!value) return '—';
  return `${new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(value))} (UTC+8)`;
}

function dateBoundary(value: string, nextDay = false): string {
  const date = new Date(`${value}T00:00:00+08:00`);
  if (nextDay) date.setTime(date.getTime() + 86400000);
  return date.toISOString();
}

function DetailField({ label, value }: { label: string; value: string | null }) {
  return <div className="min-w-0 rounded-lg border border-slate-700 bg-slate-950/50 p-3"><dt className="text-[11px] font-semibold text-slate-400">{label}</dt><dd className="mt-1 break-all text-sm text-white">{value || '—'}</dd></div>;
}

export default function DeletedEmployeesPanel({ switcher, refreshKey, purgeUnlocked, clearing, windowBusy, initialSelectedId, initialSection, onSelectSection, onSelectEmployee, onClear, onClearNotification, onOpenEvidence }: {
  switcher: ReactNode;
  refreshKey: number;
  purgeUnlocked: boolean;
  clearing: boolean;
  windowBusy: boolean;
  initialSelectedId: string | null;
  initialSection: Section;
  onSelectSection: (section: Section) => void;
  onSelectEmployee: (id: string | null) => void;
  onClear: (id: string) => void;
  onClearNotification: (id: string) => void;
  onOpenEvidence: (event: RelatedEvidence, employee: DeletedEmployee) => void;
}) {
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [items, setItems] = useState<DeletedEmployee[]>([]);
  const [owners, setOwners] = useState<Array<{ id: string; username: string; event_count: number }>>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [section, setSection] = useState<Section>(initialSection);
  const [detail, setDetail] = useState<EmployeeDetail | null>(null);
  const [relatedPage, setRelatedPage] = useState(0);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [notificationTotal, setNotificationTotal] = useState(0);
  const [notificationPage, setNotificationPage] = useState(0);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [notificationId, setNotificationId] = useState<string | null>(null);
  const [notificationDetail, setNotificationDetail] = useState<NotificationDetail | null>(null);
  const [notificationDetailError, setNotificationDetailError] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setPage(0); }, [refreshKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    if (page === 0) { setItems([]); setTotal(0); }
    const load = async () => {
      try {
        const { data, error } = await supabase.rpc('list_deleted_employee_accounts', {
          p_admin_session_token: getAdminFinancialSessionToken(), p_owner: filters.owner || null,
          p_search: filters.search || null, p_source: filters.source || null,
          p_from: filters.from ? dateBoundary(filters.from) : null,
          p_to: filters.to ? dateBoundary(filters.to, true) : null, p_page: page, p_page_size: PAGE_SIZE,
        });
        if (error) throw error;
        if (!data || !Array.isArray(data.items) || !Array.isArray(data.owners) || typeof data.total !== 'number') throw new Error('已刪員工清單格式不正確。');
        if (!cancelled) {
          const next = data.items as DeletedEmployee[];
          setItems(previous => page === 0 ? next : [...previous, ...next.filter(item => !previous.some(entry => entry.id === item.id))]);
          setTotal(data.total);
          if (page === 0) setOwners(data.owners);
        }
      } catch (error) {
        if (!cancelled) setLoadError(formatSupabaseError(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [filters, page, refreshKey, retryKey]);

  useEffect(() => {
    if (loading || loadError || items.length === 0 || items.length >= total || !loadMoreRef.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); setPage(current => current + 1); }
    }, { rootMargin: '120px' });
    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [loading, loadError, items.length, total]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setDetail(null);
    setDetailLoading(true);
    setDetailError(null);
    const load = async () => {
      try {
        const { data, error } = await supabase.rpc('get_deleted_employee_account', {
          p_admin_session_token: getAdminFinancialSessionToken(), p_record_id: selectedId,
          p_related_page: relatedPage, p_related_page_size: RELATED_PAGE_SIZE,
          p_type: section === 'aaa_service' || section === 'ccc_service' ? section : null,
        });
        if (error) throw error;
        if (!data || !('id' in data)) throw new Error('找不到此員工檔案。');
        if (!cancelled) setDetail(data as EmployeeDetail);
      } catch (error) {
        if (!cancelled) setDetailError(formatSupabaseError(error));
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [selectedId, relatedPage, section, refreshKey]);

  useEffect(() => {
    if (!selectedId || section !== 'notifications') return;
    let cancelled = false;
    setNotificationLoading(true);
    setNotificationError(null);
    const load = async () => {
      try {
        const { data, error } = await supabase.rpc('list_deleted_employee_notifications', {
          p_admin_session_token: getAdminFinancialSessionToken(), p_record_id: selectedId,
          p_page: notificationPage, p_page_size: RELATED_PAGE_SIZE,
        });
        if (error) throw error;
        if (!data || !Array.isArray(data.items)) throw new Error('手動通知清單格式不正確。');
        if (!cancelled) { setNotifications(data.items as NotificationRow[]); setNotificationTotal(data.total); }
      } catch (error) {
        if (!cancelled) setNotificationError(formatSupabaseError(error));
      } finally {
        if (!cancelled) setNotificationLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [selectedId, section, notificationPage, refreshKey]);

  useEffect(() => {
    if (!notificationId) return;
    let cancelled = false;
    setNotificationDetail(null);
    setNotificationDetailError(null);
    const load = async () => {
      const { data, error } = await supabase.rpc('get_deleted_employee_notification', {
        p_admin_session_token: getAdminFinancialSessionToken(), p_notification_id: notificationId,
      });
      if (!cancelled) {
        if (error || !data) setNotificationDetailError(formatSupabaseError(error || new Error('找不到手動通知。')));
        else setNotificationDetail(data as NotificationDetail);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [notificationId, refreshKey]);

  useEffect(() => {
    if (!selectedId && !notificationId) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (notificationId) setNotificationId(null);
      else { setSelectedId(null); onSelectEmployee(null); }
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [selectedId, notificationId, onSelectEmployee]);

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft.from && draft.to && draft.from > draft.to) { setFilterError('結束日期不能早於開始日期。'); return; }
    setFilterError(null);
    setFilters({ ...draft, search: draft.search.trim() });
    setPage(0);
    setSelectedId(null);
    onSelectEmployee(null);
  };

  const filtersView = <form onSubmit={applyFilters} className="space-y-3">
    <label className="block text-xs font-semibold text-slate-300">所屬管理員
      <select className={inputClass} value={draft.owner} onChange={event => setDraft(previous => ({ ...previous, owner: event.target.value }))}>
        <option value="">全部管理員（{owners.reduce((sum, owner) => sum + owner.event_count, 0)}）</option>
        {owners.map(owner => <option key={owner.id} value={owner.id}>{owner.username}（{owner.event_count}）</option>)}
      </select>
    </label>
    <button type="button" onClick={() => { setDraft(previous => ({ ...previous, source: '' })); setFilters(previous => ({ ...previous, source: '' })); setPage(0); }} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-bold ${!filters.source ? 'bg-gradient-to-r from-cyan-700 to-blue-800 text-white' : 'bg-slate-800 text-slate-300'} ${focusClass}`}>刪除員工 <span className="rounded-md bg-white/15 px-2 py-0.5">{owners.find(owner => owner.id === filters.owner)?.event_count ?? owners.reduce((sum, owner) => sum + owner.event_count, 0)}</span></button>
    <label className="block text-xs font-semibold text-slate-300">事件類型
      <select className={inputClass} value={draft.source} onChange={event => setDraft(previous => ({ ...previous, source: event.target.value as Filters['source'] }))}>
        <option value="">全部刪除</option><option value="employee_delete">單獨刪除員工</option><option value="admin_delete">隨管理員刪除</option>
      </select>
    </label>
    <label className="block text-xs font-semibold text-slate-300">員工帳號／員工 ID
      <span className="relative block"><Search className="pointer-events-none absolute left-3 top-4 h-4 w-4 text-slate-500" aria-hidden="true" /><input className={`${inputClass} pl-9`} value={draft.search} maxLength={100} onChange={event => setDraft(previous => ({ ...previous, search: event.target.value }))} placeholder="帳號或管理員設定的編號" /></span>
    </label>
    <div className="grid grid-cols-2 gap-2"><label className="min-w-0 text-xs font-semibold text-slate-300">開始日期（UTC+8）<input type="date" className={`${inputClass} min-w-0 [color-scheme:dark]`} value={draft.from} onChange={event => setDraft(previous => ({ ...previous, from: event.target.value }))} /></label><label className="min-w-0 text-xs font-semibold text-slate-300">結束日期（UTC+8）<input type="date" className={`${inputClass} min-w-0 [color-scheme:dark]`} value={draft.to} onChange={event => setDraft(previous => ({ ...previous, to: event.target.value }))} /></label></div>
    {filterError && <p role="alert" className="text-xs text-rose-300">{filterError}</p>}
    <div className="flex gap-2 pt-1"><button type="submit" className={`flex-1 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-700 px-3 py-2 text-xs font-bold text-white ${focusClass}`}>套用篩選</button><button type="button" onClick={() => { setDraft(emptyFilters); setFilters(emptyFilters); setFilterError(null); setPage(0); setSelectedId(null); onSelectEmployee(null); }} className={`rounded-lg border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-300 ${focusClass}`}>重設</button></div>
  </form>;

  const message = notificationDetail?.message_data;
  return <>
    <div className="shrink-0 border-b border-slate-700 bg-slate-900 px-3 py-2 lg:hidden"><details className="max-h-[60vh] overflow-y-auto rounded-xl border border-slate-700 bg-slate-950/60 p-3"><summary className="cursor-pointer text-xs font-bold text-cyan-200">管理員分組／刪除員工篩選</summary><div className="mt-3">{filtersView}</div></details></div>
    <div className="grid min-h-0 flex-1 lg:grid-cols-[270px_minmax(0,1fr)]">
      <aside className="hidden min-h-0 flex-col overflow-y-auto border-r border-slate-700 bg-slate-950 p-3 lg:flex"><div className="mb-4">{switcher}</div>{filtersView}</aside>
      <main className="flex min-h-0 min-w-0 flex-col overflow-y-auto bg-slate-900">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-slate-700 bg-slate-950 px-4 py-3"><h2 className="text-sm font-black text-white">已刪員工檔案</h2><span className="text-xs text-cyan-200">共 {total.toLocaleString()} 位</span></div>
        <div className="hidden grid-cols-[48px_minmax(110px,1fr)_130px_140px_140px_170px] gap-3 border-b border-slate-700 bg-slate-800/60 px-4 py-2 text-[11px] font-bold text-slate-300 xl:grid"><span>序號</span><span>員工帳號</span><span>員工 ID</span><span>所屬管理員</span><span>刪除者</span><span>刪除時間（UTC+8）</span></div>
        <ol className="min-w-0 divide-y divide-slate-700/70">
          {items.length === 0 && !loading && !loadError && <li className="px-4 py-10 text-center text-xs text-slate-400">沒有符合條件的員工檔案。</li>}
          {items.map((item, index) => <li key={item.id}><button type="button" onClick={() => { setSelectedId(item.id); onSelectEmployee(item.id); setSection('profile'); onSelectSection('profile'); setRelatedPage(0); setNotificationPage(0); }} className={`grid w-full min-w-0 grid-cols-[34px_minmax(0,1fr)] gap-2 border-l-[3px] px-3 py-3 text-left hover:bg-slate-800/80 xl:grid-cols-[48px_minmax(110px,1fr)_130px_140px_140px_170px] xl:items-center xl:gap-3 xl:px-4 ${selectedId === item.id ? 'border-cyan-300 bg-cyan-600/15' : 'border-transparent bg-slate-950/30'} ${focusClass}`}><span className="text-xs font-bold tabular-nums text-cyan-300">{index + 1}.</span><span className="min-w-0 truncate text-xs font-bold text-white">{item.account_username || '帳戶資料已清除'}<span className="mt-1 block text-[10px] font-medium text-slate-400 xl:hidden">{item.deletion_source === 'admin_delete' ? '隨管理員刪除' : '單獨刪除'}</span></span><span className="col-start-2 truncate text-[11px] text-slate-300 xl:col-auto">{item.employee_number || '—'}</span><span className="col-start-2 truncate text-[11px] text-slate-300 xl:col-auto">{item.owner_username || item.owner_admin_id}</span><span className="col-start-2 truncate text-[11px] text-slate-400 xl:col-auto">{item.actor_username}</span><time className="col-start-2 text-[11px] text-slate-400 xl:col-auto">{displayTime(item.deleted_at)}</time></button></li>)}
        </ol>
        <div ref={loadMoreRef} role="status" className="py-3 text-center text-xs text-slate-400">{loading ? '載入中…' : loadError ? <button type="button" onClick={() => setRetryKey(key => key + 1)} className="text-cyan-200 underline">載入失敗，點此重試</button> : items.length < total ? '往下捲動載入更多' : null}</div>
        {loadError && <p role="alert" className="px-4 pb-3 text-xs text-rose-300"><AlertTriangle className="mr-1 inline h-4 w-4" />{loadError}</p>}
      </main>
    </div>
    {selectedId && createPortal(<div className="fixed inset-0 z-[8900] flex items-center justify-center bg-slate-950/80 p-0 backdrop-blur-sm sm:p-4" onMouseDown={event => { if (event.target === event.currentTarget) { setSelectedId(null); onSelectEmployee(null); } }}><section role="dialog" aria-modal="true" aria-labelledby="deleted-employee-title" className="flex h-full min-h-0 w-full max-w-6xl flex-col overflow-hidden border border-cyan-300/25 bg-slate-900 shadow-2xl sm:h-[92vh] sm:rounded-2xl"><div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-700 bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 px-4 py-3"><div className="min-w-0"><h2 id="deleted-employee-title" className="truncate text-lg font-black text-white">{detail?.account_username || '已刪員工檔案'}</h2><p className="truncate text-xs text-cyan-200">員工 ID：{detail?.employee_number || '已清除'} · 所屬管理員：{detail?.owner_username || detail?.owner_admin_id || '—'}</p></div><button type="button" onClick={() => { setSelectedId(null); onSelectEmployee(null); }} aria-label="關閉員工檔案" className={`rounded-lg border border-slate-600 p-2 text-slate-200 hover:bg-slate-800 ${focusClass}`}><X className="h-4 w-4" /></button></div>
      <nav aria-label="員工檔案分類" className="grid shrink-0 grid-cols-4 border-b border-slate-700 bg-slate-950/75">{([['profile', '帳戶資料'], ['notifications', '手動通知'], ['aaa_service', '模擬客戶'], ['ccc_service', '經理']] as const).map(([tab, label]) => <button key={tab} type="button" aria-pressed={section === tab} onClick={() => { setSection(tab); onSelectSection(tab); setRelatedPage(0); setNotificationPage(0); }} className={`min-w-0 border-b-2 px-1 py-3 text-[11px] font-bold sm:text-sm ${section === tab ? 'border-cyan-300 bg-cyan-500/15 text-white' : 'border-transparent text-slate-400 hover:bg-slate-800 hover:text-white'} ${focusClass}`}>{label}{detail && (tab === 'aaa_service' || tab === 'ccc_service') ? `（${detail.related_counts[tab]}）` : ''}</button>)}</nav>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-dark sm:p-5">{detailLoading ? <p role="status" className="py-10 text-center text-sm text-slate-400">載入員工檔案中…</p> : detailError ? <p role="alert" className="text-sm text-rose-300">{detailError}</p> : detail && <>
        {section === 'profile' && <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><span className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-xs font-bold text-cyan-100"><UserRoundX className="mr-1 inline h-4 w-4" />{detail.deletion_source === 'admin_delete' ? '隨所屬管理員刪除' : '員工帳戶已移入私人檔案'}</span>{detail.cleared_at ? <span className="text-xs text-rose-300">帳戶資料已清除</span> : <button type="button" disabled={!purgeUnlocked || clearing || windowBusy} onClick={() => onClear(detail.id)} className={`rounded-lg border border-rose-400/40 bg-rose-500/15 px-3 py-2 text-xs font-bold text-rose-200 disabled:opacity-40 ${focusClass}`}><Trash2 className="mr-1 inline h-4 w-4" />正式清除帳戶證據</button>}</div><dl className="grid grid-cols-1 gap-2 sm:grid-cols-2"><DetailField label="員工帳號" value={detail.account_username} /><DetailField label="管理員設定的員工 ID" value={detail.employee_number} /><DetailField label="所屬管理員" value={detail.owner_username || detail.owner_admin_id} /><DetailField label="實際刪除者" value={detail.actor_username} /><DetailField label="刪除時間" value={displayTime(detail.deleted_at)} /><DetailField label="帳戶建立時間" value={displayTime(detail.account_created_at)} /><DetailField label="備註" value={detail.account_remarks} />{detail.account_summary && <><DetailField label="帳戶驗證狀態" value={detail.account_summary.is_verified ? '已驗證' : '未驗證'} /><DetailField label="歷史總收入" value={String(detail.account_summary.total_income)} /><DetailField label="錢包可用／凍結" value={`${detail.account_summary.available_balance ?? 0} / ${detail.account_summary.frozen_balance ?? 0}`} /><DetailField label="歷史訂單總數" value={detail.account_summary.total_orders.toLocaleString()} /></>}{detail.cleared_at && <><DetailField label="正式清除時間" value={displayTime(detail.cleared_at)} /><DetailField label="清除原因" value={detail.clear_reason || null} /></>}</dl><p className="text-xs text-slate-400">聊天與手動通知可從上方分類逐項查閱；清除帳戶資料不會清除獨立留存的內容。</p></div>}
        {section === 'notifications' && <div className="space-y-2"><h3 className="mb-3 text-sm font-bold text-white">這名員工收到的管理員手動通知 · {notificationTotal} 筆</h3>{notificationLoading ? <p className="py-8 text-center text-sm text-slate-400">載入手動通知中…</p> : notificationError ? <p role="alert" className="text-sm text-rose-300">{notificationError}</p> : notifications.length ? notifications.map(item => <button key={item.id} type="button" onClick={() => setNotificationId(item.id)} className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-950/50 px-4 py-3 text-left text-xs text-white hover:border-cyan-400/50 ${focusClass}`}><span className="min-w-0 flex-1 truncate font-bold">{item.title || '已清除通知內容'}<span className="mt-1 block text-[11px] font-normal text-slate-400">發送者：{item.sender_username || '—'} · {item.is_read === 'true' ? '已讀' : '未讀'}{item.audit_origin === 'unverified' ? ' · 來源待核實' : ''}</span></span><time className="text-[11px] text-slate-400">{displayTime(item.sent_at)}</time></button>) : <p className="py-10 text-center text-xs text-slate-400">沒有可查看的手動通知。</p>}{notificationTotal > RELATED_PAGE_SIZE && <div className="flex items-center justify-between pt-2 text-xs text-slate-300"><span>第 {notificationPage + 1} / {Math.ceil(notificationTotal / RELATED_PAGE_SIZE)} 頁</span><span className="flex gap-2"><button disabled={notificationPage === 0} onClick={() => setNotificationPage(page => page - 1)} className="rounded-lg border border-slate-600 px-3 py-1.5 disabled:opacity-40">上一頁</button><button disabled={(notificationPage + 1) * RELATED_PAGE_SIZE >= notificationTotal} onClick={() => setNotificationPage(page => page + 1)} className="rounded-lg border border-slate-600 px-3 py-1.5 disabled:opacity-40">下一頁</button></span></div>}</div>}
        {(section === 'aaa_service' || section === 'ccc_service') && <div className="space-y-2"><h3 className="mb-3 text-sm font-bold text-white">{section === 'aaa_service' ? '模擬客戶' : '經理'}歷史聊天 · {detail.related_total} 筆</h3>{detail.related_items.length ? detail.related_items.map((event, index) => <button type="button" key={event.id} onClick={() => onOpenEvidence(event, detail)} className={`flex w-full items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-950/50 px-4 py-3 text-left text-xs text-cyan-100 hover:border-cyan-400/50 ${focusClass}`}><span>{relatedPage * RELATED_PAGE_SIZE + index + 1}. {event.action === 'edit' ? '修改紀錄' : '聊天紀錄'}{event.cleared_at ? ' · 內容已清除' : ''}</span><time className="text-[11px] text-slate-400">{displayTime(event.occurred_at)}</time></button>) : <p className="py-10 text-center text-xs text-slate-400">沒有可查看的聊天紀錄。</p>}{detail.related_total > RELATED_PAGE_SIZE && <div className="flex items-center justify-between pt-2 text-xs text-slate-300"><span>第 {relatedPage + 1} / {Math.ceil(detail.related_total / RELATED_PAGE_SIZE)} 頁</span><span className="flex gap-2"><button disabled={relatedPage === 0} onClick={() => setRelatedPage(page => page - 1)} className="rounded-lg border border-slate-600 px-3 py-1.5 disabled:opacity-40">上一頁</button><button disabled={(relatedPage + 1) * RELATED_PAGE_SIZE >= detail.related_total} onClick={() => setRelatedPage(page => page + 1)} className="rounded-lg border border-slate-600 px-3 py-1.5 disabled:opacity-40">下一頁</button></span></div>}</div>}
      </>}</div>
    </section></div>, document.body)}
    {notificationId && createPortal(<div className="fixed inset-0 z-[9000] flex items-center justify-center bg-slate-950/85 p-0 backdrop-blur-sm sm:p-5" onMouseDown={event => { if (event.target === event.currentTarget) setNotificationId(null); }}><section role="dialog" aria-modal="true" aria-label="手動通知詳情" className="flex h-full min-h-0 w-full max-w-3xl flex-col overflow-hidden rounded-none border border-cyan-300/25 bg-slate-900 shadow-2xl sm:h-[85vh] sm:rounded-2xl"><div className="flex items-center justify-between border-b border-slate-700 px-4 py-3"><span className="text-sm font-bold text-white">員工收到的手動通知{notificationDetail?.cleared_at ? ' · 已清除' : ''}</span><button type="button" onClick={() => setNotificationId(null)} aria-label="關閉手動通知" className={`rounded-lg p-2 text-slate-300 hover:bg-slate-800 ${focusClass}`}><X className="h-4 w-4" /></button></div>{notificationDetailError ? <p role="alert" className="p-5 text-rose-300">{notificationDetailError}</p> : !notificationDetail ? <p role="status" className="p-5 text-slate-300">載入內容中…</p> : message ? <><div className="min-h-0 flex-1 overflow-y-auto bg-white"><EmployeeNotificationDetailPanel embedded readOnlyPreview onClose={() => setNotificationId(null)} message={{ title: String(message.title || ''), content: sanitizeHTML(String(message.content || ''), { allowedTags: ['p','br','span','div','strong','em','u','s','b','i','ul','ol','li','blockquote','h1','h2','h3','h4'], allowedAttributes: [] }), message_type: message.message_type === 'login_popup' ? 'login_popup' : 'realtime', priority: ['low','normal','high','urgent'].includes(String(message.priority)) ? message.priority as 'low'|'normal'|'high'|'urgent' : 'normal', notification_category: typeof message.notification_category === 'string' ? message.notification_category : null, reward_amount: typeof message.reward_amount === 'number' ? message.reward_amount : null, reward_currency: typeof message.reward_currency === 'string' ? message.reward_currency : null, created_at: typeof message.created_at === 'string' ? message.created_at : null, is_read: notificationDetail.recipient_data?.is_read === true }} /></div>{!notificationDetail.cleared_at && <button type="button" disabled={!purgeUnlocked || clearing || windowBusy} onClick={() => onClearNotification(notificationDetail.id)} className="mx-4 my-3 self-end rounded-lg border border-rose-400/40 px-3 py-2 text-xs font-bold text-rose-200 disabled:opacity-40">逐筆清除此通知證據</button>}</> : <p className="p-5 text-sm text-slate-400">此筆通知內容已正式清除。</p>}</section></div>, document.body)}
  </>;
}
