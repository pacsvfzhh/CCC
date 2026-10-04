import { createClient } from 'npm:@supabase/supabase-js@2';

const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const evidenceBucket = 'content-audit-evidence';
const buckets = new Set(['chat-images', 'template-images', 'announcement-images', 'super-customer-avatars']);
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Expose-Headers': 'X-Audit-Media-Type',
  'Cache-Control': 'no-store',
};

type Change = {
  action: string;
  sessionToken: string;
  targetIds: string[];
  employeeId?: string;
  payload?: Record<string, unknown>;
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

function mediaUrls(snapshot: unknown): string[] {
  const found = new Set<string>();
  function visit(node: unknown) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const record = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (key === 'message' || key === 'messages' || key === 'source' || key === 'customers') {
        visit(value);
      } else if (['content', 'message_content', 'image_url', 'rendered_html', 'html_content', 'custom_avatar_url'].includes(key) && typeof value === 'string') {
        const matches = value.matchAll(/https?:\/\/[^\s"'<>)}]+\/storage\/v1\/object\/public\/[^\s"'<>)}]+/g);
        for (const match of matches) found.add(match[0].replace(/&amp;/g, '&'));
        for (const match of value.matchAll(/<(?:img|video|source)\b[^>]*\b(?:src|poster)\s*=\s*["']([^"']+)["']/gi)) {
          if (/^https?:\/\//i.test(match[1])) found.add(match[1].replace(/&amp;/g, '&'));
          else if (!/^data:(?:image|video)\//i.test(match[1])) throw new Error('A media attachment cannot be preserved from its source.');
        }
      }
    }
  }
  visit(snapshot);
  return [...found];
}

function storagePath(originalUrl: string) {
  const input = new URL(originalUrl);
  const expected = new URL(url);
  if (input.origin !== expected.origin || input.search || input.hash) throw new Error('An attachment is outside the managed storage.');
  const prefix = '/storage/v1/object/public/';
  if (!input.pathname.startsWith(prefix)) throw new Error('An attachment is outside the managed storage.');
  const path = decodeURIComponent(input.pathname.slice(prefix.length));
  const split = path.indexOf('/');
  const bucket = path.slice(0, split);
  const objectPath = path.slice(split + 1);
  if (!buckets.has(bucket) || !objectPath || objectPath.split('/').some(segment => !segment || segment === '..' || segment === '.')) {
    throw new Error('An attachment has an invalid storage path.');
  }
  return { bucket, objectPath };
}

async function clearStaleCopies() {
  const { data: paths, error } = await db.rpc('list_content_audit_orphan_media');
  if (error) throw error;
  if (paths?.length) {
    const { error: removeError } = await db.storage.from(evidenceBucket).remove(paths);
    if (removeError) throw removeError;
  }
}

async function mutate(body: Change) {
  const { data: prepared, error: prepareError } = await db.rpc('prepare_content_audit_change', {
    p_admin_session_token: body.sessionToken,
    p_action: body.action,
    p_target_ids: body.targetIds,
    p_employee_id: body.employeeId ?? null,
  });
  if (prepareError) throw prepareError;
  const staleCleanup = clearStaleCopies().catch(error => console.error('Could not collect uncommitted evidence:', error));
  const snapshots = prepared.snapshots as unknown;
  const entries = Array.isArray(snapshots) ? snapshots
    : snapshots && typeof snapshots === 'object' && 'messages' in snapshots ? snapshots.messages : null;
  const messages = Array.isArray(entries) ? entries : [];
  const operationId = crypto.randomUUID();
  const copied: string[] = [];
  const copies = new Map<string, { bucket: string; objectPath: string; privatePath: string }>();
  const manifest: Record<string, Record<string, string>> = {};
  try {
    const addedUrls = body.action.endsWith('_edit') ? mediaUrls(body.payload ?? {}) : [];
    for (const item of messages) {
      if (body.action === 'notification_delete' && item?.message?.automation_execution_id) continue;
      const id = item?.message?.id;
      if (typeof id !== 'string') throw new Error('The evidence snapshot is invalid.');
      manifest[id] = {};
      for (const original of new Set([...mediaUrls(item), ...addedUrls])) {
        let copy = copies.get(original);
        if (!copy) {
          const { bucket, objectPath } = storagePath(original);
          copy = { bucket, objectPath, privatePath: `${operationId}/shared/${copies.size}` };
          copies.set(original, copy);
        }
        manifest[id][original] = copy.privatePath;
      }
    }
    const pending = [...copies.values()];
    let next = 0;
    const copyNext = async () => {
      while (next < pending.length) {
        const copy = pending[next++];
        const { data: blob, error: downloadError } = await db.storage.from(copy.bucket).download(copy.objectPath);
        if (downloadError || !blob) throw new Error('Unable to preserve an attachment; content was not changed.');
        const { error: uploadError } = await db.storage.from(evidenceBucket).upload(copy.privatePath, blob, {
          contentType: blob.type || 'application/octet-stream', upsert: false,
        });
        if (uploadError) throw new Error('Unable to preserve an attachment; content was not changed.');
        copied.push(copy.privatePath);
      }
    };
    const results = await Promise.allSettled(Array.from({ length: Math.min(4, pending.length) }, copyNext));
    const failed = results.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  } catch (error) {
    if (copied.length) await db.storage.from(evidenceBucket).remove(copied);
    await staleCleanup;
    throw error;
  }
  await staleCleanup;
  const { data, error, status } = await db.rpc('commit_content_audit_change', {
    p_admin_session_token: body.sessionToken,
    p_action: body.action,
    p_target_ids: body.targetIds,
    p_employee_id: body.employeeId ?? null,
    p_expected_hash: prepared.hash,
    p_payload: body.payload ?? {},
    p_operation_id: operationId,
    p_media: manifest,
  });
  if (error) {
    if (status >= 400 && status < 500 && copied.length) {
      const { error: cleanupError } = await db.storage.from(evidenceBucket).remove(copied);
      if (cleanupError) console.error('Failed to discard rejected evidence copies:', cleanupError);
    }
    throw error;
  }
  return response(data);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return response({ error: 'Method not allowed.' }, 405);
  try {
    const body = await request.json();
    const token = body.sessionToken;
    if (typeof token !== 'string' || !/^[\da-f-]{36}$/i.test(token)) return response({ error: 'Administrator session is required.' }, 401);
    if (body.action === 'media') {
      if (typeof body.eventId !== 'string' || typeof body.path !== 'string') return response({ error: 'Invalid evidence request.' }, 400);
      const { data: event, error } = await db.rpc('get_content_audit_event', {
        p_admin_session_token: token, p_event_id: body.eventId,
      });
      if (error || !event || event.cleared_at || !Object.values(event.media_refs || {}).includes(body.path)) {
        return response({ error: 'Evidence is not available.' }, 403);
      }
      const { data: blob, error: downloadError } = await db.storage.from(evidenceBucket).download(body.path);
      if (downloadError || !blob) return response({ error: 'Evidence attachment is unavailable.' }, 404);
      return new Response(blob, {
        headers: { ...cors, 'Content-Type': 'application/octet-stream', 'X-Audit-Media-Type': blob.type, 'X-Content-Type-Options': 'nosniff' },
      });
    }
    if (body.action === 'pending_deletes') {
      const { data, error } = await db.rpc('list_content_audit_pending_deletes', {
        p_admin_session_token: token,
      });
      if (error) throw error;
      return response(data);
    }
    if (body.action === 'prepare_conversation_delete') {
      if (typeof body.eventId !== 'string' || !/^[\da-f-]{36}$/i.test(body.eventId)) return response({ error: 'Invalid conversation event ID.' }, 400);
      const { data, error } = await db.rpc('prepare_content_audit_conversation_delete', {
        p_admin_session_token: token, p_event_id: body.eventId,
      });
      if (error) throw error;
      return response(data);
    }
    if (body.action === 'prepare_delete') {
      const filters = body.filters;
      if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return response({ error: 'Invalid audit filters.' }, 400);
      const eventId = body.eventId;
      if (eventId !== undefined && (typeof eventId !== 'string' || !/^[\da-f-]{36}$/i.test(eventId))) return response({ error: 'Invalid event ID.' }, 400);
      const { data, error } = await db.rpc('prepare_content_audit_delete', {
        p_admin_session_token: token,
        p_type: filters.type || null,
        p_owner: filters.owner || null,
        p_action: filters.action || null,
        p_content_search: filters.contentSearch || null,
        p_identity_search: filters.identitySearch || null,
        p_from: filters.from || null,
        p_to: filters.to || null,
        p_event_id: eventId || null,
      });
      if (error) throw error;
      return response(data);
    }
    if (body.action === 'execute_delete') {
      if (typeof body.jobId !== 'string' || !/^[\da-f-]{36}$/i.test(body.jobId)) return response({ error: 'Invalid confirmation.' }, 400);
      const { data: deleted, error: deleteError } = await db.rpc('finish_content_audit_delete', {
        p_admin_session_token: token, p_job_id: body.jobId,
      });
      if (deleteError) throw deleteError;
      const paths = deleted.paths_to_remove as string[];
      for (let index = 0; index < paths.length; index += 100) {
        const { error: removeError } = await db.storage.from(evidenceBucket).remove(paths.slice(index, index + 100));
        if (removeError) throw new Error('Audit records were deleted, but private media cleanup is incomplete. Retry this confirmation.');
      }
      const { error: completeError } = await db.rpc('complete_content_audit_delete', {
        p_admin_session_token: token, p_job_id: body.jobId,
      });
      if (completeError) throw completeError;
      return response(deleted);
    }
    if (body.action === 'clear') {
      if (typeof body.eventId !== 'string' || typeof body.reason !== 'string') return response({ error: 'Invalid clear request.' }, 400);
      const { data: started, error: beginError } = await db.rpc('begin_content_audit_clear', {
        p_admin_session_token: token, p_event_id: body.eventId, p_reason: body.reason,
      });
      if (beginError) throw beginError;
      const paths = started.paths_to_remove as string[];
      if (paths.length) {
        const { error: removeError } = await db.storage.from(evidenceBucket).remove(paths);
        if (removeError) throw new Error('Evidence media cleanup is incomplete. Retry while purge mode is enabled.');
      }
      const { data, error } = await db.rpc('finish_content_audit_clear', {
        p_admin_session_token: token, p_event_id: body.eventId,
      });
      if (error) throw error;
      return response(data);
    }
    if (!Array.isArray(body.targetIds) || !body.targetIds.length || !body.targetIds.every((id: unknown) => typeof id === 'string' && /^[\da-f-]{36}$/i.test(id))) {
      return response({ error: 'Invalid record IDs.' }, 400);
    }
    return await mutate(body as Change);
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : 'Operation failed.' }, 400);
  }
});
