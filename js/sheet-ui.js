/* Money Lab — Budget Sheet screen (one sheet per month, filled in by the teen).
 * All math, wording and CSV come from js/sheet.js; this file is only UI.
 * Sheets are saved in the Money Lab store: Store.state.sheets['YYYY-MM']. */
(function (global) {
  'use strict';

  var U = global.UI, SH = global.Sheet;
  var h = U.h, fmt = SH.fmt;
  var currentMonth = null; // remembered while the app is open

  var ADD_LABEL = { income: '+ Add income', need: '+ Add a need', want: '+ Add a want', save: '+ Add savings' };
  var NEW_NAME = { income: 'New income', need: 'New need', want: 'New want', save: 'New savings' };
  var ITEM_WORD = { income: 'Income source', need: 'Need', want: 'Want', save: 'Savings item' };

  var HOWTO = [
    'Pick the month at the top. <b>←</b> and <b>→</b> move one month at a time.',
    'Under <b>Income</b>, type what you expect to earn in <b>Planned</b>. Add a line for each paycheck, gift, or side job.',
    'Under <b>Needs</b>, <b>Wants</b>, and <b>Savings</b>, type a <b>Planned</b> amount for each line. Rename, add, or remove lines to fit your life. Try to get <b>Money left over</b> to $0 planned: every dollar gets a job.',
    'As the month goes, type what really happened in <b>Actual</b>, or add each purchase to the <b>Spending log</b>. Logged amounts are added to that line\'s Actual for you.',
    'Check the <b>Difference</b> column and the status lines. <b>✓</b> means good news. <b>✗</b> means you went over plan, or earned or saved less than planned.',
    'At the end of the month, <b>Print</b> it or <b>Download CSV</b> (opens in Excel or Google Sheets). Next month, press <b>Copy last month\'s plan</b>.'
  ];

  function todayKey() { return SH.monthKey(new Date()); }
  function todayDate() { var d = new Date(); return todayKey() + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate(); }

  /* Difference wording for a cell: { text, cls } with an icon so it never relies on color. */
  function diffView(section, has, diff) {
    if (!has) return { text: '—', cls: 'none', sr: 'no actual yet' };
    var a = fmt(Math.abs(diff));
    if (diff === 0) return { text: '✓ on plan', cls: 'even' };
    if (section === 'spent') return { text: a + (diff > 0 ? ' more' : ' less'), cls: 'neutral' };
    var good = SH.goodness(section === 'left' ? 'income' : section, diff) === 'good';
    var word = section === 'need' || section === 'want' ? (diff > 0 ? ' over' : ' under') : (diff > 0 ? ' more' : ' less');
    return { text: (good ? '✓ ' : '✗ ') + a + word, cls: good ? 'good' : 'bad' };
  }

  function centsInput(id, cents, blankWhenZero) {
    var v = cents === null || (blankWhenZero && cents === 0) ? '' : SH.plain(cents);
    return h('input', { id: id, type: 'text', inputmode: 'decimal', autocomplete: 'off', value: v, placeholder: '0.00', class: 'cents' });
  }

  function render(box, ctx) {
    var Store = global.Store, S = Store.state;
    if (!S.sheets) S.sheets = {};
    var month = currentMonth && SH.isMonthKey(currentMonth) ? currentMonth : todayKey();
    var sheet = S.sheets[month] ? JSON.parse(JSON.stringify(S.sheets[month])) : SH.template(month);
    var saved = !!S.sheets[month];
    var rowRefs = {};

    var note = h('p', { class: 'sr-only', 'aria-live': 'polite' });
    var actionMsg = h('div', { class: 'sheet-action-msg', 'aria-live': 'polite' });
    function announce(t) { note.textContent = ''; setTimeout(function () { note.textContent = t; }, 30); }
    function say(kind, text) { U.clear(actionMsg).appendChild(U.msg(kind, text)); }
    var announceStatus = (function () {
      var t;
      return function () { clearTimeout(t); t = setTimeout(function () { var s = SH.summarize(sheet); announce(s.overall.text + '.'); }, 900); };
    }());

    function persist() { S.sheets[month] = sheet; saved = true; Store.save(); newNote.hidden = true; }
    function commit(next, rebuild) { sheet = next; persist(); if (rebuild) buildGroups(); refresh(); }

    function rerender(focusSel) {
      currentMonth = month;
      U.clear(box);
      render(box, ctx);
      if (focusSel) { var f = box.querySelector(focusSel); if (f) f.focus(); }
    }

    /* ---------- month bar ---------- */
    var monthId = U.nextId('m');
    var monthInput = h('input', { id: monthId, type: 'month', value: month, class: 'month-input' });
    monthInput.addEventListener('change', function () {
      if (SH.isMonthKey(monthInput.value)) { month = monthInput.value; rerender('.month-input'); }
    });
    var title = h('h3', { class: 'sheet-month' }, SH.monthLabel(month));
    var newNote = h('p', { class: 'help', hidden: saved ? true : null }, 'New month: this starts from a simple template with $0 planned. It\'s saved as soon as you type something.');
    var monthBar = h('div', { class: 'month-bar' },
      h('button', { class: 'btn ghost small prev-month', type: 'button', 'aria-label': 'Previous month: ' + SH.monthLabel(SH.shiftMonth(month, -1)),
        onclick: function () { month = SH.shiftMonth(month, -1); rerender('.prev-month'); } }, '←', h('span', { class: 'hide-sm' }, ' Prev')),
      h('div', { class: 'field month-field' }, h('label', { for: monthId }, 'Month'), monthInput),
      h('button', { class: 'btn ghost small next-month', type: 'button', 'aria-label': 'Next month: ' + SH.monthLabel(SH.shiftMonth(month, 1)),
        onclick: function () { month = SH.shiftMonth(month, 1); rerender('.next-month'); } }, h('span', { class: 'hide-sm' }, 'Next '), '→'),
      month !== todayKey() ? h('button', { class: 'btn ghost small this-month', type: 'button', onclick: function () { month = todayKey(); rerender('.month-input'); } }, 'This month') : null);

    /* ---------- actions ---------- */
    function copyLast() {
      var src = SH.latestBefore(S.sheets, month);
      if (!src) { say('info', 'There\'s no earlier month with a sheet yet. Fill in this one, and next month you can copy it.'); return; }
      if (SH.hasData(sheet) && !global.confirm('Replace ' + SH.monthLabel(month) + ' with the plan from ' + SH.monthLabel(src) + '?\n\nThis month\'s actual amounts and spending log will be cleared.')) return;
      commit(SH.copyPlan(S.sheets[src], month), true);
      say('good', 'Copied the lines and planned amounts from <b>' + SH.monthLabel(src) + '</b>. Actual amounts start blank.');
    }
    function prefill() {
      if (!S.budget) { say('info', 'No saved Budget Builder plan yet. Open the <a href="#/tool/budget">Budget Builder</a>, make a plan, then come back.'); return; }
      if (SH.hasData(sheet) && !global.confirm('Use your Budget Builder plan as the Planned amounts for ' + SH.monthLabel(month) + '?\n\nPlanned amounts will be replaced. Lines that already have actual amounts or log entries are kept.')) return;
      commit(SH.fromBudget(sheet, S.budget), true);
      say('good', 'Brought in your Budget Builder plan as <b>Planned</b> amounts.');
    }
    function printSheet() {
      var card = box.closest('.tool') || box;
      card.classList.add('print-target');
      document.body.classList.add('print-sheet-only');
      var done = function () { document.body.classList.remove('print-sheet-only'); card.classList.remove('print-target'); global.removeEventListener('afterprint', done); };
      global.addEventListener('afterprint', done);
      global.print();
      setTimeout(done, 1000);
    }
    function downloadCSV() {
      var blob = new Blob([SH.toCSV(sheet)], { type: 'text/csv;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = h('a', { href: url, download: SH.csvFilename(month), hidden: true });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      say('good', 'Downloaded <b>' + SH.csvFilename(month) + '</b>. It opens in Excel, Numbers, or Google Sheets.');
    }
    function startOver() {
      if (!global.confirm('Clear the whole sheet for ' + SH.monthLabel(month) + '? Planned, actual, and the spending log will be deleted.')) return;
      delete S.sheets[month];
      Store.save();
      rerender('.start-over');
    }
    var actions = h('div', { class: 'btn-row sheet-actions' },
      h('button', { class: 'btn secondary small', type: 'button', onclick: copyLast }, '📋 Copy last month\'s plan'),
      h('button', { class: 'btn ghost small', type: 'button', onclick: prefill }, '📊 Prefill from Budget Builder'),
      h('button', { class: 'btn ghost small', type: 'button', onclick: printSheet }, '🖨 Print'),
      h('button', { class: 'btn ghost small', type: 'button', onclick: downloadCSV }, '⬇ Download CSV'),
      h('button', { class: 'btn ghost small danger start-over', type: 'button', onclick: startOver }, 'Start this month over'));

    /* ---------- the sheet ---------- */
    var groupsBox = h('div', { class: 'sheet-groups' });
    var subRefs = {};

    function rowView(row) {
      var nid = U.nextId('sn'), pid = U.nextId('sp'), aid = U.nextId('sa');
      var name = h('input', { id: nid, type: 'text', value: row.name, maxlength: String(SH.NAME_MAX), class: 'sheet-name', autocomplete: 'off' });
      var planned = centsInput(pid, row.planned, true);
      var actual = centsInput(aid, row.actual, false);
      var forP = h('span', { class: 'sr-only' }), forA = h('span', { class: 'sr-only' });
      var logNote = h('p', { class: 'help log-note' });
      var err = h('p', { class: 'help field-err', hidden: true }, 'Type an amount like 12.50 (no minus sign).');
      var diff = h('div', { class: 'sheet-diff' });
      var rm = h('button', { class: 'icon-btn sheet-rm', type: 'button' }, '✕');
      function names() {
        var n = row.name.trim() || ITEM_WORD[row.section];
        forP.textContent = ' for ' + n; forA.textContent = ' for ' + n;
        rm.setAttribute('aria-label', 'Remove ' + n);
      }
      names();
      name.addEventListener('input', function () { row.name = name.value; names(); commit(SH.setRow(sheet, row.id, { name: name.value })); });
      function money(input, key) {
        input.addEventListener('input', function () {
          var c = SH.parseCents(input.value);
          var bad = c !== null && !isFinite(c);
          input.setAttribute('aria-invalid', bad ? 'true' : 'false');
          err.hidden = !(bad || (input === planned ? actual : planned).getAttribute('aria-invalid') === 'true');
          if (bad) return;
          var patch = {};
          patch[key] = key === 'planned' ? (c === null ? 0 : c) : c;
          commit(SH.setRow(sheet, row.id, patch));
          announceStatus();
        });
      }
      money(planned, 'planned');
      money(actual, 'actual');
      err.id = U.nextId('se'); logNote.id = U.nextId('sl');
      planned.setAttribute('aria-describedby', err.id);
      actual.setAttribute('aria-describedby', err.id + ' ' + logNote.id);
      rm.addEventListener('click', function () {
        var n = sheet.log.filter(function (e) { return e.rowId === row.id; }).length;
        var label = row.name.trim() || ITEM_WORD[row.section];
        if (n && !global.confirm('Remove "' + label + '"? Its ' + U.plural(n, 'spending-log entry', 'spending-log entries') + ' will be deleted too.')) return;
        commit(SH.removeRow(sheet, row.id), true);
        announce('Removed ' + label + '.');
        var addBtn = groupsBox.querySelector('[data-add="' + row.section + '"]');
        if (addBtn) addBtn.focus();
      });
      var el = h('div', { class: 'sheet-row', 'data-row': row.id },
        h('div', { class: 'c-name' }, h('label', { class: 'sr-only', for: nid }, ITEM_WORD[row.section] + ' name'), name),
        h('div', { class: 'c-planned' }, h('label', { for: pid, class: 'cell-label' }, 'Planned', forP),
          h('div', { class: 'num-wrap small has-pre' }, h('span', { class: 'pre', 'aria-hidden': 'true' }, '$'), planned)),
        h('div', { class: 'c-actual' }, h('label', { for: aid, class: 'cell-label' }, 'Actual', forA),
          h('div', { class: 'num-wrap small has-pre' }, h('span', { class: 'pre', 'aria-hidden': 'true' }, '$'), actual)),
        h('div', { class: 'c-diff' }, h('span', { class: 'cell-label', 'aria-hidden': 'true' }, 'Difference'), diff),
        h('div', { class: 'c-rm' }, rm),
        h('div', { class: 'c-notes' }, logNote, err));
      rowRefs[row.id] = { diff: diff, logNote: logNote, row: row };
      return el;
    }

    function buildGroups() {
      U.clear(groupsBox); rowRefs = {}; subRefs = {};
      SH.SECTIONS.forEach(function (g) {
        var sub = h('span', { class: 'grp-sub' });
        subRefs[g.id] = sub;
        var rows = sheet.rows.filter(function (r) { return r.section === g.id; });
        var hid = U.nextId('gh');
        groupsBox.appendChild(h('section', { class: 'sheet-group', 'data-section': g.id, 'aria-labelledby': hid },
          h('div', { class: 'grp-head' }, h('h3', { id: hid }, g.label), sub),
          h('div', { class: 'sheet-cols', 'aria-hidden': 'true' }, h('span', null, 'Item'), h('span', null, 'Planned'), h('span', null, 'Actual'), h('span', null, 'Difference'), h('span')),
          rows.length ? rows.map(function (r) { return rowView(JSON.parse(JSON.stringify(r))); }) : h('p', { class: 'help' }, 'No ' + g.label.toLowerCase() + ' lines yet.'),
          h('button', { class: 'btn ghost small add-row', type: 'button', 'data-add': g.id, onclick: function () {
            commit(SH.addRow(sheet, g.id, NEW_NAME[g.id]), true);
            var last = groupsBox.querySelectorAll('.sheet-group[data-section="' + g.id + '"] .sheet-name');
            last = last[last.length - 1];
            if (last) { last.focus(); last.select(); }
            announce('Added a line to ' + g.label + '.');
          } }, ADD_LABEL[g.id])));
      });
    }

    /* ---------- totals, status, log, print ---------- */
    var totalsBox = h('div', { class: 'sheet-totals' });
    var statusBox = h('div', { class: 'sheet-status' });
    var logList = h('ul', { class: 'log-list' });
    var logTotal = h('p', { class: 'small log-total' });
    var printBox = h('div', { class: 'print-only sheet-print' });

    function totalsTable(s) {
      function tr(label, t, kind, cls) {
        var d = diffView(kind, kind === 'income' ? s.groups.income.hasActual : s.hasActual, t.diff);
        return h('tr', { class: cls || null }, h('th', { scope: 'row' }, label), h('td', { class: 'num' }, fmt(t.planned)), h('td', { class: 'num' }, fmt(t.actual)),
          h('td', { class: 'num diff ' + d.cls }, d.text));
      }
      return h('table', { class: 'tbl sheet-tot' },
        h('caption', { class: 'sr-only' }, 'Totals for ' + SH.monthLabel(month)),
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Totals'), h('th', { scope: 'col', class: 'num' }, 'Planned'), h('th', { scope: 'col', class: 'num' }, 'Actual'), h('th', { scope: 'col', class: 'num' }, 'Difference'))),
        h('tbody', null,
          tr('Income', s.income, 'income'),
          tr('Spent', s.spent, 'spent'),
          tr('Money left over', s.left, 'left', 'total')));
    }

    function statusList(s) {
      var items = [U.msg(s.overall.kind, s.overall.text + '.'), U.msg(s.plan.kind, s.plan.text + '.')];
      s.statuses.forEach(function (st) { items.push(U.msg(st.kind, st.text + '.')); });
      return items;
    }

    function rowName(id) {
      var r = sheet.rows.filter(function (x) { return x.id === id; })[0];
      return r ? (r.name.trim() || ITEM_WORD[r.section]) : '(removed)';
    }

    function drawLog() {
      U.clear(logList);
      var entries = SH.sortedLog(sheet).slice().reverse(); // newest first on screen
      if (!entries.length) logList.appendChild(h('li', { class: 'muted small empty' }, 'Nothing logged for ' + SH.monthLabel(month) + ' yet.'));
      entries.forEach(function (e) {
        var n = rowName(e.rowId);
        var day = parseInt(e.date.slice(8), 10);
        var when = SH.monthLabel(month).split(' ')[0].slice(0, 3) + ' ' + day;
        logList.appendChild(h('li', null,
          h('span', { class: 'log-date' }, when),
          h('span', { class: 'log-what' }, h('b', null, n), e.note ? h('span', { class: 'small muted' }, ' · ' + e.note) : null),
          h('span', { class: 'log-amt' }, fmt(e.amount)),
          h('button', { class: 'icon-btn log-del', type: 'button', 'aria-label': 'Delete ' + fmt(e.amount) + ' for ' + n + ' on ' + when, onclick: function () {
            commit(SH.deleteLog(sheet, e.id));
            var s = SH.summarize(sheet), r = s.rows.filter(function (x) { return x.id === e.rowId; })[0];
            announce('Deleted ' + fmt(e.amount) + ' for ' + n + '.' + (r ? ' Its actual is now ' + fmt(r.actual) + '.' : ''));
            var next = logList.querySelector('.log-del') || logForm.querySelector('select');
            if (next) next.focus();
          } }, '✕')));
      });
      var s = SH.summarize(sheet);
      logTotal.textContent = sheet.log.length ? U.plural(sheet.log.length, 'entry', 'entries') + ' · ' + fmt(s.logTotal) + ' logged this month' : '';
    }

    function drawPrint(s) {
      U.clear(printBox);
      var lines = sheet.rows.length + sheet.log.length / 2;
      printBox.className = 'print-only sheet-print' + (lines > 30 ? ' dense' : '');
      var body = [];
      SH.SECTIONS.forEach(function (g) {
        body.push(h('tr', { class: 'p-grp' }, h('th', { colspan: '4', scope: 'colgroup' }, g.label)));
        s.rows.filter(function (r) { return r.section === g.id; }).forEach(function (r) {
          var d = diffView(r.section, r.hasActual, r.diff);
          body.push(h('tr', null, h('td', null, r.name.trim() || ITEM_WORD[r.section]), h('td', { class: 'num' }, fmt(r.planned)),
            h('td', { class: 'num' }, r.hasActual ? fmt(r.actual) : '—'), h('td', { class: 'num' }, d.text)));
        });
        var t = s.groups[g.id], dd = diffView(g.id, t.hasActual, t.diff);
        body.push(h('tr', { class: 'p-sub' }, h('td', null, g.label + ' total'), h('td', { class: 'num' }, fmt(t.planned)), h('td', { class: 'num' }, fmt(t.actual)), h('td', { class: 'num' }, dd.text)));
      });
      [['Total income', s.income, 'income'], ['Total spent (needs + wants + savings)', s.spent, 'spent'], ['Money left over', s.left, 'left']].forEach(function (x) {
        var d = diffView(x[2], s.hasActual, x[1].diff);
        body.push(h('tr', { class: 'p-tot' }, h('td', null, x[0]), h('td', { class: 'num' }, fmt(x[1].planned)), h('td', { class: 'num' }, fmt(x[1].actual)), h('td', { class: 'num' }, d.text)));
      });
      printBox.appendChild(h('h1', null, 'Budget Sheet: ' + SH.monthLabel(month)));
      printBox.appendChild(h('table', { class: 'p-tbl' },
        h('thead', null, h('tr', null, h('th', null, 'Item'), h('th', { class: 'num' }, 'Planned'), h('th', { class: 'num' }, 'Actual'), h('th', { class: 'num' }, 'Difference'))),
        h('tbody', null, body)));
      printBox.appendChild(h('p', { class: 'p-status' }, h('b', null, s.overall.text + '. '), s.plan.text + '.'));
      if (sheet.log.length) {
        printBox.appendChild(h('h2', null, 'Spending log (' + fmt(s.logTotal) + ')'));
        printBox.appendChild(h('ul', { class: 'p-log' }, SH.sortedLog(sheet).map(function (e) {
          return h('li', null, e.date + '  ' + rowName(e.rowId) + '  ' + fmt(e.amount) + (e.note ? '  (' + e.note + ')' : ''));
        })));
      }
      printBox.appendChild(h('p', { class: 'p-foot' }, 'Difference = Actual − Planned. ✓ = good news, ✗ = over plan or less than planned. Made with Money Lab.'));
    }

    function refresh() {
      var s = SH.summarize(sheet);
      s.rows.forEach(function (r) {
        var ref = rowRefs[r.id];
        if (!ref) return;
        var d = diffView(r.section, r.hasActual, r.diff);
        ref.diff.className = 'sheet-diff ' + d.cls;
        ref.diff.textContent = d.text;
        ref.logNote.textContent = r.logged ? '+ ' + fmt(r.logged) + ' from the log = ' + fmt(r.actual) + ' actual' : '';
      });
      SH.SECTIONS.forEach(function (g) {
        var t = s.groups[g.id];
        var d = diffView(g.id, t.hasActual, t.diff);
        U.clear(subRefs[g.id]).appendChild(h('span', null, 'Planned ', h('b', null, fmt(t.planned)), ' · Actual ', h('b', null, fmt(t.actual)), ' ',
          h('span', { class: 'sheet-diff ' + d.cls }, d.text)));
      });
      U.clear(totalsBox).appendChild(totalsTable(s));
      U.clear(statusBox);
      U.add(statusBox, statusList(s));
      drawLog();
      fillCategories();
      drawPrint(s);
    }

    /* ---------- spending log form ---------- */
    var catId = U.nextId('lc'), amtId = U.nextId('la'), dateId = U.nextId('ld'), noteId = U.nextId('ln');
    var catSel = h('select', { id: catId });
    var amtIn = h('input', { id: amtId, type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00' });
    var dateIn = h('input', { id: dateId, type: 'date', value: month === todayKey() ? todayDate() : month + '-01',
      min: month + '-01', max: month + '-' + SH.daysInMonth(month) });
    var noteIn = h('input', { id: noteId, type: 'text', maxlength: String(SH.NOTE_MAX), autocomplete: 'off', placeholder: 'e.g. lunch with friends' });
    var logErr = h('p', { class: 'field-err small', 'aria-live': 'assertive' });

    function fillCategories() {
      var keep = catSel.value;
      U.clear(catSel);
      catSel.appendChild(h('option', { value: '' }, 'Choose…'));
      SH.SECTIONS.forEach(function (g) {
        if (g.id === 'income') return;
        var rows = sheet.rows.filter(function (r) { return r.section === g.id; });
        if (!rows.length) return;
        catSel.appendChild(h('optgroup', { label: g.label }, rows.map(function (r) {
          return h('option', { value: r.id }, r.name.trim() || ITEM_WORD[r.section]);
        })));
      });
      catSel.value = keep;
      if (catSel.value !== keep) catSel.value = '';
    }

    var logForm = h('form', { class: 'log-form', novalidate: true },
      h('div', { class: 'log-fields' },
        h('div', { class: 'field' }, h('label', { for: catId }, 'Category'), catSel),
        h('div', { class: 'field' }, h('label', { for: amtId }, 'Amount'), h('div', { class: 'num-wrap has-pre' }, h('span', { class: 'pre', 'aria-hidden': 'true' }, '$'), amtIn)),
        h('div', { class: 'field' }, h('label', { for: dateId }, 'Date'), dateIn),
        h('div', { class: 'field' }, h('label', { for: noteId }, 'Note (optional)'), noteIn)),
      logErr,
      h('button', { class: 'btn primary', type: 'submit' }, '+ Add to log'));
    logForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var c = SH.parseCents(amtIn.value);
      if (!catSel.value) { logErr.textContent = 'Pick a category.'; catSel.focus(); return; }
      if (c === null || !isFinite(c) || c <= 0) { logErr.textContent = 'Type an amount more than $0, like 12.50.'; amtIn.focus(); return; }
      var r = SH.addLog(sheet, { rowId: catSel.value, amount: c, note: noteIn.value, date: dateIn.value });
      if (r.error) { logErr.textContent = r.error; dateIn.focus(); return; }
      logErr.textContent = '';
      commit(r.sheet);
      var row = SH.summarize(sheet).rows.filter(function (x) { return x.id === catSel.value; })[0];
      announce('Logged ' + fmt(c) + ' for ' + rowName(catSel.value) + '. Its actual is now ' + fmt(row.actual) + '.');
      amtIn.value = ''; noteIn.value = '';
      amtIn.focus();
    });

    /* ---------- assemble ---------- */
    var howto = h('details', { class: 'card inset howto-card sheet-howto', open: SH.hasData(sheet) ? null : 'open' },
      h('summary', null, h('h3', null, 'How to use the Budget Sheet')),
      h('ol', { class: 'howto' }, HOWTO.map(function (s) { return h('li', { html: s }); })));

    var logHead = h('h3', { id: U.nextId('lh') }, '🧾 Spending log');
    box.appendChild(h('div', { class: 'screen-only' },
      h('p', null, 'Your real monthly budget. Plan each line, then track what you actually earn and spend.'),
      howto,
      monthBar,
      title,
      newNote,
      actions,
      actionMsg,
      groupsBox,
      h('h3', null, 'Totals'),
      h('div', { class: 'table-wrap' }, totalsBox),
      h('p', { class: 'help' }, 'Spent = needs + wants + savings (every dollar you gave a job). Money left over = income − spent.'),
      h('h3', null, 'How this month is going'),
      statusBox,
      h('section', { class: 'card inset sheet-log', 'aria-labelledby': logHead.id },
        logHead,
        h('p', { class: 'help' }, 'Log each purchase or savings deposit as it happens. A line\'s Actual = what you typed in its Actual box + everything logged for it. Delete an entry and it comes back out.'),
        logForm,
        logTotal,
        logList),
      h('p', { class: 'help' }, 'Difference = Actual − Planned. For income and savings, more than planned is good (✓). For needs and wants, more than planned is over budget (✗). Saved on this device only.'),
      note));
    box.appendChild(printBox);
    buildGroups();
    refresh();
  }

  global.SheetUI = { render: render };
}(window));
