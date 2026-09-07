import { supabase } from './supabase';
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

function getSourceType(service: ServiceWorkspace): WorkspaceSource {
  return service === 'customer' ? 'aaa_service' : 'ccc_service';
}

function getCacheKey(adminId: string, service: ServiceWorkspace) {
  return `${adminId}:${service}`;
}

function getDataCacheKey(adminId: string, service: ServiceWorkspace) {
  return `${adminId}:${service}:data`;
}

export function prefetchAdminGroups(
  adminId: string,
  service: ServiceWorkspace,
  force = false,
): Promise<AdminGroup[]> {
  const cacheKey = getCacheKey(adminId, service);

  const pending = pendingRequests.get(cacheKey);
  if (pending) return pending;

  if (!force) {
    const cached = cachedGroups.get(cacheKey);
    if (cached) return Promise.resolve(cached);
  }

  const request = Promise.resolve(
    supabase.rpc('get_admin_groups_for_customer_service', {
      p_source_type: getSourceType(service),
    }),
  ).then(({ data, error }) => {
      if (error) throw error;
      const groups = (data || []) as AdminGroup[];
      cachedGroups.set(cacheKey, groups);
      return groups;
    })
    .finally(() => {
      pendingRequests.delete(cacheKey);
    });

  pendingRequests.set(cacheKey, request);
  return request;
}

export function prefetchAdminWorkspaceData<TCustomer = Record<string, unknown>, TEmployee = Record<string, unknown>>(
  adminId: string,
  service: ServiceWorkspace,
  force = false,
): Promise<ServiceWorkspaceData<TCustomer, TEmployee>> {
  const cacheKey = getDataCacheKey(adminId, service);
  const pending = pendingDataRequests.get(cacheKey);
  if (pending) return pending as Promise<ServiceWorkspaceData<TCustomer, TEmployee>>;

  if (!force) {
    const cached = cachedWorkspaceData.get(cacheKey);
    if (cached) return Promise.resolve(cached as ServiceWorkspaceData<TCustomer, TEmployee>);
  }

  const request = Promise.all([
    supabase
      .from('simulated_customers')
      .select('*')
      .eq('admin_id', adminId)
      .eq('source_type', getSourceType(service))
      .order('created_at', { ascending: false }),
    supabase
      .from('users')
      .select('*')
      .eq('created_by', adminId)
      .order('username'),
  ])
    .then(([customersRes, employeesRes]) => {
      if (customersRes.error) throw customersRes.error;
      if (employeesRes.error) throw employeesRes.error;

      const data: ServiceWorkspaceData = {
        customers: customersRes.data || [],
        employees: employeesRes.data || [],
      };
      cachedWorkspaceData.set(cacheKey, data);
      return data;
    })
    .finally(() => {
      pendingDataRequests.delete(cacheKey);
    });

  pendingDataRequests.set(cacheKey, request);
  return request as Promise<ServiceWorkspaceData<TCustomer, TEmployee>>;
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
  const pending = pendingConversationRequests.get(cacheKey);
  if (pending) return pending as Promise<TSummary[]>;

  if (!force) {
    const cached = cachedConversationSummaries.get(cacheKey);
    if (cached) return Promise.resolve(cached as TSummary[]);
  }

  const request = loader().then(summaries => {
    cachedConversationSummaries.set(cacheKey, summaries);
    return summaries;
  }).finally(() => {
    pendingConversationRequests.delete(cacheKey);
  });

  pendingConversationRequests.set(cacheKey, request);
  return request;
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
  cachedConversationSummaries.delete(`${getCacheKey(adminId, service)}:conversations`);
}
