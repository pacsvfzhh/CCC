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
      } else if (['content', 'message_content', 'image_url', 'rendered_html', 'custom_avatar_url'].includes(key) && typeof value === 'string') {
        const matches = value.matchAll(/https?:\/\/[^\s"'<>)}]+\/storage\/v1\/object\/public\/[^\s"'<>)}]+/g);
        for (const match of matches) found.add(match[0].replace(/&amp;/g, '&'));
        for (const match of value.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
          if (/^https?:\/\//i.test(match[1])) found.add(match[1].replace(/&amp;/g, '&'));
          else if (!/^data:image\//i.test(match[1])) throw new Error('An image cannot be preserved from its source.');
        }
      }
    }
  }
  visit(snapshot);
  if (found.size > 150) throw new Error('Too many attachments to preserve in one operation.');
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

async function mutate(body: Change) {
  const { data: prepared, error: prepareError } = await db.rpc('prepare_content_audit_change', {
    p_admin_session_token: body.sessionToken,
    p_action: body.action,
    p_target_ids: body.targetIds,
    p_employee_id: body.employeeId ?? null,
  });
  if (prepareError) throw prepareError;
  const urls = mediaUrls(prepared.snapshots);
  const operationId = crypto.randomUUID();
  const copied: string[] = [];
  const manifest: Record<string, string> = {};
  try {
    for (const [index, original] of urls.entries()) {
      const { bucket, objectPath } = storagePath(original);
      const { data: blob, error: downloadError } = await db.storage.from(bucket).download(objectPath);
      if (downloadError || !blob) throw new Error('Unable to preserve an original attachment; content was not changed.');
      const privatePath = `${operationId}/${index}`;
      const { error: uploadError } = await db.storage.from(evidenceBucket).upload(privatePath, blob, {
        contentType: blob.type || 'application/octet-stream', upsert: false,
      });
      if (uploadError) throw new Error('Unable to preserve an original attachment; content was not changed.');
      copied.push(privatePath);
      manifest[original] = privatePath;
    }
    const { data, error } = await db.rpc('commit_content_audit_change', {
      p_admin_session_token: body.sessionToken,
      p_action: body.action,
      p_target_ids: body.targetIds,
      p_employee_id: body.employeeId ?? null,
      p_expected_hash: prepared.hash,
      p_payload: body.payload ?? {},
      p_operation_id: operationId,
      p_media: manifest,
    });
    if (error) throw error;
    return response(data);
  } catch (error) {
    if (copied.length) await db.storage.from(evidenceBucket).remove(copied);
    throw error;
  }
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
        headers: { ...cors, 'Content-Type': blob.type || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' },
      });
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
