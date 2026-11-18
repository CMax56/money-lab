#!/usr/bin/env node
/* Runs js/money.js in Node for tools/validate.py.
 *
 *   node tools/test_money.js cases.json   -> prints a JSON array of results, one per case
 *   node tools/test_money.js              -> runs a few built-in sanity checks
 *
 * Each case: { fn: 'payoff' | 'debtPlan' | 'compound' | 'futureValue' | 'goalWeeks' |
 *              'split503020' | 'budgetSummary' | 'paycheck' | 'utilization' | 'payoffOrder', args: [...] }
 * Results are trimmed to the numbers validate.py compares (no long schedules).
 */
'use strict';
var path = require('path');
var fs = require('fs');
var M = require(path.join(__dirname, '..', 'js', 'money.js'));
var Sh = require(path.join(__dirname, '..', 'js', 'sheet.js'));

/* Budget Sheet (js/sheet.js) cases: { fn: 'sheet.<name>', args } or { fn: 'sheetOps', args: [sheet, ops] }. */
function sumView(z) {
  return { rows: z.rows.map(function (r) { return { id: r.id, actual: r.actual, logged: r.logged, hasActual: r.hasActual, diff: r.diff, good: r.good, status: r.status }; }),
    groups: z.groups, income: z.income, spent: z.spent, left: z.left, hasActual: z.hasActual, overall: z.overall, plan: z.plan, statuses: z.statuses, logTotal: z.logTotal };
}
function runSheet(c) {
  var a = c.args || [];
  if (c.fn === 'sheetOps') {
    var sheet = a[0], errors = [], after = [];
    a[1].forEach(function (op) {
      if (op.op === 'addLog') { var r = Sh.addLog(sheet, op.entry); errors.push(r.error); sheet = r.sheet; }
      else if (op.op === 'deleteLog') { sheet = Sh.deleteLog(sheet, op.id); errors.push(null); }
      else if (op.op === 'addRow') { sheet = Sh.addRow(sheet, op.section, op.name); errors.push(null); }
      else if (op.op === 'removeRow') { sheet = Sh.removeRow(sheet, op.id); errors.push(null); }
      else if (op.op === 'setRow') { sheet = Sh.setRow(sheet, op.id, op.patch); errors.push(null); }
      else throw new Error('unknown op ' + op.op);
      after.push(Sh.summarize(sheet).rows.map(function (r) { return [r.id, r.actual]; }));
    });
    return { sheet: sheet, errors: errors, after: after, summary: sumView(Sh.summarize(sheet)) };
  }
  var name = c.fn.slice(6);
  if (name === 'summarize') return sumView(Sh.summarize(a[0]));
  if (typeof Sh[name] !== 'function') throw new Error('unknown sheet fn ' + name);
  var v = Sh[name].apply(null, a);
  return typeof v === 'number' && isNaN(v) ? '__NaN__' : v;
}

function run(c) {
  if (c.fn === 'sheetOps' || c.fn.indexOf('sheet.') === 0) return runSheet(c);
  var a = c.args || [];
  switch (c.fn) {
    case 'payoff': {
      var r = M.payoff(a[0]);
      return { months: r.months, totalInterest: r.totalInterest, totalPaid: r.totalPaid, neverPaysOff: r.neverPaysOff,
        reason: r.reason, status: r.status, maxMonths: r.maxMonths, firstPayment: r.firstPayment, lastPayment: r.schedule.length ? r.schedule[r.schedule.length - 1].payment : 0 };
    }
    case 'debtPlan': {
      var p = M.debtPlan(a[0], a[1]);
      return { months: p.months, totalInterest: p.totalInterest, totalPaid: p.totalPaid, neverPaysOff: p.neverPaysOff,
        status: p.status, maxMonths: p.maxMonths, budget: p.budget, order: p.order, paidOffMonths: p.debts.map(function (d) { return d.paidOffMonth; }),
        firstMonthPayments: p.timeline.length ? p.timeline[0].payments : [] };
    }
    case 'compound': {
      var q = M.compound(a[0]);
      return { final: q.final, contributions: q.contributions, interest: q.interest, years: q.rows.length - 1 };
    }
    case 'futureValue': return M.futureValue.apply(null, a);
    case 'goalWeeks': return M.goalWeeks.apply(null, a);
    case 'split503020': return M.split503020(a[0]);
    case 'budgetSummary': {
      var b = M.budgetSummary(a[0], a[1]);
      return { total: b.total, remaining: b.remaining, over: b.over, need: b.groups.need.amount, want: b.groups.want.amount, save: b.groups.save.amount };
    }
    case 'paycheck': {
      var pc = M.paycheck(a[0]);
      return { gross: pc.gross, withheld: pc.withheld, net: pc.net, overLimit: pc.overLimit, ratesTotal: pc.ratesTotal,
        lines: pc.lines.map(function (l) { return l.amount; }) };
    }
    case 'minimumPayment': return M.minimumPayment.apply(null, a);
    case 'utilization': return M.utilization(a[0], a[1]);
    case 'payoffOrder': return M.payoffOrder(a[0], a[1]);
    case 'fmt': return M.fmt(a[0]);
    default: throw new Error('unknown fn ' + c.fn);
  }
}

if (process.argv[2]) {
  // JSON has no NaN/Infinity, so validate.py sends them as these strings.
  var SPECIAL = { __NaN__: NaN, __Infinity__: Infinity, '__-Infinity__': -Infinity };
  var cases = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'), function (k, v) {
    return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SPECIAL, v) ? SPECIAL[v] : v;
  });
  var out = cases.map(function (c) {
    try { return { ok: true, value: run(c) }; } catch (e) { return { ok: false, error: String(e && e.stack || e) }; }
  });
  process.stdout.write(JSON.stringify(out));
} else {
  var fails = 0;
  function eq(name, got, want, tol) {
    var ok = typeof want === 'number' ? Math.abs(got - want) <= (tol || 0) : got === want;
    if (!ok) { fails++; console.log('FAIL', name, 'got', got, 'want', want); } else console.log('ok  ', name);
  }
  var r = M.payoff({ balance: 1000, apr: 18, payment: 50 });
  eq('1000 @18% $50 months', r.months, 24);
  eq('1000 @18% $50 interest', M.round2(r.totalInterest), 197.83, 0.001);
  eq('payment below interest never pays', M.payoff({ balance: 1000, apr: 24, payment: 20 }).neverPaysOff, true);
  eq('fmt', M.fmt(1234.5), '$1,234.50');
  eq('fmt negative', M.fmt(-50), '−$50.00');
  eq('goal weeks', M.goalWeeks(300, 40, 20), 13);
  eq('FV closed form', M.compound({ start: 1000, monthly: 100, rate: 6, years: 10 }).final, M.futureValue(1000, 100, 6, 120), 1e-6);
  // Review fixes
  eq('maxMonths Infinity -> 600', M.payoff({ balance: 10000, apr: 24, payment: 200.001, maxMonths: Infinity }).months, 600);
  eq('maxMonths 1e9 -> 600', M.payoff({ balance: 10000, apr: 24, payment: 200.001, maxMonths: 1e9 }).months, 600);
  eq('hit-limit status', M.payoff({ balance: 10000, apr: 24, payment: 200.001 }).status, 'hit-limit');
  eq('payment-too-small status', M.payoff({ balance: 1000, apr: 24, payment: 20 }).status, 'payment-too-small');
  eq('minimum rule 0/0 -> too small', M.payoff({ balance: 1000, apr: 24, mode: 'minimum', rule: { floor: 0, pct: 0 } }).status, 'payment-too-small');
  eq('bad rule -> default', M.minimumPayment(1000, 20, { floor: -5, pct: NaN }), M.minimumPayment(1000, 20));
  eq('debt plan ignores $0 debt minimum', M.debtPlan([{ balance: 0, minPayment: 25, apr: 10 }, { balance: 700, minPayment: 35, apr: 15 }], { extra: 20 }).budget, 55);
  eq('debt plan never: too small', M.debtPlan([{ balance: 20000, minPayment: 50, apr: 29 }]).status, 'payment-too-small');
  eq('debt plan never: hit limit', M.debtPlan([{ balance: 10000, minPayment: 200.001, apr: 24 }], { maxMonths: Infinity }).status, 'hit-limit');
  eq('compound negative rate -> 0', M.compound({ start: 100, monthly: 0, rate: -50, years: 10 }).final, 100, 1e-9);
  eq('compound years clamp 60', M.compound({ start: 0, monthly: 1, rate: 0, years: 1000 }).final, 720, 1e-9);
  eq('FV tiny rate', M.futureValue(0, 100, 1e-10, 120), 12000, 1e-6);
  eq('paycheck rates > 100% -> net 0', M.paycheck({ hourly: 10, hours: 10, rates: { federal: 90, state: 50, socialSecurity: 0, medicare: 0 } }).net, 0);
  eq('goal 1 cent short -> 1 week', M.goalWeeks(100, 99.99, 1000), 1);
  eq('goal met -> 0', M.goalWeeks(100, 100.004, 5), 0);
  // Budget Sheet (js/sheet.js)
  eq('sheet parse $1,234.5', Sh.parseCents('$1,234.5'), 123450);
  eq('sheet parse half-up', Sh.parseCents('0.125'), 13);
  eq('sheet parse blank -> null', Sh.parseCents('  '), null);
  eq('sheet parse negative -> NaN', isNaN(Sh.parseCents('-5')), true);
  eq('sheet 0.1 + 0.2 in cents', Sh.parseCents('0.1') + Sh.parseCents('0.2'), 30);
  var sh = Sh.setRow(Sh.template('2026-11'), 'r3', { planned: 5000 });
  var add = Sh.addLog(sh, { rowId: 'r3', amount: 1999, note: 'x', date: '2026-11-05' });
  eq('sheet log adds to actual', Sh.summarize(add.sheet).rows[2].actual, 1999);
  eq('sheet log delete subtracts', Sh.summarize(Sh.deleteLog(add.sheet, add.sheet.log[0].id)).rows[2].actual, 0);
  eq('sheet log date outside month', Sh.addLog(sh, { rowId: 'r3', amount: 100, date: '2026-12-01' }).error !== null, true);
  var sh2 = Sh.setRow(Sh.setRow(sh, 'r1', { planned: 10000, actual: 10000 }), 'r3', { actual: 7000 });
  eq('sheet over plan wording', Sh.summarize(sh2).statuses[0].text, 'You spent $20.00 more than planned on Phone');
  eq('sheet left wording', Sh.summarize(sh2).overall.text, 'You have $30.00 left this month');
  eq('sheet overspent wording', Sh.summarize(Sh.setRow(sh2, 'r3', { actual: 13000 })).overall.text, 'You spent $30.00 more than you earned');
  eq('sheet csv BOM', Sh.toCSV(sh2).charCodeAt(0), 0xFEFF);
  eq('sheet csv guard', Sh.csvText('=1+1'), '\'=1+1');
  eq('sheet csv quote', Sh.csvText('a "b", c'), '"a ""b"", c"');
  eq('sheet latest before', Sh.latestBefore({ '2026-09': {}, '2026-10': {}, '2026-12': {} }, '2026-11'), '2026-10');
  eq('sheet shift month', Sh.shiftMonth('2026-01', -1), '2025-12');
  process.exit(fails ? 1 : 0);
}
