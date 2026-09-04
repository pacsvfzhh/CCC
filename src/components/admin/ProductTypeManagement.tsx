import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, CreditCard as Edit, Eye, EyeOff, Trash2, CheckCircle, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { ProductType } from '../../types';

export default function ProductTypeManagement() {
  const [productTypes, setProductTypes] = useState<ProductType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '' });
  const [notification, setNotification] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [productTypeToDelete, setProductTypeToDelete] = useState<{id: string, name: string} | null>(null);

  useEffect(() => {
    loadProductTypes();
  }, []);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => {
        setNotification(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const loadProductTypes = async () => {
    try {
      const { data, error } = await supabase
        .from('product_types')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setProductTypes(data || []);
    } catch (error) {
      console.error('Error loading product types:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      setNotification({
        type: 'error',
        message: 'Product type name cannot be empty'
      });
      return;
    }

    try {
      if (editingId) {
        // Optimistic update
        const oldProductTypes = [...productTypes];
        setProductTypes(prev =>
          prev.map(pt => pt.id === editingId ? { ...pt, name: formData.name } : pt)
        );

        const { error } = await supabase
          .from('product_types')
          .update({ name: formData.name })
          .eq('id', editingId);

        if (error) {
          setProductTypes(oldProductTypes);
          if (error.code === '23505') {
            setNotification({ type: 'error', message: `"${formData.name}" already exists. Please use a different name.` });
            return;
          }
          throw error;
        }

        setNotification({
          type: 'success',
          message: 'Product type updated successfully'
        });
      } else {
        // Check if a disabled record with the same name already exists — reactivate it instead of inserting
        const { data: existing } = await supabase
          .from('product_types')
          .select()
          .eq('name', formData.name.trim())
          .maybeSingle();

        let savedData;
        if (existing) {
          if (existing.is_active) {
            setNotification({ type: 'error', message: `"${formData.name}" already exists. Please use a different name.` });
            return;
          }
          const { data: reactivated, error: reactivateError } = await supabase
            .from('product_types')
            .update({ is_active: true })
            .eq('id', existing.id)
            .select()
            .single();
          if (reactivateError) throw reactivateError;
          savedData = reactivated;
        } else {
          const { data, error } = await supabase
            .from('product_types')
            .insert({ name: formData.name.trim() })
            .select()
            .single();
          if (error) throw error;
          savedData = data;
        }

        setProductTypes(prev => {
          const without = prev.filter(pt => pt.id !== savedData.id);
          return [...without, savedData].sort((a, b) => a.name.localeCompare(b.name));
        });

        setNotification({
          type: 'success',
          message: 'Product type created successfully'
        });
      }

      setFormData({ name: '' });
      setShowForm(false);
      setEditingId(null);
    } catch (error: any) {
      console.error('Error saving product type:', error);
      setNotification({
        type: 'error',
        message: error.message || 'Failed to save product type'
      });
    }
  };

  const toggleStatus = async (id: string, currentStatus: boolean) => {
    if (togglingId) return; // Prevent multiple simultaneous toggles

    setTogglingId(id);
    const newStatus = !currentStatus;

    // Optimistic update
    const oldProductTypes = [...productTypes];
    setProductTypes(prev =>
      prev.map(pt => pt.id === id ? { ...pt, is_active: newStatus } : pt)
    );

    try {
      const { error } = await supabase
        .from('product_types')
        .update({ is_active: newStatus })
        .eq('id', id);

      if (error) {
        // Revert on error
        setProductTypes(oldProductTypes);
        throw error;
      }

      setNotification({
        type: 'success',
        message: `Product type ${newStatus ? 'enabled' : 'disabled'} successfully`
      });
    } catch (error: any) {
      console.error('Error toggling status:', error);
      setNotification({
        type: 'error',
        message: error.message || 'Failed to toggle status'
      });
    } finally {
      setTogglingId(null);
    }
  };

  const startEdit = (productType: ProductType) => {
    setEditingId(productType.id);
    setFormData({ name: productType.name });
    setShowForm(true);
  };

  const handleDelete = (productType: ProductType) => {
    setProductTypeToDelete({ id: productType.id, name: productType.name });
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!productTypeToDelete) return;

    try {
      // Optimistic update - remove from local state immediately
      const oldProductTypes = [...productTypes];
      setProductTypes(prev => prev.filter(pt => pt.id !== productTypeToDelete.id));

      // Soft delete: set is_active to false instead of deleting the record
      const { error } = await supabase
        .from('product_types')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', productTypeToDelete.id);

      if (error) {
        // Revert on error
        setProductTypes(oldProductTypes);
        throw error;
      }

      setNotification({
        type: 'success',
        message: 'Product type removed successfully. Historical orders are preserved.'
      });

      setShowDeleteConfirm(false);
      setProductTypeToDelete(null);
    } catch (error: any) {
      console.error('Error removing product type:', error);
      setNotification({
        type: 'error',
        message: error.message || 'Failed to remove product type'
      });
      setShowDeleteConfirm(false);
      setProductTypeToDelete(null);
    }
  };

  return (
    <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-blue-500/20 p-6">
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-6 py-4 rounded-lg shadow-2xl border backdrop-blur-xl transition-all duration-300 ${
            notification.type === 'success'
              ? 'bg-green-900/90 border-green-500/50 text-green-100'
              : 'bg-red-900/90 border-red-500/50 text-red-100'
          }`}
        >
          <span className="font-medium">{notification.message}</span>
          <button
            onClick={() => setNotification(null)}
            className="ml-2 text-white/60 hover:text-white transition-colors"
          >
            ×
          </button>
        </div>
      )}

      <div className="flex justify-end items-center mb-6">
        <button
          onClick={() => {
            setShowForm(!showForm);
            setEditingId(null);
            setFormData({ name: '' });
          }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-all shadow-lg shadow-blue-500/50"
        >
          <Plus className="w-5 h-5" />
          Add Product Type
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-slate-800/50 rounded-lg p-4 mb-6">
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-300 mb-2">Product Type Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ name: e.target.value })}
              required
              className="w-full px-4 py-2 bg-slate-900/50 backdrop-blur-sm border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
                setFormData({ name: '' });
              }}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all"
            >
              {editingId ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-center py-8 text-slate-400">Loading product types...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {productTypes.map((productType) => (
            <div
              key={productType.id}
              className="bg-slate-800/50 rounded-lg p-4 border border-slate-700 hover:border-blue-500/50 transition-all"
            >
              <div className="flex justify-between items-start mb-2">
                <h3 className="font-semibold text-white">{productType.name}</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => startEdit(productType)}
                    className="p-1 hover:bg-slate-700 rounded transition-all"
                  >
                    <Edit className="w-4 h-4 text-blue-400" />
                  </button>
                  <button
                    onClick={() => toggleStatus(productType.id, productType.is_active)}
                    disabled={togglingId === productType.id}
                    className="p-1 hover:bg-slate-700 rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    title={productType.is_active ? 'Disable' : 'Enable'}
                  >
                    {togglingId === productType.id ? (
                      <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                    ) : productType.is_active ? (
                      <Eye className="w-4 h-4 text-green-400" />
                    ) : (
                      <EyeOff className="w-4 h-4 text-red-400" />
                    )}
                  </button>
                  <button
                    onClick={() => handleDelete(productType)}
                    className="p-1 hover:bg-slate-700 rounded transition-all"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4 text-rose-400" />
                  </button>
                </div>
              </div>
              <div
                className={`inline-flex px-2 py-1 rounded text-xs font-medium ${
                  productType.is_active
                    ? 'bg-green-500/10 text-green-400'
                    : 'bg-red-500/10 text-red-400'
                }`}
              >
                {productType.is_active ? 'Active' : 'Disabled'}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && productTypeToDelete && createPortal(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999] p-4">
          <div className="bg-slate-800 border-2 border-amber-500 rounded-xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center space-x-3 mb-4">
              <div className="w-12 h-12 bg-amber-500/20 rounded-full flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-amber-500" />
              </div>
              <h3 className="text-xl font-bold text-white">Remove Product Type</h3>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-4">
              <p className="text-white text-sm mb-2">
                Are you sure you want to remove this product type?
              </p>
              <div className="bg-slate-900/50 rounded p-2 mt-2">
                <p className="text-slate-300 text-sm font-semibold">
                  {productTypeToDelete.name}
                </p>
              </div>
              <div className="mt-3 space-y-1">
                <p className="text-green-400 text-xs flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" />
                  Historical orders will be preserved
                </p>
                <p className="text-amber-400 text-xs flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  This type will no longer appear in new order submissions
                </p>
              </div>
            </div>

            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setProductTypeToDelete(null);
                }}
                className="flex-1 px-4 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 px-4 py-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      , document.body)}
    </div>
  );
}
