import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ArrowLeft, Search, Trash2, UserRoundX, X } from 'lucide-react';
import { getAdminFinancialSessionToken } from '../../lib/auth';
import { loadAuditedMedia } from '../../lib/contentAudit';
import { sanitizeHTML } from '../../lib/sanitizeHTML';
import { formatSupabaseError, supabase } from '../../lib/supabase';
import EmployeeNotificationDetailPanel from '../employee/EmployeeNotificationDetailPanel';

type DeletedEmployee = {
  id: string;
  operation_id: string;
  employee_id: string;
  account_username: string | null;
  employee_number: string | null;
  account_real_name: string | null;
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
type RelatedEvidence = { id: string; operation_id: string; entity_type: 'aaa_service' | 'ccc_service'; action: 'edit' | 'delete' | 'conversation_delete' | 'customer_delete' | 'employee_delete' | 'admin_delete' | 'source_edit' | 'source_delete'; occurred_at: string; cleared_at: string | null; before_data: Record<string, unknown> | null; after_data: Record<string, unknown> | null; media_refs: Record<string, string> | null };
type EmployeeDetail = DeletedEmployee & { account_summary: { is_verified: boolean; total_income: number; available_balance: number | null; frozen_balance: number | null; total_orders: number } | null; related_total: number; related_counts: { aaa_service: number; ccc_service: number }; related_items: RelatedEvidence[] };
type NotificationRow = { id: string; title: string | null; sender_username: string | null; sent_at: string | null; is_read: string | null; audit_origin: string | null; cleared_at: string | null };
type NotificationDetail = { id: string; message_data: Record<string, unknown> | null; recipient_data: Record<string, unknown> | null; cleared_at: string | null };
type Filters = { owner: string; search: string };
type Section = 'profile' | 'notifications' | 'aaa_service' | 'ccc_service';

const emptyFilters: Filters = { owner: '', search: '' };
const PAGE_SIZE = 30;
const RELATED_PAGE_SIZE = 20;
const inputClass = 'mt-1.5 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus-visible:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400/30';
const focusClass = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950';
const sections: Array<[Section, string]> = [['profile', '帳戶資料'], ['notifications', '通知檔案'], ['aaa_service', '模擬客戶'], ['ccc_service', '經理']];

function displayTime(value: string | null): string {
  if (!value) return '—';
  return `${new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(value))} (UTC+8)`;
}

function DetailField({ label, value }: { label: string; value: string | null }) {
  return <div className="min-w-0 rounded-lg border border-slate-700 bg-slate-950/50 p-3"><dt className="text-[11px] font-semibold text-slate-400">{label}</dt><dd className="mt-1 break-all text-sm text-white">{value || '—'}</dd></div>;
}

function readableSnapshot(value: unknown): string {
  if (typeof value !== 'string') return '';
  const document = new DOMParser().parseFromString(sanitizeHTML(value, {
    allowedTags: ['p', 'br', 'div', 'span', 'strong', 'em', 'u', 's', 'b', 'i', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4'],
    allowedAttributes: [],
  }), 'text/html');
  document.querySelectorAll('br').forEach(element => element.replaceWith('\n'));
  document.querySelectorAll('p, div, li, h1, h2, h3, h4, blockquote').forEach(element => element.append('\n'));
  return (document.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

function ArchivedChatMedia({ eventId, path }: { eventId: string; path: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [media, setMedia] = useState<{ url: string; type: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    let currentUrl: string | null = null;
    let active = true;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      void loadAuditedMedia(eventId, path).then(result => {
        if (!active) { URL.revokeObjectURL(result.url); return; }
        currentUrl = result.url;
        setMedia(result);
      }).catch(cause => { if (active) setError(formatSupabaseError(cause)); });
    }, { rootMargin: '120px' });
    observer.observe(node);
    return () => {
      active = false;
      observer.disconnect();
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [eventId, path, retryKey]);

  useEffect(() => {
    if (!expanded) return;
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [expanded]);

  return <div ref={containerRef} className="mt-2">{media?.type === 'video/mp4' ? <video src={media.url} controls preload="none" className="max-h-64 max-w-full rounded-lg" /> : media ? <button type="button" onClick={() => setExpanded(true)} aria-label="放大封存圖片" className={focusClass}><img src={media.url} alt="封存的聊天圖片" className="max-h-52 max-w-full rounded-lg object-contain" /></button> : error ? <button type="button" onClick={() => { setError(null); setRetryKey(value => value + 1); }} className={`text-xs text-cyan-200 underline ${focusClass}`}>圖片載入失敗，點此重試：{error}</button> : <span className="text-xs text-slate-400">圖片載入中…</span>}{expanded && media && createPortal(<div data-archive-media-preview className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/90 p-4" onClick={() => setExpanded(false)}><div role="dialog" aria-modal="true" aria-label="封存圖片預覽" className="relative" onClick={event => event.stopPropagation()}><button type="button" autoFocus onClick={() => setExpanded(false)} aria-label="關閉圖片預覽" className="absolute -right-2 -top-11 rounded-full bg-white/15 p-2 text-white"><X className="h-5 w-5" /></button><img src={media.url} alt="封存圖片預覽" className="max-h-[85vh] max-w-[95vw] object-contain" /></div></div>, document.body)}</div>;
}

function ArchivedChatCard({ event, onOpen }: { event: RelatedEvidence; onOpen: () => void }) {
  const snapshot = event.after_data?.message ? event.after_data : event.before_data;
  const message = snapshot?.message && typeof snapshot.message === 'object' ? snapshot.message as Record<string, unknown> : null;
  const text = readableSnapshot(snapshot?.rendered_html || message?.message_content);
  const imageUrl = typeof message?.image_url === 'string' ? message.image_url : '';
  const sourceText = JSON.stringify(snapshot || {});
  const attachments = Object.entries(event.media_refs || {}).filter(([source]) => sourceText.includes(source) || sourceText.includes(source.replace(/&/g, '&amp;')));
  const rating = message?.rating_data && typeof message.rating_data === 'object' ? message.rating_data as Record<string, unknown> : null;
  const sender = message?.sender_type === 'customer' ? readableSnapshot(snapshot?.customer_name) || '客戶' : readableSnapshot(snapshot?.employee_name) || '員工';
  const title = readableSnapshot(message?.title);
  const subtitle = readableSnapshot(message?.subtitle);

  return <article className="min-w-0 rounded-xl border border-slate-700 bg-slate-950/50 p-3 text-xs text-slate-200"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 pb-2"><div className="min-w-0"><strong className="text-cyan-100">{sender}</strong><span className="ml-2 text-slate-400">{event.action === 'edit' || event.action === 'source_edit' ? '修改版本' : '移除前紀錄'}</span></div><time className="text-slate-400">{displayTime(typeof message?.created_at === 'string' ? message.created_at : event.occurred_at)}</time></div><div className="space-y-1 py-3">{event.cleared_at ? <p className="text-rose-300">此則內容已正式清除。</p> : <>{title && <p className="font-bold text-white">{title}</p>}{subtitle && <p>{subtitle}</p>}{text && <p className="whitespace-pre-wrap break-words">{text}</p>}{message?.message_type === 'rating_request' && <p>評分請求</p>}{message?.message_type === 'rating_result' && <p>服務評分：{String(rating?.rating ?? '—')} · {readableSnapshot(rating?.comment)}</p>}{message?.message_type === 'tip' && <p>打賞：{String(rating?.tip_amount ?? '—')}</p>}{attachments.map(([, path]) => <ArchivedChatMedia key={`${event.id}:${path}`} eventId={event.id} path={path} />)}{imageUrl && !attachments.length && <p className="text-slate-400">原圖無法還原。</p>}{!title && !subtitle && !text && !imageUrl && !attachments.length && !['rating_request', 'rating_result', 'tip'].includes(String(message?.message_type)) && <p className="text-slate-400">沒有可顯示的文字內容。</p>}</>}</div><button type="button" onClick={onOpen} className={`text-xs font-bold text-cyan-200 underline ${focusClass}`}>查看完整版本與操作詳情</button></article>;
}

export default function DeletedEmployeesPanel({ switcher, isActive, clearConfirmationOpen, refreshKey, purgeUnlocked, clearing, windowBusy, initialSelectedId, initialSection, availableAdmins, onSelectSection, onSelectEmployee, onClear, onClearNotification, onOpenEvidence }: {
  switcher: ReactNode;
  isActive: boolean;
  clearConfirmationOpen: boolean;
  refreshKey: number;
  purgeUnlocked: boolean;
  clearing: boolean;
  windowBusy: boolean;
  initialSelectedId: string | null;
  initialSection: Section;
  availableAdmins: Array<{ id: string; username: string }>;
  onSelectSection: (section: Section) => void;
  onSelectEmployee: (id: string | null) => void;
  onClear: (id: string) => void;
  onClearNotification: (id: string) => void;
  onOpenEvidence: (event: RelatedEvidence, employee: DeletedEmployee) => void;
}) {
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [items, setItems] = useState<DeletedEmployee[]>([]);
  const [owners, setOwners] = useState<Array<{ id: string; username: string; event_count: number }>>([]);
  const [ownersLoaded, setOwnersLoaded] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [lastPageLoaded, setLastPageLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [section, setSection] = useState<Section>(initialSection);
  const [detail, setDetail] = useState<EmployeeDetail | null>(null);
  const [related, setRelated] = useState<Record<'aaa_service' | 'ccc_service', { items: RelatedEvidence[]; total: number }>>({ aaa_service: { items: [], total: 0 }, ccc_service: { items: [], total: 0 } });
  const [relatedPages, setRelatedPages] = useState({ aaa_service: 0, ccc_service: 0 });
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [relatedLoading, setRelatedLoading] = useState({ aaa_service: false, ccc_service: false });
  const [relatedError, setRelatedError] = useState<{ aaa_service: string | null; ccc_service: string | null }>({ aaa_service: null, ccc_service: null });
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [notificationTotal, setNotificationTotal] = useState(0);
  const [notificationPage, setNotificationPage] = useState(0);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [notificationId, setNotificationId] = useState<string | null>(null);
  const [notificationDetail, setNotificationDetail] = useState<NotificationDetail | null>(null);
  const [notificationDetailError, setNotificationDetailError] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const detailPaneRef = useRef<HTMLDivElement>(null);
  const restoredSectionRef = useRef(false);

  const adminGroups = [
    ...owners,
    ...availableAdmins.filter(admin => !owners.some(owner => owner.id === admin.id))
      .map(admin => ({ ...admin, event_count: 0 })),
  ].filter(owner => owner.username?.trim().toLowerCase() !== 'emergency_admin')
    .sort((a, b) => a.username.localeCompare(b.username, 'zh-TW'));
  const allOwnerTotal = owners.reduce((sum, owner) => sum + owner.event_count, 0);

  useEffect(() => { setPage(0); }, [refreshKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    if (page === 0) { setItems([]); setTotal(0); setLastPageLoaded(false); setOwnersLoaded(false); }
    const load = async () => {
      try {
        const { data, error } = await supabase.rpc('list_deleted_employee_accounts', {
          p_admin_session_token: getAdminFinancialSessionToken(), p_owner: filters.owner || null,
          p_search: filters.search || null, p_page: page, p_page_size: PAGE_SIZE,
        });
        if (error) throw error;
        if (!data || !Array.isArray(data.items) || !Array.isArray(data.owners) || typeof data.total !== 'number') throw new Error('已刪員工清單格式不正確。');
        if (!cancelled) {
          const next = data.items as DeletedEmployee[];
          setItems(previous => page === 0 ? next : [...previous, ...next.filter(item => !previous.some(entry => entry.id === item.id))]);
          setTotal(data.total);
          setLastPageLoaded(next.length < PAGE_SIZE);
          if (page === 0) { setOwners(data.owners); setOwnersLoaded(true); }
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
    if (loading || loadError || lastPageLoaded || items.length === 0 || items.length >= total || !loadMoreRef.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); setPage(current => current + 1); }
    }, { rootMargin: '120px' });
    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [loading, loadError, lastPageLoaded, items.length, total]);

  useEffect(() => {
    setDetail(null);
    setRelated({ aaa_service: { items: [], total: 0 }, ccc_service: { items: [], total: 0 } });
  }, [selectedId, refreshKey]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setDetailLoading(true);
    setRelatedLoading(previous => ({ ...previous, aaa_service: true }));
    setDetailError(null);
    setRelatedError(previous => ({ ...previous, aaa_service: null }));
    const load = async () => {
      try {
        const { data, error } = await supabase.rpc('get_deleted_employee_account', {
          p_admin_session_token: getAdminFinancialSessionToken(), p_record_id: selectedId,
          p_related_page: relatedPages.aaa_service, p_related_page_size: RELATED_PAGE_SIZE, p_type: 'aaa_service',
        });
        if (error) throw error;
        if (!data || !('id' in data)) throw new Error('找不到此員工檔案。');
        if (!cancelled) {
          const record = data as EmployeeDetail;
          setDetail(record);
          setRelated(previous => ({ ...previous, aaa_service: { items: record.related_items, total: record.related_total } }));
        }
      } catch (error) {
        if (!cancelled) {
          setDetailError(formatSupabaseError(error));
          setRelatedError(previous => ({ ...previous, aaa_service: formatSupabaseError(error) }));
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
          setRelatedLoading(previous => ({ ...previous, aaa_service: false }));
        }
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [selectedId, relatedPages.aaa_service, refreshKey]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setRelatedLoading(previous => ({ ...previous, ccc_service: true }));
    setRelatedError(previous => ({ ...previous, ccc_service: null }));
    const load = async () => {
      try {
        const { data, error } = await supabase.rpc('get_deleted_employee_account', {
          p_admin_session_token: getAdminFinancialSessionToken(), p_record_id: selectedId,
          p_related_page: relatedPages.ccc_service, p_related_page_size: RELATED_PAGE_SIZE, p_type: 'ccc_service',
        });
        if (error) throw error;
        if (!data || !('id' in data)) throw new Error('找不到經理聊天紀錄。');
        if (!cancelled) {
          const record = data as EmployeeDetail;
          setRelated(previous => ({ ...previous, ccc_service: { items: record.related_items, total: record.related_total } }));
        }
      } catch (error) {
        if (!cancelled) setRelatedError(previous => ({ ...previous, ccc_service: formatSupabaseError(error) }));
      } finally {
        if (!cancelled) setRelatedLoading(previous => ({ ...previous, ccc_service: false }));
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [selectedId, relatedPages.ccc_service, refreshKey]);

  useEffect(() => {
    if (!selectedId) return;
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
        if (!data || !Array.isArray(data.items) || typeof data.total !== 'number') throw new Error('手動通知清單格式不正確。');
        if (!cancelled) { setNotifications(data.items as NotificationRow[]); setNotificationTotal(data.total); }
      } catch (error) {
        if (!cancelled) setNotificationError(formatSupabaseError(error));
      } finally {
        if (!cancelled) setNotificationLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [selectedId, notificationPage, refreshKey]);

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
    if (!isActive || clearConfirmationOpen || (!selectedId && !notificationId)) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (notificationId) setNotificationId(null);
      else if (!document.querySelector('[data-archive-media-preview]')) { setSelectedId(null); onSelectEmployee(null); }
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [isActive, clearConfirmationOpen, selectedId, notificationId, onSelectEmployee]);

  useEffect(() => {
    if (!detail || restoredSectionRef.current || !detailPaneRef.current) return;
    restoredSectionRef.current = true;
    detailPaneRef.current.querySelector<HTMLElement>(`[data-archive-section="${section}"]`)?.scrollIntoView({ block: 'start' });
  }, [detail, section]);

  const selectOwner = (owner: string) => {
    setDraft(previous => ({ ...previous, owner }));
    setFilters(previous => ({ ...previous, owner }));
    setPage(0);
    setSelectedId(null);
    onSelectEmployee(null);
  };

  const applySearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFilters(previous => ({ ...previous, search: draft.search.trim() }));
    setPage(0);
    setSelectedId(null);
    onSelectEmployee(null);
  };

  const clearSearch = () => {
    setDraft(previous => ({ ...previous, search: '' }));
    setFilters(previous => ({ ...previous, search: '' }));
    setPage(0);
    setSelectedId(null);
    onSelectEmployee(null);
  };

  const selectEmployee = (id: string) => {
    if (selectedId === id) return;
    restoredSectionRef.current = false;
    setDetail(null);
    setRelated({ aaa_service: { items: [], total: 0 }, ccc_service: { items: [], total: 0 } });
    setNotifications([]);
    setNotificationTotal(0);
    setNotificationId(null);
    setSelectedId(id);
    onSelectEmployee(id);
    setSection('profile');
    onSelectSection('profile');
    setRelatedPages({ aaa_service: 0, ccc_service: 0 });
    setNotificationPage(0);
    detailPaneRef.current?.scrollTo(0, 0);
  };

  const showSection = (target: Section) => {
    setSection(target);
    onSelectSection(target);
    detailPaneRef.current?.querySelector<HTMLElement>(`[data-archive-section="${target}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const ownerGroupsView = <div aria-label="所屬管理員分組" className="space-y-1">
    <p className="mb-2 text-xs font-bold text-slate-300">所屬管理員</p>
    {[{ id: '', username: '全部管理員', event_count: allOwnerTotal }, ...adminGroups].map(owner => <button key={owner.id} type="button" aria-pressed={filters.owner === owner.id} onClick={() => selectOwner(owner.id)} className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs font-bold ${filters.owner === owner.id ? 'bg-gradient-to-r from-cyan-700 to-blue-800 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'} ${focusClass}`}><span className="min-w-0 truncate">{owner.username}</span><span className="rounded-md bg-white/15 px-2 py-0.5 tabular-nums">{ownersLoaded ? owner.event_count.toLocaleString() : '…'}</span></button>)}
  </div>;

  const searchView = (inputId: string) => <form onSubmit={applySearch} role="search" className="space-y-2">
    <label htmlFor={inputId} className="block text-xs font-semibold text-slate-300">員工姓名／帳號／員工 ID</label>
    <div className="flex items-end gap-2">
      <span className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-4 h-4 w-4 text-slate-500" aria-hidden="true" /><input id={inputId} type="search" className={`${inputClass} pl-9`} value={draft.search} maxLength={100} onChange={event => setDraft(previous => ({ ...previous, search: event.target.value }))} placeholder="搜尋姓名、帳號或員工 ID" /></span>
      <button type="submit" className={`rounded-lg bg-gradient-to-r from-cyan-600 to-blue-700 px-3 py-2 text-xs font-bold text-white ${focusClass}`}>搜尋</button>
    </div>
    {filters.search && <button type="button" onClick={clearSearch} className={`text-xs text-cyan-200 underline ${focusClass}`}>清除搜尋</button>}
  </form>;

  const message = notificationDetail?.message_data;
  return <>
    <div className="shrink-0 space-y-3 border-b border-slate-700 bg-slate-900 px-3 py-3 lg:hidden"><div>{switcher}</div>{searchView('deleted-employee-search-mobile')}<details className="max-h-[55vh] overflow-y-auto rounded-xl border border-slate-700 bg-slate-950/60 p-3"><summary className="cursor-pointer text-xs font-bold text-cyan-200">所屬管理員分組</summary><div className="mt-3">{ownerGroupsView}</div></details></div>
    <div className="grid min-h-0 flex-1 lg:grid-cols-[250px_minmax(0,1fr)]">
      <aside className="hidden min-h-0 flex-col overflow-y-auto border-r border-slate-700 bg-slate-950 p-3 lg:flex"><div className="mb-4">{switcher}</div><div className="mb-4 border-b border-slate-700 pb-4">{searchView('deleted-employee-search-desktop')}</div>{ownerGroupsView}</aside>
      <div className="grid min-h-0 min-w-0 flex-1 lg:grid-cols-[280px_minmax(0,1fr)]">
        <section aria-label="已刪員工帳戶列表" className={`${selectedId ? 'hidden lg:flex' : 'flex'} min-h-0 min-w-0 flex-col overflow-y-auto border-r border-slate-700 bg-slate-900`}>
          <div className="sticky top-0 z-10 border-b border-cyan-300/15 bg-[linear-gradient(90deg,#111b2e,#14243a)] px-3 py-2.5">
            <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-black text-white">已刪員工帳戶</h2><span className="rounded-md bg-cyan-400/10 px-2 py-0.5 text-[11px] font-bold tabular-nums text-cyan-200">{total.toLocaleString()} 位</span></div>
            <div className="mt-2 grid grid-cols-[28px_minmax(0,1fr)_auto] gap-2 text-[10px] font-bold text-slate-400"><span>序號</span><span>員工帳戶</span><span>操作</span></div>
          </div>
          <ol className="min-w-0 divide-y divide-slate-700/50">
            {items.length === 0 && !loading && !loadError && <li className="px-4 py-10 text-center text-xs text-slate-400">沒有符合條件的員工檔案。</li>}
            {items.map((item, index) => <li key={item.id}>
              <button type="button" aria-pressed={selectedId === item.id} onClick={() => selectEmployee(item.id)} className={`grid w-full min-w-0 grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 border-l-[3px] px-3 py-1.5 text-left transition-colors ${selectedId === item.id ? 'border-cyan-300 bg-cyan-400/15' : item.cleared_at ? 'border-slate-500 bg-slate-800/40 hover:bg-slate-800/70' : item.deletion_source === 'admin_delete' ? 'border-rose-400/70 bg-rose-500/[0.05] hover:bg-rose-500/[0.11]' : 'border-teal-400/70 bg-teal-500/[0.05] hover:bg-teal-500/[0.11]'} ${focusClass}`}>
                <span className="row-span-5 self-start pt-0.5 text-[11px] font-bold tabular-nums text-slate-400">{index + 1}.</span>
                <span className="flex min-w-0 items-center gap-1 text-xs font-bold text-white"><span className="min-w-0 truncate" title={item.account_username || undefined}>{item.account_username || '帳戶資料已清除'}</span>{item.cleared_at && <span className="shrink-0 rounded border border-slate-500/40 bg-slate-500/15 px-1 text-[9px] text-slate-300">已清除</span>}</span>
                <span className={`justify-self-end whitespace-nowrap rounded-md border px-1.5 py-1 text-[10px] font-bold leading-none ${item.deletion_source === 'admin_delete' ? 'border-rose-400/30 bg-rose-400/10 text-rose-200' : 'border-teal-400/30 bg-teal-400/10 text-teal-200'}`}>{item.deletion_source === 'admin_delete' ? '隨管理員一併刪除' : '單獨刪除員工'}</span>
                <span className="col-span-2 col-start-2 flex min-w-0 items-center gap-1 text-[11px] text-slate-300">{item.account_real_name && <><span className="min-w-0 truncate" title={item.account_real_name}>{item.account_real_name}</span><span className="text-slate-600">·</span></>}<span className="shrink-0" title={item.employee_number || undefined}>ID {item.employee_number || '—'}</span></span>
                <span className="col-span-2 col-start-2 min-w-0 truncate text-[11px] text-amber-200" title={item.owner_username || item.owner_admin_id}>所屬 {item.owner_username || item.owner_admin_id}</span>
                <span className="col-span-2 col-start-2 min-w-0 truncate text-[11px] text-sky-200" title={item.actor_username}>操作者 {item.actor_username}</span>
                <time dateTime={item.deleted_at} className="col-span-2 col-start-2 min-w-0 whitespace-nowrap text-[10px] tabular-nums text-slate-400">{displayTime(item.deleted_at)}</time>
              </button>
            </li>)}
          </ol>
          <div ref={loadMoreRef} role="status" className="py-3 text-center text-xs text-slate-400">{loading ? '載入中…' : loadError ? <button type="button" onClick={() => setRetryKey(key => key + 1)} className="text-cyan-200 underline">載入失敗，點此重試</button> : items.length < total && !lastPageLoaded ? '往下捲動載入更多' : null}</div>
          {loadError && <p role="alert" className="px-4 pb-3 text-xs text-rose-300"><AlertTriangle className="mr-1 inline h-4 w-4" />{loadError}</p>}
        </section>
        <section aria-label="員工檔案與歷史內容" className={`${selectedId ? 'flex' : 'hidden lg:flex'} min-h-0 min-w-0 flex-col bg-slate-900`}>
          {!selectedId ? <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-slate-400">從左側選擇員工，查看帳戶、手動通知及兩個工作區的完整聊天紀錄。</div> : <>
            <div className="flex shrink-0 items-center gap-3 border-b border-slate-700 bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 px-4 py-3"><button type="button" onClick={() => { setSelectedId(null); onSelectEmployee(null); }} aria-label="返回員工列表" className={`rounded-lg border border-slate-600 p-2 text-slate-200 lg:hidden ${focusClass}`}><ArrowLeft className="h-4 w-4" /></button><div className="min-w-0"><h2 className="truncate text-base font-black text-white">{detail?.account_username || items.find(item => item.id === selectedId)?.account_username || '已刪員工檔案'}</h2><p className="truncate text-xs text-cyan-200">員工 ID：{detail?.employee_number || items.find(item => item.id === selectedId)?.employee_number || '已清除'} · 所屬管理員：{detail?.owner_username || items.find(item => item.id === selectedId)?.owner_username || '—'}</p></div></div>
            <nav aria-label="員工檔案分類" className="grid shrink-0 grid-cols-4 border-b border-slate-700 bg-slate-950/75">{sections.map(([tab, label]) => <button key={tab} type="button" onClick={() => showSection(tab)} className={`min-w-0 border-b-2 px-1 py-3 text-[11px] font-bold sm:text-xs ${section === tab ? 'border-cyan-300 bg-cyan-500/15 text-white' : 'border-transparent text-slate-400 hover:bg-slate-800 hover:text-white'} ${focusClass}`}>{label}</button>)}</nav>
            <div ref={detailPaneRef} className="min-h-0 flex-1 space-y-8 overflow-y-auto p-4 scrollbar-dark sm:p-5">
              {detailLoading && !detail && <p role="status" className="py-10 text-center text-sm text-slate-400">載入員工檔案中…</p>}
              {detailError && <p role="alert" className="text-sm text-rose-300">{detailError}</p>}
              {detail && <>
                <section data-archive-section="profile" className="scroll-mt-4 space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-bold text-white">帳戶資料</h3><span className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-xs font-bold text-cyan-100"><UserRoundX className="mr-1 inline h-4 w-4" />{detail.deletion_source === 'admin_delete' ? '隨所屬管理員刪除' : '員工帳戶已移入私人檔案'}</span></div><dl className="grid grid-cols-1 gap-2 xl:grid-cols-2"><DetailField label="員工帳號" value={detail.account_username} /><DetailField label="員工姓名" value={detail.account_real_name} /><DetailField label="管理員設定的員工 ID" value={detail.employee_number} /><DetailField label="所屬管理員" value={detail.owner_username || detail.owner_admin_id} /><DetailField label="實際刪除者" value={detail.actor_username} /><DetailField label="刪除時間" value={displayTime(detail.deleted_at)} /><DetailField label="帳戶建立時間" value={displayTime(detail.account_created_at)} /><DetailField label="備註" value={detail.account_remarks} />{detail.account_summary && <><DetailField label="帳戶驗證狀態" value={detail.account_summary.is_verified ? '已驗證' : '未驗證'} /><DetailField label="歷史總收入" value={String(detail.account_summary.total_income)} /><DetailField label="錢包可用／凍結" value={`${detail.account_summary.available_balance ?? 0} / ${detail.account_summary.frozen_balance ?? 0}`} /><DetailField label="歷史訂單總數" value={detail.account_summary.total_orders.toLocaleString()} /></>}{detail.cleared_at && <><DetailField label="正式清除時間" value={displayTime(detail.cleared_at)} /><DetailField label="清除原因" value={detail.clear_reason || null} /></>}</dl>{detail.cleared_at ? <span className="text-xs text-rose-300">帳戶資料已清除</span> : <button type="button" disabled={!purgeUnlocked || clearing || windowBusy} onClick={() => onClear(detail.id)} className={`rounded-lg border border-rose-400/40 bg-rose-500/15 px-3 py-2 text-xs font-bold text-rose-200 disabled:opacity-40 ${focusClass}`}><Trash2 className="mr-1 inline h-4 w-4" />正式清除帳戶證據</button>}<p className="text-xs text-slate-400">清除帳戶資料不會清除獨立留存的通知及聊天內容。</p></section>
                <section data-archive-section="notifications" className="scroll-mt-4 border-t border-slate-700 pt-5"><h3 className="mb-3 text-sm font-bold text-white">管理員手動通知（含舊版紀錄）· {notificationTotal} 筆</h3>{notificationLoading ? <p role="status" className="py-4 text-xs text-slate-400">載入通知檔案中…</p> : notificationError ? <p role="alert" className="text-sm text-rose-300">{notificationError}</p> : notifications.length ? <ol className="space-y-2">{notifications.map(item => <li key={item.id}><button type="button" onClick={() => { setSection('notifications'); onSelectSection('notifications'); setNotificationId(item.id); }} className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-950/50 px-4 py-3 text-left text-xs text-white hover:border-cyan-400/50 ${focusClass}`}><span className="min-w-0 flex-1 truncate font-bold">{item.title || '已清除通知內容'}<span className="mt-1 block text-[11px] font-normal text-slate-400">發送者：{item.sender_username || '—'} · {item.is_read === 'true' ? '已讀' : '未讀'} · {item.audit_origin === 'manual_admin' ? '管理員手動發送' : item.audit_origin === 'automation' ? '系統自動發送' : item.audit_origin === 'unverified' ? '舊版手動發送' : '發送來源未留存'}</span></span><time className="text-[11px] text-slate-400">{displayTime(item.sent_at)}</time></button></li>)}</ol> : <p className="py-4 text-xs text-slate-400">沒有可查看的通知檔案。</p>}{notificationTotal > RELATED_PAGE_SIZE && <div className="mt-3 flex items-center justify-between text-xs text-slate-300"><span>第 {notificationPage + 1} / {Math.ceil(notificationTotal / RELATED_PAGE_SIZE)} 頁</span><span className="flex gap-2"><button type="button" disabled={notificationPage === 0} onClick={() => setNotificationPage(value => value - 1)} className={`rounded-lg border border-slate-600 px-3 py-1.5 disabled:opacity-40 ${focusClass}`}>上一頁</button><button type="button" disabled={(notificationPage + 1) * RELATED_PAGE_SIZE >= notificationTotal} onClick={() => setNotificationPage(value => value + 1)} className={`rounded-lg border border-slate-600 px-3 py-1.5 disabled:opacity-40 ${focusClass}`}>下一頁</button></span></div>}</section>
                {(['aaa_service', 'ccc_service'] as const).map(type => <section key={type} data-archive-section={type} className="scroll-mt-4 border-t border-slate-700 pt-5"><h3 className="mb-3 text-sm font-bold text-white">{type === 'aaa_service' ? '模擬客戶' : '經理'}聊天紀錄 · {related[type].total} 筆</h3>{relatedLoading[type] ? <p role="status" className="py-4 text-xs text-slate-400">載入聊天紀錄中…</p> : relatedError[type] ? <p role="alert" className="py-4 text-xs text-rose-300">{relatedError[type]}</p> : related[type].items.length ? <ol className="space-y-2">{related[type].items.map(event => <li key={event.id}><ArchivedChatCard event={event} onOpen={() => { setSection(type); onSelectSection(type); onOpenEvidence(event, detail); }} /></li>)}</ol> : <p className="py-4 text-xs text-slate-400">沒有可查看的聊天紀錄。</p>}{related[type].total > RELATED_PAGE_SIZE && <div className="mt-3 flex items-center justify-between text-xs text-slate-300"><span>第 {relatedPages[type] + 1} / {Math.ceil(related[type].total / RELATED_PAGE_SIZE)} 頁</span><span className="flex gap-2"><button type="button" disabled={relatedPages[type] === 0} onClick={() => setRelatedPages(pages => ({ ...pages, [type]: pages[type] - 1 }))} className={`rounded-lg border border-slate-600 px-3 py-1.5 disabled:opacity-40 ${focusClass}`}>上一頁</button><button type="button" disabled={(relatedPages[type] + 1) * RELATED_PAGE_SIZE >= related[type].total} onClick={() => setRelatedPages(pages => ({ ...pages, [type]: pages[type] + 1 }))} className={`rounded-lg border border-slate-600 px-3 py-1.5 disabled:opacity-40 ${focusClass}`}>下一頁</button></span></div>}</section>)}
              </>}
            </div>
          </>}
        </section>
      </div>
    </div>
    {notificationId && createPortal(<div className="fixed inset-0 z-[9000] flex items-center justify-center bg-slate-950/85 p-0 backdrop-blur-sm sm:p-5" onMouseDown={event => { if (event.target === event.currentTarget) setNotificationId(null); }}><section role="dialog" aria-modal="true" aria-label="通知檔案詳情" className="flex h-full min-h-0 w-full max-w-3xl flex-col overflow-hidden rounded-none border border-cyan-300/25 bg-slate-900 shadow-2xl sm:h-[85vh] sm:rounded-2xl"><div className="flex items-center justify-between border-b border-slate-700 px-4 py-3"><span className="text-sm font-bold text-white">員工收到的通知{notificationDetail?.cleared_at ? ' · 已清除' : ''}</span><button type="button" onClick={() => setNotificationId(null)} aria-label="關閉手動通知" className={`rounded-lg p-2 text-slate-300 hover:bg-slate-800 ${focusClass}`}><X className="h-4 w-4" /></button></div>{notificationDetailError ? <p role="alert" className="p-5 text-rose-300">{notificationDetailError}</p> : !notificationDetail ? <p role="status" className="p-5 text-slate-300">載入內容中…</p> : message ? <><div className="min-h-0 flex-1 overflow-y-auto bg-white">{/<(?:img|video|source)\b/i.test(String(message.content || '')) && <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">此通知含媒體；未建立私人附件副本的圖片或影片無法在檔案中還原。</p>}<EmployeeNotificationDetailPanel embedded readOnlyPreview onClose={() => setNotificationId(null)} message={{ title: String(message.title || ''), content: sanitizeHTML(String(message.content || ''), { allowedTags: ['p','br','span','div','strong','em','u','s','b','i','ul','ol','li','blockquote','h1','h2','h3','h4'], allowedAttributes: [] }), message_type: message.message_type === 'login_popup' ? 'login_popup' : 'realtime', priority: ['low', 'normal', 'high', 'urgent'].includes(String(message.priority)) ? message.priority as 'low'|'normal'|'high'|'urgent' : 'normal', notification_category: typeof message.notification_category === 'string' ? message.notification_category : null, reward_amount: typeof message.reward_amount === 'number' ? message.reward_amount : null, reward_currency: typeof message.reward_currency === 'string' ? message.reward_currency : null, created_at: typeof message.created_at === 'string' ? message.created_at : null, is_read: notificationDetail.recipient_data?.is_read === true }} /></div>{!notificationDetail.cleared_at && <button type="button" disabled={!purgeUnlocked || clearing || windowBusy} onClick={() => onClearNotification(notificationId)} className="shrink-0 border-t border-rose-400/30 p-3 text-xs font-bold text-rose-200 disabled:opacity-40">逐筆清除此通知證據</button>}</> : <p className="p-5 text-sm text-slate-400">此筆通知內容已正式清除。</p>}</section></div>, document.body)}
  </>;
}
