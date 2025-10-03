'use strict';
'require view';
'require fs';
'require form';
'require uci';
'require tools.widgets as widgets';
'require rpc';


var callReadFile = rpc.declare({
    object: 'file',
    method: 'read',
    params: ['path'],
    expect: { data: '' }
});

return view.extend({
    load: function () {
        return Promise.all([
            uci.load('fancontrol')
        ]);
    },

    render: function (data) {
        var m, s, o;

        m = new form.Map('fancontrol', _('Fan General Control'));
        s = m.section(form.TypedSection, 'fancontrol', _('Settings'));
        s.anonymous = true;

        o = s.option(form.Flag, 'enabled', _('Enabled'), _('Enabled'));
        o.rmempty = false;

        o = s.option(form.Value, 'thermal_file', _('Thermal File'),
            _('Current temperature:') + ' <span id="fan_temp_status">' + _('Loading...') + '</span>'
        );
        o.placeholder = '/sys/devices/virtual/thermal/thermal_zone0/temp';

        o = s.option(form.Value, 'fan_file', _('Fan File'),
            _('Current speed:') + ' <span id="fan_speed_status">' + _('Loading...') + '</span>'
        );
        o.placeholder = '/sys/devices/virtual/thermal/cooling_device0/cur_state';

        o = s.option(form.Value, 'start_speed', _('Initial Speed'), _('Please enter the initial speed for fan startup.'));
        o.placeholder = '35';

        o = s.option(form.Value, 'max_speed', _('Max Speed'), _('Please enter maximum fan speed.'));
        o.placeholder = '255';

        o = s.option(form.Value, 'start_temp', _('Start Temperature'), _('Please enter the fan start temperature.'));
        o.placeholder = '45';

        return m.render().then(function (rendered_html) {

            Promise.all([
                L.resolveDefault(callReadFile(uci.get('fancontrol', 'settings', 'thermal_file'))),
                L.resolveDefault(callReadFile(uci.get('fancontrol', 'settings', 'fan_file')))
            ]).then(function (results) {
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

            return rendered_html;
        });
    }
});
