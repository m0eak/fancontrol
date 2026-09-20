'use strict';
'require view';
'require form';
'require uci';
'require rpc';
'require dom';

// RPC: 安全读文件
var callReadFile = rpc.declare({
    object: 'file',
    method: 'read',
    params: ['path'],
    expect: { data: '' }
});

// RPC: 查询 procd 里服务的真实运行状态。返回结构为
// { <服务名>: { instances: { <实例名>: { running, pid, ... } } } }，
// 其中 running 来自 procd 的 instance_dump()（procd/service/instance.c）
var callServiceList = rpc.declare({
    object: 'service',
    method: 'list',
    params: ['name'],
    expect: { '': {} }
});

// 温度带刻度窗口：[停机线 - 10, 最高温度 + 5]，让三个阈值都落在带子里
var PAD_LOW = 10, PAD_HIGH = 5;

function int_or(value, fallback) {
    var n = parseInt(value, 10);
    return isNaN(n) ? fallback : n;
}

// 纯几何：把温度映射到刻度上的百分比。区间宽度下限取 1，避免配置非法时除零。
function band_geometry(cfg) {
    var stop = cfg.start_temp - cfg.hysteresis_temp;
    var lo = Math.max(0, stop - PAD_LOW);
    var hi = Math.max(cfg.max_temp + PAD_HIGH, lo + 1);

    return {
        stop: stop,
        lo: lo,
        hi: hi,
        pct: function (t) {
            return Math.max(0, Math.min(100, (t - lo) / (hi - lo) * 100));
        }
    };
}

// 当前温度落在哪个区间。只描述「温度在哪」，不复制守护进程的启停状态机 ——
// 那属于守护进程，在界面里再实现一份迟早会跟它分叉。
function band_zone(cfg, temp) {
    var stop = cfg.start_temp - cfg.hysteresis_temp;

    if (temp >= cfg.max_temp) return 'max';
    if (temp >= cfg.start_temp) return 'linear';
    return temp < stop ? 'off' : 'hold';
}

function zone_label(zone) {
    return {
        off: _('Off zone'),
        hold: _('Hold zone'),
        linear: _('Linear zone'),
        max: _('Max zone')
    }[zone] || _('N/A');
}

// 布局与颜色。刻意不写死背景与文字颜色：这页活在主题里，唯一的强色彩是温度带
// 本身 —— 那是语义（冷 → 热），不是装饰。
var css = `
    .fc-panel + .fc-panel { margin-top: 16px; }

    .fc-readouts {
        display: grid;
        grid-template-columns: minmax(140px, auto) 1fr auto;
        gap: 16px 24px;
        align-items: end;
    }

    .fc-readout { display: flex; flex-direction: column; gap: 2px; min-width: 0; }

    .fc-readout-label {
        font-size: 11px;
        letter-spacing: 0.14em;
        opacity: 0.55;
    }

    /* 等宽 + tabular：读数每 5 秒跳一次，非等宽字体会左右抖动 */
    .fc-value {
        font-family: ui-monospace, "SF Mono", "JetBrains Mono", Consolas, monospace;
        font-variant-numeric: tabular-nums;
        font-size: 40px;
        line-height: 1.1;
        letter-spacing: -0.01em;
    }

    .fc-value small {
        font-size: 18px;
        opacity: 0.6;
        margin-left: 4px;
    }

    .fc-value-sm { font-size: 22px; }
    .fc-value-sm small { font-size: 14px; }

    /* 拿不到读数时这里放的是文字，不能沿用 40px 等宽数字的排版 */
    .fc-value-text {
        font-family: inherit;
        font-size: 18px;
        line-height: 1.5;
        letter-spacing: 0;
    }

    .fc-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        align-self: flex-start;
        padding: 3px 10px 3px 8px;
        border: 1px solid currentColor;
        border-radius: 999px;
        font-size: 13px;
        font-weight: 600;
    }

    .fc-badge::before {
        content: "";
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: currentColor;
    }

    .fc-badge.is-ok { color: #2f7d4f; }
    .fc-badge.is-warn { color: #b8860b; }
    .fc-badge.is-off { opacity: 0.55; }
    .fc-badge.is-err { color: #b3382a; }

    /* 温度带 —— 全页唯一的识别点 */
    .fc-band { margin-top: 20px; }

    .fc-band-label {
        font-size: 11px;
        letter-spacing: 0.14em;
        opacity: 0.55;
        margin-bottom: 10px;
    }

    .fc-track {
        position: relative;
        height: 14px;
        border-radius: 999px;
        background: linear-gradient(90deg,
            var(--fc-cold) 0 var(--p-stop),
            var(--fc-hold) var(--p-stop) var(--p-start),
            var(--fc-warm) var(--p-start),
            var(--fc-hot) var(--p-max),
            var(--fc-hot) var(--p-max) 100%);
        box-shadow: inset 0 0 0 1px rgba(127, 127, 127, 0.35);
    }

    .fc-band.is-unknown .fc-track { filter: saturate(0.2); opacity: 0.55; }

    .fc-marker {
        position: absolute;
        top: -6px;
        bottom: -6px;
        width: 3px;
        border-radius: 2px;
        background: currentColor;
        left: var(--p-now, 0%);
        box-shadow: 0 0 0 2px var(--fc-cold);
        transition: left 0.55s cubic-bezier(0.22, 0.61, 0.36, 1);
    }

    .fc-band.is-unknown .fc-marker { display: none; }

    .fc-ticks { position: relative; height: 34px; margin-top: 10px; }

    .fc-tick {
        position: absolute;
        left: var(--p, 0%);
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1px;
        white-space: nowrap;
        font-size: 12px;
        opacity: 0.75;
    }

    /* 贴边的刻度向内收，避免标签被容器裁掉 */
    .fc-tick.is-start { transform: translateX(0); align-items: flex-start; }
    .fc-tick.is-end { transform: translateX(-100%); align-items: flex-end; }

    .fc-tick b { font-weight: 600; }

    .fc-tick i {
        font-style: normal;
        font-family: ui-monospace, "SF Mono", "Consolas", monospace;
        font-variant-numeric: tabular-nums;
    }

    .fc-band-state { margin: 2px 0 0; font-size: 13px; opacity: 0.8; }
    .fc-band-state strong { opacity: 1; }

    @keyframes fc-flash {
        from { background: rgba(127, 127, 127, 0.22); }
        to { background: transparent; }
    }

    .fc-flash { animation: fc-flash 0.5s ease-out; border-radius: 6px; }

    @media (prefers-color-scheme: dark) {
        .fc-badge.is-ok { color: #4fb079; }
        .fc-badge.is-warn { color: #d8a63f; }
        .fc-badge.is-err { color: #e2684c; }
    }

    @media (prefers-reduced-motion: reduce) {
        .fc-marker { transition: none; }
        .fc-flash { animation: none; }
    }

    @media (max-width: 560px) {
        .fc-readouts { grid-template-columns: 1fr 1fr; }
        .fc-readout.is-primary { grid-column: 1 / -1; }
        .fc-value { font-size: 34px; }
    }
`;

return view.extend({
    pollingTimer: null,
    visibilityHandler: null,

    load: function () {
        return Promise.all([uci.load('fancontrol')]);
    },

    // 每轮都重新读一次配置：路径或除数改完保存后，面板不该继续拿旧值去读
    read_config: function () {
        var get = function (name) {
            return uci.get('fancontrol', 'settings', name);
        };

        return {
            thermal_file: get('thermal_file'),
            fan_file: get('fan_file'),
            // 必须用 parseInt：uci.get 返回字符串，"0" 在 JS 里是真值，会算出 Infinity °C
            temp_div: int_or(get('temp_div'), 1000) || 1000,
            start_temp: int_or(get('start_temp'), 45),
            max_temp: int_or(get('max_temp'), 85),
            hysteresis_temp: int_or(get('hysteresis_temp'), 5),
            max_speed: int_or(get('max_speed'), 255),
            enabled: get('enabled') == '1'
        };
    },

    flash: function (el) {
        if (!el)
            return;

        el.classList.remove('fc-flash');
        void el.offsetWidth;                    // 强制重排，让动画能重复触发
        el.classList.add('fc-flash');
    },

    // 只负责刻度：渐变分界点、刻度线位置、阈值数字。配置一变就要重画。
    render_band_scale: function (cfg) {
        var track = document.getElementById('fc_track');
        if (!track)
            return;

        var geo = band_geometry(cfg);

        track.style.setProperty('--p-stop', geo.pct(geo.stop) + '%');
        track.style.setProperty('--p-start', geo.pct(cfg.start_temp) + '%');
        track.style.setProperty('--p-max', geo.pct(cfg.max_temp) + '%');

        [['fc_tick_stop', geo.stop], ['fc_tick_start', cfg.start_temp],
         ['fc_tick_max', cfg.max_temp]].forEach(function (pair) {
            var el = document.getElementById(pair[0]);
            if (!el)
                return;

            var p = geo.pct(pair[1]);
            el.style.setProperty('--p', p + '%');
            el.classList.toggle('is-start', p < 12);
            el.classList.toggle('is-end', p > 88);
            el.querySelector('i').textContent = pair[1];
        });
    },

    // 只负责读数：游标位置、区间文案、整条带子的无障碍描述
    render_band_reading: function (cfg, temp, known) {
        var band = document.getElementById('fc_band');
        var marker = document.getElementById('fc_marker');
        var state = document.getElementById('fc_band_state');

        if (!band || !marker || !state)
            return;

        band.classList.toggle('is-unknown', !known);

        if (!known) {
            // 读不到温度时把原因写在带子下面，而不是只塞进 title
            // （触屏和键盘都拿不到 title）
            state.textContent = _('Check that the path exists and is allowed by the ACL.');
            band.setAttribute('aria-label', _('Temperature Band') + ': ' + _('Read failed'));
            return;
        }

        var geo = band_geometry(cfg);
        var zone = band_zone(cfg, temp);

        marker.style.setProperty('--p-now', geo.pct(temp) + '%');

        state.textContent = '';
        state.appendChild(E('strong', {}, temp.toFixed(1) + ' °C'));
        state.appendChild(document.createTextNode(' \u00b7 ' + zone_label(zone)));

        // 把整条带子翻译成一句话，读屏用户不必去理解图形
        band.setAttribute('aria-label',
            _('Temperature Band') + ': ' + temp.toFixed(1) + ' °C, ' + zone_label(zone) +
            ', ' + _('Stop') + ' ' + geo.stop + ' °C, ' +
            _('Start') + ' ' + cfg.start_temp + ' °C, ' +
            _('Max') + ' ' + cfg.max_temp + ' °C');
    },

    updateStatus: function () {
        var cfg = this.read_config();
        var self = this;

        // 刻度与配置有关，每轮都重画一次：改完保存后带子会立刻跟上
        this.render_band_scale(cfg);

        // 分别独立更新，避免 Promise.all 产生的批量等待
        if (cfg.thermal_file) {
            // 不用 L.resolveDefault 把错误吞成 null：RPC 被拒绝必须和「读到空内容」区分开
            L.resolveDefault(callReadFile(cfg.thermal_file), false).then(function (temp_str) {
                var span = document.getElementById('fc_temp');
                if (!span)
                    return;

                if (temp_str === false) {
                    span.className = 'fc-value fc-value-text';
                    span.textContent = _('Read failed');
                    self.render_band_reading(cfg, 0, false);
                } else if (temp_str != null && temp_str.trim() !== '') {
                    var raw = parseInt(temp_str, 10);

                    if (isNaN(raw)) {
                        span.className = 'fc-value fc-value-text';
                        span.textContent = _('Invalid');
                        self.render_band_reading(cfg, 0, false);
                    } else {
                        var temp = raw / cfg.temp_div;

                        span.className = 'fc-value';
                        span.textContent = temp.toFixed(1);
                        span.appendChild(E('small', {}, '°C'));
                        self.flash(span);
                        self.render_band_reading(cfg, temp, true);
                    }
                } else {
                    span.className = 'fc-value fc-value-text';
                    span.textContent = _('N/A');
                    self.render_band_reading(cfg, 0, false);
                }
            });
        }

        if (cfg.fan_file) {
            L.resolveDefault(callReadFile(cfg.fan_file), false).then(function (speed_str) {
                var span = document.getElementById('fc_fan');
                if (!span)
                    return;

                span.textContent = '';

                if (speed_str === false) {
                    span.className = 'fc-value fc-value-sm fc-value-text';
                    span.textContent = _('Read failed');
                } else if (speed_str != null && speed_str.trim() !== '') {
                    var speed = parseInt(speed_str, 10);

                    if (isNaN(speed)) {
                        span.className = 'fc-value fc-value-sm fc-value-text';
                        span.textContent = _('Invalid');
                    } else {
                        span.className = 'fc-value fc-value-sm';
                        span.textContent = speed;
                        // 带上量程：只有裸数字的话，117 算高还是低看不出来
                        span.appendChild(E('small', {}, '/' + cfg.max_speed));
                        self.flash(span);
                    }
                } else {
                    span.className = 'fc-value fc-value-sm fc-value-text';
                    span.textContent = _('N/A');
                }
            });
        }
    },

    updateServiceState: function () {
        var span = document.getElementById('fc_service');
        if (!span)
            return;

        var cfg = this.read_config();

        var paint = function (cls, text) {
            span.className = 'fc-badge ' + cls;
            span.textContent = text;
        };

        // 查 procd 里实例的真实运行状态，而不是 UCI 的 enabled 开关：
        // 守护进程崩溃重启循环时配置开关仍然是 1，面板会谎报「运行中」
        callServiceList('fancontrol').then(function (services) {
            var instances = (services && services.fancontrol && services.fancontrol.instances) || {};
            var running = Object.keys(instances).some(function (name) {
                return instances[name] && instances[name].running;
            });

            // 三种情况要分开：真在跑 / 已启用但没跑 / 根本没启用。
            // 默认（enabled = 0）时亮红色属于误导，那只是没开而已。
            if (running)
                paint('is-ok', _('Running'));
            else if (cfg.enabled)
                paint('is-warn', _('Stopped'));
            else
                paint('is-off', _('Disabled'));
        }).catch(function () {
            // 权限不足或 ubus 不可用时如实显示未知，不要退回配置开关冒充运行状态
            paint('is-off', _('Unknown'));
        });
    },

    render: function () {
        var m, s, o;

        dom.append(document.head, E('style', { id: 'fancontrol-style', type: 'text/css' }, css));

        var container = E('div', {}, [
            E('div', { 'class': 'fc-panel cbi-section' }, [
                E('h3', {}, _('Live Status')),
                E('div', { 'class': 'cbi-section-node', 'style': 'padding: 1rem;' }, [
                    E('div', { 'class': 'fc-readouts', 'aria-live': 'polite' }, [
                        E('div', { 'class': 'fc-readout is-primary' }, [
                            E('span', { 'class': 'fc-readout-label' }, _('CPU Temperature')),
                            E('span', { 'class': 'fc-value', 'id': 'fc_temp' }, _('Loading...'))
                        ]),
                        E('div', { 'class': 'fc-readout' }, [
                            E('span', { 'class': 'fc-readout-label' }, _('Service Status')),
                            E('span', { 'class': 'fc-badge is-off', 'id': 'fc_service' }, _('Loading...'))
                        ]),
                        E('div', { 'class': 'fc-readout' }, [
                            E('span', { 'class': 'fc-readout-label' }, _('Fan Speed Level')),
                            E('span', { 'class': 'fc-value fc-value-sm', 'id': 'fc_fan' }, _('Loading...'))
                        ])
                    ]),
                    E('div', { 'class': 'fc-band is-unknown', 'id': 'fc_band', 'role': 'img' }, [
                        E('div', { 'class': 'fc-band-label' }, _('Temperature Band')),
                        E('div', { 'class': 'fc-track', 'id': 'fc_track' }, [
                            E('span', { 'class': 'fc-marker', 'id': 'fc_marker' })
                        ]),
                        E('div', { 'class': 'fc-ticks' }, [
                            E('span', { 'class': 'fc-tick', 'id': 'fc_tick_stop' }, [
                                E('b', {}, _('Stop')), E('i', {}, '\u2014')
                            ]),
                            E('span', { 'class': 'fc-tick', 'id': 'fc_tick_start' }, [
                                E('b', {}, _('Start')), E('i', {}, '\u2014')
                            ]),
                            E('span', { 'class': 'fc-tick', 'id': 'fc_tick_max' }, [
                                E('b', {}, _('Max')), E('i', {}, '\u2014')
                            ])
                        ]),
                        E('p', { 'class': 'fc-band-state', 'id': 'fc_band_state' }, _('Loading...'))
                    ])
                ])
            ])
        ]);

        m = new form.Map('fancontrol', _('Fan Control Settings'), _('Configure the parameters for the fan control service.'));
        s = m.section(form.TypedSection, 'fancontrol', _('General'));
        s.anonymous = true;

        o = s.option(form.Flag, 'enabled', _('Enable Service'));
        o = s.option(form.Value, 'thermal_file', _('Thermal File Path'));
        o = s.option(form.Value, 'temp_div', _('Temperature Divisor'));
        o.validate = function (section_id, value) {
            // 只接受正整数：0 会让温度换算除零，空值与非数字同样无意义。
            // 不用 datatype 是因为它对空值的处理依赖 LuCI 内部实现，显式判断更可靠
            if (!/^[0-9]+$/.test(value) || parseInt(value, 10) < 1)
                return _('Must be a positive integer.');
            return true;
        };
        o.description = _('The raw sensor value is divided by this to get degrees Celsius.');

        o = s.option(form.Value, 'fan_file', _('Fan Control File Path'));

        o = s.option(form.Value, 'start_speed', _('Initial Speed'));
        o.description = _('The minimum speed level when the fan is running.');

        o = s.option(form.Value, 'max_speed', _('Max Speed'));
        o.description = _('The maximum speed level of the fan.');

        o = s.option(form.Value, 'start_temp', _('Start Temperature (°C)'));
        o.description = _('When the temperature reaches this value, the fan starts spinning.');

        o = s.option(form.Value, 'max_temp', _('Max Temperature (°C)'));
        o.description = _('The temperature at which the fan should run at maximum speed.');

        o = s.option(form.Value, 'hysteresis_temp', _('Hysteresis Temperature (°C)'));
        o.description = _('The fan will not stop until the temperature drops below (Start Temperature - Hysteresis).');

        o = s.option(form.Flag, 'debug', _('Debug Logging'));
        o.description = _('Log the temperature and target speed to syslog on every poll.');

        return m.render().then(L.bind(function (map_rendered) {
            container.appendChild(map_rendered);

            // 刻度先按配置画一次，读数的位置等第一次轮询回来再定
            this.render_band_scale(this.read_config());
            this.updateStatus();
            this.updateServiceState();

            this.pollingTimer = setInterval(L.bind(function () {
                // 页面不可见时不发 RPC：守护进程照常控温，后台标签页没必要每 5 秒查一次 sysfs
                if (document.hidden)
                    return;

                this.updateStatus();
                this.updateServiceState();
            }, this), 5000);

            // 切回页面时立刻补一次，不必等下一个 5 秒周期
            // 先摘掉可能残留的旧监听器：render 若被重入，旧引用会丢失而永远摘不掉
            if (this.visibilityHandler)
                document.removeEventListener('visibilitychange', this.visibilityHandler);

            this.visibilityHandler = L.bind(function () {
                if (!document.hidden) {
                    this.updateStatus();
                    this.updateServiceState();
                }
            }, this);
            document.addEventListener('visibilitychange', this.visibilityHandler);

            return container;
        }, this));
    },

    dispatch: function () {
        var style_tag = document.getElementById('fancontrol-style');
        if (style_tag && style_tag.parentNode)
            style_tag.parentNode.removeChild(style_tag);

        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = null;
        }

        if (this.visibilityHandler) {
            document.removeEventListener('visibilitychange', this.visibilityHandler);
            this.visibilityHandler = null;
        }
    }
});
