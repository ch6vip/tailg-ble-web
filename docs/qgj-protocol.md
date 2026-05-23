# QGJ / Q_BASH 协议研究报告

针对 Q_BASH（QGJ）系列设备的协议分析，实测验证版本。与标准 fee5/AES 协议[`protocol.md`](protocol.md)互补。

## 概述

Q_BASH 设备**不使用** fee5/AES 协议，而是使用一套基于 kuyi SDK 的多通道协议：

- **kuyi 框架认证层**（feb1/feb2）— 必须先登录
- **ECU 直接通信层**（fcc1/fbb1）— 仅用于 ECU 设置
- **未知次要通道**（fe02/fe03）

控车动作（锁/解/上电/断电/寻车/开坐垫）**全部走 feb1**，经 kuyi V2 框架封装后发送，**不直接出现在 fcc1**。

## GATT 结构（实测 Q_BASH_E4BC6F54A56D）

```
0x180a  Device Information (8 read characteristics: 2a23, 2a24, 2a26, 2a27, 2a28, 2a29, 2a2a, 2a50)

0x1800  Generic Access (2a00, 2a01)

0x1801  Generic Attribute (2a05 indicate, 2b29 r/w, 2b2a r)

0xfeb0  ★ kuyi 认证通道
        feb1 [Write, WriteNoResp]   - 写认证/控车帧
        feb2 [Indicate]              - 接收响应
        feb3 [Read]
        feb4 [Read]

0xfcc0  ★ ECU 直接通道
        fcc1 [Read, Write, Indicate] - 仅 ECU 设置（不接受控车指令）

0xfe01  次要通道
        fe02 [Write, WriteNoResp]
        fe03 [Notify]

0x2600  OTA 通道
        7001 [Read, WriteNoResp]
        7100 [Write, Indicate]
        7102 [Read]
```

## kuyi V2 帧格式

写入 feb1 / 读自 feb2 的数据帧：

```
[0xA7] [flags] [length BE16] [cmdID BE16] [payload...]
```

- 字节 0：固定 `0xA7` = kuyi V2 帧头
- 字节 1：flags（高 nibble 为状态码，0 = 成功）
- 字节 2-3：长度（BE16），= cmdID(2) + payload 字节数
- 字节 4-5：命令 ID（BE16）
- 字节 6+：负载

> 字节 1 的低 nibble 在解码时被验证为 0；高 nibble 携带错误/状态码。

## 登录流程（实测可用）

### 请求

写入 feb1：

```
A7 00 00 0A 10 01 [pwd_u32_BE] [uid_u32_BE]
```

- cmdID = `0x1001` (ECU_LOGIN)
- 默认密码 `pwd = 0`、uid = 0

```
A7 00 00 0A 10 01 00 00 00 00 00 00 00 00
```

### 响应

feb2 收到：

```
A7 00 00 03 10 01 01
```

- 状态 nibble = 0 → 登录成功
- payload `01` = 已认证

> 实测：默认密码 0/0 即可登录任意未配置过密码的 Q_BASH 设备。

### 重要约束

- **8 秒超时**：登录后若无后续流量，设备自动断开
- 登录前发任何指令到 fcc1 都返回 `21000000`（固件级"未认证"错误）

## 控车指令（位置）

实测发现：**控车动作不在 fcc1**，而是走 kuyi 框架经 feb1 发送。

源码位置：`TLinkBleManager.java:2000-2046`

| 动作 | TLink 内部指令 |
|------|---------------|
| 设防（锁车） | `85034A2000` |
| 解防（解锁） | `85034A2100` |
| 上电（开电门） | `85034A2200` |
| 断电（关电门） | `85034A2300` |
| 开坐垫 | `85034A2400` |
| 寻车（鸣笛） | `85034A2500` |

> 这些指令通过 `TLinkBleManager.writeData()` → kuyi `SingleConnectionViewModel` → 框架封装后写入 feb1。
>
> **未确认**：外层 kuyi cmdID（推测 `0x2000`-范围）以及框架是否在 payload 上叠加 AES 加密。

## fcc1 ECU 直接通信

`TLinkBleManagerQgj.java` 中 fcc1 只用于 ECU 功能位设置：

| 行 | 用途 | 模板 |
|----|------|------|
| 821 | `writeEcu()` (V2) | `00070002 [S1] [S2] [S3]` |
| 905 | `writeEcu()` (V1，写到 fbb1) | `D0018E0A00FFFF00 [V1] [S1] [S2] [S3] [V2]` |
| 917 | `isCheck()` 在线探测（fbb1） | `D0018E0AFF00000001AA00000000` |
| 926 | `checkEcuLimit()` (fcc1) | `020A0002D001028B005E` |
| 944 | `limitEcu()` (fcc1) | `02000001D001048B0206FF67` |

**不存在 CRC**，所有"看似校验"的字节都是固定常量。

实测发送 `D0018E0AFF00000001AA` 到 fcc1 收到响应 `40000000`（疑似格式错误，因为该模板属于 fbb1，不属于 fcc1）。

## 实测时序记录

```
22:19:59  → [feb1] A700000A10010000000000000000   (登录请求)
22:19:59  ← [feb2] A7000003100101                  (登录成功)
22:19:59  → [fcc1] 8503C20D001111111111111100000000  (尝试 TLink fee5 格式)
22:19:59  ← [fcc1] 21000000                        (拒绝)
22:20:00  → [fcc1] A700000320010000                 (尝试 kuyi V2 格式)
22:20:00  ← [fcc1] 21000000                        (拒绝)
22:20:00  → [fcc1] D0018E0AFF00000001AA            (尝试 ECU 心跳)
22:20:00  ← [fcc1] 40000000                        (格式错误，但被识别)
22:20:08  设备断开                                  (8 秒超时)
```

## 设备名映射

| 设备名前缀 | 型号 | modelType |
|-----------|------|-----------|
| `Hi-TAILING` | QGJ 原始款 | 8 |
| `Q_BASH` | QGJ 鸿蒙版 | 8 |
| `QBIKE_2002` / `QDemo_2002` / `TL_2002` | QGJ Sound | 8 |
| `QDemo_2012` / `TL_2012` / `TL_2022` | QGJ V3 | 283 |

绑定模式（未配对）使用 `TAILG_*` / `Hi-TAILING` / `Q_BASH` / `QDemo_*` 前缀；
正常模式（已配对）使用 `TL_*` / `Q_BASH` 前缀。

## 待研究项

1. **kuyi 外层 cmdID**：feb1 上发送 `85034A20...` 时的封装格式
2. **kuyi 框架是否加密 payload**：`TailgBleConfig.AES_KEY_QGJ` 是否参与
3. **登录响应解码**：response payload `01` 是否携带后续会话密钥/序号
4. **心跳保活**：8 秒超时如何延长（疑似需要定期发某种 ping）

## 相关源码位置

- `com\tailg\run\intelligence\tlink_ble\TailgBleConfig.java` — 常量定义、AES 密钥表
- `com\tailg\run\intelligence\tlink_ble\TLinkBleManagerQgj.java` — QGJ 管理器
- `com\tailg\run\intelligence\tlink_ble\TLinkBleManager.java:2000-2046` — 控车指令
- `com\kuyi\h\d.java` — kuyi V2 帧编码器
- `com\kuyi\h\m0.java` — ECU_LOGIN 编码器
- `com\kuyi\h\y0.java` — kuyi V2 命令注册表
- `com\kuyi\blesdk\profile\a.java` — Command 编码与发送主循环
- `com\kuyi\blesdk\model\SingleConnectionViewModel` — 高层连接管理
