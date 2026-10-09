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
