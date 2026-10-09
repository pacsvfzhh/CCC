# 聊天工作区：「模擬客戶」与「經理」

| 后台导航 | 组件 | `source_type` |
|---|---|---|
| 模擬客戶 | `CustomerServiceManagement.tsx` | `aaa_service` |
| 經理 | `CccServiceManagement.tsx` | `ccc_service` |

员工端两个工作区都在 `src/components/employee/CustomerServiceChat.tsx`。

## 数据结构
- `simulated_customers`：聊天角色（客户/经理），可设 `is_super`、头衔、徽章、VIP、自定义头像，按管理员隔离。
- `customer_employee_conversations`：聊天消息（客户 ↔ 员工配对）。打开会话用 `get_or_create_service_session`（表 `customer_service_sessions`）。
- 相关表：`rich_card_contents`（冻结的富卡内容）、`cs_message_templates`、`customer_auto_messages`、`customer_auto_message_logs`、`rating_requests`、`service_ratings`、`ccc_conversation_annotations`。
- 消息类型：`text`、`image`、`rating_request`、`rating_result`、`tip`、`rich_card`。

## 后台功能
- 超管用 `AdminGroupPicker` 选择要查看的管理员工作区（未读多的排前面，并预取前 4 组）；二级直接进入自己的工作区。
- 消息每页 50 条；图片存 `chat-images`；自定义头像存 `super-customer-avatars`（`CustomerAvatarPicker` 只返回 `customer-avatar:regular|vip:<index>` 这类虚拟键）。
- 打赏：`send_customer_service_tip_atomic`（财务 RPC，需要会话 token 与操作编号），流水记在 `wallet_transactions`。
- 范本：`cs_message_templates`（按管理员 + `source_type` 分区）。`CustomerAutoMessages.tsx` 管理每个客户的快捷内容（`quick_send` / `rich_card`）——这不是定时自动化；员工登录时会自动发送已启用的自动消息。
- 富卡冻结：发送时写入 `source_template_id`，数据库 `BEFORE INSERT` 触发器把范本 HTML 复制到 `rich_card_contents` 并设 `content_frozen=true`。之后修改范本不会改变已发出的卡片。
- 修改/删除：单条消息、整段对话、删除客户、范本、自动消息都走 `mutateAuditedContent`（`chat_edit`、`chat_delete`、`conversation_delete`、`customer_delete`、`template_edit` / `template_delete`、`auto_edit` / `auto_delete`），留证进入「內容稽核總覽」。
- 已读：浏览器端只能更新 `customer_employee_conversations` 的 `is_read`、`read_at` 两列（正式库列级权限），不能直接改消息内容。

## 缓存与实时
- `src/lib/serviceWorkspaceCache.ts`：按管理员 + 工作区缓存分组、客户/员工与会话摘要；组件另按 `customerId:employeeId` 缓存消息。
- Realtime：`customer_employee_conversations` 的 INSERT/UPDATE/DELETE → 短延迟刷新，另每 15 秒兜底刷新工作区摘要；后台已打开的会话也每 15 秒兜底刷新消息与已读状态（页面不可见或正在翻看旧消息时跳过）。
- 频道名都经 `uniqueRealtimeChannelName()`（`src/lib/realtimeChannel.ts`）加唯一后缀，重建订阅时不会复用正在关闭的同名旧频道。
- 后台摘要用 `fetchConversationSummaryRows()` 分页读 `get_ccc_conversation_summaries`（每页 1000 行，正式库单次上限也是 1000）；单个客户的会话列表也走这个 RPC，不再把全部消息拉到前端统计。
- `simulated_customers` **不在** Realtime publication 中，组件里对它的订阅收不到事件。

## 员工端 `CustomerServiceChat.tsx`
- 会话摘要用 `get_employee_conversation_summaries`（只返回与员工同组管理员的客户；员工属超管时不限）。客户 `source_type` 在页面内缓存。
- 已读：只有面板打开、页面可见、确实有未读时，才把截至屏幕上最新一条的客户消息标为已读。
- 可靠性：订阅失败/断开会退避重订阅，重连后补拉列表和当前会话；另有兜底刷新（面板打开每 30 秒、关闭每 5 分钟，刚刷新过则跳过；切回页面或网络恢复时补拉）。列表或消息加载失败显示「加载失败 + 重试」，不再误显示为「暂无会话/暂无消息」。工单号每个会话只请求一次。
- 消息刷新以屏幕上的消息为准合并：保留已翻出的旧页和发送中的消息；发送结果与实时推送同时到达时不会显示两条。
- 员工可发送文字、图片、评分请求；富卡内容从 `rich_card_contents`、范本或自动消息读取，净化后显示；评分结果与打赏以卡片显示，员工端没有发起打赏的入口。
- `QuickCopyRichContent.tsx` 用于通知详情等处的一键复制富文本，不是聊天富卡的渲染组件。
