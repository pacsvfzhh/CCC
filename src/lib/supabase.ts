import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

const REQUEST_TIMEOUT_MS = 8000;
const MAX_NETWORK_RETRIES = 2;
const NETWORK_RETRY_DELAY_MS = 250;
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

export function isFinancialAdminSessionError(error: unknown): boolean {
  const message = formatSupabaseError(error).toLowerCase();
  return message.includes('financial administrator session is invalid or expired')
    || message.includes('administrator session has expired');
}

const clientUrl = supabaseUrl || 'https://placeholder.supabase.co';
const clientKey = supabaseAnonKey || 'missing-anon-key';

const createSupabaseAbortError = () => {
  const abortError = new Error('Supabase request was cancelled.');
  abortError.name = 'AbortError';
  return abortError;
};

const isNetworkFetchError = (error: unknown) => {
  const errorName = typeof error === 'object' && error !== null && 'name' in error
    ? String(error.name)
    : '';
  const errorMessage = error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message)
      : String(error);

  return errorName === 'TypeError'
    || errorMessage === 'Failed to fetch'
    || errorMessage.includes('NetworkError');
};

const waitForNetworkRetry = (signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) {
    reject(createSupabaseAbortError());
    return;
  }

  const timeoutId = globalThis.setTimeout(() => {
    signal?.removeEventListener('abort', handleAbort);
    resolve();
  }, NETWORK_RETRY_DELAY_MS);
  const handleAbort = () => {
    globalThis.clearTimeout(timeoutId);
    signal?.removeEventListener('abort', handleAbort);
    reject(createSupabaseAbortError());
  };

  signal?.addEventListener('abort', handleAbort, { once: true });
});

const getRequestMethod = (input: RequestInfo | URL, init?: RequestInit) => (
  init?.method || (input instanceof Request ? input.method : 'GET')
).toUpperCase();

const fetchWithXhrFallback: typeof fetch = async (input, init) => {
  const request = input instanceof Request ? input : null;
  const url = request?.url || input.toString();
  const method = init?.method || request?.method || 'GET';
  const signal = init?.signal || request?.signal;
  const headers = new Headers(request?.headers);

  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }

  const body = init?.body ?? (
    request && method !== 'GET' && method !== 'HEAD'
      ? await request.clone().text()
      : undefined
  );

  if (signal?.aborted) throw createSupabaseAbortError();

  return new Promise<Response>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const cleanup = () => signal?.removeEventListener('abort', handleAbort);
    const handleAbort = () => {
      xhr.abort();
      cleanup();
      reject(createSupabaseAbortError());
    };

    xhr.open(method, url, true);
    xhr.timeout = REQUEST_TIMEOUT_MS;
    xhr.withCredentials = (init?.credentials || request?.credentials) === 'include';
    headers.forEach((value, key) => xhr.setRequestHeader(key, value));
    signal?.addEventListener('abort', handleAbort, { once: true });

    xhr.onload = () => {
      cleanup();
      const responseHeaders = new Headers();
      xhr.getAllResponseHeaders().trim().split(/[\\r\\n]+/).forEach(line => {
        const separator = line.indexOf(':');
        if (separator > 0) {
          responseHeaders.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
        }
      });
      resolve(new Response(xhr.responseText, {
        status: xhr.status,
        statusText: xhr.statusText,
        headers: responseHeaders,
      }));
    };
    xhr.onerror = () => {
      cleanup();
      reject(new TypeError('Failed to fetch'));
    };
    xhr.ontimeout = () => {
      cleanup();
      const timeoutError = new Error('Supabase request timed out. Check your project URL and network connection.');
      timeoutError.name = 'SupabaseTimeoutError';
      reject(timeoutError);
    };
    xhr.onabort = () => {
      cleanup();
      reject(createSupabaseAbortError());
    };
    xhr.send(body as XMLHttpRequestBodyInit | Document | null | undefined);
  });
};

const fetchWithNetworkFallback: typeof fetch = async (input, init) => {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (!isNetworkFetchError(error)) throw error;
    return fetchWithXhrFallback(input, init);
  }
};

const fetchWithTimeout: typeof fetch = async (input, init) => {
  const callerSignal = init?.signal || (input instanceof Request ? input.signal : undefined);
  if (callerSignal?.aborted) throw createSupabaseAbortError();

  const canRetry = ['GET', 'HEAD', 'OPTIONS'].includes(getRequestMethod(input, init));

  for (let attempt = 0; attempt <= MAX_NETWORK_RETRIES; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    const forwardCallerAbort = () => controller.abort();

    callerSignal?.addEventListener('abort', forwardCallerAbort, { once: true });

    try {
      return await fetchWithNetworkFallback(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (callerSignal?.aborted) throw createSupabaseAbortError();

      const isTimeout = timedOut;
      if (!isTimeout && isSupabaseAbortError(error)) {
        throw createSupabaseAbortError();
      }

      const shouldRetry = canRetry
        && attempt < MAX_NETWORK_RETRIES
        && (isTimeout || isNetworkFetchError(error));

      if (shouldRetry) {
        await waitForNetworkRetry(callerSignal);
        continue;
      }

      if (isTimeout) {
        const timeoutError = new Error('Supabase request timed out. Check your project URL and network connection.');
        timeoutError.name = 'SupabaseTimeoutError';
        throw timeoutError;
      }

      if (isNetworkFetchError(error)) {
        const connectionError = new Error('Unable to connect to Supabase. Check your network connection and project URL.');
        connectionError.name = 'SupabaseNetworkError';
        throw connectionError;
      }
      throw error;
    } finally {
      globalThis.clearTimeout(timeoutId);
      callerSignal?.removeEventListener('abort', forwardCallerAbort);
    }
  }

  throw new Error('Supabase request failed after retries.');
};

export const supabase = createClient<Database>(clientUrl, clientKey, {
  global: { fetch: fetchWithTimeout }
});
