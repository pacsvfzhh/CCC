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

export function formatSupabaseError(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (error && typeof error === 'object') {
    const details = error as {
      message?: unknown;
      code?: unknown;
      details?: unknown;
      hint?: unknown;
    };
    const parts = [details.message, details.code, details.details, details.hint]
      .filter(value => typeof value === 'string' && value.length > 0)
      .map(value => String(value));

    if (parts.length > 0) return parts.join(' | ');

    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown Supabase error';
    }
  }

  return String(error);
}

export function isSupabaseAbortError(error: unknown): boolean {
  if (error instanceof Error) return error.name === 'AbortError';
  return Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError');
}

const clientUrl = supabaseUrl || 'https://placeholder.supabase.co';
const clientKey = supabaseAnonKey || 'missing-anon-key';

const fetchWithTimeout: typeof fetch = async (input, init) => {
  const callerSignal = init?.signal;
  if (callerSignal?.aborted) {
    const abortError = new Error('Supabase request was cancelled.');
    abortError.name = 'AbortError';
    throw abortError;
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const forwardCallerAbort = () => controller.abort();

  callerSignal?.addEventListener('abort', forwardCallerAbort, { once: true });

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (callerSignal?.aborted) {
      const abortError = new Error('Supabase request was cancelled.');
      abortError.name = 'AbortError';
      throw abortError;
    }
    if (timedOut) {
      const timeoutError = new Error('Supabase request timed out. Check your project URL and network connection.');
      timeoutError.name = 'SupabaseTimeoutError';
      throw timeoutError;
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
