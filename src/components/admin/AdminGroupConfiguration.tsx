import { useState, useEffect } from 'react';
import { Save, ArrowLeft, Users, TrendingUp, DollarSign, Calendar, Building2, CheckCircle, XCircle, Shield, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Admin } from '../../types';

interface AdminGroupConfigurationProps {
  admin: Admin;
}

interface AdminGroup {
  id: string;
  username: string;
  role: string;
  created_at: string;
  configs: {
    company_name?: string;
    currency_unit?: string;
    commission_rate?: string;
    success_rate?: string;
    withdrawal_amount_threshold?: string;
    withdrawal_days_threshold?: string;
    withdrawal_condition_mode?: string;
  };
  employee_count: number;
}

interface ConfigFormValues {
  company_name: string;
  currency_unit: string;
  commission_rate: string;
  success_rate: string;
  withdrawal_amount_threshold: string;
  withdrawal_days_threshold: string;
  withdrawal_condition_mode: string;
}

export default function AdminGroupConfiguration({ admin }: AdminGroupConfigurationProps) {
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<AdminGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formValues, setFormValues] = useState<ConfigFormValues>({
    company_name: '',
    currency_unit: '',
    commission_rate: '',
    success_rate: '',
    withdrawal_amount_threshold: '',
    withdrawal_days_threshold: '',
    withdrawal_condition_mode: '',
  });
  const [globalDefaults, setGlobalDefaults] = useState<ConfigFormValues>({
    company_name: '',
    currency_unit: '',
    commission_rate: '',
    success_rate: '',
    withdrawal_amount_threshold: '',
    withdrawal_days_threshold: '',
    withdrawal_condition_mode: '',
  });
  const [notification, setNotification] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [loginTitle, setLoginTitle] = useState('');
  const [loginSubtitle, setLoginSubtitle] = useState('');
  const [savingLoginSettings, setSavingLoginSettings] = useState(false);
  const [loginSettingsExpanded, setLoginSettingsExpanded] = useState(false);

  useEffect(() => {
    loadGroups();
    loadGlobalDefaults();
    loadLoginPageSettings();
  }, []);

  const loadLoginPageSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('system_configs')
        .select('key, value')
        .in('key', ['login_title', 'login_subtitle']);

      if (error) throw error;

      data?.forEach(config => {
        if (config.key === 'login_title') {
          setLoginTitle(config.value as string || '');
        } else if (config.key === 'login_subtitle') {
          setLoginSubtitle(config.value as string || '');
        }
      });
    } catch (error) {
      console.error('Error loading login page settings:', error);
    }
  };

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => {
        setNotification(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  useEffect(() => {
    if (selectedGroup) {
      const updatedGroup = groups.find(g => g.id === selectedGroup.id);
      if (updatedGroup && JSON.stringify(updatedGroup.configs) !== JSON.stringify(selectedGroup.configs)) {
        setSelectedGroup(updatedGroup);
      }
    }
  }, [groups]);

  const loadGlobalDefaults = async () => {
    try {
      const { data, error } = await supabase
        .from('admin_configs')
        .select('config_type, config_value')
        .is('admin_id', null);

      if (error) throw error;

      const defaults: any = {};
      data?.forEach(config => {
        defaults[config.config_type] = config.config_value;
      });

      setGlobalDefaults({
        company_name: defaults.company_name || '',
        currency_unit: defaults.currency_unit || 'USDT',
        commission_rate: defaults.commission_rate || '',
        success_rate: defaults.success_rate || '',
        withdrawal_amount_threshold: defaults.withdrawal_amount_threshold || '',
        withdrawal_days_threshold: defaults.withdrawal_days_threshold || '',
        withdrawal_condition_mode: defaults.withdrawal_condition_mode || '',
      });
    } catch (error) {
      console.error('Error loading global defaults:', error);
    }
  };

  const loadGroups = async (showLoadingState = true) => {
    try {
      if (showLoadingState) {
        setLoading(true);
      }

      const { data: adminsData, error: adminsError } = await supabase
        .from('admins')
        .select('id, username, role, created_at')
        .in('role', ['super_admin', 'secondary_admin'])
        .order('created_at', { ascending: false });

      if (adminsError) throw adminsError;

      const { data: configsData, error: configsError } = await supabase
        .from('admin_configs')
        .select('admin_id, config_type, config_value')
        .not('admin_id', 'is', null);

      if (configsError) throw configsError;

      const groupsWithConfigs: AdminGroup[] = await Promise.all(
        (adminsData || []).map(async (admin) => {
          const adminConfigs = configsData?.filter(c => c.admin_id === admin.id) || [];
          const configs: any = {};
          adminConfigs.forEach(config => {
            configs[config.config_type] = config.config_value;
          });

          const { count } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true })
            .eq('created_by', admin.id);

          return {
            id: admin.id,
            username: admin.username,
            role: admin.role,
            created_at: admin.created_at,
            configs,
            employee_count: count || 0,
          };
        })
      );

      const sortedGroups = groupsWithConfigs.sort((a, b) => {
        if (a.role === 'super_admin' && b.role !== 'super_admin') return -1;
        if (a.role !== 'super_admin' && b.role === 'super_admin') return 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

      setGroups(sortedGroups);
    } catch (error) {
      console.error('Error loading groups:', error);
    } finally {
      if (showLoadingState) {
        setLoading(false);
      }
    }
  };

  const handleGroupSelect = (group: AdminGroup) => {
    setSelectedGroup(group);
    setFormValues({
      company_name: group.configs.company_name || globalDefaults.company_name,
      currency_unit: group.configs.currency_unit || globalDefaults.currency_unit || 'USDT',
      commission_rate: group.configs.commission_rate || globalDefaults.commission_rate,
      success_rate: group.configs.success_rate || globalDefaults.success_rate,
      withdrawal_amount_threshold: group.configs.withdrawal_amount_threshold || globalDefaults.withdrawal_amount_threshold,
      withdrawal_days_threshold: group.configs.withdrawal_days_threshold || globalDefaults.withdrawal_days_threshold,
      withdrawal_condition_mode: group.configs.withdrawal_condition_mode || globalDefaults.withdrawal_condition_mode || 'OR',
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroup) return;

    setSaving(true);

    try {
      for (const [configType, configValue] of Object.entries(formValues)) {
        if (!configValue || configValue === '') {
          throw new Error(`${configType} cannot be empty`);
        }
      }

      await supabase
        .from('admin_configs')
        .delete()
        .eq('admin_id', selectedGroup.id);

      const configRecords = Object.entries(formValues).map(([configType, configValue]) => ({
        admin_id: selectedGroup.id,
        config_type: configType,
        config_value: configValue,
        updated_at: new Date().toISOString(),
      }));

      const { error: insertError } = await supabase
        .from('admin_configs')
        .insert(configRecords);

      if (insertError) throw insertError;

      await loadGroups(false);

      setNotification({
        type: 'success',
        message: 'Configuration saved successfully',
      });
    } catch (error: any) {
      console.error('Error saving config:', error);
      setNotification({
        type: 'error',
        message: `Failed to save: ${error.message}`,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteConfig = async (groupId: string) => {
    setDeleteTargetId(groupId);
    setShowDeleteConfirm(true);
  };

  const handleSaveLoginSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingLoginSettings(true);

    try {
      const updates = [
        { key: 'login_title', value: loginTitle },
        { key: 'login_subtitle', value: loginSubtitle }
      ];

      for (const update of updates) {
        const { error } = await supabase
          .from('system_configs')
          .update({ value: update.value, updated_at: new Date().toISOString() })
          .eq('key', update.key);

        if (error) throw error;
      }

      setNotification({
        type: 'success',
        message: 'Login page settings saved successfully',
      });
    } catch (error: any) {
      console.error('Error saving login settings:', error);
      setNotification({
        type: 'error',
        message: `Failed to save: ${error.message}`,
      });
    } finally {
      setSavingLoginSettings(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTargetId) return;

    try {
      const { error } = await supabase
        .from('admin_configs')
        .delete()
        .eq('admin_id', deleteTargetId);

      if (error) throw error;

      await loadGroups(false);
      setNotification({
        type: 'success',
        message: 'Configuration reset to global defaults successfully',
      });
      setShowDeleteConfirm(false);
      setDeleteTargetId(null);
    } catch (error) {
      console.error('Error deleting config:', error);
      setNotification({
        type: 'error',
        message: 'Failed to reset configuration',
      });
    }
  };

  if (loading) {
    return (
      <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-blue-500/20 p-8 text-center">
        <div className="text-slate-400">Loading admin groups...</div>
      </div>
    );
  }

  if (selectedGroup) {
    return (
      <div className="space-y-6">
        {notification && (
          <div
            className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-6 py-4 rounded-lg shadow-2xl border backdrop-blur-xl transition-all duration-300 animate-in slide-in-from-top ${
              notification.type === 'success'
                ? 'bg-green-900/90 border-green-500/50 text-green-100'
                : 'bg-red-900/90 border-red-500/50 text-red-100'
            }`}
          >
            {notification.type === 'success' ? (
              <CheckCircle className="w-5 h-5 text-green-400" />
            ) : (
              <XCircle className="w-5 h-5 text-red-400" />
            )}
            <span className="font-medium">{notification.message}</span>
            <button
              onClick={() => setNotification(null)}
              className="ml-2 text-white/60 hover:text-white transition-colors"
            >
              ×
            </button>
          </div>
        )}

        {showDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-slate-900 border border-red-500/30 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
              <h3 className="text-xl font-bold text-white mb-4">Reset Configuration?</h3>
              <p className="text-slate-300 mb-6">
                Are you sure you want to reset all configurations for this admin? They will use global defaults.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteTargetId(null);
                  }}
                  className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
                >
                  Reset
                </button>
              </div>
            </div>
          </div>
        )}

        <button
          onClick={() => setSelectedGroup(null)}
          className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Groups
        </button>

        <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-blue-500/20 p-6">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-white mb-2">
              Configure Admin: {selectedGroup.username}
            </h2>
            <p className="text-slate-400 text-sm">
              Set custom parameters for this admin's team ({selectedGroup.employee_count} employees)
            </p>
          </div>

          <div className="bg-gradient-to-br from-blue-500/10 via-cyan-500/10 to-blue-500/10 border border-blue-500/30 rounded-xl p-5 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
              <h3 className="text-blue-300 font-semibold">Current Active Parameters</h3>
              {Object.keys(selectedGroup.configs).length > 0 ? (
                <span className="ml-auto px-2.5 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full border border-green-500/30">
                  Custom
                </span>
              ) : (
                <span className="ml-auto px-2.5 py-0.5 bg-slate-500/20 text-slate-400 text-xs rounded-full border border-slate-500/30">
                  Global
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
                <div className="text-xs text-slate-400 mb-1">Commission Rate</div>
                <div className="text-lg font-bold text-white">
                  {(parseFloat(selectedGroup.configs.commission_rate || globalDefaults.commission_rate || '0') * 100).toFixed(3)}%
                </div>
              </div>
              <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
                <div className="text-xs text-slate-400 mb-1">Success Rate</div>
                <div className="text-lg font-bold text-white">
                  {(parseFloat(selectedGroup.configs.success_rate || globalDefaults.success_rate || '0') * 100).toFixed(0)}%
                </div>
              </div>
              <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
                <div className="text-xs text-slate-400 mb-1">Withdrawal Amount</div>
                <div className="text-lg font-bold text-white">
                  {selectedGroup.configs.withdrawal_amount_threshold || globalDefaults.withdrawal_amount_threshold || '0'} {selectedGroup.configs.currency_unit || globalDefaults.currency_unit || 'USDT'}
                </div>
              </div>
              <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
                <div className="text-xs text-slate-400 mb-1">Withdrawal Orders</div>
                <div className="text-lg font-bold text-white">
                  {selectedGroup.configs.withdrawal_days_threshold || globalDefaults.withdrawal_days_threshold || '0'} orders
                </div>
              </div>
              <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
                <div className="text-xs text-slate-400 mb-1">Condition Mode</div>
                <div className="text-sm font-bold text-white">
                  {(() => {
                    const mode = (selectedGroup.configs.withdrawal_condition_mode || globalDefaults.withdrawal_condition_mode || 'OR').toUpperCase();
                    switch (mode) {
                      case 'AMOUNT_ONLY': return 'Amount Only';
                      case 'DAYS_ONLY': return 'Days Only';
                      case 'BOTH':
                      case 'AND': return 'Both Required';
                      case 'EITHER':
                      case 'OR': return 'Either (OR)';
                      default: return 'Either (OR)';
                    }
                  })()}
                </div>
              </div>
              <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
                <div className="text-xs text-slate-400 mb-1">Brand Name</div>
                <div className="text-lg font-bold text-white truncate">
                  {selectedGroup.configs.company_name || globalDefaults.company_name || 'Not Set'}
                </div>
              </div>
            </div>
          </div>

          <form onSubmit={handleSave} className="space-y-6">
            <div className="bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/30 rounded-lg p-6">
              <h3 className="text-yellow-400 font-semibold mb-4 flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                Brand Name
              </h3>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Company Name
                </label>
                <input
                  type="text"
                  value={formValues.company_name}
                  onChange={(e) => setFormValues({ ...formValues, company_name: e.target.value })}
                  required
                  maxLength={50}
                  className="w-full px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-yellow-500"
                  placeholder="Enter brand name"
                />
                <p className="text-slate-500 text-xs mt-1">
                  This brand name will be displayed to all employees under this admin
                </p>
              </div>
              <div className="mt-4">
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Currency Unit
                </label>
                <input
                  type="text"
                  value={formValues.currency_unit}
                  onChange={(e) => setFormValues({ ...formValues, currency_unit: e.target.value.replace(/\s+/g, '') })}
                  required
                  maxLength={10}
                  className="w-full px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-yellow-500"
                  placeholder="USDT"
                />
                <p className="text-slate-500 text-xs mt-1">
                  Currency unit displayed on employee pages (e.g., USDT, USD, BTC)
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Commission Rate
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.00001"
                    min="0.00001"
                    max="1"
                    value={formValues.commission_rate}
                    onChange={(e) => setFormValues({ ...formValues, commission_rate: e.target.value })}
                    required
                    className="w-full px-4 py-2 pr-32 bg-slate-800/50 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="0.05"
                  />
                  <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 text-xs pointer-events-none">
                    (0.00001-1.0)
                  </span>
                </div>
                <p className="text-slate-500 text-xs mt-1">Global default: {globalDefaults.commission_rate}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Order Success Rate
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0.1"
                    max="1"
                    value={formValues.success_rate}
                    onChange={(e) => setFormValues({ ...formValues, success_rate: e.target.value })}
                    required
                    className="w-full px-4 py-2 pr-40 bg-slate-800/50 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="0.80"
                  />
                  <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 text-sm pointer-events-none">
                    (e.g., 0.80 = 80%)
                  </span>
                </div>
                <p className="text-slate-500 text-xs mt-1">Global default: {globalDefaults.success_rate}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Withdrawal Amount Threshold
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formValues.withdrawal_amount_threshold}
                    onChange={(e) => setFormValues({ ...formValues, withdrawal_amount_threshold: e.target.value })}
                    required
                    className="w-full px-4 py-2 pr-20 bg-slate-800/50 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="100"
                  />
                  <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 text-sm pointer-events-none">
                    {formValues.currency_unit || globalDefaults.currency_unit || 'USDT'}
                  </span>
                </div>
                <p className="text-slate-500 text-xs mt-1">Global default: {globalDefaults.withdrawal_amount_threshold} {globalDefaults.currency_unit || 'USDT'}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Withdrawal Orders Threshold
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={formValues.withdrawal_days_threshold}
                    onChange={(e) => setFormValues({ ...formValues, withdrawal_days_threshold: e.target.value })}
                    required
                    className="w-full px-4 py-2 pr-20 bg-slate-800/50 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="1000"
                  />
                  <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 text-sm pointer-events-none">
                    orders
                  </span>
                </div>
                <p className="text-slate-500 text-xs mt-1">Global default: {globalDefaults.withdrawal_days_threshold} orders</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Withdrawal Condition Mode
                </label>
                <select
                  value={formValues.withdrawal_condition_mode}
                  onChange={(e) => setFormValues({ ...formValues, withdrawal_condition_mode: e.target.value })}
                  required
                  className="w-full px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="amount_only">Amount Only (Balance must meet threshold)</option>
                  <option value="days_only">Orders Only (Total orders must meet threshold)</option>
                  <option value="OR">Either Condition (Balance OR Orders - Default)</option>
                  <option value="AND">Both Conditions (Balance AND Orders required)</option>
                </select>
                <p className="text-slate-500 text-xs mt-1">
                  Global default: {
                    (() => {
                      const mode = (globalDefaults.withdrawal_condition_mode || 'OR').toUpperCase();
                      switch (mode) {
                        case 'AMOUNT_ONLY': return 'Amount Only';
                        case 'DAYS_ONLY': return 'Days Only';
                        case 'AND':
                        case 'BOTH': return 'Both Conditions';
                        case 'OR':
                        case 'EITHER': return 'Either Condition';
                        default: return 'Either Condition';
                      }
                    })()
                  }
                </p>
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => setSelectedGroup(null)}
                disabled={saving}
                className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Save className="w-5 h-5" />
                {saving ? 'Saving...' : 'Save Configuration'}
              </button>
              <button
                type="button"
                onClick={() => handleDeleteConfig(selectedGroup.id)}
                disabled={saving}
                className="px-6 py-3 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg font-medium transition-colors border border-red-500/30 disabled:opacity-50"
              >
                Reset to Global
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-6 py-4 rounded-lg shadow-2xl border backdrop-blur-xl transition-all duration-300 animate-in slide-in-from-top ${
            notification.type === 'success'
              ? 'bg-green-900/90 border-green-500/50 text-green-100'
              : 'bg-red-900/90 border-red-500/50 text-red-100'
          }`}
        >
          {notification.type === 'success' ? (
            <CheckCircle className="w-5 h-5 text-green-400" />
          ) : (
            <XCircle className="w-5 h-5 text-red-400" />
          )}
          <span className="font-medium">{notification.message}</span>
          <button
            onClick={() => setNotification(null)}
            className="ml-2 text-white/60 hover:text-white transition-colors"
          >
            ×
          </button>
        </div>
      )}

      <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-blue-500/20 p-6">
        <p className="text-slate-400 text-sm">
          Manage configurations for each secondary admin and their teams
        </p>
      </div>

      <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-purple-500/20 overflow-hidden">
        <button
          onClick={() => setLoginSettingsExpanded(!loginSettingsExpanded)}
          className="w-full p-6 flex items-center justify-between hover:bg-slate-800/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-purple-400" />
            <div className="text-left">
              <h2 className="text-xl font-bold text-white">Login Page Settings</h2>
              <p className="text-slate-400 text-sm mt-1">
                Customize the login page title and subtitle
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {loginTitle && (
              <span className="px-3 py-1 bg-purple-500/20 text-purple-400 text-xs rounded-full border border-purple-500/30">
                Customized
              </span>
            )}
            {loginSettingsExpanded ? (
              <ChevronUp className="w-5 h-5 text-slate-400" />
            ) : (
              <ChevronDown className="w-5 h-5 text-slate-400" />
            )}
          </div>
        </button>

        {loginSettingsExpanded && (
          <div className="p-6 pt-0 border-t border-purple-500/10">
            <form onSubmit={handleSaveLoginSettings} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Login Page Title
                </label>
                <input
                  type="text"
                  value={loginTitle}
                  onChange={(e) => setLoginTitle(e.target.value)}
                  required
                  maxLength={100}
                  className="w-full px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="e.g., QUANTUM TRADER"
                />
                <p className="text-slate-500 text-xs mt-1">
                  This will be displayed as the main title on the login page
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Login Page Subtitle
                </label>
                <input
                  type="text"
                  value={loginSubtitle}
                  onChange={(e) => setLoginSubtitle(e.target.value)}
                  required
                  maxLength={200}
                  className="w-full px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="e.g., BLOCKCHAIN TRADING PLATFORM"
                />
                <p className="text-slate-500 text-xs mt-1">
                  This will be displayed below the title on the login page
                </p>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={savingLoginSettings}
                  className="bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white px-6 py-2 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {savingLoginSettings ? 'Saving...' : 'Save Login Settings'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-blue-500/20 overflow-hidden">
        {groups.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="w-16 h-16 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-400">No secondary admins found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700/50 bg-slate-800/50">
                  <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Admin</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Status</th>
                  <th className="px-6 py-4 text-center text-sm font-semibold text-slate-300">Employees</th>
                  <th className="px-6 py-4 text-center text-sm font-semibold text-slate-300">Commission</th>
                  <th className="px-6 py-4 text-center text-sm font-semibold text-slate-300">Success Rate</th>
                  <th className="px-6 py-4 text-center text-sm font-semibold text-slate-300">Withdrawal</th>
                  <th className="px-6 py-4 text-center text-sm font-semibold text-slate-300">Min Days</th>
                  <th className="px-6 py-4 text-center text-sm font-semibold text-slate-300">Action</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => {
                  const hasCustomConfig = Object.keys(group.configs).length > 0;
                  const commissionRate = group.configs.commission_rate || globalDefaults.commission_rate;
                  const successRate = group.configs.success_rate || globalDefaults.success_rate;
                  const withdrawalAmount = group.configs.withdrawal_amount_threshold || globalDefaults.withdrawal_amount_threshold;
                  const withdrawalDays = group.configs.withdrawal_days_threshold || globalDefaults.withdrawal_days_threshold;

                  return (
                    <tr
                      key={group.id}
                      className="border-b border-slate-700/30 hover:bg-slate-800/50 transition-colors"
                    >
                      <td className="px-6 py-4">
                        <div>
                          <div className="font-semibold text-white">
                            {group.username}
                          </div>
                          {group.configs.company_name && (
                            <div className="text-sm text-slate-500">{group.configs.company_name}</div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {hasCustomConfig ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded-full border border-green-500/30">
                            Custom
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-1 bg-slate-500/20 text-slate-400 text-xs rounded-full border border-slate-500/30">
                            Global
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Users className="w-4 h-4 text-blue-400" />
                          <span className="text-white font-medium">{group.employee_count}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <DollarSign className="w-4 h-4 text-green-400" />
                          <span className="text-white font-medium">
                            {(parseFloat(commissionRate || '0') * 100).toFixed(3)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <TrendingUp className="w-4 h-4 text-yellow-400" />
                          <span className="text-white font-medium">
                            {(parseFloat(successRate || '0') * 100).toFixed(0)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <DollarSign className="w-4 h-4 text-cyan-400" />
                          <span className="text-white font-medium">{withdrawalAmount} {group.configs.currency_unit || globalDefaults.currency_unit || 'USDT'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Calendar className="w-4 h-4 text-blue-400" />
                          <span className="text-white font-medium">{withdrawalDays} orders</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <button
                          onClick={() => handleGroupSelect(group)}
                          className="px-4 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded-lg text-sm font-medium transition-colors border border-blue-500/30"
                        >
                          Configure
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
