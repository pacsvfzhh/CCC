import { useState, useEffect } from 'react';
import { Save, CheckCircle, XCircle, Building2, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Admin } from '../../types';

interface SecondaryAdminConfigurationProps {
  admin: Admin;
}

export default function SecondaryAdminConfiguration({ admin }: SecondaryAdminConfigurationProps) {
  const [formValues, setFormValues] = useState({
    company_name: '',
    currency_unit: '',
    commission_rate: '',
    success_rate: '',
    withdrawal_amount_threshold: '',
    withdrawal_days_threshold: '',
    withdrawal_condition_mode: '',
  });
  const [globalDefaults, setGlobalDefaults] = useState({
    company_name: '',
    currency_unit: '',
    commission_rate: '',
    success_rate: '',
    withdrawal_amount_threshold: '',
    withdrawal_days_threshold: '',
    withdrawal_condition_mode: '',
  });
  const [hasCustomConfig, setHasCustomConfig] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [notification, setNotification] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  useEffect(() => {
    loadConfigs();
  }, []);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => {
        setNotification(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const loadConfigs = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('admin_configs')
        .select('*')
        .or(`admin_id.eq.${admin.id},admin_id.is.null`);

      if (error) throw error;

      console.log('Secondary Admin Config - Raw data:', data);
      console.log('Secondary Admin ID:', admin.id);

      const configMap: any = {};
      const globalMap: any = {};

      data?.forEach((config) => {
        if (config.admin_id === admin.id) {
          configMap[config.config_type] = config.config_value;
        } else if (config.admin_id === null) {
          globalMap[config.config_type] = config.config_value;
        }
      });

      console.log('Config Map (for this admin):', configMap);
      console.log('Global Map:', globalMap);

      const hasCustom = Object.keys(configMap).length > 0;
      setHasCustomConfig(hasCustom);

      setGlobalDefaults({
        company_name: globalMap.company_name || '',
        currency_unit: globalMap.currency_unit || 'USDT',
        commission_rate: globalMap.commission_rate || '',
        success_rate: globalMap.success_rate || '',
        withdrawal_amount_threshold: globalMap.withdrawal_amount_threshold || '',
        withdrawal_days_threshold: globalMap.withdrawal_days_threshold || '',
        withdrawal_condition_mode: globalMap.withdrawal_condition_mode || '',
      });

      setFormValues({
        company_name: configMap.company_name || globalMap.company_name || '',
        currency_unit: configMap.currency_unit || globalMap.currency_unit || 'USDT',
        commission_rate: configMap.commission_rate || globalMap.commission_rate || '',
        success_rate: configMap.success_rate || globalMap.success_rate || '',
        withdrawal_amount_threshold: configMap.withdrawal_amount_threshold || globalMap.withdrawal_amount_threshold || '',
        withdrawal_days_threshold: configMap.withdrawal_days_threshold || globalMap.withdrawal_days_threshold || '',
        withdrawal_condition_mode: configMap.withdrawal_condition_mode || globalMap.withdrawal_condition_mode || '',
      });
    } catch (error) {
      console.error('Error loading configs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      for (const [configType, configValue] of Object.entries(formValues)) {
        if (!configValue || configValue === '') {
          throw new Error(`${configType} cannot be empty`);
        }

        await supabase
          .from('admin_configs')
          .delete()
          .eq('config_type', configType)
          .eq('admin_id', admin.id);

        const { error: insertError } = await supabase
          .from('admin_configs')
          .insert({
            admin_id: admin.id,
            config_type: configType,
            config_value: configValue,
            updated_at: new Date().toISOString(),
          });

        if (insertError) throw insertError;
      }

      setNotification({
        type: 'success',
        message: 'Configuration saved successfully',
      });

      await loadConfigs();
    } catch (error: any) {
      console.error('Error saving configs:', error);
      setNotification({
        type: 'error',
        message: `Failed to save configuration: ${error.message || 'Unknown error'}`,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleResetToGlobal = async () => {
    try {
      const { error } = await supabase
        .from('admin_configs')
        .delete()
        .eq('admin_id', admin.id);

      if (error) throw error;

      await loadConfigs();
      setNotification({
        type: 'success',
        message: 'Configuration reset to global defaults successfully',
      });
      setShowResetConfirm(false);
    } catch (error) {
      console.error('Error resetting config:', error);
      setNotification({
        type: 'error',
        message: 'Failed to reset configuration',
      });
    }
  };

  console.log('SecondaryAdminConfiguration - Loading state:', loading);
  console.log('SecondaryAdminConfiguration - Form values:', formValues);

  if (loading) {
    return (
      <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-blue-500/20 p-8 text-center">
        <div className="text-slate-400">Loading configuration...</div>
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

      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-slate-900 border border-red-500/30 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-4">Reset to Global Configuration?</h3>
            <p className="text-slate-300 mb-6">
              Are you sure you want to reset all your team configurations? All custom settings will be removed and your team will use the global defaults set by the Super Admin.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleResetToGlobal}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-blue-500/20 p-6">
        <p className="text-slate-400 text-sm mb-4">
          View and manage configuration parameters for your employee team
        </p>
      </div>

      <div className="bg-gradient-to-br from-blue-500/10 via-cyan-500/10 to-blue-500/10 border border-blue-500/30 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
          <h3 className="text-blue-300 font-semibold">Current Active Parameters</h3>
          {hasCustomConfig ? (
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
              {(parseFloat(formValues.commission_rate || '0') * 100).toFixed(3)}%
            </div>
          </div>
          <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
            <div className="text-xs text-slate-400 mb-1">Success Rate</div>
            <div className="text-lg font-bold text-white">
              {(parseFloat(formValues.success_rate || '0') * 100).toFixed(0)}%
            </div>
          </div>
          <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
            <div className="text-xs text-slate-400 mb-1">Withdrawal Amount</div>
            <div className="text-lg font-bold text-white">
              {formValues.withdrawal_amount_threshold || '0'} {formValues.currency_unit || 'USDT'}
            </div>
          </div>
          <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
            <div className="text-xs text-slate-400 mb-1">Withdrawal Orders</div>
            <div className="text-lg font-bold text-white">
              {formValues.withdrawal_days_threshold || '0'} orders
            </div>
          </div>
          <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
            <div className="text-xs text-slate-400 mb-1">Condition Mode</div>
            <div className="text-sm font-bold text-white">
              {(() => {
                const mode = (formValues.withdrawal_condition_mode || 'either').toUpperCase();
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
              {formValues.company_name || 'Not Set'}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-gradient-to-r from-blue-500/10 to-cyan-500/10 border border-blue-500/30 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-blue-500/20 rounded-lg flex-shrink-0">
            <Building2 className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <p className="text-sm text-blue-200 font-semibold mb-1">Your Team's Configuration</p>
            <p className="text-sm text-blue-300/80">
              These settings apply to all employees in your team. You can customize your brand name and operating parameters. Any values you don't set will automatically use the global defaults.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-blue-500/20 p-6">
        <form onSubmit={handleSave} className="space-y-6">
          <div className="bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/30 rounded-lg p-6">
            <h3 className="text-yellow-400 font-semibold mb-4 flex items-center gap-2">
              <Building2 className="w-5 h-5" />
              My Brand Name
            </h3>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Your Brand Name
              </label>
              <input
                type="text"
                value={formValues.company_name}
                onChange={(e) => setFormValues({ ...formValues, company_name: e.target.value })}
                required
                maxLength={50}
                className="w-full px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-yellow-500"
                placeholder="Enter your brand name"
              />
              <p className="text-slate-500 text-xs mt-1">
                This name will appear in the header for all your employees
              </p>
              {globalDefaults.company_name && (
                <p className="text-slate-600 text-xs mt-1">
                  Global default: {globalDefaults.company_name}
                </p>
              )}
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
              {globalDefaults.currency_unit && (
                <p className="text-slate-600 text-xs mt-1">
                  Global default: {globalDefaults.currency_unit}
                </p>
              )}
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
              <p className="text-slate-500 text-xs mt-1">Commission rate for successful orders</p>
              {globalDefaults.commission_rate && (
                <p className="text-slate-600 text-xs mt-1">
                  Global default: {globalDefaults.commission_rate}
                </p>
              )}
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
              <p className="text-slate-500 text-xs mt-1">Probability of order success (10-100% range)</p>
              {globalDefaults.success_rate && (
                <p className="text-slate-600 text-xs mt-1">
                  Global default: {globalDefaults.success_rate}
                </p>
              )}
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
                  {formValues.currency_unit || 'USDT'}
                </span>
              </div>
              <p className="text-slate-500 text-xs mt-1">Minimum balance required for withdrawal</p>
              {globalDefaults.withdrawal_amount_threshold && (
                <p className="text-slate-600 text-xs mt-1">
                  Global default: {globalDefaults.withdrawal_amount_threshold} {globalDefaults.currency_unit || 'USDT'}
                </p>
              )}
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
              <p className="text-slate-500 text-xs mt-1">Minimum completed orders required for withdrawal eligibility</p>
              {globalDefaults.withdrawal_days_threshold && (
                <p className="text-slate-600 text-xs mt-1">
                  Global default: {globalDefaults.withdrawal_days_threshold} orders
                </p>
              )}
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
                      case 'EITHER': return 'Either Condition (Default)';
                      default: return globalDefaults.withdrawal_condition_mode || 'Not set';
                    }
                  })()
                }
              </p>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Save className="w-5 h-5" />
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
            {hasCustomConfig && (
              <button
                type="button"
                onClick={() => setShowResetConfirm(true)}
                className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-all duration-200 flex items-center gap-2"
              >
                <RefreshCw className="w-5 h-5" />
                Reset to Global
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
