import { useState, useEffect, useRef } from 'react';
import { Save, CheckCircle, XCircle, Building2, ArrowLeftRight } from 'lucide-react';
import { formatSupabaseError, supabase } from '../../lib/supabase';
import { Admin } from '../../types';

interface SecondaryAdminConfigurationProps {
  admin: Admin;
}

export default function SecondaryAdminConfiguration({ admin }: SecondaryAdminConfigurationProps) {
  const [formValues, setFormValues] = useState({
    company_name: '',
    currency_unit: '',
  });
  const [globalDefaults, setGlobalDefaults] = useState({
    company_name: '',
    currency_unit: '',
  });
  const [brandingMode, setBrandingMode] = useState<'custom' | 'global'>('global');
  const [brandingModeConfigId, setBrandingModeConfigId] = useState<string | null>(null);
  const [savedValues, setSavedValues] = useState({ company_name: '', currency_unit: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notification, setNotification] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const loadConfigsRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    void loadConfigsRef.current?.();
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
        .or(`admin_id.eq.${admin.id},admin_id.is.null`)
        .in('config_type', ['company_name', 'currency_unit', 'branding_mode']);

      if (error) throw error;

      const configMap: Record<string, string> = {};
      const globalMap: Record<string, string> = {};
      const modeConfig = data?.find(config => config.admin_id === admin.id && config.config_type === 'branding_mode');

      data?.forEach(config => {
        if (config.config_type === 'branding_mode') return;
        if (config.admin_id === admin.id) {
          configMap[config.config_type] = config.config_value;
        } else if (config.admin_id === null) {
          globalMap[config.config_type] = config.config_value;
        }
      });

      const mode = modeConfig?.config_value === 'global' || (!modeConfig && !Object.keys(configMap).length) ? 'global' : 'custom';
      setBrandingMode(mode);
      setBrandingModeConfigId(modeConfig?.id || null);

      setGlobalDefaults({
        company_name: globalMap.company_name || '',
        currency_unit: globalMap.currency_unit || 'USDC',
      });

      const values = {
        company_name: mode === 'global' ? globalMap.company_name || '' : configMap.company_name || globalMap.company_name || '',
        currency_unit: mode === 'global' ? globalMap.currency_unit || 'USDC' : configMap.currency_unit || globalMap.currency_unit || 'USDC',
      };
      setFormValues(values);
      setSavedValues(values);
    } catch (error) {
      console.error('Error loading configs:', error);
    } finally {
      setLoading(false);
    }
  };
  loadConfigsRef.current = loadConfigs;

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

      await loadConfigsRef.current?.();
    } catch (error: unknown) {
      console.error('Error saving configs:', error);
      setNotification({
        type: 'error',
        message: `Failed to save configuration: ${formatSupabaseError(error) || 'Unknown error'}`,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSwitchBrandingMode = async () => {
    if (formValues.company_name !== savedValues.company_name || formValues.currency_unit !== savedValues.currency_unit) {
      setNotification({ type: 'error', message: '請先儲存修改，再切換設定來源。' });
      return;
    }

    const nextMode = brandingMode === 'global' ? 'custom' : 'global';
    setSaving(true);
    try {
      const record = { admin_id: admin.id, config_type: 'branding_mode', config_value: nextMode, updated_at: new Date().toISOString() };
      const { error } = brandingModeConfigId
        ? await supabase.from('admin_configs').update(record).eq('id', brandingModeConfigId)
        : await supabase.from('admin_configs').insert(record);
      if (error) throw error;

      await loadConfigsRef.current?.();
      setNotification({ type: 'success', message: `已切換為${nextMode === 'global' ? '使用超管設定' : '使用自己的設定'}。` });
    } catch (error) {
      console.error('Error switching branding mode:', error);
      setNotification({ type: 'error', message: '切換設定來源失敗，請稍後再試。' });
    } finally {
      setSaving(false);
    }
  };

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

      <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-blue-500/20 p-6">
        <p className="text-slate-400 text-sm mb-4">
          Set your team's brand name and display currency. Withdrawal rules and employee groups are managed in Order Assignment.
        </p>
      </div>

      <div className="bg-gradient-to-br from-blue-500/10 via-cyan-500/10 to-blue-500/10 border border-blue-500/30 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
          <h3 className="text-blue-300 font-semibold">Current Active Parameters</h3>
          {brandingMode === 'custom' ? (
            <span className="ml-auto px-2.5 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full border border-green-500/30">
              使用自己設定
            </span>
          ) : (
            <span className="ml-auto px-2.5 py-0.5 bg-slate-500/20 text-slate-400 text-xs rounded-full border border-slate-500/30">
              使用超管設定
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
            <div className="text-xs text-slate-400 mb-1">Brand Name</div>
            <div className="text-lg font-bold text-white truncate">
              {formValues.company_name || 'Not Set'}
            </div>
          </div>
          <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
            <div className="text-xs text-slate-400 mb-1">Currency</div>
            <div className="text-lg font-bold text-white">{formValues.currency_unit || 'USDC'}</div>
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
              You can customize your team's brand name and currency. Super admins set withdrawal rules for each order group in Order Assignment.
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
                disabled={brandingMode === 'global' || saving}
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
                disabled={brandingMode === 'global' || saving}
                required
                maxLength={10}
                className="w-full px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-yellow-500"
                placeholder="USDC"
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

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={saving || brandingMode === 'global'}
              className="flex-1 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Save className="w-5 h-5" />
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
            <button
              type="button"
              onClick={() => void handleSwitchBrandingMode()}
              disabled={saving}
              className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-all duration-200 flex items-center gap-2 disabled:opacity-50"
            >
              <ArrowLeftRight className="w-5 h-5" />
              {brandingMode === 'custom' ? '改用超管設定' : '改用自己設定'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
