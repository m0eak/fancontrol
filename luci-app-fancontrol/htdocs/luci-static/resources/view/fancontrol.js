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
    :root { --fc-bg: #fff; --fc-border: #e5e7eb; --fc-text: #111827; --fc-grid: #e5e7eb; --fc-line: #3b82f6; --fc-axis: #9ca3af; }
    @media (prefers-color-scheme: dark) { :root { --fc-bg: #2a2a2a; --fc-border: #444; --fc-text: #eee; --fc-grid: #444; --fc-axis: #888; } }
    
    .fan-wrapper { display: flex; flex-wrap: wrap; gap: 20px; }
    .fan-col-left { flex: 1; min-width: 250px; }
    .fan-col-right { flex: 2; min-width: 350px; }
    
    .curve-wrap { position: relative; width: 100%; border: 1px solid var(--fc-border); background: var(--fc-bg); border-radius: 6px; padding: 10px; margin-top: 5px; }
    .curve-svg { width: 100%; height: 300px; cursor: crosshair; display: block; }
    .curve-point { fill: var(--fc-bg); stroke: var(--fc-line); stroke-width: 3px; cursor: grab; transition: r 0.1s; }
    .curve-point:hover, .curve-point.dragging { fill: var(--fc-line); r: 7px; }
    
    .status-panel { display: flex; gap: 15px; margin-bottom: 20px; padding: 15px; background: var(--fc-bg); border: 1px solid var(--fc-border); border-radius: 8px; }
    .status-item { flex: 1; text-align: center; }
    .status-val { display: block; font-size: 1.2em; font-weight: bold; color: var(--fc-text); margin-top: 5px; }
    .status-lbl { font-size: 0.85em; color: var(--fc-axis); }
`;

// 解析字符串 "35:0,45:36" -> Array
function parseCurve(str) {
    var pts = [];
    if (typeof str === 'string' && str.length > 0) {
        str.split(',').forEach(function(pair) {
            var kv = pair.split(':');
            if (kv.length === 2) {
                var t = parseInt(kv[0]), p = parseInt(kv[1]);
                if (!isNaN(t) && !isNaN(p)) pts.push({ t: t, p: p });
            }
        });
    }
    // 保底数据，防止空图表
    if (pts.length < 2) pts = [{t:35,p:0}, {t:45,p:36}, {t:60,p:90}, {t:85,p:255}];
    return pts.sort(function(a,b){return a.t - b.t});
}

// 数组转字符串 Array -> "35:0,45:36"
function stringifyCurve(pts) {
    return pts.map(function(pt){ return pt.t + ':' + pt.p; }).join(',');
}

var CurveWidget = form.Value.extend({
    __name__: 'CurveWidget',

    renderWidget: function(section_id, option_id, cfgvalue) {
        var self = this;
        // 如果有缓存用缓存，没有则解析 cfgvalue
        // cfgvalue 应该是 "35:0,45:36..." 这种字符串
        var points = this.data || parseCurve(cfgvalue);
        this.data = points; 

        var vW=600, vH=300, pad={t:20,r:20,b:30,l:40};
        var innerW = vW-pad.l-pad.r, innerH = vH-pad.t-pad.b;

        var el = E('div', { class: 'curve-wrap' });
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 '+vW+' '+vH);
        svg.setAttribute('class', 'curve-svg');
        
        // 坐标转换
        function val2x(t) { return pad.l + (Math.max(0,Math.min(100,t))/100)*innerW; }
        function x2val(x) { return Math.max(0,Math.min(100,Math.round((x-pad.l)/innerW*100))); }
        function val2y(p) { return vH-pad.b - (Math.max(0,Math.min(255,p))/255)*innerH; }
        function y2val(y) { return Math.max(0,Math.min(255,Math.round((vH-pad.b-y)/innerH*255))); }

        // 绘制网格
        var gridStr = '';
        // Y轴
        for(var i=0;i<=5;i++) { 
            var y = val2y(i*51); 
            gridStr += 'M'+pad.l+','+y+' H'+(vW-pad.r)+' ';
            var txt = document.createElementNS('http://www.w3.org/2000/svg','text');
            txt.textContent=Math.round(i*51); txt.setAttribute('x',pad.l-5); txt.setAttribute('y',y+4); 
            txt.setAttribute('text-anchor','end'); txt.setAttribute('fill','var(--fc-axis)'); txt.setAttribute('font-size','10px');
            svg.appendChild(txt);
        }
        // X轴
        for(var i=0;i<=10;i++) { 
            var x = val2x(i*10); 
            gridStr += 'M'+x+','+pad.t+' V'+(vH-pad.b)+' ';
            var txt = document.createElementNS('http://www.w3.org/2000/svg','text');
            txt.textContent=i*10; txt.setAttribute('x',x); txt.setAttribute('y',vH-5); 
            txt.setAttribute('text-anchor','middle'); txt.setAttribute('fill','var(--fc-axis)'); txt.setAttribute('font-size','10px');
            svg.appendChild(txt);
        }
        var path = document.createElementNS('http://www.w3.org/2000/svg','path');
        path.setAttribute('d', gridStr); path.setAttribute('stroke', 'var(--fc-grid)'); path.setAttribute('stroke-width','1');
        svg.prepend(path);

        // 多段线
        var poly = document.createElementNS('http://www.w3.org/2000/svg','polyline');
        poly.setAttribute('fill','none'); poly.setAttribute('stroke','var(--fc-line)'); poly.setAttribute('stroke-width','3');
        svg.appendChild(poly);

        // 交互点
        var dotsG = document.createElementNS('http://www.w3.org/2000/svg','g');
        svg.appendChild(dotsG);

        function update() {
            points.sort(function(a,b){return a.t-b.t});
            poly.setAttribute('points', points.map(function(pt){ return val2x(pt.t)+','+val2y(pt.p) }).join(' '));
            
            dotsG.innerHTML = '';
            points.forEach(function(pt, idx){
                var c = document.createElementNS('http://www.w3.org/2000/svg','circle');
                c.setAttribute('cx', val2x(pt.t)); c.setAttribute('cy', val2y(pt.p)); c.setAttribute('r', 6);
                c.setAttribute('class', 'curve-point');
                
                c.onmousedown = function(e) {
                    e.preventDefault();
                    c.classList.add('dragging');
                    var rect = svg.getBoundingClientRect();
                    
                    document.onmousemove = function(e) {
                        var clientX = e.clientX || e.touches[0].clientX;
                        var clientY = e.clientY || e.touches[0].clientY;
                        
                        // 缩放修正
                        var svgX = (clientX - rect.left) * (vW / rect.width);
                        var svgY = (clientY - rect.top) * (vH / rect.height);
                        
                        var newT = x2val(svgX);
                        var newP = y2val(svgY);
                        
                        // 约束
                        if (idx > 0) newT = Math.max(newT, points[idx-1].t + 1);
                        if (idx < points.length-1) newT = Math.min(newT, points[idx+1].t - 1);
                        
                        pt.t = newT; pt.p = newP;
                        self.data = points;
                        update();
                    };
                    
                    document.onmouseup = function() {
                        document.onmousemove = null;
                        document.onmouseup = null;
                        c.classList.remove('dragging');
                        // 触发保存按钮高亮
                        dom.callClassMethod(self.section.node, 'triggerValidation');
                    };
                };
                dotsG.appendChild(c);
            });
        }
        update();
        el.appendChild(svg);
        return el;
    },

    // 关键：将数据转回字符串供 LuCI 保存
    formvalue: function(section_id) {
        return stringifyCurve(this.data || []);
    }
});

return view.extend({
    load: function() { return uci.load('fancontrol'); },
    render: function() {
        var style = E('style', {}, css); dom.append(document.head, style);
        
        var container = E('div', { class: 'fan-wrapper' });

        // Left Col (Monitor)
        var monitor = E('div', { class: 'fan-col-left status-panel' }, [
            E('div', { class: 'status-item' }, [ E('span', { class: 'status-lbl' }, _('Service')), E('span', { id:'st_svc', class: 'status-val' }, '...') ]),
            E('div', { class: 'status-item' }, [ E('span', { class: 'status-lbl' }, _('Temp')), E('span', { id:'st_temp', class: 'status-val' }, '...') ]),
            E('div', { class: 'status-item' }, [ E('span', { class: 'status-lbl' }, _('PWM')), E('span', { id:'st_pwm', class: 'status-val' }, '...') ])
        ]);
        container.appendChild(monitor);

        // Right Col (Settings)
        var settingsDiv = E('div', { class: 'fan-col-right' });
        container.appendChild(settingsDiv);

        var m = new form.Map('fancontrol', _('Fan Control'), _('Configure fan speed curve.'));
        // 绑定到 settings 区域
        m.render().then(function(n){ settingsDiv.appendChild(n); });

        var s = m.section(form.TypedSection, 'fancontrol', _('General Settings'));
        s.anonymous = true;

        s.option(form.Flag, 'enabled', _('Enabled'));
        
        var o = s.option(form.Value, 'thermal_file', _('Thermal File'));
        o.placeholder = '/sys/devices/virtual/thermal/thermal_zone0/temp';
        o.optional = true;
        
        var o = s.option(form.Value, 'fan_file', _('Fan File'));
        o.placeholder = '/sys/devices/virtual/thermal/cooling_device0/cur_state';
        o.optional = true;
        
        // ★★★ 绑定到 'curve_data' ★★★
        s.option(CurveWidget, 'curve_data', _('Speed Curve'), _('Drag points to adjust fan strategy.'));

        // Polling loop
        window.setInterval(function() {
            Promise.all([
                 L.resolveDefault(callReadFile(uci.get('fancontrol', 'settings', 'thermal_file')), ''),
                 L.resolveDefault(callReadFile(uci.get('fancontrol', 'settings', 'fan_file')), '')
            ]).then(function(r) {
                var run = uci.get('fancontrol', 'settings', 'enabled') == '1';
                var elS = document.getElementById('st_svc');
                if(elS) {
                    elS.innerText = run ? _('RUNNING') : _('STOPPED');
                    elS.style.color = run ? '#10b981' : '#ef4444';
                }
                var t = parseInt(r[0]);
                if(document.getElementById('st_temp')) document.getElementById('st_temp').innerText = isNaN(t) ? '-' : (t/1000).toFixed(1) + '°C';
                if(document.getElementById('st_pwm')) document.getElementById('st_pwm').innerText = r[1] || '-';
            });
        }, 2000);

        return container;
    }
});