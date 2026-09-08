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
  const callerSignal = init?.signal;
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const forwardCallerAbort = () => controller.abort();

  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener('abort', forwardCallerAbort, { once: true });
    }
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (callerSignal?.aborted) {
      const abortError = new Error('Supabase request was cancelled.');
      abortError.name = 'AbortError';
      throw abortError;
    }
    if (controller.signal.aborted) {
      throw new Error('Supabase request timed out. Check your project URL and network connection.');
    }

    const errorName = typeof error === 'object' && error !== null && 'name' in error
      ? String(error.name)
      : '';
    const errorMessage = error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String(error.message)
        : String(error);
    const isNetworkError = errorName === 'TypeError'
      || errorMessage === 'Failed to fetch'
      || errorMessage.includes('NetworkError');

    if (isNetworkError) {
      const connectionError = new Error('Unable to connect to Supabase. Check your network connection and project URL.');
      connectionError.name = 'SupabaseNetworkError';
      throw connectionError;
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    callerSignal?.removeEventListener('abort', forwardCallerAbort);
  }
};

export const supabase = createClient<Database>(clientUrl, clientKey, {
  global: { fetch: fetchWithTimeout }
});
