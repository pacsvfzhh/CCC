# 更新记录

> 新的记录写在最上面。每次修改代码、数据库或服务端都要追加一条；纯问答和只读检查不用写。
> 日期使用 UTC+8。「已部署」指已在正式 Supabase 执行；前端改动需要用户自行部署后才对正式网站生效。

格式：

```
## YYYY-MM-DD · 简短标题
- 需求：用户想解决什么
- 改动：用户能看到的变化
- 文件：主要改动的文件
- 数据库/服务端：迁移、RPC、Edge Function、定时任务的变化与部署状态（没有就写「无」）
- 验证：做了哪些检查；哪些部分未能验证
- 备注：后续事项或注意点（可省略）
```

---

## 2026-10-09 · 部署自动通知扩容迁移，删除旧测试分支
- 需求：用户同意把上一条的两项数据库更新上线，并删除 9 月建立、没有使用的旧测试分支。
- 改动：自动通知的新处理方式与错误记录已在正式库生效；浏览器不能再直接改写通知已读/显示状态。删除 Supabase 测试分支 `admin-business-api-isolation`、`combined-notifications`，现在只剩正式库本身。
- 文件：`docs/notifications.md`、`docs/database.md`
- 数据库/服务端：已部署正式库：`20261101000000_scale_notification_automation_processing.sql`（版本 `20261009104010`）、`20261101000001_lock_notification_recipient_status.sql`（版本 `20261009104257`）。前端改动仍待用户部署。
- 验证：部署前查最近 24 小时接口日志，没有任何对被关闭旧接口的调用；按提交历史，线上网站不早于 9 月 21 日版本，员工端 9 月 20 日起已改用带会话验证的已读接口。部署后：线上 14 个函数与项目文件逐字一致（md5 比对）；新排程 35 次以上全部成功、空闲时约 4 毫秒；队列为空、无失败记录；网站使用的通知与自动化接口仍可调用、实时推送设定不变；对 33 名启用方案成员试运行评估（事务回滚、不保存）全部成功，0 条会补发。Supabase 安全检查只新增两条预期提示：错误记录表开启 RLS 但无策略（故意不让浏览器直接读写），以及排程 procedure 未固定 search_path（含提交的 procedure 不能设置，只有排程能执行，函数调用全部写明 schema）。

## 2026-10-09 · 自动通知扩容与稳定性优化
- 需求：员工增多后，确保各管理员的自动化任务只发给自己名下员工、不错发漏发，且不影响现有通知与自动化功能。
- 改动：自动通知改为逐个员工处理并立即提交；员工登录不再等待设定变更的锁；同一员工某个任务失败不再拖累其他任务，失败原因显示在自动化页任务列表上方，并自动重试；跨 UTC 日处理时先补判前一天的每日/年度条件；启用任务、恢复方案、批量加成员不再当场逐个员工计算基线。员工端在实时连接断开时也会每 30 秒补弹通知，一次补弹超过 3 条时合并成一张「你有 N 条新消息」提示。浏览器不能再直接改写通知已读/显示状态。
- 文件：`supabase/migrations/20261101000000_scale_notification_automation_processing.sql`、`supabase/migrations/20261101000001_lock_notification_recipient_status.sql`、`src/components/employee/EmployeeDashboard.tsx`、`src/components/admin/NotificationAutomation.tsx`、`src/lib/i18n/locales/*.ts`、`src/types/database.ts`、`docs/notifications.md`、`docs/employee-portal.md`、`docs/database.md`
- 数据库/服务端：两个迁移已于同日部署正式库（见上一条）。内容：新表 `notification_automation_failures`、`notification_automation_plans.activated_at`、约束 `notification_automation_active_tasks_require_plan`、订单索引、procedure `private.run_notification_automation_queue`、RPC `get_notification_automation_failures`；改写自动化评估/队列/登录触发器/启用与成员 RPC；两个 pg_cron 任务改为 `CALL private.run_notification_automation_queue(...)`；撤销旧自动化 RPC 与 `mark_message_as_read`、`mark_login_popup_as_shown` 的浏览器权限，以及 `message_recipients` 已读/显示字段的直接更新权限和宽松更新策略。前端改动待用户部署。
- 验证：`npm run typecheck`、`npm run lint`、`npm run build` 通过。在临时 Supabase 测试分支（手工建立通知自动化相关的 20 张表和函数，不是完整迁移回放，已删除）用 4,500 名合成员工、3 个管理员组测试：3,445 个预期发送逐一比对无漏发、无多发、无跨组、奖金与钱包余额一致；登录在设定锁被占用时约 0.4–2.1 毫秒完成；单任务失败隔离与恢复后重试；UTC 跨日补判；暂停期间不发送、恢复后不补发暂停期间成绩（519 人逐一吻合）；中途加入 200 名成员只计加入后的订单；未来开始时间的任务只计开始后的订单；二级管理员不能读取别组失败记录；直接改写已读被拒绝、员工经 RPC 标记已读正常。测试结束全库 4,520 次发送无重复、无跨组、钱包全部吻合，1,273 次新排程全部成功。最终版迁移另用 PGlite 完整执行两次确认可重复执行。正式库只读核对：现有 4 个启用任务都符合新约束，没有未分组任务，没有缺少进度的成员。
- 备注：未在浏览器中用真实账号实测员工端补弹/合并提示和自动化页错误面板（需要登录账号，且正式库不能造测试通知），部署后请实际看一下。

## 2026-10-09 · 删除 bb 名下看不到的旧「654」任务
- 需求：用户在 bb 的后台看不到任何自动化任务；查明后选择删除这两条旧任务。
- 改动：删除 bb 名下两条不属于任何方案的「654」（9 月 19 日从旧模板复制，一条启用、一条草稿）及其 30 条进度记录。现在共 4 个任务，全部在超管「美国」方案里。
- 文件：`supabase/migrations/20261031000003_delete_legacy_ungrouped_notification_tasks.sql`、`docs/notifications.md`
- 数据库/服务端：迁移已部署正式库（版本 `20261009065642`）；不涉及函数或权限。前端无改动。
- 验证：删除前预览，未分组任务只有这两条，没有执行记录，也没有被其他任务引用；删除后未分组任务为 0，没有孤立进度记录，自动通知队列为空、定时任务正常运行。
- 备注：看不到的原因是电脑版左侧只列方案、没有「未分組任務」入口，bb 默认打开空的已暂停方案「BB」。现在已没有未分组任务，页面暂不修改。

## 2026-10-09 · 删除后台看不见的旧共享通知模板
- 需求：用户要求删除没有用的旧共享模板。
- 改动：删除超管名下 4 个共享模板（「46」「654」「1321」「544545」）及其 124 条进度记录。现在共 6 个任务，全部在后台页面可见；bb 名下两条「654」（当初从模板复制）保持原状。
- 文件：`supabase/migrations/20261031000002_delete_hidden_shared_notification_tasks.sql`、`docs/notifications.md`
- 数据库/服务端：迁移已部署正式库（版本 `20261009065039`）；不涉及函数或权限。前端无改动。
- 验证：删除前预览为 4 个模板（都不在启用中）、124 条进度、0 条执行记录、没有图片；删除后共享模板为 0，没有孤立进度记录，bb 的两条「654」状态不变，自动通知队列为空、定时任务正常运行。

## 2026-10-09 · 暂停隐藏的旧共享通知任务，工作记录保留期改为 400 天
- 需求：用户选择停用后台看不见的旧任务「46」「654」，并让「999」（累计 100 个工作日）能够触发。
- 改动：两个启用中的共享任务改为暂停，员工满 100 单不再收到重复祝贺；启用任务由 7 个变为 5 个。「工作會話記錄」保留天数由 90 改为 400，自动清理仍为每天 UTC 02:00。
- 文件：`supabase/migrations/20261031000000_pause_hidden_shared_notification_tasks.sql`、`supabase/migrations/20261031000001_extend_work_session_history_retention.sql`、`docs/notifications.md`、`docs/admin-backend.md`
- 数据库/服务端：两个迁移已部署正式库（版本 `20261009064335`、`20261009064341`）；不涉及函数或权限。前端无改动。
- 验证：部署前预览只影响这两个任务和 `work_sessions` 一项设置；部署后启用中的共享任务为 0，`work_sessions` 保留 400 天，自动通知队列为空、定时任务继续正常运行。
- 备注：90 天前已被清理的工作记录无法恢复（正式库最早为 2026-08-27）。共享任务在后台不可见，如需恢复只能改数据库。

## 2026-10-09 · 全面检查通知、自动化通知、已读与奖金（只读）
- 需求：确认自动化任务按设置发送、员工已读状态准确、手动/自动奖金计算正确、通知能送达员工端。
- 改动：无功能改动；把核对结果补充进 `docs/notifications.md`、`docs/employee-portal.md`。
- 文件：`docs/notifications.md`、`docs/employee-portal.md`
- 数据库/服务端：无（只读核对正式库函数、触发器、定时任务、队列、收件与钱包数据）。
- 验证：两个通知定时任务 24 小时 0 失败、队列为空；7 个启用任务按当前数据重算，没有“达标未发”；105 条收件记录的已读/送达字段一致；钱包对账没有修正记录。手动/自动奖金的历史流水因收件测试员工已永久删除而无法逐笔复核，只核对了函数逻辑。
- 备注：发现两个后台看不到的旧共享任务（「46」「654」）仍在执行；「工作會話記錄」只保留 90 天，导致「999」任务无法触发。两项已在同日处理（见上一条）。

## 2026-10-09 · 建立项目说明文档
- 需求：让以后每次对话都了解网站结构，并且每次修改都有说明。
- 改动：新增根目录 `AGENTS.md`（Builder 官方支持的项目说明文件，新对话先读）、`docs/` 下 7 份模块文档和本更新记录；规定每次修改都要同步更新文档。
- 文件：`AGENTS.md`、`docs/architecture.md`、`docs/admin-backend.md`、`docs/employee-portal.md`、`docs/notifications.md`、`docs/service-chat.md`、`docs/content-audit.md`、`docs/database.md`、`docs/CHANGELOG.md`
- 数据库/服务端：无（只读核对了正式环境的 Edge Function、定时任务、存储桶、Realtime 与表权限）。
- 验证：文档内容已按代码与正式环境核对。
- 备注：核对时发现 5 张表对匿名角色开放增删改、证件存储桶为公开桶，已记录在 `docs/database.md`，待用户决定是否收紧。Builder 官方文档未明确保证每次对话都会自动载入 `AGENTS.md`，已把相关措辞改为不作保证；`AGENTS.md` 93 行，低于官方建议的 500 行上限。

## 2026-10-09 · 同步远端时处理管理员页面冲突
- 需求：同步远端更新。
- 改动：`AdminManagement.tsx` 冲突时保留本地版本；远端的 5 个提交是 9 月 26 日已撤回的旧配色，页面外观与功能保持不变。
- 文件：`src/components/admin/AdminManagement.tsx`
- 数据库/服务端：无。
- 验证：typecheck、lint 通过。

## 2026-10-09 · 稽核整段对话翻页只刷新右侧
- 需求：「刪除整段對話」的内容查看在翻页时整个弹窗重新加载。
- 改动：翻页时弹窗和左侧资料保持不动，只在右侧聊天区显示加载；加载失败时保留原页并可重试。
- 文件：`src/components/admin/ContentAuditPanel.tsx`
- 数据库/服务端：无。
- 验证：typecheck、lint、build、两个工作区的模拟交互测试；未用超管账号在浏览器实测。前端需用户部署。

## 2026-10-09 · 回收删除确认暂存
- 需求：超管取消、关闭删除确认或离开页面后，不留下无用的确认暂存。
- 改动：取消、Esc、切换、离页时撤销未执行的确认；定时回收逾期或失效的确认；保留待重试的附件清理任务。
- 文件：`src/components/admin/ContentAuditPanel.tsx`、`src/components/admin/DeletedEmployeesPanel.tsx`、`src/lib/contentAudit.ts`、`supabase/functions/content-audit/index.ts`、`src/types/database.ts`、`supabase/tests/audit-cleanup.test.mjs`
- 数据库/服务端：迁移 `20261030000000_reclaim_audit_deletion_confirmations.sql`（RPC `cancel_audit_deletion_confirmation`、定时任务 `collect-audit-deletion-confirmations`）与 Edge Function `content-audit` v14 已部署正式环境。
- 验证：48 项回归测试、typecheck、lint、build。前端需用户部署。

## 2026-10-09 之前
- 内容稽核与已删员工体系（迁移 `20261002000000` 至 `20261029000002`）、员工端通知已读规则、后台导航改名、通知页员工面板调整等更早的改动没有逐条记录，请查 git 历史与 `supabase/migrations/`。
