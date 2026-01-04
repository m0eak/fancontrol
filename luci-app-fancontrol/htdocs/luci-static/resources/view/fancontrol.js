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

// 注入 SVG 交互样式
var css = `
    .fan-control-container { display: flex; flex-wrap: wrap; gap: 20px; }
    .fan-status-container { flex: 1; min-width: 280px; }
    .fan-chart-container { flex: 2; min-width: 320px; background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 20px; }
    
    /* 简单的状态卡片 */
    .status-card { display: flex; align-items: center; margin-bottom: 0.5rem; border-bottom: 1px solid #eee; padding-bottom: 0.5rem; }
    .status-card:last-child { border: 0; }
    .status-icon { font-size: 1.5rem; margin-right: 1rem; width: 30px; text-align: center; }
    
    /* SVG 图表样式 */
    .chart-svg { width: 100%; height: 300px; user-select: none; border: 1px solid #f0f0f0; background: #fcfcfc; }
    .chart-grid { stroke: #e5e7eb; stroke-width: 1; }
    .chart-line { fill: none; stroke: #3b82f6; stroke-width: 3; stroke-linecap: round; }
    .chart-point { fill: #fff; stroke: #3b82f6; stroke-width: 3; cursor: grab; transition: r 0.1s; }
    .chart-point:hover { r: 8; stroke: #2563eb; }
    .chart-point.dragging { cursor: grabbing; fill: #3b82f6; }
    .chart-area { fill: rgba(59, 130, 246, 0.1); }
    .chart-text { font-size: 12px; fill: #6b7280; }
    .chart-tooltip { font-size: 12px; font-weight: bold; fill: #111827; pointer-events: none; }
`;

// 辅助：生成默认曲线点
function getDefaultPoints() {
    return [
        { t: 35, p: 0 },
        { t: 45, p: 36 },
        { t: 60, p: 90 },
        { t: 85, p: 255 }
    ];
}

return view.extend({
    load: function () {
        return Promise.all([ uci.load('fancontrol') ]);
    },

    render: function (data) {
        var style = E('style', {}, css);
        dom.append(document.head, style);

        var container = E('div', { 'class': 'fan-control-container' });

        // --- 1. 左侧监控面板 (逻辑不变) ---
        var statusPanel = E('div', { 'class': 'fan-status-container cbi-section' }, [
            E('h3', {}, _('Live Status')),
            E('div', { 'class': 'cbi-section-node' }, [
                E('div', { 'class': 'status-card' }, [
                    E('span', { 'class': 'status-icon' }, '⚡'),
                    E('div', {}, [ E('small', {}, _('Service')), E('br'), E('strong', { id: 'st_svc' }, '...') ])
                ]),
                E('div', { 'class': 'status-card' }, [
                    E('span', { 'class': 'status-icon' }, '🌡️'),
                    E('div', {}, [ E('small', {}, _('Temperature')), E('br'), E('strong', { id: 'st_temp' }, '...') ])
                ]),
                E('div', { 'class': 'status-card' }, [
                    E('span', { 'class': 'status-icon' }, '💨'),
                    E('div', {}, [ E('small', {}, _('PWM Speed')), E('br'), E('strong', { id: 'st_pwm' }, '...') ])
                ])
            ])
        ]);
        container.appendChild(statusPanel);

        // --- 2. 右侧曲线编辑器 ---
        // 我们不使用 form.Map 自动渲染 list point，而是手动解析和保存
        var chartContainer = E('div', { 'class': 'fan-chart-container' });
        
        var header = E('div', { 'style': 'display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;' }, [
            E('h3', { 'style': 'margin:0;' }, _('Fan Control Curve')),
            E('div', {}, [
                E('label', { 'class': 'cbi-checkbox' }, [
                    E('input', { 
                        type: 'checkbox', 
                        id: 'cb_enabled',
                        checked: uci.get('fancontrol', 'settings', 'enabled') == '1',
                        click: function(ev) {
                            uci.set('fancontrol', 'settings', 'enabled', ev.target.checked ? '1' : '0');
                        }
                    }),
                    E('span', {}, _(' Enable Service'))
                ])
            ])
        ]);
        chartContainer.appendChild(header);

        // 读取 UCI 数据转换成 JS 对象 [ {t:40, p:30}, ... ]
        var uciPoints = uci.get('fancontrol', 'settings', 'curve_point') || [];
        var points = [];
        if (Array.isArray(uciPoints)) {
            uciPoints.forEach(function(str) {
                var parts = str.split(' ');
                if (parts.length >= 2) points.push({ t: parseInt(parts[0]), p: parseInt(parts[1]) });
            });
        }
        // 如果没有数据，使用默认值
        if (points.length < 2) points = getDefaultPoints();
        // 排序
        points.sort(function(a,b){ return a.t - b.t });

        // SVG 绘图区域配置
        var width = 600, height = 300;
        var padding = { top: 20, right: 30, bottom: 30, left: 40 };
        var innerW = width - padding.left - padding.right;
        var innerH = height - padding.top - padding.bottom;
        
        // 创建 SVG
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
        svg.setAttribute('class', 'chart-svg');

        // 坐标转换函数
        function t2x(t) { return padding.left + (Math.max(0, Math.min(100, t)) / 100) * innerW; } // 0-100度
        function x2t(x) { return Math.round(((x - padding.left) / innerW) * 100); }
        function p2y(p) { return height - padding.bottom - (Math.max(0, Math.min(255, p)) / 255) * innerH; } // 0-255 PWM
        function y2p(y) { return Math.round(((height - padding.bottom - y) / innerH) * 255); }

        // 绘制网格与坐标轴
        var gridPath = '';
        // 纵轴 (PWM)
        for (var i = 0; i <= 5; i++) {
            var y = height - padding.bottom - (innerH * i / 5);
            gridPath += 'M' + padding.left + ',' + y + ' L' + (width - padding.right) + ',' + y + ' ';
            var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', padding.left - 5);
            text.setAttribute('y', y + 4);
            text.setAttribute('text-anchor', 'end');
            text.setAttribute('class', 'chart-text');
            text.textContent = Math.round(255 * i / 5);
            svg.appendChild(text);
        }
        // 横轴 (Temp)
        for (var i = 0; i <= 10; i++) {
            var x = padding.left + (innerW * i / 10);
            gridPath += 'M' + x + ',' + padding.top + ' L' + x + ',' + (height - padding.bottom) + ' ';
            var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', x);
            text.setAttribute('y', height - 5);
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('class', 'chart-text');
            text.textContent = (i * 10) + '°C';
            svg.appendChild(text);
        }
        var grid = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        grid.setAttribute('d', gridPath);
        grid.setAttribute('class', 'chart-grid');
        svg.prepend(grid);

        // 动态元素组
        var lineEl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        lineEl.setAttribute('class', 'chart-line');
        svg.appendChild(lineEl);

        var pointsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        svg.appendChild(pointsGroup);

        var toolTip = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        toolTip.setAttribute('class', 'chart-tooltip');
        toolTip.setAttribute('text-anchor', 'middle');
        svg.appendChild(toolTip);

        // 更新这幅画
        function updateChart() {
            // 排序
            points.sort(function(a,b){ return a.t - b.t });
            
            // 更新线
            var pointsStr = points.map(function(pt){ return t2x(pt.t) + ',' + p2y(pt.p); }).join(' ');
            lineEl.setAttribute('points', pointsStr);

            // 更新点圆圈
            pointsGroup.innerHTML = '';
            points.forEach(function(pt, idx) {
                var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                c.setAttribute('cx', t2x(pt.t));
                c.setAttribute('cy', p2y(pt.p));
                c.setAttribute('r', 6);
                c.setAttribute('class', 'chart-point');
                
                // 拖拽逻辑
                c.addEventListener('mousedown', function(e) {
                    e.preventDefault();
                    var startX = e.clientX;
                    var startY = e.clientY;
                    c.classList.add('dragging');

                    function onMove(me) {
                        var svgRect = svg.getBoundingClientRect();
                        // 转换鼠标位置到SVG坐标
                        var relX = me.clientX - svgRect.left;
                        var relY = me.clientY - svgRect.top;
                        
                        // 限制范围
                        var newT = Math.max(0, Math.min(100, x2t(relX)));
                        var newP = Math.max(0, Math.min(255, y2p(relY)));

                        // 约束：不能越过邻居点（保持顺序）
                        if (idx > 0) newT = Math.max(newT, points[idx-1].t + 1);
                        if (idx < points.length - 1) newT = Math.min(newT, points[idx+1].t - 1);

                        pt.t = newT;
                        pt.p = newP;
                        
                        // 实时更新UI
                        updateChart();
                        
                        // 显示数值提示
                        toolTip.setAttribute('x', t2x(newT));
                        toolTip.setAttribute('y', p2y(newP) - 15);
                        toolTip.textContent = newT + '°C : ' + newP;
                    }

                    function onUp() {
                        document.removeEventListener('mousemove', onMove);
                        document.removeEventListener('mouseup', onUp);
                        c.classList.remove('dragging');
                        toolTip.textContent = '';
                        
                        // 拖拽停止时，保存数据到 UCI
                        saveToUCI();
                    }
                    
                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                });

                pointsGroup.appendChild(c);
            });
        }
        
        // 保存逻辑：把 points 数组转回 list curve_point
        function saveToUCI() {
            var newList = points.map(function(pt){ return pt.t + ' ' + pt.p; });
            uci.set('fancontrol', 'settings', 'curve_point', newList);
        }

        // 初始化
        updateChart();
        chartContainer.appendChild(svg);
        
        // 底部说明
        chartContainer.appendChild(E('div', { 'class': 'cbi-section-descr', 'style': 'margin-top:10px;' }, 
            _('Drag the points to adjust the fan speed curve. Left axis is PWM value (0-255), Bottom axis is Temperature (0-100°C).')
        ));
        
        // 下方放置 Save & Apply 按钮组的占位符（LuCI 标准底部按钮会自动处理 UCI 保存）
        container.appendChild(chartContainer);

        // --- 3. 启动定时器更新监控数据 ---
        var timer = window.setInterval(function() {
            Promise.all([
                 L.resolveDefault(callReadFile(uci.get('fancontrol', 'settings', 'thermal_file')), ''),
                 L.resolveDefault(callReadFile(uci.get('fancontrol', 'settings', 'fan_file')), '')
            ]).then(function(res) {
                var tempRaw = parseInt(res[0]);
                var pwmRaw = parseInt(res[1]);
                var t = isNaN(tempRaw) ? 'N/A' : (tempRaw / 1000).toFixed(1) + ' °C';
                var p = isNaN(pwmRaw) ? 'N/A' : pwmRaw;
                
                var elT = document.getElementById('st_temp');
                var elP = document.getElementById('st_pwm');
                var elS = document.getElementById('st_svc');
                
                if(elT) elT.innerText = t;
                if(elP) elP.innerText = p;
                if(elS) {
                    var running = uci.get('fancontrol', 'settings', 'enabled') == '1';
                    elS.innerText = running ? _('Running') : _('Stopped');
                    elS.style.color = running ? 'green' : 'red';
                }
            });
        }, 3000);

        return container;
    },

    handleSaveApply: function (ev, mode) {
        // LuCI 的保存按钮会自动触发 uci.save()，我们已经在 saveToUCI 里 set 过了
        // 这里只需要调用父类的处理
        return this.super('handleSaveApply', arguments);
    }
});