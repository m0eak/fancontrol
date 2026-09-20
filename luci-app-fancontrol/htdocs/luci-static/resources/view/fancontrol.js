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

// 这里的CSS只负责排版布局（左右分栏），完全不涉及颜色和背景
// 颜色和边框统统交给你的主题去决定喵！
var css = `
    .fan-control-container {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start; /* 顶部对齐 */
        margin: -10px; /* 抵消一点padding，让布局更紧凑 */
    }
    
    /* 监控面板 - 左侧 */
    .fan-status-container {
        flex: 1;
        min-width: 250px;
        padding: 10px;
        box-sizing: border-box;
    }

    /* 设置表单 - 右侧 */
    .fan-form-container {
        flex: 2;
        min-width: 320px;
        padding: 10px;
        box-sizing: border-box;
    }
    
    /* 简单的状态列表样式，保持原生风格 */
    .status-item {
        margin-bottom: 10px;
        padding-bottom: 10px;
        border-bottom: 1px solid #eee; /* 这里用个很淡的线条，主题通常能兼容 */
        display: flex;
        align-items: center;
    }
    /* 适配暗色主题的线条颜色 */
    @media (prefers-color-scheme: dark) {
        .status-item { border-bottom-color: #444; }
    }
    
    .status-item:last-child {
        border-bottom: none;
        margin-bottom: 0;
        padding-bottom: 0;
    }
    
    .status-icon {
        font-size: 20px;
        margin-right: 15px;
        width: 24px;
        text-align: center;
        opacity: 0.8;
    }
    
    .status-text label {
        display: block;
        font-size: 12px;
        opacity: 0.7;
    }
    
    .status-text strong {
        font-size: 16px;
    }
`;

return view.extend({
    pollingTimer: null,

    load: function () {
        return Promise.all([uci.load('fancontrol')]);
    },

    updateStatus: function(thermal_file, fan_file, temp_div) {
        // 分别独立更新，避免 Promise.all 产生的批量等待
        if (thermal_file) {
            // 不用 L.resolveDefault 把错误吞成 null：RPC 被拒绝必须和「读到空内容」区分开
            L.resolveDefault(callReadFile(thermal_file), false).then(function(temp_str) {
                var temp_span = document.getElementById('status_temp');
                if (temp_span) {
                    if (temp_str === false) {
                        temp_span.textContent = _('Read failed');
                        temp_span.title = _('Check that the path exists and is allowed by the ACL.');
                    } else if (temp_str != null && temp_str.trim() !== '') {
                        var temp = parseInt(temp_str, 10);
                        temp_span.textContent = !isNaN(temp) ? (temp / temp_div).toFixed(1) + ' °C' : _('Invalid');
                    } else {
                        temp_span.textContent = _('N/A');
                    }
                }
            });
        }

        if (fan_file) {
            L.resolveDefault(callReadFile(fan_file), false).then(function(speed_str) {
                var speed_span = document.getElementById('status_speed');
                if (speed_span) {
                    if (speed_str === false) {
                        speed_span.textContent = _('Read failed');
                        speed_span.title = _('Check that the path exists and is allowed by the ACL.');
                    } else if (speed_str != null && speed_str.trim() !== '') {
                        var speed = parseInt(speed_str, 10);
                        speed_span.textContent = !isNaN(speed) ? speed : _('Invalid');
                    } else {
                        speed_span.textContent = _('N/A');
                    }
                }
            });
        }
    },

    updateServiceState: function (enabled_span) {
        if (!enabled_span)
            return;

        // 查 procd 里实例的真实运行状态，而不是 UCI 的 enabled 开关：
        // 守护进程崩溃重启循环时配置开关仍然是 1，面板会谎报「运行中」
        callServiceList('fancontrol').then(function (services) {
            var instances = (services && services.fancontrol && services.fancontrol.instances) || {};
            var running = Object.keys(instances).some(function (name) {
                return instances[name] && instances[name].running;
            });

            // 用主题的语义类，而不是写死 color:green/red，暗色主题下才有一致的对比度
            enabled_span.textContent = '';
            enabled_span.appendChild(E('span', {
                'class': 'label ' + (running ? 'success' : 'danger')
            }, running ? _('Running') : _('Stopped')));
        }).catch(function () {
            // 权限不足或 ubus 不可用时如实显示未知，不要退回配置开关冒充运行状态
            enabled_span.textContent = '';
            enabled_span.appendChild(E('span', { 'class': 'label' }, _('Unknown')));
        });
    },

    render: function (data) {
        var m, s, o;

        var style_tag = E('style', { id: 'fancontrol-style', type: 'text/css' }, css);
        dom.append(document.head, style_tag);

        var container = E('div', { 'class': 'fan-control-container' }, [
            E('div', { 'class': 'fan-status-container' }),
            E('div', { 'class': 'fan-form-container' })
        ]);

        var status_panel = E('div', { 'class': 'cbi-section' }, [
            E('h3', {}, _('Live Status')),
            E('div', { 'class': 'cbi-section-node', 'style': 'padding: 1rem;' }, [
                E('div', { 'class': 'status-item' }, [
                    E('div', { 'class': 'status-icon' }, '⚡'),
                    E('div', { 'class': 'status-text' }, [
                        E('label', {}, _('Service Status')),
                        E('strong', { 'id': 'status_enabled' })
                    ])
                ]),
                E('div', { 'class': 'status-item' }, [
                    E('div', { 'class': 'status-icon' }, '🌡️'),
                    E('div', { 'class': 'status-text' }, [
                        E('label', {}, _('CPU Temperature')),
                        E('strong', { 'id': 'status_temp' }, _('Loading...'))
                    ])
                ]),
                E('div', { 'class': 'status-item' }, [
                    E('div', { 'class': 'status-icon' }, '💨'),
                    E('div', { 'class': 'status-text' }, [
                        E('label', {}, _('Fan Speed Level')),
                        E('strong', { 'id': 'status_speed' }, _('Loading...'))
                    ])
                ])
            ])
        ]);
        container.querySelector('.fan-status-container').appendChild(status_panel);

        m = new form.Map('fancontrol', _('Fan Control Settings'), _('Configure the parameters for the fan control service.'));
        s = m.section(form.TypedSection, 'fancontrol', _('General'));
        s.anonymous = true;

        o = s.option(form.Flag, 'enabled', _('Enable Service'));
        o = s.option(form.Value, 'thermal_file', _('Thermal File Path'));
        o = s.option(form.Value, 'temp_div', _('Temperature Divisor'));
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

        // Extract paths and values once from data to avoid repeated uci.get calls
        var thermal_file = uci.get('fancontrol', 'settings', 'thermal_file');
        var fan_file = uci.get('fancontrol', 'settings', 'fan_file');
        // 必须用 parseInt：uci.get 返回的是字符串，"0" 在 JS 里是真值，会算出 Infinity °C
        var temp_div = parseInt(uci.get('fancontrol', 'settings', 'temp_div'), 10) || 1000;
        this.updateServiceState(container.querySelector('#status_enabled'));

        return m.render().then(L.bind(function (map_rendered) {
            container.querySelector('.fan-form-container').appendChild(map_rendered);
            
            // Start polling and perform initial update *after* render completes
            this.updateStatus(thermal_file, fan_file, temp_div);
            this.pollingTimer = setInterval(L.bind(function() {
                // 页面不可见时不发 RPC：守护进程照常控温，后台标签页没必要每 5 秒查一次 sysfs
                if (document.hidden)
                    return;
                this.updateStatus(thermal_file, fan_file, temp_div);
                this.updateServiceState(document.getElementById('status_enabled'));
            }, this), 5000);
            // 切回页面时立刻补一次，不必等下一个 5 秒周期
            this.visibilityHandler = L.bind(function() {
                if (!document.hidden) {
                    this.updateStatus(thermal_file, fan_file, temp_div);
                    this.updateServiceState(document.getElementById('status_enabled'));
                }
            }, this);
            document.addEventListener('visibilitychange', this.visibilityHandler);

            return container;
        }, this));
    },

    dispatch: function () {
        var style_tag = document.getElementById('fancontrol-style');
        if (style_tag && style_tag.parentNode) {
            style_tag.parentNode.removeChild(style_tag);
        }
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
