# 架构与公共约定

## 启动与页面切换
- `src/main.tsx`：先启用 `logger` 的生产环境日志保护，再以 StrictMode 挂载 `App`。
- `src/App.tsx`：持有 `AuthState`。没有路由器，按登录状态渲染登录页、员工端或管理员后台；两个 Dashboard 都包在 `ErrorBoundary` 内。登录页与员工端包在 `LanguageProvider` 内，管理员后台没有。
- 监听 `AUTH_LOGOUT_EVENT`（`work_platform_logout`），收到后切回登录页。

## 登录与会话（自建，不用 Supabase Auth）
`src/lib/auth.ts`
- `login()`：按用户名同时查 `admins` 与 `users`，管理员优先。管理员调 `create_admin_financial_session`，员工调 `create_employee_financial_session`。
- 会话存于 `sessionStorage['work_platform_auth']`（每个浏览器分页独立）：
  - 管理员：`{ user, userType: 'admin', adminSessionToken }`
  - 员工：`{ user, userType: 'employee', sessionToken, financialSessionToken, tabId }`
- 常用导出：`getAdminFinancialSessionToken()`（没有有效 token 会抛错）、`getEmployeeFinancialSession()`、`createFinancialOperationId()`（UUID）、`logout()`（撤销 financial session；员工另停止派单会话；最后派发登出事件）。
- 数据库端验证：
  - 管理员：`private.get_financial_admin_context(token)` → `admin_id`、`admin_role`（检查 hash、过期/撤销、管理员是否启用）。
  - 员工：`private.get_financial_employee_id(user_id, token, tab_id)`；另有可调用的 `validate_employee_session` RPC。
  - 部分旧 RPC 的参数名叫 `p_admin_id`，实际传的是会话 token。
- `src/lib/TabSessionManager.ts`：用 BroadcastChannel 广播 `NEW_LOGIN` / `LOGOUT`，同账号其他分页随之失效；浏览器不支持时每 30 秒向服务器核对。前端时限：员工 24 小时、管理员 7 天。
- 员工登录失效（2026-10-10 真实浏览器实测）：服务器端员工会话 24 小时到期；`create_employee_financial_session` 每次登录都撤销该员工所有旧会话，并把 `users.current_session_token` 换成新标记。旧页面靠 `EmployeeDashboard` 订阅自己 `users` 行的 Realtime UPDATE 发现标记改变（`anon` 可读该列），约 0.4 秒弹出「Session Expired」，5 秒倒数后登出回登录页；断网/后台时错过推送，重新连线后约 0.1 秒补到同一事件。其他发现途径：带员工会话的通知 RPC 返回 `Employee session is invalid or expired.`（每 30 秒或回到前台时检查）、`TabSessionManager` 前端 24 小时计时。旧页面登出时 `revoke_financial_session` 只清除仍等于自己标记的 `current_session_token`，不会把新设备踢下线；此时 `stop_employee_dispatch_session_secure` 因会话已失效返回 400，属预期。客服聊天的读取与发送不使用员工会话，所以登录失效不会让聊天变空白；重新登录后列表与会话 1 秒内正常显示。
- 登录限流：`src/lib/rateLimitService.ts`（检查 RPC 出错时放行）；管理员解锁用会话 token。
- 登录纪录：`src/lib/loginHistoryService.ts` 记录 IP、UA、设备（IP 查询走 ipify，会被 CSP 拦截而记为 Unknown）；`src/lib/deviceInfo.ts` 解析设备信息。

## 数据访问模式
- 组件直接调用 `supabase.from(...)` / `supabase.rpc(...)`。没有全局状态库（无 Redux/Zustand），状态多在组件内 `useState`。
- `src/lib/supabase.ts`：
  - typed client（类型来自 `src/types/database.ts`），读取 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`。
  - 普通请求超时 8 秒，稽核/归档请求 120 秒；网络错误有 XHR 回退。
  - 只对 GET 与白名单只读 RPC/稽核读取自动重试（最多 2 次），写操作不重试，避免重复执行。新增只读 RPC 如需重试，要加入白名单。
  - `formatSupabaseError()`：统一把错误转成可显示的文字。
- Realtime 一般只当作「有变化」的信号：收到后防抖、再重新查询。异步请求用请求序号或 AbortSignal，防止旧响应覆盖新结果。
- 后台页面懒加载；打开过的 tab 保持挂载，用 `hidden` 切换（切换时状态不丢失）。
- 工作区缓存 `src/lib/serviceWorkspaceCache.ts`：按管理员 + 工作区缓存，合并相同的并发请求，瞬时错误重试 2 次。
- 品牌配置：`useCompanyName()`、`useCurrencyUnit()` 读 `admin_configs`（考虑 `branding_mode` 全局/自定义），默认 `AAA SERVICE`、`USDC`，带 localStorage 缓存与 Realtime 更新。

## src/lib 工具速查
| 文件 | 用途 |
|---|---|
| `contentAudit.ts` | 调用 Edge Function `content-audit` 的全部封装（留证改删、永久删除、私有附件读取） |
| `sanitizeHTML.ts` | DOMPurify 净化：`sanitizeHTML`、`sanitizeAnnouncementContent`、`sanitizeUserInput`、`sanitizeChatMessage` |
| `fileValidation.ts` | 上传前校验文件名、MIME、扩展名、大小、文件头 |
| `imageOptimizer.ts` | 压缩 HTML 中的 base64 图片并上传 `template-images` |
| `storageUpload.ts` | 带进度的 Storage 上传 |
| `storageCleanup.ts` | 从 HTML 提取已知存储桶的文件并删除 |
| `dateUtils.ts` | UTC 日期边界与格式化 |
| `safeUtils.ts` | 安全取值与格式化（数字、日期、金额、JSON） |
| `usePaginatedList.ts` | 本地数组分页 Hook |
| `passwordHash.ts` / `bcryptWorker.ts` | bcrypt（在 Web Worker 中执行，失败回退主线程） |
| `logger.ts` | 生产环境隐藏普通日志与敏感信息 |
| `dbValidation.ts` | 可选的 schema 检查与安全查询封装 |
| `devicePerformance.ts` / `useDeviceOptimization.ts` | 按设备性能降级动画、列表与图片 |
| `responsiveBreakpoints.ts` / `useResponsive.ts` | 断点与响应式 Hook |
| `useCompanyName.ts` / `useCurrencyUnit.ts` | 公司名称与货币单位 |

## 样式与界面约定
- Tailwind 自定义断点：`xs` 360、`sm` 480、`md` 600、`lg` 1025、`xl` 1280、`2xl` 1536（与 Tailwind 默认值不同）。
- `src/index.css` 全局可复用类：`scrollbar-dark`、`audit-detail-scroll`、`audit-detail-scroll-light`、`dark-panel-scroll`、`dispatch-orders-scroll`、`login-history-*`、`message-content-dark`。
- 后台为深色 slate/cyan 风格，组件里大量内联 Tailwind。
- 有多个超大单文件组件：`CccServiceManagement.tsx`（6000+ 行）、`EmployeeManagement.tsx`（约 5900 行）、`CustomerServiceManagement.tsx`（约 5100 行）、`OrderDispatch.tsx`（约 4800 行）。修改前先用搜索定位，尽量小范围改动。
- 命名：组件 PascalCase，函数与变量 camelCase，Hook `use*`，数据库字段 snake_case。

## 构建与部署
- `package.json` scripts：`dev`、`build`、`lint`、`preview`、`typecheck`、`test:audit-cleanup`。
- TypeScript strict，开启 `noUnusedLocals`、`noUnusedParameters`；ESLint 9 flat config（TS 推荐规则 + react-hooks + react-refresh）。
- `vite.config.ts`：分包，构建时移除 `debugger` 与 console 日志。
- `vercel.json`：输出 `dist`；所有路径 rewrite 到 `index.html`（SPA）；静态资源长缓存；CSP 的 `connect-src` 只允许 `'self'`、`https://*.supabase.co`、`wss://*.supabase.co`。
- 环境变量：`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`，可选 `VITE_FORCE_PRODUCTION_LOGS`（见 `.env.local.example`）。
