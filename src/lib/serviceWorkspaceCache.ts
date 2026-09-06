import { supabase } from './supabase';
import type { AdminGroup } from '../components/admin/AdminGroupPicker';

export type ServiceWorkspace = 'customer' | 'manager';

type WorkspaceSource = 'aaa_service' | 'ccc_service';

const pendingRequests = new Map<string, Promise<AdminGroup[]>>();
const cachedGroups = new Map<string, AdminGroup[]>();

function getSourceType(service: ServiceWorkspace): WorkspaceSource {
  return service === 'customer' ? 'aaa_service' : 'ccc_service';
}

function getCacheKey(adminId: string, service: ServiceWorkspace) {
  return `${adminId}:${service}`;
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

    const pending = pendingRequests.get(cacheKey);
    if (pending) return pending;
  }

  const request = supabase
    .rpc('get_admin_groups_for_customer_service', {
      p_source_type: getSourceType(service),
    })
    .then(({ data, error }) => {
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

export function invalidateAdminGroupsCache(
  adminId: string,
  service: ServiceWorkspace,
) {
  cachedGroups.delete(getCacheKey(adminId, service));
}
