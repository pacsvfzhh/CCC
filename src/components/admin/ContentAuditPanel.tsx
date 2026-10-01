import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, Clock3, Database,
  FileText, Image as ImageIcon, LockKeyhole, RefreshCw, Search, ShieldCheck, Trash2,
} from 'lucide-react';
import { getAdminFinancialSessionToken } from '../../lib/auth';
import { clearAuditedContent, loadAuditedMedia } from '../../lib/contentAudit';
import { formatSupabaseError, supabase } from '../../lib/supabase';

type AuditType = 'notification' | 'aaa_service' | 'ccc_service';
type AuditAction = 'edit' | 'delete' | 'conversation_delete' | 'customer_delete' | 'employee_delete' | 'admin_delete' | 'source_edit' | 'source_delete';

interface AuditEvent {
  id: string;
  operation_id: string;
  entity_type: AuditType;
  entity_id: string;
  action: AuditAction;
  owner_admin_id: string;
  owner_username: string | null;
  actor_admin_id: string;
  actor_username: string;
  actor_role: string;
  customer_id: string | null;
  employee_id: string | null;
  occurred_at: string;
  summary: string;
  notification_origin?: 'manual_admin' | 'automation' | 'unverified' | null;
  cleared_at: string | null;
  clear_started_at: string | null;
}

interface AuditDetail extends Omit<AuditEvent, 'summary'> {
  before_data: unknown;
  after_data: unknown;
  media_refs: Record<string, string> | null;
  clear_reason: string | null;
  cleared_by: string | null;
  cleared_username: string | null;
  timeline: Array<Pick<AuditEvent, 'id' | 'action' | 'occurred_at' | 'cleared_at'>>;
}

interface AuditFilters {
  type: '' | AuditType;
  owner: string;
  actor: string;
  action: '' | AuditAction;
  search: string;
  from: string;
  to: string;
}

const PAGE_SIZE = 30;
const emptyFilters: AuditFilters = { type: '', owner: '', actor: '', action: '', search: '', from: '', to: '' };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const typeLabels: Record<AuditType, string> = {
  notification: '通知（手動／待核實）', aaa_service: 'AAA 客服', ccc_service: 'CCC 客服',
};
const actionLabels: Record<AuditAction, string> = {
  edit: '編輯', delete: '刪除', conversation_delete: '刪除對話', customer_delete: '刪除客戶',
  employee_delete: '刪除員工', admin_delete: '刪除管理員', source_edit: '編輯來源', source_delete: '刪除來源',
};
const inputClass = 'mt-1.5 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus-visible:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400/30';
const buttonFocus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950';

function formatAuditTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(date)} (UTC+8)`;
}

function localDayStart(date: string, nextDay = false): string {
  const start = new Date(`${date}T00:00:00+08:00`);
  if (nextDay) start.setTime(start.getTime() + 24 * 60 * 60 * 1000);
  return start.toISOString();
}

function Snapshot({ title, data, cleared }: { title: string; data: unknown; cleared: boolean }) {
  const snapshot = data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown> : null;
  const message = snapshot?.message && typeof snapshot.message === 'object' && !Array.isArray(snapshot.message)
    ? snapshot.message as Record<string, unknown> : null;
  const fields = [
    ['標題', message?.title], ['內容（純文字／HTML 原始碼）', message?.content ?? message?.message_content],
    ['渲染內容原始碼（不執行）', snapshot?.rendered_html],
  ].filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0);

  return (
    <section className="min-w-0 rounded-xl border border-slate-700 bg-slate-950/60 p-3">
      <h4 className="mb-2 text-xs font-bold text-cyan-200">{title}</h4>
      {data == null ? (
        <p className="text-xs text-slate-400">{cleared ? '此版本的證據內容已清除。' : '此操作沒有對應的內容快照。'}</p>
      ) : (
        <div className="space-y-3">
          {fields.map(([label, text]) => (
            <div key={label}>
              <p className="mb-1 text-[11px] font-semibold text-slate-400">{label}</p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-slate-800 bg-slate-900 p-2 text-xs leading-5 text-slate-200">{text}</pre>
            </div>
          ))}
          <details>
            <summary className="cursor-pointer text-xs font-semibold text-cyan-300">查看完整 JSON 快照（純文字）</summary>
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-slate-800 bg-slate-900 p-2 text-xs leading-5 text-slate-200">{JSON.stringify(data, null, 2)}</pre>
          </details>
        </div>
      )}
    </section>
  );
}

function EvidenceMedia({ eventId, source, path }: { eventId: string; source: string; path: string }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    };
  }, [eventId, path]);

  const load = async () => {
    if (loading || objectUrl) return;
    setLoading(true);
    setError(null);
    try {
      const media = await loadAuditedMedia(eventId, path);
      if (!activeRef.current) {
        URL.revokeObjectURL(media.url);
        return;
      }
      objectUrlRef.current = media.url;
      setMediaType(media.type);
      setObjectUrl(media.url);
    } catch (err) {
      if (activeRef.current) setError(`載入封存媒體失敗：${formatSupabaseError(err)}`);
    } finally {
      if (activeRef.current) setLoading(false);
    }
  };

  return (
    <div className="min-w-0 rounded-lg border border-slate-700 bg-slate-950/60 p-3">
      <p className="break-all text-[11px] text-slate-400">原始來源：{source}</p>
      {objectUrl && mediaType === 'video/mp4' ? <video src={objectUrl} controls preload="none" className="mt-2 max-h-64 max-w-full rounded-lg" /> : objectUrl ? <img src={objectUrl} alt="安全載入的封存證據圖片" className="mt-2 max-h-64 max-w-full rounded-lg object-contain" /> : (
        <button type="button" onClick={() => void load()} disabled={loading} className={`mt-2 inline-flex items-center gap-2 rounded-lg border border-cyan-400/35 bg-cyan-500/10 px-3 py-2 text-xs font-bold text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-50 ${buttonFocus}`}>
          <ImageIcon className="h-4 w-4" aria-hidden="true" />{loading ? '載入中…' : '安全載入封存媒體'}
        </button>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}
    </div>
  );
}

function MetadataRow({ label, value }: { label: string; value: string | null }) {
  return <div className="min-w-0 rounded-lg border border-slate-700/70 bg-slate-950/40 p-2"><dt className="text-[11px] font-semibold text-slate-400">{label}</dt><dd className="mt-1 break-all text-xs text-slate-100">{value || '—'}</dd></div>;
}

export default function ContentAuditPanel({ onBack }: { onBack: () => void }) {
  const [draft, setDraft] = useState<AuditFilters>(emptyFilters);
  const [filters, setFilters] = useState<AuditFilters>(emptyFilters);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [owners, setOwners] = useState<Array<{ id: string; username: string; event_count: number }>>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AuditDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailKey, setDetailKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [expiry, setExpiry] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [windowBusy, setWindowBusy] = useState(false);
  const [clearTarget, setClearTarget] = useState<AuditDetail | null>(null);
  const [reason, setReason] = useState('');
  const [clearing, setClearing] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);
  const expiryRef = useRef<string | null>(null);
  const enablingRef = useRef(false);
  const disposedRef = useRef(false);
  const secondsLeft = expiry ? Math.max(0, Math.ceil((new Date(expiry).getTime() - now) / 1000)) : 0;
  const purgeUnlocked = secondsLeft > 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // The dashboard keeps tabs mounted while hidden. The parent unmounts this panel on tab exit.
  useEffect(() => {
    disposedRef.current = false;
    const revoke = async () => {
      try {
        const { error: rpcError } = await supabase.rpc('set_content_audit_purge_window', {
          p_admin_session_token: getAdminFinancialSessionToken(), p_enabled: false,
        });
        if (rpcError) throw rpcError;
      } catch (err) {
        console.error('Could not revoke audit purge window:', formatSupabaseError(err));
      }
    };
    return () => {
      disposedRef.current = true;
      if (expiryRef.current || enablingRef.current) void revoke();
      expiryRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data, error: rpcError } = await supabase.rpc('list_content_audit_owners', {
          p_admin_session_token: getAdminFinancialSessionToken(),
        });
        if (rpcError) throw rpcError;
        if (!cancelled && Array.isArray(data)) setOwners(data);
      } catch (err) {
        if (!cancelled) setError(`載入管理員分組失敗：${formatSupabaseError(err)}`);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [refreshKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEvents([]);
    setTotal(0);
    const load = async () => {
      try {
        const { data, error: rpcError } = await supabase.rpc('list_content_audit_events', {
          p_admin_session_token: getAdminFinancialSessionToken(),
          p_type: filters.type || null,
          p_owner: filters.owner || null,
          p_actor: filters.actor || null,
          p_action: filters.action || null,
          p_search: filters.search || null,
          p_from: filters.from ? localDayStart(filters.from) : null,
          p_to: filters.to ? localDayStart(filters.to, true) : null,
          p_page: page, p_page_size: PAGE_SIZE,
        });
        if (rpcError) throw rpcError;
        if (!data || typeof data !== 'object' || !('items' in data) || !Array.isArray(data.items) || !('total' in data)) {
          throw new Error('稽核清單格式不正確。');
        }
        if (!cancelled) {
          setEvents(data.items as unknown as AuditEvent[]);
          setTotal(Number(data.total) || 0);
        }
      } catch (err) {
        if (!cancelled) setError(`載入稽核紀錄失敗：${formatSupabaseError(err)}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [filters, page, refreshKey]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setDetail(null);
    setDetailLoading(true);
    const load = async () => {
      try {
        const { data, error: rpcError } = await supabase.rpc('get_content_audit_event', {
          p_admin_session_token: getAdminFinancialSessionToken(), p_event_id: selectedId,
        });
        if (rpcError) throw rpcError;
        if (!data || typeof data !== 'object' || !('id' in data)) throw new Error('找不到此稽核事件。');
        if (!cancelled) setDetail(data as unknown as AuditDetail);
      } catch (err) {
        if (!cancelled) setError(`載入稽核詳情失敗：${formatSupabaseError(err)}`);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [selectedId, detailKey]);

  useEffect(() => {
    if (!expiry) return;
    const updateNow = () => setNow(Date.now());
    const timer = window.setInterval(updateNow, 1000);
    window.addEventListener('focus', updateNow);
    document.addEventListener('visibilitychange', updateNow);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', updateNow);
      document.removeEventListener('visibilitychange', updateNow);
    };
  }, [expiry]);

  useEffect(() => {
    if (!expiry || secondsLeft > 0) return;
    expiryRef.current = null;
    setExpiry(null);
    setClearTarget(null);
    setWindowBusy(true);
    // The backend independently enforces expiry; wait for the revoke before enabling again.
    void (async () => {
      try {
        const { error: rpcError } = await supabase.rpc('set_content_audit_purge_window', {
          p_admin_session_token: getAdminFinancialSessionToken(), p_enabled: false,
        });
        if (rpcError) throw rpcError;
      } catch (err) {
        console.error('Could not close expired audit purge window:', formatSupabaseError(err));
      } finally {
        if (!disposedRef.current) setWindowBusy(false);
      }
    })();
  }, [expiry, secondsLeft]);

  const lockWindow = async () => {
    const { error: rpcError } = await supabase.rpc('set_content_audit_purge_window', {
      p_admin_session_token: getAdminFinancialSessionToken(), p_enabled: false,
    });
    if (rpcError) throw rpcError;
    expiryRef.current = null;
    if (!disposedRef.current) {
      setExpiry(null);
      setClearTarget(null);
    }
  };

  const handleBack = async () => {
    if (windowBusy || clearing) return;
    if (expiryRef.current || enablingRef.current) {
      setWindowBusy(true);
      try {
        await lockWindow();
      } catch (err) {
        setError(`關閉清除模式失敗，請重試：${formatSupabaseError(err)}`);
        setWindowBusy(false);
        return;
      }
    }
    onBack();
  };

  const toggleWindow = async () => {
    if (windowBusy || clearing) return;
    setWindowBusy(true);
    setError(null);
    try {
      if (purgeUnlocked) {
        await lockWindow();
      } else {
        enablingRef.current = true;
        const { data, error: rpcError } = await supabase.rpc('set_content_audit_purge_window', {
          p_admin_session_token: getAdminFinancialSessionToken(), p_enabled: true,
        });
        if (rpcError) throw rpcError;
        if (typeof data !== 'string' || new Date(data).getTime() <= Date.now()) {
          await lockWindow();
          throw new Error('清除模式啟用時間無效。');
        }
        if (disposedRef.current) {
          // An enable response may arrive after the tab was closed; revoke it again.
          await lockWindow();
          return;
        }
        expiryRef.current = data;
        setExpiry(data);
        setNow(Date.now());
      }
    } catch (err) {
      if (!disposedRef.current) setError(`變更清除模式失敗：${formatSupabaseError(err)}`);
    } finally {
      enablingRef.current = false;
      if (!disposedRef.current) setWindowBusy(false);
    }
  };

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = { ...draft, actor: draft.actor.trim(), search: draft.search.trim() };
    if (next.actor && !uuidPattern.test(next.actor)) {
      setFilterError('操作者 ID 必須是有效的 UUID；若要搜尋名稱，請使用關鍵字。');
      return;
    }
    if (next.from && next.to && next.from > next.to) {
      setFilterError('結束日期不能早於開始日期。');
      return;
    }
    setFilterError(null);
    setFilters(next);
    setPage(0);
    setSelectedId(null);
    setDetail(null);
    setRefreshKey(key => key + 1);
  };

  const resetFilters = () => {
    setDraft(emptyFilters);
    setFilters(emptyFilters);
    setFilterError(null);
    setPage(0);
    setSelectedId(null);
    setDetail(null);
    setRefreshKey(key => key + 1);
  };

  const selectType = (type: AuditFilters['type']) => {
    const next = { ...filters, type };
    setDraft(next);
    setFilters(next);
    setPage(0);
    setSelectedId(null);
    setDetail(null);
  };

  const selectEvent = (id: string) => {
    setSelectedId(id);
    // On narrow screens the detail is stacked after the cards.
    if (window.innerWidth < 1280) window.requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const handleClear = async () => {
    const trimmed = reason.trim();
    if (!clearTarget || clearTarget.id !== selectedId || !expiryRef.current || new Date(expiryRef.current).getTime() <= Date.now() || clearing || trimmed.length < 10 || trimmed.length > 500) return;
    setClearing(true);
    setError(null);
    try {
      await clearAuditedContent(clearTarget.id, trimmed);
      if (disposedRef.current) return;
      setClearTarget(null);
      setReason('');
      setRefreshKey(key => key + 1);
      setDetailKey(key => key + 1);
      // One confirmation authorizes one record only. Lock again after a successful clear.
      try {
        await lockWindow();
      } catch (err) {
        setError(`此筆證據已清除，但無法鎖定模式，請按「立即鎖定」重試：${formatSupabaseError(err)}`);
      }
    } catch (err) {
      if (!disposedRef.current) {
        setError(`清除證據失敗：${formatSupabaseError(err)}。若已開始清除，請重新啟用模式並重試此筆事件。`);
        setRefreshKey(key => key + 1);
        setDetailKey(key => key + 1);
      }
    } finally {
      if (!disposedRef.current) setClearing(false);
    }
  };

  const filterForm = () => (
    <form onSubmit={applyFilters} className="space-y-3">
      <label className="block text-xs font-semibold text-slate-300">資料類型
        <select className={inputClass} value={draft.type} onChange={event => setDraft(previous => ({ ...previous, type: event.target.value as AuditFilters['type'] }))}>
          <option value="">全部類型</option>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="block text-xs font-semibold text-slate-300">所屬管理員
        <select className={inputClass} value={draft.owner} onChange={event => setDraft(previous => ({ ...previous, owner: event.target.value }))}>
          <option value="">全部管理員</option>{owners.map(owner => <option key={owner.id} value={owner.id}>{owner.username} · {owner.event_count} 筆</option>)}
        </select>
      </label>
      <label className="block text-xs font-semibold text-slate-300">操作者 ID（非所屬管理員）
        <input className={inputClass} value={draft.actor} onChange={event => setDraft(previous => ({ ...previous, actor: event.target.value }))} placeholder="操作者 UUID；名稱請用關鍵字" />
      </label>
      <label className="block text-xs font-semibold text-slate-300">操作類型
        <select className={inputClass} value={draft.action} onChange={event => setDraft(previous => ({ ...previous, action: event.target.value as AuditFilters['action'] }))}>
          <option value="">全部操作</option>{Object.entries(actionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="block text-xs font-semibold text-slate-300">關鍵字／事件對象 ID
        <span className="relative block"><Search className="pointer-events-none absolute left-3 top-4 h-4 w-4 text-slate-500" aria-hidden="true" /><input className={`${inputClass} pl-9`} value={draft.search} onChange={event => setDraft(previous => ({ ...previous, search: event.target.value }))} placeholder="名稱、內容、客戶或員工 ID" /></span>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="min-w-0 text-xs font-semibold text-slate-300">開始日期（UTC+8）<input type="date" className={`${inputClass} min-w-0 [color-scheme:dark]`} value={draft.from} onChange={event => setDraft(previous => ({ ...previous, from: event.target.value }))} /></label>
        <label className="min-w-0 text-xs font-semibold text-slate-300">結束日期（UTC+8）<input type="date" className={`${inputClass} min-w-0 [color-scheme:dark]`} value={draft.to} onChange={event => setDraft(previous => ({ ...previous, to: event.target.value }))} /></label>
      </div>
      {filterError && <p role="alert" className="text-xs text-rose-300">{filterError}</p>}
      <div className="flex gap-2 pt-1">
        <button type="submit" className={`flex-1 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-700 px-3 py-2 text-xs font-bold text-white hover:from-cyan-500 hover:to-blue-600 ${buttonFocus}`}>套用篩選</button>
        <button type="button" onClick={resetFilters} className={`rounded-lg border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 ${buttonFocus}`}>重設</button>
      </div>
    </form>
  );

  const media = detail && !detail.cleared_at && detail.media_refs && typeof detail.media_refs === 'object'
    ? Object.entries(detail.media_refs).filter((entry): entry is [string, string] => typeof entry[1] === 'string') : [];

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-slate-950 text-slate-100">
      <header className="shrink-0 border-b border-cyan-300/20 bg-[radial-gradient(circle_at_82%_0%,rgba(6,182,212,0.18),transparent_34%),linear-gradient(90deg,#020617_0%,#0f172a_55%,#083344_100%)] px-3 py-3 shadow-[0_8px_24px_rgba(2,6,23,0.32)] sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={() => void handleBack()} disabled={windowBusy || clearing} aria-label="返回歷史資料管理並鎖定清除模式" className={`flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-rose-400/40 bg-rose-500/15 px-2.5 text-xs font-bold text-rose-200 hover:bg-rose-500/25 disabled:opacity-50 ${buttonFocus}`}><ArrowLeft className="h-4 w-4" aria-hidden="true" />返回</button>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-500/10 text-cyan-300"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></span>
            <div className="min-w-0"><h1 className="text-lg font-black text-white sm:text-xl">內容稽核總覽</h1><p className="text-[11px] text-slate-400">手動通知與客服對話異動 · 時間均為 UTC+8</p></div>
          </div>
          <button type="button" onClick={() => setRefreshKey(key => key + 1)} disabled={loading} className={`inline-flex h-9 items-center gap-2 rounded-xl border border-cyan-300/35 bg-cyan-500/10 px-3 text-xs font-bold text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-50 ${buttonFocus}`}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />刷新清單</button>
        </div>
      </header>

      {error && <div role="alert" className="flex shrink-0 items-start gap-2 border-b border-rose-500/30 bg-rose-950/50 px-4 py-2.5 text-xs text-rose-200"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words">{error}</span><button type="button" onClick={() => setError(null)} className="ml-auto shrink-0 underline">關閉</button></div>}

      <div className="shrink-0 border-b border-slate-700 bg-slate-900 px-3 py-2 lg:hidden">
        <details className="group max-h-[65vh] overflow-y-auto rounded-xl border border-slate-700 bg-slate-950/60 p-3">
          <summary className="cursor-pointer text-xs font-bold text-cyan-200">篩選事件 · 類型／操作者／操作／日期</summary>
          <div className="mt-3">{filterForm()}</div>
        </details>
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[270px_minmax(0,1fr)]">
        <aside className="hidden min-h-0 flex-col overflow-y-auto border-r border-slate-700/90 bg-[linear-gradient(180deg,#0b1220_0%,#0b1220_48%,#111827_100%)] p-3 lg:flex">
          <div className="mb-3 flex items-center gap-2 border-b border-cyan-300/15 pb-3"><Database className="h-4 w-4 text-cyan-300" aria-hidden="true" /><h2 className="text-xs font-black text-white">稽核篩選</h2></div>
          <div className="mb-4 space-y-1">{([['', '全部事件'], ...Object.entries(typeLabels)] as Array<[AuditFilters['type'], string]>).map(([type, label]) => (
            <button key={type} type="button" onClick={() => selectType(type)} aria-pressed={filters.type === type} className={`w-full rounded-lg px-3 py-2 text-left text-xs font-bold ${filters.type === type ? 'bg-gradient-to-r from-cyan-700 to-blue-800 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'} ${buttonFocus}`}>{label}</button>
          ))}</div>
          {filterForm()}
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col overflow-y-auto bg-slate-900 xl:overflow-hidden">
          <section aria-label="證據清除模式" className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-700 bg-slate-950/65 px-3 py-3 sm:px-4">
            <div className="flex min-w-0 items-center gap-2"><LockKeyhole className={`h-4 w-4 shrink-0 ${purgeUnlocked ? 'text-amber-300' : 'text-emerald-300'}`} aria-hidden="true" /><div><p className="text-xs font-bold text-white">清除模式：{purgeUnlocked ? '限時開啟' : '已鎖定'}</p><p className="text-[11px] text-slate-400">{purgeUnlocked ? `剩餘 ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')} · 到期 ${formatAuditTime(expiry)}` : '僅超級管理員可啟用；五分鐘後自動鎖定'}</p></div></div>
            <button type="button" onClick={() => void toggleWindow()} disabled={windowBusy || clearing} className={`rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-50 ${purgeUnlocked ? 'border-rose-400/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25' : 'border-amber-400/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'} ${buttonFocus}`}>{windowBusy ? '處理中…' : purgeUnlocked ? '立即鎖定' : '啟用五分鐘清除模式'}</button>
          </section>
          <div className="flex min-h-0 flex-1 flex-col xl:grid xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <section aria-label="稽核事件清單" className="flex min-w-0 flex-none flex-col border-b border-slate-700 xl:min-h-0 xl:border-b-0 xl:border-r xl:overflow-y-auto">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-700 bg-slate-950/50 px-4 py-3"><h2 className="text-sm font-black text-white">異動紀錄</h2><span className="text-xs text-cyan-200">共 {total.toLocaleString()} 筆</span></div>
              <div className="space-y-2.5 p-3 sm:p-4 xl:min-h-0 xl:flex-1">
                {loading ? <p role="status" className="py-12 text-center text-sm text-slate-400">載入稽核紀錄中…</p> : events.length === 0 ? <p className="py-12 text-center text-sm text-slate-400">沒有符合條件的稽核紀錄。</p> : events.map(item => (
                  <button key={item.id} type="button" onClick={() => selectEvent(item.id)} aria-pressed={selectedId === item.id} className={`w-full min-w-0 rounded-xl border p-3 text-left transition-colors ${selectedId === item.id ? 'border-cyan-300/70 bg-cyan-600/20' : 'border-slate-700 bg-slate-950/60 hover:border-cyan-400/35 hover:bg-slate-800'} ${buttonFocus}`}>
                    <span className="flex flex-wrap items-center justify-between gap-2"><span className="inline-flex items-center gap-2"><FileText className="h-4 w-4 text-cyan-300" aria-hidden="true" /><strong className="text-xs text-white">{item.entity_type === 'notification' ? item.notification_origin === 'manual_admin' ? '手動通知' : item.notification_origin === 'unverified' ? '通知 · 來源待核實' : '通知' : typeLabels[item.entity_type] ?? item.entity_type}</strong><span className="rounded-md bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-100">{actionLabels[item.action] ?? item.action}</span></span>{item.cleared_at ? <span className="text-[10px] font-bold text-rose-300">證據已清除</span> : item.clear_started_at ? <span className="text-[10px] font-bold text-amber-300">清除未完成</span> : <span className="text-[10px] text-emerald-300">證據保留中</span>}</span>
                    <span className="mt-2 block break-words text-xs leading-5 text-slate-300">{item.summary || '（無摘要）'}</span>
                    <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400"><span>操作者：<strong className="text-slate-200">{item.actor_username}</strong></span><span>所屬管理員：<span className="break-all text-slate-300">{item.owner_username || item.owner_admin_id}</span></span></span>
                    <span className="mt-2 block text-[11px] tabular-nums text-cyan-200"><Clock3 className="mr-1 inline h-3 w-3" aria-hidden="true" />{formatAuditTime(item.occurred_at)}</span>
                  </button>
                ))}
              </div>
              <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-700 bg-slate-950/50 px-3 py-3 text-xs text-slate-300 sm:px-4">
                <span>{total === 0 ? '0 筆' : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} / ${total}`} · 第 {page + 1} / {pageCount} 頁</span>
                <span className="flex gap-1"><button type="button" onClick={() => { setPage(value => value - 1); setSelectedId(null); setDetail(null); }} disabled={loading || page === 0} aria-label="上一頁" className={`rounded-lg border border-slate-600 p-1.5 hover:bg-slate-800 disabled:opacity-40 ${buttonFocus}`}><ChevronLeft className="h-4 w-4" /></button><button type="button" onClick={() => { setPage(value => value + 1); setSelectedId(null); setDetail(null); }} disabled={loading || page + 1 >= pageCount} aria-label="下一頁" className={`rounded-lg border border-slate-600 p-1.5 hover:bg-slate-800 disabled:opacity-40 ${buttonFocus}`}><ChevronRight className="h-4 w-4" /></button></span>
              </div>
            </section>

            <section ref={detailRef} aria-label="稽核事件詳情" className="min-h-0 min-w-0 scroll-mt-2 xl:overflow-y-auto">
              <div className="border-b border-slate-700 bg-slate-950/50 px-4 py-3"><h2 className="text-sm font-black text-white">事件詳情與版本歷程</h2></div>
              {!selectedId ? <p className="px-4 py-12 text-center text-sm text-slate-400">選取一筆事件，查看異動前後的證據與版本歷程。</p> : detailLoading ? <p role="status" className="px-4 py-12 text-center text-sm text-slate-400">載入詳情中…</p> : !detail ? <p className="px-4 py-12 text-center text-sm text-slate-400">無法顯示此事件。請重新選取或刷新。</p> : (
                <div className="min-w-0 space-y-4 p-3 sm:p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1 text-xs font-bold text-cyan-100">{typeLabels[detail.entity_type] ?? detail.entity_type} · {actionLabels[detail.action] ?? detail.action}</span>{detail.cleared_at ? <span className="text-xs font-bold text-rose-300">證據已清除</span> : <button type="button" onClick={() => { setReason(''); setClearTarget(detail); }} disabled={!purgeUnlocked || clearing || windowBusy} className={`inline-flex items-center gap-1.5 rounded-lg border border-rose-400/40 bg-rose-500/15 px-3 py-2 text-xs font-bold text-rose-200 hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-40 ${buttonFocus}`}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />清除此筆證據</button>}</div>
                  <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2"><MetadataRow label="事件 ID" value={detail.id} /><MetadataRow label="操作批次 ID" value={detail.operation_id} /><MetadataRow label="對象 ID" value={detail.entity_id} /><MetadataRow label="發生時間 (UTC+8)" value={formatAuditTime(detail.occurred_at)} /><MetadataRow label="操作者（實際執行異動）" value={`${detail.actor_username} · ${detail.actor_role} · ${detail.actor_admin_id}`} /><MetadataRow label="所屬管理員（資料擁有者）" value={`${detail.owner_username ?? '—'} · ${detail.owner_admin_id}`} /><MetadataRow label="客戶 ID" value={detail.customer_id} /><MetadataRow label="員工 ID" value={detail.employee_id} /><MetadataRow label="清除開始 (UTC+8)" value={detail.clear_started_at ? formatAuditTime(detail.clear_started_at) : null} /><MetadataRow label="清除完成 (UTC+8)" value={detail.cleared_at ? formatAuditTime(detail.cleared_at) : null} />{detail.clear_reason && <MetadataRow label="清除原因" value={detail.clear_reason} />}{detail.cleared_by && <MetadataRow label="清除操作者" value={`${detail.cleared_username ?? '—'} · ${detail.cleared_by}`} />}</dl>
                  <div className="grid min-w-0 gap-3"><Snapshot title="異動前" data={detail.before_data} cleared={Boolean(detail.cleared_at)} /><Snapshot title="異動後" data={detail.after_data} cleared={Boolean(detail.cleared_at)} /></div>
                  {media.length > 0 && <section><h3 className="mb-2 flex items-center gap-2 text-xs font-bold text-white"><ImageIcon className="h-4 w-4 text-cyan-300" aria-hidden="true" />封存媒體 · {media.length} 個</h3><p className="mb-2 text-[11px] text-slate-400">附件僅透過安全驗證請求取得，原始網址只作文字參考。</p><div className="space-y-2">{media.map(([source, path]) => <EvidenceMedia key={`${detail.id}:${path}`} eventId={detail.id} source={source} path={path} />)}</div></section>}
                  <section><h3 className="mb-2 text-xs font-bold text-white">同一對象的版本歷程</h3><div className="space-y-1.5">{(detail.timeline ?? []).map(version => <button key={version.id} type="button" onClick={() => selectEvent(version.id)} aria-pressed={version.id === detail.id} className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs ${version.id === detail.id ? 'border-cyan-400/50 bg-cyan-500/15 text-white' : 'border-slate-700 bg-slate-950/50 text-slate-300 hover:bg-slate-800'} ${buttonFocus}`}><span>{actionLabels[version.action] ?? version.action}{version.cleared_at ? ' · 已清除' : ''}</span><span className="tabular-nums">{formatAuditTime(version.occurred_at)}</span></button>)}</div></section>
                </div>
              )}
            </section>
          </div>
        </main>
      </div>

      {clearTarget && purgeUnlocked && <div role="presentation" className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/85 p-3 backdrop-blur-sm sm:p-5"><div role="dialog" aria-modal="true" aria-labelledby="audit-clear-title" className="w-full max-w-lg rounded-2xl border border-rose-400/40 bg-slate-900 p-5 shadow-2xl"><div className="flex items-center gap-2 text-rose-200"><AlertTriangle className="h-5 w-5" aria-hidden="true" /><h2 id="audit-clear-title" className="text-base font-black">確認清除此筆稽核證據</h2></div><p className="mt-3 break-all text-xs text-slate-300">事件 ID：{clearTarget.id}</p><p className="mt-2 text-xs leading-5 text-rose-200">此操作只會清除此筆事件的快照與專屬封存圖片，無法復原。稽核事件的身分、時間與清除原因仍會保留。每次只確認一筆。</p><label className="mt-4 block text-xs font-bold text-slate-200">清除原因（10–500 字）<textarea autoFocus rows={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="請說明清除此筆證據的原因" className={`${inputClass} resize-y`} /></label>{error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}<p className="mt-1 text-[11px] text-slate-400">目前 {reason.trim().length} 字 · 模式剩餘 {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setClearTarget(null)} disabled={clearing} className={`rounded-lg border border-slate-600 px-4 py-2 text-xs font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-50 ${buttonFocus}`}>取消</button><button type="button" onClick={() => void handleClear()} disabled={clearing || reason.trim().length < 10 || reason.trim().length > 500 || !purgeUnlocked} className={`rounded-lg bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40 ${buttonFocus}`}>{clearing ? '清除中…' : '確認清除此筆'}</button></div></div></div>}
    </div>
  );
}
