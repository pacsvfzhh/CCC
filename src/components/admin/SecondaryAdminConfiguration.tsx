import { useCallback, useEffect, useState } from 'react';
import { Building2, CheckCircle, Loader2, Pencil, Save, Shield, XCircle } from 'lucide-react';
import { formatSupabaseError, supabase } from '../../lib/supabase';
import { Admin } from '../../types';

interface SecondaryAdminConfigurationProps {
  admin: Admin;
}

interface BrandingValues {
  company_name: string;
  currency_unit: string;
}

export default function SecondaryAdminConfiguration({ admin }: SecondaryAdminConfigurationProps) {
  const [formValues, setFormValues] = useState<BrandingValues>({ company_name: '', currency_unit: '' });
  const [savedCustomValues, setSavedCustomValues] = useState<Partial<BrandingValues>>({});
  const [globalDefaults, setGlobalDefaults] = useState<BrandingValues>({ company_name: '', currency_unit: 'USDC' });
  const [brandingMode, setBrandingMode] = useState<'custom' | 'global'>('global');
  const [editBrandingMode, setEditBrandingMode] = useState<'custom' | 'global'>('global');
  const [brandingModeConfigId, setBrandingModeConfigId] = useState<string | null>(null);
  const [loginTitle, setLoginTitle] = useState('');
  const [loginSubtitle, setLoginSubtitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadConfigs = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('admin_configs')
        .select('id, admin_id, config_type, config_value')
        .or(`admin_id.eq.${admin.id},admin_id.is.null`)
        .in('config_type', ['company_name', 'currency_unit', 'branding_mode']);
      if (error) throw error;

      const custom: Partial<BrandingValues> = {};
      const global: Partial<BrandingValues> = {};
      const modeConfig = data?.find(config => config.admin_id === admin.id && config.config_type === 'branding_mode');
      data?.forEach(config => {
        if (config.config_type !== 'company_name' && config.config_type !== 'currency_unit') return;
        if (config.admin_id === admin.id) custom[config.config_type] = config.config_value;
        if (config.admin_id === null) global[config.config_type] = config.config_value;
      });

      const mode = modeConfig?.config_value === 'global' || (!modeConfig && !Object.keys(custom).length) ? 'global' : 'custom';
      const defaults = { company_name: global.company_name || '', currency_unit: global.currency_unit || 'USDC' };
      setGlobalDefaults(defaults);
      setSavedCustomValues(custom);
      setFormValues({ company_name: custom.company_name || defaults.company_name, currency_unit: custom.currency_unit || defaults.currency_unit });
      setBrandingMode(mode);
      setEditBrandingMode(mode);
      setBrandingModeConfigId(modeConfig?.id || null);
    } catch (error) {
      console.error('Error loading configs:', error);
      setNotification({ type: 'error', message: '載入管理員設定失敗，請稍後再試。' });
    } finally {
      setLoading(false);
    }
  }, [admin.id]);

  useEffect(() => { void loadConfigs(); }, [loadConfigs]);

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase.from('system_configs').select('key, value').in('key', ['login_title', 'login_subtitle']);
      if (error) {
        console.error('Error loading login page settings:', error);
        return;
      }
      setLoginTitle(String(data?.find(config => config.key === 'login_title')?.value || ''));
      setLoginSubtitle(String(data?.find(config => config.key === 'login_subtitle')?.value || ''));
    })();
  }, []);

  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(null), 5000);
    return () => clearTimeout(timer);
  }, [notification]);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const ownValuesChanged = formValues.company_name !== (savedCustomValues.company_name || globalDefaults.company_name)
        || formValues.currency_unit !== (savedCustomValues.currency_unit || globalDefaults.currency_unit);
      const saveOwnValues = ownValuesChanged || (editBrandingMode === 'custom'
        && (!savedCustomValues.company_name || !savedCustomValues.currency_unit));
      let modeConfigId = brandingModeConfigId;

      if (saveOwnValues) {
        if (!formValues.company_name || !formValues.currency_unit) throw new Error('品牌名稱及顯示幣別不可留空');

        if (editBrandingMode === 'global' && !modeConfigId) {
          const { data, error } = await supabase.from('admin_configs')
            .insert({ admin_id: admin.id, config_type: 'branding_mode', config_value: 'global', updated_at: new Date().toISOString() })
            .select('id').single();
          if (error) throw error;
          modeConfigId = data.id;
          setBrandingModeConfigId(data.id);
        }

        for (const [configType, configValue] of Object.entries(formValues)) {
          const record = { config_value: configValue, updated_at: new Date().toISOString() };
          const { error } = savedCustomValues[configType as keyof BrandingValues] !== undefined
            ? await supabase.from('admin_configs').update(record).eq('admin_id', admin.id).eq('config_type', configType)
            : await supabase.from('admin_configs').insert({ admin_id: admin.id, config_type: configType, ...record });
          if (error) throw error;
          setSavedCustomValues(current => ({ ...current, [configType]: configValue }));
        }
      }

      if (editBrandingMode !== brandingMode) {
        if (modeConfigId) {
          const { error } = await supabase.from('admin_configs')
            .update({ config_value: editBrandingMode, updated_at: new Date().toISOString() }).eq('id', modeConfigId);
          if (error) throw error;
        } else {
          const { data, error } = await supabase.from('admin_configs')
            .insert({ admin_id: admin.id, config_type: 'branding_mode', config_value: editBrandingMode, updated_at: new Date().toISOString() })
            .select('id').single();
          if (error) throw error;
          modeConfigId = data.id;
        }
      }

      setBrandingModeConfigId(modeConfigId);
      setBrandingMode(editBrandingMode);
      setNotification({ type: 'success', message: '設定已儲存。' });
    } catch (error) {
      console.error('Error saving configs:', error);
      setNotification({ type: 'error', message: `儲存設定失敗：${formatSupabaseError(error) || '請稍後再試。'}` });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-0 w-full flex-1 items-center justify-center bg-slate-950/40 text-sm text-cyan-100">正在載入設定…</div>;
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto bg-[#17283d] text-slate-100">
      {notification && (
        <div role={notification.type === 'error' ? 'alert' : 'status'} className={`fixed right-4 top-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-2xl ${notification.type === 'success' ? 'border-emerald-400/50 bg-emerald-950 text-emerald-50' : 'border-rose-400/50 bg-rose-950 text-rose-50'}`}>
          {notification.type === 'success' ? <CheckCircle className="h-5 w-5 shrink-0 text-emerald-300" /> : <XCircle className="h-5 w-5 shrink-0 text-rose-300" />}
          <span>{notification.message}</span>
          <button type="button" onClick={() => setNotification(null)} aria-label="關閉提示" className="ml-2 rounded p-1 text-slate-300 hover:text-white">×</button>
        </div>
      )}

      <form onSubmit={handleSave} className="flex w-full flex-1 flex-col bg-[#17283d]">
        <div className="flex items-center gap-3 border-b border-cyan-300/20 bg-gradient-to-r from-[#253565] via-[#215075] to-[#155867] px-4 py-4 sm:px-7 lg:px-9">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-cyan-100"><Building2 className="h-5 w-5" aria-hidden="true" /></span>
          <div className="min-w-0"><h2 className="text-base font-semibold text-white">我的設定</h2><p className="break-words text-sm text-cyan-100">{admin.username} · 二級管理員</p></div>
          <span className={`ml-auto shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${brandingMode === 'global' ? 'border-amber-300/60 bg-amber-400/20 text-amber-100' : 'border-blue-300/60 bg-blue-500/25 text-blue-100'}`}>目前使用{brandingMode === 'global' ? '超管設定' : '自己設定'}</span>
        </div>

        <div className="mx-auto w-full max-w-6xl flex-1 space-y-5 px-4 py-5 sm:px-7 sm:py-6 lg:px-9">
          <section>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-cyan-100"><Shield className="h-4 w-4" aria-hidden="true" />登入畫面 <span className="text-xs font-normal text-slate-400">· 僅供查看</span></h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="min-w-0 text-xs font-semibold text-slate-200">登入標題
                <p className="mt-1.5 flex min-h-10 items-center break-words rounded-lg border border-slate-300/80 bg-slate-50 px-3 py-2 text-sm font-normal leading-5 text-slate-900">{loginTitle || '未設定'}</p>
              </div>
              <div className="min-w-0 text-xs font-semibold text-slate-200">登入副標題
                <p className="mt-1.5 flex min-h-10 items-center break-words rounded-lg border border-slate-300/80 bg-slate-50 px-3 py-2 text-sm font-normal leading-5 text-slate-900">{loginSubtitle || '未設定'}</p>
              </div>
            </div>
          </section>

          <section className="border-t border-slate-500/40 pt-5">
            <h3 className="text-sm font-semibold text-white">設定來源</h3>
            <p className="mt-1 text-xs text-slate-300">目前使用{brandingMode === 'global' ? '超管設定' : '自己設定'}；選擇後按「儲存設定」才會生效。</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <button type="button" aria-pressed={editBrandingMode === 'global'} disabled={saving} onClick={() => setEditBrandingMode('global')} className={`min-h-[82px] rounded-xl border px-4 py-3 text-left transition-colors disabled:opacity-50 ${editBrandingMode === 'global' ? 'border-amber-300 bg-gradient-to-br from-amber-500/35 via-amber-500/20 to-yellow-400/15 text-amber-50 shadow-lg shadow-amber-950/30 ring-2 ring-amber-300/55' : 'border-slate-600/45 bg-slate-950/25 text-slate-400 hover:border-amber-400/40 hover:bg-amber-400/[0.06] hover:text-amber-100'}`}>
                <span className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-sm font-semibold"><Shield className="h-4 w-4 shrink-0" aria-hidden="true" />使用超管設定</span><span className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-300 px-2 py-0.5 text-[10px] font-bold text-amber-950 ${editBrandingMode === 'global' ? '' : 'invisible'}`}><CheckCircle className="h-3 w-3" aria-hidden="true" />已選擇</span></span>
                <span className="mt-1.5 block text-xs opacity-80">顯示超管的品牌與幣別</span>
              </button>
              <button type="button" aria-pressed={editBrandingMode === 'custom'} disabled={saving} onClick={() => setEditBrandingMode('custom')} className={`min-h-[82px] rounded-xl border px-4 py-3 text-left transition-colors disabled:opacity-50 ${editBrandingMode === 'custom' ? 'border-blue-300 bg-gradient-to-br from-blue-500/40 via-blue-500/25 to-cyan-400/15 text-blue-50 shadow-lg shadow-blue-950/30 ring-2 ring-blue-300/55' : 'border-slate-600/45 bg-slate-950/25 text-slate-400 hover:border-blue-400/40 hover:bg-blue-400/[0.06] hover:text-blue-100'}`}>
                <span className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-sm font-semibold"><Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />使用自己設定</span><span className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-300 px-2 py-0.5 text-[10px] font-bold text-blue-950 ${editBrandingMode === 'custom' ? '' : 'invisible'}`}><CheckCircle className="h-3 w-3" aria-hidden="true" />已選擇</span></span>
                <span className="mt-1.5 block text-xs opacity-80">顯示自己設定的品牌與幣別</span>
              </button>
            </div>
          </section>

          <section className="border-t border-slate-500/40 pt-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-blue-100"><Pencil className="h-4 w-4" aria-hidden="true" />自己的設定</h3>
            <p className="mt-1 text-xs leading-5 text-blue-200/80">自己的品牌與幣別會保留，切換設定來源也不會刪除。</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,2.5fr)_minmax(150px,1fr)]">
              <label className="block min-w-0 text-xs font-semibold text-slate-200">品牌名稱
                <input type="text" value={formValues.company_name} onChange={event => setFormValues(current => ({ ...current, company_name: event.target.value }))} required={editBrandingMode === 'custom'} maxLength={50} disabled={saving} placeholder="輸入品牌名稱" className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm text-slate-900 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-300/40 disabled:opacity-60" />
              </label>
              <label className="block min-w-0 text-xs font-semibold text-slate-200">顯示幣別
                <input type="text" value={formValues.currency_unit} onChange={event => setFormValues(current => ({ ...current, currency_unit: event.target.value.replace(/\s+/g, '') }))} required={editBrandingMode === 'custom'} maxLength={10} disabled={saving} placeholder="例如 USDC" className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm text-slate-900 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-300/40 disabled:opacity-60" />
              </label>
            </div>
          </section>

          <section className="border-t border-slate-500/40 pt-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-100"><Shield className="h-4 w-4" aria-hidden="true" />超管設定 · 對照</h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-[minmax(0,2.5fr)_minmax(150px,1fr)]">
              <div className="min-w-0"><p className="text-xs text-amber-100/70">品牌名稱</p><p className="mt-1 break-words text-sm font-medium text-slate-100">{globalDefaults.company_name || '未設定'}</p></div>
              <div className="min-w-0"><p className="text-xs text-amber-100/70">顯示幣別</p><p className="mt-1 break-words text-sm font-medium text-slate-100">{globalDefaults.currency_unit || '未設定'}</p></div>
            </div>
          </section>
        </div>

        <div className="border-t border-white/10 bg-slate-950/25">
          <div className="mx-auto flex w-full max-w-6xl justify-end px-4 py-4 sm:px-7 lg:px-9">
            <button type="submit" disabled={saving} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 px-4 text-sm font-semibold text-white hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}{saving ? '儲存中…' : '儲存設定'}</button>
          </div>
        </div>
      </form>
    </div>
  );
}
