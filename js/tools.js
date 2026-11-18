/* Money Lab — interactive tools. Each tool renders into a container.
 * All money math comes from js/money.js; this file is only UI. */
(function (global) {
  'use strict';

  var M = global.Money, C = global.Charts, U = global.UI;
  var h = U.h, fmt = M.fmt, num = M.num;

  function debounce(fn, ms) {
    var t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms || 250); };
  }
  function live(cls) { return h('div', { class: 'result' + (cls ? ' ' + cls : ''), 'aria-live': 'polite' }); }
  function pct(v) { return (Math.round(v * 10) / 10) + '%'; }

  var GROUPS = [
    { id: 'need', label: 'Needs', color: 0, target: 50 },
    { id: 'want', label: 'Wants', color: 1, target: 30 },
    { id: 'save', label: 'Savings', color: 2, target: 20 }
  ];

  /* ===================== Needs vs Wants sort game ===================== */

  var SORT_ITEMS = [
    { t: 'Groceries for the week', e: '🥦', k: 'need', why: 'You need food to live.' },
    { t: 'Concert tickets', e: '🎤', k: 'want', why: 'Fun, but you can live without it.' },
    { t: 'Gas to drive to your job', e: '⛽', k: 'need', why: 'Getting to work is how you earn money.' },
    { t: 'A new video game', e: '🎮', k: 'want', why: 'Entertainment is a want.' },
    { t: 'Car insurance (you drive)', e: '🚗', k: 'need', why: 'Driving without insurance is illegal in most states.' },
    { t: 'Name-brand hoodie', e: '👕', k: 'want', why: 'Basic clothes are a need; the brand name is a want.' },
    { t: 'Rent', e: '🏠', k: 'need', why: 'A place to live is a need.' },
    { t: 'Streaming subscription', e: '📺', k: 'want', why: 'Nice to have, not necessary.' },
    { t: 'Basic phone plan for work and safety', e: '📱', k: 'need', why: 'Many jobs and families count on reaching you.' },
    { t: 'Newest phone when yours works fine', e: '✨', k: 'want', why: 'Your current phone still does the job.' },
    { t: 'Medicine your doctor prescribed', e: '💊', k: 'need', why: 'Health comes first.' },
    { t: 'Eating out with friends', e: '🍔', k: 'want', why: 'Food is a need, but restaurant food with friends is a want.' },
    { t: 'Winter coat (you don\'t have one)', e: '🧥', k: 'need', why: 'Staying warm and safe is a need.' },
    { t: 'Fancy coffee drinks', e: '🧋', k: 'want', why: 'Tasty, but optional.' },
    { t: 'Bus pass to get to school', e: '🚌', k: 'need', why: 'Transportation to school is a need.' },
    { t: 'Limited-edition sneakers', e: '👟', k: 'want', why: 'Shoes are a need; limited editions are a want.' }
  ];

  function sortGame(box) {
    var items, i, score, sorted;
    var stage = h('div', { class: 'sort-stage' });
    var fb = live();
    var bins = {};
    function makeBin(kind, label, icon) {
      var list = h('ul', { class: 'bin-list', 'aria-label': label + ' sorted so far' });
      var btn = h('button', { class: 'bin bin-' + kind, type: 'button', 'data-kind': kind, onclick: function () { choose(kind); } },
        h('span', { class: 'bin-ic', 'aria-hidden': 'true' }, icon), h('span', { class: 'bin-label' }, 'It\'s a ' + label.slice(0, -1).toLowerCase()));
      bins[kind] = { btn: btn, list: list };
      return h('div', { class: 'bin-col' }, btn, list);
    }
    var binRow = h('div', { class: 'bins' }, makeBin('need', 'Needs', '🧱'), makeBin('want', 'Wants', '🎁'));

    function start() {
      items = SORT_ITEMS.slice().sort(function () { return Math.random() - 0.5; }).slice(0, 10);
      i = 0; score = 0; sorted = [];
      bins.need.list.innerHTML = ''; bins.want.list.innerHTML = '';
      U.clear(fb);
      showItem();
    }
    function showItem() {
      U.clear(stage);
      if (i >= items.length) {
        global.Store.recordGame('sort', score);
        stage.appendChild(h('div', { class: 'sort-done' },
          h('p', { class: 'big-score' }, score + ' / ' + items.length),
          h('p', null, score === items.length ? 'Perfect! You know your needs from your wants.' : 'Nice work. Read the reasons above for the ones you missed.'),
          h('button', { class: 'btn primary', type: 'button', onclick: start }, 'Play again')));
        bins.need.btn.disabled = bins.want.btn.disabled = true;
        return;
      }
      bins.need.btn.disabled = bins.want.btn.disabled = false;
      var it = items[i];
      var card = h('div', { class: 'sort-card', draggable: 'true', tabindex: '0', 'aria-label': 'Item ' + (i + 1) + ' of ' + items.length + ': ' + it.t },
        h('span', { class: 'sort-emoji', 'aria-hidden': 'true' }, it.e), h('span', null, it.t));
      enableDrag(card);
      stage.appendChild(h('p', { class: 'muted small center' }, 'Item ' + (i + 1) + ' of ' + items.length + ' · Tap a button below (or drag the card onto it)'));
      stage.appendChild(card);
    }
    function choose(kind) {
      if (i >= items.length) return;
      var it = items[i];
      var ok = it.k === kind;
      if (ok) score++;
      bins[it.k].list.appendChild(h('li', { class: ok ? 'ok' : 'miss' }, h('span', { 'aria-hidden': 'true' }, it.e + ' '), it.t, ok ? '' : ' (moved here)'));
      U.clear(fb).appendChild(U.msg(ok ? 'good' : 'bad', (ok ? '<b>Right!</b> ' : '<b>Not quite.</b> “' + it.t + '” is a <b>' + it.k + '</b>. ') + it.why));
      i++;
      showItem();
    }
    // Pointer-based drag (works for mouse and touch)
    function enableDrag(card) {
      var startX, startY, dragging = false;
      card.addEventListener('dragstart', function (e) { e.preventDefault(); });
      card.addEventListener('pointerdown', function (e) {
        startX = e.clientX; startY = e.clientY; dragging = true;
        card.setPointerCapture(e.pointerId);
        card.classList.add('dragging');
      });
      card.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        card.style.transform = 'translate(' + (e.clientX - startX) + 'px,' + (e.clientY - startY) + 'px)';
        hoverBin(e.clientX, e.clientY);
      });
      function end(e) {
        if (!dragging) return;
        dragging = false;
        card.classList.remove('dragging');
        card.style.transform = '';
        var k = hoverBin(e.clientX, e.clientY);
        Object.keys(bins).forEach(function (b) { bins[b].btn.classList.remove('over'); });
        if (k) choose(k);
      }
      card.addEventListener('pointerup', end);
      card.addEventListener('pointercancel', end);
      card.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowLeft' || e.key === 'n' || e.key === 'N') choose('need');
        if (e.key === 'ArrowRight' || e.key === 'w' || e.key === 'W') choose('want');
      });
    }
    function hoverBin(x, y) {
      var found = null;
      Object.keys(bins).forEach(function (k) {
        var r = bins[k].btn.getBoundingClientRect();
        var inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        bins[k].btn.classList.toggle('over', inside);
        if (inside) found = k;
      });
      return found;
    }
    box.appendChild(h('p', null, 'Is it a need or a want? Sort 10 everyday things. Keyboard: focus the card, then press ← for Need or → for Want.'));
    box.appendChild(stage);
    box.appendChild(binRow);
    box.appendChild(fb);
    start();
  }

  /* ===================== Paycheck calculator ===================== */

  var RATE_LABELS = { federal: 'Federal income tax', state: 'State income tax', socialSecurity: 'Social Security', medicare: 'Medicare' };

  function paycheckTool(box) {
    var out = live();
    var fHourly = U.numField('Hourly wage', { value: 15, prefix: '$', oninput: update });
    var fHours = U.numField('Hours worked this pay period', { value: 20, oninput: update });
    var rateFields = {};
    var rateBox = h('div', { class: 'grid2' });
    Object.keys(M.EXAMPLE_RATES).forEach(function (k) {
      rateFields[k] = U.numField(RATE_LABELS[k], { value: M.EXAMPLE_RATES[k], suffix: '%', oninput: update });
      rateBox.appendChild(rateFields[k]);
    });
    function update() {
      var rates = {};
      Object.keys(rateFields).forEach(function (k) { rates[k] = num(rateFields[k].input.value); });
      var r = M.paycheck({ hourly: fHourly.input.value, hours: fHours.input.value, rates: rates });
      U.clear(out);
      if (r.overLimit) {
        out.appendChild(U.msg('warn', '<b>Your rates add up to ' + pct(r.ratesTotal) + ', more than 100%.</b> Nothing can take out more than your whole paycheck, so the amounts below stop at your gross pay and take-home is ' + fmt(r.net) + '. Check the rates.'));
      }
      out.appendChild(h('div', { class: 'stats' },
        U.stat('Gross pay', fmt(r.gross)), U.stat('Taken out', fmt(r.withheld)), U.stat('Net (take-home)', fmt(r.net), 'hi')));
      var rows = r.lines.map(function (l) {
        return h('tr', null, h('td', null, RATE_LABELS[l.key]), h('td', null, l.pct + '%'), h('td', { class: 'num' }, '−' + fmt(l.amount)));
      });
      out.appendChild(h('div', { class: 'stub' },
        h('h3', null, 'Your example pay stub'),
        h('table', { class: 'tbl' },
          h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Item'), h('th', { scope: 'col' }, 'Rate'), h('th', { scope: 'col', class: 'num' }, 'Amount'))),
          h('tbody', null,
            h('tr', null, h('td', null, h('b', null, 'Gross pay')), h('td', null, ''), h('td', { class: 'num' }, h('b', null, fmt(r.gross)))),
            rows,
            h('tr', { class: 'total' }, h('td', null, 'Net pay'), h('td', null, ''), h('td', { class: 'num' }, fmt(r.net)))))));
      if (r.gross > 0) {
        out.appendChild(C.donut(
          [{ label: 'Take-home', value: r.net, color: 2 }].concat(r.lines.map(function (l, i) { return { label: RATE_LABELS[l.key], value: l.amount, color: [1, 3, 6, 4][i] }; })),
          { center: fmt(r.net, { noCents: true }), sub: 'take-home', fmt: fmt, label: 'Where your gross pay goes: ' + fmt(r.net) + ' take-home out of ' + fmt(r.gross) }));
        out.appendChild(h('p', { class: 'muted small' }, 'You keep about ' + Math.round(r.net / r.gross * 100) + '¢ of every dollar you earn here.'));
      }
    }
    box.appendChild(h('p', null, 'See how gross pay turns into take-home pay.'));
    box.appendChild(h('div', { class: 'grid2' }, fHourly, fHours));
    box.appendChild(h('details', { class: 'more' },
      h('summary', null, 'Change the tax rates'),
      h('p', { class: 'help' }, 'Social Security (6.2%) and Medicare (1.45%) are the real rates. The federal and state percentages are simple examples; real income tax depends on how much you earn, where you live, and your W-4. Many teens get some of it back as a refund.'),
      rateBox));
    box.appendChild(U.msg('info', '<b>Example rates only.</b> Federal 10% and state 4% are made-up round numbers for learning.'));
    box.appendChild(out);
    update();
  }

  /* ===================== Budget builder ===================== */

  var DEFAULT_BUDGET = {
    income: 600,
    cats: [
      { name: 'Phone bill', group: 'need', amount: 40 },
      { name: 'Gas', group: 'need', amount: 50 },
      { name: 'Eating out', group: 'want', amount: 60 },
      { name: 'Fun money', group: 'want', amount: 50 },
      { name: 'Savings', group: 'save', amount: 100 }
    ]
  };

  function budgetTool(box, ctx) {
    var S = global.Store.state;
    var data = JSON.parse(JSON.stringify(S.budget || DEFAULT_BUDGET));
    var samples = (ctx.section && ctx.section.samples) || [];
    var save = debounce(function () { S.budget = data; global.Store.save(); }, 300);

    var incomeF = U.numField('Monthly take-home pay (net income)', { value: data.income, prefix: '$', oninput: function () { data.income = num(incomeF.input.value); syncMax(); update(); } });
    var rowsBox = h('div', { class: 'cat-rows' });
    var out = live('budget-out');
    var sticky = h('div', { class: 'sticky-sum', 'aria-hidden': 'true' });
    var rowRefs = [];

    function syncMax() {
      rowRefs.forEach(function (r) { r.range.max = String(Math.max(50, Math.ceil(data.income / 5) * 5, Math.ceil(num(r.cat.amount) / 5) * 5)); });
    }

    function catRow(cat, idx) {
      var nameId = U.nextId('c'), amtId = U.nextId('a'), grpId = U.nextId('g');
      var name = h('input', { id: nameId, type: 'text', value: cat.name, maxlength: '40', class: 'cat-name', oninput: function () { cat.name = name.value; update(); } });
      var grp = h('select', { id: grpId, class: 'cat-group', onchange: function () { cat.group = grp.value; row.dataset.group = cat.group; update(); } },
        GROUPS.map(function (g) { return h('option', { value: g.id, selected: cat.group === g.id ? 'selected' : null }, g.label.replace(/s$/, '').replace('Saving', 'Savings')); }));
      var amt = h('input', { id: amtId, type: 'text', inputmode: 'decimal', value: String(cat.amount), class: 'cat-amt', autocomplete: 'off' });
      var range = h('input', { type: 'range', min: 0, step: 5, value: num(cat.amount), 'aria-label': (cat.name || 'Category') + ' amount slider' });
      amt.addEventListener('input', function () { cat.amount = num(amt.value); range.value = cat.amount; update(); });
      range.addEventListener('input', function () { cat.amount = num(range.value); amt.value = range.value; update(); });
      var del = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remove ' + (cat.name || 'category'), onclick: function () { data.cats.splice(idx, 1); buildRows(); update(); } }, '✕');
      var row = h('div', { class: 'cat-row', 'data-group': cat.group },
        h('div', { class: 'cat-line' },
          h('label', { class: 'sr-only', for: nameId }, 'Category name'), name,
          h('label', { class: 'sr-only', for: grpId }, 'Type'), grp,
          del),
        h('div', { class: 'cat-line' },
          range,
          h('div', { class: 'num-wrap small has-pre' }, h('span', { class: 'pre', 'aria-hidden': 'true' }, '$'),
            h('label', { class: 'sr-only', for: amtId }, (cat.name || 'Category') + ' amount'), amt)));
      rowRefs.push({ cat: cat, range: range, amt: amt });
      return row;
    }

    function buildRows() {
      U.clear(rowsBox); rowRefs = [];
      data.cats.forEach(function (c, i) { rowsBox.appendChild(catRow(c, i)); });
      syncMax();
    }

    function apply503020() {
      var t = M.split503020(data.income);
      var tgt = { need: t.needs, want: t.wants, save: t.savings };
      GROUPS.forEach(function (g) {
        var cats = data.cats.filter(function (c) { return c.group === g.id; });
        var sum = cats.reduce(function (s, c) { return s + num(c.amount); }, 0);
        if (!cats.length) { data.cats.push({ name: g.label, group: g.id, amount: tgt[g.id] }); return; }
        if (sum <= 0) { cats.forEach(function (c) { c.amount = 0; }); cats[0].amount = tgt[g.id]; return; }
        var left = tgt[g.id];
        cats.forEach(function (c, i) {
          if (i === cats.length - 1) c.amount = M.round2(left);
          else { c.amount = M.round2(num(c.amount) * tgt[g.id] / sum); left -= c.amount; }
        });
      });
      buildRows(); update();
      announce('Applied 50/30/20: each group was scaled to its target.');
    }

    var note = h('p', { class: 'sr-only', 'aria-live': 'polite' });
    function announce(t) { note.textContent = t; }

    function update() {
      var s = M.budgetSummary(data.income, data.cats);
      U.clear(out);
      var remCls = s.over ? 'bad' : (s.remaining > 0 ? 'hi' : '');
      U.clear(sticky).appendChild(h('span', null, 'Planned ', h('b', null, fmt(s.total)), ' of ', fmt(s.income)));
      sticky.appendChild(h('span', { class: 'pill ' + (s.over ? 'bad' : 'ok') }, s.over ? 'Over by ' + fmt(-s.remaining) : fmt(s.remaining) + ' left'));
      sticky.className = 'sticky-sum' + (s.over ? ' over' : '');
      out.appendChild(h('div', { class: 'stats' },
        U.stat('Income', fmt(s.income)), U.stat('Planned', fmt(s.total)),
        U.stat(s.over ? 'Over budget' : 'Left to plan', fmt(Math.abs(s.remaining)), remCls)));
      var segs = GROUPS.map(function (g) { return { label: g.label, value: s.groups[g.id].amount, color: g.color }; });
      if (!s.over && s.remaining > 0) segs.push({ label: 'Not planned yet', value: s.remaining, color: 7 });
      var chartRow = h('div', { class: 'chart-row' });
      chartRow.appendChild(C.donut(segs, {
        center: s.over ? '−' + fmt(-s.remaining, { noCents: true }) : fmt(s.remaining, { noCents: true }),
        sub: s.over ? 'over budget' : 'left', fmt: fmt,
        label: 'Budget split: needs ' + fmt(s.groups.need.amount) + ', wants ' + fmt(s.groups.want.amount) + ', savings ' + fmt(s.groups.save.amount) + ', ' + (s.over ? 'over by ' + fmt(-s.remaining) : 'left ' + fmt(s.remaining))
      }));
      // Actual vs 50/30/20 target, as meters
      var cmp = h('div', { class: 'cmp' }, h('h3', null, 'You vs. 50/30/20'));
      GROUPS.forEach(function (g) {
        var a = s.groups[g.id];
        var diff = a.pct - g.target;
        cmp.appendChild(h('div', { class: 'cmp-row' },
          h('div', { class: 'row-between' },
            h('span', null, h('span', { class: 'sw', style: 'background:var(--s' + (g.color + 1) + ')' }), ' ', h('b', null, g.label)),
            h('span', { class: 'small' }, pct(a.pct) + ' · goal ' + g.target + '%')),
          C.meter(a.pct, { marks: [g.target], label: g.label + ' ' + pct(a.pct) + ' of income, goal ' + g.target + '%', cls: 'g-' + g.id }),
          Math.abs(diff) >= 1 && s.income > 0 ? h('p', { class: 'help' }, (diff > 0 ? 'Over the goal by ' : 'Under the goal by ') + fmt(Math.abs(a.amount - s.income * g.target / 100))) : null));
      });
      chartRow.appendChild(cmp);
      out.appendChild(chartRow);
      // Warnings
      if (s.income <= 0) out.appendChild(U.msg('warn', 'Enter your monthly take-home pay to start.'));
      else if (s.over) out.appendChild(U.msg('bad', '<b>Over budget by ' + fmt(-s.remaining) + '.</b> Lower some wants, or find more income. Don\'t plan to cover it with a credit card.'));
      else if (s.remaining > 0.004) out.appendChild(U.msg('info', 'You have <b>' + fmt(s.remaining) + '</b> without a job yet. Give it one: savings is a great choice.'));
      else out.appendChild(U.msg('good', '<b>Every dollar has a job.</b> That\'s a zero-based budget.'));
      if (s.income > 0 && s.groups.save.pct < 10) out.appendChild(U.msg('warn', 'Savings is under 10%. Even a small amount each month builds the habit.'));
      if (s.income > 0 && s.groups.need.pct > 60) out.appendChild(U.msg('warn', 'Needs are over 60% of income. Look for a cheaper phone plan, a roommate, or other ways to lower fixed costs.'));
      if (s.income > 0) out.appendChild(h('p', { class: 'help' }, '50/30/20 and these warnings are guides, not rules. Your situation can be different, and that\'s OK.'));
      save();
    }

    box.appendChild(h('p', null, 'Enter your monthly take-home pay, then give every dollar a job. Drag the sliders or type amounts.'));
    if (samples.length) {
      box.appendChild(h('div', { class: 'samples' },
        h('p', { class: 'small muted' }, 'Start from a sample budget:'),
        h('div', { class: 'btn-row' }, samples.map(function (sm) {
          return h('button', { class: 'btn ghost small', type: 'button', title: sm.note, onclick: function () {
            data = JSON.parse(JSON.stringify({ income: sm.income, cats: sm.cats }));
            incomeF.input.value = String(data.income);
            buildRows(); update();
            announce('Loaded sample: ' + sm.name + '. ' + sm.note);
            sampleNote.textContent = sm.name + ': ' + sm.note;
          } }, sm.name);
        }))));
    }
    var sampleNote = h('p', { class: 'help' });
    box.appendChild(sampleNote);
    box.appendChild(incomeF);
    box.appendChild(h('h3', null, 'Categories'));
    box.appendChild(rowsBox);
    box.appendChild(sticky);
    box.appendChild(h('div', { class: 'btn-row' },
      h('button', { class: 'btn secondary', type: 'button', onclick: function () {
        data.cats.push({ name: 'New category', group: 'want', amount: 0 });
        buildRows(); update();
        var last = rowsBox.querySelector('.cat-row:last-child .cat-name');
        if (last) { last.focus(); last.select(); }
      } }, '+ Add category'),
      h('button', { class: 'btn primary', type: 'button', onclick: apply503020 }, 'Apply 50/30/20'),
      h('button', { class: 'btn ghost', type: 'button', onclick: function () {
        data = JSON.parse(JSON.stringify(DEFAULT_BUDGET)); incomeF.input.value = String(data.income); sampleNote.textContent = '';
        buildRows(); update(); announce('Budget reset to the starter example.');
      } }, 'Start over')));
    box.appendChild(note);
    box.appendChild(out);
    buildRows();
    update();
  }

  /* ===================== Savings goals ===================== */

  function goalsTool(box) {
    var S = global.Store.state;
    var list = h('div', { class: 'goal-list' });
    var preview = live();
    var fName = h('input', { id: U.nextId('gn'), type: 'text', maxlength: '40', value: 'New headphones' });
    var fGoal = U.numField('Goal amount', { value: 300, prefix: '$', oninput: prev });
    var fSaved = U.numField('Already saved', { value: 40, prefix: '$', oninput: prev });
    var fWeek = U.numField('Saving per week', { value: 20, prefix: '$', oninput: prev });

    function describe(g) {
      var w = M.goalWeeks(g.goal, g.saved, g.perWeek);
      if (w === 0) return { w: 0, text: 'Goal reached! 🎉' };
      if (w === null) return { w: null, text: 'Add a weekly amount to see when you\'ll get there.' };
      var d = M.addDays(new Date(), w * 7);
      return { w: w, text: U.plural(w, 'week') + ' to go · about ' + U.longDate(d) };
    }
    function prev() {
      var g = { goal: num(fGoal.input.value), saved: num(fSaved.input.value), perWeek: num(fWeek.input.value) };
      var d = describe(g);
      U.clear(preview);
      if (d.w) preview.appendChild(h('p', null, '(' + fmt(g.goal) + ' − ' + fmt(g.saved) + ') ÷ ' + fmt(g.perWeek) + ' per week = ', h('b', null, U.plural(d.w, 'week')), ' (rounded up). That\'s about ', h('b', null, U.longDate(M.addDays(new Date(), d.w * 7))), '.'));
      else preview.appendChild(h('p', null, d.text));
    }
    function renderList() {
      U.clear(list);
      if (!S.goals.length) { list.appendChild(h('p', { class: 'muted' }, 'No saved goals yet. Add one below.')); return; }
      S.goals.forEach(function (g, idx) {
        var p = g.goal > 0 ? Math.min(100, g.saved / g.goal * 100) : 0;
        var d = describe(g);
        var addId = U.nextId('ga');
        var addIn = h('input', { id: addId, type: 'text', inputmode: 'decimal', value: g.perWeek ? String(g.perWeek) : '', autocomplete: 'off' });
        list.appendChild(h('div', { class: 'goal card' },
          h('div', { class: 'row-between' }, h('h3', null, g.name), h('span', { class: 'badge' }, Math.round(p) + '%')),
          C.meter(p, { label: g.name + ': ' + Math.round(p) + '% saved', cls: 'g-save' }),
          h('p', null, h('b', null, fmt(g.saved)), ' of ', fmt(g.goal), ' · ', fmt(g.perWeek), '/week'),
          h('p', { class: d.w === 0 ? 'good-text' : 'muted' }, d.text),
          h('div', { class: 'add-money' },
            h('label', { for: addId, class: 'small' }, 'Add money'),
            h('div', { class: 'num-wrap small has-pre' }, h('span', { class: 'pre', 'aria-hidden': 'true' }, '$'), addIn),
            h('button', { class: 'btn secondary small', type: 'button', onclick: function () {
              var a = num(addIn.value);
              if (a > 0) {
                var was = g.saved < g.goal;
                g.saved = M.round2(g.saved + a); global.Store.save(); renderList();
                if (was && g.saved >= g.goal) U.celebrate(list, 'You reached your goal: ' + g.name + '!');
              }
            } }, 'Add'),
            h('button', { class: 'btn ghost small danger', type: 'button', 'aria-label': 'Delete goal ' + g.name, onclick: function () {
              if (global.confirm('Delete the goal “' + g.name + '”?')) { S.goals.splice(idx, 1); global.Store.save(); renderList(); }
            } }, 'Delete'))));
      });
    }
    var nameLbl = h('label', { for: fName.id }, 'What are you saving for?');
    box.appendChild(h('p', null, 'Set a goal, see how many weeks it takes, and track your progress. Goals are saved on this device.'));
    box.appendChild(list);
    box.appendChild(h('div', { class: 'card inset' },
      h('h3', null, 'New goal'),
      h('div', { class: 'field' }, nameLbl, fName),
      h('div', { class: 'grid3' }, fGoal, fSaved, fWeek),
      preview,
      h('button', { class: 'btn primary', type: 'button', onclick: function () {
        var g = { id: 'g' + Date.now(), name: (fName.value || 'My goal').trim().slice(0, 40), goal: Math.max(0, num(fGoal.input.value)), saved: Math.max(0, num(fSaved.input.value)), perWeek: Math.max(0, num(fWeek.input.value)) };
        if (!(g.goal > 0)) { U.clear(preview).appendChild(U.msg('bad', 'Enter a goal amount bigger than $0.')); return; }
        S.goals.push(g); global.Store.save(); renderList();
      } }, 'Save goal')));
    renderList();
    prev();
  }

  /* ===================== Compound interest ===================== */

  function compoundTool(box) {
    var out = live();
    var fStart = U.numField('Starting amount', { value: 500, prefix: '$', oninput: update });
    var fMonthly = U.numField('Deposit every month', { value: 50, prefix: '$', oninput: update });
    var fRate = U.sliderField('Interest rate (per year)', { value: 5, min: 0, max: 12, step: 0.5, suffix: '%', oninput: update });
    var fYears = U.sliderField('Years', { value: 20, min: 1, max: 50, step: 1, oninput: update });
    function update() {
      var years = Math.max(1, Math.min(60, Math.round(fYears.value())));
      var r = M.compound({ start: fStart.input.value, monthly: fMonthly.input.value, rate: fRate.value(), years: years });
      U.clear(out);
      out.appendChild(h('div', { class: 'stats' },
        U.stat('After ' + U.plural(years, 'year'), fmt(r.final), 'hi'), U.stat('You put in', fmt(r.contributions)), U.stat('Interest earned', fmt(r.interest))));
      var bars = r.rows.filter(function (x) { return x.year > 0; }).map(function (x) {
        return { label: 'Year ' + x.year, short: String(x.year), parts: [x.contributions, Math.max(0, x.interest)] };
      });
      out.appendChild(C.stacked(bars, ['Your deposits', 'Interest earned'], {
        fmt: fmt, label: 'Balance by year. After ' + years + ' years: ' + fmt(r.final) + ', of which ' + fmt(r.interest) + ' is interest.'
      }));
      if (r.final > 0) out.appendChild(h('p', null, 'Interest makes up ', h('b', null, Math.round(Math.max(0, r.interest) / r.final * 100) + '%'), ' of your final balance. Try adding 10 more years and watch the orange part grow.'));
    }
    box.appendChild(h('p', null, 'See how money grows when interest earns interest.'));
    box.appendChild(h('div', { class: 'grid2' }, fStart, fMonthly));
    box.appendChild(fRate);
    box.appendChild(fYears);
    box.appendChild(out);
    box.appendChild(h('p', { class: 'help' }, 'How it\'s calculated: interest is compounded monthly (yearly rate ÷ 12 each month), and your deposit is added at the end of each month. Real accounts and investments can earn more or less, and rates change.'));
    update();
  }

  /* ===================== Checking vs savings / debit vs credit ===================== */

  function compareTool(box) {
    function table(title, a, b, rows) {
      return h('div', { class: 'card inset' },
        h('h3', null, title),
        h('div', { class: 'table-wrap' }, h('table', { class: 'tbl compare' },
          h('thead', null, h('tr', null, h('th', { scope: 'col' }, ''), h('th', { scope: 'col' }, a), h('th', { scope: 'col' }, b))),
          h('tbody', null, rows.map(function (r) { return h('tr', null, h('th', { scope: 'row' }, r[0]), h('td', null, r[1]), h('td', null, r[2])); })))));
    }
    box.appendChild(h('p', null, 'Side-by-side comparisons. Scroll the table sideways on small screens if needed.'));
    box.appendChild(table('Checking vs. savings', '🧾 Checking', '🐷 Savings', [
      ['Used for', 'Everyday spending and bills', 'Goals and emergencies'],
      ['Card', 'Debit card', 'Usually none'],
      ['Interest', 'Little or none', 'Yes (more in high-yield)'],
      ['Easy to spend?', 'Very', 'On purpose, a bit harder'],
      ['Watch out for', 'Overdraft fees', 'Withdrawal limits at some banks']
    ]));
    box.appendChild(table('Debit card vs. credit card', '🏧 Debit', '💳 Credit', [
      ['Whose money?', 'Yours, from checking', 'The bank\'s (a loan)'],
      ['Interest', 'None', 'Yes, if you don\'t pay in full'],
      ['Builds credit score?', 'No', 'Yes, when paid on time'],
      ['Fraud protection', 'Good, but money leaves your account first', 'Stronger: it\'s the bank\'s money at risk'],
      ['Biggest risk', 'Overdraft fees', 'Debt that grows with interest'],
      ['Best habit', 'Check balance before buying', 'Pay the full statement every month']
    ]));
  }

  /* ===================== Checking account / overdraft simulator ===================== */

  function accountTool(box) {
    var FEE = 35;
    var bal, log, coverage = true, fees;
    var out = live();
    var logBox = h('ol', { class: 'log', reversed: true });
    var balView = h('div', { class: 'balance' });
    var cov = h('input', { type: 'checkbox', id: U.nextId('cv'), checked: true, onchange: function () { coverage = cov.checked; } });
    var buys = [
      { t: 'Snack', e: '🍫', a: 4 }, { t: 'Movie ticket', e: '🎬', a: 15 }, { t: 'Gas', e: '⛽', a: 35 },
      { t: 'New game', e: '🎮', a: 60 }, { t: 'Phone bill', e: '📱', a: 45 }
    ];
    function reset() { bal = 60; fees = 0; log = []; render(); U.clear(out); }
    function spend(b) {
      if (bal - b.a < 0) {
        if (!coverage) {
          log.push({ t: b.e + ' ' + b.t + ' declined (not enough money)', a: 0, cls: 'warn' });
          U.clear(out).appendChild(U.msg('warn', 'Declined. Overdraft coverage is off, so the bank said no. Awkward, but it cost you <b>$0</b>.'));
          render(); return;
        }
        bal -= b.a; log.push({ t: b.e + ' ' + b.t, a: -b.a });
        bal -= FEE; fees += FEE; log.push({ t: '⚠ Overdraft fee', a: -FEE, cls: 'bad' });
        U.clear(out).appendChild(U.msg('bad', 'Overdraft! The bank covered your ' + fmt(b.a) + ' ' + b.t.toLowerCase() + ', then charged a <b>' + fmt(FEE) + ' fee</b>. Total fees so far: ' + fmt(fees) + '.'));
      } else {
        bal -= b.a; log.push({ t: b.e + ' ' + b.t, a: -b.a });
        U.clear(out).appendChild(U.msg(bal < 20 ? 'warn' : 'good', bal < 20 ? 'Low balance: ' + fmt(bal) + '. A low-balance alert would ping you now.' : 'Paid. Balance: ' + fmt(bal) + '.'));
      }
      render();
    }
    function deposit() {
      bal += 150; log.push({ t: '💵 Paycheck deposit', a: 150 });
      U.clear(out).appendChild(U.msg('good', 'Payday! +' + fmt(150) + '.' + (bal < 0 ? ' You still owe the bank ' + fmt(-bal) + '.' : '')));
      render();
    }
    function render() {
      U.clear(balView).appendChild(h('div', { class: bal < 0 ? 'neg' : '' }, h('span', { class: 'small muted' }, 'Checking balance'), h('strong', null, fmt(bal)), fees ? h('span', { class: 'small bad-text' }, 'Fees paid: ' + fmt(fees)) : null));
      U.clear(logBox);
      log.slice().reverse().forEach(function (l) {
        logBox.appendChild(h('li', { class: l.cls || '' }, h('span', null, l.t), h('span', { class: 'num' }, l.a ? (l.a > 0 ? '+' : '') + fmt(l.a) : '')));
      });
    }
    box.appendChild(h('p', null, 'You start with ' + fmt(60) + ' in checking. Spend it and see what happens when you run out. (The ' + fmt(FEE) + ' fee is a typical example; banks differ.)'));
    box.appendChild(balView);
    box.appendChild(h('div', { class: 'buy-grid' }, buys.map(function (b) {
      return h('button', { class: 'btn ghost buy', type: 'button', onclick: function () { spend(b); } }, h('span', { 'aria-hidden': 'true' }, b.e), ' ' + b.t + ' ' + fmt(b.a, { noCents: true }));
    }), h('button', { class: 'btn secondary buy', type: 'button', onclick: deposit }, h('span', { 'aria-hidden': 'true' }, '💵'), ' Payday +$150')));
    box.appendChild(h('div', { class: 'toggle' }, cov, h('label', { for: cov.id }, 'Overdraft coverage is ON (bank covers purchases and charges a fee)')));
    box.appendChild(out);
    box.appendChild(h('h3', null, 'Activity'));
    box.appendChild(logBox);
    box.appendChild(h('button', { class: 'btn ghost small', type: 'button', onclick: reset }, 'Start over'));
    reset();
  }

  /* ===================== Credit card interest simulator ===================== */

  function cardSimTool(box) {
    var out = live();
    var fBal = U.numField('Card balance', { value: 2000, prefix: '$', oninput: update });
    var fApr = U.sliderField('APR (interest per year)', { value: 24, min: 0, max: 36, step: 0.5, suffix: '%', oninput: update });
    var fPay = U.numField('Monthly payment', { value: 100, prefix: '$', oninput: update });
    var name = U.nextId('mode');
    var mode = 'fixed';
    function radio(val, label) {
      var id = U.nextId('r');
      var r = h('input', { type: 'radio', name: name, id: id, value: val, checked: val === mode, onchange: function () { mode = val; fPay.hidden = mode !== 'fixed'; update(); } });
      return h('div', { class: 'seg-opt' }, r, h('label', { for: id }, label));
    }
    function update() {
      var bal = Math.max(0, num(fBal.input.value)), apr = fApr.value(), pay = num(fPay.input.value);
      var r = M.payoff({ balance: bal, apr: apr, payment: pay, mode: mode });
      var minR = M.payoff({ balance: bal, apr: apr, mode: 'minimum' });
      U.clear(out);
      if (bal <= 0) { out.appendChild(U.msg('good', 'No balance, no interest. 🎉')); return; }
      out.appendChild(h('p', { class: 'small muted' }, 'This month\'s interest: ' + fmt(bal) + ' × ' + apr + '% ÷ 12 = ', h('b', null, fmt(r.firstInterest)), '.'));
      if (r.status === 'payment-too-small') {
        out.appendChild(U.msg('bad', mode === 'minimum'
          ? '<b>This minimum never pays it off.</b> It only covers the interest, so the balance never goes down. Pay more than the ' + fmt(r.firstInterest) + ' of interest each month.'
          : '<b>This payment never pays it off.</b> ' + fmt(pay) + ' doesn\'t cover the ' + fmt(r.firstInterest) + ' of interest added each month, so the balance never goes down (or it grows). Pay more than ' + fmt(r.firstInterest) + '.'));
        return;
      }
      if (r.status === 'hit-limit') {
        out.appendChild(U.msg('bad', '<b>Still not paid off after ' + M.MAX_MONTHS / 12 + ' years.</b> Your payment is shrinking the balance, just very slowly: ' + fmt(r.balanceLeft) + ' would still be left after ' + M.MAX_MONTHS + ' months. Paying even a little more each month makes a big difference.'));
        return;
      }
      out.appendChild(h('div', { class: 'stats' },
        U.stat('Time to pay off', U.monthsText(r.months), 'hi'), U.stat('Total interest', fmt(r.totalInterest), r.totalInterest > bal * 0.5 ? 'bad' : ''), U.stat('Total paid', fmt(r.totalPaid))));
      if (mode === 'minimum') {
        out.appendChild(U.msg('warn', 'First minimum payment: <b>' + fmt(r.firstPayment) + '</b>. As the balance shrinks the minimum shrinks too, which is why it takes so long. Interest is <b>' + Math.round(r.totalInterest / bal * 100) + '%</b> of what you originally owed.'));
      } else if (!minR.neverPaysOff && minR.totalInterest > r.totalInterest + 0.005) {
        out.appendChild(U.msg('good', 'Compared to paying only the minimum (' + U.monthsText(minR.months) + ', ' + fmt(minR.totalInterest) + ' interest), you save <b>' + fmt(minR.totalInterest - r.totalInterest) + '</b> and finish <b>' + U.monthsText(minR.months - r.months) + '</b> sooner.'));
      } else if (!minR.neverPaysOff && minR.totalInterest < r.totalInterest - 0.005) {
        out.appendChild(U.msg('warn', 'Heads up: this payment is <i>smaller</i> than the usual minimum (first minimum would be ' + fmt(minR.firstPayment) + '). A real card would charge late fees.'));
      }
      var series = [{ label: mode === 'fixed' ? 'Paying ' + fmt(pay) + '/month' : 'Minimum only', values: [bal].concat(r.schedule.map(function (s) { return s.end; })), color: 0 }];
      if (mode === 'fixed' && !minR.neverPaysOff) series.push({ label: 'Minimum only', values: [bal].concat(minR.schedule.map(function (s) { return s.end; })), color: 1, dash: true });
      out.appendChild(h('h3', null, 'Balance over time'));
      out.appendChild(C.line(series, {
        fmt: fmt, xName: 'months', xFmt: function (i, long) { return long ? 'Month ' + i : (i >= 24 && i % 12 === 0 ? (i / 12) + 'y' : String(i)); },
        xStep: function (n) { var narrow = window.innerWidth < 560; return n <= 12 ? (narrow ? 3 : 2) : n <= 36 ? 6 : n <= 120 ? (narrow ? 24 : 12) : (narrow ? 48 : 24); },
        label: 'Balance over time. ' + series.map(function (s) { return s.label + ': paid off in ' + (s.values.length - 1) + ' months'; }).join('. ')
      }));
      var rows = r.schedule.slice(0, 600).map(function (s) {
        return h('tr', null, h('td', null, String(s.month)), h('td', { class: 'num' }, fmt(s.start)), h('td', { class: 'num' }, fmt(s.interest)), h('td', { class: 'num' }, fmt(s.payment)), h('td', { class: 'num' }, fmt(s.end)));
      });
      out.appendChild(h('details', { class: 'more' }, h('summary', null, 'Month-by-month table (' + U.plural(r.months, 'month') + ')'),
        h('div', { class: 'table-wrap tall' }, h('table', { class: 'tbl' },
          h('thead', null, h('tr', null, ['Month', 'Start', 'Interest', 'Payment', 'End'].map(function (t, i) { return h('th', { scope: 'col', class: i ? 'num' : '' }, t); }))),
          h('tbody', null, rows)))));
    }
    box.appendChild(h('p', null, 'See how long a credit card balance takes to pay off, and what it really costs. Assumes no new purchases.'));
    box.appendChild(fBal);
    box.appendChild(fApr);
    box.appendChild(h('fieldset', { class: 'seg' }, h('legend', null, 'How will you pay?'), radio('fixed', 'Same amount each month'), radio('minimum', 'Minimum payment only')));
    box.appendChild(fPay);
    box.appendChild(out);
    box.appendChild(h('p', { class: 'help' }, 'How it\'s calculated: each month, interest (balance × APR ÷ 12) is added first, then your payment comes off. The last payment is only what you still owe. Minimum payment uses a common rule: the larger of $25 (or the whole balance if less) and 1% of the balance plus that month\'s interest. Real cards vary.'));
    update();
  }

  /* ===================== Credit utilization ===================== */

  function utilizationTool(box) {
    var out = live();
    var fBal = U.numField('Total card balances', { value: 350, prefix: '$', oninput: update });
    var fLim = U.numField('Total credit limits', { value: 1000, prefix: '$', oninput: update });
    function update() {
      var lim = num(fLim.input.value), bal = num(fBal.input.value);
      var u = M.utilization(bal, lim);
      U.clear(out);
      if (u === null) { out.appendChild(U.msg('warn', 'Enter a credit limit above $0.')); return; }
      var cls = u <= 10 ? 'good' : u <= 30 ? 'info' : 'bad';
      out.appendChild(h('p', { class: 'big-num' }, pct(u)));
      out.appendChild(C.meter(u, { marks: [10, 30], label: 'Utilization ' + pct(u) + '. Marks at 10% and 30%.', cls: 'u-' + cls }));
      out.appendChild(h('div', { class: 'scale-labels small muted' }, h('span', null, '0%'), h('span', { style: 'left:10%' }, '10%'), h('span', { style: 'left:30%' }, '30%'), h('span', { style: 'right:0' }, '100%')));
      out.appendChild(U.msg(cls, u <= 10 ? '<b>Excellent.</b> Under 10% looks great to lenders.' : u <= 30 ? '<b>Healthy.</b> You\'re within the common 30% guideline. Lower is still better.' : '<b>High.</b> To get within the 30% guideline, keep your balance at or below <b>' + fmt(lim * 0.3) + '</b> (pay down ' + fmt(bal - lim * 0.3) + ').'));
      out.appendChild(h('p', { class: 'help' }, '30% is a guideline, not a cutoff. Lower is better; there\'s no cliff at exactly 30%.'));
    }
    box.appendChild(h('p', null, 'Utilization = what you owe ÷ your credit limit. Amounts owed (mostly utilization) is about 30% of a FICO-style score (approximate; scores vary by model).'));
    box.appendChild(h('div', { class: 'grid2' }, fBal, fLim));
    box.appendChild(out);
    update();
  }

  /* ===================== Credit score factors ===================== */

  var FACTORS = [
    { t: 'Payment history', v: 35, tip: 'Pay every bill on time, every time. Autopay for the minimum is a safety net. You never need to carry a balance to build credit.' },
    { t: 'Amounts owed', v: 30, tip: 'Keep utilization (balance ÷ limit) low. 30% is a common guideline, not a cutoff; lower is better, and under 10% is great.' },
    { t: 'Length of history', v: 15, tip: 'Older accounts help. Think twice before closing your oldest card.' },
    { t: 'New credit', v: 10, tip: 'Applying for lots of cards in a short time can lower your score a little.' },
    { t: 'Credit mix', v: 10, tip: 'Having different kinds (a card and a loan) helps a bit. Never borrow just for this.' }
  ];

  function scoreTool(box) {
    var tipBox = live();
    box.appendChild(h('p', null, 'What goes into a credit score. Tap a factor to learn how to improve it.'));
    box.appendChild(U.msg('info', '<b>FICO-style weights, approximate; scores vary by model.</b> Different scoring models (and versions) weigh things differently.'));
    var row = h('div', { class: 'chart-row' });
    row.appendChild(C.donut(FACTORS.map(function (f, i) { return { label: f.t, value: f.v, color: i }; }), {
      center: '300–850', sub: 'score range', fmt: function (v) { return v + '%'; },
      label: 'Credit score factors (FICO-style, approximate): ' + FACTORS.map(function (f) { return f.t + ' ' + f.v + '%'; }).join(', ')
    }));
    var btns = h('div', { class: 'factor-list' }, FACTORS.map(function (f, i) {
      return h('button', { class: 'factor', type: 'button', onclick: function () {
        U.clear(tipBox).appendChild(U.msg('info', '<b>' + f.t + ' (' + f.v + '%):</b> ' + f.tip));
      } }, h('span', { class: 'sw', style: 'background:var(--s' + (i + 1) + ')' }), h('span', null, f.t), h('b', null, f.v + '%'));
    }));
    row.appendChild(btns);
    box.appendChild(row);
    box.appendChild(tipBox);
  }

  /* ===================== Debt snowball ===================== */

  var EXAMPLE_DEBTS = {
    extra: 100,
    list: [
      { name: 'Phone balance', balance: 300, minPayment: 25, apr: 0 },
      { name: 'Store card', balance: 800, minPayment: 30, apr: 24 },
      { name: 'Car loan', balance: 4000, minPayment: 150, apr: 6 }
    ]
  };

  function snowballTool(box, ctx) {
    var S = global.Store.state;
    var data = JSON.parse(JSON.stringify(S.debts || EXAMPLE_DEBTS));
    var method = 'snowball';
    var rowsBox = h('div', { class: 'debt-rows' });
    var out = live('snow-out');
    var save = debounce(function () { S.debts = data; global.Store.save(); }, 300);
    var fExtra = U.numField('Extra money per month (on top of minimums)', { value: data.extra, prefix: '$', oninput: function () { data.extra = num(fExtra.input.value); update(); } });

    function debtRow(d, idx) {
      function f(label, key, pre, suf, wide) {
        var id = U.nextId('d');
        var inp = h('input', { id: id, type: 'text', inputmode: key === 'name' ? null : 'decimal', value: String(d[key]), autocomplete: 'off', maxlength: key === 'name' ? '30' : null,
          oninput: function () { d[key] = key === 'name' ? inp.value : num(inp.value); update(); } });
        return h('div', { class: 'field' + (wide ? ' wide' : '') }, h('label', { for: id }, label),
          key === 'name' ? inp : h('div', { class: 'num-wrap small' + (pre ? ' has-pre' : '') + (suf ? ' has-suf' : '') },
            pre ? h('span', { class: 'pre', 'aria-hidden': 'true' }, pre) : null, inp, suf ? h('span', { class: 'suf', 'aria-hidden': 'true' }, suf) : null));
      }
      return h('div', { class: 'debt-row' },
        h('div', { class: 'row-between' }, h('span', { class: 'debt-num' }, h('span', { class: 'sw', style: 'background:' + C.color(idx) }), ' Debt ' + (idx + 1)),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remove debt ' + (idx + 1) + (d.name ? ' (' + d.name + ')' : ''), onclick: function () { data.list.splice(idx, 1); buildRows(); update(); } }, '✕')),
        h('div', { class: 'debt-fields' },
          f('Name', 'name', null, null, true), f('Balance', 'balance', '$'), f('Minimum', 'minPayment', '$'), f('APR', 'apr', null, '%')));
    }
    function buildRows() {
      U.clear(rowsBox);
      data.list.forEach(function (d, i) { rowsBox.appendChild(debtRow(d, i)); });
    }

    function planFor(m, roll, extra) {
      return M.debtPlan(data.list, { extra: extra == null ? data.extra : extra, method: m, rollover: roll });
    }

    function update() {
      save();
      U.clear(out);
      var debts = data.list.filter(function (d) { return num(d.balance) > 0; });
      if (!data.list.length) { out.appendChild(U.msg('info', 'Add at least one debt, or press “Load example”.')); return; }
      if (!debts.length) { out.appendChild(U.msg('good', 'All balances are $0. Debt-free! 🎉')); return; }
      var p = planFor(method, true);
      var other = planFor(method === 'snowball' ? 'avalanche' : 'snowball', true);
      var minOnly = planFor('snowball', false, 0);
      var snow = method === 'snowball' ? p : other, aval = method === 'snowball' ? other : p;

      // warnings
      p.debts.forEach(function (d, i) {
        if (!d.minCoversInterest) out.appendChild(U.msg('warn', '<b>' + escapeHtml(d.name) + '</b>: the ' + fmt(data.list[i].minPayment) + ' minimum doesn\'t cover the ' + fmt(num(data.list[i].balance) * M.monthlyRate(data.list[i].apr)) + ' monthly interest. On its own, it would never shrink.'));
      });
      if (p.ignoredCount) out.appendChild(U.msg('info', U.plural(p.ignoredCount, 'debt') + ' with a $0 (or blank) balance ' + (p.ignoredCount === 1 ? 'is' : 'are') + ' skipped. Their minimums are not added to your monthly payment.'));
      if (p.status === 'payment-too-small') {
        out.appendChild(U.msg('bad', '<b>This plan never pays off.</b> At least one debt never gets smaller: the money going to it doesn\'t beat the interest it adds. Raise the extra amount or that debt\'s minimum.'));
        return;
      }
      if (p.status === 'hit-limit') {
        out.appendChild(U.msg('bad', '<b>Still not debt-free after ' + M.MAX_MONTHS / 12 + ' years.</b> The balances are going down, just very slowly. Adding even a little extra each month can cut years off.'));
        return;
      }
      var free = M.addMonths(new Date(), p.months);
      out.appendChild(h('div', { class: 'stats' },
        U.stat('Debt-free in', U.monthsText(p.months), 'hi'), U.stat('Debt-free by', U.monthYear(free)), U.stat('Total interest', fmt(p.totalInterest))));
      out.appendChild(h('p', null, 'Every month you put ', h('b', null, fmt(p.budget)), ' toward debt (', fmt(p.budget - p.extra), ' in minimums + ', fmt(p.extra), ' extra). That total never shrinks; it just moves to the next target.'));

      // payoff order with celebrations
      var ol = h('ol', { class: 'order' });
      p.order.forEach(function (i, k) {
        var d = p.debts[i], src = data.list[i];
        ol.appendChild(h('li', null,
          h('span', { class: 'sw', style: 'background:' + C.color(i) }),
          h('div', null, h('b', null, d.name), h('span', { class: 'small muted' }, ' · ' + fmt(src.balance) + ' at ' + num(src.apr) + '%'),
            h('div', { class: 'small' }, d.paidOffMonth ? '🎉 Paid off in month ' + d.paidOffMonth + ' (' + U.monthYear(M.addMonths(new Date(), d.paidOffMonth)) + ')' : 'Already $0'),
            k > 0 && d.paidOffMonth ? h('div', { class: 'small muted' }, 'Gets the rolled-over payments once the debt above is gone.') : null)));
      });
      out.appendChild(h('h3', null, method === 'snowball' ? 'Payoff order: smallest starting balance first' : 'Payoff order: highest APR first'));
      out.appendChild(h('p', { class: 'small muted' }, 'This order is set once, from each debt\'s starting ' + (method === 'snowball' ? 'balance' : 'APR') + '. It doesn\'t change from month to month.'));
      out.appendChild(ol);

      // comparison
      out.appendChild(h('h3', null, 'Compare plans'));
      var cmp = h('div', { class: 'compare-cards' });
      [
        { t: '⛄ Snowball', p: snow, s: 'Smallest starting balance first', pay: fmt(snow.budget) + ' a month' },
        { t: '🏔 Avalanche', p: aval, s: 'Highest APR first', pay: fmt(aval.budget) + ' a month' },
        { t: '🐢 Minimums only', p: minOnly, s: 'No extra, no rollover', pay: fmt(minOnly.budget) + ' a month at first, less as debts are paid off' }
      ].forEach(function (c) {
        cmp.appendChild(h('div', { class: 'cmp-card' + ((c.p === p) ? ' current' : '') },
          h('b', null, c.t), h('span', { class: 'small muted' }, c.s),
          h('span', { class: 'small' }, 'Pays ', h('b', null, c.pay)),
          h('span', null, c.p.status === 'payment-too-small' ? 'Never pays off' : c.p.neverPaysOff ? 'Not done in 50 years' : U.monthsText(c.p.months)),
          h('span', null, c.p.neverPaysOff ? '—' : fmt(c.p.totalInterest) + ' interest')));
      });
      out.appendChild(cmp);
      if (snow.budget - minOnly.budget > 0.004) out.appendChild(h('p', { class: 'small' }, 'Minimums only pays ', h('b', null, fmt(snow.budget - minOnly.budget) + ' less each month'), ' (and even less once a debt is gone, because nothing rolls over). That\'s why it takes longer and costs more interest.'));
      var diff = snow.totalInterest - aval.totalInterest;
      out.appendChild(h('p', { class: 'small' }, Math.abs(diff) < 0.5
        ? 'Snowball and avalanche cost about the same here, so pick the one that keeps you motivated.'
        : 'Avalanche saves ' + fmt(diff) + ' in interest' + (aval.months < snow.months ? ' and finishes ' + U.plural(snow.months - aval.months, 'month') + ' sooner' : '') + '. Snowball gets your first debt gone in month ' + Math.min.apply(null, snow.debts.map(function (d) { return d.paidOffMonth || Infinity; })) + ' vs. month ' + Math.min.apply(null, aval.debts.map(function (d) { return d.paidOffMonth || Infinity; })) + '.'));

      // chart
      out.appendChild(h('h3', null, 'Balances over time'));
      var series = data.list.map(function (d, i) {
        return { label: d.name || ('Debt ' + (i + 1)), values: [num(d.balance)].concat(p.timeline.map(function (t) { return t.balances[i]; })), color: i };
      }).slice(0, 8);
      out.appendChild(C.line(series, {
        fmt: fmt, xName: 'months', xFmt: function (i, long) { return long ? 'Month ' + i : String(i); },
        xStep: function (n) { var narrow = window.innerWidth < 560; return n <= 12 ? (narrow ? 2 : 1) : n <= 36 ? (narrow ? 6 : 3) : n <= 120 ? 12 : 24; },
        label: 'Each debt\'s balance by month. ' + p.order.map(function (i) { return p.debts[i].name + ' paid off in month ' + p.debts[i].paidOffMonth; }).join('; ')
      }));

      // timeline table
      var head = h('tr', null, h('th', { scope: 'col' }, 'Month'), data.list.map(function (d) { return h('th', { scope: 'col', class: 'num' }, d.name); }), h('th', { scope: 'col', class: 'num' }, 'Paid'), h('th', { scope: 'col' }, 'Notes'));
      var body = p.timeline.map(function (t) {
        var paid = t.payments.reduce(function (s, x) { return s + x; }, 0);
        return h('tr', { class: t.paidOff.length ? 'win' : '' },
          h('td', null, String(t.month)),
          t.balances.map(function (b, i) { return h('td', { class: 'num' + (t.payments[i] > data.list[i].minPayment + 0.004 ? ' target' : '') }, b > 0 ? fmt(b) : (t.paidOff.indexOf(i) !== -1 ? '✓ $0' : '—')); }),
          h('td', { class: 'num' }, fmt(paid)),
          h('td', null, t.paidOff.map(function (i) { return '🎉 ' + p.debts[i].name + ' paid off!'; }).join(' ')));
      });
      out.appendChild(h('details', { class: 'more', open: p.months <= 36 ? 'open' : null }, h('summary', null, 'Month-by-month timeline'),
        h('p', { class: 'help' }, 'Bold = the debt getting the extra money that month. Balances are after that month\'s payment.'),
        h('div', { class: 'table-wrap tall' }, h('table', { class: 'tbl timeline' }, h('thead', null, head), h('tbody', null, body)))));
    }

    function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

    var mName = U.nextId('m');
    function mRadio(val, label) {
      var id = U.nextId('r');
      return h('div', { class: 'seg-opt' }, h('input', { type: 'radio', name: mName, id: id, value: val, checked: val === method, onchange: function () { method = val; update(); } }), h('label', { for: id }, label));
    }

    box.appendChild(h('p', null, 'List your debts, add any extra money you can put toward them, and see your debt-free date.'));
    box.appendChild(rowsBox);
    box.appendChild(h('div', { class: 'btn-row' },
      h('button', { class: 'btn secondary', type: 'button', onclick: function () {
        if (data.list.length >= 8) { U.clear(out).appendChild(U.msg('warn', 'Up to 8 debts at a time.')); return; }
        data.list.push({ name: 'Debt ' + (data.list.length + 1), balance: 500, minPayment: 25, apr: 20 }); buildRows(); update();
        var inputs = rowsBox.querySelectorAll('.debt-row:last-child input'); if (inputs[0]) { inputs[0].focus(); inputs[0].select(); }
      } }, '+ Add a debt'),
      h('button', { class: 'btn ghost', type: 'button', onclick: function () {
        data = JSON.parse(JSON.stringify(EXAMPLE_DEBTS)); fExtra.input.value = String(data.extra); buildRows(); update();
      } }, 'Load example'),
      h('button', { class: 'btn ghost danger', type: 'button', onclick: function () { data.list = []; buildRows(); update(); } }, 'Clear all')));
    box.appendChild(fExtra);
    box.appendChild(h('fieldset', { class: 'seg' }, h('legend', null, 'Method'), mRadio('snowball', '⛄ Snowball (smallest first)'), mRadio('avalanche', '🏔 Avalanche (highest APR)')));
    box.appendChild(out);
    box.appendChild(h('p', { class: 'help' }, 'How it\'s calculated: each month, interest (balance × APR ÷ 12) is added to every debt, minimums are paid on all of them, then the extra money plus any freed-up minimums goes to the target debt. If the target is paid off mid-month, the leftover rolls to the next target the same month. The order is set once at the start by each debt\'s starting balance (snowball) or APR (avalanche). Ties: snowball picks the higher APR; avalanche picks the smaller balance. Debts with a $0 balance are skipped. Plans stop at ' + M.MAX_MONTHS + ' months (50 years).'));
    buildRows();
    update();
  }

  /* ===================== Worked example (used inside a lesson card) ===================== */

  function workedExample(box, ex) {
    var p = M.debtPlan(ex.debts, { extra: ex.extra, method: 'snowball' });
    var a = M.debtPlan(ex.debts, { extra: ex.extra, method: 'avalanche' });
    var order = p.order;
    box.appendChild(h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Debt (smallest starting balance first)'), h('th', { scope: 'col', class: 'num' }, 'Balance'), h('th', { scope: 'col', class: 'num' }, 'Min'), h('th', { scope: 'col', class: 'num' }, 'APR'))),
      h('tbody', null, order.map(function (i) { var d = ex.debts[i]; return h('tr', null, h('td', null, d.name), h('td', { class: 'num' }, fmt(d.balance, { noCents: true })), h('td', { class: 'num' }, fmt(d.minPayment, { noCents: true })), h('td', { class: 'num' }, d.apr + '%')); }))));
    var steps = h('ol', { class: 'steps' });
    var startMonth = 1;
    order.forEach(function (i, k) {
      var d = p.debts[i];
      var first = p.timeline[startMonth - 1];
      var payNow = first ? first.payments[i] : 0;
      steps.appendChild(h('li', null,
        h('b', null, 'Months ' + startMonth + '–' + d.paidOffMonth + ': target ' + d.name + '. '),
        'You pay ' + fmt(payNow) + ' on it' + (k === 0 ? ' (its ' + fmt(ex.debts[i].minPayment, { noCents: true }) + ' minimum + ' + fmt(ex.extra, { noCents: true }) + ' extra)' : ' (its own minimum + everything rolled over)') + ' and the minimum on the others. ',
        h('span', { class: 'win-text' }, '🎉 Paid off in month ' + d.paidOffMonth + '!')));
      startMonth = d.paidOffMonth + 1;
    });
    box.appendChild(steps);
    box.appendChild(h('p', null, 'Debt-free in ', h('b', null, U.plural(p.months, 'month')), ' with ', h('b', null, fmt(p.totalInterest)), ' total interest. (Avalanche on the same debts: ' + U.plural(a.months, 'month') + ', ' + fmt(a.totalInterest) + '.)'));
  }

  var TOOLS = {
    'sort-game': { title: 'Needs vs. Wants Sort', icon: '🧺', blurb: 'Tap or drag 10 everyday things into Needs or Wants.', render: sortGame },
    'paycheck': { title: 'Paycheck Calculator', icon: '💵', blurb: 'Turn hours and wage into gross and take-home pay.', render: paycheckTool },
    'budget': { title: 'Budget Builder', icon: '📊', blurb: 'Build a monthly budget with sliders and a live chart.', render: budgetTool },
    'sheet': { title: 'Budget Sheet', icon: '🗒️', blurb: 'Your real monthly budget: plan, track actual spending, print or download it.', render: function (box, ctx) { global.SheetUI.render(box, ctx); } },
    'goals': { title: 'Savings Goal Tracker', icon: '🎯', blurb: 'How many weeks until you reach your goal?', render: goalsTool },
    'compound': { title: 'Compound Interest', icon: '📈', blurb: 'Watch deposits and interest grow over the years.', render: compoundTool },
    'compare': { title: 'Account & Card Comparison', icon: '⚖️', blurb: 'Checking vs. savings and debit vs. credit, side by side.', render: compareTool },
    'account': { title: 'Overdraft Simulator', icon: '🏧', blurb: 'Spend from a checking account and see what overdrafts cost.', render: accountTool },
    'card-sim': { title: 'Credit Card Simulator', icon: '💳', blurb: 'Months to pay off, total interest, and the minimum-payment trap.', render: cardSimTool },
    'utilization': { title: 'Utilization Calculator', icon: '📏', blurb: 'How much of your credit limit are you using? Lower is better.', render: utilizationTool },
    'score': { title: 'Credit Score Factors', icon: '⭐', blurb: 'What makes up a credit score.', render: scoreTool },
    'snowball': { title: 'Debt Snowball Calculator', icon: '⛄', blurb: 'Payoff order, timeline, and debt-free date. Compare with avalanche.', render: snowballTool }
  };

  global.Tools = { list: TOOLS, workedExample: workedExample };
}(window));
