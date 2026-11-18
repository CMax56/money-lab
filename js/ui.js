/* Money Lab — small shared DOM helpers (used by app.js and tools.js). */
(function (global) {
  'use strict';

  var uid = 0;

  function h(tag, props) {
    var node = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v; // only for our own content JSON
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'value') node.value = v;
      else if (k === 'checked') node.checked = !!v;
      else node.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) add(node, arguments[i]);
    return node;
  }

  function add(node, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(node, x); }); return; }
    if (typeof c === 'string' || typeof c === 'number') { node.appendChild(document.createTextNode(String(c))); return; }
    node.appendChild(c);
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  function nextId(p) { uid++; return (p || 'f') + uid; }

  /* Labeled number field with optional $ prefix / % suffix.
   * opts: { value, prefix, suffix, min, max, step, help, oninput, id, placeholder } */
  function numField(label, opts) {
    opts = opts || {};
    var id = opts.id || nextId('n');
    var input = h('input', {
      id: id, type: 'text', inputmode: 'decimal', autocomplete: 'off',
      value: opts.value != null ? String(opts.value) : '', placeholder: opts.placeholder || '',
      'aria-describedby': opts.help ? id + '-help' : null
    });
    if (opts.oninput) input.addEventListener('input', opts.oninput);
    var wrapCls = 'num-wrap' + (opts.prefix ? ' has-pre' : '') + (opts.suffix ? ' has-suf' : '');
    var field = h('div', { class: 'field' + (opts.cls ? ' ' + opts.cls : '') },
      h('label', { for: id }, label),
      h('div', { class: wrapCls },
        opts.prefix ? h('span', { class: 'pre', 'aria-hidden': 'true' }, opts.prefix) : null,
        input,
        opts.suffix ? h('span', { class: 'suf', 'aria-hidden': 'true' }, opts.suffix) : null),
      opts.help ? h('p', { class: 'help', id: id + '-help' }, opts.help) : null);
    field.input = input;
    return field;
  }

  /* Slider + number box kept in sync. opts: { value, min, max, step, prefix, suffix, oninput } */
  function sliderField(label, opts) {
    var id = opts.id || nextId('s');
    var num = h('input', { id: id, type: 'text', inputmode: 'decimal', autocomplete: 'off', value: String(opts.value), class: 'slider-num' });
    var range = h('input', { type: 'range', min: opts.min, max: opts.max, step: opts.step || 1, value: opts.value, 'aria-label': label + ' slider' });
    range.addEventListener('input', function () { num.value = range.value; if (opts.oninput) opts.oninput(); });
    num.addEventListener('input', function () {
      var v = global.Money.num(num.value, NaN);
      if (isFinite(v)) range.value = v;
      if (opts.oninput) opts.oninput();
    });
    var f = h('div', { class: 'field slider-field' },
      h('div', { class: 'slider-top' },
        h('label', { for: id }, label),
        h('div', { class: 'num-wrap small' + (opts.prefix ? ' has-pre' : '') + (opts.suffix ? ' has-suf' : '') },
          opts.prefix ? h('span', { class: 'pre', 'aria-hidden': 'true' }, opts.prefix) : null,
          num,
          opts.suffix ? h('span', { class: 'suf', 'aria-hidden': 'true' }, opts.suffix) : null)),
      range);
    f.input = num;
    f.range = range;
    f.value = function () { return global.Money.num(num.value, 0); };
    f.set = function (v) { num.value = String(v); range.value = v; };
    return f;
  }

  function stat(label, value, cls) {
    return h('div', { class: 'stat' + (cls ? ' ' + cls : '') }, h('strong', null, value), h('span', null, label));
  }

  function msg(kind, text) {
    var icon = { good: '✓', bad: '!', warn: '⚠', info: 'ℹ' }[kind] || '';
    return h('p', { class: 'msg ' + kind }, h('span', { class: 'msg-ic', 'aria-hidden': 'true' }, icon), h('span', { html: text }));
  }

  function plural(n, word, many) { return n + ' ' + (n === 1 ? word : (many || word + 's')); }

  function monthsText(m) {
    if (m < 12) return plural(m, 'month');
    var y = Math.floor(m / 12), r = m % 12;
    return plural(y, 'year') + (r ? ' ' + plural(r, 'month') : '');
  }

  function monthYear(d) { return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); }
  function longDate(d) { return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }

  function reducedMotion() {
    return global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function celebrate(container, text) {
    var b = h('div', { class: 'celebrate', role: 'status' }, h('span', { 'aria-hidden': 'true', class: 'party' }, '🎉'), ' ', text);
    container.appendChild(b);
    if (!reducedMotion()) b.classList.add('pop');
    return b;
  }

  global.UI = {
    h: h, add: add, clear: clear, nextId: nextId, numField: numField, sliderField: sliderField,
    stat: stat, msg: msg, plural: plural, monthsText: monthsText, monthYear: monthYear, longDate: longDate,
    reducedMotion: reducedMotion, celebrate: celebrate
  };
}(window));
