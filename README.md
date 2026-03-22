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

## 功能特性
- **线性调速**：根据设定的温度区间，自动线性调节风扇转速。
- **回差控制**：防止风扇在临界温度点频繁启停，延长风扇寿命。
- **实时监控**：LuCI 界面提供实时状态面板，自动刷新显示当前 CPU 温度和风扇等级。
- **高度可配**：所有关键路径和阈值均可在 LuCI 界面中轻松配置。

## 配置说明
所有选项均可在 `服务 -> 风扇控制` 页面进行设置。

| 选项 | 默认值 | 说明 |
|---|---|---|
| `thermal_file` | `/sys/devices/virtual/thermal/thermal_zone0/temp` | 温度传感器的虚拟文件路径。 |
| `fan_file` | `/sys/devices/virtual/thermal/cooling_device0/cur_state` | 风扇转速控制的虚拟文件路径。 |
| `start_speed` | `35` | 风扇启动时的最低转速等级。 |
| `max_speed` | `255` | 风扇的最高转速等级。 |
| `start_temp` | `45` | 启动温度 (°C)，当温度达到此值时，风扇开始运转。 |
| `max_temp` | `85` | 最高温度 (°C)，当温度达到此值时，风扇将达到最高转速。 |
| `hysteresis_temp` | `5` | 回差温度 (°C)，风扇启动后，需要温度降至 `(启动温度 - 回差温度)` 以下才会停止。 |
| `temp_div` | `1000` | 温度值的分母，用于将原始温度值转换为摄氏度 (例如，如果原始值是 `45000`，除以 `1000` 后得到 `45`°C)。 |

## 预览
![图片](./images/1.png)
