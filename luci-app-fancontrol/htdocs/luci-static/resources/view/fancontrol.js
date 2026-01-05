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

var css = `
    :root {
        --fc-bg: #ffffff;
        --fc-border: #e5e7eb;
        --fc-text-main: #111827;
        --fc-text-sub: #6b7280;
        --fc-grid: #e5e7eb;
        --fc-axis: #9ca3af;
        --fc-tooltip-bg: rgba(0,0,0,0.8);
        --fc-tooltip-text: #fff;
    }

    @media (prefers-color-scheme: dark) {
        :root {
            --fc-bg: #2a2a2a;
            --fc-border: #444444;
            --fc-text-main: #eeeeee;
            --fc-text-sub: #aaaaaa;
            --fc-grid: #444444;
            --fc-axis: #888888;
            --fc-tooltip-bg: rgba(255,255,255,0.9);
            --fc-tooltip-text: #000;
        }
    }
    
    body.dark :root, [data-theme="dark"] :root {
        --fc-bg: #2a2a2a;
        --fc-border: #444444;
        --fc-text-main: #eeeeee;
        --fc-text-sub: #aaaaaa;
        --fc-grid: #444444;
        --fc-axis: #888888;
    }

    .fan-control-wrapper { display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-start; }
    .fan-monitor-col { flex: 1; min-width: 250px; }
    .fan-settings-col { flex: 2; min-width: 350px; }

    .monitor-card {
        background: var(--fc-bg); 
        border: 1px solid var(--fc-border); 
        border-radius: 8px;
        padding: 15px; margin-bottom: 20px; 
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
        color: var(--fc-text-main);
    }
    
    .monitor-item { 
        display: flex; align-items: center; margin-bottom: 12px; 
        border-bottom: 1px solid var(--fc-border); 
        padding-bottom: 12px; 
    }
    .monitor-item:last-child { margin-bottom: 0; border-bottom: none; padding-bottom: 0; }
    
    .monitor-icon { font-size: 24px; margin-right: 15px; width: 30px; text-align: center; opacity: 0.8; }
    .monitor-label { font-size: 12px; color: var(--fc-text-sub); display: block; }
    .monitor-value { font-size: 18px; font-weight: bold; color: var(--fc-text-main); }

    .curve-widget-wrap { position: relative; width: 100%; user-select: none; }
    
    .curve-svg { 
        width: 100%; height: auto; display: block; 
        background: var(--fc-bg); 
        border: 1px solid var(--fc-border); 
        border-radius: 6px;
        cursor: crosshair;
    }
    
    .curve-grid { stroke: var(--fc-grid); stroke-width: 1; }
    .curve-axis-text { font-size: 10px; fill: var(--fc-axis); }
    .curve-line { fill: none; stroke: #3b82f6; stroke-width: 3; stroke-linejoin: round; stroke-linecap: round; }
    
    .curve-point { fill: var(--fc-bg); stroke: #3b82f6; stroke-width: 3; cursor: grab; transition: r 0.1s; }
    .curve-point:hover { r: 7; stroke: #2563eb; }
    .curve-point.dragging { fill: #2563eb; cursor: grabbing; r: 8; }
    
    .curve-tooltip {
        position: absolute; pointer-events: none; 
        background: var(--fc-tooltip-bg); color: var(--fc-tooltip-text);
        padding: 4px 8px; border-radius: 4px; font-size: 12px; display: none; z-index: 100;
        transform: translate(-50%, -100%); margin-top: -10px; white-space: nowrap;
        font-weight: bold;
    }
`;

var CurveWidget = form.AbstractValue.extend({
    __name__: 'CurveWidget',

    cfgvalue: function(section_id) {
        var val = this.super('cfgvalue', arguments);
        if (!Array.isArray(val) || val.length < 2) {
            val = ['35 0', '45 36', '60 90', '85 255'];
        }
        this.currentPoints = this.parsePoints(val);
        return val;
    },

    parsePoints: function(ua) {
        var pts = [];
        if (Array.isArray(ua)) {
            ua.forEach(function(s) {
                var parts = s.split(' ');
                if (parts.length >= 2) pts.push({ t: parseInt(parts[0]), p: parseInt(parts[1]) });
            });
        }
        pts.sort(function(a,b) { return a.t - b.t; });
        return pts;
    },

    renderWidget: function(section_id, option_id, cfgvalue) {
        var self = this;
        var points = this.currentPoints || this.parsePoints(cfgvalue);
        this.currentPoints = points;
        
        var vW = 600, vH = 300; 
        var pad = { t: 20, r: 30, b: 30, l: 40 };
        var innerW = vW - pad.l - pad.r;
        var innerH = vH - pad.t - pad.b;

        var wrap = E('div', { 'class': 'curve-widget-wrap' });
        var tooltip = E('div', { 'class': 'curve-tooltip' });
        wrap.appendChild(tooltip);

        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 ' + vW + ' ' + vH);
        svg.setAttribute('class', 'curve-svg');
        
        function t2x(t) { return pad.l + (Math.max(0, Math.min(100, t)) / 100) * innerW; }
        function x2t(x) { return Math.round(((x - pad.l) / innerW) * 100); }
        function p2y(p) { return vH - pad.b - (Math.max(0, Math.min(255, p)) / 255) * innerH; }
        function y2p(y) { return Math.round(((vH - pad.b - y) / innerH) * 255); }

        var gridG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        var pathD = '';
        for(var i=0; i<=5; i++) {
            var y = vH - pad.b - (innerH * i / 5);
            pathD += 'M'+pad.l+','+y+' L'+(vW-pad.r)+','+y+' ';
            var txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            txt.setAttribute('x', pad.l - 5); txt.setAttribute('y', y + 4);
            txt.setAttribute('text-anchor', 'end'); txt.setAttribute('class', 'curve-axis-text');
            txt.textContent = Math.round(255*i/5);
            gridG.appendChild(txt);
        }
        for(var i=0; i<=10; i++) {
            var x = pad.l + (innerW * i / 10);
            pathD += 'M'+x+','+pad.t+' L'+x+','+(vH-pad.b)+' ';
            var txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            txt.setAttribute('x', x); txt.setAttribute('y', vH - 5);
            txt.setAttribute('text-anchor', 'middle'); txt.setAttribute('class', 'curve-axis-text');
            txt.textContent = (i*10);
            gridG.appendChild(txt);
        }
        var pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pathEl.setAttribute('d', pathD); pathEl.setAttribute('class', 'curve-grid');
        gridG.prepend(pathEl);
        svg.appendChild(gridG);

        var polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        polyline.setAttribute('class', 'curve-line');
        svg.appendChild(polyline);

        var dotsG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        svg.appendChild(dotsG);

        function updateUI() {
            var pts = self.currentPoints;
            pts.sort(function(a,b){ return a.t - b.t; });
            
            var pointsStr = pts.map(function(pt){ return t2x(pt.t)+','+p2y(pt.p); }).join(' ');
            polyline.setAttribute('points', pointsStr);

            dotsG.innerHTML = '';
            pts.forEach(function(pt, idx) {
                var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                c.setAttribute('cx', t2x(pt.t));
                c.setAttribute('cy', p2y(pt.p));
                c.setAttribute('r', 6);
                c.setAttribute('class', 'curve-point');
                
                c.addEventListener('mousedown', function(e) {
                    e.preventDefault();
                    c.classList.add('dragging');
                    
                    var rect = svg.getBoundingClientRect();
                    var scaleX = vW / rect.width;
                    var scaleY = vH / rect.height;

                    function onMove(me) {
                        me.preventDefault();
                        tooltip.style.display = 'block';

                        var clientX = (me.touches ? me.touches[0].clientX : me.clientX);
                        var clientY = (me.touches ? me.touches[0].clientY : me.clientY);
                        
                        var rawX = clientX - rect.left;
                        var rawY = clientY - rect.top;
                        var svgX = rawX * scaleX;
                        var svgY = rawY * scaleY;

                        var newT = Math.max(0, Math.min(100, x2t(svgX)));
                        var newP = Math.max(0, Math.min(255, y2p(svgY)));

                        if (idx > 0) newT = Math.max(newT, pts[idx-1].t + 1);
                        if (idx < pts.length - 1) newT = Math.min(newT, pts[idx+1].t - 1);

                        pt.t = newT;
                        pt.p = newP;
                        self.currentPoints = pts;
                        
                        updateUI();

                        tooltip.style.left = rawX + 'px';
                        tooltip.style.top = (rawY - 15) + 'px';
                        tooltip.innerText = newT + '°C : ' + newP;
                    }

                    function onUp() {
                        document.removeEventListener('mousemove', onMove);
                        document.removeEventListener('mouseup', onUp);
                        document.removeEventListener('touchmove', onMove);
                        document.removeEventListener('touchend', onUp);
                        c.classList.remove('dragging');
                        tooltip.style.display = 'none';
                        
                        if (self.section) dom.callClassMethod(self.section.node, 'triggerValidation');
                    }

                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                    document.addEventListener('touchmove', onMove, {passive: false});
                    document.addEventListener('touchend', onUp);
                });
                
                dotsG.appendChild(c);
            });
        }

        updateUI();
        wrap.appendChild(svg);
        return wrap;
    },

    formValue: function(section_id) {
        var pts = this.currentPoints || [];
        return pts.map(function(pt) { return pt.t + ' ' + pt.p; });
    }
});

return view.extend({
    load: function () {
        return Promise.all([ uci.load('fancontrol') ]);
    },

    render: function (data) {
        var style = E('style', {}, css);
        dom.append(document.head, style);

        var m = new form.Map('fancontrol', _('Fan Control'), _('Configure the dynamic fan control curve.'));
        
        var container = E('div', { 'class': 'fan-control-wrapper' });
        
        var monitorPanel = E('div', { 'class': 'fan-monitor-col' }, [
            E('div', { 'class': 'monitor-card' }, [
                E('h4', { style: 'margin-top:0; border-bottom:1px solid var(--fc-border); padding-bottom:10px;' }, _('Live Status')),
                E('div', { 'class': 'monitor-item' }, [
                    E('div', { 'class': 'monitor-icon' }, '⚡'),
                    E('div', {}, [ E('span', { 'class': 'monitor-label' }, _('Service')), E('div', { 'id': 'st_svc', 'class': 'monitor-value' }, '...') ])
                ]),
                E('div', { 'class': 'monitor-item' }, [
                    E('div', { 'class': 'monitor-icon' }, '🌡️'),
                    E('div', {}, [ E('span', { 'class': 'monitor-label' }, _('Temperature')), E('div', { 'id': 'st_temp', 'class': 'monitor-value' }, '...') ])
                ]),
                E('div', { 'class': 'monitor-item' }, [
                    E('div', { 'class': 'monitor-icon' }, '💨'),
                    E('div', {}, [ E('span', { 'class': 'monitor-label' }, _('Fan PWM')), E('div', { 'id': 'st_pwm', 'class': 'monitor-value' }, '...') ])
                ])
            ])
        ]);
        container.appendChild(monitorPanel);

        var settingsCol = E('div', { 'class': 'fan-settings-col' });
        container.appendChild(settingsCol);

        m.render().then(function(node) {
            settingsCol.appendChild(node);
        });

        // 这里一定要改成 'fancontrol'，因为你的配置文件类型是 fancontrol
        // 之前误写成了 'settings'，导致 LuCI 找不到对应的配置段，所以就是空白的
        var s = m.section(form.TypedSection, 'fancontrol', _('Settings'));
        s.anonymous = true;

        s.option(form.Flag, 'enabled', _('Enable Fan Control'));
        
        var o = s.option(form.Value, 'thermal_file', _('Thermal Source'));
        o.placeholder = '/sys/devices/virtual/thermal/thermal_zone0/temp';
        o.optional = true; // 设为可选，非专家用户可以不填
        
        o = s.option(form.Value, 'fan_file', _('Fan Control Node'));
        o.placeholder = '/sys/devices/virtual/thermal/cooling_device0/cur_state';
        o.optional = true;

        s.option(CurveWidget, 'curve_point', _('Speed Curve'), 
            _('Drag points to set: Temp(X) vs Speed(Y).'));
        
        pollData();

        return container;
    },
    
    handleSaveApply: function (ev, mode) {
        return this.super('handleSaveApply', arguments);
    }
});

function pollData() {
    window.setInterval(function() {
        Promise.all([
            L.resolveDefault(callReadFile(uci.get('fancontrol', 'settings', 'thermal_file')), ''),
            L.resolveDefault(callReadFile(uci.get('fancontrol', 'settings', 'fan_file')), '')
        ]).then(function(res) {
            var tempRaw = parseInt(res[0]);
            var pwmRaw = parseInt(res[1]);
            var enabled = uci.get('fancontrol', 'settings', 'enabled') == '1';

            var elT = document.getElementById('st_temp');
            var elP = document.getElementById('st_pwm');
            var elS = document.getElementById('st_svc');

            if(elT) elT.innerText = isNaN(tempRaw) ? 'N/A' : (tempRaw / 1000).toFixed(1) + ' °C';
            if(elP) elP.innerText = isNaN(pwmRaw) ? 'N/A' : pwmRaw;
            if(elS) {
                elS.innerText = enabled ? _('Running') : _('Stopped');
                elS.style.color = enabled ? '#34d399' : '#f87171';
            }
        });
    }, 3000);
}