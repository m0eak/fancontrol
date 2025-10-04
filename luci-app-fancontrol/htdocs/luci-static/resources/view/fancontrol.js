'use strict';
'require view';
'require form';
'require uci';
'require rpc';
'require dom';

// RPC声明保持不变
var callReadFile = rpc.declare({
    object: 'file',
    method: 'read',
    params: ['path'],
    expect: { data: '' }
});

// 我们将在这里定义所有的自定义样式
var css = `
    .fan-control-container {
        display: flex;
        flex-wrap: wrap;
        gap: 20px;
    }
    .fan-form-container {
        flex: 2;
        min-width: 300px;
    }
    .fan-status-container {
        flex: 1;
        min-width: 250px;
    }
    .status-card {
        background-color: #f9f9f9;
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 15px;
        margin-bottom: 15px;
        display: flex;
        align-items: center;
        box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }
    .status-card .icon {
        font-size: 28px;
        margin-right: 15px;
        color: #555;
        width: 30px;
        text-align: center;
    }
    .status-card .text-content .label {
        display: block;
        font-size: 12px;
        color: #666;
        margin-bottom: 2px;
    }
    .status-card .text-content .value {
        font-size: 20px;
        font-weight: bold;
        color: #000;
    }
    .status-card .value.running { color: #46a444; }
    .status-card .value.stopped { color: #d9534f; }
`;

return view.extend({
    load: function () {
        return Promise.all([
            uci.load('fancontrol')
        ]);
    },

    render: function (data) {
        var m, s, o;

        // 注入我们的自定义CSS到页面头部
        var style_tag = E('style', { 'id': 'fancontrol-style', 'type': 'text/css' }, css);
        dom.append(document.head, style_tag);

        // --- 1. 创建现代化的弹性布局容器 (不再使用 cbi-map) ---
        var container = E('div', { 'class': 'fan-control-container' }, [
            E('div', { 'class': 'fan-form-container' }),
            E('div', { 'class': 'fan-status-container' })
        ]);

        // --- 2. 构建右侧精美的“实时状态”卡片 ---
        var status_panel = E('div', {}, [
            E('h3', {}, _('Live Status')),
            E('div', { 'class': 'status-card' }, [
                E('div', { 'class': 'icon' }, '⚡'),
                E('div', { 'class': 'text-content' }, [
                    E('span', { 'class': 'label' }, _('Service Status')),
                    E('span', { 'id': 'status_enabled', 'class': 'value' }, _('Loading...'))
                ])
            ]),
            E('div', { 'class': 'status-card' }, [
                E('div', { 'class': 'icon' }, '🌡️'),
                E('div', { 'class': 'text-content' }, [
                    E('span', { 'class': 'label' }, _('CPU Temperature')),
                    E('span', { 'id': 'status_temp', 'class': 'value' }, _('Loading...'))
                ])
            ]),
            E('div', { 'class': 'status-card' }, [
                E('div', { 'class': 'icon' }, '💨'),
                E('div', { 'class': 'text-content' }, [
                    E('span', { 'class': 'label' }, _('Fan Speed Level')),
                    E('span', { 'id': 'status_speed', 'class': 'value' }, _('Loading...'))
                ])
            ])
        ]);
        container.querySelector('.fan-status-container').appendChild(status_panel);

        // --- 3. 构建左侧的配置表单 ---
        m = new form.Map('fancontrol');
        m.title = _('Fan Control Settings');
        m.description = _('Configure the parameters for the fan control service.');
        s = m.section(form.TypedSection, 'fancontrol', _('General'));
        s.anonymous = true;
        s.option(form.Flag, 'enabled', _('Enable Service'));
        s.option(form.Value, 'thermal_file', _('Thermal File Path'));
        s.option(form.Value, 'fan_file', _('Fan Control File Path'));
        s.option(form.Value, 'start_speed', _('Initial Speed'));
        s.option(form.Value, 'max_speed', _('Max Speed'));
        s.option(form.Value, 'start_temp', _('Start Temperature (°C)'));

        // --- 4. 渲染表单并处理异步数据更新 ---
        m.render().then(function (rendered_form) {
            container.querySelector('.fan-form-container').appendChild(rendered_form);

            var isEnabled = uci.get('fancontrol', 'settings', 'enabled') == '1';
            var enabled_span = document.getElementById('status_enabled');
            if (enabled_span) {
                enabled_span.textContent = isEnabled ? _('Running') : _('Stopped');
                enabled_span.className = 'value ' + (isEnabled ? 'running' : 'stopped');
            }

            var thermal_file = uci.get('fancontrol', 'settings', 'thermal_file');
            var fan_file = uci.get('fancontrol', 'settings', 'fan_file');
            var promises = [];
            if (thermal_file) promises.push(L.resolveDefault(callReadFile(thermal_file), ''));
            if (fan_file) promises.push(L.resolveDefault(callReadFile(fan_file), ''));
            
            Promise.all(promises).then(function (results) {
                var temp_str = results[0];
                var temp_span = document.getElementById('status_temp');
                if (temp_span && temp_str.trim() !== '') {
                    var temp = parseInt(temp_str);
                    var temp_div = uci.get('fancontrol', 'settings', 'temp_div') || 1000;
                    temp_span.textContent = !isNaN(temp) ? (temp / temp_div).toFixed(1) + ' °C' : _('Invalid');
                } else if (temp_span) {
                    temp_span.textContent = _('N/A');
                }
                var speed_str = results[1] || results[0];
                var speed_span = document.getElementById('status_speed');
                if (speed_span && speed_str.trim() !== '') {
                    var speed = parseInt(speed_str);
                    speed_span.textContent = !isNaN(speed) ? speed : _('Invalid');
                } else if (speed_span) {
                    speed_span.textContent = _('N/A');
                }
            });
        });
        
        return container;
    },
    dispatch: function() {
        var style_tag = document.getElementById('fancontrol-style');
        if (style_tag) {
            style_tag.parentNode.removeChild(style_tag);
        }
    }
});

