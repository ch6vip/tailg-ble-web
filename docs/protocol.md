# 台铃电动车 BLE 通信协议

基于「台铃智能 v3.5.6」APK 逆向分析。

## GATT 服务

| 角色 | UUID |
|------|------|
| Service | `0000fee5-0000-1000-8000-00805f9b34fb` |
| Write | `0000feb5-0000-1000-8000-00805f9b34fb` |
| Notify/Indicate | `0000feb6-0000-1000-8000-00805f9b34fb` |
| Hot Data (可选) | `0000feb1-0000-1000-8000-00805f9b34fb` |

## 加密

- 算法: AES-128-ECB, NoPadding
- 所有收发数据均为 16 字节 AES 加密块
- 密钥按车辆型号不同:

| 型号 | AES Key (Hex) |
|------|---------------|
| KKS (默认) | `3A60432A5C01211F291E0F4E0C132825` |
| BB (保镖) | `1AF78CD35BE92F4CA06DB89EC2D7EF01` |
| AX (安芯) | `1AF78CD35BE92F4CA06DB89E7C4B1E6A` |
| JD (极大) | `1AF78CD35BE92F4CA06DB89E5F3D2A8C` |
| HJ (宏基) | `1AF78CD35BE92F4CA06DB89E9E6C4B1A` |
| JW/C39 | `1AF78CD35BE92F4CA06DB89E6F8B39A5` |
| XL (西联) | `1AF78CD35BE92F4CA06DB89E1E6C8A9A` |
| YY (亿源) | `1AF78CD35BE92F4CA06DB89E2A8C3F5D` |

## 连接流程

```
1. BLE Scan (filter: service UUID 0000fee5 或设备名 TL_*/TAILG_*)
2. Connect GATT
3. Discover Service 0000fee5
4. Get Write Char (feb5) + Notify Char (feb6)
5. Enable Notifications on feb6
6. 等待 2 秒
7. 发送 Token 请求
8. 收到 Token 响应 → 连接认证完成
```

## Token 握手

### 请求
- 明文 (固定): `780000002D1A683D48271A18316E471A`
- 加密后写入 feb5

### 响应
- 从 feb6 收到 16 字节
- AES 解密后检查前缀 `78000000`
- Token = 解密后 hex[8:16] (4 字节)

## 指令格式

所有指令加密前为 16 字节 (32 hex chars)。

### 标准指令
```
7803C2 + CMD(1B) + 00 + 11111111111111(7B padding) + TOKEN(4B)
```

### 带参指令
```
7803C2 + CMD(1B) + PARAM(1B) + 11111111111111(7B padding) + TOKEN(4B)
```

### 三参数指令
```
7805C2 + CMD(1B) + P1(1B) + P2(1B) + P3(1B) + 1111111111(5B padding) + TOKEN(4B)
```

## 指令码

| 码 | 功能 | 说明 |
|----|------|------|
| 01 | 设防 | 锁车，启动防盗 |
| 02 | 解防 | 解锁 |
| 05 | 开坐垫 | 电动开启座垫锁 |
| 06 | 远程上电 | 启动电源 |
| 07 | 远程断电 | 关闭电源 |
| 08 | 寻车 | 鸣笛闪灯 |
| 09 | 车辆设置 | 配置参数 |
| 0D | 读整车状态 | 查询当前状态 |
| 0E | 读防盗状态 | 查询防盗信息 |
| 11 | 绑车 | 绑定车辆 |
| 14 | 解绑 | 解除绑定 |
| 15 | 更新密钥 | 更新 AES 后缀 |

## 响应解析

AES 解密后的 hex string:

### Token 响应
- 前缀: `78000000`
- Token: hex[8:16]

### 指令响应
- 控制码: hex[6:10]
  - [6:8] = 命令类型
  - [8:10] = 状态码
- 状态码 `FF` = 超时/通信失败

### 车辆状态响应 (命令类型 = 0C)
- 状态字节 hex[8:10]:
  - `01` = 已设防 (ACC off)
  - `02` = 已解防 (ACC off)
  - `03` = 已解防 (ACC on, 行驶中)
  - `04` = 已解防 (ACC on)
  - `FF` = 通信错误

### 电压数据
- 前缀: `780EB310`
- 电压 = (byte[4] << 8 | byte[5]) / 100.0 (单位: V)

## 设备名前缀

### 绑定模式 (配对中)
`TAILG_BEUOZB`, `TAILG_AAIFDX`, `TAILG_JIFSAD`, `TAILG_HGSAIJ`, `TAILG_JW`, `TAILG_JLFBXW`, `Hi-TAILING`, `Q_BASH`

### 正常模式 (已绑定)
`TL_BEUOZB`, `TL_AAIFDX`, `TL_JIFSAD`, `TL_HGSAIJ`, `TL_JW`, `TL_JLFBXW`, `TL_GPS`
