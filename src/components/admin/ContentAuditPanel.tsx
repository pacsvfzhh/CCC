import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, Clock3, Database,
  FileText, Gift, Image as ImageIcon, LockKeyhole, Megaphone, MessageCircle, RefreshCw, Search, ShieldCheck, Star, Trash2, User, X,
} from 'lucide-react';
import { getAdminFinancialSessionToken } from '../../lib/auth';
import { clearAuditedContent, loadAuditedMedia } from '../../lib/contentAudit';
import { sanitizeHTML } from '../../lib/sanitizeHTML';
import { formatSupabaseError, supabase } from '../../lib/supabase';
import EmployeeNotificationDetailPanel from '../employee/EmployeeNotificationDetailPanel';

type AuditType = 'notification' | 'aaa_service' | 'ccc_service';
type AuditAction = 'edit' | 'delete' | 'conversation_delete' | 'customer_delete' | 'employee_delete' | 'admin_delete' | 'source_edit' | 'source_delete';

interface AuditEvent {
  id: string;
  card_id: string;
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
  employee_account: string | null;
  message_count: number;
  cleared_count: number;
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

interface ConversationMessage {
  id: string;
  created_at: string | null;
  sender_type: string | null;
  message_type: string | null;
  message_content: string | null;
  image_url: string | null;
  title: string | null;
  subtitle: string | null;
  rating_data: Record<string, unknown> | null;
  rendered_html: string | null;
  media_refs: Record<string, string>;
  cleared_at: string | null;
  clear_started_at: string | null;
  customer_name?: string | null;
  employee_name?: string | null;
}

interface ConversationDetail {
  operation_id: string;
  entity_type: AuditType;
  occurred_at: string;
  employee_account: string;
  employee_id: string;
  total: number;
  items: ConversationMessage[];
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
const TRANSCRIPT_PAGE_SIZE = 100;
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

const displayTags = [
  'p', 'br', 'div', 'span', 'strong', 'em', 'u', 'b', 'i', 's', 'h1', 'h2', 'h3', 'h4',
  'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'hr',
];

function safeDisplayHtml(value: string): string {
  return sanitizeHTML(value, { allowedTags: displayTags, allowedAttributes: [] });
}

function readableText(value: string | null): string {
  if (!value) return '';
  const document = new DOMParser().parseFromString(safeDisplayHtml(value), 'text/html');
  document.querySelectorAll('br').forEach(element => element.replaceWith('\n'));
  document.querySelectorAll('p, div, li, h1, h2, h3, h4, blockquote, tr').forEach(element => element.append('\n'));
  return (document.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

function ArchivedRichContent({ html, eventId, mediaRefs }: { html: string; eventId: string; mediaRefs: Record<string, string> }) {
  const parts = html.split(/(<img\b[^>]*>|<video\b[\s\S]*?<\/video>)/gi);
  const media = Object.entries(mediaRefs);
  const inlinePaths = new Set(parts.filter(part => /^<(img|video)\b/i.test(part)).flatMap(part =>
    media.filter(([source]) => part.includes(source) || part.includes(source.replace(/&/g, '&amp;'))).map(([, path]) => path)));

  return <div className="chat-rich-content min-w-0 break-words text-sm leading-6 [&_p]:my-1 [&_ul]:ml-4 [&_ul]:list-disc [&_ol]:ml-4 [&_ol]:list-decimal" style={{ overflowWrap: 'anywhere' }}>
    {parts.map((part, index) => /^<(img|video)\b/i.test(part) ? (
      media.filter(([source]) => part.includes(source) || part.includes(source.replace(/&/g, '&amp;'))).length > 0
        ? media.filter(([source]) => part.includes(source) || part.includes(source.replace(/&/g, '&amp;'))).map(([, path]) => <EvidenceMedia key={`${index}:${path}`} eventId={eventId} path={path} />)
        : <p key={index} className="text-xs opacity-70">圖片檔案無法還原。</p>
    ) : part ? <div key={index} className="whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: safeDisplayHtml(part) }} /> : null)}
    {media.filter(([, path]) => !inlinePaths.has(path)).map(([, path]) => <EvidenceMedia key={path} eventId={eventId} path={path} />)}
  </div>;
}

function ConversationTranscript({ message, senderName, workspace, purgeUnlocked, onClear }: {
  message: ConversationMessage;
  senderName: string;
  workspace: AuditType;
  purgeUnlocked: boolean;
  onClear: (id: string) => void;
}) {
  const [cardOpen, setCardOpen] = useState(false);
  const isCustomer = message.sender_type === 'customer';
  const rating = message.rating_data;
  const cardHtml = message.rendered_html || (message.message_content && /<[a-z][\s\S]*>/i.test(message.message_content) ? message.message_content : null);
  const accent = workspace === 'aaa_service' ? 'border-orange-300/35' : 'border-emerald-300/35';
  const attachments = Object.fromEntries(Object.entries(message.media_refs || {}).filter(([source]) =>
    [message.image_url, message.message_content, message.rendered_html].some(value =>
      value?.includes(source) || value?.includes(source.replace(/&/g, '&amp;')))));

  useEffect(() => {
    if (!cardOpen) return;
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setCardOpen(false); };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [cardOpen]);

  return (
    <>
      <div className={`flex min-w-0 ${isCustomer ? 'justify-end' : 'justify-start'}`}>
        <div className={`min-w-0 ${message.message_type === 'rich_card' ? 'w-[240px] max-w-[85%]' : 'max-w-[85%] sm:max-w-[75%]'}`}>
          {message.message_type === 'rich_card' && !message.cleared_at ? (
            <button type="button" onClick={() => setCardOpen(true)} className={`w-full overflow-hidden rounded-2xl text-left shadow-[0_2px_12px_rgba(37,99,246,0.15)] transition hover:scale-[1.015] hover:shadow-[0_8px_24px_rgba(37,99,246,0.22)] ${buttonFocus}`}>
              <span className="flex items-start gap-2.5 bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700 px-4 pb-3.5 pt-4 text-white"><Megaphone className="mt-0.5 h-5 w-5 shrink-0" /><span className="min-w-0"><strong className="block break-words text-[13px] leading-snug">{message.title ? readableText(message.title) : '查看詳情'}</strong>{message.subtitle && <span className="mt-1 block break-words text-[11px] text-blue-100/80">{readableText(message.subtitle)}</span>}</span></span>
              <span className="flex items-center justify-between border-t border-blue-100 bg-white px-4 py-2 text-[11px] font-medium text-blue-600">查看詳情<ChevronRight className="h-4 w-4 text-blue-400" /></span>
            </button>
          ) : (
            <div className={`rounded-[20px] border-2 px-4 py-3 shadow-lg ${isCustomer ? 'rounded-tr-md border-slate-200 bg-white text-slate-800' : `rounded-tl-md bg-gradient-to-br from-slate-800 via-slate-800 to-slate-900 text-slate-100 ${accent}`}`}>
              <div className={`mb-2 border-b pb-1.5 text-xs font-semibold ${isCustomer ? 'border-slate-200 text-blue-700' : 'border-white/15 text-white'}`}>{senderName}</div>
              {message.cleared_at ? <p className="text-xs opacity-70">此則內容已正式清除。</p> : (
                <>
                  {message.message_type === 'rating_request' && <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-blue-700"><Star className="mr-1 inline h-4 w-4" />評分請求</div>}
                  {message.message_type === 'rating_result' && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800"><strong>服務評分</strong><div className="my-1 flex gap-0.5">{[1, 2, 3, 4, 5].map(star => <Star key={star} className={`h-4 w-4 ${star <= Number(rating?.rating || 0) ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />)}</div>{typeof rating?.comment === 'string' && <p className="whitespace-pre-wrap break-words text-xs">{rating.comment}</p>}</div>}
                  {message.message_type === 'tip' && <div className="rounded-xl border border-amber-300 bg-gradient-to-br from-amber-950 to-orange-900 px-4 py-3 text-amber-100"><Gift className="mr-2 inline h-4 w-4" />已送出打賞 <strong className="ml-2 text-lg text-white">${typeof rating?.tip_amount === 'number' ? rating.tip_amount.toFixed(2) : '—'}</strong></div>}
                  {message.message_type === 'image' ? (message.image_url && attachments[message.image_url] ? <EvidenceMedia eventId={message.id} path={attachments[message.image_url]} /> : <p className="text-xs opacity-70">圖片檔案無法還原。</p>) : !['rating_request', 'rating_result', 'tip'].includes(message.message_type || '') && <ArchivedRichContent html={message.message_content || ''} eventId={message.id} mediaRefs={attachments} />}
                </>
              )}
              {purgeUnlocked && !message.cleared_at && <button type="button" onClick={() => onClear(message.id)} className={`mt-3 rounded-lg border border-rose-400/40 px-2 py-1 text-xs text-rose-500 hover:bg-rose-500/10 ${buttonFocus}`}>清除此則證據</button>}
            </div>
          )}
          {message.created_at && <time className={`mt-1 block text-[10px] ${isCustomer ? 'text-right text-slate-400' : 'text-slate-500'}`}>{formatAuditTime(message.created_at)}</time>}
          {message.message_type === 'rich_card' && purgeUnlocked && !message.cleared_at && <button type="button" onClick={() => onClear(message.id)} className={`mt-2 rounded-lg border border-rose-400/40 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/10 ${buttonFocus}`}>清除此則證據</button>}
        </div>
      </div>
      {cardOpen && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm xl:p-6" onClick={() => setCardOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby={`audit-card-${message.id}`} className="flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl xl:h-auto xl:max-h-[85vh] xl:w-[680px] xl:rounded-2xl" onClick={event => event.stopPropagation()}>
            <div className="relative shrink-0 bg-gradient-to-br from-blue-800 via-blue-600 to-blue-700 px-5 pb-5 pt-6 text-white">
              <button type="button" autoFocus onClick={() => setCardOpen(false)} aria-label="關閉卡片詳情" className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/15 hover:bg-white/25"><X className="h-4 w-4" /></button>
              {message.created_at && <p className="mb-3 text-xs text-blue-100">{formatAuditTime(message.created_at)}</p>}
              <div className="flex items-start gap-3 pr-10"><span className="rounded-xl border border-white/20 bg-white/15 p-2.5"><Megaphone className="h-6 w-6" /></span><div className="min-w-0"><h2 id={`audit-card-${message.id}`} className="break-words text-lg font-bold">{message.title ? readableText(message.title) : '訊息卡片'}</h2>{message.subtitle && <p className="mt-1 break-words text-sm text-blue-100">{readableText(message.subtitle)}</p>}</div></div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5 text-slate-700 sm:p-6">
              {cardHtml ? <ArchivedRichContent html={cardHtml} eventId={message.id} mediaRefs={attachments} /> : <p className="text-sm text-slate-500">此卡片的內容無法還原。</p>}
            </div>
            <div className="shrink-0 border-t border-slate-100 bg-slate-50 px-5 py-3"><button type="button" onClick={() => setCardOpen(false)} className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-5 py-3 text-sm font-semibold text-white hover:from-blue-700 hover:to-blue-600">關閉</button></div>
          </div>
        </div>, document.body,
      )}
    </>
  );
}

function Snapshot({ title, data, cleared, type, eventId, mediaRefs, employeeAccount }: {
  title: string;
  data: unknown;
  cleared: boolean;
  type: AuditType;
  eventId: string;
  mediaRefs: Record<string, string> | null;
  employeeAccount: string | null;
}) {
  const snapshot = data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown> : null;
  const message = snapshot?.message && typeof snapshot.message === 'object' && !Array.isArray(snapshot.message)
    ? snapshot.message as Record<string, unknown> : null;
  const snapshotText = JSON.stringify(data) ?? '';
  const refs = Object.fromEntries(Object.entries(mediaRefs || {}).filter(([source, path]) =>
    typeof path === 'string' && (snapshotText.includes(source) || snapshotText.includes(source.replace(/&/g, '&amp;')))));

  if (!message) return <p className="text-xs text-slate-400">{cleared ? '此內容已正式清除。' : '沒有可顯示的內容。'}</p>;

  if (type === 'notification') {
    const recipients = Array.isArray(snapshot?.recipients) ? snapshot.recipients as Array<Record<string, unknown>> : null;
    const priority = String(message.priority);
    return (
      <section className="min-w-0 overflow-hidden rounded-xl border border-slate-700 bg-slate-950/60">
        <h4 className="px-3 py-2 text-xs font-bold text-cyan-200">{title}</h4>
        <div className="h-[390px] max-w-full overflow-hidden">
          <EmployeeNotificationDetailPanel embedded readOnlyPreview onClose={() => {}} message={{
            title: String(message.title || ''), content: safeDisplayHtml(String(message.content || '')),
            message_type: message.message_type === 'login_popup' ? 'login_popup' : 'realtime',
            priority: priority === 'low' || priority === 'high' || priority === 'urgent' ? priority : 'normal',
            notification_category: typeof message.notification_category === 'string' ? message.notification_category : null,
            reward_amount: typeof message.reward_amount === 'number' ? message.reward_amount : null,
            reward_currency: typeof message.reward_currency === 'string' ? message.reward_currency : null,
            created_at: typeof message.created_at === 'string' ? message.created_at : null,
            is_read: false,
          }} />
        </div>
        {(recipients || Object.keys(refs).length > 0) && <div className="space-y-2 border-t border-slate-700 p-3 text-xs text-slate-300">
          {recipients && <p>收件人 {recipients.length} 位 · 已讀 {recipients.filter(item => item.is_read === true).length} 位</p>}
          {Object.entries(refs).map(([, path]) => <EvidenceMedia key={`${eventId}:${path}`} eventId={eventId} path={path} />)}
        </div>}
      </section>
    );
  }

  const chat: ConversationMessage = {
    id: eventId,
    created_at: typeof message.created_at === 'string' ? message.created_at : null,
    sender_type: typeof message.sender_type === 'string' ? message.sender_type : null,
    message_type: typeof message.message_type === 'string' ? message.message_type : null,
    message_content: typeof message.message_content === 'string' ? message.message_content : null,
    image_url: typeof message.image_url === 'string' ? message.image_url : null,
    title: typeof message.title === 'string' ? message.title : null,
    subtitle: typeof message.subtitle === 'string' ? message.subtitle : null,
    rating_data: message.rating_data && typeof message.rating_data === 'object' && !Array.isArray(message.rating_data) ? message.rating_data as Record<string, unknown> : null,
    rendered_html: typeof snapshot?.rendered_html === 'string' ? snapshot.rendered_html : null,
    media_refs: refs,
    cleared_at: null,
    clear_started_at: null,
  };

  return <section className="min-w-0 rounded-xl border border-slate-700 bg-slate-950/40 p-3"><h4 className="mb-3 text-xs font-bold text-cyan-200">{title}</h4><ConversationTranscript message={chat} senderName={chat.sender_type === 'customer' ? String(snapshot?.customer_name || '客戶') : String(snapshot?.employee_name || employeeAccount || '員工')} workspace={type} purgeUnlocked={false} onClear={() => {}} /></section>;
}

function EvidenceMedia({ eventId, path }: { eventId: string; path: string }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    };
  }, [eventId, path]);

  const load = useCallback(async () => {
    if (loadingRef.current || objectUrlRef.current) return;
    loadingRef.current = true;
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
      if (activeRef.current) setError(`載入圖片失敗：${formatSupabaseError(err)}`);
    } finally {
      loadingRef.current = false;
      if (activeRef.current) setLoading(false);
    }
  }, [eventId, path]);

  useEffect(() => {
    if (!expanded) return;
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [expanded]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        void load();
        observer.disconnect();
      }
    }, { rootMargin: '160px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [load]);

  return (
    <div ref={containerRef} className="min-w-0">
      {objectUrl && mediaType === 'video/mp4' ? <video src={objectUrl} controls preload="none" className="max-h-64 max-w-full rounded-lg" /> : objectUrl ? <button type="button" onClick={() => setExpanded(true)} aria-label="放大圖片" className={`block max-w-full rounded-lg ${buttonFocus}`}><img src={objectUrl} alt="封存圖片，點擊放大" className="max-h-64 max-w-full rounded-lg object-contain" /></button> : (
        <button type="button" onClick={() => void load()} disabled={loading} className={`inline-flex items-center gap-2 rounded-lg border border-cyan-400/35 bg-cyan-500/10 px-3 py-2 text-xs font-bold text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-50 ${buttonFocus}`}>
          <ImageIcon className="h-4 w-4" aria-hidden="true" />{loading ? '圖片載入中…' : error ? '重試載入圖片' : '查看圖片'}
        </button>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}
      {expanded && objectUrl && createPortal(<div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/90 p-4" onClick={() => setExpanded(false)}><div role="dialog" aria-modal="true" aria-label="圖片預覽" className="relative flex max-h-full max-w-full items-center" onClick={event => event.stopPropagation()}><button type="button" autoFocus onClick={() => setExpanded(false)} aria-label="關閉圖片預覽" className="absolute -right-2 -top-11 rounded-full bg-white/15 p-2 text-white hover:bg-white/30"><X className="h-5 w-5" /></button><img src={objectUrl} alt="封存圖片預覽" className="max-h-[85vh] max-w-[95vw] object-contain" /></div></div>, document.body)}
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
  const [selectedCard, setSelectedCard] = useState<AuditEvent | null>(null);
  const [detail, setDetail] = useState<AuditDetail | null>(null);
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [conversationPage, setConversationPage] = useState(0);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailKey, setDetailKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [expiry, setExpiry] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [windowBusy, setWindowBusy] = useState(false);
  const [clearTarget, setClearTarget] = useState<{ id: string } | null>(null);
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
        const { data, error: rpcError } = await supabase.rpc('list_content_audit_cards', {
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
    if (!selectedCard) return;
    let cancelled = false;
    setDetail(null);
    setConversation(null);
    setDetailLoading(true);
    const load = async () => {
      try {
        if (selectedCard.card_id.startsWith('conversation:') && selectedCard.customer_id && selectedCard.employee_id) {
          const { data, error: rpcError } = await supabase.rpc('get_content_audit_conversation', {
            p_admin_session_token: getAdminFinancialSessionToken(),
            p_operation_id: selectedCard.operation_id,
            p_type: selectedCard.entity_type,
            p_customer_id: selectedCard.customer_id,
            p_employee_id: selectedCard.employee_id,
            p_page: conversationPage,
            p_page_size: TRANSCRIPT_PAGE_SIZE,
          });
          if (rpcError) throw rpcError;
          if (!data || typeof data !== 'object' || !('items' in data)) throw new Error('找不到此對話。');
          if (!cancelled) setConversation(data as unknown as ConversationDetail);
        } else {
          const { data, error: rpcError } = await supabase.rpc('get_content_audit_event', {
            p_admin_session_token: getAdminFinancialSessionToken(), p_event_id: selectedCard.id,
          });
          if (rpcError) throw rpcError;
          if (!data || typeof data !== 'object' || !('id' in data)) throw new Error('找不到此稽核事件。');
          if (!cancelled) setDetail(data as unknown as AuditDetail);
        }
      } catch (err) {
        if (!cancelled) setError(`載入稽核詳情失敗：${formatSupabaseError(err)}`);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [selectedCard, conversationPage, detailKey]);

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
    setSelectedCard(null);
    setDetail(null);
    setConversation(null);
    setConversationPage(0);
    setRefreshKey(key => key + 1);
  };

  const resetFilters = () => {
    setDraft(emptyFilters);
    setFilters(emptyFilters);
    setFilterError(null);
    setPage(0);
    setSelectedId(null);
    setSelectedCard(null);
    setDetail(null);
    setConversation(null);
    setConversationPage(0);
    setRefreshKey(key => key + 1);
  };

  const selectType = (type: AuditFilters['type']) => {
    const next = { ...filters, type };
    setDraft(next);
    setFilters(next);
    setPage(0);
    setSelectedId(null);
    setSelectedCard(null);
    setDetail(null);
    setConversation(null);
    setConversationPage(0);
  };

  const selectEvent = (id: string) => {
    const version = detail?.timeline.find(item => item.id === id);
    const card = events.find(item => item.card_id === id || item.id === id)
      ?? (detail && version ? {
        ...detail, ...version, card_id: `event:${id}`, summary: '', message_count: 1,
        cleared_count: version.cleared_at ? 1 : 0,
      } : null);
    if (!card) return;
    setSelectedCard(card);
    setSelectedId(card.card_id);
    setConversationPage(0);
    // On narrow screens the detail is stacked after the cards.
    if (window.innerWidth < 1280) window.requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const handleClear = async () => {
    const trimmed = reason.trim();
    if (!clearTarget || (!conversation?.items.some(item => item.id === clearTarget.id) && clearTarget.id !== selectedCard?.id) || !expiryRef.current || new Date(expiryRef.current).getTime() <= Date.now() || clearing || trimmed.length < 10 || trimmed.length > 500) return;
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
          <option value="">全部管理員</option>{owners.map(owner => <option key={owner.id} value={owner.id}>{owner.username}</option>)}
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
                  <button key={item.card_id} type="button" onClick={() => selectEvent(item.card_id)} aria-pressed={selectedId === item.card_id} className={`w-full min-w-0 rounded-xl border p-3 text-left transition-colors ${selectedId === item.card_id ? 'border-cyan-300/70 bg-cyan-600/20' : 'border-slate-700 bg-slate-950/60 hover:border-cyan-400/35 hover:bg-slate-800'} ${buttonFocus}`}>
                    <span className="flex flex-wrap items-center justify-between gap-2"><span className="inline-flex items-center gap-2"><FileText className="h-4 w-4 text-cyan-300" aria-hidden="true" /><strong className="text-xs text-white">{item.entity_type === 'notification' ? item.notification_origin === 'manual_admin' ? '手動通知' : item.notification_origin === 'unverified' ? '通知 · 來源待核實' : '通知' : typeLabels[item.entity_type] ?? item.entity_type}</strong><span className="rounded-md bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-100">{actionLabels[item.action] ?? item.action}</span></span>{item.cleared_count === item.message_count ? <span className="text-[10px] font-bold text-rose-300">證據已清除</span> : item.cleared_count > 0 ? <span className="text-[10px] font-bold text-amber-300">已清除 {item.cleared_count} / {item.message_count} 則</span> : item.clear_started_at ? <span className="text-[10px] font-bold text-amber-300">清除未完成</span> : <span className="text-[10px] text-emerald-300">證據保留中</span>}</span>
                    <span className="mt-2 block break-words text-xs leading-5 text-slate-300">{item.action === 'conversation_delete' ? `完整對話 · ${item.message_count} 則訊息` : readableText(item.summary) || '（無摘要）'}</span>
                    <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">{item.action === 'conversation_delete' && <span>員工：<strong className="text-slate-200">{item.employee_account || item.employee_id || '—'}</strong></span>}<span>操作者：<strong className="text-slate-200">{item.actor_username}</strong></span><span>所屬管理員：<span className="break-all text-slate-300">{item.owner_username || item.owner_admin_id}</span></span></span>
                    <span className="mt-2 block text-[11px] tabular-nums text-cyan-200"><Clock3 className="mr-1 inline h-3 w-3" aria-hidden="true" />{formatAuditTime(item.occurred_at)}</span>
                  </button>
                ))}
              </div>
              <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-700 bg-slate-950/50 px-3 py-3 text-xs text-slate-300 sm:px-4">
                <span>{total === 0 ? '0 筆' : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} / ${total}`} · 第 {page + 1} / {pageCount} 頁</span>
                <span className="flex gap-1"><button type="button" onClick={() => { setPage(value => value - 1); setSelectedId(null); setSelectedCard(null); setDetail(null); setConversation(null); }} disabled={loading || page === 0} aria-label="上一頁" className={`rounded-lg border border-slate-600 p-1.5 hover:bg-slate-800 disabled:opacity-40 ${buttonFocus}`}><ChevronLeft className="h-4 w-4" /></button><button type="button" onClick={() => { setPage(value => value + 1); setSelectedId(null); setSelectedCard(null); setDetail(null); setConversation(null); }} disabled={loading || page + 1 >= pageCount} aria-label="下一頁" className={`rounded-lg border border-slate-600 p-1.5 hover:bg-slate-800 disabled:opacity-40 ${buttonFocus}`}><ChevronRight className="h-4 w-4" /></button></span>
              </div>
            </section>

            <section ref={detailRef} aria-label="稽核事件詳情" className="min-h-0 min-w-0 scroll-mt-2 xl:overflow-y-auto">
              <div className="border-b border-slate-700 bg-slate-950/50 px-4 py-3"><h2 className="text-sm font-black text-white">內容查看</h2></div>
              {!selectedId ? <p className="px-4 py-12 text-center text-sm text-slate-400">點選左側卡片查看內容。</p> : detailLoading ? <p role="status" className="px-4 py-12 text-center text-sm text-slate-400">載入詳情中…</p> : conversation ? (
                <div className="p-3 sm:p-4">
                  <section className={`flex h-[70vh] min-h-[360px] max-h-[720px] min-w-0 flex-col overflow-hidden rounded-xl border shadow-xl ${conversation.entity_type === 'aaa_service' ? 'border-orange-400/30' : 'border-emerald-400/30'}`}>
                    <div className={`flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-3 ${conversation.entity_type === 'aaa_service' ? 'border-orange-400/30 bg-gradient-to-r from-slate-950 to-orange-950/70' : 'border-emerald-400/30 bg-gradient-to-r from-slate-950 to-emerald-950/70'}`}>
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/10"><MessageCircle className="h-5 w-5 text-white" /></div>
                      <div className="min-w-0"><h3 className="text-sm font-bold text-white">聊天會話記錄 · {conversation.total} 則</h3><p className="text-[11px] text-slate-300">刪除時間：{formatAuditTime(conversation.occurred_at)}</p></div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-white/10 bg-slate-900 px-4 py-2 text-xs text-slate-200">
                      <span className="inline-flex items-center gap-1.5"><User className="h-4 w-4 text-blue-300" />客戶</span>
                      <span className="h-5 w-px bg-white/15" />
                      <span className="min-w-0 break-all font-semibold">員工：{conversation.employee_account} <span className="font-normal text-slate-400">· ID {conversation.employee_id}</span></span>
                    </div>
                    <div className={`min-h-0 flex-1 space-y-3 overflow-y-auto p-4 scrollbar-dark ${conversation.entity_type === 'aaa_service' ? 'bg-[linear-gradient(180deg,#24170f_0%,#1b1513_40%,#24170f_100%)]' : 'bg-[linear-gradient(180deg,#0b2118_0%,#101c19_40%,#0b2118_100%)]'}`}>
                      {conversation.items.map(message => (
                        <ConversationTranscript key={message.id} message={message} senderName={message.sender_type === 'employee' ? conversation.employee_account : '客戶'} workspace={conversation.entity_type} purgeUnlocked={purgeUnlocked && !clearing && !windowBusy}
                          onClear={id => { setReason(''); setClearTarget({ id }); }} />
                      ))}
                    </div>
                    {conversation.total > TRANSCRIPT_PAGE_SIZE && <div className="flex shrink-0 items-center justify-between border-t border-white/10 bg-slate-900 px-4 py-2 text-xs text-slate-300">
                      <span>第 {conversationPage + 1} / {Math.ceil(conversation.total / TRANSCRIPT_PAGE_SIZE)} 頁</span>
                      <span className="flex gap-2"><button type="button" disabled={conversationPage === 0} onClick={() => setConversationPage(value => value - 1)} className={`rounded-lg border border-slate-600 px-2 py-1.5 disabled:opacity-40 ${buttonFocus}`}>上一頁</button><button type="button" disabled={(conversationPage + 1) * TRANSCRIPT_PAGE_SIZE >= conversation.total} onClick={() => setConversationPage(value => value + 1)} className={`rounded-lg border border-slate-600 px-2 py-1.5 disabled:opacity-40 ${buttonFocus}`}>下一頁</button></span>
                    </div>}
                  </section>
                </div>
              ) : !detail ? <p className="px-4 py-12 text-center text-sm text-slate-400">無法顯示此事件。請重新選取或刷新。</p> : (
                <div className="min-w-0 space-y-4 p-3 sm:p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1 text-xs font-bold text-cyan-100">{typeLabels[detail.entity_type] ?? detail.entity_type} · {actionLabels[detail.action] ?? detail.action}</span>{detail.cleared_at ? <span className="text-xs font-bold text-rose-300">證據已清除</span> : <button type="button" onClick={() => { setReason(''); setClearTarget(detail); }} disabled={!purgeUnlocked || clearing || windowBusy} className={`inline-flex items-center gap-1.5 rounded-lg border border-rose-400/40 bg-rose-500/15 px-3 py-2 text-xs font-bold text-rose-200 hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-40 ${buttonFocus}`}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />清除此筆證據</button>}</div>
                  <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2"><MetadataRow label="操作時間 (UTC+8)" value={formatAuditTime(detail.occurred_at)} /><MetadataRow label="操作者" value={detail.actor_username} /><MetadataRow label="所屬管理員" value={detail.owner_username ?? detail.owner_admin_id} />{detail.employee_id && <MetadataRow label="員工 ID" value={detail.employee_id} />}{detail.cleared_at && <MetadataRow label="正式清除時間 (UTC+8)" value={formatAuditTime(detail.cleared_at)} />}{detail.clear_started_at && !detail.cleared_at && <MetadataRow label="證據清除狀態" value="清除尚未完成" />}{detail.clear_reason && <MetadataRow label="清除原因" value={detail.clear_reason} />}</dl>
                  <div className="grid min-w-0 gap-3"><Snapshot title={detail.action === 'edit' || detail.action === 'source_edit' ? '修改前' : '從原頁移除前'} data={detail.before_data} cleared={Boolean(detail.cleared_at)} type={detail.entity_type} eventId={detail.id} mediaRefs={detail.media_refs} employeeAccount={detail.employee_account} />{detail.after_data != null && <Snapshot title="修改後" data={detail.after_data} cleared={Boolean(detail.cleared_at)} type={detail.entity_type} eventId={detail.id} mediaRefs={detail.media_refs} employeeAccount={detail.employee_account} />}</div>
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
