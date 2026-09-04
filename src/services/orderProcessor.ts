import { supabase } from '../lib/supabase';

export async function processOrders() {
  try {
    const { data, error } = await supabase.rpc('process_pending_orders');
    if (error) {
      console.error('Error processing orders:', error);
      return null;
    }
    return data;
  } catch (error) {
    console.error('Error processing orders:', error);
    return null;
  }
}

export function startOrderProcessing() {
  processOrders();

  const interval = setInterval(() => {
    processOrders();
  }, 30000);

  return () => clearInterval(interval);
}
