# 前端代码后续优化任务

## 高优先级

- [ ] 移除车辆列表渲染中的 `innerHTML` 拼接。
  - 问题：`renderCarList()` 直接把 `carName`、`btname`、`imei` 等接口字段拼进 HTML，接口数据未转义时存在 XSS 风险。
  - 建议：改用 `document.createElement()`、`textContent` 和 `dataset` 构建车辆卡片。
  - 验收：车辆名称中包含 `<script>`、HTML 标签或特殊字符时，只作为纯文本显示。

- [ ] 将车辆选中逻辑改为 `data-imei` 精确匹配。
  - 问题：`selectCar()` 通过 `textContent.includes(car.imei)` 查找 DOM，文案变化或 IMEI 片段重叠时可能误选。
  - 建议：渲染车辆项时写入 `data-imei`，选中时按 `el.dataset.imei === car.imei` 判断。
  - 验收：多个相似 IMEI 车辆同时存在时，点击哪辆只高亮哪辆。

- [ ] 增加云端 token 失效处理。
  - 问题：恢复 `localStorage` 或 `/api/token` 后直接 `loadCars()`，失败只写日志，UI 登录态可能不清晰。
  - 建议：当车辆列表接口返回认证失败或 token 无效时，清空 token、恢复登录表单、提示重新登录。
  - 验收：过期 token 不会让界面停留在“云端待选车”或错误登录态。

- [ ] 统一控车命令入口的异常捕获。
  - 问题：`sendCmd()` 失败后会 `throw e`，普通按钮点击入口没有统一 `try/catch`，可能出现未处理 Promise rejection。
  - 建议：命令按钮事件中的 `run()` 包一层统一 `try/catch`，蓝牙/云端失败都进入反馈区和日志。
  - 验收：断连、写入失败、云端失败都不会产生未捕获异常，UI 能恢复按钮状态。

- [ ] 真机验证危险动作长按交互。
  - 问题：设防、断电长按只监听 pointer 事件，移动端长按系统菜单、触摸滚动、页面失焦等情况还没验证。
  - 建议：补充 `contextmenu` 阻止、`lostpointercapture`/`blur` 等取消路径，必要时使用 pointer capture。
  - 验收：安卓 Chrome/Edge 真机上长按进度、松手取消、滑出取消都稳定。

## 中优先级

- [ ] 将 `cloudMode` 重构为明确的 `activeChannel`。
  - 问题：`cloudMode` 同时表达当前通道和是否云端控车，语义容易再次混淆。
  - 建议：改为 `activeChannel: 'cloud' | 'ble'`，云端是否可控单独由 `cloudToken && selectedImei` 判断。
  - 验收：tab 切换、登录恢复、选车、BLE 认证状态互不污染。

- [ ] 梳理反馈状态管理。
  - 问题：`setFeedback()`、`updateState()`、长按 reset 之间互相覆盖文案，后续扩展容易产生状态回退。
  - 建议：把反馈状态抽成明确状态机或单一 `renderFeedback(state)`。
  - 验收：Idle、Ready、Hold、TX、OK、Fail、Timeout 的文案和动画不会被无关 `updateState()` 覆盖。

- [ ] 区分控车命令忙状态和工程调试命令忙状态。
  - 问题：全局 `commandBusy` 会同时锁住常用控车和工程调试按钮。
  - 建议：拆成 `controlBusy` 和 `debugBusy`，或给按钮组配置独立锁定范围。
  - 验收：常用控车发送中按预期锁定危险操作，工程调试能力按需求独立或明确禁用。

- [ ] 清理或使用 `activeCommandName`。
  - 问题：`activeCommandName` 当前只赋值，没有实际用途。
  - 建议：删除该变量，或用于反馈区显示当前执行命令和恢复指定按钮状态。
  - 验收：代码无无效状态变量，命令执行状态来源清晰。

- [ ] 限制日志最大行数。
  - 问题：textarea 日志无限追加，BLE 高频日志或长时间使用会拖慢页面。
  - 建议：限制到 300-500 行，超出时丢弃最旧日志。
  - 验收：长时间诊断后页面输入和滚动仍保持流畅。

- [ ] 减少重复 DOM 环境检测。
  - 问题：`updateSupportNotes()` 每次 `updateState()` 都检测 Web Bluetooth 和安全上下文。
  - 建议：初始化时检测一次，或只在必要事件中刷新。
  - 验收：状态刷新逻辑只处理状态，不重复执行静态环境检测。

- [ ] 增加 Service Worker 注册失败日志。
  - 问题：service worker 注册失败被静默吞掉，部署或 PWA 调试时不透明。
  - 建议：失败时写入 `console.warn` 或工程日志，但不影响控车主流程。
  - 验收：PWA 注册异常可见，控车功能不依赖 service worker。

## 低优先级

- [ ] 用 class 状态替代内联 `style="display:none"`。
  - 问题：HTML、CSS、TS 混用内联 display 状态，维护成本较高。
  - 建议：统一使用 `.is-hidden`、`.is-open`、`.is-logged-in` 等 class。
  - 验收：显示/隐藏状态主要由 CSS class 控制，TS 只切换 class。

- [ ] 为关键 DOM 查询增加轻量保护。
  - 问题：`$()` 使用非空断言，DOM 缺失会直接 runtime crash。
  - 建议：保留开发便利，但对关键初始化节点给出明确错误或 fallback。
  - 验收：缺失关键节点时错误可定位，不出现难查的空引用异常。

- [ ] 真机复核 `520px` 移动断点。
  - 问题：断点根据 DevTools emulation 和当前布局确定，仍需覆盖 360/390/430px 真机宽度。
  - 建议：安卓 Chrome/Edge 和 iOS Safari 各测一次主要页面状态。
  - 验收：主流手机宽度下首屏控车区、反馈区和状态栏不拥挤、不遮挡。

- [ ] 评估背景渐变随页面高度变化的影响。
  - 问题：背景仍绑定在 `body` 整页高度，抽屉或日志展开后过渡位置会变化。
  - 建议：如果后续视觉仍不稳定，再考虑拆出固定背景层；当前先保留接近原版的方案。
  - 验收：连接抽屉和工程日志展开后背景过渡不突兀。

- [ ] 真机检查 `backdrop-filter` 兼容性。
  - 问题：部分安卓 WebView 或旧 iOS Safari 对 `backdrop-filter` 支持不一致。
  - 建议：为关键半透明组件准备无 blur 的可接受 fallback。
  - 验收：不支持 blur 的浏览器上文字仍清晰、组件层级仍明确。

- [ ] 优化移动端输入属性。
  - 问题：手机号、验证码、Hex 输入缺少更精确的 `autocomplete`、`inputmode`、`maxlength` 等属性。
  - 建议：手机号使用 `inputmode="tel"` 和 autocomplete，验证码使用 `inputmode="numeric"`，Hex 输入关闭自动纠错。
  - 验收：手机键盘类型正确，输入体验更顺手。

## 最终验收

- [ ] 全部修复完成后执行统一验证并上传仓库。
  - 问题：单项修复完成不代表整体可发布，仍可能存在构建、移动端布局、控制台、Lighthouse 或 git 状态回归。
  - 建议：所有高/中/低优先级任务完成后，统一执行 `npm run build`、浏览器移动端检查、控制台检查、Lighthouse snapshot mobile 和 `git status` 审计。
  - 验收：构建通过，控制台无 error/warn，移动端无横向溢出和遮挡，Lighthouse 关键项通过，工作树只包含预期改动；随后提交并推送到 GitHub `ch6vip/tailg-ble-web`。
