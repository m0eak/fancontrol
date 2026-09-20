# Fancontrol
Openwrt简易通用风扇控制，最早是给GL-AXT1800使用，原理是读取系统温度，然后根据不同温度无级别调节风扇速度。

## 安装步骤
###  Add this repo as an OpenWrt feed

1. Add new feed:
    ```bash
    echo "src-git fancontrol https://github.com/m0eak/fancontrol.git" >> "feeds.conf"
    ```
2. Pull upstream commits:
    ```bash
    ./scripts/feeds update fancontrol && ./scripts/feeds install -a -f -p fancontrol
    ```
- Remove
    ```bash
    sed -i "/fancontrol/d" "feeds.conf"
    ./scripts/feeds clean && ./scripts/feeds update -a && ./scripts/feeds install -a
    ```

## 预编译包

推送到 `main` 会由 GitHub Actions 自动编译并发布到 Releases：

- `fancontrol`（守护进程）是编译出来的二进制，**只适用于 `qualcommax/ipq60xx`**。
  其他平台请按上面的 feed 方式自行编译。
- `luci-app-fancontrol` 标记为 `PKGARCH:=all`，`luci-i18n-fancontrol-*` 同样只含翻译数据，
  两者都不绑架构。

## 功能特性
- **线性调速**：根据设定的温度区间，自动线性调节风扇转速。
- **回差控制**：防止风扇在临界温度点频繁启停，延长风扇寿命。
- **实时监控**：界面顶部是一条温度带，标出停机区、回滞区、线性区与满速区，并标出当前温度落在哪里；
  旁边显示 procd 里守护进程的真实运行状态（区分「未启用」与「已启用但没跑」）。
- **高度可配**：所有关键路径和阈值均可在 LuCI 界面中轻松配置。

## 配置说明
所有选项均可在 `服务 -> 风扇控制` 页面进行设置，分为「设备」与「调速曲线」两组。

| 选项 | 默认值 | 说明 |
|---|---|---|
| `enabled` | `0` | 是否启用服务。 |
| `debug` | `0` | 设为 `1` 时守护进程每次轮询向 syslog 写一条调试记录，用于排查问题。 |
| `thermal_file` | `/sys/devices/virtual/thermal/thermal_zone0/temp` | 温度传感器的虚拟文件路径。 |
| `fan_file` | `/sys/devices/virtual/thermal/cooling_device0/cur_state` | 风扇转速控制的虚拟文件路径。 |
| `start_speed` | `35` | 风扇启动时的最低转速等级。 |
| `max_speed` | `255` | 风扇的最高转速等级。 |
| `start_temp` | `45` | 启动温度 (°C)，当温度达到此值时，风扇开始运转。 |
| `max_temp` | `85` | 最高温度 (°C)，当温度达到此值时，风扇将达到最高转速。 |
| `hysteresis_temp` | `5` | 回差温度 (°C)，风扇启动后，需要温度降至 `(启动温度 - 回差温度)` 以下才会停止。 |
| `temp_div` | `1000` | 温度值的分母，用于将原始温度值转换为摄氏度 (例如，如果原始值是 `45000`，除以 `1000` 后得到 `45`°C)。 |

## 调试

把 `debug` 设为 `1`（或在 LuCI 页面勾选「调试日志」）后，守护进程每次轮询都会把温度、状态与
目标转速写入 syslog，用 `logread` 查看。该选项默认关闭：它每 5 秒产生一条记录，长期开启会刷日志。

改完该选项需要重载服务才会生效（在 LuCI 保存会自动触发；手改 `/etc/config/fancontrol` 时需
手动执行 `/etc/init.d/fancontrol reload`）。

## 状态面板的读取范围

状态面板通过 rpcd 读取 `thermal_file` 与 `fan_file`，而 rpcd 的白名单只覆盖这四种路径：

- `/sys/class/thermal/thermal_zone*/temp`
- `/sys/class/thermal/cooling_device*/cur_state`
- `/sys/devices/virtual/thermal/thermal_zone*/temp`
- `/sys/devices/virtual/thermal/cooling_device*/cur_state`

把这两个选项指向白名单以外的路径时，守护进程本身仍能正常工作（它以 root 直接读写 sysfs），
但状态面板会显示 `Read failed`，鼠标悬停提示会指向本应用的 ACL 白名单。

面板还会调用 ubus 的 `service.list` 查询 `fancontrol` 实例的真实运行状态；这项权限同样是只读的，
用于区分「已启用但进程未运行」与「正常工作中」。

## 预览
![图片](./images/1.png)
