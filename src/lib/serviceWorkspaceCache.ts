import { isSupabaseTransientError, supabase } from './supabase';
import type { AdminGroup } from '../components/admin/AdminGroupPicker';

export type ServiceWorkspace = 'customer' | 'manager';

type WorkspaceSource = 'aaa_service' | 'ccc_service';

const pendingRequests = new Map<string, Promise<AdminGroup[]>>();
const cachedGroups = new Map<string, AdminGroup[]>();

export interface ServiceWorkspaceData<TCustomer = Record<string, unknown>, TEmployee = Record<string, unknown>> {
  customers: TCustomer[];
  employees: TEmployee[];
}

const pendingDataRequests = new Map<string, Promise<ServiceWorkspaceData>>();
const cachedWorkspaceData = new Map<string, ServiceWorkspaceData>();
const pendingConversationRequests = new Map<string, Promise<unknown[]>>();
const cachedConversationSummaries = new Map<string, unknown[]>();
const CACHE_RETRY_LIMIT = 2;
const CACHE_RETRY_DELAY_MS = 350;

const waitForCacheRetry = () => new Promise<void>(resolve => {
  globalThis.setTimeout(resolve, CACHE_RETRY_DELAY_MS);
});

async function loadWithTransientRetry<T>(loader: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt <= CACHE_RETRY_LIMIT; attempt += 1) {
    try {
      return await loader();
    } catch (error) {
      if (!isSupabaseTransientError(error) || attempt === CACHE_RETRY_LIMIT) throw error;
      await waitForCacheRetry();
    }
  }

  throw new Error('Service workspace request failed after retries.');
}

function queueRequest<T>(
  pendingRequests: Map<string, Promise<T>>,
  cacheKey: string,
  loader: () => Promise<T>,
  onSuccess: (value: T) => void,
) {
  const pending = pendingRequests.get(cacheKey);
  if (pending) return pending;

  const request = loadWithTransientRetry(loader).then(value => {
    if (pendingRequests.get(cacheKey) === trackedRequest) {
      onSuccess(value);
    }
    return value;
  });
  const trackedRequest = request.finally(() => {
    if (pendingRequests.get(cacheKey) === trackedRequest) {
      pendingRequests.delete(cacheKey);
    }
  });
  pendingRequests.set(cacheKey, trackedRequest);
  return trackedRequest;
}

function getSourceType(service: ServiceWorkspace): WorkspaceSource {
  return service === 'customer' ? 'aaa_service' : 'ccc_service';
}

function getCacheKey(adminId: string, service: ServiceWorkspace) {
  return `${adminId}:${service}`;
}

function getDataCacheKey(adminId: string, service: ServiceWorkspace) {
  return `${adminId}:${service}:data`;
}

function normalizeAdminGroups(data: unknown): AdminGroup[] {
  if (!Array.isArray(data)) {
    throw new Error('Admin groups response is not an array');
  }
  return data as AdminGroup[];
}

type ConversationOwnershipRow = {
  customer_id: string;
  employee_id: string;
  simulated_customers: {
    admin_id: string;
    source_type: string;
  } | Array<{
    admin_id: string;
    source_type: string;
  }> | null;
  users: {
    created_by: string | null;
  } | Array<{
    created_by: string | null;
  }> | null;
};

async function loadConversationCountsByAdmin(sourceType: WorkspaceSource) {
  const { data, error } = await supabase
    .from('customer_employee_conversations')
    .select('customer_id, employee_id, simulated_customers!inner(admin_id, source_type), users!inner(created_by)')
    .eq('source_type', sourceType)
    .eq('simulated_customers.source_type', sourceType);

  if (error) throw error;

  const sessionsByAdmin = new Map<string, Set<string>>();
  const rows = (data || []) as unknown as ConversationOwnershipRow[];

  rows.forEach(row => {
    const customer = Array.isArray(row.simulated_customers)
      ? row.simulated_customers[0]
      : row.simulated_customers;
    const employee = Array.isArray(row.users) ? row.users[0] : row.users;

    if (!customer || !employee || employee.created_by !== customer.admin_id) return;

    const sessions = sessionsByAdmin.get(customer.admin_id) || new Set<string>();
    sessions.add(`${row.customer_id}:${row.employee_id}`);
    sessionsByAdmin.set(customer.admin_id, sessions);
  });

  return sessionsByAdmin;
}

export function prefetchAdminGroups(
  adminId: string,
  service: ServiceWorkspace,
  force = false,
): Promise<AdminGroup[]> {
  const cacheKey = getCacheKey(adminId, service);
  if (!force) {
    const cached = cachedGroups.get(cacheKey);
    if (cached) return Promise.resolve(cached);
  }

  const sourceType = getSourceType(service);
  const loadGroups = () => Promise.all([
    Promise.resolve(
      supabase.rpc('get_admin_groups_for_customer_service', {
        p_source_type: sourceType,
      }),
    ).then(({ data, error }) => {
      if (error) throw error;
      return normalizeAdminGroups(data);
    }),
    loadConversationCountsByAdmin(sourceType),
  ]).then(([groups, conversationCounts]) => groups.map(group => ({
    ...group,
    conversation_count: conversationCounts.get(group.admin_id)?.size || 0,
  })));

  return queueRequest(
    pendingRequests,
    cacheKey,
    loadGroups,
    groups => cachedGroups.set(cacheKey, groups),
  );
}

export function prefetchAdminWorkspaceData<TCustomer = Record<string, unknown>, TEmployee = Record<string, unknown>>(
  adminId: string,
  service: ServiceWorkspace,
  force = false,
): Promise<ServiceWorkspaceData<TCustomer, TEmployee>> {
  const cacheKey = getDataCacheKey(adminId, service);
  if (!force) {
    const cached = cachedWorkspaceData.get(cacheKey);
    if (cached) return Promise.resolve(cached as ServiceWorkspaceData<TCustomer, TEmployee>);
  }

  return queueRequest(
    pendingDataRequests as Map<string, Promise<ServiceWorkspaceData<TCustomer, TEmployee>>>,
    cacheKey,
    () => Promise.all([
      supabase
        .from('simulated_customers')
        .select('id, admin_id, customer_name, customer_id, customer_avatar, is_active, created_at, is_super, super_customer_title, badge_type, custom_avatar_url, is_pinned, vip_label, remarks, employee_pin_top, employee_always_visible, target_employee_ids, auto_messages_enabled')
        .eq('admin_id', adminId)
        .eq('source_type', getSourceType(service))
        .order('created_at', { ascending: false }),
      supabase
        .from('users')
        .select('id, username, employee_id, is_verified, is_active, remarks, tags, created_by, created_at')
        .eq('created_by', adminId)
        .order('username'),
    ]).then(([customersRes, employeesRes]) => {
      if (customersRes.error) throw customersRes.error;
      if (employeesRes.error) throw employeesRes.error;

      return {
        customers: customersRes.data || [],
        employees: employeesRes.data || [],
      } as ServiceWorkspaceData<TCustomer, TEmployee>;
    }),
    data => cachedWorkspaceData.set(cacheKey, data as ServiceWorkspaceData),
  );
}

export function invalidateAdminGroupsCache(
  adminId: string,
  service: ServiceWorkspace,
) {
  cachedGroups.delete(getCacheKey(adminId, service));
}

export function prefetchConversationSummaries<TSummary = unknown>(
  adminId: string,
  service: ServiceWorkspace,
  loader: () => Promise<TSummary[]>,
  force = false,
): Promise<TSummary[]> {
  const cacheKey = `${getCacheKey(adminId, service)}:conversations`;
  if (!force) {
    const cached = cachedConversationSummaries.get(cacheKey);
    if (cached) return Promise.resolve(cached as TSummary[]);
  }

  return queueRequest(
    pendingConversationRequests as Map<string, Promise<TSummary[]>>,
    cacheKey,
    loader,
    summaries => cachedConversationSummaries.set(cacheKey, summaries as unknown[]),
  );
}

export function getCachedAdminWorkspaceData<TCustomer = Record<string, unknown>, TEmployee = Record<string, unknown>>(
  adminId: string,
  service: ServiceWorkspace,
): ServiceWorkspaceData<TCustomer, TEmployee> | null {
  return cachedWorkspaceData.get(getDataCacheKey(adminId, service)) as ServiceWorkspaceData<TCustomer, TEmployee> | undefined || null;
}

export function getCachedConversationSummaries<TSummary = unknown>(
  adminId: string,
  service: ServiceWorkspace,
): TSummary[] | null {
  return cachedConversationSummaries.get(`${getCacheKey(adminId, service)}:conversations`) as TSummary[] | undefined || null;
}

export function invalidateAdminWorkspaceDataCache(
  adminId: string,
  service: ServiceWorkspace,
) {
  cachedWorkspaceData.delete(getDataCacheKey(adminId, service));
}

export function invalidateConversationSummariesCache(
  adminId: string,
  service: ServiceWorkspace,
) {
  const cacheKey = `${getCacheKey(adminId, service)}:conversations`;
  pendingConversationRequests.delete(cacheKey);
  cachedConversationSummaries.delete(cacheKey);
}
