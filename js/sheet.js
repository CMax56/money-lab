/* Money Lab — monthly Budget Sheet math + CSV. Pure: no DOM, no network.
 * Works in the browser (window.Sheet) and in Node (require('./sheet.js')).
 *
 * Data model (all money is in whole CENTS, integers, so there is no float drift):
 *
 *   sheet = {
 *     v: 1,
 *     month: 'YYYY-MM',
 *     rows: [{ id: 'r1', section: 'income'|'need'|'want'|'save', name: 'Food',
 *              planned: 5000,     // cents, >= 0
 *              actual: 4500 }],   // cents the teen TYPED in (the "base"), or null = not entered
 *     log:  [{ id: 'l1', rowId: 'r3', amount: 1250, note: 'Lunch', date: 'YYYY-MM-DD' }],
 *     nextId: 7                    // ids are never reused inside a sheet
 *   }
 *
 *   Row actual (what the sheet shows and totals use)
 *       = typed actual (0 if blank) + sum of that row's spending-log amounts.
 *   Adding a log entry raises that row's actual; deleting it lowers it again.
 *   The typed part is never changed by the log, so the two never drift apart.
 *   A row "has an actual" when something was typed (even 0) or it has log entries.
 *
 *   Difference = Actual − Planned, for every row and total.
 *     Income and Savings rows: a positive difference is good (earned / saved more).
 *     Needs and Wants rows:    a positive difference is bad (spent more than planned).
 *   Spent = Needs + Wants + Savings (every dollar you gave a job).
 *   Money left over = Income − Spent, for Planned and for Actual.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sheet = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SECTIONS = [
    { id: 'income', label: 'Income', one: 'income', section: 'Income' },
    { id: 'need', label: 'Needs', one: 'need', section: 'Expenses' },
    { id: 'want', label: 'Wants', one: 'want', section: 'Expenses' },
    { id: 'save', label: 'Savings', one: 'savings', section: 'Savings' }
  ];
  var SECTION_BY_ID = {};
  SECTIONS.forEach(function (s) { SECTION_BY_ID[s.id] = s; });

  var MAX_CENTS = 1000000000; // $10,000,000: anything bigger is a typo
  var NAME_MAX = 40;
  var NOTE_MAX = 60;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  /* ---------- cents ---------- */

  /* Text the teen typed -> whole cents.
   *   ''/blank -> null (nothing entered)
   *   '12', '$1,234.5', '.75', '3.456' (third decimal rounds half up) -> cents
   *   negative, letters, more than $10,000,000 -> NaN (invalid) */
  function parseCents(text) {
    if (text == null) return null;
    var s = String(text).replace(/[$,\s]/g, '');
    if (s === '') return null;
    var m = /^(\d*)(?:\.(\d*))?$/.exec(s);
    if (!m || (m[1] === '' && !(m[2] && m[2].length))) return NaN;
    var whole = m[1] ? parseInt(m[1].replace(/^0+(?=\d)/, ''), 10) : 0;
    var frac = (m[2] || '') + '000';
    var c = whole * 100 + parseInt(frac.slice(0, 2), 10) + (frac.charAt(2) >= '5' ? 1 : 0);
    return c > MAX_CENTS || !isFinite(c) ? NaN : c;
  }

  /* A JS number of dollars (e.g. from the Budget Builder) -> whole cents, >= 0. */
  function toCents(dollars) {
    var n = typeof dollars === 'number' ? dollars : parseFloat(dollars);
    if (!isFinite(n) || n <= 0) return 0;
    var c = parseCents(n.toFixed(6));
    return isFinite(c) && c !== null ? c : MAX_CENTS;
  }

  function isCents(c) { return typeof c === 'number' && isFinite(c) && Math.floor(c) === c; }

  /* cents -> '1234.50' / '-5.00' (no $ or commas: for inputs and CSV) */
  function plain(c) {
    var neg = c < 0, a = Math.abs(c);
    var d = Math.floor(a / 100), r = a % 100;
    return (neg ? '-' : '') + d + '.' + (r < 10 ? '0' : '') + r;
  }

  /* cents -> '$1,234.50' / '−$5.00' (same look as Money.fmt) */
  function fmt(c) {
    var p = plain(Math.abs(c)).split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (c < 0 ? '−$' : '$') + p.join('.');
  }

  /* ---------- months ---------- */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isMonthKey(k) { return typeof k === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(k); }
  function monthKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1); }
  function shiftMonth(key, n) {
    var y = parseInt(key.slice(0, 4), 10), m = parseInt(key.slice(5, 7), 10) - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + pad2(m + 1);
  }
  function monthLabel(key) { return MONTHS[parseInt(key.slice(5, 7), 10) - 1] + ' ' + key.slice(0, 4); }
  function daysInMonth(key) {
    var y = parseInt(key.slice(0, 4), 10), m = parseInt(key.slice(5, 7), 10);
    return [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }
  function dateInMonth(date, key) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date.slice(0, 7) !== key) return false;
    var d = parseInt(date.slice(8), 10);
    return d >= 1 && d <= daysInMonth(key);
  }

  /* ---------- building sheets ---------- */

  var TEMPLATE = [
    ['income', 'Paycheck'], ['income', 'Allowance or gifts'],
    ['need', 'Phone'], ['need', 'Gas or bus fare'], ['need', 'Food and snacks'],
    ['want', 'Eating out'], ['want', 'Fun and entertainment'], ['want', 'Clothes'],
    ['save', 'Savings account'], ['save', 'Emergency fund']
  ];

  function blankSheet(month) { return { v: 1, month: month, rows: [], log: [], nextId: 1 }; }

  function clone(sheet) { return JSON.parse(JSON.stringify(sheet)); }

  function takeId(sheet, prefix) { var id = prefix + sheet.nextId; sheet.nextId++; return id; }

  /* The starting point for a month that has no sheet yet: common rows, all $0. */
  function template(month) {
    var s = blankSheet(month);
    TEMPLATE.forEach(function (t) { s.rows.push({ id: takeId(s, 'r'), section: t[0], name: t[1], planned: 0, actual: null }); });
    return s;
  }

  function cleanName(name) { return String(name == null ? '' : name).replace(/[\r\n\t]+/g, ' ').slice(0, NAME_MAX); }

  function addRow(sheet, section, name) {
    var s = clone(sheet);
    if (!SECTION_BY_ID[section]) section = 'want';
    var row = { id: takeId(s, 'r'), section: section, name: cleanName(name), planned: 0, actual: null };
    // keep rows grouped: insert after the last row of the same section
    var at = -1;
    s.rows.forEach(function (r, i) { if (r.section === section) at = i; });
    if (at === -1) s.rows.push(row); else s.rows.splice(at + 1, 0, row);
    return s;
  }

  /* Removes a row AND its spending-log entries (they belonged to it). */
  function removeRow(sheet, rowId) {
    var s = clone(sheet);
    s.rows = s.rows.filter(function (r) { return r.id !== rowId; });
    s.log = s.log.filter(function (e) { return e.rowId !== rowId; });
    return s;
  }

  /* patch: { name?, planned? (cents >= 0), actual? (cents >= 0 or null) } */
  function setRow(sheet, rowId, patch) {
    var s = clone(sheet);
    s.rows.forEach(function (r) {
      if (r.id !== rowId) return;
      if ('name' in patch) r.name = cleanName(patch.name);
      if ('planned' in patch && isCents(patch.planned) && patch.planned >= 0) r.planned = patch.planned;
      if ('actual' in patch && (patch.actual === null || (isCents(patch.actual) && patch.actual >= 0))) r.actual = patch.actual;
    });
    return s;
  }

  /* entry: { rowId, amount (cents > 0), note, date 'YYYY-MM-DD' inside the sheet's month }
   * -> { sheet, error } (error is a plain sentence, or null) */
  function addLog(sheet, entry) {
    var row = sheet.rows.filter(function (r) { return r.id === entry.rowId; })[0];
    if (!row) return { sheet: sheet, error: 'Pick a category.' };
    if (row.section === 'income') return { sheet: sheet, error: 'The spending log is for needs, wants, and savings. Type income in its Actual box.' };
    if (!isCents(entry.amount) || entry.amount <= 0) return { sheet: sheet, error: 'Type an amount more than $0, like 12.50.' };
    if (entry.amount > MAX_CENTS) return { sheet: sheet, error: 'That amount is too big.' };
    if (!dateInMonth(entry.date, sheet.month)) return { sheet: sheet, error: 'Pick a date in ' + monthLabel(sheet.month) + '.' };
    var s = clone(sheet);
    s.log.push({ id: takeId(s, 'l'), rowId: row.id, amount: entry.amount, note: String(entry.note || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, NOTE_MAX), date: entry.date });
    return { sheet: s, error: null };
  }

  function deleteLog(sheet, logId) {
    var s = clone(sheet);
    s.log = s.log.filter(function (e) { return e.id !== logId; });
    return s;
  }

  /* Log entries, oldest first (date, then the order they were added). */
  function sortedLog(sheet) {
    return sheet.log.map(function (e, i) { return { e: e, i: i }; }).sort(function (a, b) {
      return a.e.date < b.e.date ? -1 : a.e.date > b.e.date ? 1 : a.i - b.i;
    }).map(function (x) { return x.e; });
  }

  function hasData(sheet) {
    if (!sheet) return false;
    return sheet.log.length > 0 || sheet.rows.some(function (r) { return r.planned !== 0 || r.actual !== null; });
  }

  /* Most recent month BEFORE `month` that has a saved sheet (keys are 'YYYY-MM', so text order = time order). */
  function latestBefore(sheets, month) {
    var best = null;
    Object.keys(sheets || {}).forEach(function (k) {
      if (isMonthKey(k) && k < month && sheets[k] && (best === null || k > best)) best = k;
    });
    return best;
  }

  /* New sheet for `month`: same rows, names and planned amounts as `src`; actuals blank; empty log. */
  function copyPlan(src, month) {
    var s = blankSheet(month);
    src.rows.forEach(function (r) { s.rows.push({ id: takeId(s, 'r'), section: r.section, name: r.name, planned: r.planned, actual: null }); });
    return s;
  }

  function nameKey(section, name) { return section + '|' + String(name || '').trim().toLowerCase(); }

  /* Bring a Budget Builder plan ({ income, cats: [{ name, group, amount }] }) in as Planned amounts.
   *  - Rows become: one income row "Take-home pay" (= builder income) + one row per builder category.
   *  - An existing row with the same section + name (ignoring case/spaces) keeps its id,
   *    its actual and its log entries; only Planned changes.
   *  - Existing rows not in the builder plan are dropped, UNLESS they have an actual or
   *    log entries: those stay (Planned set to $0) so no tracked money disappears. */
  function fromBudget(sheet, budget) {
    var s = clone(sheet);
    var byKey = {};
    s.rows.forEach(function (r) { var k = nameKey(r.section, r.name); if (!byKey[k]) byKey[k] = r; });
    var wanted = [{ section: 'income', name: 'Take-home pay', planned: toCents(budget && budget.income) }];
    ((budget && budget.cats) || []).forEach(function (c) {
      wanted.push({ section: SECTION_BY_ID[c.group] && c.group !== 'income' ? c.group : 'want', name: cleanName(c.name), planned: toCents(c.amount) });
    });
    var used = {}, rows = [];
    wanted.forEach(function (w) {
      var k = nameKey(w.section, w.name);
      var old = byKey[k];
      if (old && !used[old.id]) { used[old.id] = true; rows.push({ id: old.id, section: w.section, name: w.name, planned: w.planned, actual: old.actual }); }
      else rows.push({ id: takeId(s, 'r'), section: w.section, name: w.name, planned: w.planned, actual: null });
    });
    var logged = {};
    s.log.forEach(function (e) { logged[e.rowId] = true; });
    s.rows.forEach(function (r) {
      if (!used[r.id] && (r.actual !== null || logged[r.id])) rows.push({ id: r.id, section: r.section, name: r.name, planned: 0, actual: r.actual });
    });
    // group order: income, needs, wants, savings (stable inside each group)
    var order = { income: 0, need: 1, want: 2, save: 3 };
    s.rows = rows.map(function (r, i) { return { r: r, i: i }; })
      .sort(function (a, b) { return (order[a.r.section] - order[b.r.section]) || (a.i - b.i); })
      .map(function (x) { return x.r; });
    return s;
  }

  /* ---------- math + wording ---------- */

  function label(row) {
    var n = String(row.name || '').trim();
    return n || ('this ' + SECTION_BY_ID[row.section].one + ' item');
  }

  /* Is a difference good for this kind of line? income/save: more is good; need/want: less is good. */
  function goodness(section, diff) {
    if (diff === 0) return 'even';
    if (section === 'income' || section === 'save') return diff > 0 ? 'good' : 'bad';
    return diff < 0 ? 'good' : 'bad';
  }

  function rowStatus(r) {
    if (!r.hasActual || r.diff === 0) return null;
    var a = fmt(Math.abs(r.diff)), n = label(r);
    if (r.section === 'income') return r.diff > 0
      ? { kind: 'good', text: 'You earned ' + a + ' more than planned from ' + n }
      : { kind: 'bad', text: 'You earned ' + a + ' less than planned from ' + n };
    if (r.section === 'save') return r.diff > 0
      ? { kind: 'good', text: 'You saved ' + a + ' more than planned for ' + n }
      : { kind: 'bad', text: 'You saved ' + a + ' less than planned for ' + n };
    return r.diff > 0
      ? { kind: 'bad', text: 'You spent ' + a + ' more than planned on ' + n }
      : { kind: 'good', text: 'You\'re ' + a + ' under plan on ' + n };
  }

  function summarize(sheet) {
    var logged = {};
    sheet.log.forEach(function (e) { logged[e.rowId] = (logged[e.rowId] || 0) + e.amount; });
    var groups = {};
    SECTIONS.forEach(function (g) { groups[g.id] = { planned: 0, actual: 0, diff: 0, count: 0, hasActual: false }; });
    var anyActual = false;
    var rows = sheet.rows.map(function (row) {
      var base = row.actual === null ? 0 : row.actual;
      var lg = logged[row.id] || 0;
      var has = row.actual !== null || lg > 0;
      var actual = base + lg;
      var r = { id: row.id, section: row.section, name: row.name, planned: row.planned, base: base, typed: row.actual !== null,
        logged: lg, actual: actual, hasActual: has, diff: actual - row.planned };
      r.good = has ? goodness(row.section, r.diff) : 'none';
      r.status = rowStatus(r);
      var g = groups[row.section];
      g.planned += row.planned; g.actual += actual; g.count++;
      if (has) { g.hasActual = true; anyActual = true; }
      return r;
    });
    SECTIONS.forEach(function (g) { var x = groups[g.id]; x.diff = x.actual - x.planned; x.good = goodness(g.id, x.diff); });
    var income = { planned: groups.income.planned, actual: groups.income.actual };
    var spent = {
      planned: groups.need.planned + groups.want.planned + groups.save.planned,
      actual: groups.need.actual + groups.want.actual + groups.save.actual
    };
    var left = { planned: income.planned - spent.planned, actual: income.actual - spent.actual };
    [income, spent, left].forEach(function (t) { t.diff = t.actual - t.planned; });
    income.good = goodness('income', income.diff);
    left.good = goodness('income', left.diff); // more left over than planned is good
    spent.good = 'neutral';                    // mixes spending (less is good) and saving (more is good)

    var overall;
    if (!anyActual) overall = { kind: 'info', text: 'No actual amounts yet. Type them in, or use the spending log as the month goes.' };
    else if (left.actual > 0) overall = { kind: 'good', text: 'You have ' + fmt(left.actual) + ' left this month' };
    else if (left.actual === 0) overall = { kind: 'good', text: 'You have $0.00 left this month. Every dollar was used' };
    else overall = { kind: 'bad', text: 'You spent ' + fmt(-left.actual) + ' more than you earned' };

    var plan;
    if (income.planned === 0 && spent.planned === 0) plan = { kind: 'info', text: 'Start by typing your planned income' };
    else if (left.planned > 0) plan = { kind: 'info', text: 'Your plan leaves ' + fmt(left.planned) + ' without a job. Give it one (savings is a great choice)' };
    else if (left.planned === 0) plan = { kind: 'good', text: 'Your plan gives every dollar a job' };
    else plan = { kind: 'bad', text: 'Your plan spends ' + fmt(-left.planned) + ' more than your income' };

    return { month: sheet.month, rows: rows, groups: groups, income: income, spent: spent, left: left,
      hasActual: anyActual, overall: overall, plan: plan,
      statuses: rows.filter(function (r) { return r.status; }).map(function (r) { return r.status; }),
      logTotal: sheet.log.reduce(function (t, e) { return t + e.amount; }, 0) };
  }

  /* ---------- CSV ---------- */

  /* One CSV cell for TEXT. Formula guard: text starting with = + - @ (or tab / carriage return)
   * gets a leading ' so Excel/Sheets show it as text instead of running it.
   * Then RFC 4180 quoting: wrap in "..." if it has a comma, quote, or line break; double the quotes. */
  function csvText(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = '\'' + s;
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /* Numbers the app computed (never user text) are written plainly, e.g. -5.00. */
  function csvMoney(c) { return c === null || c === undefined ? '' : plain(c); }

  function csvFilename(month) { return 'money-lab-budget-' + month + '.csv'; }

  /* Columns: Section,Group,Item,Planned,Actual,Difference (Difference = Actual − Planned).
   * Then each group's subtotal, the totals, a blank line, and the spending log.
   * Starts with a UTF-8 byte order mark so Excel reads it as UTF-8. Lines end in CRLF. */
  function toCSV(sheet) {
    var s = summarize(sheet);
    var out = [];
    function line(cells) { out.push(cells.join(',')); }
    line(['Section', 'Group', 'Item', 'Planned', 'Actual', 'Difference']);
    SECTIONS.forEach(function (g) {
      s.rows.filter(function (r) { return r.section === g.id; }).forEach(function (r) {
        line([csvText(g.section), csvText(g.label), csvText(r.name), csvMoney(r.planned),
          r.hasActual ? csvMoney(r.actual) : '', r.hasActual ? csvMoney(r.diff) : '']);
      });
      var t = s.groups[g.id];
      line(['Subtotal', csvText(g.label), csvText(g.label + ' total'), csvMoney(t.planned), csvMoney(t.actual), csvMoney(t.diff)]);
    });
    line(['Total', '', 'Total income', csvMoney(s.income.planned), csvMoney(s.income.actual), csvMoney(s.income.diff)]);
    line(['Total', '', csvText('Total spent (needs + wants + savings)'), csvMoney(s.spent.planned), csvMoney(s.spent.actual), csvMoney(s.spent.diff)]);
    line(['Total', '', csvText('Money left over (income - spent)'), csvMoney(s.left.planned), csvMoney(s.left.actual), csvMoney(s.left.diff)]);
    out.push('');
    line([csvText('Spending log: ' + monthLabel(sheet.month))]);
    line(['Date', 'Group', 'Item', 'Amount', 'Note']);
    var byId = {};
    sheet.rows.forEach(function (r) { byId[r.id] = r; });
    sortedLog(sheet).forEach(function (e) {
      var r = byId[e.rowId] || { name: '', section: 'want' };
      line([e.date, csvText(SECTION_BY_ID[r.section].label), csvText(r.name), csvMoney(e.amount), csvText(e.note)]);
    });
    line(['Log total', '', '', csvMoney(s.logTotal), '']);
    return '﻿' + out.join('\r\n') + '\r\n';
  }

  return {
    SECTIONS: SECTIONS, MAX_CENTS: MAX_CENTS, NAME_MAX: NAME_MAX, NOTE_MAX: NOTE_MAX,
    parseCents: parseCents, toCents: toCents, plain: plain, fmt: fmt,
    isMonthKey: isMonthKey, monthKey: monthKey, shiftMonth: shiftMonth, monthLabel: monthLabel,
    daysInMonth: daysInMonth, dateInMonth: dateInMonth,
    template: template, blankSheet: blankSheet, addRow: addRow, removeRow: removeRow, setRow: setRow,
    addLog: addLog, deleteLog: deleteLog, sortedLog: sortedLog, hasData: hasData,
    latestBefore: latestBefore, copyPlan: copyPlan, fromBudget: fromBudget,
    goodness: goodness, summarize: summarize,
    csvText: csvText, toCSV: toCSV, csvFilename: csvFilename
  };
}));
