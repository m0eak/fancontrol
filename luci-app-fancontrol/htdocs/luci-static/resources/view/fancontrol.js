'use strict';
'require view';
'require form';
'require uci';
'require rpc';
'require dom';

var callReadFile = rpc.declare({
    object: 'file',
    method: 'read',
    params: ['path'],
    expect: { data: '' }
});

// CSS 只布局，不定义死颜色，完美适配暗黑主题
var css = `
    .fan-wrapper {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: 20px;
    }
    .fan-left {
        flex: 1;
        min-width: 250px;
    }
    .fan-right {
        flex: 2;
        min-width: 320px;
    }
    /* 监控面板样式 */
    .status-item {
        display: flex;
        align-items: center;
        padding: 10px 0;
        border-bottom: 1px solid rgba(128, 128, 128, 0.2);
    }
    .status-item:last-child { border-bottom: none; }
    .status-icon {
        font-size: 24px;
        width: 40px;
        text-align: center;
        opacity: 0.8;
    }
    .status-info { display: flex; flex-direction: column; }
    .status-label { font-size: 12px; opacity: 0.7; }
    .status-value { font-size: 16px; font-weight: bold; }
`;

return view.extend({
    load: function() { return uci.load('fancontrol'); },
    render: function() {
        var style = E('style', {}, css); dom.append(document.head, style);

        var container = E('div', { class: 'fan-wrapper' });

        // --- 左侧：原生风格监控面板 ---
        // 使用 cbi-section 类，继承系统主题色
        var monitorPanel = E('div', { class: 'fan-left cbi-section' }, [
            E('h3', {}, _('Live Status')),
            E('div', { class: 'cbi-section-node', style: 'padding: 10px 20px;' }, [
                E('div', { class: 'status-item' }, [
                    E('div', { class: 'status-icon' }, '⚡'),
                    E('div', { class: 'status-info' }, [
                        E('span', { class: 'status-label' }, _('Service Status')),
                        E('span', { id: 'st_svc', class: 'status-value' }, '...')
                    ])
                ]),
                E('div', { class: 'status-item' }, [
                    E('div', { class: 'status-icon' }, '🌡️'),
                    E('div', { class: 'status-info' }, [
                        E('span', { class: 'status-label' }, _('Temperature')),
                        E('span', { id: 'st_temp', class: 'status-value' }, '...')
                    ])
                ]),
                E('div', { class: 'status-item' }, [
                    E('div', { class: 'status-icon' }, '💨'),
                    E('div', { class: 'status-info' }, [
                        E('span', { class: 'status-label' }, _('Fan PWM')),
                        E('span', { id: 'st_pwm', class: 'status-value' }, '...')
                    ])
                ])
            ])
        ]);
        container.appendChild(monitorPanel);

        // --- 右侧：设置表单 ---
        var settingsDiv = E('div', { class: 'fan-right' });
        container.appendChild(settingsDiv);

        var m = new form.Map('fancontrol', _('Fan Control'), _('Configure control points via list.'));
        m.render().then(function(n){ settingsDiv.appendChild(n); });

        var s = m.section(form.NamedSection, 'settings', 'fancontrol', _('Settings'));
        s.anonymous = false;

        s.option(form.Flag, 'enabled', _('Enabled'));
        
        // ★★★ 动态列表配置 ★★★
        var o = s.option(form.DynamicList, 'curve_point', _('Control Points'), 
            _('Format: <b>Temp Speed</b>. e.g. <code>45 36</code> (Space separated).'));
        
        o.datatype = 'string';
        o.placeholder = '45 36';
        
        // ★★★ 宽松验证：允许空格或冒号 ★★★
        o.validate = function(section_id, value) {
            if (!value) return true;
            if (!value.match(/^\s*\d+[\s:]+\d+\s*$/)) {
                return _('Invalid format! Use: Temp Speed (e.g. 45 36)');
            }
            return true;
        };

        var o = s.option(form.Value, 'thermal_file', _('Thermal File'));
        o.placeholder = '/sys/devices/virtual/thermal/thermal_zone0/temp';
        o.optional = true;
        
        var o = s.option(form.Value, 'fan_file', _('Fan File'));
        o.placeholder = '/sys/devices/virtual/thermal/cooling_device0/cur_state';
        o.optional = true;

        // 轮询更新数据
        window.setInterval(function() {
            Promise.all([
                 L.resolveDefault(callReadFile(uci.get('fancontrol', 'settings', 'thermal_file')), ''),
                 L.resolveDefault(callReadFile(uci.get('fancontrol', 'settings', 'fan_file')), '')
            ]).then(function(r) {
                var run = uci.get('fancontrol', 'settings', 'enabled') == '1';
                var elS = document.getElementById('st_svc');
                if(elS) {
                    elS.innerText = run ? _('RUNNING') : _('STOPPED');
                    elS.style.color = run ? '#28a745' : '#dc3545';
                }
                var t = parseInt(r[0]);
                if(document.getElementById('st_temp')) document.getElementById('st_temp').innerText = isNaN(t) ? '-' : (t/1000).toFixed(1) + ' °C';
                if(document.getElementById('st_pwm')) document.getElementById('st_pwm').innerText = r[1] || '-';
            });
        }, 3000);

        return container;
    }
});