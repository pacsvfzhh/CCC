import { useState, useEffect } from 'react';
import { Save, Users, Building2, CheckCircle, XCircle, Shield, RotateCcw, Settings2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface AdminGroup {
  id: string;
  username: string;
  role: string;
  created_at: string;
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
  const [selectedGroup, setSelectedGroup] = useState<AdminGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formValues, setFormValues] = useState<ConfigFormValues>({
    company_name: '',
    currency_unit: '',
  });
  const [globalDefaults, setGlobalDefaults] = useState<ConfigFormValues>({
    company_name: '',
    currency_unit: '',
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

  useEffect(() => {
    void (async () => {
      const defaults = await loadGlobalDefaults();
      await loadGroups(true, defaults);
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

  useEffect(() => {
    if (selectedGroup) {
      const updatedGroup = groups.find(g => g.id === selectedGroup.id);
      if (updatedGroup && JSON.stringify(updatedGroup.configs) !== JSON.stringify(selectedGroup.configs)) {
        setSelectedGroup(updatedGroup);
      }
    }
  }, [groups, selectedGroup]);

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

  const loadGroups = async (showLoadingState = true, defaults: ConfigFormValues = { company_name: '', currency_unit: 'USDC' }) => {
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
        .not('admin_id', 'is', null)
        .in('config_type', ['company_name', 'currency_unit']);

      if (configsError) throw configsError;

      const groupsWithConfigs: AdminGroup[] = (adminsData || []).map((admin) => {
        const adminConfigs = configsData?.filter(c => c.admin_id === admin.id) || [];
        const configs: Record<string, string> = {};
        adminConfigs.forEach(config => {
          configs[config.config_type] = config.config_value;
        });

        return {
          id: admin.id,
          username: admin.username,
          role: admin.role,
          created_at: admin.created_at,
          configs,
        };
      });

      const sortedGroups = groupsWithConfigs.sort((a, b) => {
        if (a.role === 'super_admin' && b.role !== 'super_admin') return -1;
        if (a.role !== 'super_admin' && b.role === 'super_admin') return 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

      setGroups(sortedGroups);
      if (showLoadingState && sortedGroups.length) {
        setSelectedGroup(sortedGroups[0]);
        setFormValues({
          company_name: sortedGroups[0].configs.company_name || defaults.company_name,
          currency_unit: sortedGroups[0].configs.currency_unit || defaults.currency_unit || 'USDC',
        });
      }
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
      currency_unit: group.configs.currency_unit || globalDefaults.currency_unit || 'USDC',
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

      const { error: deleteError } = await supabase
        .from('admin_configs')
        .delete()
        .eq('admin_id', selectedGroup.id)
        .in('config_type', Object.keys(formValues));
      if (deleteError) throw deleteError;

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
    } catch (error: unknown) {
      console.error('Error saving config:', error);
      setNotification({
        type: 'error',
        message: `Failed to save: ${error instanceof Error ? error.message : String(error)}`,
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
    } catch (error: unknown) {
      console.error('Error saving login settings:', error);
      setNotification({
        type: 'error',
        message: `Failed to save: ${error instanceof Error ? error.message : String(error)}`,
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
        .eq('admin_id', deleteTargetId)
        .in('config_type', Object.keys(formValues));

      if (error) throw error;

      await loadGroups(false);
      if (selectedGroup?.id === deleteTargetId) setFormValues(globalDefaults);
      setNotification({
        type: 'success',
        message: '已還原全域預設。',
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
      <div className="flex min-h-0 w-full flex-1 items-center justify-center bg-slate-950/40 text-sm text-cyan-100">
        正在載入設定…
      </div>
    );
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto bg-slate-950/45 text-slate-100">
      {notification && (
        <div role={notification.type === 'error' ? 'alert' : 'status'} className={`fixed right-4 top-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-2xl ${notification.type === 'success' ? 'border-emerald-400/50 bg-emerald-950 text-emerald-50' : 'border-rose-400/50 bg-rose-950 text-rose-50'}`}>
          {notification.type === 'success' ? <CheckCircle className="h-5 w-5 shrink-0 text-emerald-300" /> : <XCircle className="h-5 w-5 shrink-0 text-rose-300" />}
          <span>{notification.message}</span>
          <button type="button" onClick={() => setNotification(null)} aria-label="關閉提示" className="ml-2 rounded p-1 text-slate-300 hover:text-white">×</button>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div role="alertdialog" aria-modal="true" aria-labelledby="reset-admin-title" className="w-full max-w-md rounded-2xl border border-rose-400/35 bg-slate-900 p-6 shadow-2xl">
            <h3 id="reset-admin-title" className="text-lg font-semibold text-white">還原團隊設定？</h3>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">將移除這位管理員的品牌名稱與幣別自訂值，改用全域預設。其他設定不受影響。</p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => { setShowDeleteConfirm(false); setDeleteTargetId(null); }} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">取消</button>
              <button type="button" onClick={() => void confirmDelete()} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500">確認還原</button>
            </div>
          </div>
        </div>
      )}

      <header className="border-b border-cyan-400/20 bg-gradient-to-r from-blue-950/70 via-slate-900/70 to-cyan-950/40 px-4 py-5 sm:px-7 lg:px-9">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cyan-400/15 text-cyan-200"><Settings2 className="h-5 w-5" /></span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">系統設定</p>
            <h1 className="mt-0.5 text-2xl font-semibold text-white">設定</h1>
            <p className="mt-1 text-sm text-slate-300">管理登入畫面文案及各管理員團隊的品牌與顯示幣別。</p>
          </div>
        </div>
      </header>

      <section className="grid gap-5 border-b border-cyan-400/15 px-4 py-6 sm:px-7 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10 lg:px-9">
        <div>
          <div className="flex items-center gap-2 text-base font-semibold text-white"><Shield className="h-5 w-5 text-violet-300" />登入畫面</div>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">調整登入頁的標題與副標題，儲存後會套用到登入畫面。</p>
        </div>
        <form onSubmit={handleSaveLoginSettings} className="min-w-0">
          <div className="grid gap-4 xl:grid-cols-2">
            <label className="block min-w-0 text-sm font-medium text-slate-200">登入標題
              <input type="text" value={loginTitle} onChange={(event) => setLoginTitle(event.target.value)} required maxLength={100} placeholder="輸入登入頁標題" className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-300/40" />
            </label>
            <label className="block min-w-0 text-sm font-medium text-slate-200">登入副標題
              <input type="text" value={loginSubtitle} onChange={(event) => setLoginSubtitle(event.target.value)} required maxLength={200} placeholder="輸入登入頁副標題" className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-300/40" />
            </label>
          </div>
          <div className="mt-4 flex justify-end">
            <button type="submit" disabled={savingLoginSettings} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-violet-600 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"><Save className="h-4 w-4" />{savingLoginSettings ? '儲存中…' : '儲存登入設定'}</button>
          </div>
        </form>
      </section>

      <section className="flex min-h-[360px] flex-1 flex-col lg:grid lg:grid-cols-[minmax(220px,260px)_minmax(0,1fr)]">
        <div className="min-w-0 border-b border-cyan-400/15 bg-slate-900/35 lg:border-b-0 lg:border-r">
          <div className="px-4 pb-3 pt-6 sm:px-7 lg:px-6">
            <div className="flex items-center gap-2 text-base font-semibold text-white"><Users className="h-5 w-5 text-cyan-300" />管理員團隊</div>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">選擇管理員，在右側編輯其團隊設定。</p>
          </div>
          {groups.length ? (
            <div className="flex gap-1 overflow-x-auto px-3 pb-4 sm:px-6 lg:flex-col lg:overflow-visible lg:px-3">
              {groups.map((group) => (
                <button key={group.id} type="button" onClick={() => handleGroupSelect(group)} disabled={saving} aria-pressed={selectedGroup?.id === group.id} className={`flex min-w-[155px] items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors disabled:opacity-50 lg:w-full lg:min-w-0 ${selectedGroup?.id === group.id ? 'bg-cyan-500/15 text-white ring-1 ring-inset ring-cyan-400/40' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}>
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${group.role === 'super_admin' ? 'bg-amber-400/15 text-amber-200' : 'bg-blue-400/15 text-blue-200'}`}><Building2 className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{group.username}</span><span className="block text-[11px] text-slate-400">{group.role === 'super_admin' ? '超級管理員' : '二級管理員'}</span></span>
                  {Object.keys(group.configs).length > 0 && <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" title="已自訂" />}
                </button>
              ))}
            </div>
          ) : <p className="px-6 py-8 text-sm text-slate-400">目前沒有管理員。</p>}
        </div>

        <div className="min-w-0 px-4 py-6 sm:px-7 lg:px-9">
          {selectedGroup ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-cyan-400/15 pb-5">
                <div className="min-w-0">
                  <p className="text-xs font-semibold tracking-wide text-cyan-300">團隊品牌與幣別</p>
                  <h2 className="mt-1 break-words text-xl font-semibold text-white">{selectedGroup.username}</h2>
                  <p className="mt-1 text-sm text-slate-400">提款規則和員工分組請至「訂單指派」管理。</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${Object.keys(selectedGroup.configs).length ? 'bg-emerald-400/15 text-emerald-200' : 'bg-slate-700 text-slate-300'}`}>
                  {Object.keys(selectedGroup.configs).length ? '已自訂' : '使用全域預設'}
                </span>
              </div>
              <div className="grid gap-4 border-b border-cyan-400/15 py-5 text-sm sm:grid-cols-2">
                <div><p className="text-xs text-slate-400">目前品牌名稱</p><p className="mt-1 break-words font-semibold text-white">{selectedGroup.configs.company_name || globalDefaults.company_name || '尚未設定'}</p></div>
                <div><p className="text-xs text-slate-400">目前顯示幣別</p><p className="mt-1 font-semibold text-white">{selectedGroup.configs.currency_unit || globalDefaults.currency_unit || 'USDC'}</p></div>
              </div>
              <form onSubmit={handleSave} className="pt-5">
                <div className="grid gap-5 xl:grid-cols-2">
                  <label className="block min-w-0 text-sm font-medium text-slate-200">品牌名稱
                    <input type="text" value={formValues.company_name} onChange={(event) => setFormValues({ ...formValues, company_name: event.target.value })} required maxLength={50} placeholder="輸入品牌名稱" className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-300/40" />
                    <span className="mt-2 block text-xs font-normal text-slate-400">顯示給此管理員團隊的員工。</span>
                  </label>
                  <label className="block min-w-0 text-sm font-medium text-slate-200">顯示幣別
                    <input type="text" value={formValues.currency_unit} onChange={(event) => setFormValues({ ...formValues, currency_unit: event.target.value.replace(/\s+/g, '') })} required maxLength={10} placeholder="例如 USDC" className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-300/40" />
                    <span className="mt-2 block text-xs font-normal text-slate-400">例如 USDC、USDT、USD。</span>
                  </label>
                </div>
                <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-cyan-400/15 pt-5">
                  <button type="submit" disabled={saving} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 px-5 py-2 text-sm font-semibold text-white hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50"><Save className="h-4 w-4" />{saving ? '儲存中…' : '儲存團隊設定'}</button>
                  {Object.keys(selectedGroup.configs).length > 0 && <button type="button" onClick={() => void handleDeleteConfig(selectedGroup.id)} disabled={saving} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-rose-400/35 px-4 py-2 text-sm font-medium text-rose-200 hover:bg-rose-400/10 disabled:opacity-50"><RotateCcw className="h-4 w-4" />還原全域預設</button>}
                </div>
              </form>
            </>
          ) : <div className="py-12 text-sm text-slate-400">選擇管理員後即可編輯團隊設定。</div>}
        </div>
      </section>
    </div>
  );
}
