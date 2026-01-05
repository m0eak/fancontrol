'use strict';
'require view';
'require form';
'require uci';
'require rpc';

var callReadFile = rpc.declare({
    object: 'file',
    method: 'read',
    params: ['path'],
    expect: { data: '' }
});

return view.extend({
    load: function() { return uci.load('fancontrol'); },
    render: function() {
        var m = new form.Map('fancontrol', _('Fan Control Debug'), _('Core function test mode.'));
        
        // 喵！这里改用 NamedSection，精准定位名为 'settings' 的配置段
        var s = m.section(form.NamedSection, 'settings', 'fancontrol', _('Settings'));
        s.anonymous = false;

        s.option(form.Flag, 'enabled', _('Enabled'));
        
        var o = s.option(form.Value, 'thermal_file', _('Thermal File'));
        o.default = '/sys/devices/virtual/thermal/thermal_zone0/temp';
        
        var o = s.option(form.Value, 'fan_file', _('Fan File'));
        o.default = '/sys/devices/virtual/thermal/cooling_device0/cur_state';
        
        // ★★★ 极简文本框：直接输入字符串 ★★★
        var o = s.option(form.Value, 'curve_data', _('Curve DataString'), _('Format: temp:pwm,temp:pwm... e.g. 35:0,45:36,60:90,85:255'));
        o.default = '35:0,45:36,60:90,85:255';

        // 简单的状态监控
        var poll = function() {
             Promise.all([
                 L.resolveDefault(callReadFile(uci.get('fancontrol', 'settings', 'thermal_file')), '?'),
                 L.resolveDefault(callReadFile(uci.get('fancontrol', 'settings', 'fan_file')), '?')
            ]).then(function(r) {
                var status = document.getElementById('fan-status');
                if(status) status.innerHTML = 'Temp: <b>' + (parseInt(r[0])/1000).toFixed(1) + 'C</b> | Fan PWM: <b>' + r[1] + '</b>';
            });
        };
        window.setInterval(poll, 3000);

        return m.render().then(function(nodes) {
            var div = document.createElement('div');
            div.innerHTML = '<div class="cbi-section" style="padding:10px; margin-bottom:10px; background:#f0f0f0; border:1px solid #ccc;">🔴 Live Status: <span id="fan-status">Loading...</span></div>';
            div.appendChild(nodes);
            poll();
            return div;
        });
    }
});