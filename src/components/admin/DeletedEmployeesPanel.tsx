import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { AlertTriangle, Search, Trash2, UserRoundX } from 'lucide-react';
import { getAdminFinancialSessionToken } from '../../lib/auth';
import { formatSupabaseError, supabase } from '../../lib/supabase';

type DeletedEmployee = {
  id: string;
  operation_id: string;
  employee_id: string;
  account_username: string | null;
  employee_number: string | null;
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

type RelatedEvidence = { id: string; operation_id: string; entity_type: 'aaa_service' | 'ccc_service'; action: 'employee_delete' | 'admin_delete'; occurred_at: string; cleared_at: string | null };
type EmployeeDetail = DeletedEmployee & { related_total: number; related_items: RelatedEvidence[] };
type Filters = { owner: string; search: string; from: string; to: string };

const emptyFilters: Filters = { owner: '', search: '', from: '', to: '' };
const PAGE_SIZE = 30;
const RELATED_PAGE_SIZE = 20;
const inputClass = 'mt-1.5 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus-visible:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400/30';
const focusClass = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950';

function displayTime(value: string | null): string {
  if (!value) return '—';
  return `${new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(new Date(value))} (UTC+8)`;
}

function dateBoundary(value: string, nextDay = false): string {
  const date = new Date(`${value}T00:00:00+08:00`);
  if (nextDay) date.setTime(date.getTime() + 86400000);
  return date.toISOString();
}

function DetailField({ label, value }: { label: string; value: string | null }) {
  return <div className="min-w-0 rounded-lg border border-slate-700 bg-slate-950/50 p-3"><dt className="text-[11px] font-semibold text-slate-400">{label}</dt><dd className="mt-1 break-all text-sm text-white">{value || '—'}</dd></div>;
}

export default function DeletedEmployeesPanel({ switcher, refreshKey, purgeUnlocked, clearing, windowBusy, onClear, onOpenEvidence }: {
  switcher: ReactNode;
  refreshKey: number;
  purgeUnlocked: boolean;
  clearing: boolean;
  windowBusy: boolean;
  onClear: (id: string) => void;
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EmployeeDetail | null>(null);
  const [relatedPage, setRelatedPage] = useState(0);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLElement>(null);

  useEffect(() => { setPage(0); }, [refreshKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    if (page === 0) { setItems([]); setTotal(0); }
    const load = async () => {
      try {
        const { data, error } = await supabase.rpc('list_deleted_employee_accounts', {
          p_admin_session_token: getAdminFinancialSessionToken(),
          p_owner: filters.owner || null,
          p_search: filters.search || null,
          p_from: filters.from ? dateBoundary(filters.from) : null,
          p_to: filters.to ? dateBoundary(filters.to, true) : null,
          p_page: page, p_page_size: PAGE_SIZE,
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
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect();
        setPage(current => current + 1);
      }
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
        });
        if (error) throw error;
        if (!data || !('id' in data)) throw new Error('找不到此帳戶刪除紀錄。');
        if (!cancelled) setDetail(data as EmployeeDetail);
      } catch (error) {
        if (!cancelled) setDetailError(formatSupabaseError(error));
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [selectedId, relatedPage, refreshKey]);

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft.from && draft.to && draft.from > draft.to) { setFilterError('結束日期不能早於開始日期。'); return; }
    setFilterError(null);
    setFilters({ ...draft, search: draft.search.trim() });
    setPage(0);
    setSelectedId(null);
    setRelatedPage(0);
  };

  const filterForm = (
    <form onSubmit={applyFilters} className="space-y-3">
      <label className="block text-xs font-semibold text-slate-300">所屬管理員
        <select className={inputClass} value={draft.owner} onChange={event => setDraft(previous => ({ ...previous, owner: event.target.value }))}>
          <option value="">全部管理員（{owners.reduce((sum, owner) => sum + owner.event_count, 0)}）</option>
          {owners.map(owner => <option key={owner.id} value={owner.id}>{owner.username}（{owner.event_count}）</option>)}
        </select>
      </label>
      <label className="block text-xs font-semibold text-slate-300">員工帳號／員工 ID
        <span className="relative block"><Search className="pointer-events-none absolute left-3 top-4 h-4 w-4 text-slate-500" aria-hidden="true" /><input className={`${inputClass} pl-9`} value={draft.search} maxLength={100} onChange={event => setDraft(previous => ({ ...previous, search: event.target.value }))} placeholder="搜尋已刪員工帳號或設定的編號" /></span>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="min-w-0 text-xs font-semibold text-slate-300">開始日期（UTC+8）<input type="date" className={`${inputClass} min-w-0 [color-scheme:dark]`} value={draft.from} onChange={event => setDraft(previous => ({ ...previous, from: event.target.value }))} /></label>
        <label className="min-w-0 text-xs font-semibold text-slate-300">結束日期（UTC+8）<input type="date" className={`${inputClass} min-w-0 [color-scheme:dark]`} value={draft.to} onChange={event => setDraft(previous => ({ ...previous, to: event.target.value }))} /></label>
      </div>
      {filterError && <p role="alert" className="text-xs text-rose-300">{filterError}</p>}
      <div className="flex gap-2 pt-1"><button type="submit" className={`flex-1 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-700 px-3 py-2 text-xs font-bold text-white ${focusClass}`}>套用篩選</button><button type="button" onClick={() => { setDraft(emptyFilters); setFilters(emptyFilters); setFilterError(null); setPage(0); setSelectedId(null); }} className={`rounded-lg border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-300 ${focusClass}`}>重設</button></div>
      <p className="text-[11px] leading-5 text-slate-400">僅列出留證功能上線後刪除的帳戶；沒有聊天記錄的員工也會列出。正式清除此帳戶資料不會清除獨立保存的聊天證據。</p>
    </form>
  );

  return <>
    <div className="shrink-0 border-b border-slate-700 bg-slate-900 px-3 py-2 lg:hidden"><details className="group max-h-[65vh] overflow-y-auto rounded-xl border border-slate-700 bg-slate-950/60 p-3"><summary className="cursor-pointer text-xs font-bold text-cyan-200">刪除員工篩選 · 帳號／管理員／日期</summary><div className="mt-3">{filterForm}</div></details></div>
    <div className="grid min-h-0 flex-1 lg:grid-cols-[270px_minmax(0,1fr)]">
      <aside className="hidden min-h-0 flex-col overflow-y-auto border-r border-slate-700 bg-slate-950 p-3 lg:flex"><div className="mb-4">{switcher}</div>{filterForm}</aside>
      <main className="flex min-h-0 min-w-0 flex-col overflow-y-auto bg-slate-900 xl:overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col xl:grid xl:grid-cols-[292px_minmax(0,1fr)]">
          <section aria-label="已刪員工帳戶清單" className="flex max-h-[42vh] min-w-0 flex-none flex-col overflow-y-auto border-b border-slate-700 xl:max-h-none xl:min-h-0 xl:border-b-0 xl:border-r">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-slate-700 bg-slate-950 px-3 py-2.5"><h2 className="text-sm font-black text-white">已刪員工帳戶</h2><span className="text-xs text-cyan-200">共 {total.toLocaleString()} 筆</span></div>
            <ol className="divide-y divide-slate-700/70">
              {items.length === 0 && !loading && !loadError && <li className="px-3 py-10 text-center text-xs text-slate-400">沒有符合條件的已刪員工。</li>}
              {items.map((item, index) => <li key={item.id}><button type="button" onClick={() => { setSelectedId(item.id); setRelatedPage(0); if (window.innerWidth < 1280) window.requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }} aria-pressed={selectedId === item.id} className={`flex w-full min-w-0 items-start gap-2 border-l-[3px] px-2.5 py-3 text-left ${selectedId === item.id ? 'border-cyan-300 bg-cyan-600/15' : 'border-transparent bg-slate-950/30 hover:bg-slate-800/80'} ${focusClass}`}><span className="w-6 shrink-0 text-right text-[11px] font-bold tabular-nums text-cyan-300">{index + 1}.</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-white">{item.account_username || '帳戶資料已正式清除'}</span><span className="mt-1 block truncate text-[11px] text-slate-300">員工 ID：{item.employee_number || '—'} · {item.owner_username || '所屬管理員'}</span><span className="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-400"><span className="truncate">刪除者：{item.actor_username}</span><time className="shrink-0">{displayTime(item.deleted_at)}</time></span></span></button></li>)}
            </ol>
            <div ref={loadMoreRef} role="status" className="shrink-0 py-2 text-center text-xs text-slate-400">{loading ? '載入中…' : loadError ? <button type="button" onClick={() => setRetryKey(key => key + 1)} className="text-cyan-200 underline">載入失敗，點此重試</button> : items.length < total ? '往下捲動載入更多' : null}</div>
            {loadError && <p role="alert" className="px-3 pb-2 text-xs text-rose-300">{loadError}</p>}
          </section>
          <section ref={detailRef} aria-label="已刪員工帳戶詳情" className="min-h-0 min-w-0 scroll-mt-2 overflow-y-auto">
            <div className="border-b border-slate-700 bg-slate-950/50 px-4 py-3"><h2 className="text-sm font-black text-white">帳戶刪除詳情</h2></div>
            {!selectedId ? <p className="px-4 py-12 text-center text-sm text-slate-400">點選左側員工查看刪除紀錄。</p> : detailLoading ? <p role="status" className="px-4 py-12 text-center text-sm text-slate-400">載入詳情中…</p> : detailError ? <p role="alert" className="px-4 py-6 text-sm text-rose-300">{detailError}</p> : detail && <div className="space-y-4 p-3 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-xs font-bold text-cyan-100"><UserRoundX className="h-4 w-4" />{detail.deletion_source === 'admin_delete' ? '隨所屬管理員刪除' : '員工帳戶刪除'}</span>{detail.cleared_at ? <span className="text-xs font-bold text-rose-300">帳戶資料已正式清除</span> : <button type="button" onClick={() => onClear(detail.id)} disabled={!purgeUnlocked || clearing || windowBusy} className={`inline-flex items-center gap-1.5 rounded-lg border border-rose-400/40 bg-rose-500/15 px-3 py-2 text-xs font-bold text-rose-200 hover:bg-rose-500/25 disabled:opacity-40 ${focusClass}`}><Trash2 className="h-4 w-4" />清除此帳戶證據</button>}</div>
              <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2"><DetailField label="員工帳號" value={detail.account_username} /><DetailField label="管理員設定的員工 ID" value={detail.employee_number} /><DetailField label="所屬管理員" value={detail.owner_username || detail.owner_admin_id} /><DetailField label="實際刪除者" value={`${detail.actor_username}（${detail.actor_role === 'super_admin' ? '超級管理員' : '管理員'}）`} /><DetailField label="刪除時間" value={displayTime(detail.deleted_at)} /><DetailField label="系統帳戶識別" value={detail.employee_id} />{detail.cleared_at && <><DetailField label="正式清除時間" value={displayTime(detail.cleared_at)} /><DetailField label="清除操作者" value={detail.cleared_username || null} /><DetailField label="清除原因" value={detail.clear_reason || null} /></>}</dl>
              <section className="rounded-xl border border-slate-700 bg-slate-950/40 p-3"><h3 className="text-xs font-black text-white">同次刪除的聊天證據 · {detail.related_total} 則</h3><p className="mt-1 text-[11px] text-slate-400">聊天證據獨立留存；清除帳戶資料不會清除這些訊息。</p>{detail.related_items.length === 0 ? <p className="py-6 text-center text-xs text-slate-400">這次刪除沒有相關聊天訊息。</p> : <ul className="mt-3 space-y-2">{detail.related_items.map((event, index) => <li key={event.id}><button type="button" onClick={() => onOpenEvidence(event, detail)} className={`flex w-full items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-left text-xs text-cyan-100 hover:border-cyan-400/50 ${focusClass}`}><span>{relatedPage * RELATED_PAGE_SIZE + index + 1}. {event.entity_type === 'aaa_service' ? '模擬客戶' : '經理'}{event.cleared_at ? ' · 內容已清除' : ''}</span><time className="shrink-0 text-[10px] text-slate-400">{displayTime(event.occurred_at)}</time></button></li>)}</ul>}{detail.related_total > RELATED_PAGE_SIZE && <div className="mt-3 flex items-center justify-between text-xs text-slate-300"><span>第 {relatedPage + 1} / {Math.ceil(detail.related_total / RELATED_PAGE_SIZE)} 頁</span><span className="flex gap-2"><button type="button" disabled={relatedPage === 0} onClick={() => setRelatedPage(page => page - 1)} className="rounded-lg border border-slate-600 px-2 py-1.5 disabled:opacity-40">上一頁</button><button type="button" disabled={(relatedPage + 1) * RELATED_PAGE_SIZE >= detail.related_total} onClick={() => setRelatedPage(page => page + 1)} className="rounded-lg border border-slate-600 px-2 py-1.5 disabled:opacity-40">下一頁</button></span></div>}</section>
            </div>}
          </section>
        </div>
      </main>
    </div>
    {!loading && loadError && items.length === 0 && <div role="alert" className="flex items-center gap-2 border-t border-rose-500/30 bg-rose-950/50 px-4 py-2 text-xs text-rose-200"><AlertTriangle className="h-4 w-4" />已刪員工清單暫時無法載入。</div>}
  </>;
}
