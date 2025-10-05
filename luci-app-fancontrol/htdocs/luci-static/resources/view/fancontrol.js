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

// 自定义样式（无需改动）
var css = `
/* 整体两栏布局 */
.fan-control-container {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
}
.fan-status-container { flex: 1; min-width: 260px; } /* 监控面板占1份 */
.fan-form-container { flex: 2; min-width: 320px; }   /* 设置表单占2份 */

/* 去掉LuCI默认灰底与边框 */
.fan-form-container .cbi-map {
    background: transparent !important;
    border: 0 !important;
    box-shadow: none !important;
    padding: 0 !important;
}

/* 选项卡样式 */
.fc-tabs {
    display: flex;
    gap: 8px;
    border-bottom: 1px solid #e5e7eb;
    margin: 4px 0 12px 0;
}
.fc-tab {
    appearance: none;
    background: transparent;
    border: 1px solid transparent;
    border-bottom: 0;
    padding: 8px 14px;
    font-size: 14px;
    color: #374151;
    border-top-left-radius: 8px;
    border-top-right-radius: 8px;
    cursor: default;
}
.fc-tab.active {
    background: #ffffff;
    border-color: #e5e7eb;
    color: #111827;
    box-shadow: 0 -1px 0 0 #e5e7eb, 0 2px 0 0 #ffffff;
}

/* 表单卡片容器 */
.fan-form-card {
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    padding: 14px 16px;
    box-shadow: 0 1px 2px rgba(0,0,0,.04);
}

/* 表单项两列栅格 */
.fan-form-container .cbi-section .cbi-value {
    display: grid;
    grid-template-columns: 220px 1fr;
    align-items: center;
    gap: 6px 16px;
    padding: 10px 0;
    border-bottom: 1px dashed #f0f0f0;
}
.fan-form-container .cbi-section .cbi-value:last-child {
    border-bottom: 0;
}

/* 标签与帮助 */
.fan-form-container .cbi-value .cbi-value-title {
    font-weight: 600;
    color: #374151;
}
.fan-form-container .cbi-value .cbi-value-description {
    grid-column: 2 / 3;
    margin-top: -2px;
    color: #6b7280;
    font-size: 12px;
}

/* 输入外观统一圆角 */
.fan-form-container input[type="text"],
.fan-form-container input[type="number"],
.fan-form-container .cbi-input-text,
.fan-form-container select {
    width: 100%;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 14px;
    color: #111827;
    background: #fff;
}
.fan-form-container input[type="checkbox"] {
    transform: scale(1.05);
}

/* 聚焦高亮 */
.fan-form-container input:focus,
.fan-form-container select:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59,130,246,.2);
}

/* 状态卡片（右侧监控） */
.status-card {
    background-color: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    padding: 14px 16px;
    margin-bottom: 14px;
    display: flex;
    align-items: center;
    gap: 12px;
    box-shadow: 0 1px 2px rgba(0,0,0,.04);
}
.status-card .icon { font-size: 22px; width: 26px; text-align: center; }
.status-card .text-content .label { display: block; font-size: 12px; color: #6b7280; margin-bottom: 2px; }
.status-card .text-content .value { font-size: 18px; font-weight: 700; color: #111827; }
.status-card .value.running { color: #16a34a; }
.status-card .value.stopped { color: #dc2626; }

/* 小屏优化 */
@media (max-width: 980px) {
    .fan-form-container .cbi-section .cbi-value {
        grid-template-columns: 1fr;
        gap: 4px 0;
    }
}
`;

return view.extend({
    load: function () {
        return Promise.all([ uci.load('fancontrol') ]);
    },

    render: function (data) {
        var m, s;

        var style_tag = E('style', { id: 'fancontrol-style', type: 'text/css' }, css);
        dom.append(document.head, style_tag);
        
        var container = E('div', { 'class': 'fan-control-container' }, [
            E('div', { 'class': 'fan-status-container' }), // 监控面板
            E('div', { 'class': 'fan-form-container' })      // 设置表单
        ]);

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

        m.render().then(function (rendered_form) {
            var right_container = container.querySelector('.fan-form-container');

            var tabs = E('div', { 'class': 'fc-tabs' }, [
                E('button', { 'class': 'fc-tab active', 'disabled': true }, _('General'))
            ]);
            right_container.appendChild(tabs);

            var card = E('div', { 'class': 'fan-form-card' });
            card.appendChild(rendered_form);
            right_container.appendChild(card);

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
                if (temp_span && temp_str && temp_str.trim() !== '') {
                    var temp = parseInt(temp_str);
                    var temp_div = uci.get('fancontrol', 'settings', 'temp_div') || 1000;
                    temp_span.textContent = !isNaN(temp) ? (temp / temp_div).toFixed(1) + ' °C' : _('Invalid');
                } else if (temp_span) {
                    temp_span.textContent = _('N/A');
                }

                var speed_str = results[1] || results[0];
                var speed_span = document.getElementById('status_speed');
                if (speed_span && speed_str && speed_str.trim() !== '') {
                    var speed = parseInt(speed_str);
                    speed_span.textContent = !isNaN(speed) ? speed : _('Invalid');
                } else if (speed_span) {
                    speed_span.textContent = _('N/A');
                }
            });
        });

        return container;
    },

    dispatch: function () {
        var style_tag = document.getElementById('fancontrol-style');
        if (style_tag && style_tag.parentNode)
            style_tag.parentNode.removeChild(style_tag);
    }
});
