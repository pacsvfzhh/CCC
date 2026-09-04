import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../lib/supabase';
import { Upload, Trash2, CreditCard as Edit2, Save, X, PackageSearch, Settings, CheckCircle, XCircle, Users, Plus, FolderPlus, Layers, Search, Filter, ChevronDown, ChevronRight, BarChart3, UserPlus, UserMinus, ArrowRight } from 'lucide-react';

interface DispatchGroup {
  id: string;
  group_name: string;
  description: string | null;
  dispatch_interval_min: number;
  dispatch_interval_max: number;
  session_timeout_minutes: number;
  dispatch_order_mode: 'random' | 'sequential';
  dispatch_success_rate: number;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  order_count?: number;
  member_count?: number;
}

interface DispatchOrder {
  id: string;
  group_id: string;
  order_content: string;
  is_active: boolean;
  created_at: string;
  created_by: string;
}

interface Employee {
  id: string;
  username: string;
  wallet_balance: number;
  is_verified: boolean;
  created_at: string;
  created_by?: string;
  group_id?: string;
  group_name?: string;
  is_own_employee?: boolean;
  remarks?: string;
  tags?: string[];
}

interface AdminGroup {
  admin_id: string;
  admin_username: string;
  employees: Employee[];
  expanded: boolean;
}

interface Notification {
  type: 'success' | 'error';
  message: string;
}

export default function DispatchManagement() {
  const [groups, setGroups] = useState<DispatchGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<DispatchGroup | null>(null);
  const [hasManuallySelectedGroup, setHasManuallySelectedGroup] = useState(false);
  const [orders, setOrders] = useState<DispatchOrder[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [bulkInput, setBulkInput] = useState('');
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const ordersPerPage = 20;
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [notification, setNotification] = useState<Notification | null>(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showEditGroup, setShowEditGroup] = useState(false);
  const [showMemberManagement, setShowMemberManagement] = useState(false);
  const [newGroup, setNewGroup] = useState({
    group_name: '',
    description: '',
    dispatch_interval_min: 30,
    dispatch_interval_max: 120,
    session_timeout_minutes: 10,
    dispatch_order_mode: 'random' as 'random' | 'sequential',
    dispatch_success_rate: 100,
  });
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [employeeSearchQuery, setEmployeeSearchQuery] = useState('');
  const [groupsExpanded, setGroupsExpanded] = useState(true);
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [adminGroups, setAdminGroups] = useState<AdminGroup[]>([]);
  const [expandedAdmins, setExpandedAdmins] = useState<Set<string>>(new Set());
  const [selectedAdminFilter, setSelectedAdminFilter] = useState<string | null>(null);
  const [assignedEmployeesSelection, setAssignedEmployeesSelection] = useState<string[]>([]);
  const [unassignedEmployeesSelection, setUnassignedEmployeesSelection] = useState<string[]>([]);
  const [assignedSelectedTags, setAssignedSelectedTags] = useState<string[]>([]);
  const [unassignedSelectedTags, setUnassignedSelectedTags] = useState<string[]>([]);
  const [isOptimisticUpdate, setIsOptimisticUpdate] = useState(false);
  const [showMoveConfirm, setShowMoveConfirm] = useState(false);

  const [employeeToMove, setEmployeeToMove] = useState<{id: string, username: string, fromGroup: string} | null>(null);
  const [showDeleteGroupConfirm, setShowDeleteGroupConfirm] = useState(false);
  const [groupToDelete, setGroupToDelete] = useState<{id: string, name: string, isDefault: boolean} | null>(null);
  const [isBulkImporting, setIsBulkImporting] = useState(false);
  const itemsPerPage = 500;
  const [isLoadingPage, setIsLoadingPage] = useState(false);
  const [jumpToPage, setJumpToPage] = useState('');
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0, percentage: 0 });
  const [isUploading, setIsUploading] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ current: 0, total: 0, percentage: 0 });
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteOrderConfirm, setShowDeleteOrderConfirm] = useState(false);
  const [orderToDelete, setOrderToDelete] = useState<{id: string, content: string} | null>(null);

  const isAnyModalOpen = showBulkImport || showDeleteConfirm || showCreateGroup || showEditGroup || showMemberManagement || showMoveConfirm || showDeleteGroupConfirm || showDeleteOrderConfirm || (isDeleting && deleteProgress.total > 0);

  useEffect(() => {
    if (isAnyModalOpen) {
      const scrollY = window.scrollY;
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.left = '0';
      document.body.style.right = '0';
      document.body.style.width = '100%';
      return () => {
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.left = '';
        document.body.style.right = '';
        document.body.style.width = '';
        window.scrollTo(0, scrollY);
      };
    }
  }, [isAnyModalOpen]);

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  useEffect(() => {
    checkAdminRole();
    loadGroups();
  }, []);

  useEffect(() => {
    if (selectedGroup) {
      loadOrders();
      loadEmployees();
    }
  }, [selectedGroup?.id, filterStatus]);

  useEffect(() => {
    let debounceEmployees: ReturnType<typeof setTimeout> | null = null;
    let debounceGroups: ReturnType<typeof setTimeout> | null = null;
    let debounceOrders: ReturnType<typeof setTimeout> | null = null;
    const debouncedLoadEmployees = () => {
      if (debounceEmployees) clearTimeout(debounceEmployees);
      debounceEmployees = setTimeout(() => { loadEmployees(); }, 800);
    };
    const debouncedLoadGroups = () => {
      if (debounceGroups) clearTimeout(debounceGroups);
      debounceGroups = setTimeout(() => { loadGroups(); }, 800);
    };
    const debouncedLoadOrders = () => {
      if (debounceOrders) clearTimeout(debounceOrders);
      debounceOrders = setTimeout(() => { loadOrders(); }, 800);
    };

    const usersChannel = supabase
      .channel('dispatch-users-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => {
        if (selectedGroup && !isOptimisticUpdate && !isBulkImporting) {
          debouncedLoadEmployees();
        }
      })
      .subscribe();

    const adminsChannel = supabase
      .channel('dispatch-admins-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admins' }, () => {
        if (selectedGroup && !isOptimisticUpdate && !isBulkImporting) {
          debouncedLoadEmployees();
        }
      })
      .subscribe();

    const membersChannel = supabase
      .channel('dispatch-members-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dispatch_group_members' }, () => {
        if (!isOptimisticUpdate && !isBulkImporting) {
          debouncedLoadGroups();
          if (selectedGroup) {
            debouncedLoadEmployees();
          }
        }
      })
      .subscribe();

    const groupsChannel = supabase
      .channel('dispatch-groups-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dispatch_groups' }, () => {
        if (!isOptimisticUpdate && !isBulkImporting) {
          debouncedLoadGroups();
        }
      })
      .subscribe();

    const ordersChannel = supabase
      .channel('dispatch-orders-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dispatch_group_orders' }, () => {
        if (!isOptimisticUpdate && !isBulkImporting) {
          if (selectedGroup) {
            debouncedLoadOrders();
          }
          debouncedLoadGroups();
        }
      })
      .subscribe();

    return () => {
      if (debounceEmployees) clearTimeout(debounceEmployees);
      if (debounceGroups) clearTimeout(debounceGroups);
      if (debounceOrders) clearTimeout(debounceOrders);
      supabase.removeChannel(usersChannel);
      supabase.removeChannel(adminsChannel);
      supabase.removeChannel(membersChannel);
      supabase.removeChannel(groupsChannel);
      supabase.removeChannel(ordersChannel);
    };
  }, [selectedGroup, isOptimisticUpdate, isBulkImporting]);

  const checkAdminRole = () => {
    const auth = sessionStorage.getItem('quantum_trader_auth');
    if (auth) {
      const { user } = JSON.parse(auth);
      setIsSuperAdmin(user.role === 'super_admin');
    }
  };

  const loadGroups = async () => {
    try {
      const auth = sessionStorage.getItem('quantum_trader_auth');
      const currentAdmin = auth ? JSON.parse(auth).user : null;
      const isCurrentSuperAdmin = currentAdmin?.role === 'super_admin';

      console.log(`[loadGroups] Current Admin: ${currentAdmin?.username}, Role: ${currentAdmin?.role}, isSuperAdmin: ${isCurrentSuperAdmin}`);

      const { data, error } = await supabase
        .from('dispatch_groups')
        .select('*')
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Non-super admins can see all groups, but member counts will reflect only their own employees
      const groupsWithCounts = await Promise.all(
        (data || []).map(async (group) => {
          const { count: orderCount } = await supabase
            .from('dispatch_group_orders')
            .select('*', { count: 'exact', head: true })
            .eq('group_id', group.id);

          let memberCount = 0;

          if (group.is_default) {
            // For default group, count employees NOT assigned to any group
            let userQuery = supabase
              .from('users')
              .select('*', { count: 'exact', head: true });

            // If not super admin, only count own employees
            if (currentAdmin && !isCurrentSuperAdmin) {
              userQuery = userQuery.eq('created_by', currentAdmin.id);
            }

            const { count: totalUsers } = await userQuery;

            // Count assigned employees
            let assignedCount = 0;
            if (currentAdmin && !isCurrentSuperAdmin) {
              // Count how many of their employees are assigned to groups
              const { data: ownAssignedMembers } = await supabase
                .from('dispatch_group_members')
                .select('user_id, users!inner(created_by)')
                .eq('users.created_by', currentAdmin.id);

              assignedCount = ownAssignedMembers?.length || 0;
            } else {
              // Count all assigned employees
              const { data: allAssignedMembers } = await supabase
                .from('dispatch_group_members')
                .select('user_id');

              assignedCount = allAssignedMembers?.length || 0;
            }

            memberCount = (totalUsers || 0) - assignedCount;
          } else {
            // For regular groups, count members explicitly assigned to this group
            if (currentAdmin && !isCurrentSuperAdmin) {
              // Count only own employees in this group
              // First get all members of this group
              const { data: groupMembers } = await supabase
                .from('dispatch_group_members')
                .select('user_id')
                .eq('group_id', group.id);

              console.log(`[SecondaryAdmin ${currentAdmin.username}] Group: ${group.group_name}, Total Members: ${groupMembers?.length || 0}`);

              if (groupMembers && groupMembers.length > 0) {
                // Then filter by created_by
                const userIds = groupMembers.map(m => m.user_id);
                const { count } = await supabase
                  .from('users')
                  .select('*', { count: 'exact', head: true })
                  .in('id', userIds)
                  .eq('created_by', currentAdmin.id);

                memberCount = count || 0;
                console.log(`[SecondaryAdmin ${currentAdmin.username}] Group: ${group.group_name}, Own Members: ${memberCount}`);
              } else {
                memberCount = 0;
              }
            } else {
              // Count all employees in this group
              const { count, error: countError } = await supabase
                .from('dispatch_group_members')
                .select('*', { count: 'exact', head: true })
                .eq('group_id', group.id);

              if (countError) {
                console.error(`Error counting members for group ${group.group_name}:`, countError);
              }

              memberCount = count || 0;
              console.log(`[SuperAdmin] Group: ${group.group_name}, Member Count: ${memberCount}, Group ID: ${group.id}`);
            }
          }

          return {
            ...group,
            order_count: orderCount || 0,
            member_count: memberCount,
          };
        })
      );

      setGroups(groupsWithCounts);

      // Update selectedGroup if it exists in the new list
      if (selectedGroup) {
        const updatedGroup = groupsWithCounts.find(g => g.id === selectedGroup.id);
        if (updatedGroup) {
          // Only update if the data has actually changed to avoid unnecessary re-renders
          const hasChanged =
            updatedGroup.order_count !== selectedGroup.order_count ||
            updatedGroup.member_count !== selectedGroup.member_count ||
            updatedGroup.group_name !== selectedGroup.group_name ||
            updatedGroup.is_active !== selectedGroup.is_active;

          if (hasChanged) {
            setSelectedGroup(updatedGroup);
          }
        }
      } else if (groupsWithCounts.length > 0 && !hasManuallySelectedGroup) {
        setSelectedGroup(groupsWithCounts.find(g => g.is_default) || groupsWithCounts[0]);
        setHasManuallySelectedGroup(true);
      }
    } catch (error: any) {
      showNotification('error', 'Failed to load groups: ' + error.message);
    }
  };

  const loadOrders = async (page: number = 1, showLoading: boolean = false, retryCount: number = 0) => {
    if (!selectedGroup) {
      setOrders([]);
      setTotalCount(0);
      return;
    }

    if (selectedGroup.id.startsWith('temp-')) {
      setOrders([]);
      setTotalCount(0);
      return;
    }

    // Prevent multiple simultaneous loads
    if (isLoadingOrders) {
      console.log('[loadOrders] Already loading, skipping...');
      return;
    }

    if (showLoading) {
      setIsLoadingPage(true);
    }
    setIsLoadingOrders(true);

    try {
      const from = (page - 1) * itemsPerPage;
      const to = from + itemsPerPage - 1;

      console.log(`[loadOrders] Loading orders for group: ${selectedGroup.group_name} (${selectedGroup.id}), page: ${page}`);

      let query = supabase
        .from('dispatch_group_orders')
        .select('*', { count: 'exact' })
        .eq('group_id', selectedGroup.id)
        .order('created_at', { ascending: true })
        .range(from, to);

      if (filterStatus !== 'all') {
        query = query.eq('is_active', filterStatus === 'active');
      }

      const { data, error, count } = await query;

      if (error) {
        console.error('[loadOrders] Query error:', error);
        throw error;
      }

      console.log(`[loadOrders] Loaded ${data?.length || 0} orders, total count: ${count}`);

      setOrders(data || []);
      setTotalCount(count || 0);
      setCurrentPage(page);
    } catch (error: any) {
      console.error('[loadOrders] Failed to load orders:', error);

      // Retry once after a short delay if it's a network error
      if (retryCount === 0 && (error.message.includes('fetch') || error.message.includes('network'))) {
        console.log('[loadOrders] Retrying after network error...');
        setIsLoadingOrders(false);
        setTimeout(() => {
          loadOrders(page, showLoading, 1);
        }, 1000);
        return;
      }

      showNotification('error', 'Failed to load orders: ' + error.message);
      setOrders([]);
      setTotalCount(0);
    } finally {
      setIsLoadingOrders(false);
      if (showLoading) {
        setIsLoadingPage(false);
      }
    }
  };

  const loadEmployees = async () => {
    if (!selectedGroup) return;

    try {
      const auth = sessionStorage.getItem('quantum_trader_auth');
      const currentAdmin = auth ? JSON.parse(auth).user : null;

      let employeeQuery = supabase
        .from('users')
        .select(`
          id,
          username,
          is_verified,
          created_at,
          created_by,
          remarks,
          tags,
          wallets(available_balance, frozen_balance)
        `);

      // If not super admin, only show employees created by this admin
      if (currentAdmin && !isSuperAdmin) {
        employeeQuery = employeeQuery.eq('created_by', currentAdmin.id);
      }

      const { data: allEmployees, error: empError } = await employeeQuery.order('username', { ascending: true });

      if (empError) throw empError;

      const { data: memberships, error: memError } = await supabase
        .from('dispatch_group_members')
        .select(`
          user_id,
          group_id,
          dispatch_groups(group_name)
        `);

      if (memError) throw memError;

      const employeesWithGroups = (allEmployees || []).map(emp => {
        const membership = memberships?.find(m => m.user_id === emp.id);
        const wallet = Array.isArray(emp.wallets) ? emp.wallets[0] : emp.wallets;
        const wallet_balance = wallet ? Number(wallet.available_balance) + Number(wallet.frozen_balance) : 0;
        const isOwnEmployee = currentAdmin && emp.created_by === currentAdmin.id;

        return {
          ...emp,
          wallet_balance,
          group_id: membership?.group_id,
          group_name: membership ? (membership.dispatch_groups as any)?.group_name : undefined,
          is_own_employee: isOwnEmployee,
        };
      });

      setEmployees(employeesWithGroups);

      // Group ALL employees by admin (not just unassigned)
      const adminMap = new Map<string, AdminGroup>();

      // Load ALL admin usernames
      let adminsQuery = supabase
        .from('admins')
        .select('id, username');

      // If not super admin, only show this admin
      if (currentAdmin && !isSuperAdmin) {
        adminsQuery = adminsQuery.eq('id', currentAdmin.id);
      }

      const { data: admins } = await adminsQuery.order('username', { ascending: true });

      // Initialize all admins with empty employee lists
      (admins || []).forEach(admin => {
        adminMap.set(admin.id, {
          admin_id: admin.id,
          admin_username: admin.username,
          employees: [],
          expanded: expandedAdmins.has(admin.id),
        });
      });

      // Add ALL employees to their respective admin groups
      employeesWithGroups.forEach(emp => {
        const adminId = emp.created_by || 'unknown';

        if (adminMap.has(adminId)) {
          adminMap.get(adminId)!.employees.push(emp);
        } else {
          // Handle employees with unknown/deleted admin
          if (!adminMap.has('unknown')) {
            adminMap.set('unknown', {
              admin_id: 'unknown',
              admin_username: 'Unknown Admin',
              employees: [],
              expanded: expandedAdmins.has('unknown'),
            });
          }
          adminMap.get('unknown')!.employees.push(emp);
        }
      });

      setAdminGroups(Array.from(adminMap.values()).sort((a, b) =>
        a.admin_username.localeCompare(b.admin_username)
      ));
    } catch (error: any) {
      showNotification('error', 'Failed to load employees: ' + error.message);
    }
  };

  const handleCreateGroup = async () => {
    if (!newGroup.group_name.trim()) {
      showNotification('error', 'Group name is required');
      return;
    }

    setLoading(true);
    setIsOptimisticUpdate(true);

    try {
      const auth = sessionStorage.getItem('quantum_trader_auth');
      const adminId = auth ? JSON.parse(auth).user.id : null;

      // Create optimistic group object
      const optimisticGroup: DispatchGroup = {
        id: 'temp-' + Date.now(), // Temporary ID
        ...newGroup,
        created_by: adminId,
        created_at: new Date().toISOString(),
        is_default: false,
        is_active: true,
        order_count: 0,
        member_count: 0,
      };

      // Optimistic update - add to groups immediately
      setGroups(prev => [...prev, optimisticGroup]);
      setSelectedGroup(optimisticGroup);
      setShowCreateGroup(false);

      // Reset form
      const formData = { ...newGroup };
      setNewGroup({
        group_name: '',
        description: '',
        dispatch_interval_min: 30,
        dispatch_interval_max: 120,
        session_timeout_minutes: 10,
        dispatch_order_mode: 'random',
        dispatch_success_rate: 100,
      });

      // Perform actual database insert
      const { data, error } = await supabase
        .from('dispatch_groups')
        .insert({
          ...formData,
          created_by: adminId,
        })
        .select()
        .single();

      if (error) throw error;

      // Replace optimistic group with real data
      if (data) {
        setGroups(prev => prev.map(g =>
          g.id === optimisticGroup.id
            ? { ...data, order_count: 0, member_count: 0 }
            : g
        ));
        setSelectedGroup({
          ...data,
          order_count: 0,
          member_count: 0,
        });
      }

      showNotification('success', 'Group created successfully');

      // Allow realtime updates after a short delay
      setTimeout(() => {
        setIsOptimisticUpdate(false);
      }, 1000);
    } catch (error: any) {
      showNotification('error', 'Create group failed: ' + error.message);
      setIsOptimisticUpdate(false);
      // Revert on error - reload to get real data
      loadGroups();
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateGroup = async () => {
    if (!selectedGroup) return;

    setLoading(true);
    setIsOptimisticUpdate(true);

    try {
      // Optimistic update - update local state immediately
      const updatedGroup = {
        ...selectedGroup,
        updated_at: new Date().toISOString(),
      };

      setGroups(prev => prev.map(g =>
        g.id === selectedGroup.id ? updatedGroup : g
      ));
      setShowEditGroup(false);

      // Perform actual database update
      const { error } = await supabase
        .from('dispatch_groups')
        .update({
          group_name: selectedGroup.group_name,
          description: selectedGroup.description,
          dispatch_interval_min: selectedGroup.dispatch_interval_min,
          dispatch_interval_max: selectedGroup.dispatch_interval_max,
          session_timeout_minutes: selectedGroup.session_timeout_minutes,
          dispatch_order_mode: selectedGroup.dispatch_order_mode,
          dispatch_success_rate: selectedGroup.dispatch_success_rate,
          is_active: selectedGroup.is_active,
          updated_at: updatedGroup.updated_at,
        })
        .eq('id', selectedGroup.id);

      if (error) throw error;

      showNotification('success', 'Group updated successfully');

      // Allow realtime updates after a short delay
      setTimeout(() => {
        setIsOptimisticUpdate(false);
      }, 1000);
    } catch (error: any) {
      showNotification('error', 'Update group failed: ' + error.message);
      setIsOptimisticUpdate(false);
      // Revert on error
      loadGroups();
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteGroup = async (groupId: string, isDefault: boolean, groupName: string) => {
    if (isDefault) {
      showNotification('error', 'Cannot delete default group');
      return;
    }

    setGroupToDelete({ id: groupId, name: groupName, isDefault });
    setShowDeleteGroupConfirm(true);
  };

  const confirmDeleteGroup = async () => {
    if (!groupToDelete) return;

    setIsOptimisticUpdate(true);
    setShowDeleteGroupConfirm(false);
    setLoading(true);

    try {
      // Step 1: Remove all member assignments from this group
      const { error: membersError } = await supabase
        .from('dispatch_group_members')
        .delete()
        .eq('group_id', groupToDelete.id);

      if (membersError) throw new Error('Failed to remove group members: ' + membersError.message);

      // Step 2: Delete all orders in this group
      const { error: ordersError } = await supabase
        .from('dispatch_group_orders')
        .delete()
        .eq('group_id', groupToDelete.id);

      if (ordersError) throw new Error('Failed to remove group orders: ' + ordersError.message);

      // Step 3: Optimistic update - remove from local state
      setGroups(prev => prev.filter(g => g.id !== groupToDelete.id));

      if (selectedGroup?.id === groupToDelete.id) {
        const defaultGroup = groups.find(g => g.is_default && g.id !== groupToDelete.id);
        setSelectedGroup(defaultGroup || null);
      }

      // Step 4: Perform actual database delete of the group
      const { error: groupError } = await supabase
        .from('dispatch_groups')
        .delete()
        .eq('id', groupToDelete.id);

      if (groupError) throw new Error('Failed to delete group: ' + groupError.message);

      showNotification('success', 'Group deleted successfully');

      // Allow realtime updates after a short delay
      setTimeout(() => {
        setIsOptimisticUpdate(false);
      }, 1000);
    } catch (error: any) {
      showNotification('error', error.message || 'Delete group failed');
      setIsOptimisticUpdate(false);
      // Revert on error
      loadGroups();
    } finally {
      setGroupToDelete(null);
      setLoading(false);
    }
  };

  const handleBulkImport = async () => {
    if (!isSuperAdmin) {
      showNotification('error', 'Only super admin can import orders');
      return;
    }

    if (!selectedGroup) {
      showNotification('error', 'Please select a group first');
      return;
    }

    if (selectedGroup.id.startsWith('temp-')) {
      showNotification('error', 'Please wait for the group to be saved before importing orders');
      return;
    }

    if (!bulkInput.trim()) {
      showNotification('error', 'Please enter order content');
      return;
    }

    const orderContents = bulkInput
      .split(/\n\s*\n/)
      .map(s => s.trim())
      .filter(s => s);

    if (orderContents.length === 0) {
      showNotification('error', 'No valid order content');
      return;
    }

    if (orderContents.length > 100000) {
      showNotification('error', `Cannot import more than 100,000 orders at once. You are trying to import ${orderContents.length} orders.`);
      return;
    }

    setLoading(true);
    setIsBulkImporting(true);
    setIsOptimisticUpdate(true);
    setIsUploading(true);

    try {
      const auth = sessionStorage.getItem('quantum_trader_auth');
      const adminId = auth ? JSON.parse(auth).user.id : null;

      const ordersToInsert = orderContents.map(content => ({
        group_id: selectedGroup.id,
        order_content: content,
        is_active: true,
        created_by: adminId,
      }));

      setUploadProgress({ current: 0, total: ordersToInsert.length, percentage: 0 });

      const BATCH_SIZE = 2000;
      const totalBatches = Math.ceil(ordersToInsert.length / BATCH_SIZE);
      let successCount = 0;

      for (let i = 0; i < totalBatches; i++) {
        const start = i * BATCH_SIZE;
        const end = Math.min((i + 1) * BATCH_SIZE, ordersToInsert.length);
        const batch = ordersToInsert.slice(start, end);

        const { error } = await supabase
          .from('dispatch_group_orders')
          .insert(batch);

        if (error) {
          throw new Error(`Batch ${i + 1}/${totalBatches} failed: ${error.message}`);
        }

        successCount += batch.length;
        const percentage = Math.round((successCount / ordersToInsert.length) * 100);

        setUploadProgress({
          current: successCount,
          total: ordersToInsert.length,
          percentage: percentage
        });
      }

      const updatedGroups = groups.map(g =>
        g.id === selectedGroup.id
          ? { ...g, order_count: (g.order_count || 0) + orderContents.length }
          : g
      );
      setGroups(updatedGroups);

      if (selectedGroup) {
        setSelectedGroup({
          ...selectedGroup,
          order_count: (selectedGroup.order_count || 0) + orderContents.length
        });
      }

      showNotification('success', `Successfully imported ${orderContents.length} orders to ${selectedGroup.group_name}`);
      setBulkInput('');
      setShowBulkImport(false);

      const waitTime = orderContents.length > 5000 ? 3000 : 1500;
      setTimeout(() => {
        setIsBulkImporting(false);
        setIsOptimisticUpdate(false);
        setIsUploading(false);
        setUploadProgress({ current: 0, total: 0, percentage: 0 });
        loadOrders();
        loadGroups();
      }, waitTime);
    } catch (error: any) {
      showNotification('error', 'Import failed: ' + error.message);
      setIsBulkImporting(false);
      setIsOptimisticUpdate(false);
      setIsUploading(false);
      setUploadProgress({ current: 0, total: 0, percentage: 0 });
      loadOrders();
      loadGroups();
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (id: string, content: string) => {
    if (!isSuperAdmin) {
      showNotification('error', 'Only super admin can delete orders');
      return;
    }

    setOrderToDelete({ id, content });
    setShowDeleteOrderConfirm(true);
  };

  const confirmDeleteOrder = async () => {
    if (!orderToDelete) return;

    try {
      setIsOptimisticUpdate(true);

      const { error } = await supabase
        .from('dispatch_group_orders')
        .delete()
        .eq('id', orderToDelete.id);

      if (error) throw error;

      // Optimistic update: immediately decrease the group's order count
      const updatedGroups = groups.map(g =>
        g.id === selectedGroup?.id
          ? { ...g, order_count: Math.max(0, (g.order_count || 0) - 1) }
          : g
      );
      setGroups(updatedGroups);

      if (selectedGroup) {
        setSelectedGroup({
          ...selectedGroup,
          order_count: Math.max(0, (selectedGroup.order_count || 0) - 1)
        });
      }

      // Remove from local state immediately
      setOrders(prevOrders => prevOrders.filter(order => order.id !== orderToDelete.id));
      setTotalCount(prev => Math.max(0, prev - 1));

      showNotification('success', 'Order deleted successfully');
      setShowDeleteOrderConfirm(false);
      setOrderToDelete(null);

      setTimeout(() => {
        setIsOptimisticUpdate(false);
        loadGroups();
      }, 1000);
    } catch (error: any) {
      showNotification('error', 'Delete failed: ' + error.message);
      setShowDeleteOrderConfirm(false);
      setOrderToDelete(null);
      setIsOptimisticUpdate(false);
    }
  };

  const handleDeleteAll = () => {
    if (!isSuperAdmin) {
      showNotification('error', 'Only super admin can delete orders');
      return;
    }

    setShowDeleteConfirm(true);
    setDeleteConfirmInput('');
  };

  const confirmDeleteAll = async () => {
    if (deleteConfirmInput !== 'DELETE ALL') {
      return;
    }

    if (!selectedGroup) return;

    if (selectedGroup.id.startsWith('temp-')) {
      showNotification('error', 'Please wait for the group to be saved');
      setShowDeleteConfirm(false);
      return;
    }

    setLoading(true);
    setShowDeleteConfirm(false);
    setIsOptimisticUpdate(true);
    setIsDeleting(true);

    try {
      const totalToDelete = totalCount;
      const BATCH_SIZE = 5000; // Delete 5000 orders at a time
      const LARGE_BATCH_THRESHOLD = 10000; // Use batch delete for > 10K orders

      console.log(`[Delete All] Starting deletion of ${totalToDelete} orders from ${selectedGroup.group_name}`);

      // For small batches, use single delete
      if (totalToDelete <= LARGE_BATCH_THRESHOLD) {
        setDeleteProgress({ current: 0, total: totalToDelete, percentage: 0 });

        const { error } = await supabase
          .from('dispatch_group_orders')
          .delete()
          .eq('group_id', selectedGroup.id);

        if (error) throw error;

        setDeleteProgress({ current: totalToDelete, total: totalToDelete, percentage: 100 });
        console.log(`[Delete All] Deleted ${totalToDelete} orders in single operation`);
      } else {
        // For large batches, use database function for efficient batch deletion
        console.log(`[Delete All] Using batch deletion function (${BATCH_SIZE} per batch)`);

        let totalDeleted = 0;
        let hasMore = true;
        let batchCount = 0;

        while (hasMore && totalDeleted < totalToDelete) {
          batchCount++;
          console.log(`[Delete All] Processing batch ${batchCount}...`);

          // Call database function to delete a batch
          const { data, error: rpcError } = await supabase.rpc('batch_delete_dispatch_orders', {
            p_group_id: selectedGroup.id,
            p_batch_size: BATCH_SIZE
          });

          if (rpcError) {
            console.error(`[Delete All] Batch ${batchCount} RPC error:`, rpcError);
            throw rpcError;
          }

          const deletedCount = data || 0;
          totalDeleted += deletedCount;

          const percentage = Math.min(100, Math.round((totalDeleted / totalToDelete) * 100));

          setDeleteProgress({
            current: totalDeleted,
            total: totalToDelete,
            percentage
          });

          console.log(`[Delete All] Batch ${batchCount}: Deleted ${deletedCount} orders. Total: ${totalDeleted}/${totalToDelete} (${percentage}%)`);

          // If we deleted less than BATCH_SIZE, we're done
          if (deletedCount < BATCH_SIZE) {
            hasMore = false;
            console.log(`[Delete All] Last batch completed (${deletedCount} < ${BATCH_SIZE})`);
          }

          // Small delay between batches to avoid overwhelming the database
          if (hasMore) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }

        console.log(`[Delete All] Completed deletion of ${totalDeleted} orders in ${batchCount} batches`);
      }

      // Immediately update UI optimistically
      setOrders([]);
      setTotalCount(0);
      setCurrentPage(1);

      const updatedGroups = groups.map(g =>
        g.id === selectedGroup.id
          ? { ...g, order_count: 0 }
          : g
      );
      setGroups(updatedGroups);

      // Update selectedGroup's order_count
      if (selectedGroup) {
        setSelectedGroup({
          ...selectedGroup,
          order_count: 0
        });
      }

      showNotification('success', `Successfully deleted all ${totalToDelete.toLocaleString()} orders from ${selectedGroup.group_name}`);
      setDeleteConfirmInput('');

      // Re-enable real-time updates and refresh data
      setTimeout(() => {
        setIsOptimisticUpdate(false);
        setIsDeleting(false);
        setDeleteProgress({ current: 0, total: 0, percentage: 0 });
      }, 500);

      // Refresh from database after a short delay to ensure DB is updated
      setTimeout(() => {
        loadGroups();
      }, 800);
    } catch (error: any) {
      console.error('[Delete All] Error:', error);
      showNotification('error', 'Delete all failed: ' + error.message);
      setIsOptimisticUpdate(false);
      setIsDeleting(false);
      setDeleteProgress({ current: 0, total: 0, percentage: 0 });
      loadOrders();
      loadGroups();
    } finally {
      setLoading(false);
    }
  };

  const cancelDeleteAll = () => {
    setShowDeleteConfirm(false);
    setDeleteConfirmInput('');
  };

  const handleToggleActive = async (id: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('dispatch_group_orders')
        .update({ is_active: !currentStatus })
        .eq('id', id);

      if (error) throw error;
      loadOrders();
    } catch (error: any) {
      showNotification('error', 'Update status failed: ' + error.message);
    }
  };

  const startEdit = (order: DispatchOrder) => {
    setEditingId(order.id);
    setEditContent(order.order_content);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditContent('');
  };

  const saveEdit = async () => {
    if (!editContent.trim()) {
      showNotification('error', 'Order content cannot be empty');
      return;
    }

    if (!editingId) {
      return;
    }

    try {
      // Set flag to prevent realtime updates from reloading
      setIsOptimisticUpdate(true);

      const { error } = await supabase
        .from('dispatch_group_orders')
        .update({ order_content: editContent, updated_at: new Date().toISOString() })
        .eq('id', editingId);

      if (error) throw error;

      // Update local state to keep the order in place
      setOrders(prevOrders =>
        prevOrders.map(order =>
          order.id === editingId
            ? { ...order, order_content: editContent, updated_at: new Date().toISOString() }
            : order
        )
      );

      showNotification('success', 'Order updated successfully');
      cancelEdit();

      // Reset flag after a short delay to allow realtime event to pass
      setTimeout(() => {
        setIsOptimisticUpdate(false);
      }, 1000);
    } catch (error: any) {
      showNotification('error', 'Save failed: ' + error.message);
      setIsOptimisticUpdate(false);
    }
  };

  const handleAddMember = async (userId: string) => {
    if (!selectedGroup) return;

    try {
      const auth = sessionStorage.getItem('quantum_trader_auth');
      const adminId = auth ? JSON.parse(auth).user.id : null;

      const existingMember = await supabase
        .from('dispatch_group_members')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (existingMember.data) {
        await supabase
          .from('dispatch_group_members')
          .delete()
          .eq('user_id', userId);
      }

      const { error } = await supabase
        .from('dispatch_group_members')
        .insert({
          group_id: selectedGroup.id,
          user_id: userId,
          assigned_by: adminId,
        });

      if (error) throw error;

      showNotification('success', 'Employee added to group successfully');
      setSelectedEmployees([]);
      await loadEmployees();
      await loadGroups();
    } catch (error: any) {
      showNotification('error', 'Add member failed: ' + error.message);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    try {
      const { error } = await supabase
        .from('dispatch_group_members')
        .delete()
        .eq('user_id', userId);

      if (error) throw error;

      showNotification('success', 'Employee removed from group successfully');
      setSelectedEmployees([]);
      await loadEmployees();
      await loadGroups();
    } catch (error: any) {
      showNotification('error', 'Remove member failed: ' + error.message);
    }
  };

  const handleMoveEmployee = async () => {
    if (!employeeToMove || !selectedGroup) return;

    setLoading(true);
    setIsOptimisticUpdate(true);
    setShowMoveConfirm(false);

    try {
      const auth = sessionStorage.getItem('quantum_trader_auth');
      const adminId = auth ? JSON.parse(auth).user.id : null;

      // Optimistic update
      const updatedEmployees = employees.map(e =>
        e.id === employeeToMove.id
          ? { ...e, group_id: selectedGroup.id, group_name: selectedGroup.group_name }
          : e
      );
      setEmployees(updatedEmployees);

      // Update admin groups
      const updatedAdminGroups = adminGroups.map(ag => ({
        ...ag,
        employees: ag.employees.map(e =>
          e.id === employeeToMove.id
            ? { ...e, group_id: selectedGroup.id, group_name: selectedGroup.group_name }
            : e
        ),
      }));
      setAdminGroups(updatedAdminGroups);

      // Update group counts optimistically
      const oldGroupId = employees.find(e => e.id === employeeToMove.id)?.group_id;
      const updatedGroups = groups.map(g => {
        // Destination group: increase count
        if (g.id === selectedGroup.id) {
          return { ...g, member_count: (g.member_count || 0) + 1 };
        }
        // Source group (if employee was in an assigned group): decrease count
        if (oldGroupId && g.id === oldGroupId) {
          return { ...g, member_count: Math.max(0, (g.member_count || 0) - 1) };
        }
        // Default group: if employee was unassigned (no oldGroupId), decrease count
        if (!oldGroupId && g.is_default) {
          return { ...g, member_count: Math.max(0, (g.member_count || 0) - 1) };
        }
        return g;
      });
      setGroups(updatedGroups);

      // Database update
      await supabase
        .from('dispatch_group_members')
        .delete()
        .eq('user_id', employeeToMove.id);

      const { error } = await supabase
        .from('dispatch_group_members')
        .insert({
          group_id: selectedGroup.id,
          user_id: employeeToMove.id,
          assigned_by: adminId,
        });

      if (error) throw error;

      showNotification('success', `Moved ${employeeToMove.username} to ${selectedGroup.group_name}`);

      // Reload groups to get accurate member counts (especially for default group)
      setTimeout(async () => {
        await loadGroups();
        setIsOptimisticUpdate(false);
      }, 500);
    } catch (error: any) {
      showNotification('error', 'Move failed: ' + error.message);
      setIsOptimisticUpdate(false);
      loadEmployees();
      loadGroups();
    } finally {
      setLoading(false);
      setEmployeeToMove(null);
    }
  };

  const handleBulkAddMembers = async () => {
    if (!selectedGroup || selectedEmployees.length === 0) return;

    setLoading(true);
    try {
      const auth = sessionStorage.getItem('quantum_trader_auth');
      const adminId = auth ? JSON.parse(auth).user.id : null;

      await supabase
        .from('dispatch_group_members')
        .delete()
        .in('user_id', selectedEmployees);

      const membersToInsert = selectedEmployees.map(userId => ({
        group_id: selectedGroup.id,
        user_id: userId,
        assigned_by: adminId,
      }));

      const { error } = await supabase
        .from('dispatch_group_members')
        .insert(membersToInsert);

      if (error) throw error;

      showNotification('success', `Added ${selectedEmployees.length} employees to group`);
      setSelectedEmployees([]);
      await loadEmployees();
      await loadGroups();
    } catch (error: any) {
      showNotification('error', 'Bulk add failed: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleBulkRemoveMembers = async () => {
    if (selectedEmployees.length === 0) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('dispatch_group_members')
        .delete()
        .in('user_id', selectedEmployees);

      if (error) throw error;

      showNotification('success', `Removed ${selectedEmployees.length} employees from groups`);
      setSelectedEmployees([]);
      await loadEmployees();
      await loadGroups();
    } catch (error: any) {
      showNotification('error', 'Bulk remove failed: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const totalPages = Math.ceil(totalCount / ordersPerPage);

  const filteredGroups = groups.filter(g =>
    g.group_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (g.description && g.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const groupMembers = employees.filter(emp =>
    emp.group_id === selectedGroup?.id &&
    (emp.username.toLowerCase().includes(employeeSearchQuery.toLowerCase()))
  );

  const unassignedMembers = employees.filter(emp =>
    !emp.group_id &&
    (emp.username.toLowerCase().includes(employeeSearchQuery.toLowerCase()))
  );

  const allOtherMembers = employees.filter(emp =>
    emp.group_id && emp.group_id !== selectedGroup?.id &&
    (emp.username.toLowerCase().includes(employeeSearchQuery.toLowerCase()))
  );

  // Pagination logic
  const handlePageChange = (page: number) => {
    if (page < 1 || page > orderTotalPages || page === currentPage || isLoadingPage) return;
    loadOrders(page, true);
  };

  const handleJumpToPage = () => {
    const page = parseInt(jumpToPage);
    if (isNaN(page) || page < 1 || page > orderTotalPages) {
      showNotification('error', `Please enter a valid page number (1-${orderTotalPages})`);
      return;
    }
    setJumpToPage('');
    handlePageChange(page);
  };

  const orderTotalPages = Math.ceil(totalCount / itemsPerPage);

  return (
    <div className="space-y-4">
      {notification && (
        <div className={`fixed top-4 right-4 z-50 flex items-center space-x-3 px-6 py-4 rounded-lg shadow-2xl border-2 animate-slide-in ${
          notification.type === 'success'
            ? 'bg-emerald-500/90 border-emerald-400 text-white'
            : 'bg-rose-500/90 border-rose-400 text-white'
        }`}>
          {notification.type === 'success' ? (
            <CheckCircle className="w-5 h-5" />
          ) : (
            <XCircle className="w-5 h-5" />
          )}
          <span className="font-medium">{notification.message}</span>
        </div>
      )}

      <div className="flex items-center justify-end">
        <div className="flex items-center space-x-2">
          {isSuperAdmin && (
            <button
              onClick={() => setShowCreateGroup(true)}
              className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white rounded-lg hover:from-emerald-700 hover:to-emerald-600 transition-all shadow-lg shadow-emerald-500/20"
            >
              <FolderPlus className="w-4 h-4" />
              <span>New Group</span>
            </button>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="bg-gradient-to-br from-slate-800/90 via-slate-800/80 to-slate-900/90 backdrop-blur-sm border border-slate-700/50 rounded-xl shadow-xl">
          <div className="grid grid-cols-12 divide-x divide-slate-700/50">
            <div className="col-span-3 p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2">
                  <Layers className="w-5 h-5 text-blue-400" />
                  <span className="font-semibold text-white">Groups</span>
                  <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded-full">{groups.length}</span>
                </div>
              </div>

              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-white" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search groups..."
                  className="w-full bg-slate-700/70 border border-slate-500 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1.5 max-h-[280px] overflow-y-auto custom-scrollbar pr-2">
                {filteredGroups.map((group) => (
                  <button
                    key={group.id}
                    onClick={() => {
                      setSelectedGroup(group);
                      setHasManuallySelectedGroup(true);
                    }}
                    className={`w-full text-left p-2.5 rounded-lg transition-all ${
                      selectedGroup?.id === group.id
                        ? 'bg-gradient-to-r from-blue-600 to-blue-500 shadow-lg shadow-blue-500/20'
                        : 'bg-slate-700/30 hover:bg-slate-700/50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className={`font-medium text-sm ${
                        selectedGroup?.id === group.id ? 'text-white' : 'text-slate-200'
                      }`}>
                        {group.group_name}
                      </span>
                      {group.is_default && (
                        <span className="px-1.5 py-0.5 bg-amber-500/30 text-amber-300 text-[10px] rounded border border-amber-500/50">Default</span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 text-xs">
                      <div className={selectedGroup?.id === group.id ? 'text-blue-100' : 'text-slate-400'}>
                        <span className="opacity-70">Orders:</span> <span className="font-semibold">{group.order_count || 0}</span>
                      </div>
                      <div className={selectedGroup?.id === group.id ? 'text-blue-100' : 'text-slate-400'}>
                        <span className="opacity-70">Members:</span> <span className="font-semibold">{group.member_count || 0}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="col-span-9">
              {selectedGroup ? (
                <>
                  <div className="p-4 border-b border-slate-700/50">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start space-x-3 flex-1">
                        <div className="w-10 h-10 bg-gradient-to-br from-blue-500/20 to-blue-600/20 rounded-lg flex items-center justify-center border border-blue-500/30 shadow-lg shadow-blue-500/10">
                          <Settings className="w-5 h-5 text-blue-400" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1.5">
                            <h3 className="text-lg font-bold text-white">{selectedGroup.group_name}</h3>
                            {selectedGroup.id.startsWith('temp-') && (
                              <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 text-[10px] font-semibold rounded-full animate-pulse border border-amber-500/30">
                                Saving...
                              </span>
                            )}
                            {selectedGroup.is_default && (
                              <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 text-[10px] font-semibold rounded-full border border-amber-500/30">
                                Default
                              </span>
                            )}
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                              selectedGroup.is_active
                                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                                : 'bg-slate-500/20 text-slate-400 border-slate-500/30'
                            }`}>
                              {selectedGroup.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 leading-relaxed">
                            {selectedGroup.description || 'No description provided for this dispatch group'}
                          </p>
                        </div>
                      </div>
                      <div className="flex space-x-2 ml-4">
                        <button
                          onClick={() => {
                            setShowMemberManagement(true);
                            if (!isSuperAdmin) {
                              const auth = sessionStorage.getItem('quantum_trader_auth');
                              const currentAdmin = auth ? JSON.parse(auth).user : null;
                              if (currentAdmin) {
                                setSelectedAdminFilter(currentAdmin.id);
                              }
                            }
                          }}
                          className="flex items-center space-x-2 px-4 py-2 bg-emerald-600/20 text-emerald-400 text-sm font-medium rounded-lg hover:bg-emerald-600/30 transition-all border border-emerald-600/30 shadow-lg shadow-emerald-500/10"
                        >
                          <Users className="w-4 h-4" />
                          <span>Members</span>
                        </button>
                        {isSuperAdmin && (
                          <button
                            onClick={() => setShowEditGroup(true)}
                            className="flex items-center space-x-2 px-4 py-2 bg-blue-600/20 text-blue-400 text-sm font-medium rounded-lg hover:bg-blue-600/30 transition-all border border-blue-600/30 shadow-lg shadow-blue-500/10"
                          >
                            <Settings className="w-4 h-4" />
                            <span>Config</span>
                          </button>
                        )}
                        {!selectedGroup.is_default && isSuperAdmin && (
                          <button
                            onClick={() => handleDeleteGroup(selectedGroup.id, selectedGroup.is_default, selectedGroup.group_name)}
                            className="flex items-center space-x-2 px-4 py-2 bg-rose-600/20 text-rose-400 text-sm font-medium rounded-lg hover:bg-rose-600/30 transition-all border border-rose-600/30 shadow-lg shadow-rose-500/10"
                          >
                            <Trash2 className="w-4 h-4" />
                            <span>Delete</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="p-4">
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="bg-gradient-to-br from-slate-900/60 to-slate-900/40 rounded-lg p-3 border border-slate-700/40 shadow-lg">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Statistics</span>
                          <BarChart3 className="w-3.5 h-3.5 text-blue-400" />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="bg-slate-800/50 rounded-lg p-2.5 border border-slate-700/30">
                            <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-0.5">Total Orders</div>
                            <div className="text-xl font-bold text-blue-400">{selectedGroup.order_count || 0}</div>
                          </div>
                          <div className="bg-slate-800/50 rounded-lg p-2.5 border border-slate-700/30">
                            <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-0.5">Members</div>
                            <div className="text-xl font-bold text-emerald-400">{selectedGroup.member_count || 0}</div>
                          </div>
                        </div>
                      </div>

                      <div className="bg-gradient-to-br from-slate-900/60 to-slate-900/40 rounded-lg p-3 border border-slate-700/40 shadow-lg">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Dispatch Configuration</span>
                          <Settings className="w-3.5 h-3.5 text-amber-400" />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div className="bg-slate-800/50 rounded-lg p-2.5 border border-slate-700/30">
                            <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-0.5">Dispatch Mode</div>
                            <div className="text-base font-bold text-amber-400 capitalize">{selectedGroup.dispatch_order_mode}</div>
                          </div>
                          <div className="bg-slate-800/50 rounded-lg p-2.5 border border-slate-700/30">
                            <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-0.5">Success Rate</div>
                            <div className={`text-base font-bold ${
                              selectedGroup.dispatch_success_rate === 100 ? 'text-emerald-400' :
                              selectedGroup.dispatch_success_rate >= 80 ? 'text-cyan-400' :
                              selectedGroup.dispatch_success_rate >= 50 ? 'text-amber-400' :
                              'text-rose-400'
                            }`}>
                              {selectedGroup.dispatch_success_rate}%
                            </div>
                          </div>
                          <div className="bg-slate-800/50 rounded-lg p-2.5 border border-slate-700/30">
                            <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-0.5">Timeout</div>
                            <div className="text-base font-bold text-rose-400">{selectedGroup.session_timeout_minutes}m</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-gradient-to-br from-blue-900/20 to-blue-800/10 rounded-lg p-3 border border-blue-700/30 shadow-lg">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider">Dispatch Interval Range</span>
                        <div className="flex items-center space-x-2">
                          <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                          <span className="text-xs text-blue-400 font-medium">Active Range</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-slate-900/40 rounded-lg p-3 border border-slate-700/30 hover:border-blue-500/40 transition-all">
                          <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Minimum</div>
                          <div className="text-2xl font-bold text-blue-400">{selectedGroup.dispatch_interval_min}<span className="text-sm text-blue-500/70">s</span></div>
                          <div className="text-[10px] text-slate-500 mt-1">Shortest wait</div>
                        </div>
                        <div className="bg-slate-900/40 rounded-lg p-3 border border-slate-700/30 hover:border-blue-500/40 transition-all">
                          <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Maximum</div>
                          <div className="text-2xl font-bold text-blue-400">{selectedGroup.dispatch_interval_max}<span className="text-sm text-blue-500/70">s</span></div>
                          <div className="text-[10px] text-slate-500 mt-1">Longest wait</div>
                        </div>
                        <div className="bg-gradient-to-br from-blue-900/30 to-blue-800/20 rounded-lg p-3 border border-blue-600/30">
                          <div className="text-[9px] text-blue-400 uppercase tracking-wider mb-1">Average</div>
                          <div className="text-2xl font-bold text-blue-300">
                            {Math.round((selectedGroup.dispatch_interval_min + selectedGroup.dispatch_interval_max) / 2)}
                            <span className="text-sm text-blue-400/70">s</span>
                          </div>
                          <div className="text-[10px] text-blue-400/80 mt-1">Estimated avg</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-full py-20">
                  <div className="text-center">
                    <Layers className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                    <h3 className="text-xl font-semibold text-slate-400 mb-2">No Group Selected</h3>
                    <p className="text-sm text-slate-500">Select a group from the list to view details</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {selectedGroup && (
          <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-lg">
                <div className="p-4 border-b border-slate-700 bg-gradient-to-r from-slate-800/80 to-slate-800/40 space-y-4">
                  {/* First Row: Title and Group Info */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <h3 className="text-lg font-semibold text-white">Orders Management</h3>
                      <div className="h-8 w-px bg-slate-600"></div>
                      <div className="flex items-center space-x-2.5 px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-500 rounded-lg shadow-lg shadow-blue-500/30 border border-blue-400/50">
                        <Layers className="w-5 h-5 text-white" />
                        <span className="text-base font-bold text-white tracking-wide">{selectedGroup.group_name}</span>
                        {selectedGroup.is_default && (
                          <span className="px-2 py-0.5 bg-white/20 text-white text-xs font-semibold rounded border border-white/30">DEFAULT</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center space-x-3">
                      {isSuperAdmin && (
                        <>
                          <button
                            onClick={handleDeleteAll}
                            disabled={loading || totalCount === 0 || selectedGroup?.id.startsWith('temp-')}
                            className="flex items-center space-x-2 px-4 py-2 bg-rose-600/20 text-rose-400 rounded-lg hover:bg-rose-600/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-rose-600/30"
                          >
                            <Trash2 className="w-4 h-4" />
                            <span className="font-medium">Delete All</span>
                          </button>
                          <button
                            onClick={() => setShowBulkImport(!showBulkImport)}
                            disabled={selectedGroup?.id.startsWith('temp-')}
                            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Upload className="w-4 h-4" />
                            <span className="font-medium">Bulk Import</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Second Row: Filters and Stats */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 px-3 py-2 bg-slate-700/30 rounded-lg border border-slate-600/50">
                      <Filter className="w-4 h-4 text-slate-400" />
                      <span className="text-xs text-slate-400 font-medium">Status:</span>
                      <select
                        value={filterStatus}
                        onChange={(e) => {
                          setFilterStatus(e.target.value as 'all' | 'active' | 'inactive');
                          setCurrentPage(1);
                        }}
                        className="bg-transparent border-none text-sm text-white focus:outline-none focus:ring-0 cursor-pointer"
                      >
                        <option value="all" className="bg-slate-800">All Orders</option>
                        <option value="active" className="bg-slate-800">Active Only</option>
                        <option value="inactive" className="bg-slate-800">Inactive Only</option>
                      </select>
                    </div>

                    <div className="flex items-center space-x-2 px-4 py-2 bg-slate-700/30 rounded-lg border border-slate-600/50">
                      <PackageSearch className="w-4 h-4 text-slate-400" />
                      <span className="text-sm text-slate-400">
                        Total Orders: <span className="text-white font-semibold">{totalCount}</span>
                      </span>
                    </div>
                  </div>
                </div>

                {showBulkImport && (
                  <div className="p-4 border-b border-slate-700 bg-slate-800/80">
                    <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                      <div className="flex items-center gap-2">
                        <Upload className="w-4 h-4 text-blue-400" />
                        <span className="text-sm text-slate-300">
                          Importing to group: <span className="font-semibold text-blue-400">{selectedGroup?.group_name}</span>
                        </span>
                      </div>
                    </div>
                    <div className="mb-3">
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        Import Orders (separate with blank line)
                      </label>
                      <textarea
                        value={bulkInput}
                        onChange={(e) => setBulkInput(e.target.value)}
                        placeholder="Order 1 line 1&#10;Order 1 line 2&#10;&#10;Order 2 content&#10;&#10;Order 3 content"
                        className="w-full h-32 bg-slate-700/50 backdrop-blur-sm border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono text-sm"
                      />
                      <span className="block mt-2 text-yellow-400 text-xs">Maximum 100,000 orders per import</span>
                    </div>

                    {/* Upload Progress Bar */}
                    {isUploading && (
                      <div className="mb-4 p-4 bg-slate-700/50 border border-slate-600 rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center space-x-2">
                            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                            <span className="text-sm font-medium text-white">Uploading Orders...</span>
                          </div>
                          <span className="text-sm font-bold text-blue-400">
                            {uploadProgress.percentage}%
                          </span>
                        </div>

                        {/* Progress Bar */}
                        <div className="relative w-full h-3 bg-slate-800/80 rounded-full overflow-hidden border border-slate-600">
                          <div
                            className="absolute top-0 left-0 h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-300 ease-out shadow-lg shadow-blue-500/30"
                            style={{ width: `${uploadProgress.percentage}%` }}
                          >
                            <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                          </div>
                        </div>

                        {/* Status Text */}
                        <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                          <span>
                            <span className="text-white font-semibold">{uploadProgress.current}</span> / {uploadProgress.total} orders uploaded
                          </span>
                          <span className="text-slate-500">
                            {uploadProgress.total - uploadProgress.current} remaining
                          </span>
                        </div>
                      </div>
                    )}

                    <div className="flex justify-end space-x-2">
                      <button
                        onClick={() => setShowBulkImport(false)}
                        disabled={isUploading}
                        className="px-4 py-2 bg-slate-700 text-white text-sm rounded-lg hover:bg-slate-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleBulkImport}
                        disabled={loading || isUploading}
                        className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {loading ? 'Importing...' : 'Import Orders'}
                      </button>
                    </div>
                  </div>
                )}

                <div className="overflow-x-auto max-h-[600px] overflow-y-auto custom-scrollbar">
                  <table className="w-full">
                    <thead className="bg-slate-700/30 sticky top-0 z-10">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider w-16">
                          No.
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                          Order Content
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider w-24">
                          Status
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider w-40">
                          Created At
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-slate-300 uppercase tracking-wider w-28">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/50">
                      {orders.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-6 py-12 text-center">
                            <PackageSearch className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                            <p className="text-slate-400 text-sm">No orders in this group yet</p>
                          </td>
                        </tr>
                      ) : (
                        orders.map((order, index) => (
                          <tr key={order.id} className={`hover:bg-slate-700/20 transition-all ${editingId === order.id ? 'bg-slate-800/40' : ''}`}>
                            <td className={`px-4 text-center transition-all ${editingId === order.id ? 'py-6' : 'py-3'}`}>
                              <span className="text-sm font-semibold text-slate-400">
                                {((currentPage - 1) * itemsPerPage) + index + 1}
                              </span>
                            </td>
                            <td className={`px-4 transition-all ${editingId === order.id ? 'py-6' : 'py-3'}`}>
                              {editingId === order.id ? (
                                <textarea
                                  value={editContent}
                                  onChange={(e) => setEditContent(e.target.value)}
                                  className="w-full bg-slate-700/50 backdrop-blur-sm border border-slate-600 rounded px-3 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-vertical min-h-[120px]"
                                  rows={6}
                                />
                              ) : (
                                <div className="text-sm text-white line-clamp-2 font-mono">
                                  {order.order_content}
                                </div>
                              )}
                            </td>
                            <td className={`px-4 whitespace-nowrap transition-all ${editingId === order.id ? 'py-6' : 'py-3'}`}>
                              <button
                                onClick={() => handleToggleActive(order.id, order.is_active)}
                                className={`px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                                  order.is_active
                                    ? 'bg-emerald-500/20 text-emerald-400'
                                    : 'bg-slate-500/20 text-slate-400'
                                }`}
                              >
                                {order.is_active ? 'Active' : 'Inactive'}
                              </button>
                            </td>
                            <td className={`px-4 whitespace-nowrap text-xs text-slate-400 transition-all ${editingId === order.id ? 'py-6' : 'py-3'}`}>
                              {new Date(order.created_at).toLocaleString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </td>
                            <td className={`px-4 whitespace-nowrap text-right transition-all ${editingId === order.id ? 'py-6' : 'py-3'}`}>
                              {editingId === order.id ? (
                                <div className="flex items-center justify-end space-x-1">
                                  <button
                                    onClick={saveEdit}
                                    className="p-1.5 text-emerald-400 hover:bg-emerald-500/10 rounded transition-colors"
                                    title="Save"
                                  >
                                    <Save className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={cancelEdit}
                                    className="p-1.5 text-slate-400 hover:bg-slate-700 rounded transition-colors"
                                    title="Cancel"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center justify-end space-x-1">
                                  {isSuperAdmin && (
                                    <>
                                      <button
                                        onClick={() => startEdit(order)}
                                        className="p-1.5 text-blue-400 hover:bg-blue-500/10 rounded transition-colors"
                                        title="Edit"
                                      >
                                        <Edit2 className="w-4 h-4" />
                                      </button>
                                      <button
                                        onClick={() => handleDelete(order.id, order.order_content)}
                                        className="p-1.5 text-rose-400 hover:bg-rose-500/10 rounded transition-colors"
                                        title="Delete"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </>
                                  )}
                                  {!isSuperAdmin && (
                                    <span className="text-xs text-slate-500 italic">View only</span>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls */}
                {totalCount > 0 && (
                  <div className="p-4 border-t border-slate-700 bg-slate-800/40">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center space-x-4">
                        <span className="text-sm text-slate-400">
                          Page <span className="text-white font-semibold">{currentPage}</span> of{' '}
                          <span className="text-white font-semibold">{orderTotalPages}</span>
                          <span className="text-slate-500 mx-2">|</span>
                          Showing <span className="text-white font-semibold">{((currentPage - 1) * itemsPerPage) + 1}</span> to{' '}
                          <span className="text-white font-semibold">{Math.min(currentPage * itemsPerPage, totalCount)}</span> of{' '}
                          <span className="text-white font-semibold">{totalCount}</span> total orders
                        </span>
                      </div>

                      <div className="flex items-center space-x-2">
                        {/* First Page Button */}
                        <button
                          onClick={() => handlePageChange(1)}
                          disabled={currentPage === 1 || isLoadingPage}
                          className="px-3 py-1.5 bg-slate-700/50 text-white rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium"
                          title="First Page"
                        >
                          «
                        </button>

                        {/* Previous Button */}
                        <button
                          onClick={() => handlePageChange(currentPage - 1)}
                          disabled={currentPage === 1 || isLoadingPage}
                          className="px-3 py-1.5 bg-slate-700/50 text-white rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium"
                        >
                          Previous
                        </button>

                        {/* Page Numbers */}
                        <div className="flex items-center space-x-1">
                          {Array.from({ length: Math.min(orderTotalPages, 10) }, (_, i) => {
                            const page = i + 1;
                            if (
                              page === 1 ||
                              page === orderTotalPages ||
                              (page >= currentPage - 2 && page <= currentPage + 2)
                            ) {
                              return (
                                <button
                                  key={page}
                                  onClick={() => handlePageChange(page)}
                                  disabled={isLoadingPage}
                                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                    currentPage === page
                                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30'
                                      : 'bg-slate-700/50 text-slate-300 hover:bg-slate-700 disabled:opacity-40'
                                  }`}
                                >
                                  {page}
                                </button>
                              );
                            } else if (
                              page === currentPage - 3 ||
                              page === currentPage + 3
                            ) {
                              return (
                                <span key={page} className="px-2 text-slate-500">
                                  ...
                                </span>
                              );
                            }
                            return null;
                          })}
                        </div>

                        {/* Next Button */}
                        <button
                          onClick={() => handlePageChange(currentPage + 1)}
                          disabled={currentPage === orderTotalPages || isLoadingPage}
                          className="px-3 py-1.5 bg-slate-700/50 text-white rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium"
                        >
                          Next
                        </button>

                        {/* Last Page Button */}
                        <button
                          onClick={() => handlePageChange(orderTotalPages)}
                          disabled={currentPage === orderTotalPages || isLoadingPage}
                          className="px-3 py-1.5 bg-slate-700/50 text-white rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium"
                          title="Last Page"
                        >
                          »
                        </button>

                        {/* Jump to Page Input */}
                        <div className="flex items-center space-x-2 ml-2 pl-2 border-l border-slate-600">
                          <span className="text-xs text-slate-400">Go to:</span>
                          <input
                            type="number"
                            min="1"
                            max={orderTotalPages}
                            value={jumpToPage}
                            onChange={(e) => setJumpToPage(e.target.value)}
                            onKeyPress={(e) => {
                              if (e.key === 'Enter') {
                                handleJumpToPage();
                              }
                            }}
                            placeholder={`1-${orderTotalPages}`}
                            disabled={isLoadingPage}
                            className="w-20 px-2 py-1.5 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-40"
                          />
                          <button
                            onClick={handleJumpToPage}
                            disabled={!jumpToPage || isLoadingPage}
                            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium"
                          >
                            Go
                          </button>
                        </div>

                        {/* Loading Indicator */}
                        {isLoadingPage && (
                          <div className="ml-2 flex items-center space-x-2">
                            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                            <span className="text-xs text-blue-400">Loading...</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
        )}
      </div>

      {showDeleteConfirm && createPortal(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999] p-4">
          <div className="bg-slate-800 border-2 border-rose-500 rounded-xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center space-x-3 mb-4">
              <div className="w-12 h-12 bg-rose-500/20 rounded-full flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-rose-500" />
              </div>
              <h3 className="text-xl font-bold text-white">Delete All Orders</h3>
            </div>

            <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-4 mb-4">
              <p className="text-rose-400 font-semibold mb-2">WARNING</p>
              <p className="text-white text-sm mb-2">
                This will permanently delete ALL <span className="font-bold text-rose-400">{totalCount.toLocaleString()}</span> orders in {selectedGroup?.group_name}!
              </p>
              <p className="text-slate-300 text-sm">
                This action cannot be undone.
              </p>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Type <span className="font-bold text-rose-400">DELETE ALL</span> to confirm:
              </label>
              <input
                type="text"
                value={deleteConfirmInput}
                onChange={(e) => setDeleteConfirmInput(e.target.value)}
                placeholder="DELETE ALL"
                className="w-full bg-slate-700/50 backdrop-blur-sm border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500 font-mono"
                autoFocus
                disabled={isDeleting}
              />
            </div>

            <div className="flex space-x-3">
              <button
                onClick={cancelDeleteAll}
                disabled={isDeleting}
                className="flex-1 px-4 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteAll}
                disabled={deleteConfirmInput !== 'DELETE ALL' || isDeleting}
                className="flex-1 px-4 py-3 bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {isDeleting ? 'Deleting...' : 'Delete All'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Delete Single Order Confirmation Modal */}
      {showDeleteOrderConfirm && orderToDelete && createPortal(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999] p-4">
          <div className="bg-slate-800 border-2 border-rose-500 rounded-xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center space-x-3 mb-4">
              <div className="w-12 h-12 bg-rose-500/20 rounded-full flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-rose-500" />
              </div>
              <h3 className="text-xl font-bold text-white">Delete Order</h3>
            </div>

            <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-4 mb-4">
              <p className="text-white text-sm mb-2">
                Are you sure you want to delete this order?
              </p>
              <div className="bg-slate-900/50 rounded p-2 mt-2">
                <p className="text-slate-300 text-sm font-mono break-words">
                  {orderToDelete.content.length > 100
                    ? orderToDelete.content.substring(0, 100) + '...'
                    : orderToDelete.content}
                </p>
              </div>
              <p className="text-slate-400 text-xs mt-2">
                This action cannot be undone.
              </p>
            </div>

            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setShowDeleteOrderConfirm(false);
                  setOrderToDelete(null);
                }}
                className="flex-1 px-4 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteOrder}
                className="flex-1 px-4 py-3 bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition-colors font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Delete Progress Modal */}
      {isDeleting && deleteProgress.total > 0 && createPortal(
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] p-4">
          <div className="bg-slate-800 border-2 border-rose-500 rounded-xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center space-x-3 mb-4">
              <div className="w-12 h-12 bg-rose-500/20 rounded-full flex items-center justify-center animate-pulse">
                <Trash2 className="w-6 h-6 text-rose-500" />
              </div>
              <h3 className="text-xl font-bold text-white">Deleting Orders...</h3>
            </div>

            <div className="space-y-4">
              <div className="bg-slate-700/50 backdrop-blur-sm rounded-lg p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-slate-300">Progress</span>
                  <span className="text-sm font-semibold text-white">
                    {deleteProgress.current.toLocaleString()} / {deleteProgress.total.toLocaleString()}
                  </span>
                </div>

                <div className="relative w-full h-3 bg-slate-600 rounded-full overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-rose-500 to-rose-600 transition-all duration-300 ease-out flex items-center justify-center"
                    style={{ width: `${deleteProgress.percentage}%` }}
                  >
                    <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                  </div>
                </div>

                <div className="mt-2 text-center">
                  <span className="text-2xl font-bold text-white">
                    {deleteProgress.percentage}%
                  </span>
                </div>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                <p className="text-amber-400 text-sm text-center">
                  Please wait... Do not close this window
                </p>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showCreateGroup && createPortal(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999] p-4">
          <div className="bg-slate-800 border-2 border-blue-500 rounded-xl p-6 max-w-2xl w-full shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center space-x-3 mb-6">
              <div className="w-12 h-12 bg-blue-500/20 rounded-full flex items-center justify-center">
                <FolderPlus className="w-6 h-6 text-blue-500" />
              </div>
              <h3 className="text-xl font-bold text-white">Create New Dispatch Group</h3>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Group Name *</label>
                <input
                  type="text"
                  value={newGroup.group_name}
                  onChange={(e) => setNewGroup({ ...newGroup, group_name: e.target.value })}
                  placeholder="Enter group name"
                  className="w-full bg-slate-700/50 backdrop-blur-sm border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Description</label>
                <textarea
                  value={newGroup.description}
                  onChange={(e) => setNewGroup({ ...newGroup, description: e.target.value })}
                  placeholder="Enter group description"
                  className="w-full bg-slate-700/50 backdrop-blur-sm border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Min Interval (seconds)</label>
                  <input
                    type="number"
                    value={newGroup.dispatch_interval_min}
                    onChange={(e) => setNewGroup({ ...newGroup, dispatch_interval_min: parseInt(e.target.value) || 30 })}
                    className="w-full bg-slate-700/50 backdrop-blur-sm border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    min="10"
                    max="300"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Max Interval (seconds)</label>
                  <input
                    type="number"
                    value={newGroup.dispatch_interval_max}
                    onChange={(e) => setNewGroup({ ...newGroup, dispatch_interval_max: parseInt(e.target.value) || 120 })}
                    className="w-full bg-slate-700/50 backdrop-blur-sm border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    min="30"
                    max="600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Session Timeout (minutes)</label>
                  <input
                    type="number"
                    value={newGroup.session_timeout_minutes}
                    onChange={(e) => setNewGroup({ ...newGroup, session_timeout_minutes: parseInt(e.target.value) || 10 })}
                    className="w-full bg-slate-700/50 backdrop-blur-sm border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    min="1"
                    max="60"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Dispatch Mode</label>
                  <select
                    value={newGroup.dispatch_order_mode}
                    onChange={(e) => setNewGroup({ ...newGroup, dispatch_order_mode: e.target.value as 'random' | 'sequential' })}
                    className="w-full bg-slate-700/50 backdrop-blur-sm border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="random">Random</option>
                    <option value="sequential">Sequential</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Dispatch Success Rate (%)
                  <span className="ml-2 text-xs text-slate-400">Simulate order grab competition</span>
                </label>
                <input
                  type="number"
                  value={newGroup.dispatch_success_rate}
                  onChange={(e) => setNewGroup({ ...newGroup, dispatch_success_rate: Math.min(100, Math.max(0, parseInt(e.target.value) || 100)) })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  min="0"
                  max="100"
                  placeholder="100"
                />
                <p className="mt-1 text-xs text-slate-400">
                  100% = always success, 80% = 80% success rate, 0% = always fail
                </p>
              </div>
            </div>

            <div className="flex space-x-3 mt-6">
              <button
                onClick={() => setShowCreateGroup(false)}
                className="flex-1 px-4 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateGroup}
                disabled={loading || !newGroup.group_name.trim()}
                className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {loading ? 'Creating...' : 'Create Group'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showEditGroup && selectedGroup && createPortal(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999] p-4">
          <div className="bg-slate-800 border-2 border-blue-500 rounded-xl p-6 max-w-2xl w-full shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center space-x-3 mb-6">
              <div className="w-12 h-12 bg-blue-500/20 rounded-full flex items-center justify-center">
                <Settings className="w-6 h-6 text-blue-500" />
              </div>
              <h3 className="text-xl font-bold text-white">Edit Group Configuration</h3>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Group Name *</label>
                <input
                  type="text"
                  value={selectedGroup.group_name}
                  onChange={(e) => setSelectedGroup({ ...selectedGroup, group_name: e.target.value })}
                  disabled={selectedGroup.is_default}
                  placeholder="Enter group name"
                  className="w-full bg-slate-700/50 backdrop-blur-sm border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Description</label>
                <textarea
                  value={selectedGroup.description || ''}
                  onChange={(e) => setSelectedGroup({ ...selectedGroup, description: e.target.value })}
                  placeholder="Enter group description"
                  className="w-full bg-slate-700/50 backdrop-blur-sm border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Min Interval (seconds)</label>
                  <input
                    type="number"
                    value={selectedGroup.dispatch_interval_min}
                    onChange={(e) => setSelectedGroup({ ...selectedGroup, dispatch_interval_min: parseInt(e.target.value) || 30 })}
                    className="w-full bg-slate-700/50 backdrop-blur-sm border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    min="10"
                    max="300"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Max Interval (seconds)</label>
                  <input
                    type="number"
                    value={selectedGroup.dispatch_interval_max}
                    onChange={(e) => setSelectedGroup({ ...selectedGroup, dispatch_interval_max: parseInt(e.target.value) || 120 })}
                    className="w-full bg-slate-700/50 backdrop-blur-sm border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    min="30"
                    max="600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Session Timeout (minutes)</label>
                  <input
                    type="number"
                    value={selectedGroup.session_timeout_minutes}
                    onChange={(e) => setSelectedGroup({ ...selectedGroup, session_timeout_minutes: parseInt(e.target.value) || 10 })}
                    className="w-full bg-slate-700/50 backdrop-blur-sm border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    min="1"
                    max="60"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Dispatch Mode</label>
                  <select
                    value={selectedGroup.dispatch_order_mode}
                    onChange={(e) => setSelectedGroup({ ...selectedGroup, dispatch_order_mode: e.target.value as 'random' | 'sequential' })}
                    className="w-full bg-slate-700/50 backdrop-blur-sm border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="random">Random</option>
                    <option value="sequential">Sequential</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Dispatch Success Rate (%)
                  <span className="ml-2 text-xs text-slate-400">Simulate order grab competition</span>
                </label>
                <input
                  type="number"
                  value={selectedGroup.dispatch_success_rate}
                  onChange={(e) => setSelectedGroup({ ...selectedGroup, dispatch_success_rate: Math.min(100, Math.max(0, parseInt(e.target.value) || 100)) })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  min="0"
                  max="100"
                  placeholder="100"
                />
                <p className="mt-1 text-xs text-slate-400">
                  100% = always success, 80% = 80% success rate, 0% = always fail
                </p>
              </div>

              <div>
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={selectedGroup.is_active}
                    onChange={(e) => setSelectedGroup({ ...selectedGroup, is_active: e.target.checked })}
                    className="w-4 h-4 text-blue-600 bg-slate-700 border-slate-600 rounded-lg focus:ring-blue-500"
                  />
                  <span className="text-sm text-slate-300">Group is active</span>
                </label>
              </div>
            </div>

            <div className="flex space-x-3 mt-6">
              <button
                onClick={() => setShowEditGroup(false)}
                className="flex-1 px-4 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateGroup}
                disabled={loading}
                className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {loading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showMemberManagement && selectedGroup && createPortal(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999] p-4">
          <div className="bg-slate-800 border-2 border-emerald-500 rounded-xl p-6 max-w-7xl w-full shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 bg-emerald-500/20 rounded-full flex items-center justify-center">
                  <Users className="w-6 h-6 text-emerald-500" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">Assign Employees to Group: {selectedGroup.group_name}</h3>
                  <p className="text-sm text-slate-400">
                    {isSuperAdmin ? 'Select admin → Move employees between assigned and unassigned' : 'Manage your employees in this group'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowMemberManagement(false);
                  setSelectedAdminFilter(null);
                  setAssignedEmployeesSelection([]);
                  setUnassignedEmployeesSelection([]);
                  setEmployeeSearchQuery('');
                  setAssignedSelectedTags([]);
                  setUnassignedSelectedTags([]);
                }}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-white" />
                <input
                  type="text"
                  value={employeeSearchQuery}
                  onChange={(e) => setEmployeeSearchQuery(e.target.value)}
                  placeholder="Search employees..."
                  className="w-full bg-slate-700/70 border border-slate-500 rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            <div className={`grid ${isSuperAdmin ? 'grid-cols-12' : 'grid-cols-9'} gap-4 flex-1 overflow-hidden min-h-0`}>
              {/* Left Column: Admin Selector - Only for Super Admin */}
              {isSuperAdmin && (
              <div className="col-span-3 flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-3 flex-shrink-0">
                  <h4 className="text-sm font-semibold text-blue-400 flex items-center">
                    <Filter className="w-4 h-4 mr-2" />
                    Select Admin
                  </h4>
                </div>
                <div className="space-y-1 overflow-y-auto custom-scrollbar pr-2 flex-1 min-h-0">
                  {adminGroups.map((adminGroup) => (
                    <button
                      key={adminGroup.admin_id}
                      onClick={() => {
                        setSelectedAdminFilter(adminGroup.admin_id);
                        setAssignedEmployeesSelection([]);
                        setUnassignedEmployeesSelection([]);
                        setAssignedSelectedTags([]);
                        setUnassignedSelectedTags([]);
                      }}
                      className={`w-full text-left p-3 rounded-lg transition-all border-2 ${
                        selectedAdminFilter === adminGroup.admin_id
                          ? 'bg-blue-600/30 border-blue-500 shadow-lg'
                          : 'bg-slate-700/30 border-transparent hover:bg-slate-700/50 hover:border-slate-600'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-white font-medium text-sm truncate">{adminGroup.admin_username}</span>
                        {selectedAdminFilter === adminGroup.admin_id && (
                          <CheckCircle className="w-4 h-4 text-blue-400 flex-shrink-0 ml-2" />
                        )}
                      </div>
                      <div className="flex items-center space-x-2 text-xs">
                        <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">
                          {adminGroup.employees.filter(e => e.group_id === selectedGroup.id).length} in group
                        </span>
                        <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 rounded">
                          {adminGroup.employees.filter(e => e.group_id !== selectedGroup.id).length} other
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              )}

              {/* Center Column: Assigned to This Group */}
              <div className={`${isSuperAdmin ? 'col-span-4' : 'col-span-4'} flex flex-col ${isSuperAdmin ? 'border-l border-r' : 'border-r'} border-slate-700 ${isSuperAdmin ? 'pl-4' : ''} pr-4 min-h-0`}>
                <div className="flex items-center justify-between mb-3 flex-shrink-0">
                  <h4 className="text-sm font-semibold text-emerald-400 flex items-center">
                    <span className="w-2 h-2 bg-emerald-500 rounded-full mr-2"></span>
                    In Group: {selectedGroup.group_name}
                  </h4>
                  <div className="flex items-center space-x-2">
                    {assignedEmployeesSelection.length > 0 && (
                      <span className="text-xs text-blue-400 px-2 py-1 bg-blue-500/20 rounded">
                        {assignedEmployeesSelection.length} selected
                      </span>
                    )}
                    <button
                      onClick={async () => {
                        if (assignedEmployeesSelection.length === 0) return;
                        setLoading(true);
                        setIsOptimisticUpdate(true);

                        const selectedIds = [...assignedEmployeesSelection];

                        try {
                          // Optimistic update - update local state immediately
                          const updatedEmployees = employees.map(emp => {
                            if (selectedIds.includes(emp.id)) {
                              return { ...emp, group_id: null, group_name: undefined };
                            }
                            return emp;
                          });
                          setEmployees(updatedEmployees);

                          // Update admin groups state
                          const updatedAdminGroups = adminGroups.map(ag => ({
                            ...ag,
                            employees: ag.employees.map(emp => {
                              if (selectedIds.includes(emp.id)) {
                                return { ...emp, group_id: null, group_name: undefined };
                              }
                              return emp;
                            }),
                          }));
                          setAdminGroups(updatedAdminGroups);

                          // Update group stats
                          const updatedGroups = groups.map(g => {
                            if (g.id === selectedGroup.id) {
                              return { ...g, member_count: Math.max(0, (g.member_count || 0) - selectedIds.length) };
                            }
                            return g;
                          });
                          setGroups(updatedGroups);

                          setAssignedEmployeesSelection([]);

                          // Perform actual database update
                          const { error } = await supabase
                            .from('dispatch_group_members')
                            .delete()
                            .in('user_id', selectedIds);

                          if (error) throw error;

                          showNotification('success', `Removed ${selectedIds.length} employees from group`);

                          // Allow realtime updates after a short delay
                          setTimeout(() => {
                            setIsOptimisticUpdate(false);
                          }, 1000);
                        } catch (error: any) {
                          showNotification('error', 'Remove failed: ' + error.message);
                          setIsOptimisticUpdate(false);
                          // Revert on error
                          loadEmployees();
                          loadGroups();
                        } finally {
                          setLoading(false);
                        }
                      }}
                      disabled={assignedEmployeesSelection.length === 0 || loading}
                      className="px-2 py-1 bg-rose-600/80 hover:bg-rose-600 text-white text-xs rounded flex items-center space-x-1 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Remove selected from group"
                    >
                      <X className="w-3 h-3" />
                      <span>Remove</span>
                    </button>
                  </div>
                </div>

                {selectedAdminFilter && (() => {
                  const adminGroup = adminGroups.find(ag => ag.admin_id === selectedAdminFilter);
                  if (!adminGroup) return null;

                  const assignedEmployees = adminGroup.employees.filter(emp => emp.group_id === selectedGroup.id);
                  const assignedTags = new Set<string>();
                  assignedEmployees.forEach(emp => {
                    if (emp.tags && Array.isArray(emp.tags)) {
                      emp.tags.forEach(tag => assignedTags.add(tag));
                    }
                  });
                  const tagsArray = Array.from(assignedTags).sort();

                  if (tagsArray.length === 0) return null;

                  return (
                    <div className="mb-2 bg-slate-700/30 rounded-lg p-2 border border-slate-600/50 flex-shrink-0">
                      <div className="flex items-center justify-between mb-1.5">
                        <h5 className="text-[10px] font-semibold text-slate-300 flex items-center">
                          <Filter className="w-3 h-3 mr-1" />
                          Filter by Tags
                        </h5>
                        {assignedSelectedTags.length > 0 && (
                          <button
                            onClick={() => setAssignedSelectedTags([])}
                            className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
                          >
                            Clear ({assignedSelectedTags.length})
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {tagsArray.map(tag => (
                          <button
                            key={tag}
                            onClick={() => {
                              if (assignedSelectedTags.includes(tag)) {
                                setAssignedSelectedTags(assignedSelectedTags.filter(t => t !== tag));
                              } else {
                                setAssignedSelectedTags([...assignedSelectedTags, tag]);
                              }
                            }}
                            className={`px-1.5 py-0.5 text-[10px] rounded-full transition-all border ${
                              assignedSelectedTags.includes(tag)
                                ? 'bg-blue-600/30 border-blue-500 text-blue-300'
                                : 'bg-slate-600/30 border-slate-600 text-slate-300 hover:bg-slate-600/50'
                            }`}
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                <div className="space-y-1.5 overflow-y-auto flex-1 custom-scrollbar pr-2 pb-4 min-h-0">
                  {selectedAdminFilter ? (
                    (() => {
                      const filteredEmployees = employees
                        .filter(emp => {
                          const matchesGroup = emp.group_id === selectedGroup.id;
                          const matchesAdmin = emp.created_by === selectedAdminFilter;
                          const matchesSearch = emp.username.toLowerCase().includes(employeeSearchQuery.toLowerCase());
                          const matchesTags = assignedSelectedTags.length === 0 ||
                            (emp.tags && Array.isArray(emp.tags) && assignedSelectedTags.some(tag => emp.tags.includes(tag)));

                          return matchesGroup && matchesAdmin && matchesSearch && matchesTags;
                        });

                      return filteredEmployees.length === 0 ? (
                        <div className="text-center py-16 text-slate-400 text-sm">
                          <Users className="w-12 h-12 mx-auto mb-2 opacity-20" />
                          <p>No employees in this group</p>
                        </div>
                      ) : (
                        filteredEmployees.map((emp) => (
                          <div
                            key={emp.id}
                            className={`relative p-2.5 rounded-lg transition-all duration-200 cursor-pointer border-2 ${
                              assignedEmployeesSelection.includes(emp.id)
                                ? 'bg-gradient-to-r from-blue-600/30 to-blue-500/20 border-blue-400 shadow-xl shadow-blue-500/30'
                                : 'bg-slate-800/60 border-slate-700/50 hover:bg-slate-700/60 hover:border-slate-600 hover:shadow-lg'
                            }`}
                            onClick={() => {
                              if (assignedEmployeesSelection.includes(emp.id)) {
                                setAssignedEmployeesSelection(assignedEmployeesSelection.filter(id => id !== emp.id));
                              } else {
                                setAssignedEmployeesSelection([...assignedEmployeesSelection, emp.id]);
                              }
                            }}
                          >
                            {assignedEmployeesSelection.includes(emp.id) && (
                              <div className="absolute inset-0 border-2 border-blue-400 rounded-lg animate-pulse pointer-events-none" />
                            )}
                            <div className="flex items-center gap-3">
                              <div className="flex-shrink-0">
                                <div className={`w-5 h-5 rounded-md flex items-center justify-center transition-all ${
                                  assignedEmployeesSelection.includes(emp.id)
                                    ? 'bg-blue-500 shadow-lg shadow-blue-500/50'
                                    : 'bg-slate-700 border-2 border-slate-600'
                                }`}>
                                  {assignedEmployeesSelection.includes(emp.id) && (
                                    <CheckCircle className="w-4 h-4 text-white" />
                                  )}
                                </div>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-3 mb-0.5">
                                  <span className={`font-bold text-base truncate ${
                                    assignedEmployeesSelection.includes(emp.id) ? 'text-blue-100' : 'text-white'
                                  }`}>
                                    {emp.username}
                                  </span>
                                  <div className="flex items-center gap-1 bg-emerald-500/20 px-2 py-0.5 rounded-md border border-emerald-500/30">
                                    <span className="text-xs text-emerald-400 font-bold whitespace-nowrap">
                                      ${emp.wallet_balance.toFixed(2)}
                                    </span>
                                  </div>
                                </div>
                                {emp.remarks && (
                                  <div className="text-xs text-slate-300 mb-1.5 line-clamp-1 font-medium" title={emp.remarks}>
                                    💬 {emp.remarks}
                                  </div>
                                )}
                                {emp.tags && Array.isArray(emp.tags) && emp.tags.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5">
                                    {emp.tags.map((tag: string) => (
                                      <span key={tag} className="px-2 py-0.5 bg-gradient-to-r from-indigo-500/20 to-purple-500/20 text-indigo-300 text-[10px] font-semibold rounded-full border border-indigo-400/40 shadow-sm">
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))
                      );
                    })()
                  ) : (
                    <div className="text-center py-16 text-slate-400 text-sm">
                      <Filter className="w-12 h-12 mx-auto mb-2 opacity-20" />
                      <p>Select an admin from the left</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Other Employees (from selected admin) */}
              <div className="col-span-5 flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-3 flex-shrink-0">
                  <h4 className="text-sm font-semibold text-amber-400 flex items-center">
                    <span className="w-2 h-2 bg-amber-500 rounded-full mr-2"></span>
                    Other Employees
                  </h4>
                  <div className="flex items-center space-x-2">
                    {unassignedEmployeesSelection.length > 0 && (
                      <span className="text-xs text-blue-400 px-2 py-1 bg-blue-500/20 rounded">
                        {unassignedEmployeesSelection.length} selected
                      </span>
                    )}
                    <button
                      onClick={async () => {
                        if (unassignedEmployeesSelection.length === 0) return;

                        if (selectedGroup.id.startsWith('temp-')) {
                          showNotification('error', 'Please wait for the group to be saved before adding employees');
                          return;
                        }

                        // No need to check - we allow moving from other groups now

                        setLoading(true);
                        setIsOptimisticUpdate(true);

                        const selectedIds = [...unassignedEmployeesSelection];

                        try {
                          const auth = sessionStorage.getItem('quantum_trader_auth');
                          const adminId = auth ? JSON.parse(auth).user.id : null;

                          // Optimistic update - update local state immediately
                          const updatedEmployees = employees.map(emp => {
                            if (selectedIds.includes(emp.id)) {
                              return { ...emp, group_id: selectedGroup.id, group_name: selectedGroup.group_name };
                            }
                            return emp;
                          });
                          setEmployees(updatedEmployees);

                          // Update admin groups state
                          const updatedAdminGroups = adminGroups.map(ag => ({
                            ...ag,
                            employees: ag.employees.map(emp => {
                              if (selectedIds.includes(emp.id)) {
                                return { ...emp, group_id: selectedGroup.id, group_name: selectedGroup.group_name };
                              }
                              return emp;
                            }),
                          }));
                          setAdminGroups(updatedAdminGroups);

                          // Update group stats - need to update both source and target groups
                          const updatedGroups = groups.map(g => {
                            if (g.id === selectedGroup.id) {
                              // Count how many are truly new to this group
                              const newToThisGroup = selectedIds.filter(id => {
                                const emp = employees.find(e => e.id === id);
                                return emp && emp.group_id !== selectedGroup.id;
                              }).length;
                              return { ...g, member_count: (g.member_count || 0) + newToThisGroup };
                            } else {
                              // Count how many are leaving this group
                              const leavingThisGroup = employees.filter(emp =>
                                selectedIds.includes(emp.id) && emp.group_id === g.id
                              ).length;
                              if (leavingThisGroup > 0) {
                                return { ...g, member_count: Math.max(0, (g.member_count || 0) - leavingThisGroup) };
                              }
                            }
                            return g;
                          });
                          setGroups(updatedGroups);

                          setUnassignedEmployeesSelection([]);

                          // Perform actual database update - DELETE ensures moving from old group
                          await supabase
                            .from('dispatch_group_members')
                            .delete()
                            .in('user_id', selectedIds);

                          const membersToInsert = selectedIds.map(userId => ({
                            group_id: selectedGroup.id,
                            user_id: userId,
                            assigned_by: adminId,
                          }));

                          const { error } = await supabase
                            .from('dispatch_group_members')
                            .insert(membersToInsert);

                          if (error) throw error;

                          showNotification('success', `Moved ${selectedIds.length} employee(s) to ${selectedGroup.group_name}`);

                          // Allow realtime updates after a short delay
                          setTimeout(() => {
                            setIsOptimisticUpdate(false);
                          }, 1000);
                        } catch (error: any) {
                          showNotification('error', 'Add failed: ' + error.message);
                          setIsOptimisticUpdate(false);
                          // Revert on error
                          loadEmployees();
                          loadGroups();
                        } finally {
                          setLoading(false);
                        }
                      }}
                      disabled={unassignedEmployeesSelection.length === 0 || loading || selectedGroup?.id.startsWith('temp-')}
                      className="px-2 py-1 bg-emerald-600/80 hover:bg-emerald-600 text-white text-xs rounded flex items-center space-x-1 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title={selectedGroup?.id.startsWith('temp-') ? "Please wait for group to be saved" : "Add selected to group"}
                    >
                      <Plus className="w-3 h-3" />
                      <span>Add to Group</span>
                    </button>
                  </div>
                </div>

                {selectedAdminFilter && (() => {
                  const adminGroup = adminGroups.find(ag => ag.admin_id === selectedAdminFilter);
                  if (!adminGroup) return null;

                  const unassignedEmployees = adminGroup.employees.filter(emp => !emp.group_id);
                  const unassignedTags = new Set<string>();
                  unassignedEmployees.forEach(emp => {
                    if (emp.tags && Array.isArray(emp.tags)) {
                      emp.tags.forEach(tag => unassignedTags.add(tag));
                    }
                  });
                  const tagsArray = Array.from(unassignedTags).sort();

                  if (tagsArray.length === 0) return null;

                  return (
                    <div className="mb-2 bg-slate-700/30 rounded-lg p-2 border border-slate-600/50 flex-shrink-0">
                      <div className="flex items-center justify-between mb-1.5">
                        <h5 className="text-[10px] font-semibold text-slate-300 flex items-center">
                          <Filter className="w-3 h-3 mr-1" />
                          Filter by Tags
                        </h5>
                        {unassignedSelectedTags.length > 0 && (
                          <button
                            onClick={() => setUnassignedSelectedTags([])}
                            className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
                          >
                            Clear ({unassignedSelectedTags.length})
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {tagsArray.map(tag => (
                          <button
                            key={tag}
                            onClick={() => {
                              if (unassignedSelectedTags.includes(tag)) {
                                setUnassignedSelectedTags(unassignedSelectedTags.filter(t => t !== tag));
                              } else {
                                setUnassignedSelectedTags([...unassignedSelectedTags, tag]);
                              }
                            }}
                            className={`px-1.5 py-0.5 text-[10px] rounded-full transition-all border ${
                              unassignedSelectedTags.includes(tag)
                                ? 'bg-blue-600/30 border-blue-500 text-blue-300'
                                : 'bg-slate-600/30 border-slate-600 text-slate-300 hover:bg-slate-600/50'
                            }`}
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                <div className="space-y-1.5 overflow-y-auto flex-1 custom-scrollbar pr-2 pb-4 min-h-0">
                  {selectedAdminFilter ? (
                    (() => {
                      const filteredEmployees = employees
                        .filter(emp => {
                          const matchesNotInCurrentGroup = emp.group_id !== selectedGroup.id;
                          const matchesAdmin = emp.created_by === selectedAdminFilter;
                          const matchesSearch = emp.username.toLowerCase().includes(employeeSearchQuery.toLowerCase());
                          const matchesTags = unassignedSelectedTags.length === 0 ||
                            (emp.tags && Array.isArray(emp.tags) && unassignedSelectedTags.some(tag => emp.tags.includes(tag)));

                          return matchesNotInCurrentGroup && matchesAdmin && matchesSearch && matchesTags;
                        });

                      return filteredEmployees.length === 0 ? (
                        <div className="text-center py-16 text-slate-400 text-sm">
                          <CheckCircle className="w-12 h-12 mx-auto mb-2 opacity-20" />
                          <p>All employees assigned</p>
                        </div>
                      ) : (
                        filteredEmployees.map((emp) => {
                          const isInOtherGroup = emp.group_id && emp.group_id !== selectedGroup.id;
                          const isInDefaultGroup = isInOtherGroup && groups.find(g => g.id === emp.group_id)?.is_default;
                          const canSelect = !isInOtherGroup || isInDefaultGroup;

                          return (
                            <div
                              key={emp.id}
                              className={`relative p-2.5 rounded-lg transition-all duration-200 border-2 ${
                                isInOtherGroup && !isInDefaultGroup
                                  ? 'bg-slate-800/40 border-amber-600/50'
                                  : unassignedEmployeesSelection.includes(emp.id)
                                  ? 'bg-gradient-to-r from-blue-600/30 to-blue-500/20 border-blue-400 shadow-xl shadow-blue-500/30 cursor-pointer'
                                  : 'bg-slate-800/60 border-slate-700/50 hover:bg-slate-700/60 hover:border-slate-600 hover:shadow-lg cursor-pointer'
                              }`}
                              onClick={(e) => {
                                // Only handle selection if clicking the card itself, not buttons
                                if ((e.target as HTMLElement).closest('button')) return;

                                if (!canSelect) return;

                                if (unassignedEmployeesSelection.includes(emp.id)) {
                                  setUnassignedEmployeesSelection(unassignedEmployeesSelection.filter(id => id !== emp.id));
                                } else {
                                  setUnassignedEmployeesSelection([...unassignedEmployeesSelection, emp.id]);
                                }
                              }}
                            >
                            {unassignedEmployeesSelection.includes(emp.id) && (
                              <div className="absolute inset-0 border-2 border-blue-400 rounded-lg animate-pulse pointer-events-none" />
                            )}
                            <div className="flex items-center gap-3">
                              {canSelect && (
                                <div className="flex-shrink-0">
                                  <div className={`w-5 h-5 rounded-md flex items-center justify-center transition-all ${
                                    unassignedEmployeesSelection.includes(emp.id)
                                      ? 'bg-blue-500 shadow-lg shadow-blue-500/50'
                                      : 'bg-slate-700 border-2 border-slate-600'
                                  }`}>
                                    {unassignedEmployeesSelection.includes(emp.id) && (
                                      <CheckCircle className="w-4 h-4 text-white" />
                                    )}
                                  </div>
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-3 mb-0.5">
                                  <span className={`font-bold text-base truncate ${
                                    unassignedEmployeesSelection.includes(emp.id) ? 'text-blue-100' : 'text-white'
                                  }`}>
                                    {emp.username}
                                  </span>
                                  <div className="flex items-center gap-1 bg-emerald-500/20 px-2 py-0.5 rounded-md border border-emerald-500/30">
                                    <span className="text-xs text-emerald-400 font-bold whitespace-nowrap">
                                      ${emp.wallet_balance.toFixed(2)}
                                    </span>
                                  </div>
                                </div>
                                {isInOtherGroup && (
                                  <div className="flex items-center justify-between gap-2 mb-1.5">
                                    <div className="text-xs text-amber-400 font-semibold flex items-center gap-1">
                                      <Layers className="w-3 h-3" />
                                      Currently in: {emp.group_name}
                                    </div>
                                    {!isInDefaultGroup && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();

                                          if (selectedGroup.id.startsWith('temp-')) {
                                            showNotification('error', 'Please wait for the group to be saved before moving employees');
                                            return;
                                          }

                                          setEmployeeToMove({
                                            id: emp.id,
                                            username: emp.username,
                                            fromGroup: emp.group_name || ''
                                          });
                                          setShowMoveConfirm(true);
                                        }}
                                        className="px-2 py-0.5 bg-blue-600/80 hover:bg-blue-600 text-white text-[10px] rounded flex items-center gap-1 transition-colors"
                                        title={`Move to ${selectedGroup.group_name}`}
                                      >
                                        <ArrowRight className="w-3 h-3" />
                                        Move Here
                                      </button>
                                    )}
                                  </div>
                                )}
                                {emp.remarks && (
                                  <div className="text-xs text-slate-300 mb-1.5 line-clamp-1 font-medium" title={emp.remarks}>
                                    💬 {emp.remarks}
                                  </div>
                                )}
                                {emp.tags && Array.isArray(emp.tags) && emp.tags.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5">
                                    {emp.tags.map((tag: string) => (
                                      <span key={tag} className="px-2 py-0.5 bg-gradient-to-r from-indigo-500/20 to-purple-500/20 text-indigo-300 text-[10px] font-semibold rounded-full border border-indigo-400/40 shadow-sm">
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                          );
                        })
                      );
                    })()
                  ) : (
                    <div className="text-center py-16 text-slate-400 text-sm">
                      <Filter className="w-12 h-12 mx-auto mb-2 opacity-20" />
                      <p>Select an admin from the left</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-slate-700 flex-shrink-0">
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                <p className="text-xs text-blue-400">
                  <strong>Workflow:</strong> {isSuperAdmin
                    ? '1) Select admin on left → 2) Select/click employees from right (shows all employees not in current group) → 3) Use "Add to Group" button or "Move Here" button to assign employees'
                    : '1) Select/click your employees from right (shows all employees not in current group) → 2) Use "Add to Group" button or "Move Here" button to assign employees'
                  }
                </p>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Move Employee Confirmation Modal */}
      {showMoveConfirm && employeeToMove && selectedGroup && createPortal(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999] p-4">
          <div className="bg-slate-800 border-2 border-blue-500 rounded-xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center justify-center mb-4">
              <div className="w-12 h-12 bg-blue-500/20 rounded-full flex items-center justify-center">
                <ArrowRight className="w-6 h-6 text-blue-500" />
              </div>
            </div>
            <h3 className="text-xl font-bold text-white text-center mb-2">Move Employee?</h3>
            <p className="text-slate-300 text-center mb-6">
              Move <span className="font-semibold text-blue-400">{employeeToMove.username}</span> from{' '}
              <span className="font-semibold text-amber-400">{employeeToMove.fromGroup}</span> to{' '}
              <span className="font-semibold text-emerald-400">{selectedGroup.group_name}</span>?
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setShowMoveConfirm(false);
                  setEmployeeToMove(null);
                }}
                className="flex-1 px-4 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleMoveEmployee}
                disabled={loading}
                className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {loading ? 'Moving...' : 'Move'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Delete Group Confirmation Modal */}
      {showDeleteGroupConfirm && groupToDelete && createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4">
          <div className="bg-slate-800/95 rounded-2xl shadow-2xl border border-rose-500/30 max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-12 h-12 rounded-xl bg-rose-500/20 flex items-center justify-center">
                  <Trash2 className="w-6 h-6 text-rose-400" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">Delete Group</h3>
                  <p className="text-sm text-slate-400">This action cannot be undone</p>
                </div>
              </div>

              <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/30 rounded-lg">
                <p className="text-slate-300 mb-2">
                  Are you sure you want to delete the group:
                </p>
                <p className="text-white font-bold text-lg mb-3">
                  {groupToDelete.name}
                </p>
                <div className="space-y-2 text-sm text-rose-400">
                  <p className="flex items-center space-x-2">
                    <span className="w-1.5 h-1.5 bg-rose-400 rounded-full"></span>
                    <span>All orders in this group will be removed</span>
                  </p>
                  <p className="flex items-center space-x-2">
                    <span className="w-1.5 h-1.5 bg-rose-400 rounded-full"></span>
                    <span>All member assignments will be cleared</span>
                  </p>
                  <p className="flex items-center space-x-2">
                    <span className="w-1.5 h-1.5 bg-rose-400 rounded-full"></span>
                    <span>This action is permanent and cannot be reversed</span>
                  </p>
                </div>
              </div>

              <div className="flex space-x-3">
                <button
                  onClick={() => {
                    setShowDeleteGroupConfirm(false);
                    setGroupToDelete(null);
                  }}
                  className="flex-1 px-4 py-3 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDeleteGroup}
                  disabled={loading}
                  className="flex-1 px-4 py-3 bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  {loading ? 'Deleting...' : 'Delete Group'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
