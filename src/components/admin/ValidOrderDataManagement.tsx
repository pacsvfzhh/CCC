import { useState, useEffect } from 'react';
import { Database, Upload, Trash2, Plus, FileSpreadsheet, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useCurrencyUnit } from '../../lib/useCurrencyUnit';

interface ValidOrderData {
  id: string;
  product_value: number;
  transaction_id: string;
  is_active: boolean;
  created_at: string;
}

interface ValidOrderDataManagementProps {
  adminId: string;
}

export default function ValidOrderDataManagement({ adminId }: ValidOrderDataManagementProps) {
  const currencyUnit = useCurrencyUnit(adminId);
  const [validData, setValidData] = useState<ValidOrderData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [formData, setFormData] = useState({
    productValue: '',
    transactionId: '',
  });
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 500;
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [totalCount, setTotalCount] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [inactiveCount, setInactiveCount] = useState(0);
  const [pageInput, setPageInput] = useState('');
  const [deleteProgress, setDeleteProgress] = useState({ current: 0, total: 0, percentage: 0 });

  useEffect(() => {
    loadValidData();
  }, [currentPage, statusFilter]);

  useEffect(() => {
    loadStatistics();
  }, []);

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => {
        setMessage(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const loadStatistics = async () => {
    try {
      // Get total count
      const { count: total } = await supabase
        .from('valid_order_data')
        .select('*', { count: 'exact', head: true });

      // Get active count
      const { count: active } = await supabase
        .from('valid_order_data')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

      // Get inactive count
      const { count: inactive } = await supabase
        .from('valid_order_data')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', false);

      setActiveCount(active || 0);
      setInactiveCount(inactive || 0);
    } catch (error) {
      console.error('Error loading statistics:', error);
    }
  };

  const loadValidData = async () => {
    try {
      setLoading(true);

      // Only load the data for the current page to avoid timeout
      const from = (currentPage - 1) * itemsPerPage;
      const to = from + itemsPerPage - 1;

      // Build query with status filter
      let query = supabase
        .from('valid_order_data')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

      // Apply status filter
      if (statusFilter === 'active') {
        query = query.eq('is_active', true);
      } else if (statusFilter === 'inactive') {
        query = query.eq('is_active', false);
      }

      const { data, error, count } = await query;

      if (error) throw error;
      setValidData(data || []);
      setTotalCount(count || 0);
    } catch (error) {
      console.error('Error loading valid order data:', error);
      setMessage({ type: 'error', text: 'Failed to load order data. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  const handleAddSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    try {
      const { error } = await supabase.from('valid_order_data').insert({
        product_value: parseFloat(formData.productValue),
        transaction_id: formData.transactionId,
        created_by: adminId,
      });

      if (error) throw error;

      setMessage({ type: 'success', text: 'Valid order data added successfully!' });
      setFormData({ productValue: '', transactionId: '' });
      setShowAddForm(false);
      setCurrentPage(1);
      loadValidData();
      loadStatistics();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to add valid order data' });
    }
  };

  const handleBulkUpload = async () => {
    setMessage(null);

    const lines = bulkText.trim().split('\n').filter(line => line.trim());
    if (lines.length === 0) {
      setMessage({ type: 'error', text: 'Please enter data in the format: product_value,transaction_id' });
      return;
    }

    if (lines.length > 500000) {
      setMessage({ type: 'error', text: `Cannot import more than 500,000 records at once. You are trying to import ${lines.length} records.` });
      return;
    }

    const dataToInsert = [];
    const errors = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const parts = line.split(',');

      if (parts.length !== 2) {
        errors.push(`Line ${i + 1}: Invalid format (expected: value,id)`);
        continue;
      }

      const productValue = parseFloat(parts[0].trim());
      const transactionId = parts[1].trim();

      if (isNaN(productValue) || productValue <= 0) {
        errors.push(`Line ${i + 1}: Invalid product value`);
        continue;
      }

      if (!transactionId || transactionId.length === 0) {
        errors.push(`Line ${i + 1}: Invalid transaction ID`);
        continue;
      }

      dataToInsert.push({
        product_value: productValue,
        transaction_id: transactionId,
        created_by: adminId,
      });
    }

    if (errors.length > 0) {
      setMessage({ type: 'error', text: `Errors found:\n${errors.join('\n')}` });
      return;
    }

    setUploading(true);
    setUploadProgress({ current: 0, total: dataToInsert.length });

    try {
      // Insert new data in batches (Supabase has a limit per request)
      const batchSize = 1000;
      let uploadedCount = 0;

      for (let i = 0; i < dataToInsert.length; i += batchSize) {
        const batch = dataToInsert.slice(i, i + batchSize);
        const { error } = await supabase.from('valid_order_data').insert(batch);
        if (error) throw error;

        uploadedCount += batch.length;
        setUploadProgress({ current: uploadedCount, total: dataToInsert.length });

        // Show progress message for large uploads
        if (dataToInsert.length > 5000) {
          setMessage({
            type: 'success',
            text: `Uploading... ${uploadedCount.toLocaleString()} / ${dataToInsert.length.toLocaleString()} records (${Math.round((uploadedCount / dataToInsert.length) * 100)}%)`
          });
        }
      }

      // After successful insert, ensure we only keep 500,000 most recent records
      setMessage({ type: 'success', text: 'Upload complete. Checking data pool capacity...' });
      await cleanupOldRecords();

      setMessage({ type: 'success', text: `Successfully uploaded ${dataToInsert.length.toLocaleString()} records! Total pool now has ${(activeCount + inactiveCount + dataToInsert.length).toLocaleString()} records.` });
      setBulkText('');
      setCurrentPage(1);
      loadValidData();
      loadStatistics();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to upload bulk data' });
    } finally {
      setUploading(false);
      setUploadProgress({ current: 0, total: 0 });
    }
  };

  const cleanupOldRecords = async () => {
    try {
      // Get total count
      const { count } = await supabase
        .from('valid_order_data')
        .select('*', { count: 'exact', head: true });

      if (!count || count <= 500000) return;

      // Get the IDs of records to keep (500,000 most recent)
      const { data: recordsToKeep } = await supabase
        .from('valid_order_data')
        .select('id')
        .order('created_at', { ascending: false })
        .limit(500000);

      if (!recordsToKeep) return;

      const idsToKeep = new Set(recordsToKeep.map(r => r.id));

      // Get all IDs to delete
      const { data: allRecords } = await supabase
        .from('valid_order_data')
        .select('id');

      if (!allRecords) return;

      const idsToDelete = allRecords
        .filter(r => !idsToKeep.has(r.id))
        .map(r => r.id);

      if (idsToDelete.length === 0) return;

      // Delete old records in batches
      const batchSize = 1000;
      for (let i = 0; i < idsToDelete.length; i += batchSize) {
        const batch = idsToDelete.slice(i, i + batchSize);
        const { error } = await supabase
          .from('valid_order_data')
          .delete()
          .in('id', batch);

        if (error) throw error;
      }

      console.log(`Cleanup completed: Deleted ${idsToDelete.length} old records, kept ${idsToKeep.size} recent records`);
    } catch (error: any) {
      console.error('Error cleaning up old records:', error);
      // Don't throw - this is a cleanup operation and shouldn't fail the upload
    }
  };

  const handleToggleActive = async (id: string, currentStatus: boolean) => {
    try {
      // Optimistic update - update local state immediately
      const newStatus = !currentStatus;
      setValidData(prevData =>
        prevData.map(item =>
          item.id === id
            ? { ...item, is_active: newStatus, updated_at: new Date().toISOString() }
            : item
        )
      );

      // Update statistics optimistically
      if (newStatus) {
        setActiveCount(prev => prev + 1);
        setInactiveCount(prev => Math.max(0, prev - 1));
      } else {
        setActiveCount(prev => Math.max(0, prev - 1));
        setInactiveCount(prev => prev + 1);
      }

      const { error } = await supabase
        .from('valid_order_data')
        .update({ is_active: newStatus, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;

      setMessage({ type: 'success', text: `Status updated successfully!` });
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to update status' });
      // Revert on error
      loadValidData();
      loadStatistics();
    }
  };

  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPageInput(e.target.value);
  };

  const handlePageInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const pageNum = parseInt(pageInput);
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
      setCurrentPage(pageNum);
      setPageInput('');
    } else {
      setMessage({ type: 'error', text: `Please enter a valid page number (1-${totalPages})` });
    }
  };


  const handleDelete = async (id: string) => {
    try {
      // Find the item being deleted to update statistics
      const itemToDelete = validData.find(item => item.id === id);

      // Optimistic update - remove from local state immediately
      setValidData(prevData => prevData.filter(item => item.id !== id));
      setTotalCount(prev => Math.max(0, prev - 1));

      // Update statistics optimistically
      if (itemToDelete) {
        if (itemToDelete.is_active) {
          setActiveCount(prev => Math.max(0, prev - 1));
        } else {
          setInactiveCount(prev => Math.max(0, prev - 1));
        }
      }

      const { error } = await supabase.from('valid_order_data').delete().eq('id', id);

      if (error) throw error;

      setMessage({ type: 'success', text: 'Valid order data deleted successfully!' });
      setDeletingId(null);
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to delete valid order data' });
      // Revert on error
      loadValidData();
      loadStatistics();
    }
  };

  const totalPages = Math.ceil(totalCount / itemsPerPage);

  const handleDeleteAll = async () => {
    if (confirmText !== 'DELETE ALL') {
      setMessage({ type: 'error', text: 'You must type "DELETE ALL" exactly to confirm.' });
      return;
    }

    setDeleting(true);
    setMessage(null);
    setShowDeleteAllModal(false);

    try {
      console.log('[Delete All] Starting deletion process...');

      // Get total count first
      const { count: totalToDelete, error: countError } = await supabase
        .from('valid_order_data')
        .select('*', { count: 'exact', head: true });

      if (countError) throw countError;

      console.log('[Delete All] Total records to delete:', totalToDelete);

      if (!totalToDelete || totalToDelete === 0) {
        setMessage({ type: 'error', text: 'No records found to delete' });
        setDeleting(false);
        setDeleteProgress({ current: 0, total: 0, percentage: 0 });
        return;
      }

      const BATCH_SIZE = 1000; // Delete 1000 records at a time
      const LARGE_BATCH_THRESHOLD = 5000; // Use batch delete for > 5K records

      // For small datasets, use single delete
      if (totalToDelete <= LARGE_BATCH_THRESHOLD) {
        setDeleteProgress({ current: 0, total: totalToDelete, percentage: 0 });

        const { error: deleteError } = await supabase
          .from('valid_order_data')
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

        if (deleteError) throw deleteError;

        setDeleteProgress({ current: totalToDelete, total: totalToDelete, percentage: 100 });
        console.log(`[Delete All] Deleted ${totalToDelete} records in single operation`);
      } else {
        // For large datasets, use batch deletion
        console.log(`[Delete All] Using batch deletion (${BATCH_SIZE} per batch)`);

        let totalDeleted = 0;
        let hasMore = true;
        let batchCount = 0;

        while (hasMore && totalDeleted < totalToDelete) {
          batchCount++;
          console.log(`[Delete All] Processing batch ${batchCount}...`);

          // Call database function to delete a batch
          const { data, error: rpcError } = await supabase.rpc('batch_delete_valid_order_data', {
            p_batch_size: BATCH_SIZE
          });

          if (rpcError) {
            console.error(`[Delete All] Batch ${batchCount} RPC error:`, rpcError);
            throw rpcError;
          }

          const deletedCount = data || 0;
          totalDeleted += deletedCount;

          const percentage = Math.min(100, Math.round((totalDeleted / totalToDelete) * 100));

          setDeleteProgress({
            current: totalDeleted,
            total: totalToDelete,
            percentage
          });

          console.log(`[Delete All] Batch ${batchCount}: Deleted ${deletedCount} records. Total: ${totalDeleted}/${totalToDelete} (${percentage}%)`);

          // If we deleted less than BATCH_SIZE, we're done
          if (deletedCount < BATCH_SIZE) {
            hasMore = false;
            console.log(`[Delete All] Last batch completed (${deletedCount} < ${BATCH_SIZE})`);
          }

          // Small delay between batches to avoid overwhelming the database
          if (hasMore) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }

        console.log(`[Delete All] Completed deletion of ${totalDeleted} records in ${batchCount} batches`);
      }

      setMessage({
        type: 'success',
        text: `Successfully deleted all ${totalToDelete.toLocaleString()} valid order data records!`
      });
      setConfirmText('');

      // Reset to first page and reload data
      setCurrentPage(1);
      setTimeout(async () => {
        await loadValidData();
        await loadStatistics();
        setDeleting(false);
        setDeleteProgress({ current: 0, total: 0, percentage: 0 });
      }, 500);
    } catch (error: any) {
      console.error('[Delete All] Error:', error);
      setMessage({
        type: 'error',
        text: `Failed to delete records: ${error.message || 'Unknown error'}`
      });
      setDeleting(false);
      setDeleteProgress({ current: 0, total: 0, percentage: 0 });
    }
  };

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-8 text-center">
        <div className="inline-flex items-center gap-2 text-slate-400">
          <div className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></div>
          <span>Loading valid order data...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-xl rounded-2xl border border-slate-700/50 shadow-xl">
      <div className="bg-gradient-to-r from-blue-500/10 via-cyan-500/10 to-teal-500/10 border-b border-slate-700/50 px-6 py-4">
        <div className="flex items-center justify-between">
          <div></div>
          <div className="flex items-center gap-3">
            {(activeCount + inactiveCount) > 0 && (
              <button
                onClick={() => {
                  console.log('[Delete All] Button clicked, opening modal...');
                  setShowDeleteAllModal(true);
                }}
                disabled={deleting}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <AlertTriangle className="w-4 h-4" />
                {deleting ? 'Deleting...' : 'Delete All'}
              </button>
            )}
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Data
            </button>
          </div>
        </div>
      </div>

      <div className="p-6">
        {message && (
          <div className={`mb-4 p-4 rounded-lg flex items-start justify-between ${message.type === 'success' ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border border-red-500/30 text-red-400'}`}>
            <span className="flex-1">{message.text}</span>
            <button
              onClick={() => setMessage(null)}
              className="ml-3 text-white/60 hover:text-white transition-colors"
            >
              ×
            </button>
          </div>
        )}

        {/* Data Pool Statistics Card */}
        <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="col-span-1 md:col-span-2 bg-gradient-to-br from-blue-500/10 via-cyan-500/10 to-teal-500/10 backdrop-blur-sm border border-blue-500/30 rounded-xl p-6">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <Database className="w-5 h-5 text-blue-400" />
                  <span className="text-sm font-medium text-blue-300">Total Data Pool Size</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-5xl font-bold text-white">{(activeCount + inactiveCount).toLocaleString()}</span>
                  <span className="text-lg text-slate-400">/ 500,000</span>
                </div>
                <div className="mt-3 w-full bg-slate-700/50 rounded-full h-2.5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      (activeCount + inactiveCount) >= 500000 ? 'bg-red-500' :
                      (activeCount + inactiveCount) >= 450000 ? 'bg-amber-500' :
                      'bg-blue-500'
                    }`}
                    style={{ width: `${Math.min(((activeCount + inactiveCount) / 500000) * 100, 100)}%` }}
                  ></div>
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  {(activeCount + inactiveCount) >= 500000 ? (
                    <span className="text-red-400 font-semibold">Pool is full - new entries will replace oldest records</span>
                  ) : (activeCount + inactiveCount) >= 450000 ? (
                    <span className="text-amber-400 font-semibold">Pool is {Math.round(((activeCount + inactiveCount) / 500000) * 100)}% full - nearing capacity</span>
                  ) : (
                    <span className="text-blue-300">Pool has {(500000 - (activeCount + inactiveCount)).toLocaleString()} slots available</span>
                  )}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-rows-2 gap-4">
            <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/10 backdrop-blur-sm border border-emerald-500/30 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-medium text-emerald-300">Active Records</span>
              </div>
              <div className="text-3xl font-bold text-white">
                {activeCount.toLocaleString()}
              </div>
            </div>

            <div className="bg-gradient-to-br from-slate-500/10 to-slate-600/10 backdrop-blur-sm border border-slate-500/30 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <XCircle className="w-4 h-4 text-slate-400" />
                <span className="text-xs font-medium text-slate-300">Inactive Records</span>
              </div>
              <div className="text-3xl font-bold text-white">
                {inactiveCount.toLocaleString()}
              </div>
            </div>
          </div>
        </div>

        {showAddForm && (
          <div className="mb-6 space-y-4 p-4 bg-slate-800/50 rounded-xl border border-slate-700/50">
            <div className="flex gap-4">
              <div className="flex-1">
                <h3 className="text-lg font-bold text-white mb-4">Add Single Entry</h3>
                <form onSubmit={handleAddSingle} className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">
                      Product Value ({currencyUnit})
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.productValue}
                      onChange={(e) => setFormData({ ...formData, productValue: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">
                      Transaction ID
                    </label>
                    <input
                      type="text"
                      value={formData.transactionId}
                      onChange={(e) => setFormData({ ...formData, transactionId: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Add Entry
                  </button>
                </form>
              </div>

              <div className="flex-1">
                <h3 className="text-lg font-bold text-white mb-4">Bulk Upload</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">
                      Enter data (one per line: value,transaction_id) - Max 500,000 records per batch
                    </label>
                    <p className="text-xs text-slate-400 mb-2">
                      Supports multiple imports: Upload batch A, then batch B. Total = A + B (up to 500,000 total records)
                    </p>
                    <textarea
                      value={bulkText}
                      onChange={(e) => setBulkText(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                      rows={5}
                      placeholder="100.50,TXN12345678&#10;200.00,TXN87654321&#10;150.75,TXN11223344"
                    />
                  </div>
                  <button
                    onClick={handleBulkUpload}
                    disabled={uploading}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {uploading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Uploading... {uploadProgress.current > 0 && `${Math.round((uploadProgress.current / uploadProgress.total) * 100)}%`}
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4" />
                        Upload Bulk Data
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div className="flex items-center justify-end mb-4">
            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-400">Filter:</label>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as 'all' | 'active' | 'inactive');
                  setCurrentPage(1);
                }}
                className="px-3 py-1.5 bg-slate-800/50 backdrop-blur-sm border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Status</option>
                <option value="active">Active Only</option>
                <option value="inactive">Inactive Only</option>
              </select>
            </div>
          </div>

          {validData.length === 0 ? (
            <div className="text-center py-12">
              <div className="inline-flex flex-col items-center gap-3 p-8 rounded-xl bg-slate-800/30 border border-slate-700/50">
                <FileSpreadsheet className="w-12 h-12 text-slate-500" />
                <div className="text-slate-400 text-sm">No valid order data yet</div>
                <div className="text-slate-500 text-xs">Add data using the button above</div>
              </div>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <div className="overflow-y-auto" style={{ maxHeight: '640px' }}>
                  <table className="w-full">
                    <thead className="sticky top-0 bg-slate-800/95 backdrop-blur-sm z-10">
                      <tr className="border-b border-slate-700/50">
                        <th className="text-left py-3 px-4 text-slate-400 font-semibold text-sm w-16">#</th>
                        <th className="text-left py-3 px-4 text-slate-400 font-semibold text-sm">Product Value (USDT)</th>
                        <th className="text-left py-3 px-4 text-slate-400 font-semibold text-sm">Transaction ID</th>
                        <th className="text-left py-3 px-4 text-slate-400 font-semibold text-sm">Status</th>
                        <th className="text-left py-3 px-4 text-slate-400 font-semibold text-sm">Created At</th>
                        <th className="text-right py-3 px-4 text-slate-400 font-semibold text-sm">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {validData.map((data, index) => (
                        <tr key={data.id} className="border-b border-slate-700/30 hover:bg-slate-800/30">
                          <td className="py-3 px-4 text-slate-500 font-semibold text-sm">
                            {(currentPage - 1) * itemsPerPage + index + 1}
                          </td>
                          <td className="py-3 px-4 text-white font-semibold">${data.product_value.toFixed(2)}</td>
                          <td className="py-3 px-4 text-slate-300 font-mono text-sm">{data.transaction_id}</td>
                          <td className="py-3 px-4">
                            {data.is_active ? (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-500/10 text-emerald-400 rounded-lg text-xs font-semibold">
                                <CheckCircle className="w-3 h-3" />
                                Active
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-slate-500/10 text-slate-400 rounded-lg text-xs font-semibold">
                                <XCircle className="w-3 h-3" />
                                Inactive
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-slate-400 text-sm">
                            {new Date(data.created_at).toLocaleDateString()}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => handleToggleActive(data.id, data.is_active)}
                                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                                  data.is_active
                                    ? 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                                    : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                                }`}
                              >
                                {data.is_active ? 'Deactivate' : 'Activate'}
                              </button>
                              <button
                                onClick={() => setDeletingId(data.id)}
                                className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between px-4 py-3 bg-slate-800/50 rounded-lg border border-slate-700/50">
                  <div className="text-sm text-slate-400">
                    Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, totalCount)} of {totalCount} entries
                    {statusFilter !== 'all' && <span className="text-slate-500"> (filtered)</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                      Previous
                    </button>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: totalPages }, (_, i) => i + 1)
                        .filter(page => {
                          // Show first page, last page, current page, and pages around current
                          return page === 1 ||
                                 page === totalPages ||
                                 (page >= currentPage - 1 && page <= currentPage + 1);
                        })
                        .map((page, idx, arr) => (
                          <div key={page} className="flex items-center">
                            {idx > 0 && arr[idx - 1] !== page - 1 && (
                              <span className="px-2 text-slate-500">...</span>
                            )}
                            <button
                              onClick={() => setCurrentPage(page)}
                              className={`px-3 py-1 rounded-lg text-sm font-semibold transition-colors ${
                                currentPage === page
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                              }`}
                            >
                              {page}
                            </button>
                          </div>
                        ))}
                    </div>
                    <button
                      onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                      disabled={currentPage === totalPages}
                      className="px-3 py-1 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                      Next
                    </button>
                    <form onSubmit={handlePageInputSubmit} className="flex items-center gap-2 ml-2 pl-2 border-l border-slate-700">
                      <span className="text-sm text-slate-400">Go to:</span>
                      <input
                        type="number"
                        min="1"
                        max={totalPages}
                        value={pageInput}
                        onChange={handlePageInputChange}
                        placeholder={`1-${totalPages}`}
                        className="w-20 px-2 py-1 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        type="submit"
                        className="px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-semibold"
                      >
                        Go
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showDeleteAllModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl border-2 border-red-500/50 shadow-2xl max-w-md w-full overflow-hidden">
            <div className="bg-gradient-to-r from-red-600/20 to-red-500/20 border-b border-red-500/30 p-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-red-500/20 rounded-xl border border-red-500/30">
                  <AlertTriangle className="w-6 h-6 text-red-400" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">Delete All Records</h3>
                  <p className="text-sm text-red-300 mt-0.5">This action cannot be undone!</p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
                <p className="text-slate-200 text-sm leading-relaxed">
                  You are about to permanently delete <span className="text-red-400 font-bold text-lg">{(activeCount + inactiveCount).toLocaleString()}</span> valid order data records.
                </p>
                <p className="text-slate-300 text-sm mt-2">
                  This will remove all transaction IDs and product values from the system.
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  Type <span className="text-red-400 font-mono">DELETE ALL</span> to confirm:
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="DELETE ALL"
                  className="w-full px-4 py-3 bg-slate-900/80 border-2 border-slate-600 focus:border-red-500 rounded-lg text-white font-mono focus:outline-none focus:ring-2 focus:ring-red-500/50 transition-all"
                  disabled={deleting}
                  autoFocus
                />
                {message && message.type === 'error' && confirmText.length > 0 && confirmText !== 'DELETE ALL' && (
                  <p className="text-red-400 text-xs mt-2">
                    ⚠ Must match exactly: DELETE ALL
                  </p>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => {
                    setShowDeleteAllModal(false);
                    setConfirmText('');
                    setMessage(null);
                  }}
                  disabled={deleting}
                  className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteAll}
                  disabled={deleting || confirmText !== 'DELETE ALL'}
                  className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-500 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {deleting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      Delete All
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deletingId && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-white mb-4">Confirm Deletion</h3>
            <p className="text-slate-300 mb-6">
              Are you sure you want to delete this valid order data? This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeletingId(null)}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deletingId)}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-all"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Progress Modal */}
      {deleting && deleteProgress.total > 0 && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4">
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 border-2 border-red-500/50 rounded-2xl p-8 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-14 h-14 bg-red-500/20 rounded-full flex items-center justify-center animate-pulse">
                <Trash2 className="w-7 h-7 text-red-500" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Deleting Records...</h3>
                <p className="text-sm text-slate-400 mt-1">Please wait, this may take a moment</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-slate-700/50 backdrop-blur-sm rounded-xl p-4 border border-slate-600">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-sm font-medium text-slate-300">Progress</span>
                  <span className="text-lg font-bold text-red-400">{deleteProgress.percentage}%</span>
                </div>

                {/* Progress Bar */}
                <div className="relative w-full h-3 bg-slate-800/80 rounded-full overflow-hidden border border-slate-600">
                  <div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-red-500 to-red-600 transition-all duration-300 ease-out rounded-full"
                    style={{ width: `${deleteProgress.percentage}%` }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer"></div>
                  </div>
                </div>

                <div className="flex justify-between items-center mt-3">
                  <span className="text-xs text-slate-400">
                    Deleted: <span className="font-semibold text-white">{deleteProgress.current.toLocaleString()}</span>
                  </span>
                  <span className="text-xs text-slate-400">
                    Total: <span className="font-semibold text-white">{deleteProgress.total.toLocaleString()}</span>
                  </span>
                </div>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                <p className="text-xs text-blue-300 text-center">
                  🔒 Do not close this window or refresh the page
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
