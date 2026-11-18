/* Money Lab — tiny hand-rolled SVG charts (no libraries).
 * Colors come from CSS variables --s1 … --s8 (categorical, fixed order) so
 * light/dark mode is handled in styles.css. Every chart gets an aria-label
 * summary; the app also shows the numbers as text or a table next to it. */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }
  function color(i) { return 'var(--s' + ((i % 8) + 1) + ')'; }

  function wrap(label) {
    var box = document.createElement('div');
    box.className = 'chart';
    var tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    box.appendChild(tip);
    box._tip = tip;
    box._label = label;
    return box;
  }

  function showTip(box, html, x, y) {
    var tip = box._tip;
    tip.innerHTML = html;
    tip.hidden = false;
    var w = box.clientWidth;
    var tw = tip.offsetWidth;
    var left = Math.min(Math.max(4, x - tw / 2), w - tw - 4);
    tip.style.left = left + 'px';
    tip.style.top = Math.max(0, y - tip.offsetHeight - 12) + 'px';
  }
  function hideTip(box) { box._tip.hidden = true; }

  function legend(items) {
    var ul = document.createElement('ul');
    ul.className = 'legend';
    items.forEach(function (it) {
      var li = document.createElement('li');
      var sw = document.createElement('span');
      sw.className = 'sw' + (it.dash ? ' dash' : '');
      sw.style.background = it.dash ? 'none' : color(it.color);
      if (it.dash) sw.style.borderColor = color(it.color);
      li.appendChild(sw);
      li.appendChild(document.createTextNode(it.label));
      ul.appendChild(li);
    });
    return ul;
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* Donut: segments [{ label, value, color }] */
  function donut(segments, opts) {
    opts = opts || {};
    var box = wrap();
    var size = 200, r = 80, sw = 30, cx = 100, cy = 100;
    var svg = el('svg', { viewBox: '0 0 ' + size + ' ' + size, role: 'img', class: 'donut' });
    svg.setAttribute('aria-label', opts.label || 'Donut chart');
    var total = segments.reduce(function (s, x) { return s + Math.max(0, x.value); }, 0);
    el('circle', { cx: cx, cy: cy, r: r, fill: 'none', style: 'stroke:var(--line)', 'stroke-width': sw }, svg);
    var C = 2 * Math.PI * r;
    var acc = 0;
    var gap = segments.filter(function (s) { return s.value > 0; }).length > 1 ? 2 : 0;
    if (total > 0) {
      segments.forEach(function (s) {
        if (!(s.value > 0)) return;
        var len = s.value / total * C;
        var seg = el('circle', {
          cx: cx, cy: cy, r: r, fill: 'none', 'stroke-width': sw,
          style: 'stroke:' + color(s.color),
          'stroke-dasharray': Math.max(0, len - gap) + ' ' + (C - Math.max(0, len - gap)),
          'stroke-dashoffset': -acc, transform: 'rotate(-90 ' + cx + ' ' + cy + ')', class: 'seg'
        }, svg);
        var t = el('title', {}, seg);
        t.textContent = s.label + ': ' + (opts.fmt ? opts.fmt(s.value) : s.value) + ' (' + Math.round(s.value / total * 100) + '%)';
        seg.addEventListener('pointermove', function (e) {
          var b = box.getBoundingClientRect();
          showTip(box, '<b>' + esc(s.label) + '</b><br>' + esc(opts.fmt ? opts.fmt(s.value) : s.value) + ' · ' + Math.round(s.value / total * 100) + '%', e.clientX - b.left, e.clientY - b.top);
        });
        seg.addEventListener('pointerleave', function () { hideTip(box); });
        acc += len;
      });
    }
    if (opts.center) {
      var t1 = el('text', { x: cx, y: opts.sub ? cy + 2 : cy + 8, 'text-anchor': 'middle', class: 'donut-big' }, svg);
      t1.textContent = opts.center;
      if (opts.sub) {
        var t2 = el('text', { x: cx, y: cy + 24, 'text-anchor': 'middle', class: 'donut-sub' }, svg);
        t2.textContent = opts.sub;
      }
    }
    box.appendChild(svg);
    if (opts.legend !== false) {
      box.appendChild(legend(segments.map(function (s) {
        return { label: s.label + (total > 0 ? ' ' + Math.round(Math.max(0, s.value) / total * 100) + '%' : ''), color: s.color };
      })));
    }
    return box;
  }

  // Narrower drawing on phones so 13px labels stay readable after scaling.
  function chartWidth() { return (global.innerWidth || 800) < 560 ? 380 : 600; }

  function niceMax(v) {
    if (!(v > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var steps = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * p >= v) return steps[i] * p;
    return 10 * p;
  }

  function shortMoney(v) {
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(v >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
    return '$' + Math.round(v);
  }

  /* Line chart: series [{ label, values: [y0, y1, ...], color, dash }]
   * x is an index (month). opts: { label, xName, xFmt, fmt, height } */
  function line(series, opts) {
    opts = opts || {};
    var box = wrap();
    var W = chartWidth(), H = opts.height || (W < 600 ? 230 : 260), L = 52, R = 14, T = 14, B = 34;
    var n = 0, maxY = 0;
    series.forEach(function (s) {
      n = Math.max(n, s.values.length);
      s.values.forEach(function (v) { if (v > maxY) maxY = v; });
    });
    maxY = niceMax(maxY);
    var xMax = Math.max(1, n - 1);
    var X = function (i) { return L + (W - L - R) * i / xMax; };
    var Y = function (v) { return T + (H - T - B) * (1 - v / maxY); };
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', class: 'linechart', preserveAspectRatio: 'xMidYMid meet' });
    svg.setAttribute('aria-label', opts.label || 'Line chart');
    // grid + y labels
    for (var g = 0; g <= 4; g++) {
      var v = maxY * g / 4, y = Y(v);
      el('line', { x1: L, x2: W - R, y1: y, y2: y, class: g === 0 ? 'axis' : 'grid' }, svg);
      var tl = el('text', { x: L - 6, y: y + 4, 'text-anchor': 'end', class: 'tick' }, svg);
      tl.textContent = shortMoney(v);
    }
    // x labels (about 6)
    var step = Math.max(1, Math.ceil(xMax / (W < 600 ? 5 : 6)));
    if (opts.xStep) step = opts.xStep(xMax);
    for (var i = 0; i <= xMax; i += step) {
      var xl = el('text', { x: X(i), y: H - B + 18, 'text-anchor': 'middle', class: 'tick' }, svg);
      xl.textContent = opts.xFmt ? opts.xFmt(i) : String(i);
    }
    if (opts.xName) {
      var xn = el('text', { x: W - R, y: H - 2, 'text-anchor': 'end', class: 'tick' }, svg);
      xn.textContent = opts.xName;
    }
    series.forEach(function (s) {
      if (!s.values.length) return;
      var d = s.values.map(function (v, k) { return (k ? 'L' : 'M') + X(k).toFixed(1) + ' ' + Y(v).toFixed(1); }).join(' ');
      el('path', { d: d, fill: 'none', 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        style: 'stroke:' + color(s.color), 'stroke-dasharray': s.dash ? '6 5' : 'none' }, svg);
    });
    // crosshair + tooltip
    var cross = el('line', { x1: 0, x2: 0, y1: T, y2: H - B, class: 'cross', visibility: 'hidden' }, svg);
    var dots = series.map(function (s) { return el('circle', { r: 5, cx: 0, cy: 0, visibility: 'hidden', style: 'fill:' + color(s.color) + ';stroke:var(--card);stroke-width:2' }, svg); });
    var hit = el('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' }, svg);
    function move(e) {
      var b = svg.getBoundingClientRect();
      var sx = (e.clientX - b.left) / b.width * W;
      var k = Math.round((sx - L) / (W - L - R) * xMax);
      k = Math.max(0, Math.min(xMax, k));
      cross.setAttribute('x1', X(k)); cross.setAttribute('x2', X(k)); cross.setAttribute('visibility', 'visible');
      var html = '<b>' + esc(opts.xFmt ? opts.xFmt(k, true) : k) + '</b>';
      series.forEach(function (s, si) {
        var v = s.values[k];
        if (v === undefined) { dots[si].setAttribute('visibility', 'hidden'); return; }
        dots[si].setAttribute('cx', X(k)); dots[si].setAttribute('cy', Y(v)); dots[si].setAttribute('visibility', 'visible');
        html += '<br><span class="tsw" style="background:' + color(s.color) + '"></span>' + esc(s.label) + ': ' + esc(opts.fmt ? opts.fmt(v) : v);
      });
      var bb = box.getBoundingClientRect();
      showTip(box, html, X(k) / W * b.width + (b.left - bb.left), (e.clientY - bb.top));
    }
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', function () {
      cross.setAttribute('visibility', 'hidden');
      dots.forEach(function (d) { d.setAttribute('visibility', 'hidden'); });
      hideTip(box);
    });
    box.appendChild(svg);
    if (series.length > 1) box.appendChild(legend(series.map(function (s) { return { label: s.label, color: s.color, dash: s.dash }; })));
    return box;
  }

  /* Stacked bars: bars [{ label, parts: [a, b] }], names: ['Your deposits', 'Interest'] */
  function stacked(bars, names, opts) {
    opts = opts || {};
    var box = wrap();
    var W = chartWidth(), H = opts.height || (W < 600 ? 230 : 260), L = 52, R = 10, T = 14, B = 34;
    var maxY = niceMax(Math.max.apply(null, bars.map(function (b) { return b.parts.reduce(function (s, x) { return s + x; }, 0); }).concat([0])));
    var Y = function (v) { return T + (H - T - B) * (1 - v / maxY); };
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', class: 'barchart' });
    svg.setAttribute('aria-label', opts.label || 'Bar chart');
    for (var g = 0; g <= 4; g++) {
      var v = maxY * g / 4, y = Y(v);
      el('line', { x1: L, x2: W - R, y1: y, y2: y, class: g === 0 ? 'axis' : 'grid' }, svg);
      var tl = el('text', { x: L - 6, y: y + 4, 'text-anchor': 'end', class: 'tick' }, svg);
      tl.textContent = shortMoney(v);
    }
    var n = bars.length;
    var slot = (W - L - R) / Math.max(1, n);
    var bw = Math.max(3, Math.min(36, slot * 0.7));
    var labelEvery = Math.max(1, Math.ceil(n / (W < 600 ? 6 : 10)));
    bars.forEach(function (b, i) {
      var x = L + slot * i + (slot - bw) / 2;
      var acc = 0;
      var grp = el('g', { class: 'bar' }, svg);
      b.parts.forEach(function (p, pi) {
        if (!(p > 0)) return;
        var y1 = Y(acc + p), y0 = Y(acc);
        var hgt = Math.max(0, y0 - y1 - (acc > 0 ? 2 : 0));
        el('rect', { x: x, y: y1, width: bw, height: hgt, rx: Math.min(3, bw / 3), style: 'fill:' + color(pi) }, grp);
        acc += p;
      });
      var hitR = el('rect', { x: L + slot * i, y: T, width: slot, height: H - T - B, fill: 'transparent' }, grp);
      var show = function (e) {
        var bb = box.getBoundingClientRect(), sb = svg.getBoundingClientRect();
        var html = '<b>' + esc(b.label) + '</b>';
        b.parts.forEach(function (p, pi) { html += '<br><span class="tsw" style="background:' + color(pi) + '"></span>' + esc(names[pi]) + ': ' + esc(opts.fmt ? opts.fmt(p) : p); });
        html += '<br>Total: ' + esc(opts.fmt ? opts.fmt(acc) : acc);
        showTip(box, html, (x + bw / 2) / W * sb.width + (sb.left - bb.left), e.clientY - bb.top);
      };
      hitR.addEventListener('pointermove', show);
      hitR.addEventListener('pointerdown', show);
      hitR.addEventListener('pointerleave', function () { hideTip(box); });
      if (i % labelEvery === 0 || i === n - 1) {
        var xl = el('text', { x: x + bw / 2, y: H - B + 18, 'text-anchor': 'middle', class: 'tick' }, svg);
        xl.textContent = b.short || b.label;
      }
    });
    box.appendChild(svg);
    box.appendChild(legend(names.map(function (nm, i) { return { label: nm, color: i }; })));
    return box;
  }

  /* Horizontal meter: value vs max with a marker line (utilization, budget use) */
  function meter(pct, opts) {
    opts = opts || {};
    var box = document.createElement('div');
    box.className = 'meter' + (opts.cls ? ' ' + opts.cls : '');
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', opts.label || (Math.round(pct) + '%'));
    var fill = document.createElement('span');
    fill.className = 'fill';
    fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
    box.appendChild(fill);
    (opts.marks || []).forEach(function (m) {
      var mk = document.createElement('i');
      mk.className = 'mark';
      mk.style.left = m + '%';
      box.appendChild(mk);
    });
    return box;
  }

  global.Charts = { donut: donut, line: line, stacked: stacked, meter: meter, legend: legend, color: color, shortMoney: shortMoney };
}(window));
