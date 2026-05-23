# 移动端控车前端效果完整方案

## 结论

以 `docs/mobile-control-ui-prototype.html` 为目标效果，把当前工程调试型页面改造成移动端控车首页。保持当前 `Vite + TypeScript + 原生 DOM` 技术路线，不引入 React/Vue，不改 BLE、云控、协议、Worker 代理和后端鉴权逻辑。

方案核心是：重构 UI 层和状态呈现，保留现有命令链路。

## 目标效果

原型入口：

```text
http://127.0.0.1:5173/docs/mobile-control-ui-prototype.html
```

目标页面结构：

1. 顶部车辆总览：车辆名、云端/蓝牙模式、连接状态。
2. 主视觉车卡：安防状态、电门状态、链路状态。
3. 关键指标：电池余量、实时电压。
4. 常用控车：解防、上电、寻车、设防、断电、坐垫。
5. 命令反馈：发送中、成功、失败、重试。
6. 调试抽屉：Hex、QGJ 授权、状态帧、防盗帧和日志收进工程模式。

## 技术路线

保留：

1. `index.html` 作为主入口。
2. `src/main.ts` 作为 UI 事件绑定和业务编排入口。
3. `src/ble/*` 的 BLE 状态机、GATT、协议握手。
4. `src/cloud/*` 的登录、车辆状态、云端指令。
5. `server.js` 的 `/auth` 和 `/api/token`。
6. `worker/index.ts` 的台铃 API 代理边界。

调整：

1. 把大段内联 CSS 从 `index.html` 迁移到 `src/styles.css`。
2. 保留原生 DOM，但把 UI 更新逻辑拆成小函数。
3. 将高级调试面板默认改为底部抽屉/工程模式，不占主流程。
4. 增加统一命令反馈状态，不改变实际命令发送函数。

不建议：

1. 不引入 React/Vue。
2. 不引入大型 UI 组件库。
3. 不做 Canvas/WebGL 车辆动画。
4. 不把调试功能删掉，只隔离。

## 文件改造范围

第一阶段建议只改这些文件：

```text
index.html
src/main.ts
src/styles.css
```

可选新增：

```text
src/ui/state.ts
src/ui/render.ts
```

如果要保持最小改动，可不新增 `src/ui/*`，直接在 `src/main.ts` 里重组函数。

明确不改：

```text
src/ble/connection.ts
src/ble/protocol.ts
src/ble/parser.ts
src/ble/qgj-protocol.ts
src/cloud/api.ts
worker/index.ts
server.js
```

## 信息架构

当前页面问题是云端登录、BLE 配对、状态、控制、调试日志混在一屏。新结构按优先级重排：

1. 首屏只放用户最关心的信息：车辆、连接、安防、电门、电量、电压。
2. 控制按钮固定在首屏下半区，按钮尺寸按手指触控设计。
3. 云端/蓝牙切换从大 tab 改成车辆卡上的模式切换。
4. 云端登录和 BLE 连接变成连接面板，而不是首屏主体。
5. 调试能力进入工程抽屉，默认收起。

## 状态模型

沿用现有状态来源，但统一映射到 UI：

```text
conn.state -> disconnected / connecting / connected / authenticated
cloudMode + selectedImei -> 当前是否走云控
CarInfo.defenceStatus -> 安防状态
CarInfo.acc -> 电门状态
CarInfo.electricQuantity -> 电量
CarInfo.voltage -> 电压
ParsedResponse.bikeState -> BLE 实时安防/电门状态
ParsedResponse.voltage -> BLE 电压
```

新增 UI 状态：

```text
lastCommandName
commandPhase: idle | sending | success | failed
commandMessage
commandStartedAt
debugOpen
connectPanelOpen
```

这些只影响前端呈现，不影响协议。

## 控车交互

按钮策略：

1. 解防、上电、寻车、坐垫：点击执行。
2. 设防、断电：建议长按或二次确认，避免误触。
3. 命令发送后按钮短暂锁定，防止重复发送。
4. 成功/失败写入日志，也显示在主界面反馈条。

反馈策略：

1. `sending`：显示“命令已发送，等待车辆回执”。
2. `success`：显示“执行成功”，2 秒后回到 idle。
3. `failed`：显示失败原因和重试入口。
4. 云端指令目前只拿到 API 消息，可先按接口返回判断成功/失败。
5. BLE 指令以 `ParsedResponse.command.success` 为准。

## 性能策略

当前项目性能基础很好，目标是保持轻量：

1. 首屏 JS 不增加框架运行时。
2. CSS 使用单独文件，允许浏览器缓存。
3. 动画只使用 `opacity` 和 `transform`。
4. 避免大面积 `backdrop-filter` 和超重阴影。
5. 使用 CSS 绘制车辆轮廓，不引入大图片。
6. 保留 `prefers-reduced-motion`，系统减弱动态时关闭入场动画。
7. 生产包目标：JS gzip 尽量保持在 `30KB` 左右，CSS gzip 尽量控制在 `8KB` 内。

## PWA 建议

PWA 可以作为第二阶段，不建议第一阶段一起做，避免影响验证。

第二阶段可做：

1. 增加 `manifest.webmanifest`。
2. 增加应用图标。
3. 引入 `vite-plugin-pwa` 或手写极简 service worker。
4. 缓存静态资源，不缓存云控 API。
5. 保证 Web Bluetooth 仍在 HTTPS 或 localhost 环境使用。

## 分阶段执行

### 阶段 1：纯 UI 重构

目标：把主页面改成原型效果，不改业务链路。

改造内容：

1. `index.html` 重排 DOM。
2. `src/styles.css` 实现原型视觉。
3. `src/main.ts` 适配新 DOM id。
4. 保留当前登录、BLE 扫描、命令发送、日志功能。

验收：

```text
npm run build
```

浏览器验收：

1. 锁屏鉴权正常。
2. 云端登录入口可用。
3. BLE 扫描入口可用。
4. 6 个命令按钮启用条件与现在一致。
5. 调试功能仍可展开使用。

### 阶段 2：命令反馈与误触保护

目标：让控车体验像产品，不像调试页。

改造内容：

1. 增加命令执行状态条。
2. 危险动作增加长按或确认。
3. 命令发送期间禁用重复点击。
4. 云控和 BLE 反馈统一展示。

验收：

1. 点击普通命令有 sending 状态。
2. 成功/失败能恢复按钮。
3. 设防/断电不会误触直接执行。

### 阶段 3：连接面板和调试抽屉

目标：把工程能力保留，但不干扰主控体验。

改造内容：

1. 云端登录收进连接面板。
2. BLE 型号选择、快连、全频扫描、诊断收进连接面板。
3. Hex 发送、QGJ 授权、状态帧、防盗帧、日志收进调试抽屉。

验收：

1. 首屏不再被登录表单和日志占据。
2. 工程功能仍可完整访问。
3. 日志复制/清空仍可用。

### 阶段 4：PWA 与缓存

目标：优化移动端安装和弱网体验。

改造内容：

1. 添加 manifest。
2. 添加图标。
3. 添加静态资源缓存。
4. 添加更新提示。

验收：

1. Chrome 移动端可安装。
2. 刷新后静态资源命中缓存。
3. 云控 API 不被 service worker 错误缓存。

## 风险控制

主要风险：

1. DOM id 改动导致 `src/main.ts` 事件绑定失效。
2. 云控和 BLE 控制路径被 UI 重构混淆。
3. 危险动作保护影响原有快速控车习惯。
4. PWA 缓存误伤 API 或旧版本脚本。

控制方式：

1. 阶段 1 只改 UI 和 DOM 绑定，不改业务函数。
2. 保持 `sendCmd` 和 `sendCloudCmd` 的调用条件不变。
3. 危险动作保护放在阶段 2，先让用户确认交互。
4. PWA 放到阶段 4，单独验证。

## 推荐执行顺序

推荐先执行阶段 1 和阶段 2。

原因：

1. 阶段 1 能最快看到真实前端变化。
2. 阶段 2 解决控车产品感和误触问题。
3. 阶段 3 是整理工程能力，可以随后做。
4. 阶段 4 涉及缓存策略，应该最后做。

## 预期结果

完成阶段 1 和阶段 2 后，当前应用会从“调试面板”变成“移动端控车界面”：

1. 首屏聚焦车况和控车。
2. 连接状态更清晰。
3. 控制按钮更适合手机触控。
4. 命令执行有明确反馈。
5. 调试能力保留但不干扰普通使用。
6. 架构仍保持轻量，适合继续迭代。
