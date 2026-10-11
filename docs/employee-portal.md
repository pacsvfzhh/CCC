# 员工端

入口：`src/components/employee/EmployeeDashboard.tsx`（包在 `LanguageProvider` 内）。

## 导航
| 英文默认 / 中文 | 组件 |
|---|---|
| Announcements / 公告 | `AnnouncementBoard` |
| Order Assignment / 订单分配（手机：派单） | `OrderDispatch` |
| Orders / 订单 | `OrderSubmission` + `OrderList` |
| Daily Statistics / 每日统计 | `DailyStatistics` |
| Wallet / 钱包 | `WalletOverview`（内嵌 `WithdrawalHistory`） |

- 文字来自 `t.nav`；页面首次打开后保持挂载。
- 全局组件：`CustomerServiceChat`（聊天）、`MessageCenter`（通知中心）、`LoginPopupMessages`（登录通知）、`PasswordChange`、会话失效弹窗。

## 全局行为
- Realtime：`users` 更新时同步资料并检测会话是否被顶替；`message_recipients` 的 INSERT/UPDATE 触发通知投递。
- 铃铛未读数 = 该员工 `message_recipients.is_read = false` 的数量（不含聊天未读）。
- 登录时自动发送「模擬客戶」自动消息：读 `simulated_customers`、`customer_auto_messages`、`customer_auto_message_logs`，按员工记录避免重复发送。
- 会话机制见 `docs/architecture.md`；员工安全 RPC 需要 financial token + `tabId`。

## 屏幕适配
- 手机横屏提示 `src/components/PhoneLandscapeGuard.tsx`：手机（`pointer: coarse` 且屏幕短边 <600px）横放时全屏遮罩，提示转回竖屏；平板、电脑不拦截。按设备方向（`screen.orientation`，旧浏览器用 `window.orientation`）判断，键盘把竖屏视口压扁不会误触发。遮罩不卸载页面，输入内容与实时订阅都保留；出现时让当前输入框失焦。员工端挂在 `EmployeeDashboard`，有待接订单或订单将超时时显示浅黄/浅红提醒（`notice.tone` = `order`/`urgent`）；登录页由 `App.tsx` 挂载。文字在 `t.orientation`，样式类 `phone-landscape-guard`/`plg-*` 在 `src/index.css`。卡片高过屏幕（矮屏或系统字体放大）时组件加 `data-compact`，隐藏说明文字，保证标题与提醒可见。普通网页无法强制锁定方向（iOS Safari 不支持 `screen.orientation.lock()`），所以采用遮罩提示。
- 导航：宽 <768 底部导航用短标签（`t.nav.*Mobile`），768–1024 用完整标签（CSS 切换，不依赖 `isMobile`）；≥1025 显示顶部标签栏，1025–1279 收紧按钮内边距与字号。
- 字号：员工端组件的像素字号最小 11px（固定尺寸的计数气泡 10px），新增文字不要再用更小的像素字号。窄屏根字号缩小造成的 `text-xs`/`text-sm` 过小，由 `src/index.css` 在 `body:has(.employee-shell)` 下补下限：宽 ≤414 时 `text-xs` 为 11px（带 `xs:text-*` 变体的元素在 360px 起交给变体），宽 ≤320 时 `text-sm` 为 11.5px。宽 ≤359（iPhone SE 一类）时 `text-[15px]` 缩为 14px、`text-[40px]` 缩为 32px，`tracking-wide/wider/widest` 字距收窄，公告详情正文 14px。
- 换行：标签和正文不要用 `[overflow-wrap:anywhere]` / `break-all`（会把 TOTAL 这类普通单词拆成两行），用 `break-words`，统计卡标签再加 `hyphens-auto`；`LanguageProvider` 会把 `<html lang>` 同步为当前语言，德语等长词按音节加连字号换行。`break-all` 只留给编号、文件名等无意义字符串。
- 弹窗：`src/index.css` 里旧的全局 `[role="dialog"]` 规则（宽 ≤320 压成 300px 加内边距、矮屏限高 85vh、横屏 90vh）已用 `body:not(:has(.employee-shell))` 排除员工端，员工端弹窗自己控制尺寸（手机为全屏面板）。消息/登录通知/通知详情头部右侧留 56px（`pr-14`）给触屏下 44px 的关闭按钮。
- 留白：各标签内容底部预留 88px，最后的按钮可滚到客服悬浮按钮上方；手机根元素按实测底部导航高度（`--employee-bottom-nav-height`）留白；全屏弹窗打开时隐藏客服悬浮按钮。
- 布局断点：钱包四张金额卡 ≥1025 才排一行（以下两列）；统计汇总 ≥720 才三列；派单页 6 个统计框在 600–1279 为 3 列 × 2 行、≥1280 才一行 6 列；提交订单表单 ≥1025 才左右两栏；订单处理面板在平板及以上高度为 `clamp(420px, 视口高 − 页头 − 底部导航 − 48px, 575px)`，矮屏平板（如 1024×600）也能完整显示。

## 派单与接单 `OrderDispatch.tsx`（服务器主导）
1. 开工前要求 `employee.is_verified`；调用 `start_employee_dispatch_session_secure`。
2. `prepare_next_dispatch_order_secure`（服务器选池与时间）→ `assign_next_dispatch_order_secure` 派单；派单记录在 `dispatch_assignments`（关联 `dispatch_group_orders`）。
3. `pending` 有服务器端 60 秒截止；接单 `accept_dispatch_assignment_secure`（可能按抢单成功率失败），成功后为 `accepted`。
4. 结束 `finish_dispatch_assignment_secure`，结果为 `completed` / `error` / `timeout` / `cancelled`。
- 连续 5 单未接，服务器自动停工。客户端不能自行决定派单时刻或判定超时（已提交的订单有服务器宽限）。
- `dispatch_assignments` 不在 Realtime publication 中，状态靠 RPC 与轮询。
- 关键迁移：`20260918215530_server_authoritative_dispatch_lifecycle.sql`；pg_cron 每分钟 `auto_cleanup_dispatch_system()` 协调生命周期。

## 提交订单 `OrderSubmission.tsx`
- 订单号 9 位、交易号 11 位；`get_employee_dispatch_submit_wait_secure` 取得有效的 assignment。
- 用 `valid_order_data` 校验，`used_order_data` 防止重复使用；插入 `orders(status='processing', assignment_id)` 后调用 `mark_dispatch_assignment_submitted_secure`；标记失败会删除刚插入的订单和使用记录。
- `orders.status` 为 `processing` / `success` / `failure`（和派单状态是两回事）。pg_cron 每分钟 `process_pending_orders()` 处理已 processing 满 3 分钟的订单（每批 200）。

## 订单列表与统计
- `OrderList.tsx`：读 `orders`、`product_types`、`wallet_transactions(type='tip')`；Realtime + 每 5 秒轮询。
- `DailyStatistics.tsx`：每 10 秒调用 `get_daily_order_stats`、`get_overall_order_stats`；日期按 **UTC** 分组。

## 钱包与提现
- `WalletOverview.tsx`：读 `wallets`、`users`、`verification_requests`；总资产 = `available_balance + frozen_balance`，`total_income` 来自用户资料。
- 提现：`get_employee_withdrawal_policy_secure` 查资格（门槛来自所属派单组）→ `request_employee_withdrawal`（**提走全部可用余额**、同时只能有一笔 pending、金额转入冻结）；`cancel_employee_withdrawal` 只能取消 pending 并退回可用余额。都要带 financial token + `tabId` + 操作编号。
- `WithdrawalHistory.tsx`：提现与人工调整记录（`TransactionHistory.tsx` 未接入）。

## 账户
- `VerificationForm.tsx`：证件图片上传到 `verification-documents`（取公开 URL），写入 `verification_requests`（有待审申请则更新，否则新增）。字段沿用历史命名：身份证号存 `wallet_address`、地址存 `email`。
- `PasswordChange.tsx`：前端要求 ≥8 位且含字母和数字，调用 `change_employee_password_atomic`（数据库只要求 ≥6 位），成功 2 秒后登出。

## 通知与公告（已读规则）
- 通知中心 `MessageCenter.tsx`：用 `get_employee_notification_messages` 拉列表；**只有选中某条通知、显示详情时**才调用 `mark_employee_notification_read`，只打开列表不算已读。打开时锁定背景滚动（隐藏页面滚动、根节点设为 inert、手机端固定 body）。
- 实时弹出卡片：投递完成时传 `p_mark_read: false`；点击卡片会打开通知中心并选中该条 → 标为已读；关闭或超时则不标记。
- 登录弹窗 `LoginPopupMessages.tsx`：`has_pending_employee_login_notifications` → claim → 显示时调用 `complete_notification_delivery(p_mark_read: true)`，弹出即算已读。
- 自动化通知同样适用以上规则。
- 错过的实时通知不会丢：页面可见且在线时（每 30 秒、切回页面或恢复联网时；实时连接断开也照常执行，失败按 30 秒起倍增、最长 5 分钟重试），`claim_next_realtime_notification_delivery` 会补弹所有未投递、未过期的实时通知；`realtime_with_login_fallback` 的通知在下次登录时由登录弹窗先显示。
- 一次补弹超过 3 条时只显示一张「你有 N 条新消息」提示（只响一次提示音），点击打开通知中心但不选中任何一条，因此不会标为已读；3 条以内仍逐条弹出。实时到达的新通知照旧逐条弹出。
- `EmployeeNotificationDetailPanel.tsx` 是通知详情的展示组件（后台预览也在用），本身不写已读。
- 公告：`AnnouncementBoard.tsx` 读 `announcements`，`AnnouncementDetailModal.tsx` 净化后显示；公告没有已读标记。首次加载且没有缓存时，内容区正中显示「加载中...」；加载完成仍无公告才显示居中的「暂无公告」卡片。之后的实时刷新在后台进行，不再显示加载状态。

## 聊天
- 见 `docs/service-chat.md`（员工端组件 `CustomerServiceChat.tsx`）。

## 多语言 `src/lib/i18n/`
- 10 种语言：`en`（默认）、`es`、`zh`、`fr`、`de`、`pt`、`ja`、`ko`、`it`、`hi`；偏好存 `localStorage.employee_language`；`LanguageSwitcher.tsx` 负责切换。
- `Translations = typeof en`：新增键先加到 `locales/en.ts`，再补齐其余 9 个文件。加载时只做类型断言，缺键不会报错，运行时会显示 undefined。
- 用法：`const { t, dateLocale } = useLanguage()`；按命名空间取文字，如 `t.nav`、`t.header`、`t.session` 等。
- 现有代码中仍有少量硬编码英文。
