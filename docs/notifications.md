# 通知、通知自动化与公告

## 后台发送 `MessageManagement.tsx`（导航「通知」）
- 收件人面板：二级只看到自己的员工；可按启用/已验证、姓名或员工 ID 筛选；多个标签之间是 **OR** 条件；已勾选的员工排到列表最前面；改变筛选不会取消已勾选。
- 发送：`send_admin_message_with_delivery`，参数含 `delivery_mode`（`realtime_only` / `login_only` / `realtime_with_login_fallback`）、优先级、可选奖金和 `operation_id`。内容相同的请求复用同一个操作编号，避免重复发奖。
- 奖金：`send_admin_message_secure` 在同一事务内为每位收件人调用 `private.credit_performance_bonus`：写一笔 `wallet_transactions(type='performance_bonus')`，`wallets.available_balance` 与 `users.total_income` 同步增加，并由触发器记入 `wallet_ledger_entries`、排入钱包对账；任何一步失败整笔回滚。总额 = 金额 × 收件人数。前端金额没有上限、不四舍五入（确认框会显示人均与总额）。永久删除员工时，其奖金流水与自动执行记录一并清除。
- 范本：`message_templates`（按 `admin_id` 隔离），可载入、套用、新增、修改、删除。
- 已读显示：汇总 `message_recipients.is_read` / `read_at`。筛选「已讀」= 有收件人且全部已读；「未讀」包含部分已读。
- 修改/删除：只允许管理员手动发送的通知，经 `mutateAuditedContent('notification_edit' | 'notification_delete')` 留证；系统自动通知在界面上不能编辑或勾选删除。

## 通知来源 `messages.audit_origin`
| 值 | 含义 |
|---|---|
| `manual_admin` | 管理员手动发送（包括套用范本后再发送） |
| `automation` | 自动化任务发送（`automation_execution_id` 不为空） |
| `unverified` | 旧通知或无法证明来源，界面显示「舊通知 · 來源待核實」 |

- 稽核只针对管理员手动通知的修改与删除；自动通知不留证（迁移 `20261002000000_protect_manual_notifications_and_service_chats.sql`）。

## 员工端已读规则
- 打开某条通知的详情才算已读；点击弹出卡片看到详情算已读；登录弹窗显示即算已读；只看列表不算。细节见 `docs/employee-portal.md`「通知与公告」。

## 删除员工时的通知处理
- 先封存员工；其手动/待核实通知的快照进入「已刪員工紀錄」的通知档案，然后移除该员工的收件关系。
- 多人通知保留，只去掉这名员工；只发给他一个人的通知会被删除。自动化通知不进入档案。
- 迁移：`20261008000000_audit_deleted_employee_accounts.sql`、`20261025000001_remove_deleted_employee_notifications.sql`。

## 通知自动化 `NotificationAutomation.tsx`
- 方案（plan）状态：active / paused / archived；任务（task）状态：draft / active / paused。二级只能管理自己的；超管可切换管理员组。
- 触发条件：累计订单、每日订单、工作天数、佣金、连续工作日、年度日期、首次登录；可设一次性达标或循环。编辑任务会重置为草稿并清除进度；方案内任务的收件人是方案成员。
- RPC：`get_notification_automation_dashboard_v2`、`get_notification_automation_executions_v2`、`save_notification_automation_task_v2`、`set_notification_automation_task_status_v2`、`set_notification_automation_plan_for_employee`、`get_notification_automation_plan_assignments`。
- 执行：订单状态变化、佣金交易、工作会话结束、员工登录等触发器把员工写入 `notification_automation_queue`；pg_cron 每 5 秒执行 `process_notification_automation_queue_fast(200)`，每分钟执行 `process_notification_automation_queue(200)`（后者另安排年度日期任务）。执行时建立执行记录、`messages`（`audit_origin='automation'`）、`message_recipients`；有奖金的任务同时调用 `credit_performance_bonus` 入账，并以 `actor_type='system'` 记入 `financial_operations`。
- 判定 `private.evaluate_notification_automation_for_user`：员工第一次被某任务评估（或加入方案）时先记录当时进度作为基线，**启用/加入之前已达成的目标不补发**；同一任务版本 + 员工 + 周期 + 阶段只发一次（唯一约束）。「每天」类条件按 UTC 日期计算（北京时间 08:00 换日）。执行记录、通知、收件记录、奖金在同一事务内完成；失败时整笔回滚，员工留在队列，每次失败多等 5 秒、最长 300 秒后重试；错误只记在 `notification_automation_queue.last_error`，后台页面不显示。
- 工作天数类条件（`work_days`、`consecutive_work_days`）按 `work_sessions` 与订单同日计算，`work_sessions` 受「歷史資料」保留期影响：累计工作天数只算保留期内的天数，目标超过保留期的任务永远不会触发。保留期 2026-10-09 由 90 天改为 400 天（`20261031000001_extend_work_session_history_retention.sql`）；之前已被清理的记录无法恢复，正式库最早的工作记录是 2026-08-27。新建工作天数任务时，目标要小于这个保留期。
- 自动通知的已读状态在「通知」页（自动筛选）查看；自动化页只显示执行记录。
- 旧「共享任务」（`is_shared_template=true`）：早期给二级管理员复制用的模板。迁移 `20260920126000_execute_enabled_shared_notification_tasks.sql` 让启用中的模板也会执行，但 v2 后台只列出 `is_shared_template=false` 的任务，也不能复制或管理模板。2026-10-09 先暂停了会造成重复祝贺的「46」「654」（`20261031000000_pause_hidden_shared_notification_tasks.sql`），随后按用户要求删除全部 4 个模板及其进度记录（`20261031000002_delete_hidden_shared_notification_tasks.sql`）；正式库已没有共享模板。bb 名下两条「654」是当初从模板复制的独立任务，已保留，只清空了 `source_task_id`。表结构和旧的复制/保存 RPC 仍在，前端不再调用。
- 迁移：`20260918231458_create_notification_automation_system.sql`、`20260922001942_harden_all_notification_automation_triggers.sql`、`20260922185616_accelerate_notification_automation_queue.sql`。

## 公告 `AnnouncementManagement.tsx` + `TiptapEditor.tsx`
- 表 `announcements`，直接表操作（不经稽核）。二级只管理自己的公告；超管可管理全部，并设置全局公告与轮播。支持发布时间、隐藏、置顶排序；正文上限 500KB。
- 媒体存储桶：编辑器插入的图片/视频/封面 → `announcement-images`；正文里的 base64 图片经 `processContentImages` → `template-images`；Word 导入的图片 → `chat-images`。删除公告时会尝试清理正文图片（`src/lib/storageCleanup.ts`）。
- 员工端显示：`AnnouncementBoard.tsx`、`AnnouncementDetailModal.tsx`（用 `sanitizeAnnouncementContent` 净化）。
