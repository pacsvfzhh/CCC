import { Activity, ArrowUpRight, ChevronRight, MessageCircle, RefreshCw, ShieldCheck, Sparkles, Users } from 'lucide-react';

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
    eyebrow: 'AAA SERVICE / SIMULATED CUSTOMER',
    title: 'Choose a customer workspace',
    description: 'Select an admin workspace to review simulated customers, conversations, and service activity.',
    panel: 'border-orange-500/20 bg-gradient-to-br from-orange-950/35 via-slate-900/95 to-slate-950',
    glow: 'bg-orange-500/10',
    icon: 'border-orange-400/30 bg-gradient-to-br from-orange-500/25 to-amber-500/10 text-orange-200 shadow-orange-950/40',
    accent: 'text-orange-300',
    muted: 'text-orange-100/60',
    border: 'border-orange-500/20',
    chip: 'border-orange-400/20 bg-orange-500/10 text-orange-200',
    card: 'border-orange-500/20 bg-orange-950/10 hover:border-orange-400/60 hover:bg-orange-900/20 hover:shadow-[0_20px_50px_-25px_rgba(251,146,60,0.5)]',
    cardIcon: 'border-orange-400/25 bg-orange-500/10 text-orange-200 group-hover:bg-orange-500/20',
    action: 'bg-gradient-to-r from-orange-500 to-amber-500 shadow-orange-950/40 group-hover:from-orange-400 group-hover:to-amber-400',
    metric: 'border-orange-500/10 bg-orange-950/20',
    skeleton: 'bg-orange-500/10',
  },
  manager: {
    Icon: Users,
    eyebrow: 'CCC SERVICE / MANAGER WORKSPACE',
    title: 'Choose a manager workspace',
    description: 'Open a manager workspace to coordinate teams, review customer activity, and handle conversations.',
    panel: 'border-emerald-500/20 bg-gradient-to-br from-emerald-950/35 via-slate-900/95 to-slate-950',
    glow: 'bg-emerald-500/10',
    icon: 'border-emerald-400/30 bg-gradient-to-br from-emerald-500/25 to-teal-500/10 text-emerald-200 shadow-emerald-950/40',
    accent: 'text-emerald-300',
    muted: 'text-emerald-100/60',
    border: 'border-emerald-500/20',
    chip: 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200',
    card: 'border-emerald-500/20 bg-emerald-950/10 hover:border-emerald-400/60 hover:bg-emerald-900/20 hover:shadow-[0_20px_50px_-25px_rgba(52,211,153,0.5)]',
    cardIcon: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200 group-hover:bg-emerald-500/20',
    action: 'bg-gradient-to-r from-emerald-500 to-teal-500 shadow-emerald-950/40 group-hover:from-emerald-400 group-hover:to-teal-400',
    metric: 'border-emerald-500/10 bg-emerald-950/20',
    skeleton: 'bg-emerald-500/10',
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
    <div className="flex-1 min-h-0 flex flex-col gap-4 text-slate-100">
      <section className={`relative shrink-0 overflow-hidden rounded-2xl border p-5 shadow-2xl sm:p-6 ${styles.panel}`}>
        <div className={`absolute -right-20 -top-24 h-64 w-64 rounded-full blur-3xl ${styles.glow}`} />
        <div className={`absolute -bottom-32 left-1/3 h-56 w-56 rounded-full blur-3xl ${styles.glow}`} />
        <div className="relative flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border shadow-xl ${styles.icon}`}>
              <Icon className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em]">
                <span className={styles.accent}>{styles.eyebrow}</span>
                <span className={`rounded-full border px-2 py-0.5 tracking-[0.12em] ${styles.chip}`}>
                  <ShieldCheck className="mr-1 inline h-3 w-3" /> Super admin
                </span>
              </div>
              <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">{styles.title}</h2>
              <p className={`mt-1 max-w-2xl text-sm leading-6 ${styles.muted}`}>{styles.description}</p>
            </div>
          </div>

          <div className="grid shrink-0 grid-cols-3 gap-2 sm:gap-3 xl:min-w-[330px]">
            <div className={`rounded-xl border px-3 py-2.5 ${styles.metric}`}>
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400"><Users className="h-3.5 w-3.5" /> Groups</div>
              <div className="mt-1 text-xl font-semibold text-white">{groups.length}</div>
            </div>
            <div className={`rounded-xl border px-3 py-2.5 ${styles.metric}`}>
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400"><Activity className="h-3.5 w-3.5" /> Customers</div>
              <div className="mt-1 text-xl font-semibold text-white">{totalCustomers}</div>
            </div>
            <div className={`rounded-xl border px-3 py-2.5 ${styles.metric}`}>
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400"><MessageCircle className="h-3.5 w-3.5" /> Unread</div>
              <div className={`mt-1 text-xl font-semibold ${totalUnread > 0 ? 'text-rose-300' : 'text-white'}`}>{totalUnread}</div>
            </div>
          </div>
        </div>
      </section>

      <section className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-slate-950/45 shadow-2xl ${styles.border}`}>
        <div className={`flex shrink-0 flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 ${styles.border}`}>
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className={`h-4 w-4 ${styles.accent}`} />
              <h3 className="text-sm font-semibold text-white">Admin workspaces</h3>
              <span className="rounded-full border border-slate-700/80 bg-slate-900/80 px-2 py-0.5 text-[10px] font-semibold text-slate-400">{groups.length} available</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">Choose a workspace to enter its live service console.</p>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-500">
            <span>{totalEmployees} employees</span>
            <span className="h-1 w-1 rounded-full bg-slate-700" />
            <span>{totalMessages} conversations</span>
            <span className="hidden h-1 w-1 rounded-full bg-slate-700 sm:block" />
            <span className={`hidden sm:inline ${totalUnread > 0 ? 'text-rose-300' : ''}`}>{totalUnread} unread</span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-dark p-3 sm:p-5">
          {loading ? (
            <div className="grid gap-3 xl:grid-cols-2">
              {[0, 1, 2, 3].map(index => (
                <div key={index} className={`min-h-[190px] animate-pulse rounded-2xl border p-5 ${styles.border} bg-slate-900/50`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`h-11 w-11 rounded-xl ${styles.skeleton}`} />
                      <div className="space-y-2"><div className="h-3 w-32 rounded bg-slate-700/70" /><div className="h-2.5 w-20 rounded bg-slate-800" /></div>
                    </div>
                    <div className="h-6 w-16 rounded-full bg-slate-800" />
                  </div>
                  <div className="mt-8 grid grid-cols-3 gap-2"><div className="h-12 rounded-xl bg-slate-800/70" /><div className="h-12 rounded-xl bg-slate-800/70" /><div className="h-12 rounded-xl bg-slate-800/70" /></div>
                </div>
              ))}
            </div>
          ) : groups.length > 0 ? (
            <div className="grid gap-3 xl:grid-cols-2">
              {groups.map(group => {
                const unread = unreadCounts[group.admin_id] || 0;
                return (
                  <button
                    key={group.admin_id}
                    type="button"
                    onClick={() => onSelect(group)}
                    className={`group relative min-h-[190px] w-full overflow-hidden rounded-2xl border p-5 text-left transition-all duration-300 hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 ${styles.card}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors ${styles.cardIcon}`}>
                          <Users className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-base font-semibold text-white">{group.admin_username}</div>
                          <div className="mt-1 text-xs text-slate-500">Workspace ID · {group.admin_id.slice(0, 8)}</div>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {unread > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-rose-400/30 bg-rose-500/15 px-2 py-1 text-[10px] font-bold text-rose-200 shadow-lg shadow-rose-950/30">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-300" /> {unread > 99 ? '99+' : unread} unread
                          </span>
                        )}
                        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${styles.chip}`}>{formatRole(group.admin_role)}</span>
                      </div>
                    </div>

                    <div className="mt-7 grid grid-cols-3 gap-2">
                      <div className={`rounded-xl border px-3 py-2.5 ${styles.metric}`}><div className="text-[10px] uppercase tracking-wider text-slate-500">Employees</div><div className="mt-1 text-lg font-semibold text-white">{group.employee_count}</div></div>
                      <div className={`rounded-xl border px-3 py-2.5 ${styles.metric}`}><div className="text-[10px] uppercase tracking-wider text-slate-500">Customers</div><div className="mt-1 text-lg font-semibold text-white">{group.customer_count}</div></div>
                      <div className={`rounded-xl border px-3 py-2.5 ${styles.metric}`}><div className="text-[10px] uppercase tracking-wider text-slate-500">Messages</div><div className="mt-1 text-lg font-semibold text-white">{group.conversation_count}</div></div>
                    </div>

                    <div className={`mt-5 flex items-center justify-between border-t pt-4 ${styles.border}`}>
                      <span className={`flex items-center gap-1.5 text-xs font-semibold ${styles.accent}`}><span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]" /> Workspace ready</span>
                      <span className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white shadow-lg transition-all ${styles.action}`}>
                        Open workspace <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                      </span>
                    </div>
                    <ChevronRight className={`absolute -bottom-5 -right-4 h-24 w-24 opacity-[0.04] transition-transform duration-500 group-hover:translate-x-1 group-hover:-translate-y-1 ${styles.accent}`} />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex h-full min-h-[280px] items-center justify-center rounded-2xl border border-dashed border-slate-700/80 bg-slate-900/30 px-6 py-12 text-center">
              <div className="max-w-sm">
                <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border ${styles.icon}`}><Users className="h-8 w-8" /></div>
                <h4 className="mt-5 text-base font-semibold text-white">No workspaces available</h4>
                <p className="mt-2 text-sm leading-6 text-slate-500">There are no active admin workspaces to manage right now. Refresh to check for newly available groups.</p>
                <button type="button" onClick={onRefresh} className={`mt-5 inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-semibold text-white shadow-lg transition-all ${styles.action}`}>
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
