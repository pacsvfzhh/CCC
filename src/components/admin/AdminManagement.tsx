import { useState, useEffect } from 'react';
import { UserPlus, Shield, Trash2, Eye, EyeOff, CreditCard as Edit2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { hashPassword } from '../../lib/passwordHash';
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

  useEffect(() => {
    if (admin.role === 'super_admin') {
      loadAdmins();
    }
  }, []); // Remove admin.role from dependencies

  const loadAdmins = async () => {
    try {
      const { data, error } = await supabase
        .from('admins')
        .select('*')
        .eq('role', 'secondary_admin')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setAdmins(data || []);
    } catch (error) {
      console.error('Error loading admins:', error);
    } finally {
      setLoading(false);
    }
  };

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

      // Hash the password before storing
      const hashedPassword = await hashPassword(formData.password);

      const { data, error } = await supabase.from('admins').insert({
        username: formData.username.trim(),
        password_hash: hashedPassword,
        role: 'secondary_admin',
        parent_id: admin.id,
      }).select();

      if (error) {
        if (error.code === '23505') {
          throw new Error('Username already exists');
        }
        throw error;
      }

      if (!data || data.length === 0) {
        throw new Error('Failed to create admin - no data returned');
      }

      setFormData({ username: '', password: '' });
      setShowCreateForm(false);
      setShowPassword(false);
      await loadAdmins();
    } catch (error: any) {
      console.error('Error creating admin:', error);
      setError(error.message || 'Failed to create admin. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const toggleAdminStatus = async (adminId: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('admins')
        .update({ is_active: !currentStatus })
        .eq('id', adminId);

      if (error) throw error;
      loadAdmins();
    } catch (error) {
      console.error('Error toggling admin status:', error);
    }
  };

  const handleDeleteAdmin = async (adminId: string) => {
    try {
      setDeleteError(null);
      const { error } = await supabase
        .from('admins')
        .delete()
        .eq('id', adminId);

      if (error) throw error;

      setDeletingAdminId(null);
      loadAdmins();
    } catch (error: any) {
      console.error('Error deleting admin:', error);
      const message = error?.message || error?.details || 'Failed to delete admin. Please try again.';
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

      const updates: any = {
        username: editFormData.username.trim(),
      };

      // Only update password if provided
      if (editFormData.password) {
        if (editFormData.password.length < 6) {
          throw new Error('Password must be at least 6 characters');
        }
        console.log('Hashing new password...');
        const hashedPassword = await hashPassword(editFormData.password);
        console.log('Password hashed successfully, updating database...');
        updates.password_hash = hashedPassword;
      }

      console.log('Updating admin with data:', updates);
      const { error } = await supabase
        .from('admins')
        .update(updates)
        .eq('id', editingAdmin.id);
      console.log('Update result:', { error });

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
    } catch (error: any) {
      console.error('Error updating admin:', error);
      setEditError(error.message || 'Failed to update admin. Please try again.');
    } finally {
      setUpdating(false);
    }
  };

  if (admin.role !== 'super_admin') {
    return null;
  }

  return (
    <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-blue-500/20 p-6">
      <div className="flex justify-end items-center mb-6">
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-all shadow-lg shadow-blue-500/50"
        >
          <UserPlus className="w-5 h-5" />
          Create Secondary Admin
        </button>
      </div>

      {showCreateForm && (
        <form onSubmit={handleCreateAdmin} className="bg-slate-800/50 rounded-lg p-4 mb-6 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-3 text-red-400 text-sm">
              {error}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Username</label>
              <input
                type="text"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                required
                className="w-full px-4 py-2 bg-slate-900/50 backdrop-blur-sm border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  required
                  className="w-full px-4 py-2 pr-12 bg-slate-900/50 backdrop-blur-sm border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setShowCreateForm(false);
                setError(null);
                setFormData({ username: '', password: '' });
                setShowPassword(false);
              }}
              disabled={creating}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating || !formData.username.trim() || !formData.password}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {creating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Creating...
                </>
              ) : (
                'Create'
              )}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-center py-8 text-slate-400">Loading administrators...</div>
      ) : (
        <div className="space-y-3">
          {admins.map((secondaryAdmin) => (
            <div
              key={secondaryAdmin.id}
              className="bg-slate-800/50 rounded-lg p-4 border border-slate-700 hover:border-blue-500/50 transition-all flex items-center justify-between"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg flex items-center justify-center">
                  <Shield className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-white">{secondaryAdmin.username}</h3>
                  <p className="text-slate-400 text-sm">
                    Created: {new Date(secondaryAdmin.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => toggleAdminStatus(secondaryAdmin.id, secondaryAdmin.is_active)}
                  className={`px-3 py-1 rounded text-sm font-medium ${
                    secondaryAdmin.is_active
                      ? 'bg-green-500/10 text-green-400'
                      : 'bg-red-500/10 text-red-400'
                  }`}
                >
                  {secondaryAdmin.is_active ? 'Active' : 'Disabled'}
                </button>
                <button
                  onClick={() => openEditModal(secondaryAdmin)}
                  className="p-2 hover:bg-blue-500/10 text-blue-400 rounded-lg transition-all"
                  title="Edit admin"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setDeletingAdminId(secondaryAdmin.id)}
                  className="p-2 hover:bg-red-500/10 text-red-400 rounded-lg transition-all"
                  title="Delete admin"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {deletingAdminId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-white mb-4">Confirm Deletion</h3>
            <p className="text-slate-300 mb-6">
              Are you sure you want to delete this administrator? This action cannot be undone.
            </p>

            {deleteError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                {deleteError}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setDeletingAdminId(null);
                  setDeleteError(null);
                }}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteAdmin(deletingAdminId)}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-all"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {editingAdmin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-white mb-4">Edit Administrator</h3>

            <form onSubmit={handleUpdateAdmin} className="space-y-4">
              {editError && (
                <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-3 text-red-400 text-sm">
                  {editError}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Username</label>
                <input
                  type="text"
                  value={editFormData.username}
                  onChange={(e) => setEditFormData({ ...editFormData, username: e.target.value })}
                  required
                  className="w-full px-4 py-2 bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  New Password <span className="text-slate-500">(leave empty to keep current)</span>
                </label>
                <div className="relative">
                  <input
                    type={showEditPassword ? 'text' : 'password'}
                    value={editFormData.password}
                    onChange={(e) => setEditFormData({ ...editFormData, password: e.target.value })}
                    placeholder="Enter new password"
                    className="w-full px-4 py-2 pr-12 bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowEditPassword(!showEditPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300 transition-colors"
                  >
                    {showEditPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-500">Minimum 6 characters if changing password</p>
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
                  className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updating || !editFormData.username.trim()}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {updating ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Updating...
                    </>
                  ) : (
                    'Update'
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
