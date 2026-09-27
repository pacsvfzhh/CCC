import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle,
  Edit2,
  FolderPlus,
  Layers,
  PackageSearch,
  Plus,
  Save,
  Search,
  Settings,
  Trash2,
  Upload,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { getAdminFinancialSessionToken, getStoredAuth } from '../../lib/auth';
import { formatSupabaseError, supabase } from '../../lib/supabase';

const PAGE_SIZE = 25;
const IMPORT_BATCH_SIZE = 2000;
const inputClass =
  'w-full min-w-0 rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500';
const secondaryButton =
  'rounded-lg border border-slate-600 bg-slate-700/60 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50';
const primaryButton =
  'rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50';

interface DispatchGroup {
  id: string;
  group_name: string;
  description: string | null;
  pool_selection_mode: 'base' | 'random';
  is_default: boolean;
  is_active: boolean;
  archived_at: string | null;
  member_count: number;
  order_count: number;
}

interface DispatchPool {
  id: string;
  group_id: string;
  pool_name: string;
  is_base: boolean;
  is_active: boolean;
  dispatch_interval_min: number;
  dispatch_interval_max: number;
  session_timeout_minutes: number;
  dispatch_order_mode: 'random' | 'sequential';
  dispatch_success_rate: number;
  archived_at: string | null;
  order_count: number;
}

interface DispatchOrder {
  id: string;
  pool_id: string;
  order_content: string;
  is_active: boolean;
  created_at: string;
  archived_at: string | null;
}

interface Employee {
  id: string;
  username: string;
  created_by: string | null;
  group_id: string | null;
  remarks: string | null;
  tags: string[] | null;
}

type GroupDraft = Pick<
  DispatchGroup,
  'group_name' | 'pool_selection_mode' | 'is_active'
> & { description: string };
type PoolDraft = Pick<
  DispatchPool,
  'pool_name' | 'is_active' | 'dispatch_order_mode'
> & {
  dispatch_interval_min: string;
  dispatch_interval_max: string;
  session_timeout_minutes: string;
  dispatch_success_rate: string;
};

type OrderAction = 'edit' | 'toggle' | 'delete' | 'delete_all';

const emptyGroupDraft: GroupDraft = {
  group_name: '',
  description: '',
  pool_selection_mode: 'base',
  is_active: true,
};
const emptyPoolDraft: PoolDraft = {
  pool_name: '',
  is_active: true,
  dispatch_interval_min: '30',
  dispatch_interval_max: '120',
  session_timeout_minutes: '10',
  dispatch_order_mode: 'random',
  dispatch_success_rate: '100',
};

function poolToDraft(pool: DispatchPool): PoolDraft {
  return {
    pool_name: pool.pool_name,
    is_active: pool.is_active,
    dispatch_interval_min: String(pool.dispatch_interval_min),
    dispatch_interval_max: String(pool.dispatch_interval_max),
    session_timeout_minutes: String(pool.session_timeout_minutes),
    dispatch_order_mode: pool.dispatch_order_mode,
    dispatch_success_rate: String(pool.dispatch_success_rate),
  };
}

export default function DispatchManagement() {
  const auth = getStoredAuth();
  const admin = auth?.userType === 'admin' ? auth.user : null;
  const isSuperAdmin = admin?.role === 'super_admin';
  const [groups, setGroups] = useState<DispatchGroup[]>([]);
  const [pools, setPools] = useState<DispatchPool[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [adminNames, setAdminNames] = useState<
    { id: string; username: string }[]
  >([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null);
  const [modeDraft, setModeDraft] = useState<'base' | 'random'>('base');
  const [groupSearch, setGroupSearch] = useState('');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [employeeAdminFilter, setEmployeeAdminFilter] = useState('all');
  const [employeeTagFilter, setEmployeeTagFilter] = useState('all');
  const [selectedCurrentMembers, setSelectedCurrentMembers] = useState<
    string[]
  >([]);
  const [selectedOtherMembers, setSelectedOtherMembers] = useState<string[]>(
    [],
  );
  const [orders, setOrders] = useState<DispatchOrder[]>([]);
  const [ordersPoolId, setOrdersPoolId] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [orderFilter, setOrderFilter] = useState<'all' | 'active' | 'inactive'>(
    'all',
  );
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notification, setNotification] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [groupForm, setGroupForm] = useState<'create' | 'edit' | null>(null);
  const [groupDraft, setGroupDraft] = useState<GroupDraft>(emptyGroupDraft);
  const [poolForm, setPoolForm] = useState<'create' | 'edit' | null>(null);
  const [poolDraft, setPoolDraft] = useState<PoolDraft>(emptyPoolDraft);
  const [archiveTarget, setArchiveTarget] = useState<{
    type: 'group' | 'pool';
    id: string;
    name: string;
  } | null>(null);
  const [memberMove, setMemberMove] = useState<{
    ids: string[];
    targetGroupId: string;
    destination: string;
  } | null>(null);
  const [bulkInput, setBulkInput] = useState('');
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [importPoolId, setImportPoolId] = useState('');
  const [importProgress, setImportProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [deleteOrder, setDeleteOrder] = useState<DispatchOrder | null>(null);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const ordersRequestRef = useRef(0);
  const workspaceRequestRef = useRef(0);

  const selectedGroup =
    groups.find((group) => group.id === selectedGroupId) ?? null;
  const groupPools = pools.filter((pool) => pool.group_id === selectedGroupId);
  const selectedPool =
    groupPools.find((pool) => pool.id === selectedPoolId) ??
    groupPools.find((pool) => pool.is_base && !pool.archived_at) ??
    null;
  const defaultGroup = groups.find(
    (group) => group.is_default && group.is_active && !group.archived_at,
  );
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const modalOpen = Boolean(
    groupForm ||
      poolForm ||
      archiveTarget ||
      memberMove ||
      deleteOrder ||
      showDeleteAll,
  );

  const notify = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
  };

  const loadWorkspace = async () => {
    const requestId = ++workspaceRequestRef.current;
    try {
      const [groupResult, poolResult, adminResult] = await Promise.all([
        supabase
          .from('dispatch_groups')
          .select('*')
          .order('is_default', { ascending: false })
          .order('created_at'),
        supabase
          .from('dispatch_order_pools')
          .select('*')
          .order('is_base', { ascending: false })
          .order('created_at'),
        isSuperAdmin
          ? supabase.from('admins').select('id, username').order('username')
          : Promise.resolve(null),
      ]);
      if (groupResult.error) throw groupResult.error;
      if (poolResult.error) throw poolResult.error;
      if (adminResult?.error) throw adminResult.error;

      const groupRows = groupResult.data as unknown as DispatchGroup[];
      const poolRows = poolResult.data as unknown as DispatchPool[];
      const employeeRows: Employee[] = [];
      // Page employees and their memberships to avoid Supabase's default 1,000-row limit.
      for (let offset = 0; ; offset += 500) {
        let query = supabase
          .from('users')
          .select('id, username, created_by, remarks, tags')
          .order('username')
          .order('id')
          .range(offset, offset + 499);
        if (!isSuperAdmin && admin) query = query.eq('created_by', admin.id);
        const { data: users, error } = await query;
        if (error) throw error;
        if (!users?.length) break;
        const memberMap = new Map<string, string>();
        for (let index = 0; index < users.length; index += 100) {
          const { data: memberships, error: memberError } = await supabase
            .from('dispatch_group_members')
            .select('user_id, group_id')
            .in(
              'user_id',
              users.slice(index, index + 100).map((user) => user.id),
            );
          if (memberError) throw memberError;
          for (const member of memberships ?? [])
            memberMap.set(member.user_id, member.group_id);
        }
        employeeRows.push(
          ...users.map((employee) => ({
            id: employee.id,
            username: employee.username,
            created_by: employee.created_by,
            group_id: memberMap.get(employee.id) ?? null,
            remarks: employee.remarks,
            tags: employee.tags,
          })),
        );
        if (users.length < 500) break;
      }
      const counts = await Promise.all(
        poolRows.map(async (pool) => {
          const result = await supabase
            .from('dispatch_group_orders')
            .select('id', { count: 'exact', head: true })
            .eq('pool_id', pool.id)
            .is('archived_at', null);
          if (result.error) throw result.error;
          return result.count ?? 0;
        }),
      );
      const countedPools = poolRows.map((pool, index) => ({
        ...pool,
        order_count: counts[index],
      }));
      const countedGroups = groupRows.map((group) => ({
        ...group,
        member_count: employeeRows.filter(
          (employee) => employee.group_id === group.id,
        ).length,
        order_count: countedPools
          .filter((pool) => pool.group_id === group.id)
          .reduce((sum, pool) => sum + pool.order_count, 0),
      }));
      if (requestId !== workspaceRequestRef.current) return false;
      setGroups(countedGroups);
      setPools(countedPools);
      setEmployees(employeeRows);
      setAdminNames(
        isSuperAdmin
          ? (adminResult?.data ?? [])
          : admin
            ? [{ id: admin.id, username: admin.username }]
            : [],
      );
      setSelectedGroupId((current) =>
        current && countedGroups.some((group) => group.id === current)
          ? current
          : (countedGroups.find(
              (group) => group.is_default && !group.archived_at,
            )?.id ??
            countedGroups[0]?.id ??
            null),
      );
      return true;
    } catch (error) {
      if (requestId === workspaceRequestRef.current)
        notify(
          'error',
          'Failed to load dispatch workspace: ' + formatSupabaseError(error),
        );
      return false;
    } finally {
      if (requestId === workspaceRequestRef.current) setWorkspaceLoading(false);
    }
  };

  const loadOrders = async (
    poolId: string,
    requestedPage = 1,
    status = orderFilter,
  ) => {
    const requestId = ++ordersRequestRef.current;
    setOrdersLoading(true);
    try {
      const from = (requestedPage - 1) * PAGE_SIZE;
      let query = supabase
        .from('dispatch_group_orders')
        .select('*', { count: 'exact' })
        .eq('pool_id', poolId)
        .is('archived_at', null)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (status !== 'all') query = query.eq('is_active', status === 'active');
      const { data, error, count } = await query;
      if (error) throw error;
      if (requestId !== ordersRequestRef.current) return false;
      const total = count ?? 0;
      if (requestedPage > 1 && from >= total) {
        return await loadOrders(
          poolId,
          Math.max(1, Math.ceil(total / PAGE_SIZE)),
          status,
        );
      }
      setOrders(data as unknown as DispatchOrder[]);
      setOrdersPoolId(poolId);
      setTotalCount(total);
      setPage(requestedPage);
      return true;
    } catch (error) {
      if (requestId !== ordersRequestRef.current) return false;
      setOrders([]);
      setOrdersPoolId(poolId);
      setTotalCount(0);
      notify('error', 'Failed to load orders: ' + formatSupabaseError(error));
      return false;
    } finally {
      if (requestId === ordersRequestRef.current) setOrdersLoading(false);
    }
  };

  const loadWorkspaceRef = useRef(loadWorkspace);
  const loadOrdersRef = useRef(loadOrders);
  const orderViewRef = useRef({
    poolId: selectedPool?.id ?? null,
    page,
    status: orderFilter,
  });
  loadWorkspaceRef.current = loadWorkspace;
  loadOrdersRef.current = loadOrders;
  orderViewRef.current = {
    poolId: selectedPool?.id ?? null,
    page,
    status: orderFilter,
  };

  useEffect(() => {
    void loadWorkspaceRef.current();
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        void loadWorkspaceRef.current();
        const { poolId, page: currentPage, status } = orderViewRef.current;
        if (poolId) void loadOrdersRef.current(poolId, currentPage, status);
      }, 600);
    };
    const channel = supabase.channel('dispatch-management-changes');
    for (const table of [
      'dispatch_groups',
      'dispatch_order_pools',
      'dispatch_group_orders',
      'dispatch_group_members',
      'users',
    ]) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        refresh,
      );
    }
    channel.subscribe();
    return () => {
      clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    setModeDraft(selectedGroup?.pool_selection_mode ?? 'base');
  }, [selectedGroup?.id, selectedGroup?.pool_selection_mode]);

  useEffect(() => {
    if (selectedPool?.id) {
      void loadOrdersRef.current(selectedPool.id, 1, orderFilter);
    } else {
      ++ordersRequestRef.current;
      setOrders([]);
      setOrdersPoolId(null);
      setTotalCount(0);
      setPage(1);
      setOrdersLoading(false);
    }
  }, [selectedPool?.id, orderFilter]);

  useEffect(() => {
    if (!modalOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [modalOpen]);

  const switchGroup = (groupId: string) => {
    setSelectedGroupId(groupId);
    setSelectedPoolId(null);
    setEditingId(null);
    setShowBulkImport(false);
    setBulkInput('');
    setSelectedCurrentMembers([]);
    setSelectedOtherMembers([]);
    setEmployeeTagFilter('all');
    setEmployeeAdminFilter('all');
  };

  const switchPool = (poolId: string) => {
    setSelectedPoolId(poolId);
    setEditingId(null);
    setShowBulkImport(false);
    setBulkInput('');
  };

  const saveGroup = async () => {
    if (!isSuperAdmin || !groupForm) return;
    if (groupForm === 'edit' && !selectedGroup)
      return notify(
        'error',
        'The group is no longer selected. Refresh and try again.',
      );
    if (!groupDraft.group_name.trim())
      return notify('error', 'Group name is required.');
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc(
        'admin_save_dispatch_group',
        {
          p_admin_session_token: getAdminFinancialSessionToken(),
          p_group_id: groupForm === 'edit' ? (selectedGroup?.id ?? null) : null,
          p_changes: {
            group_name: groupDraft.group_name.trim(),
            description: groupDraft.description,
            pool_selection_mode: groupDraft.pool_selection_mode,
            is_active: groupDraft.is_active,
          },
        },
      );
      if (error) throw error;
      if (!data?.group?.id) throw new Error('Group save returned no group.');
      setGroupForm(null);
      setSelectedGroupId(data.group.id);
      setSelectedPoolId(null);
      if (await loadWorkspace())
        notify(
          'success',
          groupForm === 'create'
            ? 'Group created with its own base pool.'
            : 'Group saved.',
        );
    } catch (error) {
      notify('error', 'Could not save group: ' + formatSupabaseError(error));
    } finally {
      setBusy(false);
    }
  };

  const saveSelectionMode = async () => {
    if (!isSuperAdmin || !selectedGroup || selectedGroup.archived_at) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('admin_save_dispatch_group', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_group_id: selectedGroup.id,
        p_changes: { pool_selection_mode: modeDraft },
      });
      if (error) throw error;
      if (await loadWorkspace())
        notify('success', 'Pool selection mode saved.');
    } catch (error) {
      notify(
        'error',
        'Could not save selection mode: ' + formatSupabaseError(error),
      );
    } finally {
      setBusy(false);
    }
  };

  const savePool = async () => {
    if (!isSuperAdmin || !selectedGroup || !poolForm) return;
    if (selectedGroup.archived_at || (poolForm === 'edit' && !selectedPool))
      return notify(
        'error',
        'The selected group or pool is no longer available. Refresh and try again.',
      );
    const min = Number(poolDraft.dispatch_interval_min);
    const max = Number(poolDraft.dispatch_interval_max);
    const timeout = Number(poolDraft.session_timeout_minutes);
    const rate = Number(poolDraft.dispatch_success_rate);
    if (!poolDraft.pool_name.trim())
      return notify('error', 'Pool name is required.');
    if (
      !Number.isInteger(min) ||
      min < 1 ||
      min > 3000 ||
      !Number.isInteger(max) ||
      max < min ||
      max > 3000 ||
      !Number.isInteger(timeout) ||
      timeout < 1 ||
      timeout > 60 ||
      !poolDraft.dispatch_success_rate.trim() ||
      !Number.isInteger(rate) ||
      rate < 0 ||
      rate > 100
    ) {
      return notify(
        'error',
        'Use 1–3000 seconds (minimum ≤ maximum), 1–60 minutes, and 0–100% success.',
      );
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('admin_save_dispatch_pool', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_group_id: selectedGroup.id,
        p_pool_id: poolForm === 'edit' ? (selectedPool?.id ?? null) : null,
        p_changes: {
          pool_name: poolDraft.pool_name.trim(),
          is_active: poolDraft.is_active,
          dispatch_interval_min: min,
          dispatch_interval_max: max,
          session_timeout_minutes: timeout,
          dispatch_order_mode: poolDraft.dispatch_order_mode,
          dispatch_success_rate: rate,
        },
      });
      if (error) throw error;
      if (!data?.pool?.id) throw new Error('Pool save returned no pool.');
      setPoolForm(null);
      setSelectedPoolId(data.pool.id);
      if (await loadWorkspace())
        notify(
          'success',
          poolForm === 'create' ? 'Pool created.' : 'Pool configuration saved.',
        );
    } catch (error) {
      notify('error', 'Could not save pool: ' + formatSupabaseError(error));
    } finally {
      setBusy(false);
    }
  };

  const changeArchive = async (
    type: 'group' | 'pool',
    id: string,
    archive: boolean,
  ) => {
    if (!isSuperAdmin) return;
    const targetPool = type === 'pool' ? pools.find((pool) => pool.id === id) : null;
    if (type === 'pool' && !targetPool) return notify('error', 'Pool not found.');
    setBusy(true);
    try {
      const { error } =
        type === 'group'
          ? await supabase.rpc('admin_save_dispatch_group', {
              p_admin_session_token: getAdminFinancialSessionToken(),
              p_group_id: id,
              p_changes: {
                archived_at: archive ? new Date().toISOString() : null,
              },
            })
          : await supabase.rpc('admin_save_dispatch_pool', {
              p_admin_session_token: getAdminFinancialSessionToken(),
              p_group_id: targetPool!.group_id,
              p_pool_id: id,
              p_changes: {
                archived_at: archive ? new Date().toISOString() : null,
              },
            });
      if (error) throw error;
      setArchiveTarget(null);
      if (await loadWorkspace())
        notify(
          'success',
          `${type === 'group' ? 'Group' : 'Pool'} ${archive ? 'archived' : 'restored'}.`,
        );
    } catch (error) {
      notify(
        'error',
        'Could not update archive status: ' + formatSupabaseError(error),
      );
    } finally {
      setBusy(false);
    }
  };

  const togglePool = async (pool: DispatchPool) => {
    if (
      !isSuperAdmin ||
      !selectedGroup ||
      selectedGroup.archived_at ||
      pool.archived_at
    )
      return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('admin_save_dispatch_pool', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_group_id: selectedGroup.id,
        p_pool_id: pool.id,
        p_changes: { is_active: !pool.is_active },
      });
      if (error) throw error;
      if (await loadWorkspace())
        notify('success', `Pool ${pool.is_active ? 'disabled' : 'enabled'}.`);
    } catch (error) {
      notify(
        'error',
        'Could not change pool status: ' + formatSupabaseError(error),
      );
    } finally {
      setBusy(false);
    }
  };

  const assignMembers = async () => {
    if (!memberMove) return;
    const { ids, targetGroupId, destination } = memberMove;
    if (
      !groups.some(
        (group) =>
          group.id === targetGroupId && group.is_active && !group.archived_at,
      )
    ) {
      return notify('error', 'The destination group is not active.');
    }
    setBusy(true);
    const succeeded: string[] = [];
    let firstError: string | null = null;
    try {
      const token = getAdminFinancialSessionToken();
      for (const id of ids) {
        try {
          const { data, error } = await supabase.rpc(
            'admin_assign_dispatch_group_member',
            {
              p_admin_session_token: token,
              p_user_id: id,
              p_group_id: targetGroupId,
            },
          );
          if (error) throw error;
          if (
            !(data as { member?: { user_id: string } } | null)?.member?.user_id
          ) {
            throw new Error('Assignment returned no member.');
          }
          succeeded.push(id);
        } catch (error) {
          firstError ??= formatSupabaseError(error);
        }
      }
      setSelectedCurrentMembers((current) =>
        current.filter((id) => !succeeded.includes(id)),
      );
      setSelectedOtherMembers((current) =>
        current.filter((id) => !succeeded.includes(id)),
      );
      setMemberMove(null);
      const refreshed = await loadWorkspace();
      if (firstError)
        notify(
          'error',
          `${succeeded.length} of ${ids.length} moved to ${destination}. Failed: ${firstError}`,
        );
      else if (refreshed)
        notify(
          'success',
          `Moved ${succeeded.length} employee(s) to ${destination}.`,
        );
    } catch (error) {
      notify(
        'error',
        'Could not assign employees: ' + formatSupabaseError(error),
      );
    } finally {
      setBusy(false);
    }
  };

  const manageOrder = async (
    action: OrderAction,
    orderId?: string,
    content?: string,
  ) => {
    if (!isSuperAdmin) return;
    if (!selectedPool || selectedPool.archived_at || selectedGroup?.archived_at)
      return notify(
        'error',
        'The selected pool is no longer available for order management.',
      );
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc(
        'admin_manage_dispatch_orders',
        {
          p_admin_session_token: getAdminFinancialSessionToken(),
          p_pool_id: selectedPool.id,
          p_action: action,
          p_order_id: orderId ?? null,
          p_content: content ?? null,
        },
      );
      if (error) throw error;
      const result = data as { affected?: number } | null;
      if (typeof result?.affected !== 'number')
        throw new Error('Order action returned no result.');
      setEditingId(null);
      setDeleteOrder(null);
      setShowDeleteAll(false);
      setDeleteConfirmInput('');
      const [refreshed, ordersRefreshed] = await Promise.all([
        loadWorkspace(),
        loadOrders(selectedPool.id, page),
      ]);
      if (refreshed && ordersRefreshed)
        notify(
          'success',
          action === 'delete_all'
            ? `Archived ${result.affected} orders in ${selectedPool.pool_name}.`
            : `Order ${action === 'delete' ? 'archived' : action === 'toggle' ? 'status updated' : 'saved'}.`,
        );
    } catch (error) {
      await Promise.all([loadWorkspace(), loadOrders(selectedPool.id, page)]);
      notify('error', 'Order action failed: ' + formatSupabaseError(error));
    } finally {
      setBusy(false);
    }
  };

  const importOrders = async () => {
    const target = groupPools.find(
      (pool) => pool.id === importPoolId && !pool.archived_at,
    );
    if (!isSuperAdmin || !target || selectedGroup?.archived_at)
      return notify('error', 'Select an available target pool first.');
    const contents = bulkInput
      .split(/\n\s*\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (!contents.length)
      return notify(
        'error',
        'Enter at least one order (separate orders with a blank line).',
      );
    setBusy(true);
    setImportProgress({ current: 0, total: contents.length });
    let imported = 0;
    try {
      const token = getAdminFinancialSessionToken();
      for (let index = 0; index < contents.length; index += IMPORT_BATCH_SIZE) {
        const batch = contents.slice(index, index + IMPORT_BATCH_SIZE);
        const { data, error } = await supabase.rpc(
          'admin_manage_dispatch_orders',
          {
            p_admin_session_token: token,
            p_pool_id: target.id,
            p_action: 'import',
            p_contents: batch,
          },
        );
        if (error) throw error;
        if ((data as { affected?: number } | null)?.affected !== batch.length) {
          throw new Error(
            'The imported order count did not match the requested batch. Refresh before retrying.',
          );
        }
        imported += batch.length;
        setImportProgress({ current: imported, total: contents.length });
      }
      setBulkInput('');
      setShowBulkImport(false);
      setSelectedPoolId(target.id);
      notify(
        'success',
        `Imported ${imported} orders into ${target.pool_name}.`,
      );
    } catch (error) {
      // Keep only the unsubmitted batches, so retrying does not duplicate successful ones.
      setBulkInput(contents.slice(imported).join('\n\n'));
      notify(
        'error',
        `Imported ${imported} of ${contents.length}. Remaining orders kept for retry. ${formatSupabaseError(error)}`,
      );
    } finally {
      await Promise.all([
        loadWorkspace(),
        loadOrders(
          imported === contents.length
            ? target.id
            : (selectedPool?.id ?? target.id),
          1,
        ),
      ]);
      setImportProgress(null);
      setBusy(false);
    }
  };

  const visibleGroups = groups.filter(
    (group) =>
      group.group_name.toLowerCase().includes(groupSearch.toLowerCase()) ||
      group.description?.toLowerCase().includes(groupSearch.toLowerCase()),
  );
  const visibleEmployees = employees.filter(
    (employee) =>
      employee.username.toLowerCase().includes(employeeSearch.toLowerCase()) &&
      (employeeAdminFilter === 'all' ||
        employee.created_by === employeeAdminFilter) &&
      (employeeTagFilter === 'all' ||
        employee.tags?.includes(employeeTagFilter)),
  );
  const currentMembers = visibleEmployees.filter(
    (employee) => employee.group_id === selectedGroupId,
  );
  const otherMembers = visibleEmployees.filter(
    (employee) => employee.group_id !== selectedGroupId,
  );
  const tags = [
    ...new Set(employees.flatMap((employee) => employee.tags ?? [])),
  ].sort();
  const canManageOrders =
    isSuperAdmin &&
    !!selectedPool &&
    !selectedPool.archived_at &&
    !selectedGroup?.archived_at;

  return (
    <div className="min-w-0 space-y-4 text-slate-100">
      {notification && (
        <div
          role="alert"
          className={`fixed right-4 top-4 z-[10000] flex max-w-[calc(100vw-2rem)] items-start gap-2 rounded-lg border px-4 py-3 text-sm shadow-2xl break-words ${notification.type === 'error' ? 'border-rose-500 bg-rose-950 text-rose-100' : 'border-emerald-500 bg-emerald-950 text-emerald-100'}`}
        >
          {notification.type === 'error' ? (
            <XCircle className="h-4 w-4 shrink-0" />
          ) : (
            <CheckCircle className="h-4 w-4 shrink-0" />
          )}
          <span>{notification.message}</span>
          <button
            onClick={() => setNotification(null)}
            aria-label="Dismiss notification"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-white">
            Dispatch workspace
          </h2>
          {!isSuperAdmin && (
            <p className="text-xs text-slate-400">
              Configuration and orders are read-only. You can assign your own
              employees to active groups.
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            className={secondaryButton}
            disabled={workspaceLoading || busy}
            onClick={() => {
              void loadWorkspace();
              if (selectedPool) void loadOrders(selectedPool.id, page);
            }}
          >
            Refresh
          </button>
          {isSuperAdmin && (
            <button
              className={primaryButton}
              disabled={busy}
              onClick={() => {
                setGroupDraft({ ...emptyGroupDraft });
                setGroupForm('create');
              }}
            >
              <FolderPlus className="mr-1 inline h-4 w-4" />
              New group
            </button>
          )}
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(190px,1fr)_minmax(0,2fr)]">
            <section className="min-w-0 rounded-xl border border-slate-700 bg-slate-800/70 p-4">
              <h3 className="mb-3 flex items-center gap-2 font-semibold">
                <Layers className="h-4 w-4 text-blue-400" />
                Groups{' '}
                <span className="text-xs text-slate-400">{groups.length}</span>
              </h3>
              <div className="relative mb-3">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  className={`${inputClass} pl-9`}
                  value={groupSearch}
                  onChange={(event) => setGroupSearch(event.target.value)}
                  placeholder="Search groups"
                  aria-label="Search groups"
                />
              </div>
              <div className="max-h-[370px] space-y-2 overflow-y-auto">
                {visibleGroups.map((group) => (
                  <button
                    key={group.id}
                    className={`w-full min-w-0 rounded-lg border p-3 text-left text-sm ${selectedGroupId === group.id ? 'border-blue-500 bg-blue-600/20' : 'border-slate-700 bg-slate-900/30 hover:bg-slate-700/50'}`}
                    onClick={() => switchGroup(group.id)}
                  >
                    <span className="block break-words font-medium text-white">
                      {group.group_name}{' '}
                      {group.is_default && (
                        <span className="text-[10px] text-amber-300">
                          Default
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block text-xs text-slate-400">
                      {group.archived_at
                        ? 'Archived'
                        : group.is_active
                          ? 'Active'
                          : 'Inactive'}{' '}
                      · {group.member_count} members · {group.order_count}{' '}
                      orders
                    </span>
                  </button>
                ))}
                {!visibleGroups.length && (
                  <p className="py-6 text-center text-sm text-slate-400">
                    {workspaceLoading ? 'Loading groups…' : 'No groups found.'}
                  </p>
                )}
              </div>
            </section>

            <section className="min-w-0 rounded-xl border border-slate-700 bg-slate-800/70 p-4">
              {selectedGroup ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="break-words text-lg font-semibold text-white">
                        {selectedGroup.group_name}
                      </h3>
                      <p className="mt-1 break-words text-xs text-slate-400">
                        {selectedGroup.description || 'No description'} ·{' '}
                        {selectedGroup.member_count} members
                      </p>
                    </div>
                    {isSuperAdmin && (
                      <button
                        className={secondaryButton}
                        disabled={busy || !!selectedGroup.archived_at}
                        onClick={() => {
                          setGroupDraft({
                            group_name: selectedGroup.group_name,
                            description: selectedGroup.description ?? '',
                            is_active: selectedGroup.is_active,
                            pool_selection_mode:
                              selectedGroup.pool_selection_mode,
                          });
                          setGroupForm('edit');
                        }}
                      >
                        <Settings className="mr-1 inline h-4 w-4" />
                        Edit group
                      </button>
                    )}
                  </div>
                  <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900/40 p-3">
                    <label
                      htmlFor="pool-selection-mode"
                      className="block text-sm font-medium"
                    >
                      Pool selection mode
                    </label>
                    <p className="mb-2 text-xs text-slate-400">
                      Base uses only the default pool. Random selects among
                      active pools with available orders.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        id="pool-selection-mode"
                        className={`${inputClass} flex-1`}
                        value={modeDraft}
                        disabled={
                          !isSuperAdmin || !!selectedGroup.archived_at || busy
                        }
                        onChange={(event) =>
                          setModeDraft(event.target.value as 'base' | 'random')
                        }
                      >
                        <option value="base">Base pool only</option>
                        <option value="random">Random eligible pool</option>
                      </select>
                      {isSuperAdmin && (
                        <button
                          className={primaryButton}
                          disabled={
                            busy ||
                            !!selectedGroup.archived_at ||
                            modeDraft === selectedGroup.pool_selection_mode
                          }
                          onClick={() => void saveSelectionMode()}
                        >
                          <Save className="mr-1 inline h-4 w-4" />
                          Save
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span
                      className={`rounded-full px-2 py-1 ${selectedGroup.archived_at ? 'bg-rose-500/20 text-rose-300' : selectedGroup.is_active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700 text-slate-300'}`}
                    >
                      {selectedGroup.archived_at
                        ? 'Archived'
                        : selectedGroup.is_active
                          ? 'Active'
                          : 'Inactive'}
                    </span>
                    {isSuperAdmin &&
                      (selectedGroup.archived_at ? (
                        <button
                          className={secondaryButton}
                          disabled={busy}
                          onClick={() =>
                            void changeArchive('group', selectedGroup.id, false)
                          }
                        >
                          Restore group
                        </button>
                      ) : (
                        !selectedGroup.is_default && (
                          <button
                            className="text-rose-400 hover:text-rose-300 disabled:opacity-50"
                            disabled={busy}
                            onClick={() =>
                              setArchiveTarget({
                                type: 'group',
                                id: selectedGroup.id,
                                name: selectedGroup.group_name,
                              })
                            }
                          >
                            Archive group
                          </button>
                        )
                      ))}
                  </div>
                </>
              ) : (
                <p className="py-12 text-center text-sm text-slate-400">
                  Select a group to manage its pools and members.
                </p>
              )}
            </section>
          </div>

          {selectedGroup && (
            <>
              <section className="min-w-0 rounded-xl border border-slate-700 bg-slate-800/70 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="flex items-center gap-2 font-semibold">
                      <Users className="h-4 w-4 text-emerald-400" />
                      Members
                    </h3>
                    <p className="text-xs text-slate-400">
                      Assign employees to this group or move them to the active
                      default group.
                    </p>
                  </div>
                </div>
                <div className="mb-3 flex flex-wrap gap-2">
                  <input
                    className={`${inputClass} min-w-[160px] flex-1`}
                    placeholder="Search employees"
                    aria-label="Search employees"
                    value={employeeSearch}
                    onChange={(event) => setEmployeeSearch(event.target.value)}
                  />
                  {isSuperAdmin && (
                    <select
                      className={`${inputClass} w-auto max-w-full`}
                      value={employeeAdminFilter}
                      onChange={(event) => {
                        setEmployeeAdminFilter(event.target.value);
                        setSelectedCurrentMembers([]);
                        setSelectedOtherMembers([]);
                      }}
                      aria-label="Filter employees by admin"
                    >
                      <option value="all">All admins</option>
                      {adminNames.map((owner) => (
                        <option key={owner.id} value={owner.id}>
                          {owner.username}
                        </option>
                      ))}
                    </select>
                  )}
                  {tags.length > 0 && (
                    <select
                      className={`${inputClass} w-auto max-w-full`}
                      value={employeeTagFilter}
                      onChange={(event) => {
                        setEmployeeTagFilter(event.target.value);
                        setSelectedCurrentMembers([]);
                        setSelectedOtherMembers([]);
                      }}
                      aria-label="Filter employees by tag"
                    >
                      <option value="all">All tags</option>
                      {tags.map((tag) => (
                        <option key={tag} value={tag}>
                          {tag}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="min-w-0 rounded-lg border border-slate-700 bg-slate-900/30 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-sm font-medium text-emerald-300">
                        In group ({currentMembers.length})
                      </h4>
                      {!selectedGroup.is_default && (
                        <button
                          className={secondaryButton}
                          disabled={
                            !selectedCurrentMembers.length ||
                            !defaultGroup ||
                            busy
                          }
                          title={
                            !defaultGroup
                              ? 'No active default group available'
                              : undefined
                          }
                          onClick={() =>
                            defaultGroup &&
                            setMemberMove({
                              ids: selectedCurrentMembers,
                              targetGroupId: defaultGroup.id,
                              destination: defaultGroup.group_name,
                            })
                          }
                        >
                          Move to default ({selectedCurrentMembers.length})
                        </button>
                      )}
                    </div>
                    <div className="max-h-64 space-y-1 overflow-y-auto">
                      {currentMembers.map((employee) => (
                        <label
                          key={employee.id}
                          className="flex min-w-0 cursor-pointer items-start gap-2 rounded-lg p-2 text-sm hover:bg-slate-700/50"
                        >
                          <input
                            type="checkbox"
                            className="mt-1 accent-blue-500"
                            checked={selectedCurrentMembers.includes(
                              employee.id,
                            )}
                            onChange={() =>
                              setSelectedCurrentMembers((current) =>
                                current.includes(employee.id)
                                  ? current.filter((id) => id !== employee.id)
                                  : [...current, employee.id],
                              )
                            }
                          />
                          <span className="min-w-0 break-words">
                            {employee.username}
                            {employee.remarks && (
                              <span className="block text-xs text-slate-400">
                                {employee.remarks}
                              </span>
                            )}
                          </span>
                        </label>
                      ))}
                      {!currentMembers.length && (
                        <p className="py-5 text-center text-xs text-slate-400">
                          No matching members.
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="min-w-0 rounded-lg border border-slate-700 bg-slate-900/30 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-sm font-medium text-amber-300">
                        Other / unassigned ({otherMembers.length})
                      </h4>
                      <button
                        className={primaryButton}
                        disabled={
                          !selectedOtherMembers.length ||
                          !selectedGroup.is_active ||
                          !!selectedGroup.archived_at ||
                          busy
                        }
                        onClick={() =>
                          setMemberMove({
                            ids: selectedOtherMembers,
                            targetGroupId: selectedGroup.id,
                            destination: selectedGroup.group_name,
                          })
                        }
                      >
                        Move here ({selectedOtherMembers.length})
                      </button>
                    </div>
                    <div className="max-h-64 space-y-1 overflow-y-auto">
                      {otherMembers.map((employee) => (
                        <label
                          key={employee.id}
                          className="flex min-w-0 cursor-pointer items-start gap-2 rounded-lg p-2 text-sm hover:bg-slate-700/50"
                        >
                          <input
                            type="checkbox"
                            className="mt-1 accent-blue-500"
                            checked={selectedOtherMembers.includes(employee.id)}
                            onChange={() =>
                              setSelectedOtherMembers((current) =>
                                current.includes(employee.id)
                                  ? current.filter((id) => id !== employee.id)
                                  : [...current, employee.id],
                              )
                            }
                          />
                          <span className="min-w-0 break-words">
                            {employee.username}
                            <span className="block text-xs text-slate-400">
                              {groups.find(
                                (group) => group.id === employee.group_id,
                              )?.group_name ?? 'No group assigned'}
                            </span>
                            {employee.remarks && (
                              <span className="block text-xs text-slate-400">
                                {employee.remarks}
                              </span>
                            )}
                          </span>
                        </label>
                      ))}
                      {!otherMembers.length && (
                        <p className="py-5 text-center text-xs text-slate-400">
                          No matching employees.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                {!defaultGroup && !selectedGroup.is_default && (
                  <p className="mt-2 text-xs text-amber-300">
                    Moving members out requires an active default group.
                  </p>
                )}
              </section>

              <section className="min-w-0 rounded-xl border border-slate-700 bg-slate-800/70 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="flex items-center gap-2 font-semibold">
                      <Layers className="h-4 w-4 text-blue-400" />
                      Order pools
                    </h3>
                    <p className="text-xs text-slate-400">
                      Each pool has independent dispatch timing, order mode and
                      success rate.
                    </p>
                  </div>
                  {isSuperAdmin && (
                    <button
                      className={primaryButton}
                      disabled={busy || !!selectedGroup.archived_at}
                      onClick={() => {
                        setPoolDraft({ ...emptyPoolDraft });
                        setPoolForm('create');
                      }}
                    >
                      <Plus className="mr-1 inline h-4 w-4" />
                      New pool
                    </button>
                  )}
                </div>
                <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                  {groupPools.map((pool) => (
                    <div
                      key={pool.id}
                      className={`min-w-0 rounded-lg border p-3 ${selectedPool?.id === pool.id ? 'border-blue-500 bg-blue-500/10' : 'border-slate-700 bg-slate-900/40'}`}
                    >
                      <button
                        className="w-full min-w-0 text-left"
                        onClick={() => switchPool(pool.id)}
                      >
                        <span className="block break-words text-sm font-semibold text-white">
                          {pool.pool_name}{' '}
                          {pool.is_base && (
                            <span className="text-[10px] text-amber-300">
                              Base
                            </span>
                          )}
                        </span>
                        <span className="mt-1 block text-xs text-slate-400">
                          {pool.archived_at
                            ? 'Archived'
                            : pool.is_active
                              ? 'Active'
                              : 'Disabled'}{' '}
                          · {pool.order_count} orders
                        </span>
                        <span className="mt-1 block text-xs text-slate-400">
                          {pool.dispatch_interval_min}–
                          {pool.dispatch_interval_max}s ·{' '}
                          {pool.session_timeout_minutes}m timeout ·{' '}
                          {pool.dispatch_order_mode} ·{' '}
                          {pool.dispatch_success_rate}% success
                        </span>
                      </button>
                      {isSuperAdmin && !selectedGroup.archived_at && (
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-700 pt-2 text-xs">
                          {!pool.archived_at ? (
                            <>
                              <button
                                className="text-blue-300 hover:text-white disabled:opacity-50"
                                disabled={busy}
                                onClick={() => {
                                  switchPool(pool.id);
                                  setPoolDraft(poolToDraft(pool));
                                  setPoolForm('edit');
                                }}
                              >
                                Edit config
                              </button>
                              <button
                                className="text-amber-300 hover:text-white disabled:opacity-50"
                                disabled={busy}
                                onClick={() => void togglePool(pool)}
                              >
                                {pool.is_active ? 'Disable' : 'Enable'}
                              </button>
                              {!pool.is_base && (
                                <button
                                  className="text-rose-400 hover:text-white disabled:opacity-50"
                                  disabled={busy}
                                  onClick={() =>
                                    setArchiveTarget({
                                      type: 'pool',
                                      id: pool.id,
                                      name: pool.pool_name,
                                    })
                                  }
                                >
                                  Archive
                                </button>
                              )}
                            </>
                          ) : (
                            <button
                              className="text-blue-300 hover:text-white disabled:opacity-50"
                              disabled={busy}
                              onClick={() =>
                                void changeArchive('pool', pool.id, false)
                              }
                            >
                              Restore
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {!groupPools.length && (
                    <p className="py-8 text-center text-sm text-slate-400">
                      No pools available. Every group should have a base pool
                      after migration.
                    </p>
                  )}
                </div>
              </section>
            </>
          )}
        </div>

        <aside
          className="min-w-0 rounded-xl border border-slate-700 bg-slate-800/70 xl:w-[320px]"
          aria-label="Orders management"
        >
          <div className="border-b border-slate-700 p-4">
            <h3 className="flex items-center gap-2 font-semibold">
              <PackageSearch className="h-4 w-4 text-blue-400" />
              Orders Management
            </h3>
            <p className="mt-1 break-words text-xs text-slate-400">
              {selectedGroup?.group_name ?? 'Select a group'} /{' '}
              {selectedPool?.pool_name ?? 'Select a pool'}
            </p>
            {selectedPool && (
              <>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    className={`${inputClass} flex-1`}
                    aria-label="Filter orders by status"
                    value={orderFilter}
                    onChange={(event) =>
                      setOrderFilter(
                        event.target.value as 'all' | 'active' | 'inactive',
                      )
                    }
                  >
                    <option value="all">All orders</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                  <span className="text-xs text-slate-400">
                    {totalCount} shown
                  </span>
                </div>
                {isSuperAdmin && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className={primaryButton}
                      disabled={!canManageOrders || busy}
                      onClick={() => {
                        setImportPoolId(selectedPool.id);
                        setBulkInput('');
                        setShowBulkImport(true);
                      }}
                    >
                      <Upload className="mr-1 inline h-4 w-4" />
                      Import
                    </button>
                    <button
                      className={secondaryButton}
                      disabled={
                        !canManageOrders ||
                        busy ||
                        selectedPool.order_count === 0
                      }
                      onClick={() => {
                        setDeleteConfirmInput('');
                        setShowDeleteAll(true);
                      }}
                    >
                      <Trash2 className="mr-1 inline h-4 w-4" />
                      Delete all
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
          {showBulkImport && selectedPool && isSuperAdmin && (
            <div className="space-y-2 border-b border-slate-700 bg-slate-900/40 p-4">
              <label
                className="block text-xs font-medium text-slate-300"
                htmlFor="import-pool"
              >
                Target pool (explicit)
              </label>
              <select
                id="import-pool"
                className={inputClass}
                value={importPoolId}
                disabled={busy}
                onChange={(event) => setImportPoolId(event.target.value)}
              >
                {groupPools
                  .filter((pool) => !pool.archived_at)
                  .map((pool) => (
                    <option key={pool.id} value={pool.id}>
                      {pool.pool_name}
                    </option>
                  ))}
              </select>
              <label
                className="block text-xs text-slate-300"
                htmlFor="bulk-orders"
              >
                Orders separated by a blank line
              </label>
              <textarea
                id="bulk-orders"
                className={`${inputClass} min-h-32 resize-y font-mono`}
                placeholder={'First order\n\nSecond order'}
                value={bulkInput}
                disabled={busy}
                onChange={(event) => setBulkInput(event.target.value)}
              />
              <p className="text-xs text-slate-400">
                Up to 2,000 per request; larger imports are sent in batches.
              </p>
              {importProgress && (
                <div className="text-xs text-blue-300" role="status">
                  Imported {importProgress.current} / {importProgress.total}
                  <div className="mt-1 h-2 overflow-hidden rounded bg-slate-700">
                    <div
                      className="h-full bg-blue-500"
                      style={{
                        width: `${Math.round((importProgress.current / importProgress.total) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <button
                  className={secondaryButton}
                  disabled={busy}
                  onClick={() => setShowBulkImport(false)}
                >
                  Cancel
                </button>
                <button
                  className={primaryButton}
                  disabled={busy || !bulkInput.trim() || !importPoolId}
                  onClick={() => void importOrders()}
                >
                  Import orders
                </button>
              </div>
            </div>
          )}
          <div className="max-h-[740px] min-w-0 space-y-2 overflow-y-auto p-3">
            {ordersLoading && (
              <p
                className="py-3 text-center text-xs text-slate-400"
                role="status"
              >
                Loading orders…
              </p>
            )}
            {!selectedPool ? (
              <p className="py-12 text-center text-sm text-slate-400">
                Select a pool to view orders.
              </p>
            ) : ordersLoading ||
              ordersPoolId !== selectedPool.id ? null : !orders.length ? (
              <p className="py-12 text-center text-sm text-slate-400">
                No {orderFilter === 'all' ? '' : `${orderFilter} `}orders in
                this pool.
              </p>
            ) : (
              orders.map((order, index) => (
                <article
                  key={order.id}
                  className="min-w-0 rounded-lg border border-slate-700 bg-slate-900/40 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
                    <span className="text-slate-400">
                      #{(page - 1) * PAGE_SIZE + index + 1} ·{' '}
                      {new Date(order.created_at).toLocaleString()}
                    </span>
                    <span
                      className={
                        order.is_active ? 'text-emerald-300' : 'text-slate-400'
                      }
                    >
                      {order.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  {editingId === order.id ? (
                    <>
                      <textarea
                        className={`${inputClass} mt-2 min-h-28 resize-y font-mono`}
                        value={editContent}
                        onChange={(event) => setEditContent(event.target.value)}
                        aria-label="Edit order content"
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          className={primaryButton}
                          disabled={busy || !editContent.trim()}
                          onClick={() =>
                            void manageOrder(
                              'edit',
                              order.id,
                              editContent.trim(),
                            )
                          }
                        >
                          <Save className="mr-1 inline h-3 w-3" />
                          Save
                        </button>
                        <button
                          className={secondaryButton}
                          disabled={busy}
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="mt-2 whitespace-pre-wrap break-all font-mono text-xs text-slate-100">
                        {order.order_content}
                      </p>
                      {canManageOrders && (
                        <div className="mt-2 flex flex-wrap gap-3 border-t border-slate-700 pt-2 text-xs">
                          <button
                            className="text-blue-300 hover:text-white disabled:opacity-50"
                            disabled={busy}
                            onClick={() => {
                              setEditingId(order.id);
                              setEditContent(order.order_content);
                            }}
                          >
                            <Edit2 className="mr-1 inline h-3 w-3" />
                            Edit
                          </button>
                          <button
                            className="text-amber-300 hover:text-white disabled:opacity-50"
                            disabled={busy}
                            onClick={() => void manageOrder('toggle', order.id)}
                          >
                            {order.is_active ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            className="text-rose-400 hover:text-white disabled:opacity-50"
                            disabled={busy}
                            onClick={() => setDeleteOrder(order)}
                          >
                            <Trash2 className="mr-1 inline h-3 w-3" />
                            Delete
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </article>
              ))
            )}
          </div>
          {selectedPool && totalCount > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-700 p-3 text-xs">
              <span className="text-slate-400">
                {(page - 1) * PAGE_SIZE + 1}–
                {Math.min(page * PAGE_SIZE, totalCount)} of {totalCount} · page{' '}
                {page}/{totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  className={secondaryButton}
                  disabled={page <= 1 || ordersLoading}
                  onClick={() => void loadOrders(selectedPool.id, page - 1)}
                >
                  Previous
                </button>
                <button
                  className={secondaryButton}
                  disabled={page >= totalPages || ordersLoading}
                  onClick={() => void loadOrders(selectedPool.id, page + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>

      {groupForm &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-label={
                groupForm === 'create' ? 'Create group' : 'Edit group'
              }
              className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-600 bg-slate-800 p-5 shadow-2xl"
            >
              <h3 className="mb-4 text-lg font-semibold">
                {groupForm === 'create'
                  ? 'Create dispatch group'
                  : 'Edit dispatch group'}
              </h3>
              <div className="space-y-3">
                <label className="block text-sm">
                  Group name *
                  <input
                    className={`${inputClass} mt-1`}
                    value={groupDraft.group_name}
                    onChange={(event) =>
                      setGroupDraft({
                        ...groupDraft,
                        group_name: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="block text-sm">
                  Description
                  <textarea
                    className={`${inputClass} mt-1 min-h-20`}
                    value={groupDraft.description}
                    onChange={(event) =>
                      setGroupDraft({
                        ...groupDraft,
                        description: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="block text-sm">
                  Pool selection mode
                  <select
                    className={`${inputClass} mt-1`}
                    value={groupDraft.pool_selection_mode}
                    onChange={(event) =>
                      setGroupDraft({
                        ...groupDraft,
                        pool_selection_mode: event.target.value as
                          | 'base'
                          | 'random',
                      })
                    }
                  >
                    <option value="base">Base pool only</option>
                    <option value="random">Random eligible pool</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={groupDraft.is_active}
                    onChange={(event) =>
                      setGroupDraft({
                        ...groupDraft,
                        is_active: event.target.checked,
                      })
                    }
                  />
                  Group active
                </label>
                {groupForm === 'create' && (
                  <p className="text-xs text-slate-400">
                    A base pool is created automatically, with its own default
                    configuration. Configure it after creating the group.
                  </p>
                )}
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  className={secondaryButton}
                  disabled={busy}
                  onClick={() => setGroupForm(null)}
                >
                  Cancel
                </button>
                <button
                  className={primaryButton}
                  disabled={busy || !groupDraft.group_name.trim()}
                  onClick={() => void saveGroup()}
                >
                  {busy ? 'Saving…' : 'Save group'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {poolForm &&
        selectedGroup &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-label={poolForm === 'create' ? 'Create pool' : 'Edit pool'}
              className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-600 bg-slate-800 p-5 shadow-2xl"
            >
              <h3 className="mb-1 text-lg font-semibold">
                {poolForm === 'create'
                  ? 'Create order pool'
                  : `Configure ${selectedPool?.pool_name}`}
              </h3>
              <p className="mb-4 text-xs text-slate-400">
                {selectedGroup.group_name} · independent pool settings
              </p>
              <div className="space-y-3">
                <label className="block text-sm">
                  Pool name *
                  <input
                    className={`${inputClass} mt-1`}
                    value={poolDraft.pool_name}
                    onChange={(event) =>
                      setPoolDraft({
                        ...poolDraft,
                        pool_name: event.target.value,
                      })
                    }
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="min-w-0 text-sm">
                    Min interval (seconds)
                    <input
                      type="number"
                      min="1"
                      max="3000"
                      className={`${inputClass} mt-1`}
                      value={poolDraft.dispatch_interval_min}
                      onChange={(event) =>
                        setPoolDraft({
                          ...poolDraft,
                          dispatch_interval_min: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="min-w-0 text-sm">
                    Max interval (seconds)
                    <input
                      type="number"
                      min="1"
                      max="3000"
                      className={`${inputClass} mt-1`}
                      value={poolDraft.dispatch_interval_max}
                      onChange={(event) =>
                        setPoolDraft({
                          ...poolDraft,
                          dispatch_interval_max: event.target.value,
                        })
                      }
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="min-w-0 text-sm">
                    Session timeout (minutes)
                    <input
                      type="number"
                      min="1"
                      max="60"
                      className={`${inputClass} mt-1`}
                      value={poolDraft.session_timeout_minutes}
                      onChange={(event) =>
                        setPoolDraft({
                          ...poolDraft,
                          session_timeout_minutes: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="min-w-0 text-sm">
                    Success rate (%)
                    <input
                      type="number"
                      min="0"
                      max="100"
                      className={`${inputClass} mt-1`}
                      value={poolDraft.dispatch_success_rate}
                      onChange={(event) =>
                        setPoolDraft({
                          ...poolDraft,
                          dispatch_success_rate: event.target.value,
                        })
                      }
                    />
                  </label>
                </div>
                <label className="block text-sm">
                  Order dispatch mode
                  <select
                    className={`${inputClass} mt-1`}
                    value={poolDraft.dispatch_order_mode}
                    onChange={(event) =>
                      setPoolDraft({
                        ...poolDraft,
                        dispatch_order_mode: event.target.value as
                          | 'random'
                          | 'sequential',
                      })
                    }
                  >
                    <option value="random">Random orders</option>
                    <option value="sequential">Sequential orders</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={poolDraft.is_active}
                    onChange={(event) =>
                      setPoolDraft({
                        ...poolDraft,
                        is_active: event.target.checked,
                      })
                    }
                  />
                  Pool active
                </label>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  className={secondaryButton}
                  disabled={busy}
                  onClick={() => setPoolForm(null)}
                >
                  Cancel
                </button>
                <button
                  className={primaryButton}
                  disabled={busy}
                  onClick={() => void savePool()}
                >
                  {busy ? 'Saving…' : 'Save pool'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {archiveTarget &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Confirm archive"
              className="w-full max-w-md rounded-xl border border-rose-500 bg-slate-800 p-5"
            >
              <h3 className="mb-2 text-lg font-semibold">
                Archive {archiveTarget.type}?
              </h3>
              <p className="break-words text-sm text-slate-300">
                Archive {archiveTarget.name}? It will no longer be available for
                dispatch. Existing orders and history are preserved.
                {archiveTarget.type === 'group' &&
                  ' Members in this group will stop receiving orders until reassigned or the group is restored.'}
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  className={secondaryButton}
                  disabled={busy}
                  onClick={() => setArchiveTarget(null)}
                >
                  Cancel
                </button>
                <button
                  className="rounded-lg bg-rose-600 px-3 py-2 text-sm text-white disabled:opacity-50"
                  disabled={busy}
                  onClick={() =>
                    void changeArchive(
                      archiveTarget.type,
                      archiveTarget.id,
                      true,
                    )
                  }
                >
                  Archive
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {memberMove &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Confirm member move"
              className="w-full max-w-md rounded-xl border border-emerald-500 bg-slate-800 p-5"
            >
              <h3 className="mb-2 text-lg font-semibold">Move employees?</h3>
              <p className="break-words text-sm text-slate-300">
                Move {memberMove.ids.length} employee(s) to{' '}
                {memberMove.destination}? Their existing group assignment will
                be replaced; nobody will be left unassigned.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  className={secondaryButton}
                  disabled={busy}
                  onClick={() => setMemberMove(null)}
                >
                  Cancel
                </button>
                <button
                  className={primaryButton}
                  disabled={busy}
                  onClick={() => void assignMembers()}
                >
                  {busy ? 'Moving…' : 'Confirm move'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {deleteOrder &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Confirm order deletion"
              className="w-full max-w-md rounded-xl border border-rose-500 bg-slate-800 p-5"
            >
              <h3 className="mb-2 text-lg font-semibold">Delete order?</h3>
              <p className="break-all text-sm text-slate-300">
                {deleteOrder.order_content.slice(0, 200)}
              </p>
              <p className="mt-2 text-xs text-slate-400">
                This order will be archived; its assignment history is retained.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  className={secondaryButton}
                  disabled={busy}
                  onClick={() => setDeleteOrder(null)}
                >
                  Cancel
                </button>
                <button
                  className="rounded-lg bg-rose-600 px-3 py-2 text-sm text-white disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void manageOrder('delete', deleteOrder.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {showDeleteAll &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Confirm delete all orders"
              className="w-full max-w-md rounded-xl border border-rose-500 bg-slate-800 p-5"
            >
              <h3 className="mb-2 text-lg font-semibold">
                Delete all orders in {selectedPool?.pool_name}?
              </h3>
              <p className="text-sm text-slate-300">
                All {selectedPool?.order_count ?? 0} non-archived orders in this
                pool (including those hidden by the current status filter) will
                be archived. Other pools are not affected.
              </p>
              <label className="mt-4 block text-sm">
                Type DELETE ALL to confirm
                <input
                  className={`${inputClass} mt-1`}
                  value={deleteConfirmInput}
                  onChange={(event) =>
                    setDeleteConfirmInput(event.target.value)
                  }
                />
              </label>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  className={secondaryButton}
                  disabled={busy}
                  onClick={() => setShowDeleteAll(false)}
                >
                  Cancel
                </button>
                <button
                  className="rounded-lg bg-rose-600 px-3 py-2 text-sm text-white disabled:opacity-50"
                  disabled={busy || deleteConfirmInput !== 'DELETE ALL'}
                  onClick={() => void manageOrder('delete_all')}
                >
                  Delete all
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
