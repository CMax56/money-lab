/* Money Lab — pure money math. No DOM, no network.
 * Works in the browser (window.Money) and in Node (require('./money.js')).
 *
 * Conventions (shown in the app, too):
 *  - Debt interest: each month, interest = balance × APR / 12 / 100 is added
 *    BEFORE that month's payment. The last payment is partial (you only pay
 *    what you still owe). Internal math uses plain floats; money is rounded to
 *    cents only for display.
 *  - Credit card "minimum payment" mode uses a common rule:
 *      minimum = the larger of $25 (or the whole balance if less than $25)
 *                and 1% of the balance + that month's interest.
 *  - Savings growth: monthly compounding (rate / 12 each month), deposits at
 *    the END of each month. FV = P(1+r)^n + PMT((1+r)^n − 1)/r.
 *    Inputs are clamped to what the app allows: rate 0–30%, years 0–60.
 *  - Plans are capped at MAX_MONTHS (600). A result that doesn't finish has a
 *    status: 'payment-too-small' (the payment never beats the interest) or
 *    'hit-limit' (it was shrinking, but still not paid off at the cap).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Money = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_MONTHS = 600; // 50 years: if a plan takes longer, we call it "never"
  var DUST = 0.005;     // balances under half a cent count as paid off
  var RATE_MAX = 30;    // savings rate % (the UI slider goes to 12)
  var YEARS_MAX = 60;   // savings years (the UI slider goes to 50)

  function num(x, fallback) {
    var n = typeof x === 'string' ? parseFloat(x.replace(/[$,\s]/g, '')) : Number(x);
    return isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
  }

  function round2(x) {
    var s = x < 0 ? -1 : 1;
    return s * Math.round((Math.abs(x) + 1e-9) * 100) / 100;
  }

  function fmt(x, opts) {
    opts = opts || {};
    var v = round2(num(x));
    var neg = v < 0;
    var parts = Math.abs(v).toFixed(opts.noCents ? 0 : 2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '−$' : '$') + parts.join('.');
  }

  function monthlyRate(apr) { return num(apr) / 12 / 100; }

  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  // Month cap for a plan: a positive whole number, never more than MAX_MONTHS.
  // Missing, 0, negative, NaN, Infinity, or anything bigger -> MAX_MONTHS.
  function capMonths(x) {
    var n = Math.floor(num(x, MAX_MONTHS));
    return n >= 1 && n <= MAX_MONTHS ? n : MAX_MONTHS;
  }

  function cents(x) { return Math.round(round2(num(x)) * 100); }

  /* ---------- 50/30/20 ---------- */

  function split503020(income) {
    income = Math.max(0, num(income));
    var needs = round2(income * 0.5);
    var wants = round2(income * 0.3);
    // savings takes the leftover cent so the three always add up to income
    var savings = round2(income - needs - wants);
    return { needs: needs, wants: wants, savings: savings };
  }

  /* ---------- Paycheck (example rates only) ---------- */

  var EXAMPLE_RATES = { federal: 10, state: 4, socialSecurity: 6.2, medicare: 1.45 };

  function paycheck(o) {
    o = o || {};
    var hourly = Math.max(0, num(o.hourly));
    var hours = Math.max(0, num(o.hours));
    var rates = {};
    Object.keys(EXAMPLE_RATES).forEach(function (k) {
      rates[k] = o.rates && o.rates[k] != null ? clamp(num(o.rates[k]), 0, 100) : EXAMPLE_RATES[k];
    });
    var gross = round2(hourly * hours);
    var ratesTotal = Object.keys(rates).reduce(function (s, k) { return s + rates[k]; }, 0);
    // Work in cents. Each line is capped at what's still left of gross, so the
    // lines can never add up to more than gross and net pay never goes negative.
    var grossC = cents(gross), leftC = grossC, capped = false;
    var lines = Object.keys(rates).map(function (k) {
      var want = cents(gross * rates[k] / 100);
      var amt = Math.min(want, leftC);
      if (amt < want) capped = true;
      leftC -= amt;
      return { key: k, pct: rates[k], amount: amt / 100 };
    });
    var withheld = (grossC - leftC) / 100;
    return { gross: gross, lines: lines, withheld: withheld, net: leftC / 100,
      ratesTotal: ratesTotal, overLimit: ratesTotal > 100 + 1e-9, capped: capped };
  }

  /* ---------- Budget ---------- */

  // cats: [{ name, group: 'need'|'want'|'save', amount }]
  function budgetSummary(income, cats) {
    income = Math.max(0, num(income));
    var by = { need: 0, want: 0, save: 0 };
    var total = 0;
    (cats || []).forEach(function (c) {
      var a = Math.max(0, num(c.amount));
      total += a;
      if (by[c.group] !== undefined) by[c.group] += a;
    });
    var pct = function (v) { return income > 0 ? v / income * 100 : 0; };
    return {
      income: income,
      total: round2(total),
      remaining: round2(income - total),
      over: total - income > DUST,
      groups: {
        need: { amount: round2(by.need), pct: pct(by.need) },
        want: { amount: round2(by.want), pct: pct(by.want) },
        save: { amount: round2(by.save), pct: pct(by.save) }
      },
      target: split503020(income)
    };
  }

  /* ---------- Savings goal ---------- */

  // Whole cents only: 0 if the goal is met, otherwise ceil(shortfall ÷ per week),
  // so any shortfall of at least a cent takes at least 1 week. null = never ($0/week).
  function goalWeeks(goal, saved, perWeek) {
    var leftC = cents(goal) - cents(saved);
    if (leftC <= 0) return 0;
    var weekC = cents(perWeek);
    if (weekC <= 0) return null;
    return Math.floor((leftC + weekC - 1) / weekC);
  }

  function addDays(date, days) {
    var d = new Date(date.getTime());
    d.setDate(d.getDate() + days);
    return d;
  }

  function addMonths(date, months) {
    var d = new Date(date.getFullYear(), date.getMonth() + months, 1);
    return d;
  }

  /* ---------- Compound interest ---------- */

  function savingsRate(ratePct) { return clamp(num(ratePct), 0, RATE_MAX) / 12 / 100; }

  function compound(o) {
    o = o || {};
    var P = Math.max(0, num(o.start));
    var pmt = Math.max(0, num(o.monthly));
    var r = savingsRate(o.rate);            // never negative, so the growth factor is >= 1
    var years = clamp(Math.round(num(o.years)), 0, YEARS_MAX);
    var bal = P, contrib = P;
    var rows = [{ year: 0, contributions: P, interest: 0, balance: P }];
    for (var m = 1; m <= years * 12; m++) {
      bal = bal * (1 + r) + pmt; // interest on what was there, then the end-of-month deposit
      contrib += pmt;
      if (m % 12 === 0) rows.push({ year: m / 12, contributions: contrib, interest: bal - contrib, balance: bal });
    }
    return { rows: rows, final: bal, contributions: contrib, interest: bal - contrib };
  }

  function futureValue(P, pmt, ratePct, months) {
    P = Math.max(0, num(P));
    pmt = Math.max(0, num(pmt));
    var r = savingsRate(ratePct);
    var n = clamp(Math.round(num(months)), 0, YEARS_MAX * 12);
    if (r === 0) return P + pmt * n;
    // (1+r)^n − 1 via expm1/log1p: stays accurate when r is tiny
    var gm1 = Math.expm1(n * Math.log1p(r));
    return P * (gm1 + 1) + pmt * gm1 / r;
  }

  /* ---------- Credit card / single loan payoff ---------- */

  // Custom rule values must be finite and >= 0; anything else uses the default.
  function minimumRule(rule) {
    rule = rule || {};
    var ok = function (v) { var n = num(v, NaN); return isFinite(n) && n >= 0 ? n : null; };
    var f = rule.floor != null ? ok(rule.floor) : null;
    var p = rule.pct != null ? ok(rule.pct) : null;
    return { floor: f === null ? 25 : f, pct: p === null ? 1 : p };
  }

  function minimumPayment(balance, interest, rule) {
    var R = minimumRule(rule);
    var floor = R.floor, pct = R.pct;
    balance = Math.max(0, num(balance));
    interest = Math.max(0, num(interest));
    var owed = balance + interest;
    var m = Math.max(Math.min(floor, owed), balance * pct / 100 + interest);
    return Math.min(m, owed);
  }

  // o: { balance, apr, payment, mode: 'fixed'|'minimum', maxMonths }
  function payoff(o) {
    var bal = Math.max(0, num(o.balance));
    var r = monthlyRate(o.apr);
    var mode = o.mode === 'minimum' ? 'minimum' : 'fixed';
    var pay = Math.max(0, num(o.payment));
    var cap = capMonths(o.maxMonths);
    var firstInterest = bal * r;
    var res = {
      mode: mode, months: 0, totalInterest: 0, totalPaid: 0, schedule: [],
      neverPaysOff: false, reason: '', status: 'paid-off', maxMonths: cap,
      firstInterest: firstInterest, firstPayment: 0
    };
    if (bal <= DUST) return res;
    var tooSmall = function () {
      res.neverPaysOff = true;
      res.reason = res.status = 'payment-too-small';
      res.months = 0; res.totalInterest = 0; res.totalPaid = 0; res.schedule = [];
      return res;
    };
    if (mode === 'fixed' && pay <= firstInterest + 1e-9) return tooSmall();
    var m = 0;
    while (bal > DUST && m < cap) {
      m++;
      var start = bal;
      var interest = bal * r;
      var p = mode === 'minimum' ? minimumPayment(bal, interest, o.rule) : Math.min(pay, bal + interest);
      // a payment that doesn't shrink the balance (and doesn't finish it) never pays off
      if (p <= interest + 1e-9 && bal + interest - p > DUST) return tooSmall();
      if (m === 1) res.firstPayment = p;
      bal = bal + interest - p;
      if (bal < DUST) bal = 0;
      res.totalInterest += interest;
      res.totalPaid += p;
      res.schedule.push({ month: m, start: start, interest: interest, payment: p, end: bal });
    }
    res.months = m;
    if (bal > DUST) { res.neverPaysOff = true; res.reason = res.status = 'hit-limit'; res.balanceLeft = bal; }
    return res;
  }

  /* ---------- Debt snowball / avalanche ---------- */

  // debts: [{ name, balance, minPayment, apr }]
  // o: { extra, method: 'snowball'|'avalanche', rollover (default true), maxMonths }
  // Fixed order, decided once from each debt's STARTING balance (snowball) or APR
  // (avalanche); it is not re-ranked month to month. $0 / blank debts are left out.
  function payoffOrder(debts, method) {
    var idx = [];
    debts.forEach(function (d, i) { if (Math.max(0, num(d.balance)) > DUST) idx.push(i); });
    idx.sort(function (a, b) {
      var A = debts[a], B = debts[b];
      if (method === 'avalanche') {
        if (num(B.apr) !== num(A.apr)) return num(B.apr) - num(A.apr); // highest APR first
        if (num(A.balance) !== num(B.balance)) return num(A.balance) - num(B.balance); // tie: smaller balance
        return a - b;
      }
      if (num(A.balance) !== num(B.balance)) return num(A.balance) - num(B.balance); // smallest balance first
      if (num(B.apr) !== num(A.apr)) return num(B.apr) - num(A.apr); // tie: higher APR
      return a - b;
    });
    return idx;
  }

  function debtPlan(debts, o) {
    o = o || {};
    var method = o.method === 'avalanche' ? 'avalanche' : 'snowball';
    var rollover = o.rollover !== false;
    var extra = Math.max(0, num(o.extra));
    var cap = capMonths(o.maxMonths);
    var list = (debts || []).map(function (d, i) {
      var b = Math.max(0, num(d.balance));
      return {
        name: String(d.name || ('Debt ' + (i + 1))),
        balance: b,
        // a $0 or blank debt is ignored: its minimum is NOT part of the monthly budget
        minPayment: b > DUST ? Math.max(0, num(d.minPayment)) : 0,
        apr: Math.max(0, num(d.apr)),
        ignored: !(b > DUST)
      };
    });
    var order = payoffOrder(list, method);
    var bal = list.map(function (d) { return d.balance; });
    var budget = list.reduce(function (s, d) { return s + d.minPayment; }, 0) + extra;
    var per = list.map(function (d) {
      return { name: d.name, interest: 0, paid: 0, paidOffMonth: d.balance <= DUST ? 0 : null, ignored: d.ignored,
        minCoversInterest: d.minPayment > d.balance * monthlyRate(d.apr) + 1e-9 || d.balance <= DUST };
    });
    var timeline = [];
    var totalInterest = 0, totalPaid = 0, m = 0;
    var active = function () { return bal.some(function (b) { return b > DUST; }); };

    while (active() && m < cap) {
      m++;
      var interest = list.map(function () { return 0; });
      var pays = list.map(function () { return 0; });
      var paidOffNow = [];
      // 1) interest on every open debt
      for (var i = 0; i < list.length; i++) {
        if (bal[i] > DUST) {
          interest[i] = bal[i] * monthlyRate(list[i].apr);
          bal[i] += interest[i];
        }
      }
      // 2) minimums on every open debt
      var spent = 0;
      for (i = 0; i < list.length; i++) {
        if (bal[i] > DUST) {
          var p = Math.min(list[i].minPayment, bal[i]);
          pays[i] += p; bal[i] -= p; spent += p;
        }
      }
      // 3) the rest of the monthly budget (extra + freed-up minimums) goes to targets in order
      var pool = rollover ? budget - spent : extra;
      for (var k = 0; k < order.length && pool > DUST; k++) {
        var j = order[k];
        if (bal[j] <= DUST) continue;
        var q = Math.min(pool, bal[j]);
        pays[j] += q; bal[j] -= q; pool -= q;
      }
      for (i = 0; i < list.length; i++) {
        if (bal[i] < DUST) bal[i] = 0;
        per[i].interest += interest[i];
        per[i].paid += pays[i];
        totalInterest += interest[i];
        totalPaid += pays[i];
        if (bal[i] === 0 && per[i].paidOffMonth === null) { per[i].paidOffMonth = m; paidOffNow.push(i); }
      }
      timeline.push({ month: m, balances: bal.slice(), payments: pays, interest: interest, paidOff: paidOffNow });
    }
    var never = active();
    var status = 'paid-off';
    if (never) {
      // 'payment-too-small': some debt is no smaller than when it started (its payments
      // never beat its interest). Otherwise it was shrinking but ran out of months.
      status = list.some(function (d, i) { return bal[i] > DUST && bal[i] >= d.balance - DUST; })
        ? 'payment-too-small' : 'hit-limit';
    }
    return {
      method: method, rollover: rollover, budget: budget, extra: extra,
      order: order, debts: per, months: m, timeline: timeline,
      totalInterest: totalInterest, totalPaid: totalPaid,
      neverPaysOff: never, status: status, maxMonths: cap,
      ignoredCount: list.filter(function (d) { return d.ignored; }).length,
      startTotal: list.reduce(function (s, d) { return s + d.balance; }, 0)
    };
  }

  /* ---------- Credit utilization ---------- */

  function utilization(balance, limit) {
    var L = num(limit);
    if (!(L > 0)) return null;
    return Math.max(0, num(balance)) / L * 100;
  }

  return {
    MAX_MONTHS: MAX_MONTHS, EXAMPLE_RATES: EXAMPLE_RATES, RATE_MAX: RATE_MAX, YEARS_MAX: YEARS_MAX,
    capMonths: capMonths, minimumRule: minimumRule,
    num: num, round2: round2, fmt: fmt, monthlyRate: monthlyRate,
    split503020: split503020, paycheck: paycheck, budgetSummary: budgetSummary,
    goalWeeks: goalWeeks, addDays: addDays, addMonths: addMonths,
    compound: compound, futureValue: futureValue,
    minimumPayment: minimumPayment, payoff: payoff,
    payoffOrder: payoffOrder, debtPlan: debtPlan, utilization: utilization
  };
}));
