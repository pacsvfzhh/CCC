import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle, ArrowRight, Check, CheckCircle2, Eye, EyeOff, KeyRound,
  Loader2, Pencil, Search, Shield, ShieldCheck, Trash2, UserPlus,
  Users, X,
} from 'lucide-react';
import { formatSupabaseError, supabase } from '../../lib/supabase';
import { getAdminFinancialSessionToken } from '../../lib/auth';
import { Admin } from '../../types';

interface AdminManagementProps {
  admin: Admin;
}

type StatusFilter = 'all' | 'active' | 'disabled';

const fieldClassName = 'h-11 w-full rounded-xl border border-slate-600/70 bg-slate-950/65 px-3.5 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20';

export default function AdminManagement({ admin }: AdminManagementProps) {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [deletingAdminId, setDeletingAdminId] = useState<string | null>(null);
  const [editingAdmin, setEditingAdmin] = useState<Admin | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [formData, setFormData] = useState({ username: '', password: '' });
  const [editFormData, setEditFormData] = useState({ username: '', password: '' });

  const loadAdmins = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('admins')
        .select('id, username, role, parent_id, is_active, is_pinned, created_at, updated_at')
        .eq('role', 'secondary_admin')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setAdmins(data || []);
      setLoadError(null);
    } catch (loadFailure) {
      console.error('Error loading admins:', formatSupabaseError(loadFailure));
      setLoadError('無法載入管理員資料，請重試。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (admin.role === 'super_admin') void loadAdmins();
  }, [admin.role, loadAdmins]);

  const counts = useMemo(() => ({
    all: admins.length,
    active: admins.filter(item => item.is_active).length,
    disabled: admins.filter(item => !item.is_active).length,
  }), [admins]);
  const visibleAdmins = useMemo(() => admins.filter(item => (
    item.username.toLocaleLowerCase().includes(searchQuery.trim().toLocaleLowerCase())
    && (statusFilter === 'all' || (statusFilter === 'active' ? item.is_active : !item.is_active))
  )), [admins, searchQuery, statusFilter]);
  const deletingAdmin = admins.find(item => item.id === deletingAdminId);

  const handleCreateAdmin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creating) return;
    setError(null);
    setSuccessMessage(null);
    setCreating(true);

    try {
      if (!formData.username.trim()) throw new Error('請輸入管理員帳號。');
      if (formData.password.length < 6) throw new Error('密碼至少需要 6 個字元。');

      const { data, error: createError } = await supabase.rpc('admin_create_secondary_account', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_username: formData.username.trim(),
        p_password: formData.password,
      });

      if (createError) {
        if (createError.code === '23505') throw new Error('此帳號已存在，請使用其他名稱。');
        throw createError;
      }
      if (!data?.success) throw new Error('建立失敗，請稍後再試。');

      setFormData({ username: '', password: '' });
      setShowPassword(false);
      setSuccessMessage('二級管理員已建立。');
      await loadAdmins();
    } catch (createFailure) {
      console.error('Error creating admin:', formatSupabaseError(createFailure));
      setError(formatSupabaseError(createFailure));
    } finally {
      setCreating(false);
    }
  };

  const toggleAdminStatus = async (adminId: string, currentStatus: boolean) => {
    if (togglingId) return;
    setTogglingId(adminId);
    setActionError(null);
    try {
      const { error: updateError } = await supabase.rpc('admin_update_admin_account', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_target_admin_id: adminId,
        p_updates: { is_active: !currentStatus },
      });
      if (updateError) throw updateError;
      await loadAdmins();
    } catch (updateFailure) {
      console.error('Error toggling admin status:', formatSupabaseError(updateFailure));
      setActionError('更新管理員狀態失敗，請重試。');
    } finally {
      setTogglingId(null);
    }
  };

  const handleDeleteAdmin = async () => {
    if (!deletingAdminId || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const { data, error: removeError } = await supabase.rpc('admin_delete_secondary_account', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_target_admin_id: deletingAdminId,
      });
      if (removeError) throw removeError;
      if (!data) throw new Error('無法刪除管理員。');

      setDeletingAdminId(null);
      setSuccessMessage('管理員已刪除。');
      await loadAdmins();
    } catch (removeFailure) {
      console.error('Error deleting admin:', formatSupabaseError(removeFailure));
      setDeleteError(formatSupabaseError(removeFailure));
    } finally {
      setDeleting(false);
    }
  };

  const openEditModal = (secondaryAdmin: Admin) => {
    setEditingAdmin(secondaryAdmin);
    setEditFormData({ username: secondaryAdmin.username, password: '' });
    setShowEditPassword(false);
    setEditError(null);
  };

  const handleUpdateAdmin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingAdmin || updating) return;
    setEditError(null);
    setUpdating(true);
    try {
      if (!editFormData.username.trim()) throw new Error('請輸入管理員帳號。');
      if (editFormData.password && editFormData.password.length < 6) throw new Error('密碼至少需要 6 個字元。');

      const { error: updateError } = await supabase.rpc('admin_update_secondary_account', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_target_admin_id: editingAdmin.id,
        p_username: editFormData.username.trim(),
        p_new_password: editFormData.password || null,
      });
      if (updateError) {
        if (updateError.code === '23505') throw new Error('此帳號已存在，請使用其他名稱。');
        throw updateError;
      }

      setEditingAdmin(null);
      setEditFormData({ username: '', password: '' });
      setShowEditPassword(false);
      setSuccessMessage('管理員資料已更新。');
      await loadAdmins();
    } catch (updateFailure) {
      console.error('Error updating admin:', formatSupabaseError(updateFailure));
      setEditError(formatSupabaseError(updateFailure));
    } finally {
      setUpdating(false);
    }
  };

  if (admin.role !== 'super_admin') return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[radial-gradient(ellipse_at_10%_5%,rgba(37,99,235,0.16),transparent_35%),radial-gradient(ellipse_at_85%_85%,rgba(14,116,144,0.14),transparent_35%),#080f20] text-slate-100">
      <header className="relative shrink-0 overflow-hidden border-b border-cyan-400/20 bg-gradient-to-r from-[#142f57] via-[#113345] to-[#21354c] px-4 py-5 shadow-[0_12px_35px_rgba(2,6,23,0.28)] sm:px-6 lg:px-8">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-blue-400/20 via-cyan-300/60 to-amber-300/25" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-200/25 bg-gradient-to-br from-blue-500/45 to-cyan-500/25 shadow-inner shadow-cyan-200/10 sm:h-12 sm:w-12">
              <ShieldCheck className="h-6 w-6 text-cyan-100" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-200/75">ACCESS CONTROL / 權限管理</p>
              <h1 className="mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">二級管理員</h1>
              <p className="mt-1 text-xs text-slate-300 sm:text-sm">建立管理帳號，集中管理存取狀態與帳號資料。</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:gap-3">
            <div className="rounded-xl border border-white/15 bg-slate-950/30 px-3 py-2.5 shadow-inner sm:min-w-24">
              <p className="text-[10px] text-slate-300">總帳號</p><p className="mt-0.5 text-lg font-bold tabular-nums text-white">{counts.all}</p>
            </div>
            <div className="rounded-xl border border-emerald-300/25 bg-emerald-950/25 px-3 py-2.5 sm:min-w-24">
              <p className="text-[10px] text-emerald-200/80">使用中</p><p className="mt-0.5 text-lg font-bold tabular-nums text-emerald-200">{counts.active}</p>
            </div>
            <div className="rounded-xl border border-amber-300/25 bg-amber-950/20 px-3 py-2.5 sm:min-w-24">
              <p className="text-[10px] text-amber-200/80">已停用</p><p className="mt-0.5 text-lg font-bold tabular-nums text-amber-200">{counts.disabled}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
        <div className="grid min-h-full lg:h-full lg:min-h-0 lg:grid-cols-[minmax(310px,360px)_minmax(0,1fr)] xl:grid-cols-[minmax(340px,400px)_minmax(0,1fr)]">
          <section className="relative border-b border-cyan-500/15 bg-gradient-to-b from-blue-950/55 via-slate-900/55 to-cyan-950/25 p-4 sm:p-6 lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-7 lg:py-7" aria-labelledby="create-admin-heading">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-300/25 bg-gradient-to-br from-blue-600 to-cyan-700 text-white shadow-md shadow-blue-950/40"><UserPlus className="h-5 w-5" /></div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300/80">CREATE ACCOUNT</p>
                <h2 id="create-admin-heading" className="text-base font-semibold text-white">新增二級管理員</h2>
              </div>
            </div>
            <p className="mb-6 text-sm leading-relaxed text-slate-400">設定登入帳號與密碼，建立後即可在右側列表管理。</p>
            <form onSubmit={handleCreateAdmin} className="space-y-5 rounded-2xl border border-blue-300/15 bg-gradient-to-br from-slate-800/85 via-slate-900/90 to-cyan-950/45 p-4 shadow-[0_18px_40px_rgba(2,6,23,0.25)] sm:p-5">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-slate-200">登入帳號</span>
                <input type="text" autoComplete="off" value={formData.username} onChange={event => setFormData(current => ({ ...current, username: event.target.value }))} required maxLength={120} placeholder="輸入管理員帳號" className={fieldClassName} />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-slate-200">登入密碼</span>
                <span className="relative block">
                  <input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={formData.password} onChange={event => setFormData(current => ({ ...current, password: event.target.value }))} required minLength={6} placeholder="至少 6 個字元" className={`${fieldClassName} pr-12`} />
                  <button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? '隱藏密碼' : '顯示密碼'} className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </span>
                <span className="mt-2 block text-xs text-slate-500">請使用至少 6 個字元的密碼。</span>
              </label>
              {error && <p role="alert" className="flex items-start gap-2 rounded-lg border border-rose-400/30 bg-rose-950/45 p-3 text-xs text-rose-200"><AlertCircle className="h-4 w-4 shrink-0" />{error}</p>}
              {successMessage && <p role="status" className="flex items-start gap-2 rounded-lg border border-emerald-400/30 bg-emerald-950/40 p-3 text-xs text-emerald-200"><CheckCircle2 className="h-4 w-4 shrink-0" />{successMessage}</p>}
              <button type="submit" disabled={creating || !formData.username.trim() || formData.password.length < 6} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-cyan-200/25 bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-600 text-sm font-semibold text-white shadow-lg shadow-blue-950/40 transition hover:from-blue-500 hover:via-blue-400 hover:to-cyan-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-50">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                {creating ? '正在建立…' : '建立管理員'}
                {!creating && <ArrowRight className="h-4 w-4" />}
              </button>
            </form>
            <div className="mt-5 flex gap-3 rounded-xl border border-cyan-400/15 bg-cyan-950/20 p-3.5 text-xs leading-relaxed text-slate-400">
              <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
              <span>建立後可隨時編輯帳號、重設密碼或停用存取權限。</span>
            </div>
          </section>

          <section className="flex min-h-0 min-w-0 flex-col lg:overflow-hidden" aria-labelledby="admin-list-heading">
            <div className="shrink-0 border-b border-cyan-400/15 bg-gradient-to-r from-slate-900/90 via-blue-950/50 to-slate-900/85 px-4 py-4 sm:px-6 lg:px-7">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300/75">ACCOUNT DIRECTORY</p>
                  <h2 id="admin-list-heading" className="mt-1 flex items-center gap-2 text-base font-semibold text-white"><Users className="h-5 w-5 text-cyan-300" />管理員列表 <span className="text-sm font-medium text-slate-400">{visibleAdmins.length}</span></h2>
                </div>
                <div className="flex w-full flex-wrap gap-1 rounded-lg border border-slate-700/80 bg-slate-950/60 p-1 sm:w-auto">
                  {([
                    ['all', '全部', counts.all],
                    ['active', '使用中', counts.active],
                    ['disabled', '已停用', counts.disabled],
                  ] as const).map(([key, label, count]) => (
                    <button key={key} type="button" onClick={() => setStatusFilter(key)} aria-pressed={statusFilter === key} className={`min-h-8 flex-1 whitespace-nowrap rounded-md px-2.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 sm:flex-none ${statusFilter === key ? key === 'active' ? 'bg-emerald-600 text-white' : key === 'disabled' ? 'bg-amber-600 text-white' : 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
                      {label} <span className="ml-1 tabular-nums">{count}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="relative mt-4">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input type="search" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="搜尋管理員帳號" aria-label="搜尋管理員帳號" className="h-10 w-full rounded-xl border border-slate-600/60 bg-slate-950/65 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20" />
              </div>
              {actionError && <p role="alert" className="mt-3 text-xs text-rose-300">{actionError}</p>}
            </div>
            <div className="min-h-0 flex-1 p-4 sm:p-6 lg:overflow-y-auto lg:p-7">
              {loading ? (
                <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-400"><Loader2 className="h-5 w-5 animate-spin text-cyan-400" />正在載入管理員…</div>
              ) : loadError ? (
                <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center"><AlertCircle className="h-7 w-7 text-rose-300" /><p className="text-sm text-slate-300">{loadError}</p><button type="button" onClick={() => { setLoading(true); void loadAdmins(); }} className="rounded-lg border border-cyan-400/40 px-4 py-2 text-sm text-cyan-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">重新載入</button></div>
              ) : visibleAdmins.length === 0 ? (
                <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-cyan-400/20 bg-slate-900/30 px-4 text-center"><Shield className="h-7 w-7 text-cyan-400/70" /><p className="text-sm font-medium text-slate-200">{admins.length === 0 ? '還沒有二級管理員' : '找不到符合條件的管理員'}</p><p className="text-xs text-slate-500">{admins.length === 0 ? '使用左側表單建立第一個帳號。' : '試試其他帳號名稱或狀態。'}</p></div>
              ) : (
                <div className="grid content-start gap-3 xl:grid-cols-2 2xl:grid-cols-3">
                  {visibleAdmins.map(secondaryAdmin => (
                    <article key={secondaryAdmin.id} className={`group min-w-0 overflow-hidden rounded-2xl border bg-gradient-to-br p-4 shadow-[0_10px_28px_rgba(2,6,23,0.2)] transition-colors sm:p-5 ${secondaryAdmin.is_active ? 'border-cyan-500/20 from-[#192d49] via-[#142337] to-[#102c39] hover:border-cyan-400/50' : 'border-amber-500/20 from-[#292939] via-[#1c2433] to-[#312b24] hover:border-amber-400/45'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border shadow-inner ${secondaryAdmin.is_active ? 'border-cyan-300/25 bg-gradient-to-br from-blue-600/70 to-cyan-600/45 text-cyan-50' : 'border-amber-300/20 bg-gradient-to-br from-amber-700/55 to-slate-700/60 text-amber-200'}`}><Shield className="h-5 w-5" /></div>
                          <div className="min-w-0"><h3 className="truncate text-sm font-semibold text-white" title={secondaryAdmin.username}>{secondaryAdmin.username}</h3><p className="mt-0.5 text-[11px] text-slate-400">二級管理員</p></div>
                        </div>
                        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-semibold ${secondaryAdmin.is_active ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200' : 'border-amber-400/25 bg-amber-400/10 text-amber-200'}`}><span className={`h-1.5 w-1.5 rounded-full ${secondaryAdmin.is_active ? 'bg-emerald-400' : 'bg-amber-400'}`} />{secondaryAdmin.is_active ? '使用中' : '已停用'}</span>
                      </div>
                      <div className="mt-5 border-t border-white/10 pt-3 text-xs text-slate-400">建立時間 <span className="ml-1 text-slate-200">{new Date(secondaryAdmin.created_at).toLocaleDateString('zh-TW')}</span></div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" onClick={() => void toggleAdminStatus(secondaryAdmin.id, secondaryAdmin.is_active)} disabled={togglingId !== null} aria-label={`${secondaryAdmin.is_active ? '停用' : '啟用'} ${secondaryAdmin.username}`} className={`inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 disabled:opacity-50 ${secondaryAdmin.is_active ? 'border-amber-400/25 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 focus-visible:ring-amber-400' : 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 focus-visible:ring-emerald-400'}`}>{togglingId === secondaryAdmin.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : secondaryAdmin.is_active ? <EyeOff className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}{secondaryAdmin.is_active ? '停用' : '啟用'}</button>
                        <button type="button" onClick={() => openEditModal(secondaryAdmin)} aria-label={`編輯 ${secondaryAdmin.username}`} className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-blue-400/25 bg-blue-500/10 px-2 text-xs font-semibold text-blue-200 transition hover:bg-blue-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"><Pencil className="h-3.5 w-3.5" />編輯</button>
                        <button type="button" onClick={() => { setDeletingAdminId(secondaryAdmin.id); setDeleteError(null); }} aria-label={`刪除 ${secondaryAdmin.username}`} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-rose-400/25 bg-rose-500/10 text-rose-300 transition hover:bg-rose-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      {deletingAdminId && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="delete-admin-heading" className="w-full max-w-md overflow-hidden rounded-2xl border border-rose-400/25 bg-slate-900 shadow-2xl shadow-slate-950/60">
            <div className="flex items-center gap-3 border-b border-rose-400/15 bg-gradient-to-r from-rose-950/65 to-slate-900 p-5"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/15 text-rose-200"><Trash2 className="h-5 w-5" /></span><div><h3 id="delete-admin-heading" className="font-semibold text-white">刪除管理員</h3><p className="text-xs text-rose-200/70">此操作無法復原</p></div></div>
            <div className="space-y-4 p-5"><p className="text-sm leading-relaxed text-slate-300">確定要刪除 <strong className="text-white">{deletingAdmin?.username}</strong> 嗎？該帳號將無法再登入。</p>
              {deleteError && <p role="alert" className="rounded-lg border border-rose-400/25 bg-rose-950/40 p-3 text-xs text-rose-200">{deleteError}</p>}
              <div className="flex gap-2"><button type="button" onClick={() => { setDeletingAdminId(null); setDeleteError(null); }} disabled={deleting} className="min-h-10 flex-1 rounded-lg border border-slate-600 bg-slate-800 text-sm text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 disabled:opacity-50">取消</button><button type="button" onClick={() => void handleDeleteAdmin()} disabled={deleting} className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-rose-700 to-red-600 text-sm font-semibold text-white hover:from-rose-600 hover:to-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:opacity-50">{deleting && <Loader2 className="h-4 w-4 animate-spin" />}{deleting ? '刪除中…' : '確認刪除'}</button></div>
            </div>
          </div>
        </div>, document.body,
      )}

      {editingAdmin && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="edit-admin-heading" className="w-full max-w-lg overflow-hidden rounded-2xl border border-cyan-400/25 bg-slate-900 shadow-2xl shadow-slate-950/60">
            <div className="flex items-center justify-between border-b border-cyan-400/15 bg-gradient-to-r from-blue-950 via-slate-900 to-cyan-950 p-5"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/20 text-cyan-200"><Pencil className="h-5 w-5" /></span><div><h3 id="edit-admin-heading" className="font-semibold text-white">編輯管理員</h3><p className="text-xs text-slate-400">更新登入帳號與密碼</p></div></div><button type="button" onClick={() => setEditingAdmin(null)} disabled={updating} aria-label="關閉編輯視窗" className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:opacity-50"><X className="h-4 w-4" /></button></div>
            <form onSubmit={handleUpdateAdmin} className="space-y-4 p-5">
              {editError && <p role="alert" className="rounded-lg border border-rose-400/25 bg-rose-950/40 p-3 text-xs text-rose-200">{editError}</p>}
              <label className="block"><span className="mb-2 block text-xs font-semibold text-slate-200">登入帳號</span><input type="text" value={editFormData.username} onChange={event => setEditFormData(current => ({ ...current, username: event.target.value }))} required maxLength={120} className={fieldClassName} /></label>
              <label className="block"><span className="mb-2 block text-xs font-semibold text-slate-200">新密碼 <span className="font-normal text-slate-500">（留空則保持不變）</span></span><span className="relative block"><input type={showEditPassword ? 'text' : 'password'} value={editFormData.password} onChange={event => setEditFormData(current => ({ ...current, password: event.target.value }))} autoComplete="new-password" minLength={6} placeholder="輸入新密碼" className={`${fieldClassName} pr-12`} /><button type="button" onClick={() => setShowEditPassword(value => !value)} aria-label={showEditPassword ? '隱藏新密碼' : '顯示新密碼'} className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">{showEditPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></span><span className="mt-2 block text-xs text-slate-500">更換密碼時至少需要 6 個字元。</span></label>
              <div className="flex gap-2 pt-2"><button type="button" onClick={() => setEditingAdmin(null)} disabled={updating} className="min-h-10 flex-1 rounded-lg border border-slate-600 bg-slate-800 text-sm text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 disabled:opacity-50">取消</button><button type="submit" disabled={updating || !editFormData.username.trim()} className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 to-cyan-600 text-sm font-semibold text-white hover:from-blue-500 hover:to-cyan-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:opacity-50">{updating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{updating ? '儲存中…' : '儲存變更'}</button></div>
            </form>
          </div>
        </div>, document.body,
      )}
    </div>
  );
}
