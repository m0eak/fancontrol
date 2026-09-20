/*
 * 用 Node 断言 LuCI view 里的纯函数。
 *
 * 为什么从源码里抽函数而不是直接 require：这个 view 是 LuCI 模块，
 * 跑在 LuCI 自己的加载器里、结尾是一个顶层 return，Node 没法直接加载它。
 * 抽出来的这三个是唯一带算术的部分 —— 把温度映射到刻度上，越界夹取与
 * 配置非法（max ≤ start、回差比启动温度还大）都容易写错。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(
    __dirname, '../../luci-app-fancontrol/htdocs/luci-static/resources/view/fancontrol.js'), 'utf8');

// 常量在 view 里是模块级 var，抽函数时要一并带过来
const parts = ['var PAD_LOW = 10, PAD_HIGH = 5;'];

for (const name of ['int_or', 'band_geometry', 'band_zone']) {
    const found = source.match(new RegExp('^function ' + name + '\\([\\s\\S]*?\\n\\}', 'm'));

    if (!found) {
        console.error('FAIL 无法从 view 里抽出 ' + name + ' —— 函数被改名或改形态了？');
        process.exit(1);
    }

    parts.push(found[0]);
}

const helpers = new Function(parts.join('\n\n') + '\nreturn { int_or, band_geometry, band_zone };')();

let failed = 0;

function eq(what, got, want) {
    const ok = (typeof got === 'number' && typeof want === 'number')
        ? Math.abs(got - want) < 0.01
        : got === want;

    console.log((ok ? 'ok    ' : 'FAIL  ') + what + '  (got ' + got + ', want ' + want + ')');
    if (!ok)
        failed++;
}

const cfg = { start_temp: 45, max_temp: 85, hysteresis_temp: 5 };
const geo = helpers.band_geometry(cfg);

// 默认配置：停机线 40，刻度窗口 [30, 90]
eq('停机线 = 启动温度 - 回差温度', geo.stop, 40);
eq('刻度左端 = 停机线 - 10', geo.lo, 30);
eq('刻度右端 = 最高温度 + 5', geo.hi, 90);
eq('左端映射到 0%', geo.pct(geo.lo), 0);
eq('右端映射到 100%', geo.pct(geo.hi), 100);
eq('停机线位置', geo.pct(geo.stop), 16.67);
eq('启动线位置', geo.pct(45), 25);
eq('满速线位置', geo.pct(85), 91.67);
eq('低于刻度窗口被夹到 0%', geo.pct(-100), 0);
eq('高于刻度窗口被夹到 100%', geo.pct(1000), 100);

// 区间判定：正好等于停机线不算停（守护进程用严格小于）
eq('35 度 → 停机区', helpers.band_zone(cfg, 35), 'off');
eq('40 度 → 回滞区', helpers.band_zone(cfg, 40), 'hold');
eq('44.9 度 → 回滞区', helpers.band_zone(cfg, 44.9), 'hold');
eq('45 度 → 线性区', helpers.band_zone(cfg, 45), 'linear');
eq('85 度 → 满速区', helpers.band_zone(cfg, 85), 'max');

// 配置非法时不能除零、不能出 NaN —— 面板不该被一份坏配置搞崩
[
    ['max 等于 start', { start_temp: 45, max_temp: 45, hysteresis_temp: 5 }],
    ['max 小于 start', { start_temp: 45, max_temp: 40, hysteresis_temp: 5 }],
    ['回差大于启动温度', { start_temp: 45, max_temp: 85, hysteresis_temp: 100 }]
].forEach(function (c) {
    const p = helpers.band_geometry(c[1]).pct(50);
    eq('非法配置（' + c[0] + '）仍给出有限值', isFinite(p) && !isNaN(p), true);
});

eq('回差大于启动温度时左端夹到 0', helpers.band_geometry(
    { start_temp: 45, max_temp: 85, hysteresis_temp: 100 }).lo, 0);

// uci 拿回来的都是字符串
eq('int_or 对非数字回退', helpers.int_or('abc', 7), 7);
eq('int_or 对空串回退', helpers.int_or('', 7), 7);
eq('int_or 截到整数部分', helpers.int_or('1000.9', 7), 1000);
eq('int_or 正常取值', helpers.int_or('1000', 7), 1000);

console.log('\n' + (failed ? 'FAIL: ' + failed + ' 项不符' : 'PASS: 全部通过'));
process.exit(failed ? 1 : 0);
