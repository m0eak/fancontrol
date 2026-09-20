# 测试

```
./tests/run.sh
```

依赖：`cc`、`node`、`python3`、`msgfmt`（gettext 包）。

## 这里测什么

| 检查 | 覆盖的内容 |
|---|---|
| `tests/c/fancontrol_test.c` | 守护进程的取值、解析与写路径。**必须用 ASan 构建**，否则越界那几项失去意义 |
| `tests/js/fancontrol_view_test.js` | view 里的纯函数：温度→刻度映射、区间边界、越界夹取、配置非法（max ≤ start）时不出 NaN |
| LuCI view 语法 | `fancontrol.js` 能否被解析。包进 `new Function` 是为了复现 LuCI 的包装语义（view 顶层有 `return`） |
| ACL / menu JSON | `luci-app-fancontrol` 下所有 JSON 文件是否合法 |
| 翻译覆盖率 | `fancontrol.js` 里每个 `_()` 字符串在 `zh_Hans` 目录里都有译文，且目录本身通过 `msgfmt --check` |

## 为什么守护进程的测试要 `#include` 源码

`read_file` / `write_file` / `parse_int` 都是 `static`，而它们恰好是历次缺陷集中出现的地方。把源码 include 进来（同时把 `main` 改名）是让测试能直接调用它们的唯一办法。测试里带 ASan 的用例对应真实发生过的越界：

- `read_file` 以文件长度作为拷贝长度，写爆 8 字节栈缓冲（`WRITE of size 120`）
- `set_fanspeed` 用 `sprintf` 往 `char[8]` 里写 8 位以上档位（`WRITE of size 12`）

## 不在覆盖范围内的

守护进程的主循环（`main`）没有测试：它是个 `while (1)` + `sleep(5)`，要测就得把循环拆出来。涉及的逻辑（回滞、写去重）目前靠代码审查与 `get_fanspeed` / `calculate_speed` 的单测间接保证。
