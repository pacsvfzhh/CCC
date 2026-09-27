import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle,
  ChevronDown,
  Edit2,
  FolderPlus,
  Layers,
  PackageSearch,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Trash2,
  Upload,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { getAdminFinancialSessionToken, getStoredAuth } from '../../lib/auth';
import { formatSupabaseError, supabase } from '../../lib/supabase';
import { useCurrencyUnit } from '../../lib/useCurrencyUnit';

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
  pool_selection_mode: 'base' | 'random' | 'weighted';
  session_timeout_minutes: number;
  submit_wait_min_seconds: number;
  submit_wait_max_seconds: number;
  commission_rate: number;
  grab_success_rate: number;
  dispatch_success_rate: number;
  withdrawal_amount_threshold: number;
  withdrawal_orders_threshold: number;
  withdrawal_condition_mode: 'OR' | 'AND' | 'amount_only' | 'days_only';
  is_default: boolean;
  is_active: boolean;
  archived_at: string | null;
  member_count: number;
  order_count: number;
}

const withdrawalModeLabels: Record<DispatchGroup['withdrawal_condition_mode'], string> = {
  OR: '餘額或訂單數任一達標',
  AND: '餘額與訂單數均須達標',
  amount_only: '僅檢查餘額是否達標',
  days_only: '僅檢查訂單數是否達標',
};

const poolSelectionOptions = [
  {
    value: 'base',
    label: '固定基本池',
    description: '僅從基本池派單',
    activeClass: 'border-blue-200 bg-blue-600 text-white ring-2 ring-blue-200 ring-offset-2 ring-offset-slate-900 shadow-lg shadow-blue-950/60',
    inactiveClass: 'border-slate-700/60 bg-slate-950/30 text-blue-200/60 hover:border-blue-400/40 hover:bg-blue-500/10',
  },
  {
    value: 'random',
    label: '隨機選擇訂單池',
    description: '可派單池等機率抽取',
    activeClass: 'border-violet-200 bg-violet-600 text-white ring-2 ring-violet-200 ring-offset-2 ring-offset-slate-900 shadow-lg shadow-violet-950/60',
    inactiveClass: 'border-slate-700/60 bg-slate-950/30 text-violet-200/60 hover:border-violet-400/40 hover:bg-violet-500/10',
  },
  {
    value: 'weighted',
    label: '按訂單池設定概率',
    description: '依各池百分比抽取',
    activeClass: 'border-amber-200 bg-amber-600 text-white ring-2 ring-amber-200 ring-offset-2 ring-offset-slate-900 shadow-lg shadow-amber-950/60',
    inactiveClass: 'border-slate-700/60 bg-slate-950/30 text-amber-200/60 hover:border-amber-400/40 hover:bg-amber-500/10',
  },
] as const;

const withdrawalModeOptions = ['OR', 'AND', 'amount_only', 'days_only'] as const;
function WithdrawalConditionPicker({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: DispatchGroup['withdrawal_condition_mode'];
  disabled: boolean;
  onChange: (value: DispatchGroup['withdrawal_condition_mode']) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{
    bottom: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  const isOpen = menuPosition !== null;
  const positionMenu = useCallback(() => {
    const rect = triggerRef.current!.getBoundingClientRect();
    const width = Math.min(rect.width, window.innerWidth - 24);
    setMenuPosition({
      bottom: window.innerHeight - rect.top,
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      width,
      maxHeight: Math.max(40, Math.min(184, rect.top - 12)),
    });
  }, []);

  useEffect(() => {
    if (isOpen) menuRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!triggerRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) {
        setMenuPosition(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuPosition(null);
        triggerRef.current?.focus();
      }
    };
    const closeOnFocusOutside = (event: FocusEvent) => {
      if (!triggerRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) {
        setMenuPosition(null);
      }
    };
    const reposition = () => positionMenu();
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('focusin', closeOnFocusOutside);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('focusin', closeOnFocusOutside);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [isOpen, positionMenu]);

  return (
    <div className="space-y-2">
      <span id={`${id}-label`} className="block text-sm font-medium text-amber-100">提款條件組合</span>
      <p id={`${id}-hint`} className="text-xs text-amber-200/80">點擊下方按鈕向上展開選單，再次點擊可收起。</p>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-labelledby={`${id}-label ${id}`}
        aria-describedby={`${id}-hint`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={menuPosition ? `${id}-menu` : undefined}
        disabled={disabled}
        onClick={() => menuPosition ? setMenuPosition(null) : positionMenu()}
        className={`group flex h-11 w-full max-w-[420px] items-center gap-2.5 border border-amber-500/70 bg-slate-800 px-3 text-left text-amber-50 shadow-[0_8px_20px_rgba(15,23,42,0.3)] transition-colors hover:border-amber-300 hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-55 ${isOpen ? 'rounded-b-xl border-t-0' : 'rounded-xl'}`}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-400/20 text-amber-300"><CheckCircle className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{withdrawalModeLabels[value]}</span>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-400 text-slate-900 group-hover:bg-amber-300">
          <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {menuPosition && createPortal(
        <div
          ref={menuRef}
          id={`${id}-menu`}
          role="listbox"
          aria-labelledby={`${id}-label`}
          className="fixed z-[10010] overflow-y-auto rounded-t-xl border border-b-0 border-amber-500/70 bg-slate-900 p-1.5 text-amber-50 shadow-[0_-12px_28px_rgba(15,23,42,0.32)]"
          style={menuPosition}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            const options = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
            const index = options.indexOf(document.activeElement as HTMLButtonElement);
            options[(index + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length]?.focus();
          }}
        >
          {withdrawalModeOptions.map((mode) => (
            <button
              key={mode}
              type="button"
              role="option"
              aria-selected={value === mode}
              className={`mb-0.5 flex min-h-9 w-full items-center gap-2 rounded-md px-3 py-1.5 text-left transition-colors last:mb-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${value === mode ? 'bg-amber-400 text-slate-950' : 'text-amber-50 hover:bg-slate-700 hover:text-amber-200'}`}
              onClick={() => {
                onChange(mode);
                setMenuPosition(null);
                triggerRef.current?.focus();
              }}
            >
              <span className="min-w-0 flex-1 text-sm font-medium">{withdrawalModeLabels[mode]}</span>
              {value === mode && <CheckCircle className="h-4 w-4 shrink-0 text-slate-900" />}
            </button>
          ))}
        </div>, document.body,
      )}
    </div>
  );
}

interface DispatchPool {
  id: string;
  group_id: string;
  pool_name: string;
  is_base: boolean;
  is_active: boolean;
  dispatch_interval_min: number;
  dispatch_interval_max: number;
  dispatch_order_mode: 'random' | 'sequential';
  trigger_probability: number;
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
> & {
  description: string;
  session_timeout_minutes: string;
  submit_wait_min_seconds: string;
  submit_wait_max_seconds: string;
  commission_rate: string;
  grab_success_rate: string;
  dispatch_success_rate: string;
  withdrawal_amount_threshold: string;
  withdrawal_orders_threshold: string;
  withdrawal_condition_mode: DispatchGroup['withdrawal_condition_mode'];
};
type PoolDraft = Pick<
  DispatchPool,
  'pool_name' | 'is_active' | 'dispatch_order_mode'
> & {
  dispatch_interval_min: string;
  dispatch_interval_max: string;
};

type OrderAction = 'edit' | 'toggle' | 'delete' | 'delete_all';

const emptyGroupDraft: GroupDraft = {
  group_name: '',
  description: '',
  pool_selection_mode: 'base',
  is_active: true,
  session_timeout_minutes: '10',
  submit_wait_min_seconds: '5',
  submit_wait_max_seconds: '20',
  commission_rate: '0.001',
  grab_success_rate: '100',
  dispatch_success_rate: '100',
  withdrawal_amount_threshold: '100',
  withdrawal_orders_threshold: '1000',
  withdrawal_condition_mode: 'OR',
};
const emptyPoolDraft: PoolDraft = {
  pool_name: '',
  is_active: true,
  dispatch_interval_min: '30',
  dispatch_interval_max: '120',
  dispatch_order_mode: 'random',
};

function groupDisplayName(group: DispatchGroup): string {
  return group.is_default && group.group_name === 'Default Group'
    ? '預設分組'
    : group.group_name;
}

function poolDisplayName(pool: DispatchPool): string {
  return pool.is_base && pool.pool_name === 'Base' ? '基本池' : pool.pool_name;
}

function groupDisplayDescription(group: DispatchGroup): string {
  return group.is_default && group.description === '默认分组 - 未分配到其他组的员工使用此组'
    ? '預設分組－未分配至其他分組的員工使用此組'
    : group.description || '暫無說明';
}

function poolToDraft(pool: DispatchPool): PoolDraft {
  return {
    pool_name: poolDisplayName(pool),
    is_active: pool.is_active,
    dispatch_interval_min: String(pool.dispatch_interval_min),
    dispatch_interval_max: String(pool.dispatch_interval_max),
    dispatch_order_mode: pool.dispatch_order_mode,
  };
}

export default function DispatchManagement() {
  const auth = getStoredAuth();
  const admin = auth?.userType === 'admin' ? auth.user : null;
  const isSuperAdmin = admin?.role === 'super_admin';
  const currencyUnit = useCurrencyUnit(admin?.id);
  const [groups, setGroups] = useState<DispatchGroup[]>([]);
  const [pools, setPools] = useState<DispatchPool[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [adminNames, setAdminNames] = useState<
    { id: string; username: string }[]
  >([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null);
  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false);
  const [memberPanelOpen, setMemberPanelOpen] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
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
  const [pageInput, setPageInput] = useState('');
  const [orderFilter, setOrderFilter] = useState<'all' | 'active' | 'inactive'>(
    'all',
  );
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notification, setNotification] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [groupSaveStatus, setGroupSaveStatus] = useState<{ type: 'success' | 'error' } | null>(null);
  const [groupForm, setGroupForm] = useState<'create' | null>(null);
  const [groupDraft, setGroupDraft] = useState<GroupDraft>(emptyGroupDraft);
  const [pendingGroupActive, setPendingGroupActive] = useState<boolean | null>(null);
  const [poolForm, setPoolForm] = useState<'create' | 'edit' | null>(null);
  const [poolDraft, setPoolDraft] = useState<PoolDraft>(emptyPoolDraft);
  const [probabilityDraft, setProbabilityDraft] = useState<Record<string, string>>({});
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
  const groupDraftChanged = !!selectedGroup && (
    groupDraft.group_name.trim() !== groupDisplayName(selectedGroup) ||
    groupDraft.description !== (selectedGroup.description ? groupDisplayDescription(selectedGroup) : '') ||
    groupDraft.is_active !== selectedGroup.is_active ||
    groupDraft.pool_selection_mode !== selectedGroup.pool_selection_mode ||
    groupDraft.session_timeout_minutes !== String(selectedGroup.session_timeout_minutes) ||
    groupDraft.submit_wait_min_seconds !== String(selectedGroup.submit_wait_min_seconds) ||
    groupDraft.submit_wait_max_seconds !== String(selectedGroup.submit_wait_max_seconds) ||
    Number(groupDraft.commission_rate) !== selectedGroup.commission_rate ||
    groupDraft.grab_success_rate !== String(selectedGroup.grab_success_rate) ||
    groupDraft.dispatch_success_rate !== String(selectedGroup.dispatch_success_rate) ||
    Number(groupDraft.withdrawal_amount_threshold) !== selectedGroup.withdrawal_amount_threshold ||
    groupDraft.withdrawal_orders_threshold !== String(selectedGroup.withdrawal_orders_threshold) ||
    groupDraft.withdrawal_condition_mode !== selectedGroup.withdrawal_condition_mode
  );
  const groupPools = pools.filter((pool) => pool.group_id === selectedGroupId);
  const editableProbabilityPools = groupPools.filter((pool) => !pool.archived_at);
  const probabilityTotal = editableProbabilityPools.reduce(
    (total, pool) => total + (Number(probabilityDraft[pool.id]) || 0), 0,
  );
  const probabilityDraftChanged = editableProbabilityPools.some(
    (pool) => probabilityDraft[pool.id]?.trim() === '' ||
      Number(probabilityDraft[pool.id]) !== pool.trigger_probability,
  );
  const probabilityDraftValid = editableProbabilityPools.length > 0 &&
    editableProbabilityPools.every((pool) =>
      /^\d{1,3}$/.test(probabilityDraft[pool.id]?.trim() ?? '') &&
      Number(probabilityDraft[pool.id]) <= 100,
    ) && probabilityTotal === 100;
  const groupSettingsChanged = groupDraftChanged ||
    (groupDraft.pool_selection_mode === 'weighted' && probabilityDraftChanged);
  const displayGroupById = (id: string | null) => {
    const group = groups.find((item) => item.id === id);
    return group ? groupDisplayName(group) : '尚未指派分組';
  };
  const selectedPool = groupPools.find((pool) => pool.id === selectedPoolId) ?? null;
  const defaultGroup = groups.find(
    (group) => group.is_default && group.is_active && !group.archived_at,
  );
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const modalOpen = Boolean(
    groupForm ||
      groupSettingsOpen ||
      memberPanelOpen ||
      ordersOpen ||
      poolForm ||
      archiveTarget ||
      memberMove ||
      deleteOrder ||
      showDeleteAll,
  );

  const notify = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
  };

  const groupSaveFailed = (message: string) => {
    setGroupSaveStatus({ type: 'error' });
    notify('error', message);
  };

  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(null), 5000);
    return () => clearTimeout(timer);
  }, [notification]);

  useEffect(() => {
    if (!groupSaveStatus) return;
    const timer = setTimeout(() => setGroupSaveStatus(null), 4000);
    return () => clearTimeout(timer);
  }, [groupSaveStatus]);

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
      if (requestId !== workspaceRequestRef.current) return true;
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
      if (requestId !== workspaceRequestRef.current) return true;
      notify(
        'error',
        '載入訂單指派工作區失敗：' + formatSupabaseError(error),
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
      notify('error', '載入訂單失敗：' + formatSupabaseError(error));
      return false;
    } finally {
      if (requestId === ordersRequestRef.current) setOrdersLoading(false);
    }
  };

  const refreshWorkspace = async () => {
    setRefreshing(true);
    try {
      const [workspaceLoaded, ordersLoaded] = await Promise.all([
        loadWorkspace(),
        ordersOpen && selectedPool
          ? loadOrders(selectedPool.id, page, orderFilter)
          : Promise.resolve(true),
      ]);
      if (workspaceLoaded && ordersLoaded)
        notify('success', '訂單指派資料已刷新。');
    } finally {
      setRefreshing(false);
    }
  };

  const loadWorkspaceRef = useRef(loadWorkspace);
  const loadOrdersRef = useRef(loadOrders);
  const orderViewRef = useRef({
    poolId: ordersOpen ? (selectedPool?.id ?? null) : null,
    page,
    status: orderFilter,
  });
  loadWorkspaceRef.current = loadWorkspace;
  loadOrdersRef.current = loadOrders;
  orderViewRef.current = {
    poolId: ordersOpen ? (selectedPool?.id ?? null) : null,
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
    if (ordersOpen && selectedPool?.id) {
      void loadOrdersRef.current(selectedPool.id, 1, orderFilter);
    } else {
      ++ordersRequestRef.current;
      setOrders([]);
      setOrdersPoolId(null);
      setTotalCount(0);
      setPage(1);
      setOrdersLoading(false);
    }
  }, [ordersOpen, selectedPool?.id, orderFilter]);

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
    setPendingGroupActive(null);
    setGroupSettingsOpen(false);
    setMemberPanelOpen(false);
    setOrdersOpen(false);
    setEditingId(null);
    setShowBulkImport(false);
    setBulkInput('');
    setSelectedCurrentMembers([]);
    setSelectedOtherMembers([]);
    setEmployeeTagFilter('all');
    setEmployeeAdminFilter('all');
  };

  const openGroupSettings = (group: DispatchGroup) => {
    switchGroup(group.id);
    setNotification(null);
    setGroupSaveStatus(null);
    setProbabilityDraft(Object.fromEntries(
      pools.filter((pool) => pool.group_id === group.id && !pool.archived_at)
        .map((pool) => [pool.id, String(pool.trigger_probability)]),
    ));
    setGroupDraft({
      group_name: groupDisplayName(group),
      description: group.description ? groupDisplayDescription(group) : '',
      is_active: group.is_active,
      pool_selection_mode: group.pool_selection_mode,
      session_timeout_minutes: String(group.session_timeout_minutes),
      submit_wait_min_seconds: String(group.submit_wait_min_seconds),
      submit_wait_max_seconds: String(group.submit_wait_max_seconds),
      commission_rate: String(group.commission_rate),
      grab_success_rate: String(group.grab_success_rate),
      dispatch_success_rate: String(group.dispatch_success_rate),
      withdrawal_amount_threshold: String(group.withdrawal_amount_threshold),
      withdrawal_orders_threshold: String(group.withdrawal_orders_threshold),
      withdrawal_condition_mode: group.withdrawal_condition_mode,
    });
    setGroupSettingsOpen(true);
  };

  const openOrders = (poolId: string) => {
    setSelectedPoolId(poolId);
    setOrdersPoolId(null);
    setTotalCount(0);
    setPageInput('');
    setOrderFilter('all');
    setEditingId(null);
    setShowBulkImport(false);
    setBulkInput('');
    setOrdersOpen(true);
  };

  const saveGroup = async (form: 'create' | 'edit' = 'create') => {
    if (!isSuperAdmin) return;
    setNotification(null);
    setGroupSaveStatus(null);
    if (form === 'edit' && !selectedGroup)
      return groupSaveFailed('目前未選取分組，請重新整理後再試。');
    if (!groupDraft.group_name.trim())
      return groupSaveFailed('請填寫分組名稱。');
    if (form === 'edit' && groupDraft.pool_selection_mode === 'weighted' && !probabilityDraftValid)
      return groupSaveFailed('請為每個未封存訂單池填寫 0–100% 的整數概率，合計須為 100%。');
    const timeout = Number(groupDraft.session_timeout_minutes);
    const waitMin = Number(groupDraft.submit_wait_min_seconds);
    const waitMax = Number(groupDraft.submit_wait_max_seconds);
    const commissionRate = Number(groupDraft.commission_rate);
    const grabSuccessRate = Number(groupDraft.grab_success_rate);
    const successRate = Number(groupDraft.dispatch_success_rate);
    const withdrawalAmount = Number(groupDraft.withdrawal_amount_threshold);
    const withdrawalOrders = Number(groupDraft.withdrawal_orders_threshold);
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(groupDraft.withdrawal_amount_threshold.trim()) ||
        !Number.isFinite(withdrawalAmount) || withdrawalAmount > 999999999999.99 ||
        !/^\d{1,7}$/.test(groupDraft.withdrawal_orders_threshold.trim()) ||
        !Number.isInteger(withdrawalOrders) || withdrawalOrders < 1 || withdrawalOrders > 1000000) {
      return groupSaveFailed('提款門檻須為 0–999999999999.99，訂單數須為 1–1000000。');
    }
    if (!groupDraft.commission_rate.trim() || !Number.isFinite(commissionRate) || commissionRate < 0.00001 || commissionRate > 1 || !/^\d+(\.\d{1,8})?$/.test(groupDraft.commission_rate.trim()) ||
        !groupDraft.grab_success_rate.trim() || !Number.isInteger(grabSuccessRate) || grabSuccessRate < 0 || grabSuccessRate > 100 ||
        !groupDraft.dispatch_success_rate.trim() || !Number.isInteger(successRate) || successRate < 0 || successRate > 100) {
      return groupSaveFailed('佣金率須為 0.00001–1（最多 8 位小數），搶單與提交後成功率各須為 0–100% 的整數。');
    }
    if (!groupDraft.session_timeout_minutes.trim() || !Number.isInteger(timeout) || timeout < 1 || timeout > 60 ||
        !groupDraft.submit_wait_min_seconds.trim() || !Number.isInteger(waitMin) || waitMin < 3 || waitMin > 120 ||
        !groupDraft.submit_wait_max_seconds.trim() || !Number.isInteger(waitMax) || waitMax < waitMin || waitMax > 300) {
      return groupSaveFailed('逾時須為 1–60 分鐘；提交等待最短 3–120 秒、最長 3–300 秒，且最短不得大於最長。');
    }
    setBusy(true);
    let probabilitiesSaved = false;
    try {
      if (form === 'edit' && selectedGroup && groupDraft.pool_selection_mode === 'weighted' && probabilityDraftChanged) {
        const { error: probabilityError } = await supabase.rpc('admin_set_dispatch_pool_probabilities', {
          p_admin_session_token: getAdminFinancialSessionToken(),
          p_group_id: selectedGroup.id,
          p_probabilities: editableProbabilityPools.map((pool) => ({
            pool_id: pool.id,
            probability: Number(probabilityDraft[pool.id]),
          })),
        });
        if (probabilityError) throw probabilityError;
        probabilitiesSaved = true;
      }
      if (form === 'edit' && !groupDraftChanged) {
        setGroupSaveStatus({ type: 'success' });
        notify('success', '訂單池觸發概率已儲存。');
        await loadWorkspace();
        return;
      }
      const { data, error } = await supabase.rpc(
        'admin_save_dispatch_group',
        {
          p_admin_session_token: getAdminFinancialSessionToken(),
          p_group_id: form === 'edit' ? (selectedGroup?.id ?? null) : null,
          p_changes: {
            group_name:
              form === 'edit' && selectedGroup &&
              groupDraft.group_name.trim() === groupDisplayName(selectedGroup)
                ? selectedGroup.group_name
                : groupDraft.group_name.trim(),
            description:
              form === 'edit' && selectedGroup &&
              groupDraft.description === (selectedGroup.description ? groupDisplayDescription(selectedGroup) : '')
                ? selectedGroup.description
                : groupDraft.description,
            pool_selection_mode: groupDraft.pool_selection_mode,
            session_timeout_minutes: timeout,
            submit_wait_min_seconds: waitMin,
            submit_wait_max_seconds: waitMax,
            commission_rate: commissionRate,
            grab_success_rate: grabSuccessRate,
            dispatch_success_rate: successRate,
            withdrawal_amount_threshold: withdrawalAmount,
            withdrawal_orders_threshold: withdrawalOrders,
            withdrawal_condition_mode: groupDraft.withdrawal_condition_mode,
            is_active: groupDraft.is_active,
          },
        },
      );
      if (error) throw error;
      if (!data?.group?.id) throw new Error('儲存分組後未收到分組資料。');
      const savedGroup = data.group as unknown as DispatchGroup;
      setGroups((current) => {
        const existing = current.find((group) => group.id === savedGroup.id);
        return existing
          ? current.map((group) => group.id === savedGroup.id ? { ...group, ...savedGroup } : group)
          : [...current, { ...savedGroup, member_count: 0, order_count: 0 }];
      });
      if (form === 'create') setGroupForm(null);
      setSelectedGroupId(savedGroup.id);
      if (form === 'create') setSelectedPoolId(null);
      setGroupSaveStatus({ type: 'success' });
      notify(
        'success',
        form === 'create'
          ? '已建立分組及專屬基本池。'
          : '分組設定已儲存成功。',
      );
      await loadWorkspace();
    } catch (error) {
      const message = formatSupabaseError(error);
      groupSaveFailed(
        probabilitiesSaved
          ? '觸發概率已儲存，但分組設定失敗：' + message
          : message.includes('Invalid dispatch group changes.')
            ? '儲存失敗：目前資料庫尚未支援分組時間、收益及提款設定；資料未變更，需先完成資料庫遷移。'
            : '儲存分組失敗：' + message,
      );
      if (probabilitiesSaved) await loadWorkspace();
    } finally {
      setBusy(false);
    }
  };

  const savePool = async () => {
    if (!isSuperAdmin || !selectedGroup || !poolForm) return;
    if (selectedGroup.archived_at || (poolForm === 'edit' && !selectedPool))
      return notify(
        'error',
        '所選分組或訂單池已無法使用，請重新整理後再試。',
      );
    const min = Number(poolDraft.dispatch_interval_min);
    const max = Number(poolDraft.dispatch_interval_max);
    if (!poolDraft.pool_name.trim())
      return notify('error', '請填寫訂單池名稱。');
    if (
      !Number.isInteger(min) ||
      min < 1 ||
      min > 3000 ||
      !Number.isInteger(max) ||
      max < min ||
      max > 3000
    ) {
      return notify(
        'error',
        '派單間隔須為 1–3000 秒，且最短不得大於最長。',
      );
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('admin_save_dispatch_pool', {
        p_admin_session_token: getAdminFinancialSessionToken(),
        p_group_id: selectedGroup.id,
        p_pool_id: poolForm === 'edit' ? (selectedPool?.id ?? null) : null,
        p_changes: {
          pool_name:
            poolForm === 'edit' && selectedPool &&
            poolDraft.pool_name.trim() === poolDisplayName(selectedPool)
              ? selectedPool.pool_name
              : poolDraft.pool_name.trim(),
          is_active: poolDraft.is_active,
          dispatch_interval_min: min,
          dispatch_interval_max: max,
          dispatch_order_mode: poolDraft.dispatch_order_mode,
        },
      });
      if (error) throw error;
      if (!data?.pool?.id) throw new Error('儲存訂單池後未收到訂單池資料。');
      setPoolForm(null);
      setSelectedPoolId(data.pool.id);
      if (await loadWorkspace())
        notify(
          'success',
          poolForm === 'create' ? '訂單池已建立。' : '訂單池設定已儲存。',
        );
    } catch (error) {
      notify('error', '儲存訂單池失敗：' + formatSupabaseError(error));
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
    if (type === 'pool' && !targetPool) return notify('error', '找不到訂單池。');
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
          `${type === 'group' ? '分組' : '訂單池'}已${archive ? '封存' : '還原'}。`,
        );
    } catch (error) {
      notify(
        'error',
        '更新封存狀態失敗：' + formatSupabaseError(error),
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
        notify('success', `訂單池已${pool.is_active ? '停用' : '啟用'}。`);
    } catch (error) {
      notify(
        'error',
        '變更訂單池狀態失敗：' + formatSupabaseError(error),
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
      return notify('error', '目標分組未啟用。');
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
            throw new Error('指派後未收到員工歸屬資料。');
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
          `已將 ${succeeded.length} / ${ids.length} 位員工移至「${destination}」；其餘失敗：${firstError}`,
        );
      else if (refreshed)
        notify(
          'success',
          `已將 ${succeeded.length} 位員工移至「${destination}」。`,
        );
    } catch (error) {
      notify(
        'error',
        '指派員工失敗：' + formatSupabaseError(error),
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
        '所選訂單池已無法管理訂單。',
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
        throw new Error('訂單操作未傳回結果。');
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
            ? `已封存「${poolDisplayName(selectedPool)}」中的 ${result.affected} 筆訂單。`
            : `訂單已${action === 'delete' ? '封存' : action === 'toggle' ? '更新狀態' : '儲存'}。`,
        );
    } catch (error) {
      await Promise.all([loadWorkspace(), loadOrders(selectedPool.id, page)]);
      notify('error', '訂單操作失敗：' + formatSupabaseError(error));
    } finally {
      setBusy(false);
    }
  };

  const importOrders = async () => {
    const target = groupPools.find(
      (pool) => pool.id === importPoolId && !pool.archived_at,
    );
    if (!isSuperAdmin || !target || selectedGroup?.archived_at)
      return notify('error', '請先選擇可用的目標訂單池。');
    const contents = bulkInput
      .split(/\n\s*\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (!contents.length)
      return notify(
        'error',
        '請輸入至少一筆訂單，並以空白行分隔。',
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
            '匯入筆數與提交筆數不符，請重新整理後再試。',
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
        `已將 ${imported} 筆訂單匯入「${poolDisplayName(target)}」。`,
      );
    } catch (error) {
      // Keep only the unsubmitted batches, so retrying does not duplicate successful ones.
      setBulkInput(contents.slice(imported).join('\n\n'));
      notify(
        'error',
        `已匯入 ${imported} / ${contents.length} 筆訂單；未匯入的內容已保留，可重試。${formatSupabaseError(error)}`,
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
    <div className="flex min-h-0 w-full flex-1 flex-col bg-slate-950/30 text-slate-100">
      {notification && createPortal(
        <div
          role={notification.type === 'error' ? 'alert' : 'status'}
          className={`fixed left-4 right-4 top-4 z-[10020] flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-2xl sm:left-auto sm:w-full sm:max-w-md ${notification.type === 'error' ? 'border-rose-400/70 bg-rose-950 text-rose-50' : 'border-emerald-400/70 bg-emerald-950 text-emerald-50'}`}
        >
          {notification.type === 'error' ? (
            <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
          ) : (
            <CheckCircle className="mt-0.5 h-5 w-5 shrink-0" />
          )}
          <span className="min-w-0 flex-1 break-words">{notification.message}</span>
          <button
            type="button"
            onClick={() => setNotification(null)}
            aria-label="關閉通知"
            className="shrink-0 rounded p-0.5 hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>, document.body,
      )}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-cyan-800/60 bg-gradient-to-r from-blue-950/70 via-slate-900/70 to-cyan-950/40 px-3 py-1.5 sm:px-4 lg:px-5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white sm:text-base">
            訂單指派工作區
          </h2>
          {!isSuperAdmin && (
            <p className="text-xs text-slate-400">
              分組設定與訂單僅供檢視；您可以將自己工作區的員工指派至已啟用的分組。
            </p>
          )}
        </div>
        <button
          type="button"
          className="inline-flex h-8 w-32 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-blue-600 px-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
          disabled={workspaceLoading || refreshing || busy}
          aria-busy={refreshing}
          onClick={() => void refreshWorkspace()}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          <span aria-live="polite">{refreshing ? '刷新中…' : '刷新'}</span>
        </button>
      </div>

      <div className="relative grid min-h-0 min-w-0 w-full flex-1 grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] lg:before:pointer-events-none lg:before:absolute lg:before:inset-y-0 lg:before:left-[279px] lg:before:z-10 lg:before:w-[2px] lg:before:bg-gradient-to-b lg:before:from-blue-400/80 lg:before:via-cyan-500/60 lg:before:to-cyan-800/30">
        <>
            <section className="min-w-0 border-b-2 border-cyan-700/65 bg-gradient-to-b from-blue-950/65 via-slate-900/40 to-slate-950/20 px-3 py-4 sm:px-4 lg:border-b-0">
              <div className="mb-4 flex min-w-0 items-center justify-between gap-2">
                <h3 className="flex min-w-0 items-center gap-2 font-semibold text-blue-100">
                  <Layers className="h-4 w-4 text-blue-400" />
                  分組 <span className="rounded-full bg-blue-400/15 px-2 py-0.5 text-xs text-blue-200">{groups.length}</span>
                </h3>
                {isSuperAdmin && (
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={busy}
                    onClick={() => {
                      setGroupDraft({
                        ...emptyGroupDraft,
                        commission_rate: String(defaultGroup?.commission_rate ?? 0.001),
                        grab_success_rate: String(defaultGroup?.grab_success_rate ?? 100),
                        dispatch_success_rate: String(defaultGroup?.dispatch_success_rate ?? 100),
                        withdrawal_amount_threshold: String(defaultGroup?.withdrawal_amount_threshold ?? 100),
                        withdrawal_orders_threshold: String(defaultGroup?.withdrawal_orders_threshold ?? 1000),
                        withdrawal_condition_mode: defaultGroup?.withdrawal_condition_mode ?? 'OR',
                      });
                      setGroupForm('create');
                    }}
                  >
                    <FolderPlus className="h-3.5 w-3.5" />新增分組
                  </button>
                )}
              </div>
              <div className="max-h-[min(70vh,780px)] space-y-2.5 overflow-y-auto pr-1">
                {groups.map((group) => (
                  <article
                    key={group.id}
                    className={`relative min-w-0 overflow-hidden rounded-lg border px-2.5 py-2 transition-colors ${selectedGroupId === group.id ? 'border-cyan-300 bg-gradient-to-br from-blue-900/90 via-indigo-950/95 to-cyan-900/85 shadow-[0_0_16px_rgba(34,211,238,0.2)] ring-1 ring-cyan-300/70 before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-cyan-300' : 'border-slate-700 bg-slate-950/70 hover:border-slate-500 hover:bg-slate-800/80'}`}
                  >
                    <button
                      type="button"
                      className="w-full min-w-0 text-left focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                      aria-pressed={selectedGroupId === group.id}
                      onClick={() => switchGroup(group.id)}
                    >
                      <span className="flex min-w-0 items-start justify-between gap-1.5">
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 flex-wrap items-center gap-1">
                            <span className={`min-w-0 break-words text-sm font-semibold leading-5 ${selectedGroupId === group.id ? 'text-white' : 'text-slate-200'}`}>{groupDisplayName(group)}</span>
                            {group.is_default && <span className="shrink-0 rounded bg-amber-400/20 px-1 text-[10px] leading-4 text-amber-100">預設</span>}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] leading-4 text-slate-300" title={groupDisplayDescription(group)}>{groupDisplayDescription(group)}</span>
                        </span>
                        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 text-[10px] leading-5 ${group.archived_at ? 'bg-rose-500/20 text-rose-100' : group.is_active ? 'bg-emerald-500/20 text-emerald-100' : 'bg-rose-500/20 text-rose-200'}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${group.archived_at ? 'bg-rose-400' : group.is_active ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                          {group.archived_at ? '已封存' : group.is_active ? '已啟用' : '未啟用'}
                        </span>
                      </span>
                      <span className="mt-1.5 block text-[11px] leading-4 text-slate-200">
                        {group.member_count} 位成員 · {group.order_count} 筆訂單
                      </span>
                      <span className={`mt-1 block text-[11px] font-medium leading-4 ${selectedGroupId === group.id ? 'text-cyan-50' : 'text-slate-300'}`}>
                        選池 · {group.pool_selection_mode === 'base' ? '固定基本池' : group.pool_selection_mode === 'weighted' ? '按池設定概率' : '隨機可派單池'}
                      </span>
                      <span className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1 border-t border-white/15 pt-1.5 text-[11px] leading-4">
                        <span className="min-w-0 truncate text-cyan-200">提交 <strong className="font-semibold text-white">{group.submit_wait_min_seconds == null || group.submit_wait_max_seconds == null ? '—' : `${group.submit_wait_min_seconds}–${group.submit_wait_max_seconds} 秒`}</strong></span>
                        <span className="min-w-0 truncate text-emerald-200">佣金 <strong className="font-semibold text-white">{group.commission_rate == null ? '—' : `${Number((group.commission_rate * 100).toFixed(6))}%`}</strong></span>
                        <span className="min-w-0 text-emerald-200">搶單 <strong className="font-semibold text-white">{`${group.grab_success_rate}%`}</strong></span>
                        <span className="min-w-0 text-teal-200">提交後 <strong className="font-semibold text-white">{group.dispatch_success_rate == null ? '—' : `${group.dispatch_success_rate}%`}</strong></span>
                        <span className="col-span-2 grid grid-cols-[minmax(0,1.35fr)_minmax(0,0.85fr)] gap-x-2">
                          <span className="min-w-0 break-words text-amber-200" title={`提款要求：${group.withdrawal_amount_threshold ?? '—'} ${currencyUnit}`}>
                            提款要求 <strong className="font-semibold text-white">{group.withdrawal_amount_threshold == null ? '—' : `${group.withdrawal_amount_threshold.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currencyUnit}`}</strong>
                          </span>
                          <span className="min-w-0 break-words text-amber-200">訂單要求 <strong className="font-semibold text-white">{group.withdrawal_orders_threshold ?? '—'}</strong></span>
                        </span>
                        <span className="col-span-2 text-amber-200">提款條件 <strong className="font-semibold text-white">{withdrawalModeLabels[group.withdrawal_condition_mode] ?? '—'}</strong></span>
                      </span>
                    </button>
                    <div className="mt-2 grid grid-cols-2 gap-1.5 border-t border-white/15 pt-2">
                      <button type="button" className="inline-flex min-w-0 items-center justify-center gap-1 rounded-md border border-cyan-400/45 bg-cyan-500/20 px-1 py-1 text-[11px] font-medium text-cyan-50 hover:bg-cyan-500/30" onClick={() => openGroupSettings(group)}><Settings className="h-3 w-3 shrink-0" />分組設定</button>
                      <button type="button" className="inline-flex min-w-0 items-center justify-center gap-1 rounded-md border border-emerald-400/45 bg-emerald-500/20 px-1 py-1 text-[11px] font-medium text-emerald-50 hover:bg-emerald-500/30" onClick={() => { switchGroup(group.id); setMemberPanelOpen(true); }}><Users className="h-3 w-3 shrink-0" />成員管理</button>
                    </div>
                  </article>
                ))}
                {!groups.length && (
                  <div className="flex min-h-44 flex-col items-center justify-center gap-2 px-3 py-8 text-center">
                    <Layers className="h-8 w-8 text-blue-300/60" />
                    <p className="text-sm font-medium text-blue-100">
                      {workspaceLoading ? '正在載入分組…' : '尚未建立分組'}
                    </p>
                    {!workspaceLoading && <p className="text-xs text-slate-400">新增分組後即可在此管理訂單池。</p>}
                  </div>
                )}
              </div>
            </section>

            {groupSettingsOpen && selectedGroup && createPortal(
              <div className="fixed inset-0 z-[9990] flex flex-col items-center overflow-y-auto bg-slate-950/80 p-2 backdrop-blur-sm sm:p-4">
                <div role="dialog" aria-modal="true" aria-label="分組設定" className="my-auto w-full max-w-7xl shrink-0 overflow-hidden rounded-2xl border border-indigo-300/30 bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 shadow-[0_32px_90px_rgba(2,6,23,0.65)]">
                  <div className="flex flex-wrap items-center gap-3 border-b border-indigo-300/20 bg-gradient-to-r from-indigo-900 via-blue-900 to-slate-900 px-4 py-3 sm:px-6">
                    <div className="flex min-w-[150px] flex-1 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-300/30 bg-white/10 text-cyan-200"><Settings className="h-5 w-5" /></div>
                      <div className="min-w-0">
                        <h3 className="text-lg font-semibold text-white">分組設定</h3>
                        <p className="truncate text-xs text-blue-100/75">{groupDisplayName(selectedGroup)} · 調整派單與員工規則</p>
                      </div>
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
                      <button
                        type="button"
                        role="switch"
                        aria-label="啟用分組"
                        aria-checked={groupDraft.is_active}
                        disabled={!isSuperAdmin || !!selectedGroup.archived_at || busy}
                        onClick={() => setPendingGroupActive(!groupDraft.is_active)}
                        className={`inline-flex min-h-10 items-center gap-2.5 rounded-xl border px-3 py-1.5 text-sm font-semibold shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-60 ${groupDraft.is_active ? 'border-emerald-300/60 bg-emerald-500/25 text-emerald-50 shadow-emerald-950/40 hover:bg-emerald-500/35' : 'border-rose-300/60 bg-rose-500/25 text-rose-50 shadow-rose-950/40 hover:bg-rose-500/35'}`}
                      >
                        <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${groupDraft.is_active ? 'bg-emerald-400' : 'bg-rose-500'}`} aria-hidden="true">
                          <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-transform ${groupDraft.is_active ? 'translate-x-5' : ''}`} />
                        </span>
                        <span>{groupDraft.is_active ? '已啟用' : '未啟用'}</span>
                        {groupDraft.is_active !== selectedGroup.is_active && <span className="text-xs text-white/80">· 待儲存</span>}
                      </button>
                      <button type="button" onClick={() => setGroupSettingsOpen(false)} disabled={busy} aria-label="關閉分組設定" className="shrink-0 rounded-lg border border-white/10 bg-white/10 p-2 text-blue-100 transition-colors hover:bg-white/20 disabled:opacity-50"><X className="h-5 w-5" /></button>
                    </div>
                  </div>
                  <div className="dispatch-group-settings-fields px-4 py-4 sm:px-6">
                    <div className="grid gap-5 lg:grid-cols-2 lg:gap-6">
                      <div className="min-w-0 space-y-4">
                        <section className="min-w-0 space-y-2">
                          <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-400/20 text-xs font-bold text-sky-200">01</span><h4 className="font-semibold text-sky-100">基本資料</h4></div>
                          <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-200">
                      分組名稱
                      <input
                        className={`${inputClass} mt-1 sm:ml-3 sm:max-w-40`}
                                value={groupDraft.group_name ?? ''}
                        disabled={!isSuperAdmin || !!selectedGroup.archived_at || busy}
                        onChange={(event) => setGroupDraft({ ...groupDraft, group_name: event.target.value })}
                      />
                    </label>
                    <label className="block text-sm font-medium text-slate-200">
                      說明
                      <textarea
                        className={`${inputClass} mt-1 min-h-14 resize-y`}
                        value={groupDraft.description ?? ''}
                        disabled={!isSuperAdmin || !!selectedGroup.archived_at || busy}
                        onChange={(event) => setGroupDraft({ ...groupDraft, description: event.target.value })}
                      />
                    </label>
                  </div>
                        </section>
                        <section className="min-w-0 space-y-2 border-t border-slate-700/70 pt-3">
                          <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-400/20 text-xs font-bold text-violet-200">02</span><h4 className="font-semibold text-violet-100">訂單池設定</h4></div>
                    <p className="text-sm font-medium text-violet-100">訂單池選擇模式</p>
                    <div role="group" aria-label="訂單池選擇模式" className="grid grid-cols-3 gap-2">
                      {poolSelectionOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={groupDraft.pool_selection_mode === option.value}
                          disabled={!isSuperAdmin || !!selectedGroup.archived_at || busy}
                          onClick={() => setGroupDraft({ ...groupDraft, pool_selection_mode: option.value })}
                          className={`min-w-0 rounded-xl border px-2 py-2.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50 ${groupDraft.pool_selection_mode === option.value ? option.activeClass : option.inactiveClass}`}
                        >
                          <span className="flex items-start justify-between gap-1 text-xs font-semibold sm:text-sm">
                            {option.label}
                            {groupDraft.pool_selection_mode === option.value && <CheckCircle className="h-4 w-4 shrink-0" />}
                          </span>
                          <span className="mt-1 hidden text-xs opacity-85 sm:block">{option.description}</span>
                        </button>
                      ))}
                    </div>
                    {groupDraft.pool_selection_mode === 'weighted' && (
                      <div className="space-y-3 border-t border-amber-400/25 pt-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h5 className="text-sm font-semibold text-amber-100">各訂單池觸發概率</h5>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${probabilityDraftValid ? 'bg-emerald-500/20 text-emerald-200' : 'bg-rose-500/20 text-rose-200'}`}>
                            合計 {probabilityTotal}% / 100%
                          </span>
                        </div>
                        <p className="text-xs leading-relaxed text-amber-100/80">所有未封存訂單池合計須為 100%。停用、無可派訂單或 0% 的池不參與抽選，其餘可用池按比例重新分配。</p>
                        <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
                          {editableProbabilityPools.map((pool) => (
                            <label key={pool.id} className="min-w-0 text-sm font-medium text-slate-200">
                              <span className="mb-1 block truncate font-semibold" title={poolDisplayName(pool)}>
                                {poolDisplayName(pool)}{!pool.is_active ? '（已停用）' : ''}
                              </span>
                              <span className="flex items-center gap-2">
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="1"
                                  value={probabilityDraft[pool.id] ?? ''}
                                  disabled={!isSuperAdmin || !!selectedGroup.archived_at || busy}
                                  onChange={(event) => setProbabilityDraft((current) => ({ ...current, [pool.id]: event.target.value }))}
                                  className={inputClass}
                                  aria-label={`${poolDisplayName(pool)}觸發概率（%）`}
                                />
                                <span className="shrink-0 text-sm font-semibold text-amber-200">%</span>
                              </span>
                            </label>
                          ))}
                        </div>
                        {!editableProbabilityPools.length && <p className="text-xs text-amber-200">此分組目前沒有可設定的訂單池。</p>}
                        {probabilityDraftChanged && <p className="text-xs text-amber-200">調整後按「儲存分組設定」，即可一併儲存各池概率。</p>}
                      </div>
                    )}
                        </section>
                      </div>
                      <div className="min-w-0 space-y-4 lg:border-l lg:border-indigo-300/20 lg:pl-6">
                        <section className="min-w-0 space-y-2">
                          <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-400/20 text-xs font-bold text-cyan-200">03</span><h4 className="font-semibold text-cyan-100">工作與提交時間</h4></div>
                          <div className="grid min-w-0 gap-3 sm:grid-cols-2 sm:gap-5">
                            <div className="min-w-0">
                              <label className="block text-sm font-medium text-slate-200">
                                <span className="block leading-5">工作會話逾時（分鐘）</span>
                                <input type="number" min="1" max="60" className={`${inputClass} mt-1 block sm:max-w-40`}
                                  value={groupDraft.session_timeout_minutes ?? ''}
                                  disabled={!isSuperAdmin || !!selectedGroup.archived_at || busy}
                                  onChange={(event) => setGroupDraft({ ...groupDraft, session_timeout_minutes: event.target.value })} />
                              </label>
                              <p className="mt-1 text-xs leading-relaxed text-cyan-100">接單後尚未提交的期限；已派訂單保留原設定。</p>
                            </div>
                            <div className="min-w-0" role="group" aria-labelledby="dispatch-submit-wait-label">
                              <p id="dispatch-submit-wait-label" className="text-sm font-medium leading-5 text-slate-200">提交等待時間（秒）</p>
                              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
                                <label className="inline-flex items-center gap-2 whitespace-nowrap text-xs font-medium text-slate-200">
                                  最短
                                  <input type="number" min="3" max="120" className={`${inputClass} !w-20 !px-2`}
                                    value={groupDraft.submit_wait_min_seconds ?? ''}
                                    disabled={!isSuperAdmin || !!selectedGroup.archived_at || busy}
                                    onChange={(event) => setGroupDraft({ ...groupDraft, submit_wait_min_seconds: event.target.value })} />
                                </label>
                                <label className="inline-flex items-center gap-2 whitespace-nowrap text-xs font-medium text-slate-200">
                                  最長
                                  <input type="number" min="3" max="300" className={`${inputClass} !w-20 !px-2`}
                                    value={groupDraft.submit_wait_max_seconds ?? ''}
                                    disabled={!isSuperAdmin || !!selectedGroup.archived_at || busy}
                                    onChange={(event) => setGroupDraft({ ...groupDraft, submit_wait_max_seconds: event.target.value })} />
                                </label>
                              </div>
                              <p className="mt-1 text-xs leading-relaxed text-cyan-100">僅影響提交頁動畫，不延長接單或處理期限。</p>
                            </div>
                          </div>
                        </section>
                        <section className="min-w-0 space-y-2 border-t border-slate-700/70 pt-3">
                          <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-400/20 text-xs font-bold text-emerald-200">04</span><h4 className="font-semibold text-emerald-100">訂單收益與成功率</h4></div>
                          <div className="grid min-w-0 gap-y-3 sm:grid-cols-3 sm:gap-x-5">
                            <label className="min-w-0 text-sm font-medium text-slate-200">
                              <span className="block leading-5">佣金率</span>
                              <input type="number" min="0.00001" max="1" step="0.00000001" className={`${inputClass} mt-1 sm:max-w-40`}
                                value={groupDraft.commission_rate ?? ''}
                                disabled={!isSuperAdmin || !!selectedGroup.archived_at || busy}
                                onChange={(event) => setGroupDraft({ ...groupDraft, commission_rate: event.target.value })} />
                              <span className="mt-1 block text-xs font-normal leading-4 text-emerald-300 sm:max-w-40">小數比例：0.00008 = 0.008%；成功訂單計佣。</span>
                            </label>
                            <label className="min-w-0 text-sm font-medium text-slate-200">
                              <span className="block leading-5">搶單成功率（%）</span>
                              <input type="number" min="0" max="100" step="1" className={`${inputClass} mt-1 sm:max-w-40`}
                                value={groupDraft.grab_success_rate ?? ''}
                                disabled={!isSuperAdmin || !!selectedGroup.archived_at || busy}
                                onChange={(event) => setGroupDraft({ ...groupDraft, grab_success_rate: event.target.value })} />
                              <span className="mt-1 block text-xs font-normal leading-4 text-emerald-300 sm:max-w-40">僅影響接單；新派單保存機率。</span>
                            </label>
                            <label className="min-w-0 text-sm font-medium text-slate-200">
                              <span className="block leading-5">提交後訂單成功率（%）</span>
                              <input type="number" min="0" max="100" step="1" className={`${inputClass} mt-1 sm:max-w-40`}
                                value={groupDraft.dispatch_success_rate ?? ''}
                                disabled={!isSuperAdmin || !!selectedGroup.archived_at || busy}
                                onChange={(event) => setGroupDraft({ ...groupDraft, dispatch_success_rate: event.target.value })} />
                              <span className="mt-1 block text-xs font-normal leading-4 text-teal-300 sm:max-w-40">僅影響訂單結果；提交時保存機率。</span>
                            </label>
                          </div>
                        </section>
                        <section className="min-w-0 space-y-2 border-t border-slate-700/70 pt-3">
                    <div className="flex flex-wrap items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-400/20 text-xs font-bold text-amber-200">05</span><h4 className="font-semibold text-amber-100">提款資格</h4><span className="ml-auto rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-xs font-medium text-amber-100">{selectedGroup.member_count} 位員工</span></div>
                    <p className="text-xs leading-relaxed text-slate-300">依目前所屬分組判斷；員工人數由分組成員自動統計。</p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="min-w-0 text-sm font-medium text-slate-200">
                        最低提款餘額
                        <input type="number" min="0" max="999999999999.99" step="0.01" className={`${inputClass} mt-1 sm:ml-3 sm:max-w-40`}
                                value={groupDraft.withdrawal_amount_threshold ?? ''}
                          disabled={!isSuperAdmin || !!selectedGroup.archived_at || busy}
                          onChange={(event) => setGroupDraft({ ...groupDraft, withdrawal_amount_threshold: event.target.value })} />
                        <span className="mt-1 block text-xs font-normal leading-relaxed text-amber-200/90">按員工目前餘額是否達到此金額判斷。</span>
                      </label>
                      <label className="min-w-0 text-sm font-medium text-slate-200">
                        最低訂單數
                        <input type="number" min="1" max="1000000" step="1" className={`${inputClass} mt-1 sm:ml-3 sm:max-w-40`}
                                value={groupDraft.withdrawal_orders_threshold ?? ''}
                          disabled={!isSuperAdmin || !!selectedGroup.archived_at || busy}
                          onChange={(event) => setGroupDraft({ ...groupDraft, withdrawal_orders_threshold: event.target.value })} />
                        <span className="mt-1 block text-xs font-normal leading-relaxed text-amber-200/90">按所有狀態的訂單筆數計算。</span>
                      </label>
                    </div>
                    <WithdrawalConditionPicker
                      id="edit-withdrawal-condition"
                      value={groupDraft.withdrawal_condition_mode}
                      disabled={!isSuperAdmin || !!selectedGroup.archived_at || busy}
                      onChange={(mode) => setGroupDraft((current) => ({ ...current, withdrawal_condition_mode: mode }))}
                    />
                        </section>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-indigo-300/20 bg-slate-950/50 px-4 py-2.5 sm:px-6">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span
                      className={`rounded-full px-2 py-1 ${selectedGroup.archived_at ? 'bg-rose-500/20 text-rose-300' : selectedGroup.is_active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-200'}`}
                    >
                      {!selectedGroup.is_active && !selectedGroup.archived_at && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-rose-400 align-middle" />}
                      {selectedGroup.archived_at
                        ? '已封存'
                        : selectedGroup.is_active
                          ? '目前已啟用'
                          : '目前未啟用'}
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
                          還原分組
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
                                name: groupDisplayName(selectedGroup),
                              })
                            }
                          >
                            封存分組
                          </button>
                        )
                      ))}
                    </div>
                    {isSuperAdmin && (
                      <button
                        className={`inline-flex min-h-10 items-center justify-center rounded-xl px-5 py-2 text-sm font-semibold text-white shadow-lg transition-colors disabled:cursor-not-allowed ${!busy && groupSaveStatus?.type === 'success' ? 'bg-emerald-600 shadow-emerald-950/30' : !busy && groupSaveStatus?.type === 'error' ? 'bg-rose-600 shadow-rose-950/30' : 'bg-blue-600 shadow-blue-900/30 hover:bg-blue-500 disabled:opacity-50'}`}
                        disabled={busy || !!selectedGroup.archived_at || !groupSettingsChanged}
                        onClick={() => void saveGroup('edit')}
                      >
                        {busy ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : groupSaveStatus?.type === 'success' ? <CheckCircle className="mr-2 h-4 w-4" /> : groupSaveStatus?.type === 'error' ? <XCircle className="mr-2 h-4 w-4" /> : <Save className="mr-2 h-4 w-4" />}
                        <span aria-live="polite">{busy ? '儲存中…' : groupSaveStatus?.type === 'success' ? '儲存成功' : groupSaveStatus?.type === 'error' ? '儲存失敗' : '儲存分組設定'}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>, document.body,
            )}

            {pendingGroupActive !== null && ((groupSettingsOpen && selectedGroup) || groupForm) && createPortal(
              <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm">
                <div role="dialog" aria-modal="true" aria-labelledby="group-active-confirm-title" aria-describedby="group-active-confirm-note" className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-600/70 bg-slate-900 text-slate-100 shadow-[0_28px_80px_rgba(2,6,23,0.7)]">
                  <div className={`h-1 ${pendingGroupActive ? 'bg-gradient-to-r from-emerald-400 to-teal-500' : 'bg-gradient-to-r from-rose-400 to-orange-500'}`} />
                  <div className="p-5 sm:p-6">
                    <div className="flex items-start gap-3">
                      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${pendingGroupActive ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-300' : 'border-rose-400/40 bg-rose-400/15 text-rose-300'}`}>
                        {pendingGroupActive ? <CheckCircle className="h-6 w-6" /> : <XCircle className="h-6 w-6" />}
                      </div>
                      <div className="min-w-0">
                        <h3 id="group-active-confirm-title" className="text-lg font-semibold text-white">確認{pendingGroupActive ? '啟用' : '停用'}分組</h3>
                        <p className="mt-1 break-words text-sm text-slate-300">{groupForm ? '新分組' : selectedGroup ? groupDisplayName(selectedGroup) : ''}</p>
                      </div>
                    </div>
                    <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-3 sm:px-4">
                      <div className="min-w-0">
                        <p className="text-xs text-slate-400">目前選擇</p>
                        <p className="mt-1 text-sm font-semibold text-slate-100">{groupDraft.is_active ? '已啟用' : '未啟用'}</p>
                      </div>
                      <span aria-hidden="true" className="text-lg text-slate-400">→</span>
                      <div className="min-w-0 text-right">
                        <p className="text-xs text-slate-400">確認後</p>
                        <p className={`mt-1 text-sm font-semibold ${pendingGroupActive ? 'text-emerald-300' : 'text-rose-300'}`}>{pendingGroupActive ? '已啟用' : '未啟用'}</p>
                      </div>
                    </div>
                    <p id="group-active-confirm-note" className="mt-4 border-l-2 border-blue-400 pl-3 text-sm leading-relaxed text-blue-100">確認後只會更新此表單，按「{groupForm ? '儲存分組' : '儲存分組設定'}」才正式生效。</p>
                    <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                      <button type="button" className="min-h-10 rounded-lg border border-slate-600 bg-slate-800 px-5 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300" onClick={() => setPendingGroupActive(null)}>取消</button>
                      <button
                        type="button"
                        className={`min-h-10 rounded-lg px-5 py-2 text-sm font-semibold text-white shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${pendingGroupActive ? 'bg-emerald-600 shadow-emerald-950/40 hover:bg-emerald-500' : 'bg-rose-600 shadow-rose-950/40 hover:bg-rose-500'}`}
                        onClick={() => {
                          setGroupDraft((current) => ({ ...current, is_active: pendingGroupActive }));
                          setPendingGroupActive(null);
                        }}
                      >
                        確認{pendingGroupActive ? '啟用' : '停用'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>, document.body,
            )}

          {selectedGroup && (
            <>
              {memberPanelOpen && createPortal(
                <div className="fixed inset-0 z-[9990] flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm">
                  <div role="dialog" aria-modal="true" aria-label="分組成員管理" className="flex max-h-[calc(100dvh-24px)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-emerald-300/30 bg-slate-900 shadow-2xl">
                    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-700 px-4 py-3"><div className="min-w-0"><h3 className="font-semibold text-white">{groupDisplayName(selectedGroup)} · 分組成員</h3><p className="text-xs text-slate-400">選擇員工後可移至此分組或預設分組</p></div><button type="button" onClick={() => setMemberPanelOpen(false)} disabled={busy} aria-label="關閉成員管理" className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-700"><X className="h-5 w-5" /></button></div>
                    <div className="min-h-0 overflow-y-auto p-4">
                      <section className="min-w-0 rounded-xl border border-slate-700 bg-slate-800/70 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="flex items-center gap-2 font-semibold">
                      <Users className="h-4 w-4 text-emerald-400" />
                      分組成員
                    </h3>
                    <p className="text-xs text-slate-400">
                      將員工指派至此分組，或移回已啟用的預設分組。
                    </p>
                  </div>
                </div>
                <div className="mb-3 flex flex-wrap gap-2">
                  <input
                    className={`${inputClass} min-w-[160px] flex-1`}
                    placeholder="搜尋員工"
                    aria-label="搜尋員工"
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
                      aria-label="依管理員篩選員工"
                    >
                      <option value="all">所有管理員</option>
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
                      aria-label="依標籤篩選員工"
                    >
                      <option value="all">所有標籤</option>
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
                        目前分組（{currentMembers.length}）
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
                              ? '沒有可用的已啟用預設分組'
                              : undefined
                          }
                          onClick={() =>
                            defaultGroup &&
                            setMemberMove({
                              ids: selectedCurrentMembers,
                              targetGroupId: defaultGroup.id,
                              destination: groupDisplayName(defaultGroup),
                            })
                          }
                        >
                          移至預設分組（{selectedCurrentMembers.length}）
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
                          沒有符合條件的成員。
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="min-w-0 rounded-lg border border-slate-700 bg-slate-900/30 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-sm font-medium text-amber-300">
                        其他分組／未指派（{otherMembers.length}）
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
                            destination: groupDisplayName(selectedGroup),
                          })
                        }
                      >
                        移至此分組（{selectedOtherMembers.length}）
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
                              {displayGroupById(employee.group_id)}
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
                          沒有符合條件的員工。
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                {!defaultGroup && !selectedGroup.is_default && (
                  <p className="mt-2 text-xs text-amber-300">
                    若要移出成員，預設分組必須處於啟用狀態。
                  </p>
                )}
                      </section>
                    </div>
                  </div>
                </div>, document.body,
              )}

              <section className="min-h-[320px] min-w-0 bg-gradient-to-br from-cyan-950/25 via-slate-900/10 to-slate-950/15 px-3 py-4 sm:px-4 lg:px-6">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-cyan-300">{groupDisplayName(selectedGroup)}</p>
                    <h3 className="mt-1 flex items-center gap-2 text-lg font-semibold text-white">
                      <Layers className="h-5 w-5 text-cyan-300" />
                      訂單池 <span className="rounded-full bg-cyan-400/15 px-2 py-0.5 text-xs font-medium text-cyan-200">{groupPools.length} 個</span>
                    </h3>
                    <p className="mt-1 text-xs text-slate-400">
                      各池觸發概率請至「分組設定」選擇「按訂單池設定概率」後調整；派單間隔與池內選單模式仍由各池管理。
                    </p>
                  </div>
                  {isSuperAdmin && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        className={primaryButton}
                        disabled={busy || !!selectedGroup.archived_at}
                        onClick={() => {
                          setPoolDraft({ ...emptyPoolDraft });
                          setPoolForm('create');
                        }}
                      >
                        <Plus className="mr-1 inline h-4 w-4" />
                        新增訂單池
                      </button>
                    </div>
                  )}
                </div>
                <div className="min-w-0 divide-y divide-cyan-400/20">
                  {groupPools.map((pool) => (
                    <article
                      key={pool.id}
                      className="min-w-0 bg-gradient-to-r from-cyan-950/25 via-blue-950/10 to-transparent px-3 py-5 transition-colors hover:from-cyan-950/40 first:pt-3 sm:px-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="break-words text-base font-semibold text-white">
                            {poolDisplayName(pool)}{' '}
                            {pool.is_base && <span className="ml-1 rounded bg-amber-400/15 px-2 py-0.5 text-[10px] text-amber-200">基本池</span>}
                          </h4>
                          <p className="mt-1 text-xs text-slate-400">{pool.order_count} 筆訂單</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${pool.archived_at ? 'bg-rose-500/15 text-rose-200' : pool.is_active ? 'bg-emerald-500/15 text-emerald-200' : 'bg-slate-700 text-slate-300'}`}>
                          {pool.archived_at ? '已封存' : pool.is_active ? '已啟用' : '已停用'}
                        </span>
                      </div>
                      <div className="mt-4 grid gap-x-5 gap-y-3 text-xs sm:grid-cols-2 xl:grid-cols-3">
                        <div><span className="block text-cyan-300/80">派單間隔</span><strong className="mt-1 block text-sm text-white">{pool.dispatch_interval_min}–{pool.dispatch_interval_max} 秒</strong></div>
                        <div><span className="block text-cyan-300/80">池內選單模式</span><strong className="mt-1 block text-sm text-white">{pool.dispatch_order_mode === 'random' ? '隨機選單' : '依序選單'}</strong></div>
                        <div><span className="block text-amber-300/80">觸發概率</span><strong className="mt-1 block text-sm text-white">{pool.trigger_probability}%</strong></div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-700 pt-3">
                        <button type="button" className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 px-3 py-2 text-xs font-semibold text-white hover:from-cyan-500 hover:to-blue-500" onClick={() => openOrders(pool.id)}><PackageSearch className="h-4 w-4" />查看訂單</button>
                        {isSuperAdmin && !selectedGroup.archived_at && (
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            {!pool.archived_at ? (
                              <>
                                <button
                                className="inline-flex items-center gap-1 rounded-lg border border-blue-400/30 bg-blue-500/10 px-3 py-2 text-blue-200 hover:bg-blue-500/20 disabled:opacity-50"
                                disabled={busy}
                                onClick={() => {
                                  setSelectedPoolId(pool.id);
                                  setPoolDraft(poolToDraft(pool));
                                  setPoolForm('edit');
                                }}
                              >
                                <Edit2 className="h-3.5 w-3.5" />編輯設定
                              </button>
                              <button
                                className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
                                disabled={busy}
                                onClick={() => void togglePool(pool)}
                              >
                                {pool.is_active ? '停用' : '啟用'}
                              </button>
                              {!pool.is_base && (
                                <button
                                  className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-rose-200 hover:bg-rose-500/20 disabled:opacity-50"
                                  disabled={busy}
                                  onClick={() =>
                                    setArchiveTarget({
                                      type: 'pool',
                                      id: pool.id,
                                      name: poolDisplayName(pool),
                                    })
                                  }
                                >
                                  封存
                                </button>
                              )}
                            </>
                          ) : (
                            <button
                              className="rounded-lg border border-blue-400/30 bg-blue-500/10 px-3 py-2 text-blue-200 hover:bg-blue-500/20 disabled:opacity-50"
                              disabled={busy}
                              onClick={() =>
                                void changeArchive('pool', pool.id, false)
                              }
                            >
                              還原
                            </button>
                          )}
                        </div>
                      )}
                      </div>
                    </article>
                  ))}
                  {!groupPools.length && (
                    <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-4 py-12 text-center">
                      <Layers className="h-10 w-10 text-cyan-300/60" />
                      <p className="text-base font-semibold text-cyan-100">此分組尚無訂單池</p>
                      <p className="max-w-sm text-sm text-slate-400">訂單池建立後會在這裡顯示設定與訂單入口。</p>
                    </div>
                  )}
                </div>
              </section>
            </>
          )}
          {!selectedGroup && (
            <section className="flex min-h-[320px] min-w-0 flex-col items-center justify-center gap-3 bg-gradient-to-br from-cyan-950/25 via-slate-900/10 to-slate-950/15 px-6 py-12 text-center">
              <Layers className="h-10 w-10 text-cyan-300/60" />
              <h3 className="text-base font-semibold text-cyan-100">{workspaceLoading ? '正在載入訂單池…' : '請選擇分組'}</h3>
              <p className="max-w-sm text-sm text-slate-400">{workspaceLoading ? '正在讀取分組及訂單池資料。' : groups.length ? '選擇左側分組，即可檢視所屬訂單池。' : '建立分組後，訂單池會顯示於此。'}</p>
            </section>
          )}
        </>

        {ordersOpen && selectedPool && createPortal(
          <div className="fixed inset-0 z-[9990] flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm">
            <aside
              role="dialog"
              aria-modal="true"
              aria-label="訂單管理"
              className="flex h-[min(860px,calc(100dvh-24px))] min-h-0 w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-cyan-300/30 bg-slate-900 shadow-2xl"
            >
          <div className="shrink-0 border-b border-slate-700 bg-gradient-to-r from-blue-950 to-cyan-950 p-4">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="flex items-center gap-2 font-semibold text-white"><PackageSearch className="h-4 w-4 text-cyan-300" />訂單管理</h3>
            <p className="mt-1 break-words text-xs text-slate-300">
              {selectedGroup ? groupDisplayName(selectedGroup) : '請選擇分組'} /{' '}
              {selectedPool ? poolDisplayName(selectedPool) : '請選擇訂單池'}
            </p></div><button type="button" onClick={() => { setOrdersOpen(false); setShowBulkImport(false); setEditingId(null); }} disabled={busy} aria-label="關閉訂單管理" className="shrink-0 rounded-lg p-1.5 text-slate-200 hover:bg-white/10"><X className="h-5 w-5" /></button></div>
            {selectedPool && (
              <>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    className={`${inputClass} flex-1`}
                    aria-label="依狀態篩選訂單"
                    value={orderFilter}
                    onChange={(event) =>
                      setOrderFilter(
                        event.target.value as 'all' | 'active' | 'inactive',
                      )
                    }
                  >
                    <option value="all">全部訂單</option>
                    <option value="active">已啟用</option>
                    <option value="inactive">未啟用</option>
                  </select>
                  <span className="text-xs text-slate-400">
                    共 {totalCount} 筆
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
                      匯入
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
                      全部刪除
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
          {showBulkImport && selectedPool && isSuperAdmin && (
            <div className="max-h-[45vh] shrink-0 space-y-2 overflow-y-auto border-b border-slate-700 bg-slate-900/40 p-4">
              <label
                className="block text-xs font-medium text-slate-300"
                htmlFor="import-pool"
              >
                匯入目標訂單池
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
                      {poolDisplayName(pool)}
                    </option>
                  ))}
              </select>
              <label
                className="block text-xs text-slate-300"
                htmlFor="bulk-orders"
              >
                每筆訂單請以空白行分隔
              </label>
              <textarea
                id="bulk-orders"
                className={`${inputClass} min-h-32 resize-y font-mono`}
                placeholder={'第一筆訂單\n\n第二筆訂單'}
                value={bulkInput}
                disabled={busy}
                onChange={(event) => setBulkInput(event.target.value)}
              />
              <p className="text-xs text-slate-400">
                每批最多匯入 2,000 筆；超出時會分批送出。
              </p>
              {importProgress && (
                <div className="text-xs text-blue-300" role="status">
                  已匯入 {importProgress.current} / {importProgress.total} 筆
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
                  取消
                </button>
                <button
                  className={primaryButton}
                  disabled={busy || !bulkInput.trim() || !importPoolId}
                  onClick={() => void importOrders()}
                >
                  匯入訂單
                </button>
              </div>
            </div>
          )}
          <div className="min-h-0 min-w-0 flex-1 space-y-2 overflow-y-auto p-4">
            {ordersLoading && (
              <p
                className="py-3 text-center text-xs text-slate-400"
                role="status"
              >
                正在載入訂單…
              </p>
            )}
            {!selectedPool ? (
              <p className="py-12 text-center text-sm text-slate-400">
                請選擇訂單池以檢視訂單。
              </p>
            ) : ordersLoading ||
              ordersPoolId !== selectedPool.id ? null : !orders.length ? (
              <p className="py-12 text-center text-sm text-slate-400">
                此訂單池沒有
                {orderFilter === 'all'
                  ? ''
                  : orderFilter === 'active'
                    ? '已啟用的'
                    : '未啟用的'}
                訂單。
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
                      {new Date(order.created_at).toLocaleString('zh-TW')}
                    </span>
                    <span
                      className={
                        order.is_active ? 'text-emerald-300' : 'text-slate-400'
                      }
                    >
                      {order.is_active ? '已啟用' : '未啟用'}
                    </span>
                  </div>
                  {editingId === order.id ? (
                    <>
                      <textarea
                        className={`${inputClass} mt-2 min-h-28 resize-y font-mono`}
                        value={editContent}
                        onChange={(event) => setEditContent(event.target.value)}
                        aria-label="編輯訂單內容"
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
                          儲存
                        </button>
                        <button
                          className={secondaryButton}
                          disabled={busy}
                          onClick={() => setEditingId(null)}
                        >
                          取消
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
                            編輯
                          </button>
                          <button
                            className="text-amber-300 hover:text-white disabled:opacity-50"
                            disabled={busy}
                            onClick={() => void manageOrder('toggle', order.id)}
                          >
                            {order.is_active ? '停用' : '啟用'}
                          </button>
                          <button
                            className="text-rose-400 hover:text-white disabled:opacity-50"
                            disabled={busy}
                            onClick={() => setDeleteOrder(order)}
                          >
                            <Trash2 className="mr-1 inline h-3 w-3" />
                            刪除
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
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-700 bg-slate-950/70 p-3 text-xs">
              <span className="text-slate-400">
                {(page - 1) * PAGE_SIZE + 1}–
                {Math.min(page * PAGE_SIZE, totalCount)}／共 {totalCount} 筆 · 第{' '}
                {page}/{totalPages} 頁
              </span>
              <div className="flex gap-2">
                <button
                  className={secondaryButton}
                  disabled={page <= 1 || ordersLoading}
                  onClick={() => void loadOrders(selectedPool.id, page - 1)}
                >
                  上一頁
                </button>
                <button
                  className={secondaryButton}
                  disabled={page >= totalPages || ordersLoading}
                  onClick={() => void loadOrders(selectedPool.id, page + 1)}
                >
                  下一頁
                </button>
              </div>
              {totalPages > 2 && (
                <form
                  className="flex w-full items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const targetPage = Number(pageInput);
                    if (!Number.isInteger(targetPage) || targetPage < 1 || targetPage > totalPages) {
                      notify('error', `請輸入 1 至 ${totalPages} 之間的頁碼。`);
                      return;
                    }
                    setPageInput('');
                    void loadOrders(selectedPool.id, targetPage);
                  }}
                >
                  <label htmlFor="order-page" className="shrink-0 text-slate-400">跳至頁碼</label>
                  <input
                    id="order-page"
                    type="number"
                    min={1}
                    max={totalPages}
                    value={pageInput}
                    onChange={(event) => setPageInput(event.target.value)}
                    className={`${inputClass} w-20 flex-none py-1.5`}
                  />
                  <button type="submit" disabled={ordersLoading || !pageInput} className={primaryButton}>跳轉</button>
                </form>
              )}
            </div>
          )}
            </aside>
          </div>, document.body,
        )}
      </div>

      {groupForm && createPortal(
        <div className="fixed inset-0 z-[9990] flex flex-col items-center overflow-y-auto bg-slate-950/80 p-2 backdrop-blur-sm sm:p-4">
          <div role="dialog" aria-modal="true" aria-label="建立分組" className="my-auto w-full max-w-7xl shrink-0 overflow-hidden rounded-2xl border border-indigo-300/30 bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 shadow-[0_32px_90px_rgba(2,6,23,0.65)]">
            <div className="flex flex-wrap items-center gap-3 border-b border-indigo-300/20 bg-gradient-to-r from-indigo-900 via-blue-900 to-slate-900 px-4 py-3 sm:px-6">
              <div className="flex min-w-[150px] flex-1 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-300/30 bg-white/10 text-cyan-200"><FolderPlus className="h-5 w-5" /></div>
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold text-white">建立訂單分組</h3>
                  <p className="text-xs text-blue-100/75">設定派單與員工規則，建立後自動新增基本池</p>
                </div>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
                <button type="button" role="switch" aria-label="啟用新分組" aria-checked={groupDraft.is_active}
                  disabled={busy} onClick={() => setPendingGroupActive(!groupDraft.is_active)}
                  className={`inline-flex min-h-10 items-center gap-2.5 rounded-xl border px-3 py-1.5 text-sm font-semibold shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-60 ${groupDraft.is_active ? 'border-emerald-300/60 bg-emerald-500/25 text-emerald-50 shadow-emerald-950/40 hover:bg-emerald-500/35' : 'border-rose-300/60 bg-rose-500/25 text-rose-50 shadow-rose-950/40 hover:bg-rose-500/35'}`}>
                  <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${groupDraft.is_active ? 'bg-emerald-400' : 'bg-rose-500'}`} aria-hidden="true">
                    <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-transform ${groupDraft.is_active ? 'translate-x-5' : ''}`} />
                  </span>
                  <span>{groupDraft.is_active ? '已啟用' : '未啟用'}</span>
                </button>
                <button type="button" onClick={() => setGroupForm(null)} disabled={busy} aria-label="關閉新增分組" className="shrink-0 rounded-lg border border-white/10 bg-white/10 p-2 text-blue-100 transition-colors hover:bg-white/20 disabled:opacity-50"><X className="h-5 w-5" /></button>
              </div>
            </div>
            <div className="dispatch-group-settings-fields px-4 py-4 sm:px-6">
              <div className="grid gap-5 lg:grid-cols-2 lg:gap-6">
                <div className="min-w-0 space-y-4">
                  <section className="min-w-0 space-y-2">
                    <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-400/20 text-xs font-bold text-sky-200">01</span><h4 className="font-semibold text-sky-100">基本資料</h4></div>
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-slate-200">
                        分組名稱 *
                        <input className={`${inputClass} mt-1 sm:ml-3 sm:max-w-40`} value={groupDraft.group_name ?? ''} disabled={busy}
                          onChange={(event) => setGroupDraft({ ...groupDraft, group_name: event.target.value })} />
                      </label>
                      <label className="block text-sm font-medium text-slate-200">
                        說明
                        <textarea className={`${inputClass} mt-1 min-h-14 resize-y`} value={groupDraft.description ?? ''} disabled={busy}
                          onChange={(event) => setGroupDraft({ ...groupDraft, description: event.target.value })} />
                      </label>
                    </div>
                  </section>
                  <section className="min-w-0 space-y-2 border-t border-slate-700/70 pt-3">
                    <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-400/20 text-xs font-bold text-violet-200">02</span><h4 className="font-semibold text-violet-100">訂單池設定</h4></div>
                    <p className="text-sm font-medium text-violet-100">訂單池選擇模式</p>
                  <div role="group" aria-label="訂單池選擇模式" className="grid grid-cols-3 gap-2">
                    {poolSelectionOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={groupDraft.pool_selection_mode === option.value}
                        disabled={busy}
                        onClick={() => setGroupDraft({ ...groupDraft, pool_selection_mode: option.value })}
                        className={`min-w-0 rounded-xl border px-2 py-2.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50 ${groupDraft.pool_selection_mode === option.value ? option.activeClass : option.inactiveClass}`}
                      >
                        <span className="flex items-start justify-between gap-1 text-xs font-semibold sm:text-sm">
                          {option.label}
                          {groupDraft.pool_selection_mode === option.value && <CheckCircle className="h-4 w-4 shrink-0" />}
                        </span>
                        <span className="mt-1 hidden text-xs opacity-85 sm:block">{option.description}</span>
                      </button>
                    ))}
                  </div>
                  {groupDraft.pool_selection_mode === 'weighted' && (
                    <p className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs leading-relaxed text-amber-100">
                      建立分組後會自動新增基本池，初始概率為 100%；新增其他池後，可在「分組設定」調整各池概率。
                    </p>
                  )}
                  </section>
                </div>
                <div className="min-w-0 space-y-4 lg:border-l lg:border-indigo-300/20 lg:pl-6">
                  <section className="min-w-0 space-y-2">
                    <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-400/20 text-xs font-bold text-cyan-200">03</span><h4 className="font-semibold text-cyan-100">工作與提交時間</h4></div>
                    <div className="grid min-w-0 gap-3 sm:grid-cols-2 sm:gap-5">
                      <div className="min-w-0">
                        <label className="block text-sm font-medium text-slate-200">
                          <span className="block leading-5">工作會話逾時（分鐘）</span>
                          <input type="number" min="1" max="60" className={`${inputClass} mt-1 block sm:max-w-40`}
                            value={groupDraft.session_timeout_minutes ?? ''} disabled={busy}
                            onChange={(event) => setGroupDraft({ ...groupDraft, session_timeout_minutes: event.target.value })} />
                        </label>
                        <p className="mt-1 text-xs leading-relaxed text-cyan-100">接單後尚未提交的期限；已派訂單保留原設定。</p>
                      </div>
                      <div className="min-w-0" role="group" aria-labelledby="create-dispatch-submit-wait-label">
                        <p id="create-dispatch-submit-wait-label" className="text-sm font-medium leading-5 text-slate-200">提交等待時間（秒）</p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
                          <label className="inline-flex items-center gap-2 whitespace-nowrap text-xs font-medium text-slate-200">
                            最短
                            <input type="number" min="3" max="120" className={`${inputClass} !w-20 !px-2`}
                              value={groupDraft.submit_wait_min_seconds ?? ''} disabled={busy}
                              onChange={(event) => setGroupDraft({ ...groupDraft, submit_wait_min_seconds: event.target.value })} />
                          </label>
                          <label className="inline-flex items-center gap-2 whitespace-nowrap text-xs font-medium text-slate-200">
                            最長
                            <input type="number" min="3" max="300" className={`${inputClass} !w-20 !px-2`}
                              value={groupDraft.submit_wait_max_seconds ?? ''} disabled={busy}
                              onChange={(event) => setGroupDraft({ ...groupDraft, submit_wait_max_seconds: event.target.value })} />
                          </label>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-cyan-100">僅影響提交頁動畫，不延長接單或處理期限。</p>
                      </div>
                    </div>
                  </section>
                  <section className="min-w-0 space-y-2 border-t border-slate-700/70 pt-3">
                    <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-400/20 text-xs font-bold text-emerald-200">04</span><h4 className="font-semibold text-emerald-100">訂單收益與成功率</h4></div>
                    <div className="grid min-w-0 gap-y-3 sm:grid-cols-3 sm:gap-x-5">
                      <label className="min-w-0 text-sm font-medium text-slate-200">
                        <span className="block leading-5">佣金率</span>
                        <input type="number" min="0.00001" max="1" step="0.00000001" className={`${inputClass} mt-1 sm:max-w-40`}
                          value={groupDraft.commission_rate ?? ''} disabled={busy}
                          onChange={(event) => setGroupDraft({ ...groupDraft, commission_rate: event.target.value })} />
                        <span className="mt-1 block text-xs font-normal leading-4 text-emerald-300 sm:max-w-40">小數比例：0.00008 = 0.008%；成功訂單計佣。</span>
                      </label>
                      <label className="min-w-0 text-sm font-medium text-slate-200">
                        <span className="block leading-5">搶單成功率（%）</span>
                        <input type="number" min="0" max="100" step="1" className={`${inputClass} mt-1 sm:max-w-40`}
                          value={groupDraft.grab_success_rate ?? ''} disabled={busy}
                          onChange={(event) => setGroupDraft({ ...groupDraft, grab_success_rate: event.target.value })} />
                        <span className="mt-1 block text-xs font-normal leading-4 text-emerald-300 sm:max-w-40">僅影響接單；新派單保存機率。</span>
                      </label>
                      <label className="min-w-0 text-sm font-medium text-slate-200">
                        <span className="block leading-5">提交後訂單成功率（%）</span>
                        <input type="number" min="0" max="100" step="1" className={`${inputClass} mt-1 sm:max-w-40`}
                          value={groupDraft.dispatch_success_rate ?? ''} disabled={busy}
                          onChange={(event) => setGroupDraft({ ...groupDraft, dispatch_success_rate: event.target.value })} />
                        <span className="mt-1 block text-xs font-normal leading-4 text-teal-300 sm:max-w-40">僅影響訂單結果；提交時保存機率。</span>
                      </label>
                    </div>
                  </section>
                  <section className="min-w-0 space-y-2 border-t border-slate-700/70 pt-3">
                    <div className="flex flex-wrap items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-400/20 text-xs font-bold text-amber-200">05</span><h4 className="font-semibold text-amber-100">提款資格</h4><span className="ml-auto rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-xs font-medium text-amber-100">建立後統計成員</span></div>
                    <p className="text-xs leading-relaxed text-slate-300">依所屬分組判斷；員工人數由分組成員自動統計。</p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="min-w-0 text-sm font-medium text-slate-200">
                        最低提款餘額
                        <input type="number" min="0" max="999999999999.99" step="0.01" className={`${inputClass} mt-1 sm:ml-3 sm:max-w-40`}
                          value={groupDraft.withdrawal_amount_threshold ?? ''} disabled={busy}
                          onChange={(event) => setGroupDraft({ ...groupDraft, withdrawal_amount_threshold: event.target.value })} />
                        <span className="mt-1 block text-xs font-normal leading-relaxed text-amber-200/90">按員工目前餘額是否達到此金額判斷。</span>
                      </label>
                      <label className="min-w-0 text-sm font-medium text-slate-200">
                        最低訂單數
                        <input type="number" min="1" max="1000000" step="1" className={`${inputClass} mt-1 sm:ml-3 sm:max-w-40`}
                          value={groupDraft.withdrawal_orders_threshold ?? ''} disabled={busy}
                          onChange={(event) => setGroupDraft({ ...groupDraft, withdrawal_orders_threshold: event.target.value })} />
                        <span className="mt-1 block text-xs font-normal leading-relaxed text-amber-200/90">按所有狀態的訂單筆數計算。</span>
                      </label>
                    </div>
                    <WithdrawalConditionPicker id="create-withdrawal-condition" value={groupDraft.withdrawal_condition_mode}
                      disabled={busy} onChange={(mode) => setGroupDraft((current) => ({ ...current, withdrawal_condition_mode: mode }))} />
                  </section>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-indigo-300/20 bg-slate-950/50 px-4 py-2.5 sm:px-6">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                <span className={`rounded-full px-2 py-1 ${groupDraft.is_active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-200'}`}>{groupDraft.is_active ? '建立時啟用' : '建立時未啟用'}</span>
                <span>基本池會在建立後自動新增。</span>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <button type="button" onClick={() => setGroupForm(null)} disabled={busy} className={`${secondaryButton} min-h-10`}>取消</button>
                <button type="button" disabled={busy || !groupDraft.group_name.trim()} onClick={() => void saveGroup()}
                  className="inline-flex min-h-10 items-center justify-center rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-900/30 transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
                  {busy ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  {busy ? '儲存中…' : '儲存分組'}
                </button>
              </div>
            </div>
          </div>
        </div>, document.body,
      )}

      {poolForm &&
        selectedGroup &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-label={poolForm === 'create' ? '建立訂單池' : '編輯訂單池'}
              className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-600 bg-slate-800 p-5 shadow-2xl"
            >
              <h3 className="mb-1 text-lg font-semibold">
                {poolForm === 'create'
                  ? '建立訂單池'
                  : `設定「${selectedPool ? poolDisplayName(selectedPool) : ''}」`}
              </h3>
              <p className="mb-4 text-xs text-slate-400">
                {groupDisplayName(selectedGroup)} · 訂單池獨立設定
              </p>
              <div className="space-y-3">
                <label className="block text-sm">
                  訂單池名稱 *
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
                    最短派單間隔（秒）
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
                    最長派單間隔（秒）
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
                <label className="block text-sm">
                  池內選單模式
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
                    <option value="random">隨機選單</option>
                    <option value="sequential">依序選單</option>
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
                  啟用訂單池
                </label>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  className={secondaryButton}
                  disabled={busy}
                  onClick={() => setPoolForm(null)}
                >
                  取消
                </button>
                <button
                  className={primaryButton}
                  disabled={busy}
                  onClick={() => void savePool()}
                >
                  {busy ? '儲存中…' : '儲存訂單池'}
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
              aria-label="確認封存"
              className="w-full max-w-md rounded-xl border border-rose-500 bg-slate-800 p-5"
            >
              <h3 className="mb-2 text-lg font-semibold">
                確定封存{archiveTarget.type === 'group' ? '分組' : '訂單池'}？
              </h3>
              <p className="break-words text-sm text-slate-300">
                確定封存「{archiveTarget.name}」？封存後將無法使用，但既有訂單與派單紀錄會保留。
                {archiveTarget.type === 'group' &&
                  ' 此分組的員工將停止接收訂單，直到重新指派分組或還原此分組。'}
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  className={secondaryButton}
                  disabled={busy}
                  onClick={() => setArchiveTarget(null)}
                >
                  取消
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
                  封存
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
              aria-label="確認移動員工"
              className="w-full max-w-md rounded-xl border border-emerald-500 bg-slate-800 p-5"
            >
              <h3 className="mb-2 text-lg font-semibold">確定移動員工？</h3>
              <p className="break-words text-sm text-slate-300">
                確定將 {memberMove.ids.length} 位員工移至「{memberMove.destination}」？原有分組歸屬會被取代，不會留下未指派分組的員工。
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  className={secondaryButton}
                  disabled={busy}
                  onClick={() => setMemberMove(null)}
                >
                  取消
                </button>
                <button
                  className={primaryButton}
                  disabled={busy}
                  onClick={() => void assignMembers()}
                >
                  {busy ? '移動中…' : '確認移動'}
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
              aria-label="確認刪除訂單"
              className="w-full max-w-md rounded-xl border border-rose-500 bg-slate-800 p-5"
            >
              <h3 className="mb-2 text-lg font-semibold">確定刪除訂單？</h3>
              <p className="break-all text-sm text-slate-300">
                {deleteOrder.order_content.slice(0, 200)}
              </p>
              <p className="mt-2 text-xs text-slate-400">
                此訂單將封存，派單紀錄會保留。
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  className={secondaryButton}
                  disabled={busy}
                  onClick={() => setDeleteOrder(null)}
                >
                  取消
                </button>
                <button
                  className="rounded-lg bg-rose-600 px-3 py-2 text-sm text-white disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void manageOrder('delete', deleteOrder.id)}
                >
                  刪除
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
              aria-label="確認刪除全部訂單"
              className="w-full max-w-md rounded-xl border border-rose-500 bg-slate-800 p-5"
            >
              <h3 className="mb-2 text-lg font-semibold">
                確定刪除「{selectedPool ? poolDisplayName(selectedPool) : ''}」的全部訂單？
              </h3>
              <p className="text-sm text-slate-300">
                此訂單池中全部 {selectedPool?.order_count ?? 0} 筆未封存的訂單（包括目前篩選條件隱藏的訂單）都會封存，不影響其他訂單池。
              </p>
              <label className="mt-4 block text-sm">
                請輸入「全部刪除」以確認
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
                  取消
                </button>
                <button
                  className="rounded-lg bg-rose-600 px-3 py-2 text-sm text-white disabled:opacity-50"
                  disabled={busy || deleteConfirmInput !== '全部刪除'}
                  onClick={() => void manageOrder('delete_all')}
                >
                  全部刪除
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
