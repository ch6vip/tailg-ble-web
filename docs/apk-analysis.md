# 台铃智能 v3.5.6 — APK 分析报告

## 基本信息

| 项目 | 值 |
|------|------|
| 包名 | `com.tailg.run.intelligence` |
| 版本 | 3.5.6 |
| DEX 数量 | 13 个 (classes.dex ~ classes13.dex) |
| Java 类数 | ~38,286 |
| Activity 数 | 451 |
| Service 数 | 53 |
| 权限数 | 79 |
| Native SO | 50 个 (仅 arm64-v8a) |

## 应用定位

台铃电动车官方智能控制 App，核心功能：

- 蓝牙 BLE 控车（上锁/解锁/上电/断电/寻车/开坐垫）
- 车辆状态监控、历史轨迹
- 充电桩扫码充电与支付
- OTA 固件升级
- 智慧屏投屏（集成 SQ SDK / ThinkRide）
- 行车记录仪 WiFi 直连回放

## 关键入口

- **Application**: `TailgApplication` → 继承 `EsApp`
- **启动页**: `SplashActivity`
- **主页**: `HomeActivity`
- **登录**: `LoginOnActivity` → 手机验证码 / 微信 / 抖音第三方登录

## 网络层

- 框架: **Retrofit + RxJava2 + OkGo**
- 生产 API: `https://www.tailgdd.com/v8/` (新平台) / `https://www.tailgdd.com/v1/api/` (旧)
- 测试 API: `https://hwbustest.tailgvip.com/`
- OBS 资源: `https://tailg-cloud-resource-obs.obs.cn-east-3.myhuaweicloud.com:443/`
- MQTT: `ssl://www.tailgdd.com:6668` (C18) / `tcp://www.tailgdd.com:1883` (KKS)
- 认证: OAuth2 风格 (access_token / refresh_token / openid / client_id)
- 请求头: `Api-Version: 3.0.0`, `AUTH_TOKEN` 从 SharedPreferences 读取

## BLE 通信协议（标准 fee5）

- Service UUID: `0000fee5-0000-1000-8000-00805f9b34fb`
- Read UUID: `0000feb6-0000-1000-8000-00805f9b34fb`
- Write UUID: `0000feb5-0000-1000-8000-00805f9b34fb`
- 加密: **AES**，密钥硬编码前缀 `3A60432A5C01211F291E0F4E0C` + 动态后缀
- 指令格式: `78` 开头的 hex 帧，功能码包括:
  - `01` 设防 / `02` 解防
  - `05` 开坐垫 / `06` 上电 / `07` 断电
  - `08` 寻车 / `09` 车辆设置
  - `0D` 读整车状态 / `0E` 读防盗状态
  - `11` 绑车 / `14` 解绑 / `15` 更新密钥
- Token 握手: 固定明文 `780000002D1A683D48271A18316E471A` AES 加密后发送

## 集成的第三方 SDK

| SDK | 用途 |
|-----|------|
| 高德地图/导航 | 定位、导航、电子围栏 |
| 百度地图/导航/语音 | 导航、TTS |
| 极光推送 (JPush) | 消息推送 |
| 华为 HMS Push | 华为推送 |
| 小米 MiPush | 小米推送 |
| OPPO/Vivo Push | 厂商推送 |
| 微信 SDK | 登录/支付/分享 |
| 支付宝 SDK | 支付 |
| 抖音开放平台 | 登录/分享 (AppKey: `aw50i3803fhsqboj`) |
| 七鱼客服 (Unicorn) | 在线客服 |
| Bugly | 崩溃上报 |
| FFmpeg/FFmpegKit | 视频处理 |
| OpenCV | 图像处理 |
| Nordic DFU | BLE OTA |
| ML Kit (barhopper) | 条码扫描 |
| EasyConn | 车机互联/投屏 |
| SQ SDK (ThinkRide) | 智慧屏 |
| 喜马拉雅 | 音频内容 |

## 敏感点总结

1. **BLE AES 密钥部分硬编码** — 前 13 字节固定，后 3 字节动态
2. **OPPO client_secret 明文写在代码中** — `c6e557aa52d5...`
3. **MQTT 连接信息明文** — 含测试环境 IP
4. **AUTH_TOKEN 存 SharedPreferences** — 无额外加密
5. **核心控车逻辑在 Java 层** — 可直接 Hook 或 patch

## 多协议家族

APK 中存在三套并行的 BLE 协议管理器：

| 管理器 | 协议家族 | 适用车型 |
|--------|---------|---------|
| `TailgBleManager` | 标准 fee5/AES | 主流车型 (KKS/BB/AX/JD/HJ/JW/XL/YY) |
| `TLinkBleManager` | TLink (kuyi V2) | 新一代电控 |
| `TLinkBleManagerQgj` | QGJ (kuyi+ECU) | Q_BASH/QBIKE/QDemo |
