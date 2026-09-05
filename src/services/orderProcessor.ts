import { supabase, supabaseConfigurationError } from '../lib/supabase';

let processingRequestActive = false;

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return JSON.stringify(error);
};

export async function processOrders() {
  if (supabaseConfigurationError || processingRequestActive) return null;

  processingRequestActive = true;
  try {
    const { data, error } = await supabase.rpc('process_pending_orders');
    if (error) {
      if (import.meta.env.DEV) {
        console.warn('[OrderProcessor] Background sync unavailable:', getErrorMessage(error));
      }
      return null;
    }
    return data;
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[OrderProcessor] Background sync unavailable:', getErrorMessage(error));
    }
    return null;
  } finally {
    processingRequestActive = false;
  }
}

export function startOrderProcessing() {
  void processOrders();

  const interval = window.setInterval(() => {
    void processOrders();
  }, 30000);

  return () => window.clearInterval(interval);
}
