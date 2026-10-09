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

## 2026-10-09 · 建立项目说明文档
- 需求：让以后每次对话都了解网站结构，并且每次修改都有说明。
- 改动：新增根目录 `AGENTS.md`（每次对话自动读取）、`docs/` 下 7 份模块文档和本更新记录；规定每次修改都要同步更新文档。
- 文件：`AGENTS.md`、`docs/architecture.md`、`docs/admin-backend.md`、`docs/employee-portal.md`、`docs/notifications.md`、`docs/service-chat.md`、`docs/content-audit.md`、`docs/database.md`、`docs/CHANGELOG.md`
- 数据库/服务端：无（只读核对了正式环境的 Edge Function、定时任务、存储桶、Realtime 与表权限）。
- 验证：文档内容已按代码与正式环境核对。
- 备注：核对时发现 5 张表对匿名角色开放增删改、证件存储桶为公开桶，已记录在 `docs/database.md`，待用户决定是否收紧。

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
