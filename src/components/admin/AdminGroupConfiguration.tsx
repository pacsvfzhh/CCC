import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Save, Building2, CheckCircle, XCircle, Shield, ArrowLeftRight, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface AdminGroup {
  id: string;
  username: string;
  role: string;
  created_at: string;
  brandingMode: 'custom' | 'global';
  brandingModeConfigId: string | null;
  configs: {
    company_name?: string;
    currency_unit?: string;
  };
}

interface ConfigFormValues {
  company_name: string;
  currency_unit: string;
}

export default function AdminGroupConfiguration() {
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingGroupId, setSavingGroupId] = useState<string | null>(null);
  const [switchingGroupId, setSwitchingGroupId] = useState<string | null>(null);
  const [formValuesByGroup, setFormValuesByGroup] = useState<Record<string, ConfigFormValues>>({});
  const [globalDefaults, setGlobalDefaults] = useState<ConfigFormValues>({
    company_name: '',
    currency_unit: '',
  });
  const [notification, setNotification] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [loginTitle, setLoginTitle] = useState('');
  const [loginSubtitle, setLoginSubtitle] = useState('');
  const [savingLoginSettings, setSavingLoginSettings] = useState(false);
  const loginTitleRef = useRef<HTMLTextAreaElement>(null);
  const loginSubtitleRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const resizeTextareas = () => {
      for (const textarea of [loginTitleRef.current, loginSubtitleRef.current]) {
        if (!textarea) continue;
        textarea.style.height = '36px';
        textarea.style.height = `${Math.min(52, Math.max(36, textarea.scrollHeight + 2))}px`;
      }
    };

    resizeTextareas();
    window.addEventListener('resize', resizeTextareas);
    return () => window.removeEventListener('resize', resizeTextareas);
  }, [loading, loginTitle, loginSubtitle]);

  useEffect(() => {
    void (async () => {
      const defaults = await loadGlobalDefaults();
      await loadGroups(defaults);
    })();
    void loadLoginPageSettings();
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

  const loadGlobalDefaults = async (): Promise<ConfigFormValues> => {
    try {
      const { data, error } = await supabase
        .from('admin_configs')
        .select('config_type, config_value')
        .is('admin_id', null)
        .in('config_type', ['company_name', 'currency_unit']);

      if (error) throw error;

      const defaults: Record<string, string> = {};
      data?.forEach(config => {
        defaults[config.config_type] = config.config_value;
      });

      const values = {
        company_name: defaults.company_name || '',
        currency_unit: defaults.currency_unit || 'USDC',
      };
      setGlobalDefaults(values);
      return values;
    } catch (error) {
      console.error('Error loading global defaults:', error);
      return { company_name: '', currency_unit: 'USDC' };
    }
  };

  const loadGroups = async (defaults: ConfigFormValues) => {
    try {
      setLoading(true);

      const { data: adminsData, error: adminsError } = await supabase
        .from('admins')
        .select('id, username, role, created_at')
        .in('role', ['super_admin', 'secondary_admin'])
        .order('created_at', { ascending: false });

      if (adminsError) throw adminsError;

      const { data: configsData, error: configsError } = await supabase
        .from('admin_configs')
        .select('id, admin_id, config_type, config_value')
        .not('admin_id', 'is', null)
        .in('config_type', ['company_name', 'currency_unit', 'branding_mode']);

      if (configsError) throw configsError;

      const groupsWithConfigs: AdminGroup[] = (adminsData || []).map((admin) => {
        const adminConfigs = configsData?.filter(c => c.admin_id === admin.id) || [];
        const configs: Record<string, string> = {};
        adminConfigs.filter(config => config.config_type !== 'branding_mode').forEach(config => {
          configs[config.config_type] = config.config_value;
        });
        const modeConfig = adminConfigs.find(config => config.config_type === 'branding_mode');

        return {
          id: admin.id,
          username: admin.username,
          role: admin.role,
          created_at: admin.created_at,
          brandingMode: modeConfig?.config_value === 'global' || (!modeConfig && !Object.keys(configs).length) ? 'global' : 'custom',
          brandingModeConfigId: modeConfig?.id || null,
          configs,
        };
      });

      const sortedGroups = groupsWithConfigs.sort((a, b) => {
        if (a.role === 'super_admin' && b.role !== 'super_admin') return -1;
        if (a.role !== 'super_admin' && b.role === 'super_admin') return 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

      setGroups(sortedGroups);
      setFormValuesByGroup(Object.fromEntries(sortedGroups.map(group => [group.id, {
        company_name: group.brandingMode === 'global' ? defaults.company_name : group.configs.company_name || defaults.company_name,
        currency_unit: group.brandingMode === 'global' ? defaults.currency_unit : group.configs.currency_unit || defaults.currency_unit || 'USDC',
      }])));
    } catch (error) {
      console.error('Error loading groups:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent, groupId: string) => {
    e.preventDefault();
    const values = formValuesByGroup[groupId];
    setSavingGroupId(groupId);

    try {
      for (const [configType, configValue] of Object.entries(values)) {
        if (!configValue || configValue === '') {
          throw new Error(`${configType === 'company_name' ? '品牌名稱' : '顯示幣別'}不可留空`);
        }
      }

      const { error: deleteError } = await supabase
        .from('admin_configs')
        .delete()
        .eq('admin_id', groupId)
        .in('config_type', Object.keys(values));
      if (deleteError) throw deleteError;

      const configRecords = Object.entries(values).map(([configType, configValue]) => ({
        admin_id: groupId,
        config_type: configType,
        config_value: configValue,
        updated_at: new Date().toISOString(),
      }));

      const { error: insertError } = await supabase
        .from('admin_configs')
        .insert(configRecords);

      if (insertError) throw insertError;

      setGroups(current => current.map(group => group.id === groupId ? { ...group, configs: { ...values } } : group));

      setNotification({
        type: 'success',
        message: `「${groups.find(group => group.id === groupId)?.username}」團隊設定已儲存。`,
      });
    } catch (error: unknown) {
      console.error('Error saving config:', error);
      setNotification({
        type: 'error',
        message: '儲存團隊設定失敗，請檢查欄位後再試。',
      });
    } finally {
      setSavingGroupId(null);
    }
  };

  const handleSwitchBrandingMode = async (group: AdminGroup) => {
    const currentValues = formValuesByGroup[group.id];
    const savedValues = group.brandingMode === 'global' ? globalDefaults : {
      company_name: group.configs.company_name || globalDefaults.company_name,
      currency_unit: group.configs.currency_unit || globalDefaults.currency_unit,
    };
    if (currentValues.company_name !== savedValues.company_name || currentValues.currency_unit !== savedValues.currency_unit) {
      setNotification({ type: 'error', message: '請先儲存此團隊的修改，再切換設定來源。' });
      return;
    }

    const nextMode = group.brandingMode === 'global' ? 'custom' : 'global';
    setSwitchingGroupId(group.id);
    try {
      const modeRecord = { admin_id: group.id, config_type: 'branding_mode', config_value: nextMode, updated_at: new Date().toISOString() };
      const { data, error } = group.brandingModeConfigId
        ? await supabase.from('admin_configs').update(modeRecord).eq('id', group.brandingModeConfigId).select('id').single()
        : await supabase.from('admin_configs').insert(modeRecord).select('id').single();
      if (error) throw error;

      setGroups(current => current.map(item => item.id === group.id ? { ...item, brandingMode: nextMode, brandingModeConfigId: data.id } : item));
      setFormValuesByGroup(current => ({
        ...current,
        [group.id]: nextMode === 'global' ? { ...globalDefaults } : {
          company_name: group.configs.company_name || globalDefaults.company_name,
          currency_unit: group.configs.currency_unit || globalDefaults.currency_unit,
        },
      }));
      setNotification({ type: 'success', message: `「${group.username}」已切換為${nextMode === 'global' ? '使用超管設定' : '使用自己的設定'}。` });
    } catch (error) {
      console.error('Error switching branding mode:', error);
      setNotification({ type: 'error', message: '切換設定來源失敗，請稍後再試。' });
    } finally {
      setSwitchingGroupId(null);
    }
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
        message: '登入畫面設定已儲存。',
      });
    } catch (error: unknown) {
      console.error('Error saving login settings:', error);
      setNotification({
        type: 'error',
        message: '儲存登入畫面設定失敗，請稍後再試。',
      });
    } finally {
      setSavingLoginSettings(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-0 w-full flex-1 items-center justify-center bg-slate-950/40 text-sm text-cyan-100">
        正在載入設定…
      </div>
    );
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-slate-950/45 text-slate-100">
      {notification && (
        <div role={notification.type === 'error' ? 'alert' : 'status'} className={`fixed right-4 top-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-2xl ${notification.type === 'success' ? 'border-emerald-400/50 bg-emerald-950 text-emerald-50' : 'border-rose-400/50 bg-rose-950 text-rose-50'}`}>
          {notification.type === 'success' ? <CheckCircle className="h-5 w-5 shrink-0 text-emerald-300" /> : <XCircle className="h-5 w-5 shrink-0 text-rose-300" />}
          <span>{notification.message}</span>
          <button type="button" onClick={() => setNotification(null)} aria-label="關閉提示" className="ml-2 rounded p-1 text-slate-300 hover:text-white">×</button>
        </div>
      )}

      <section className="grid shrink-0 gap-4 border-y border-violet-300/20 bg-gradient-to-r from-[#302052] via-[#1c3262] to-[#12465a] px-4 py-4 shadow-[inset_0_1px_0_rgba(221,214,254,0.12)] sm:px-7 lg:grid-cols-[190px_minmax(0,1fr)] lg:items-center lg:gap-6 lg:px-9 xl:grid-cols-[220px_minmax(0,1fr)]">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-400/35 to-cyan-400/20 text-white shadow-sm shadow-indigo-950/40 ring-1 ring-inset ring-white/25"><Shield className="h-[18px] w-[18px]" /></span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white">登入畫面</h2>
            <p className="mt-0.5 text-xs text-violet-100/90">標題與副標題</p>
          </div>
        </div>
        <form onSubmit={handleSaveLoginSettings} className="grid min-w-0 gap-3 sm:grid-cols-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
          <label className="block min-w-0 text-xs font-semibold tracking-wide text-slate-100">登入標題
            <textarea ref={loginTitleRef} value={loginTitle} onChange={(event) => setLoginTitle(event.target.value.replace(/[\r\n]+/g, ' '))} required maxLength={100} rows={1} placeholder="輸入登入頁標題" className="login-settings-scroll mt-1 block h-9 max-h-[52px] w-full resize-none overflow-y-auto rounded-lg border border-slate-300 bg-slate-50 px-3 py-[5px] text-sm leading-5 text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-500 focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-400/20" />
          </label>
          <label className="block min-w-0 text-xs font-semibold tracking-wide text-slate-100">登入副標題
            <textarea ref={loginSubtitleRef} value={loginSubtitle} onChange={(event) => setLoginSubtitle(event.target.value.replace(/[\r\n]+/g, ' '))} required maxLength={200} rows={1} placeholder="輸入登入頁副標題" className="login-settings-scroll mt-1 block h-9 max-h-[52px] w-full resize-none overflow-y-auto rounded-lg border border-slate-300 bg-slate-50 px-3 py-[5px] text-sm leading-5 text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-500 focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-400/20" />
          </label>
          <button type="submit" disabled={savingLoginSettings} aria-busy={savingLoginSettings} className="inline-flex h-9 items-center justify-center gap-2 self-end rounded-lg border border-white/20 bg-gradient-to-r from-violet-600 to-blue-600 px-4 text-xs font-semibold text-white shadow-md shadow-indigo-950/30 transition-all hover:from-violet-500 hover:to-blue-500 disabled:cursor-wait disabled:opacity-80 sm:col-span-2 md:col-span-1">{savingLoginSettings ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Save className="h-3.5 w-3.5" aria-hidden="true" />}{savingLoginSettings ? '儲存中…' : '儲存設定'}</button>
        </form>
      </section>

      <section className="flex min-h-0 flex-1 flex-col">
        {groups.length ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="hidden shrink-0 gap-4 border-b border-cyan-200/30 bg-gradient-to-r from-[#253565] via-[#215075] to-[#155867] px-4 py-3 text-xs font-semibold tracking-wide text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] sm:px-7 lg:grid lg:grid-cols-[minmax(150px,1.1fr)_minmax(180px,1.7fr)_minmax(110px,.8fr)_minmax(170px,1.1fr)] lg:px-9">
              <span>管理員 / 狀態</span><span>品牌名稱</span><span>顯示幣別</span><span>操作</span>
            </div>
            <div className="admin-team-list-scroll min-h-0 flex-1 divide-y divide-cyan-400/10 overflow-y-auto overscroll-contain">
              {groups.map(group => {
                const values = formValuesByGroup[group.id];
                const isSavingGroup = savingGroupId === group.id;
                const isSwitchingGroup = switchingGroupId === group.id;
                const needsOwnValues = group.brandingMode === 'custom' && (!group.configs.company_name || !group.configs.currency_unit);
                const isDirty = needsOwnValues || values.company_name !== (group.brandingMode === 'global' ? globalDefaults.company_name : group.configs.company_name || globalDefaults.company_name)
                  || values.currency_unit !== (group.brandingMode === 'global' ? globalDefaults.currency_unit : group.configs.currency_unit || globalDefaults.currency_unit || 'USDC');
                return (
                  <form key={group.id} onSubmit={(event) => void handleSave(event, group.id)} className="grid min-w-0 gap-2 px-4 py-3 transition-colors odd:bg-slate-900/20 hover:bg-cyan-950/25 sm:grid-cols-2 sm:gap-3 sm:px-7 lg:grid-cols-[minmax(150px,1.1fr)_minmax(180px,1.7fr)_minmax(110px,.8fr)_minmax(170px,1.1fr)] lg:items-center lg:px-9">
                    <div className="flex min-w-0 items-center gap-2.5 sm:col-span-2 lg:col-span-1">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${group.role === 'super_admin' ? 'bg-amber-400/15 text-amber-200' : 'bg-blue-400/15 text-blue-200'}`}><Building2 className="h-4 w-4" /></span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white" title={group.username}>{group.username}</p>
                        <p className="text-[11px] text-slate-400">{group.role === 'super_admin' ? '超級管理員' : '二級管理員'}</p>
                        <div className="mt-1"><span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${isDirty ? 'bg-amber-400/15 text-amber-200' : group.brandingMode === 'custom' ? 'bg-emerald-400/15 text-emerald-200' : 'bg-sky-400/15 text-sky-200'}`}>{isDirty ? needsOwnValues ? '待儲存自己設定' : '未儲存' : group.brandingMode === 'custom' ? '使用自己設定' : '使用超管設定'}</span></div>
                      </div>
                    </div>
                    <label className="min-w-0 text-xs font-medium text-slate-300"><span className="lg:sr-only">品牌名稱</span>
                      <input type="text" value={values.company_name} onChange={(event) => setFormValuesByGroup(current => ({ ...current, [group.id]: { ...current[group.id], company_name: event.target.value } }))} required maxLength={50} placeholder="輸入品牌名稱" disabled={group.brandingMode === 'global' || isSavingGroup || isSwitchingGroup} className="mt-1 h-8 w-full rounded-lg border border-slate-600 bg-slate-50 px-3 text-sm text-slate-900 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-300/40 disabled:bg-slate-200 disabled:text-slate-600 lg:mt-0" />
                    </label>
                    <label className="min-w-0 text-xs font-medium text-slate-300"><span className="lg:sr-only">顯示幣別</span>
                      <input type="text" value={values.currency_unit} onChange={(event) => setFormValuesByGroup(current => ({ ...current, [group.id]: { ...current[group.id], currency_unit: event.target.value.replace(/\s+/g, '') } }))} required maxLength={10} placeholder="例如 USDC" disabled={group.brandingMode === 'global' || isSavingGroup || isSwitchingGroup} className="mt-1 h-8 w-full rounded-lg border border-slate-600 bg-slate-50 px-3 text-sm text-slate-900 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-300/40 disabled:bg-slate-200 disabled:text-slate-600 lg:mt-0" />
                    </label>
                    <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-1">
                      <button type="submit" disabled={group.brandingMode === 'global' || savingGroupId !== null || switchingGroupId !== null} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 px-3 text-xs font-semibold text-white hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50">{isSavingGroup ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}{isSavingGroup ? '儲存中…' : '儲存'}</button>
                      <button type="button" onClick={() => void handleSwitchBrandingMode(group)} disabled={savingGroupId !== null || switchingGroupId !== null} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-sky-400/35 bg-sky-400/10 px-2.5 text-xs font-medium text-sky-100 hover:bg-sky-400/20 disabled:opacity-50">{isSwitchingGroup ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowLeftRight className="h-3.5 w-3.5" />}{isSwitchingGroup ? '切換中…' : group.brandingMode === 'custom' ? '改用超管設定' : '改用自己設定'}</button>
                    </div>
                  </form>
                );
              })}
            </div>
          </div>
        ) : <p className="px-4 py-10 text-sm text-slate-400 sm:px-7 lg:px-9">目前沒有管理員。</p>}
      </section>
    </div>
  );
}
