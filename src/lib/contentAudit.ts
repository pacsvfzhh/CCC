import { getAdminFinancialSessionToken } from './auth';
import { formatSupabaseError, supabase } from './supabase';

type AuditAction =
  | 'notification_edit' | 'notification_delete'
  | 'chat_edit' | 'chat_delete' | 'conversation_delete' | 'customer_delete' | 'employee_delete' | 'admin_delete'
  | 'template_edit' | 'template_delete' | 'auto_edit' | 'auto_delete';

export async function mutateAuditedContent(
  action: AuditAction,
  targetIds: string[],
  payload: Record<string, unknown> = {},
  employeeId?: string,
): Promise<{ success: boolean; changed_count: number }> {
  const { data, error } = await supabase.functions.invoke('content-audit', {
    body: { action, targetIds, payload, employeeId, sessionToken: getAdminFinancialSessionToken() },
  });
  if (error || data?.error) throw new Error(data?.error || formatSupabaseError(error));
  return data;
}

export async function clearAuditedContent(eventId: string, reason: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('content-audit', {
    body: { action: 'clear', eventId, reason, sessionToken: getAdminFinancialSessionToken() },
  });
  if (error || data?.error) throw new Error(data?.error || formatSupabaseError(error));
}

export interface AuditDeletionFilters {
  type: string | null;
  owner: string | null;
  action: string | null;
  contentSearch: string | null;
  identitySearch: string | null;
  from: string | null;
  to: string | null;
}

export async function prepareAuditedDeletion(filters: AuditDeletionFilters, eventId?: string): Promise<{ job_id: string; card_count: number; event_count: number }> {
  const { data, error } = await supabase.functions.invoke('content-audit', {
    body: { action: 'prepare_delete', filters, eventId, sessionToken: getAdminFinancialSessionToken() },
  });
  if (error || data?.error) throw new Error(data?.error || formatSupabaseError(error));
  return data;
}

export async function executeAuditedDeletion(jobId: string): Promise<{ success: boolean; deleted_events: number }> {
  const { data, error } = await supabase.functions.invoke('content-audit', {
    body: { action: 'execute_delete', jobId, sessionToken: getAdminFinancialSessionToken() },
  });
  if (error || data?.error) throw new Error(data?.error || formatSupabaseError(error));
  return data;
}

export async function loadAuditedMedia(eventId: string, path: string): Promise<{ url: string; type: string }> {
  const { data, error, response } = await supabase.functions.invoke('content-audit', {
    body: { action: 'media', eventId, path, sessionToken: getAdminFinancialSessionToken() },
  });
  const mediaType = response?.headers.get('X-Audit-Media-Type') ?? '';
  if (error || !(data instanceof Blob) || !/^(image\/(png|jpeg|webp|gif)|video\/mp4)$/.test(mediaType)) {
    throw new Error(formatSupabaseError(error || new Error('The evidence media is unavailable.')));
  }
  return { url: URL.createObjectURL(new Blob([data], { type: mediaType })), type: mediaType };
}
