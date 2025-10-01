'use strict';
'require view';
'require fs';
'require form';
'require uci';
'require tools.widgets as widgets';
'require rpc';

// 定义一个函数来安全地读取文件内容，这是新版LuCI推荐的RPC调用方式
var callReadFile = rpc.declare({
    object: 'file',
    method: 'read',
    params: ['path'],
    expect: { data: '' }
});

return view.extend({
    // load函数保持不变
    load: function () {
        return Promise.all([
            uci.load('fancontrol')
        ]);
    },

    // render函数现在不再是async
    render: function (data) {
        var m, s, o;

        m = new form.Map('fancontrol', _('Fan General Control'));
        s = m.section(form.TypedSection, 'fancontrol', _('Settings'));
        s.anonymous = true;

        o = s.option(form.Flag, 'enabled', _('Enabled'), _('Enabled'));
        o.rmempty = false;

        o = s.option(form.Value, 'thermal_file', _('Thermal File'),
            // 修改点1: 先不显示温度，而是放一个占位符
            _('Current temperature:') + ' <span id="fan_temp_status">' + _('Loading...') + '</span>'
        );
        o.placeholder = '/sys/devices/virtual/thermal/thermal_zone0/temp';

        o = s.option(form.Value, 'fan_file', _('Fan File'),
            // 修改点2: 先不显示速度，而是放一个占位符
            _('Current speed:') + ' <span id="fan_speed_status">' + _('Loading...') + '</span>'
        );
        o.placeholder = '/sys/devices/virtual/thermal/cooling_device0/cur_state';

        o = s.option(form.Value, 'start_speed', _('Initial Speed'), _('Please enter the initial speed for fan startup.'));
        o.placeholder = '35';

        o = s.option(form.Value, 'max_speed', _('Max Speed'), _('Please enter maximum fan speed.'));
        o.placeholder = '255';

        o = s.option(form.Value, 'start_temp', _('Start Temperature'), _('Please enter the fan start temperature.'));
        o.placeholder = '45';

        // 修改点3: 使用 m.render().then() 来在渲染完成后执行异步操作
        return m.render().then(function (rendered_html) {
            // 在这里，页面的HTML骨架已经准备好了
            // 接下来我们发起异步请求并更新占位符内容

            // 使用Promise.all来并行处理两个文件读取请求
            Promise.all([
                L.resolveDefault(callReadFile(uci.get('fancontrol', 'settings', 'thermal_file'))),
                L.resolveDefault(callReadFile(uci.get('fancontrol', 'settings', 'fan_file')))
            ]).then(function (results) {
                // 处理温度
                var temp_str = results[0];
                var temp_span = document.getElementById('fan_temp_status');
                if (temp_span && temp_str) {
                    var temp = parseInt(temp_str);
                    var temp_div = uci.get('fancontrol', 'settings', 'temp_div') || 1000; // 提供默认值
                    if (!isNaN(temp)) {
                        temp_span.innerHTML = '<b>' + (temp / temp_div).toFixed(2) + '°C</b>';
                    } else {
                        temp_span.textContent = _('Invalid');
                    }
                } else if (temp_span) {
                    temp_span.textContent = _('N/A');
                }

                // 处理速度
                var speed_str = results[1];
                var speed_span = document.getElementById('fan_speed_status');
                if (speed_span && speed_str) {
                    var speed = parseInt(speed_str);
                    if (!isNaN(speed)) {
                        speed_span.innerHTML = '<b>' + speed + '</b>';
                    } else {
                        speed_span.textContent = _('Invalid');
                    }
                } else if (speed_span) {
                    speed_span.textContent = _('N/A');
                }
            });

            // 必须返回渲染好的HTML
            return rendered_html;
        });
    }
});
