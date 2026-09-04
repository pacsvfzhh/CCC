import { Activity, ArrowUpRight, ChevronRight, MessageCircle, RefreshCw, Users } from 'lucide-react';

export interface AdminGroup {
  admin_id: string;
  admin_username: string;
  admin_role: string;
  employee_count: number;
  customer_count: number;
  conversation_count: number;
}

interface AdminGroupPickerProps {
  service: 'customer' | 'manager';
  groups: AdminGroup[];
  unreadCounts: Record<string, number>;
  loading: boolean;
  onSelect: (group: AdminGroup) => void;
  onRefresh: () => void;
}

const serviceStyles = {
  customer: {
    Icon: MessageCircle,
    accent: 'text-orange-300',
    border: 'border-orange-500/25',
    headerIcon: 'border-orange-400/35 bg-orange-500/15 text-orange-200',
    chip: 'border-orange-400/25 bg-orange-500/10 text-orange-200',
    row: 'border-orange-500/20 bg-orange-950/20 hover:border-orange-300/80 hover:bg-orange-500/15 hover:shadow-[0_12px_35px_-18px_rgba(251,146,60,0.75)]',
    rowIcon: 'border-orange-400/25 bg-orange-500/10 text-orange-200 group-hover:border-orange-300/60 group-hover:bg-orange-400/25',
    action: 'bg-orange-500/15 text-orange-100 ring-1 ring-orange-400/25 group-hover:bg-orange-400 group-hover:text-white group-hover:ring-orange-300/70',
    metric: 'border-orange-500/15 bg-orange-950/35',
    skeleton: 'bg-orange-500/10',
    rail: 'bg-gradient-to-b from-orange-300 via-orange-500 to-amber-500',
    focus: 'focus-visible:ring-orange-300/80',
  },
  manager: {
    Icon: Users,
    accent: 'text-emerald-300',
    border: 'border-emerald-500/25',
    headerIcon: 'border-emerald-400/35 bg-emerald-500/15 text-emerald-200',
    chip: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200',
    row: 'border-emerald-500/20 bg-emerald-950/20 hover:border-emerald-300/80 hover:bg-emerald-500/15 hover:shadow-[0_12px_35px_-18px_rgba(52,211,153,0.75)]',
    rowIcon: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200 group-hover:border-emerald-300/60 group-hover:bg-emerald-400/25',
    action: 'bg-emerald-500/15 text-emerald-100 ring-1 ring-emerald-400/25 group-hover:bg-emerald-400 group-hover:text-white group-hover:ring-emerald-300/70',
    metric: 'border-emerald-500/15 bg-emerald-950/35',
    skeleton: 'bg-emerald-500/10',
    rail: 'bg-gradient-to-b from-emerald-300 via-emerald-500 to-teal-500',
    focus: 'focus-visible:ring-emerald-300/80',
  },
};

const formatRole = (role: string) => role === 'super_admin' ? 'Super admin' : role;

export default function AdminGroupPicker({ service, groups, unreadCounts, loading, onSelect, onRefresh }: AdminGroupPickerProps) {
  const styles = serviceStyles[service];
  const Icon = styles.Icon;
  const totalEmployees = groups.reduce((total, group) => total + group.employee_count, 0);
  const totalCustomers = groups.reduce((total, group) => total + group.customer_count, 0);
  const totalMessages = groups.reduce((total, group) => total + group.conversation_count, 0);
  const totalUnread = Object.values(unreadCounts).reduce((total, count) => total + count, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col text-slate-100">
      <section className="flex min-h-0 flex-1 flex-col">
        <header className={`relative flex shrink-0 flex-col gap-4 border-b px-4 py-4 sm:px-6 sm:py-5 ${styles.border}`}>
          <div className={`absolute inset-x-0 top-0 h-px ${styles.rail}`} />
          <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-center xl:gap-8">
            <div className="flex min-w-0 flex-1 items-center gap-3 xl:max-w-[680px]">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${styles.headerIcon}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold tracking-tight text-white">Admin workspaces</h2>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${styles.chip}`}>{groups.length} available</span>
                </div>
                <p className="mt-1 max-w-full break-words text-sm font-medium leading-5 text-slate-300">Select a workspace to enter its live service console · {totalMessages} conversations across all workspaces.</p>
              </div>
            </div>

            <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
              <div className={`rounded-xl border px-3 py-2 ${styles.metric}`}>
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-300/75"><Users className="h-3.5 w-3.5" /> Groups</div>
                <div className="mt-1 text-lg font-bold text-white">{groups.length}</div>
              </div>
              <div className={`rounded-xl border px-3 py-2 ${styles.metric}`}>
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-300/75"><Users className="h-3.5 w-3.5" /> Employees</div>
                <div className="mt-1 text-lg font-bold text-white">{totalEmployees}</div>
              </div>
              <div className={`rounded-xl border px-3 py-2 ${styles.metric}`}>
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-300/75"><MessageCircle className="h-3.5 w-3.5" /> Customers</div>
                <div className="mt-1 text-lg font-bold text-white">{totalCustomers}</div>
              </div>
              <div className={`rounded-xl border px-3 py-2 ${styles.metric}`}>
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-300/75"><Activity className="h-3.5 w-3.5" /> Unread</div>
                <div className={`mt-1 text-lg font-bold ${totalUnread > 0 ? 'text-rose-300' : 'text-white'}`}>{totalUnread}</div>
              </div>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-dark p-0 sm:p-1">
          {loading ? (
            <div className={`divide-y overflow-hidden rounded-xl border bg-slate-900/45 ${styles.border}`}>
              {[0, 1, 2, 3, 4].map(index => (
                <div key={index} className="flex animate-pulse flex-col gap-3 px-3 py-4 sm:flex-row sm:items-center sm:px-4">
                  <div className="flex flex-1 items-center gap-3">
                    <div className={`h-9 w-9 shrink-0 rounded-lg ${styles.skeleton}`} />
                    <div className="space-y-2"><div className="h-3 w-36 rounded bg-slate-700/70" /><div className="h-2.5 w-24 rounded bg-slate-800" /></div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:w-[270px]"><div className="h-10 rounded-lg bg-slate-800/70" /><div className="h-10 rounded-lg bg-slate-800/70" /><div className="h-10 rounded-lg bg-slate-800/70" /></div>
                  <div className="h-9 w-28 self-end rounded-lg bg-slate-800 sm:self-auto" />
                </div>
              ))}
            </div>
          ) : groups.length > 0 ? (
            <div className={`overflow-hidden rounded-xl border bg-slate-900/35 ${styles.border}`}>
              <div className="hidden grid-cols-[minmax(200px,1fr)_repeat(3,90px)_150px] items-center gap-4 border-b border-slate-700/70 bg-slate-900/80 px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-300/75 sm:grid">
                <span>Workspace</span><span>Employees</span><span>Customers</span><span>Messages</span><span className="text-right">Action</span>
              </div>
              <div className="space-y-1 p-1">
                {groups.map(group => {
                  const unread = unreadCounts[group.admin_id] || 0;
                  return (
                    <button
                      key={group.admin_id}
                      type="button"
                      onClick={() => onSelect(group)}
                      className={`group relative flex w-full flex-col gap-3 overflow-hidden rounded-lg border px-3 py-3 text-left transition-all duration-200 hover:-translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-slate-950 sm:grid sm:grid-cols-[minmax(200px,1fr)_repeat(3,90px)_150px] sm:items-center sm:gap-4 sm:px-4 ${styles.row} ${styles.focus}`}
                    >
                      <span className={`absolute inset-y-0 left-0 w-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 ${styles.rail}`} />
                      <div className="flex min-w-0 items-center gap-3">
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-all duration-200 ${styles.rowIcon}`}>
                          <Users className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-bold text-white sm:text-[15px]">{group.admin_username}</span>
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${styles.chip}`}>{formatRole(group.admin_role)}</span>
                          </div>
                          <span className="mt-1 block truncate text-[11px] font-medium text-slate-300/80">Workspace ID · {group.admin_id.slice(0, 8)}</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 sm:contents">
                        <div className={`flex items-center justify-between rounded-lg border px-3 py-2 sm:block sm:border-0 sm:bg-transparent sm:p-0 ${styles.metric}`}>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300/70 sm:block">Employees</span>
                          <span className="text-base font-bold text-white sm:mt-1 sm:block">{group.employee_count}</span>
                        </div>
                        <div className={`flex items-center justify-between rounded-lg border px-3 py-2 sm:block sm:border-0 sm:bg-transparent sm:p-0 ${styles.metric}`}>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300/70 sm:block">Customers</span>
                          <span className="text-base font-bold text-white sm:mt-1 sm:block">{group.customer_count}</span>
                        </div>
                        <div className={`flex items-center justify-between rounded-lg border px-3 py-2 sm:block sm:border-0 sm:bg-transparent sm:p-0 ${styles.metric}`}>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300/70 sm:block">Messages</span>
                          <span className="text-base font-bold text-white sm:mt-1 sm:block">{group.conversation_count}</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2">
                        {unread > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-rose-400/35 bg-rose-500/15 px-2 py-1 text-[10px] font-bold text-rose-200">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-300" /> {unread > 99 ? '99+' : unread} unread
                          </span>
                        )}
                        <span className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-bold transition-all ${styles.action}`}>
                          Open <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                        </span>
                      </div>
                      <ChevronRight className={`pointer-events-none absolute -bottom-5 -right-3 h-20 w-20 opacity-[0.04] transition-all duration-300 group-hover:translate-x-1 group-hover:-translate-y-1 group-hover:opacity-10 ${styles.accent}`} />
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-[280px] items-center justify-center rounded-xl border border-dashed border-slate-700/80 bg-slate-900/30 px-6 py-12 text-center">
              <div className="max-w-sm">
                <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border ${styles.headerIcon}`}><Users className="h-7 w-7" /></div>
                <h4 className="mt-5 text-base font-bold text-white">No workspaces available</h4>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-300/80">There are no active admin workspaces to manage right now. Refresh to check for newly available groups.</p>
                <button type="button" onClick={onRefresh} className={`mt-5 inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold text-white shadow-lg transition-all ${styles.action}`}>
                  <RefreshCw className="h-3.5 w-3.5" /> Refresh directory
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
