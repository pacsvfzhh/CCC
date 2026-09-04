import { useState, useEffect } from 'react';
import { supabase } from './supabase';

const CACHE_KEY_PREFIX = 'cached_company_name';

function getCacheKey(adminId?: string | null): string {
  if (adminId === null || adminId === undefined) {
    return `${CACHE_KEY_PREFIX}:global`;
  }
  return `${CACHE_KEY_PREFIX}:${adminId}`;
}

function readCachedName(adminId?: string | null): string {
  try {
    const specific = localStorage.getItem(getCacheKey(adminId));
    if (specific) return specific;
    const global = localStorage.getItem(`${CACHE_KEY_PREFIX}:global`);
    if (global) return global;
  } catch {
    // localStorage unavailable (private mode, etc.) — fall through
  }
  return '';
}

function writeCachedName(adminId: string | null | undefined, value: string) {
  try {
    localStorage.setItem(getCacheKey(adminId), value);
  } catch {
    // ignore
  }
}

export function useCompanyName(adminId?: string | null) {
  const [companyName, setCompanyName] = useState<string>(() => readCachedName(adminId));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cached = readCachedName(adminId);
    if (cached) setCompanyName(cached);

    loadCompanyName();

    const channel = supabase
      .channel(`company-name-changes-${adminId || 'global'}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'admin_configs',
          filter: "config_type=eq.company_name"
        },
        (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const newRecord = payload.new as { config_value?: string; admin_id?: string | null };

            if (adminId === undefined) {
              if (newRecord.admin_id === null && newRecord.config_value) {
                setCompanyName(newRecord.config_value);
                writeCachedName(null, newRecord.config_value);
              }
            } else if (adminId === null) {
              if (newRecord.admin_id === null && newRecord.config_value) {
                setCompanyName(newRecord.config_value);
                writeCachedName(null, newRecord.config_value);
              }
            } else {
              if (newRecord.admin_id === adminId && newRecord.config_value) {
                setCompanyName(newRecord.config_value);
                writeCachedName(adminId, newRecord.config_value);
              } else if (newRecord.admin_id === null && newRecord.config_value) {
                loadCompanyName();
              }
            }
          } else if (payload.eventType === 'DELETE') {
            loadCompanyName();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [adminId]);

  useEffect(() => {
    document.title = 'Work Platform';
  }, [companyName]);

  const loadCompanyName = async () => {
    try {
      if (adminId === null || adminId === undefined) {
        const { data, error } = await supabase
          .from('admin_configs')
          .select('config_value')
          .eq('config_type', 'company_name')
          .is('admin_id', null)
          .maybeSingle();

        if (error) {
          console.error('Error loading company name:', error);
          return;
        }

        if (data?.config_value) {
          setCompanyName(data.config_value);
          writeCachedName(null, data.config_value);
        }
      } else {
        const { data, error } = await supabase
          .from('admin_configs')
          .select('*')
          .eq('config_type', 'company_name')
          .or(`admin_id.eq.${adminId},admin_id.is.null`);

        if (error) {
          console.error('Error loading company name:', error);
          return;
        }

        const adminConfig = data?.find(c => c.admin_id === adminId);
        const globalConfig = data?.find(c => c.admin_id === null);

        const finalValue = adminConfig?.config_value || globalConfig?.config_value;

        if (finalValue) {
          setCompanyName(finalValue);
          if (adminConfig?.config_value) {
            writeCachedName(adminId, adminConfig.config_value);
          }
          if (globalConfig?.config_value) {
            writeCachedName(null, globalConfig.config_value);
          }
        }
      }
    } catch (error) {
      console.error('Error loading company name:', error);
    } finally {
      setLoading(false);
    }
  };

  return { companyName, loading };
}
