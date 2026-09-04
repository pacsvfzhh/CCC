import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

const REQUEST_TIMEOUT_MS = 8000;
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigurationError = !supabaseUrl || !supabaseAnonKey
  ? 'Supabase environment variables are missing. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
  : supabaseUrl.includes('placeholder.supabase.co')
    ? 'Supabase is still using a placeholder URL. Replace VITE_SUPABASE_URL with your real project URL.'
    : null;

const clientUrl = supabaseUrl || 'https://placeholder.supabase.co';
const clientKey = supabaseAnonKey || 'missing-anon-key';

const fetchWithTimeout: typeof fetch = async (input, init) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('Supabase request timed out. Check your project URL and network connection.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
};

export const supabase = createClient<Database>(clientUrl, clientKey, {
  global: { fetch: fetchWithTimeout }
});
