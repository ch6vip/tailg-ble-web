# QGJ / Q_BASH 协议研究报告

针对 Q_BASH（QGJ）系列设备的协议分析，源码级验证版本。与标准 fee5/AES 协议[`protocol.md`](protocol.md)互补。

## 概述

Q_BASH 设备**不使用** fee5/AES 协议，而是使用基于 kuyi SDK 的多通道协议：

- **kuyi 框架认证 + 控车通道**（feb1/feb2）— 登录、锁/解、上下电、寻车、开坐垫全部走这里
- **ECU 直接通信通道**（fcc1/fbb1）— 仅用于 ECU 设置（NFC、LED、传感器等）
- **次要通道**（fe02/fe03）— 用途未明

> 历史误区：源码 `TLinkBleManager.java:2000-2046` 里 `writeData("85034A2000123456789ABCDE")` 这套 TLink 字符串属于**非 QGJ 的标准 TailgBleManager 路径**，不要套用到 QGJ。

## GATT 结构（实测 Q_BASH_E4BC6F54A56D）

```
0x180a  Device Information (8 read characteristics: 2a23, 2a24, 2a26, 2a27, 2a28, 2a29, 2a2a, 2a50)
0x1800  Generic Access (2a00, 2a01)
0x1801  Generic Attribute (2a05 indicate, 2b29 r/w, 2b2a r)

0xfeb0  ★ kuyi 认证 + 控车通道
        feb1 [Write, WriteNoResp]   - 写认证/控车帧
        feb2 [Indicate]              - 接收响应
        feb3 [Read]
        feb4 [Read]

0xfcc0  ★ ECU 设置通道（仅 ECU 功能位，不接控车）
        fcc1 [Read, Write, Indicate]

0xfe01  次要通道
        fe02 [Write, WriteNoResp]
        fe03 [Notify]

0x2600  OTA 通道
        7001 [Read, WriteNoResp]
        7100 [Write, Indicate]
        7102 [Read]
```

## kuyi V2 帧格式

写入 feb1 / 读自 feb2 的统一帧：

```
[0xA7] [flags] [length BE16] [cmdID BE16] [payload...]
```

- 字节 0：固定 `0xA7` = kuyi V2 帧头
- 字节 1：flags（**高 nibble** 携带状态码，0 = 成功，非 0 = 错误码）
- 字节 2-3：长度（BE16）= cmdID(2) + payload 字节数
- 字节 4-5：命令 ID（BE16）
- 字节 6+：负载

编码器位置：`com/kuyi/h/d.java:10-24`，每个具体命令的 cmdID 由其 Command 子类构造器决定（`super(cmdID, ...)`）。

## 登录（cmdID 0x1001 = ECU_LOGIN）

源码：`com/kuyi/h/m0.java` → `super(4097, 0, CommonResult.class)` → cmdID = `0x1001`

### 请求

写入 feb1：

```
A7 00 00 0A 10 01 [pwd_u32_BE] [uid_u32_BE]
```

默认 pwd=0, uid=0 即可登录任意未配置过密码的 Q_BASH：

```
A7 00 00 0A 10 01 00 00 00 00 00 00 00 00
```

### 响应

feb2 返回：

```
A7 00 00 03 10 01 01
```

- 字节 1 高 nibble = 0 → 登录成功
- payload `01` = 已认证

**8 秒超时**：登录后若无后续流量，设备自动断开。登录前发任何指令到 fcc1 都返回 `21000000`（固件级"未认证"）。

## 控车指令（cmdID 0x1002 = ECU_SET_STATUS）

**源码级 confirmed** —— 整条调用链：

1. 业务侧入口：`tLinkBleManagerQgj.connectionViewModel.setBikeBasicStatus(NomalCommand.X)` （`ControlFragment.java:5333` 等 20+ 处）
2. 路由到 kuyi：`com/kuyi/h/y0.java:18` → `put(Tag.ECU_SET_STATUS, new s0())`
3. 编码器：`com/kuyi/h/s0.java:11` → `super(4098, 0, CommonResult.class)` → cmdID = **0x1002**
4. payload：`s0.java:16` → `MutableData.opCode((NomalCommand)obj.opCode)` —— **单字节 opCode**
5. opCode 字节值：`NomalCommand.smali` 构造器 `<init>(I I String)V` 的第二个 int 参数

### 帧表

写入 feb1，等 feb2 同 cmdID 回执：

| Web cmd | NomalCommand | opCode | 完整帧 |
|---------|--------------|--------|--------|
| `01` 设防 | `DeviceSetSafe` | `0x02` | `A7 00 00 03 10 02 02` |
| `02` 解防 | `DeviceOutSafe` | `0x01` | `A7 00 00 03 10 02 01` |
| `05` 开坐垫 | `DeviceOpenSeat` | `0x07` | `A7 00 00 03 10 02 07` |
| `06` 上电 | `DeviceOpenEleDoor` | `0x03` | `A7 00 00 03 10 02 03` |
| `07` 断电 | `DeviceCloseEleDoor` | `0x04` | `A7 00 00 03 10 02 04` |
| `08` 寻车 | `DeviceFindBike` | `0x08` | `A7 00 00 03 10 02 08` |

### 响应判定

feb2 收到 `A7 [flags] 00 03 10 02 [result]`：

- 字节 1 高 nibble = 0 → 成功
- 字节 1 高 nibble ≠ 0 → 错误（详见 `com/kuyi/h/d.java:33-53` 的状态映射）
- payload 第一字节由 `CommonResult` 反序列化，通常 `00` = OK

### NomalCommand 完整 opCode 表（参考）

`NomalCommand.smali` 14 个枚举值，常用前 10 个：

| Enum | opCode |
|------|--------|
| DeviceOutSafe | 0x01 |
| DeviceSetSafe | 0x02 |
| DeviceOpenEleDoor | 0x03 |
| DeviceCloseEleDoor | 0x04 |
| DeviceSetSafeNoSound | 0x05 |
| DeviceSetSafeSound | 0x06 |
| DeviceOpenSeat | 0x07 |
| DeviceFindBike | 0x08 |
| DeadLockOn | 0x09 |
| DeadLockOff | 0x0A |

后 4 个 `DeviceInduction*` / `DeviceXxxTirePressureAlarm` 已标记 `@Deprecated`。

## fcc1 / fbb1 ECU 直接通信（仅 ECU 设置）

`TLinkBleManagerQgj.java:500-526` 的 `writeDataFcc1` / `writeDataFbb1` **不参与控车**，仅用于功能位设置：

| 行 | 用途 | 模板 |
|----|------|------|
| 821 | `writeEcu()` (V2 → fcc1) | `00070002 [S1] [S2] [S3]` |
| 905 | `writeEcu()` (V1 → fbb1) | `D0018E0A00FFFFFF00 [V1] [S1] [S2] [S3] [V2]` |
| 917 | `isCheck()` 在线探测（fbb1） | `D0018E0AFF00000001AA00000000` |
| 926 | `checkEcuLimit()` (fcc1) | `020A0002D001028B005E` |
| 944 | `limitEcu()` (fcc1) | `02000001D001048B0206FF67` |

往 fcc1 写控车字符串（如 `8503C20D...` 或 `A700000320010000`）会返回 `21000000`。

## 实测时序记录（历史，含已知错误尝试）

```
22:19:59  → [feb1] A700000A10010000000000000000   (登录请求)
22:19:59  ← [feb2] A7000003100101                  (登录成功)
22:19:59  → [fcc1] 8503C20D001111111111111100000000  (尝试 TLink fee5 格式 — 错误路径)
22:19:59  ← [fcc1] 21000000                        (拒绝)
22:20:00  → [fcc1] A700000320010000                 (尝试 kuyi V2 cmdID 0x2001 — 错误路径)
22:20:00  ← [fcc1] 21000000                        (拒绝)
22:20:00  → [fcc1] D0018E0AFF00000001AA            (尝试 ECU 心跳)
22:20:00  ← [fcc1] 40000000                        (格式错误)
22:20:08  设备断开                                  (8 秒超时)
```

> 正确路径应为 `→ [feb1] A700000310020X`（X = NomalCommand opCode）。

## 设备名映射

| 设备名前缀 | 型号 | modelType |
|-----------|------|-----------|
| `Hi-TAILING` | QGJ 原始款 | 8 |
| `Q_BASH` | QGJ 鸿蒙版 | 8 |
| `QBIKE_2002` / `QDemo_2002` / `TL_2002` | QGJ Sound | 8 |
| `QDemo_2012` / `TL_2012` / `TL_2022` | QGJ V3 | 283 |

绑定模式（未配对）使用 `TAILG_*` / `Hi-TAILING` / `Q_BASH` / `QDemo_*`；正常模式（已配对）使用 `TL_*` / `Q_BASH`。

## Web 客户端实现

| 模块 | 职责 |
|------|------|
| `src/ble/qgj-protocol.ts` | `buildQgjLoginFrame()`、`buildQgjControlFrame()`（cmdID 0x1002 + opCode）、`parseQgjResponse()` |
| `src/ble/connection.ts` | fcc0 服务连上后自动加载 feb0、订阅 feb2、解析 0x1001 成功即认证 |
| `src/commands.ts` | `sendBleCmd` 按 `conn.serviceType==='fcc0'` 分发到 `sendQgjCmd`，写 feb1 |

## 相关源码位置

| 文件 | 用途 |
|------|------|
| `com/kuyi/h/d.java:10-24` | kuyi V2 帧编码器（外层封装） |
| `com/kuyi/h/m0.java:10-19` | ECU_LOGIN 编码器，cmdID 0x1001 |
| `com/kuyi/h/s0.java:9-18` | ECU_SET_STATUS 编码器，cmdID 0x1002，单字节 payload |
| `com/kuyi/h/y0.java` | kuyi V2 命令注册表（Tag → 编码器） |
| `com/kuyi/blesdk/common/Command.java:244-363` | Tag 枚举与 Command 抽象类 |
| `com/comtime/enummanager/NomalCommand.java` | 控车动作枚举（jadx 漏了 opCode 字节） |
| `apktool/smali_classes8/com/comtime/enummanager/NomalCommand.smali` | opCode 字节真值来源 |
| `com/tailg/run/intelligence/tlink_ble/TLinkBleManagerQgj.java` | QGJ 管理器（仅 ECU 设置，不含控车） |
| `com/tailg/run/intelligence/model/home/fragment/ControlFragment.java:5333` | 业务侧调用 `setBikeBasicStatus` 示例 |
