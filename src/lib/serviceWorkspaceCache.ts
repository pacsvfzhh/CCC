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

function queueRequest<T>(
  pendingRequests: Map<string, Promise<T>>,
  cacheKey: string,
  loader: () => Promise<T>,
  force: boolean,
  onSuccess: (value: T) => void,
) {
  const pending = pendingRequests.get(cacheKey);
  if (pending && !force) return pending;

  const source = pending && force
    ? pending.then(() => loader(), () => loader())
    : loader();
  const request = source.then(value => {
    onSuccess(value);
    return value;
  });
  let trackedRequest!: Promise<T>;
  trackedRequest = request.finally(() => {
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

  return queueRequest(
    pendingRequests,
    cacheKey,
    () => Promise.resolve(
      supabase.rpc('get_admin_groups_for_customer_service', {
        p_source_type: getSourceType(service),
      }),
    ).then(({ data, error }) => {
      if (error) throw error;
      return (data || []) as AdminGroup[];
    }),
    force,
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
        .select('*')
        .eq('admin_id', adminId)
        .eq('source_type', getSourceType(service))
        .order('created_at', { ascending: false }),
      supabase
        .from('users')
        .select('*')
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
    force,
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
    force,
    summaries => cachedConversationSummaries.set(cacheKey, summaries as unknown[]),
  );
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
