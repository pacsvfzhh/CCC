# 数据库、服务端与运维

正式环境：Supabase 项目 `hxpbpqoqkoiiplvdwmld`。本文中「正式环境」的内容于 2026-10-09 只读核对。

## 核心表（public）
| 领域 | 表 |
|---|---|
| 账号与会话 | `users`（员工）、`admins`（`role`、`parent_id`）、`admin_financial_sessions`、`employee_financial_sessions`、`financial_admin_credentials`、`financial_employee_credentials`、`financial_login_attempts`、`login_attempts`、`account_locks`、`account_lock_events`、`employee_login_history`、`employee_login_history_events`、`employee_presence_events`、`work_sessions` |
| 配置 | `system_configs`（全局 JSON 配置）、`admin_configs`（各管理员品牌等）、`group_configs`、`admin_groups`、`admin_group_members` |
| 钱包与财务 | `wallets`、`wallet_transactions`、`withdrawals`、`withdrawal_events`、`financial_operations`、`wallet_ledger_entries`、`wallet_balance_baselines`、`wallet_reconciliation_queue`、`wallet_reconciliation_audit`、`commission_audit_log`、`money_data_protection_audit` |
| 订单与派单 | `orders`（及 `orders_history*`）、`product_types`、`valid_order_data`（及 `_archive` 与统计/日志表）、`used_order_data`、`dispatch_groups`、`dispatch_group_members`、`dispatch_group_orders`、`dispatch_order_pools`、`dispatch_pool_selections`、`dispatch_orders`、`dispatch_assignments`、`dispatch_sessions`、`dispatch_config`、`dispatch_rate_limits`、`dispatch_performance_metrics`、`dispatch_system_logs`、`submit_time_groups`、`employee_submit_time_settings` |
| 通知 | `messages`（`audit_origin`、`automation_execution_id`）、`message_recipients`、`message_templates`、`notification_automation_*`（plans、plan_members、tasks、task_recipients、progress、queue、executions）、`broadcast_messages`、`broadcast_recipients` |
| 公告 | `announcements`、`announcement_categories` |
| 聊天 | `simulated_customers`、`customer_employee_conversations`、`customer_service_sessions`、`rich_card_contents`、`cs_message_templates`、`customer_auto_messages`、`customer_auto_message_logs`、`rating_requests`、`service_ratings`、`ccc_conversation_annotations` |
| 身份验证 | `verification_requests` |
| 历史清理 | `history_cleanup_config`、`history_cleanup_log`、`data_retention_policies`、`bulk_import_log` |

`private` schema：内容稽核与已删员工相关表（见 `docs/content-audit.md`）及 `notification_delivery_operations`；`anon` / `authenticated` 没有该 schema 的使用权限。

## RPC 与安全约定
- 浏览器以 `anon` 角色执行（不用 Supabase Auth），身份在 RPC 内验证：管理员 `private.get_financial_admin_context(token)`，员工 `private.get_financial_employee_id(user_id, token, tab_id)`。
- 新 RPC 写法：

```sql
CREATE FUNCTION public.example_admin_action(p_admin_session_token uuid, p_target_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp AS $$
DECLARE v_admin uuid; v_role text;
BEGIN
  SELECT admin_id, admin_role INTO v_admin, v_role
  FROM private.get_financial_admin_context(p_admin_session_token);
  IF v_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Super administrator permission is required.';
  END IF;
  -- 业务逻辑
  RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.example_admin_action(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.example_admin_action(uuid, uuid) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
```

- 只给 Edge Function 调用的 RPC 只授权 `service_role`。
- 财务：`users`、`admins`、`wallets`、`wallet_transactions`、`withdrawals` 已撤销直接写权限，只能走 RPC（`20260914221000_harden_financial_permissions.sql`）。
- 通知/聊天正文的修改与稽核删除由仅限 `service_role` 的 RPC 执行（经 Edge Function `content-audit`）。

## 正式环境安全现状（2026-10-09 核对，未修改）
- `anon` 不能写入：`users`、`admins`、`wallets`、`wallet_transactions`、`withdrawals`、`messages`、`system_configs`、`dispatch_assignments`。
- `message_recipients`：`anon` 只能读取与新增，不能直接更新；已读与投递状态只能经 `mark_employee_notification_read`、`complete_notification_delivery` 等验证会话的 RPC 更新。2026-10-09 迁移 `20261101000001_lock_notification_recipient_status.sql`（正式库版本 `20261009104257`）撤销了原先可改任何人已读状态的列级更新权限、条件为 `true` 的「Allow updating message recipients」策略，以及旧 RPC `mark_message_as_read`、`mark_login_popup_as_shown` 的浏览器权限（前端 9 月 20 日起已不用）。
- `customer_employee_conversations`：`anon` 可 INSERT，只能更新 `is_read`、`read_at`；`simulated_customers`：`anon` 只能 INSERT。
- **仍对 `anon` 开放增删改**（RLS 策略条件为 `true`）：`orders`、`announcements`、`product_types`、`verification_requests`、`admin_configs`。因为不用 Supabase Auth，理论上任何拿到公开 anon key 的人都能改这些表。要收紧，需要把相关写入改成验证会话的 RPC 并同步修改前端——尚待用户决定。
- `verification-documents` 存储桶为公开桶（身份证件可凭 URL 访问）。
- Supabase advisor 提示 `private.*` 表未启用 RLS：已核实 `anon` / `authenticated` 对 private schema 没有使用权限，实际无法访问。另有大量 public `SECURITY DEFINER` 函数可被 anon 执行的提示，属于整库的既有状况。

## 迁移
- 本地：`supabase/migrations/<时间戳>_<名称>.sql`，按文件名排序。部分文件名时间戳超前于实际日期，只用于排序；新文件的时间戳必须大于目前最新的文件。
- 部署到正式库：用 Supabase MCP `apply_migration`（`name` 用与本地文件名后半段相同的 snake_case）。正式库按实际执行时间记录版本，例如本地 `20261030000000_reclaim_audit_deletion_confirmations.sql` 在正式库的版本是 `20261008181146`。部署前必须取得用户确认。
- 主要阶段：
  - 2025-10 初始：`20251029151618_create_quantum_trader_schema.sql`（admins、users、orders、wallets、wallet_transactions、withdrawals、admin_configs）、`20251029172427_add_verification_requests.sql`。
  - 2025-11：通知 `20251101000000_create_messages_system.sql`；派单 `20251101185326_create_order_dispatch_system.sql`、`20251102171543_create_dispatch_groups_system.sql`；工时 `20251101202559_create_work_sessions_tracking.sql`；聊天 `20251103221511_recreate_customer_simulation_system.sql`；历史资料 `20251113191637_create_history_data_management_system.sql`；函数 search_path 修复 `20251129073341_fix_all_function_search_paths.sql`。
  - 2026-05：订单处理改为 RPC `20260502173156_create_process_pending_orders_rpc.sql`、`20260502183725_add_process_pending_orders_cron_job.sql`。
  - 2026-09：财务系统 `20260914220000_add_atomic_wallet_financial_system.sql` 与权限收紧 `20260914221000_harden_financial_permissions.sql`；全局员工搜索 `20260918021342_add_global_employee_search_rpc.sql`；派单生命周期 `20260918215530_server_authoritative_dispatch_lifecycle.sql`；通知自动化 `20260918231458`、`20260922001942`、`20260922185616`。
  - 2026-10：历史清理排程 `20261001043534_unify_history_cleanup_schedule.sql`；内容稽核与已删员工 `20261002000000` 至 `20261030000000`（见 `docs/content-audit.md`）；通知自动化扩容与通知状态权限 `20261101000000`、`20261101000001`（正式库版本 `20261009104010`、`20261009104257`，见 `docs/notifications.md`）。

## pg_cron 定时任务（时间为 UTC；2026-10-09 最近一次运行均成功）
| 正式任务名 | 频率 | 调用 | 用途 | 定义迁移 |
|---|---|---|---|---|
| `auto_cleanup_due_history_data_every_minute` | 每分钟 | `auto_cleanup_due_history_data()` | 历史资料到期清理 | `20261001043534` |
| `collect-audit-deletion-confirmations` | 每分钟 | `private.collect_audit_deletion_confirmations()` | 回收失效的删除确认 | `20261030000000` |
| `enqueue-daily-wallet-reconciliation` | 每天 03:17 | `enqueue_all_wallets_for_reconciliation()` | 钱包对账入队 | `20260914220000` |
| `process-wallet-reconciliation-queue` | 每分钟 | `process_wallet_reconciliation_queue(100)` | 执行钱包对账 | `20260914220000` |
| `process_notification_automation_queue_every_five_seconds` | 每 5 秒 | `CALL private.run_notification_automation_queue(200, false)` | 自动通知快队列 | `20261101000000` |
| `process_notification_automation_queue_every_minute` | 每分钟 | `CALL private.run_notification_automation_queue(200, true)` | 自动通知（另安排年度日期任务） | `20261101000000` |
| `process_pending_orders_every_minute` | 每分钟 | `process_pending_orders()` | 处理 processing 满 3 分钟的订单 | `20260502173156` |
| `reconcile_dispatch_lifecycle_every_minute` | 每分钟 | `auto_cleanup_dispatch_system()` | 派单生命周期协调与清理 | `20260918215530` |
| `weekly_cleanup_practice_data` | 每周日 02:00 | `cleanup_all_practice_data()` | 清理练习数据（函数存在于正式库，仓库没有定义，含义待确认） | `20260502201643` |

## Storage 存储桶（正式环境）
| 存储桶 | 公开 | 用途 |
|---|---|---|
| `announcement-images` | 是（上限 100MB） | 公告图片、视频、封面 |
| `chat-images` | 是 | 聊天图片、Word 导入图片 |
| `template-images` | 是 | 范本与正文中压缩后的图片 |
| `super-customer-avatars` | 是（上限 5MB） | 聊天角色自定义头像 |
| `website-icons` | 是（上限 5MB） | 网站图标 |
| `verification-documents` | 是 | 员工身份证件 |
| `content-audit-evidence` | 否 | 稽核证据（只经 Edge Function 读取） |

## Realtime publication（正式环境）
`account_lock_events`、`account_locks`、`admin_configs`、`admins`、`announcements`、`customer_employee_conversations`、`dispatch_group_members`、`dispatch_group_orders`、`dispatch_groups`、`dispatch_order_pools`、`dispatch_sessions`、`employee_login_history_events`、`employee_presence_events`、`message_recipients`、`orders`、`product_types`、`rating_requests`、`system_configs`、`users`、`verification_requests`、`wallet_transactions`、`wallets`、`withdrawal_events`、`work_sessions`。

不在清单中的表（如 `messages`、`simulated_customers`、`dispatch_assignments`）订阅后收不到事件。

## Edge Functions（正式环境）
| 名称 | 版本 | 源码 | 说明 |
|---|---|---|---|
| `content-audit` | v14 | `supabase/functions/content-audit/index.ts` | 稽核留证、永久删除、私有附件读取；`verify_jwt=false`，由 RPC 验证会话 |
| `process-orders` | v12 | 无 | 旧版订单处理，已改为 RPC，前端未调用 |
| `cleanup-dispatch` | v4 | 无 | 旧版派单清理，前端未调用 |

- 部署 `content-audit`：用 Supabase MCP `deploy_edge_function`，保持 `verify_jwt: false`；部署前必须取得用户确认。

## 类型与测试
- `src/types/database.ts` 手工维护（没有生成脚本）：新增 RPC 时补充 `Functions` 的 `Args` / `Returns`；改表时同步 `Row` / `Insert` / `Update`。
- `supabase/tests/audit-cleanup.test.mjs`：用 PGlite 加载缩减版 schema，再执行指定的真实迁移；每个测试在事务中执行后回滚。运行 `npm run test:audit-cleanup`。
- `supabase/config.toml` 只配置了 `process-orders`、`cleanup-dispatch`；`supabase/health_check.sql` 是为新部署准备的只读检查，期望的定时任务与存储桶清单已过时。
