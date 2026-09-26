import { useState, useEffect, useCallback } from 'react';
import { UserPlus, Shield, Trash2, Eye, EyeOff, CreditCard as Edit2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getAdminFinancialSessionToken } from '../../lib/auth';
import { Admin } from '../../types';

interface AdminManagementProps {
  admin: Admin;
}

export default function AdminManagement({ admin }: AdminManagementProps) {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [deletingAdminId, setDeletingAdminId] = useState<string | null>(null);
  const [editingAdmin, setEditingAdmin] = useState<Admin | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    username: '',
    password: '',
  });
  const [editFormData, setEditFormData] = useState({
    username: '',
    password: '',
  });

  const loadAdmins = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('admins')
        .select('id, username, role, parent_id, is_active, is_pinned, created_at, updated_at')
        .eq('role', 'secondary_admin')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setAdmins(data || []);
    } catch (error) {
      console.error('Error loading admins:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (admin.role === 'super_admin') {
      void loadAdmins();
    }
  }, [admin.role, loadAdmins]);

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCreating(true);

    try {
      if (!formData.username.trim()) {
        throw new Error('Username is required');
      }
      if (formData.password.length < 6) {
        throw new Error('Password must be at least 6 characters');
      }

      const { data, error } = await supabase.rpc('admin_create_secondary_account', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_username: formData.username.trim(),
        p_password: formData.password,
      });

      if (error) {
        if (error.code === '23505') {
          throw new Error('Username already exists');
        }
        throw error;
      }

      if (!data?.success) {
        throw new Error('Failed to create admin - no data returned');
      }

      setFormData({ username: '', password: '' });
      setShowCreateForm(false);
      setShowPassword(false);
      await loadAdmins();
    } catch (error: unknown) {
      console.error('Error creating admin:', error);
      setError(error instanceof Error ? error.message : 'Failed to create admin. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const toggleAdminStatus = async (adminId: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase.rpc('admin_update_admin_account', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_target_admin_id: adminId,
        p_updates: { is_active: !currentStatus },
      });

      if (error) throw error;
      void loadAdmins();
    } catch (error) {
      console.error('Error toggling admin status:', error);
    }
  };

  const handleDeleteAdmin = async (adminId: string) => {
    try {
      setDeleteError(null);
      const { data, error } = await supabase.rpc('admin_delete_secondary_account', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_target_admin_id: adminId,
      });

      if (error) throw error;
      if (!data) throw new Error('Unable to delete administrator.');

      setDeletingAdminId(null);
      void loadAdmins();
    } catch (error: unknown) {
      console.error('Error deleting admin:', error);
      const message = error instanceof Error ? error.message : 'Failed to delete admin. Please try again.';
      setDeleteError(message);
    }
  };

  const openEditModal = (secondaryAdmin: Admin) => {
    setEditingAdmin(secondaryAdmin);
    setEditFormData({
      username: secondaryAdmin.username,
      password: '',
    });
    setShowEditPassword(false);
    setEditError(null);
  };

  const handleUpdateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAdmin) return;

    setEditError(null);
    setUpdating(true);

    try {
      if (!editFormData.username.trim()) {
        throw new Error('Username is required');
      }

      if (editFormData.password && editFormData.password.length < 6) {
        throw new Error('Password must be at least 6 characters');
      }

      const { error } = await supabase.rpc('admin_update_secondary_account', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_target_admin_id: editingAdmin.id,
        p_username: editFormData.username.trim(),
        p_new_password: editFormData.password || null,
      });

      if (error) {
        if (error.code === '23505') {
          throw new Error('Username already exists');
        }
        throw error;
      }

      setEditingAdmin(null);
      setEditFormData({ username: '', password: '' });
      setShowEditPassword(false);
      await loadAdmins();
    } catch (error: unknown) {
      console.error('Error updating admin:', error);
      setEditError(error instanceof Error ? error.message : 'Failed to update admin. Please try again.');
    } finally {
      setUpdating(false);
    }
  };

  if (admin.role !== 'super_admin') {
    return null;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-gradient-to-br from-[#17243a] via-[#122838] to-[#102c33] text-slate-100">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-cyan-400/20 bg-gradient-to-r from-[#1b2d47] to-[#17343e] px-4 py-3 sm:px-6">
        <div>
          <h1 className="text-lg font-semibold text-white">二級管理員</h1>
          <p className="mt-0.5 text-xs text-slate-300">建立與管理二級管理員帳號</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateForm(!showCreateForm)}
          aria-expanded={showCreateForm}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
        >
          <UserPlus className="h-4 w-4" />
          新增二級管理員
        </button>
      </div>

      {showCreateForm && (
        <form onSubmit={handleCreateAdmin} className="shrink-0 space-y-4 border-b border-cyan-400/20 bg-gradient-to-r from-[#1b2d47] to-[#17343e] p-4 sm:px-6 sm:py-5">
          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-950/40 p-3 text-sm text-rose-200">
              {error}
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">登入帳號</label>
              <input
                type="text"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                required
                className="h-10 w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 text-white outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">登入密碼</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  required
                  className="h-10 w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 pr-11 text-white outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowCreateForm(false);
                setError(null);
                setFormData({ username: '', password: '' });
                setShowPassword(false);
              }}
              disabled={creating}
              className="min-h-10 rounded-lg border border-slate-600 bg-slate-800 px-4 text-sm text-slate-200 transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={creating || !formData.username.trim() || !formData.password}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  建立中…
                </>
              ) : (
                '建立帳號'
              )}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center py-10 text-sm text-slate-400">正在載入管理員…</div>
      ) : (
        <div className="min-h-0 flex-1 bg-slate-900/15">
          {admins.map((secondaryAdmin) => (
            <div
              key={secondaryAdmin.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-600/30 bg-gradient-to-r from-slate-800/35 to-cyan-950/15 px-4 py-3 transition-colors hover:bg-blue-900/20 sm:px-6"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-cyan-700">
                  <Shield className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0">
                  <h3 className="truncate font-semibold text-white">{secondaryAdmin.username}</h3>
                  <p className="text-xs text-slate-400">
                    建立於 {new Date(secondaryAdmin.created_at).toLocaleDateString('zh-TW')}
                  </p>
                </div>
              </div>
              <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
                <button
                  onClick={() => toggleAdminStatus(secondaryAdmin.id, secondaryAdmin.is_active)}
                  className={`min-h-9 rounded-lg border px-3 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 ${
                    secondaryAdmin.is_active
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 focus-visible:ring-emerald-400'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 focus-visible:ring-amber-400'
                  }`}
                >
                  {secondaryAdmin.is_active ? '使用中' : '已停用'}
                </button>
                <button
                  onClick={() => openEditModal(secondaryAdmin)}
                  className="rounded-lg p-2.5 text-blue-300 transition-colors hover:bg-blue-500/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                  title="編輯管理員"
                  aria-label={`編輯 ${secondaryAdmin.username}`}
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setDeletingAdminId(secondaryAdmin.id)}
                  className="rounded-lg p-2.5 text-rose-300 transition-colors hover:bg-rose-500/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                  title="刪除管理員"
                  aria-label={`刪除 ${secondaryAdmin.username}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {deletingAdminId && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-600 bg-gradient-to-br from-slate-800 to-slate-900 p-5 shadow-2xl sm:p-6">
            <h3 className="mb-3 text-lg font-semibold text-white">刪除管理員</h3>
            <p className="mb-5 text-sm leading-relaxed text-slate-300">
              確定要刪除這位管理員嗎？此操作無法復原。
            </p>

            {deleteError && (
              <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-950/40 p-3 text-sm text-rose-200">
                {deleteError}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setDeletingAdminId(null);
                  setDeleteError(null);
                }}
                className="min-h-10 flex-1 rounded-lg border border-slate-600 bg-slate-700 px-4 text-sm text-white transition-colors hover:bg-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
              >
                取消
              </button>
              <button
                onClick={() => handleDeleteAdmin(deletingAdminId)}
                className="min-h-10 flex-1 rounded-lg bg-rose-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-rose-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
              >
                確認刪除
              </button>
            </div>
          </div>
        </div>
      )}

      {editingAdmin && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-600 bg-gradient-to-br from-slate-800 to-slate-900 p-5 shadow-2xl sm:p-6">
            <h3 className="mb-4 text-lg font-semibold text-white">編輯管理員</h3>

            <form onSubmit={handleUpdateAdmin} className="space-y-4">
              {editError && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-950/40 p-3 text-sm text-rose-200">
                  {editError}
                </div>
              )}

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-200">登入帳號</label>
                <input
                  type="text"
                  value={editFormData.username}
                  onChange={(e) => setEditFormData({ ...editFormData, username: e.target.value })}
                  required
                  className="h-10 w-full rounded-lg border border-slate-600 bg-slate-950/60 px-3 text-white outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  新密碼 <span className="text-slate-400">（留空則保持不變）</span>
                </label>
                <div className="relative">
                  <input
                    type={showEditPassword ? 'text' : 'password'}
                    value={editFormData.password}
                    onChange={(e) => setEditFormData({ ...editFormData, password: e.target.value })}
                    placeholder="輸入新密碼"
                    className="h-10 w-full rounded-lg border border-slate-600 bg-slate-950/60 px-3 pr-11 text-white outline-none placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowEditPassword(!showEditPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                  >
                    {showEditPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-500">若修改密碼，至少需要 6 個字元</p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditingAdmin(null);
                    setEditFormData({ username: '', password: '' });
                    setShowEditPassword(false);
                    setEditError(null);
                  }}
                  disabled={updating}
                  className="min-h-10 flex-1 rounded-lg border border-slate-600 bg-slate-700 px-4 text-sm text-white transition-colors hover:bg-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={updating || !editFormData.username.trim()}
                  className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {updating ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      儲存中…
                    </>
                  ) : (
                    '儲存變更'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
