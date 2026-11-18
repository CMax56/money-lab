#!/usr/bin/env python3
"""Validate Money Lab content, static files, and calculator math.

Run from anywhere:  python3 tools/validate.py

Checks:
  1. Content JSON parses and matches the schema: app.json lists section files
     that exist; every lesson / practice / quiz item / flashcard has the
     required fields; every question has an answer and an explanation;
     multiple-choice answer index is in range; ids are unique everywhere;
     tools named in sections exist in js/tools.js; sample budgets are valid.
  2. Numeric answers are recomputed: "check" (a plain arithmetic expression)
     or "verify" (a money scenario) is computed with the independent Python
     math below and must match the answer (number items) or a number in the
     correct choice (multiple-choice items). Number items must have one.
     Specific numbers quoted in lesson text are checked too (CLAIMS).
     Multiple-choice items whose numbers are not a calculation can carry
     "reviewed": "<why>" to mark them as checked by hand.
  3. Calculator math: js/money.js is run in Node (tools/test_money.js) on many
     cases and compared against the independent Python implementation here:
     amortization (also vs. the closed-form month count), minimum-payment
     mode, snowball / avalanche order + month counts + interest on random
     debt sets, compound interest vs. the closed form, savings-goal weeks,
     50/30/20 splits, budget totals, paycheck example. Review-fix cases:
     month caps (Infinity / huge / fractional -> <= 600), "payment-too-small"
     vs "hit-limit" status, custom minimum rules, $0 debts ignored, clamped
     savings inputs, tiny-rate future value (vs. 60-digit Decimal math),
     paycheck rates over 100%, whole-cent goal weeks.
  3b. Budget Sheet: js/sheet.js is run in Node on many cases and compared with
     the independent Python here (Decimal/integer cents): typed-amount parsing,
     row actual = typed + log, differences, group subtotals, income/spent/left
     totals, every status sentence (sign logic per income/need/want/save),
     spending-log add/delete sequences (incl. refused entries), row removal,
     copy-last-month (latest earlier month + copied plan), Budget Builder
     prefill mapping, and the CSV (exact text vs. a Python build and a
     hand-written file, RFC 4180 quoting, BOM, CRLF, formula-injection guard,
     totals rows, read back with Python's csv module).
  5. Teaching wording: required phrases (FICO-style weights, 30% guideline,
     grace period / no need to carry a balance, guides-not-rules, starting-
     balance order, minimums-only monthly dollars) are present.
  4. Privacy / static: no personal info patterns (emails, phone numbers,
     family words), no external URLs, relative paths only, service-worker
     cache list covers every app file, manifest + icons present.

Exit code 0 = no errors (warnings allowed), 1 = errors.
"""
import ast
import decimal
import json
import math
import operator
import random
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"

errors = []
warnings = []
stats = {}


def err(msg):
    errors.append(msg)


def warn(msg):
    warnings.append(msg)


# ---------------------------------------------------------------------------
# Independent Python money math (written separately from js/money.js)
# ---------------------------------------------------------------------------

MAX_MONTHS = 600
DUST = 0.005


SPECIAL = {"__NaN__": float("nan"), "__Infinity__": float("inf"), "__-Infinity__": float("-inf")}


def as_float(x):
    """How the app reads a number: specials, strings, junk -> float (maybe nan/inf)."""
    if isinstance(x, str):
        if x in SPECIAL:
            return SPECIAL[x]
        try:
            return float(x.replace("$", "").replace(",", "").strip())
        except ValueError:
            return float("nan")
    if x is None:
        return float("nan")
    return float(x)


def py_cap(x):
    """Month cap: a whole number of months from 1 to 600; anything else means 600."""
    v = as_float(x)
    if not math.isfinite(v):
        return MAX_MONTHS
    n = math.floor(v)
    return n if 1 <= n <= MAX_MONTHS else MAX_MONTHS


def py_rule(rule):
    rule = rule or {}

    def pick(k, default):
        if k not in rule or rule[k] is None:
            return default
        v = as_float(rule[k])
        return v if math.isfinite(v) and v >= 0 else default
    return pick("floor", 25.0), pick("pct", 1.0)


def py_payoff(balance, apr, payment=0.0, mode="fixed", cap=None, rule=None):
    r = apr / 1200.0
    cap = py_cap(cap)
    floor, pct = py_rule(rule)
    out = {"months": 0, "totalInterest": 0.0, "totalPaid": 0.0, "neverPaysOff": False, "firstPayment": 0.0,
           "lastPayment": 0.0, "status": "paid-off", "maxMonths": cap}
    if balance <= DUST:
        return out
    too_small = {**out, "neverPaysOff": True, "status": "payment-too-small"}
    if mode == "fixed" and payment <= balance * r + 1e-9:
        return too_small
    b = float(balance)
    n = 0
    while b > DUST and n < cap:
        n += 1
        i = b * r
        owed = b + i
        if mode == "minimum":
            pay = max(min(floor, owed), pct / 100 * b + i)
        else:
            pay = payment
        pay = min(pay, owed)
        if pay <= i + 1e-9 and owed - pay > DUST:   # balance can't go down
            return too_small
        if n == 1:
            out["firstPayment"] = pay
        b = owed - pay
        out["totalInterest"] += i
        out["totalPaid"] += pay
        out["lastPayment"] = pay
    out["months"] = n
    out["neverPaysOff"] = b > DUST
    if b > DUST:
        out["status"] = "hit-limit"
    return out


def closed_form_months(balance, apr, payment):
    """Months to repay a fixed-payment loan from the annuity formula."""
    r = apr / 1200.0
    if r == 0:
        return math.ceil(balance / payment - 1e-9)
    return math.ceil(-math.log(1 - r * balance / payment) / math.log(1 + r) - 1e-9)


def py_bal(d):
    v = as_float(d.get("balance"))
    return max(0.0, v) if math.isfinite(v) else 0.0


def py_order(debts, method):
    keyed = [(i, {**d, "balance": py_bal(d)}) for i, d in enumerate(debts) if py_bal(d) > DUST]
    if method == "avalanche":
        keyed.sort(key=lambda t: (-t[1]["apr"], t[1]["balance"], t[0]))
    else:
        keyed.sort(key=lambda t: (t[1]["balance"], -t[1]["apr"], t[0]))
    return [i for i, _ in keyed]


def py_debts(debts, extra=0.0, method="snowball", rollover=True, cap=None):
    """Month-by-month simulation, structured differently from the JS on purpose:
    a single pass per month over a priority list with a running 'money left'.
    $0 / blank debts are dropped up front: no minimum, not in the order."""
    cap = py_cap(cap)
    bal = {i: py_bal(d) for i, d in enumerate(debts)}
    start = dict(bal)
    mins = {i: (float(d["minPayment"]) if bal[i] > DUST else 0.0) for i, d in enumerate(debts)}
    rate = {i: d["apr"] / 1200.0 for i, d in enumerate(debts)}
    prio = py_order(debts, method)
    monthly_budget = sum(mins.values()) + extra
    paid_off = {i: (0 if bal[i] <= DUST else None) for i in bal}
    total_i = total_p = 0.0
    first_pay = []
    m = 0
    while any(b > DUST for b in bal.values()) and m < cap:
        m += 1
        open_ids = [i for i in bal if bal[i] > DUST]
        for i in open_ids:
            interest = bal[i] * rate[i]
            bal[i] += interest
            total_i += interest
        pays = {i: 0.0 for i in bal}
        for i in open_ids:
            p = min(mins[i], bal[i])
            pays[i] += p
            bal[i] -= p
        left = (monthly_budget - sum(pays.values())) if rollover else extra
        for i in prio:
            if left <= DUST:
                break
            if bal[i] > DUST:
                p = min(left, bal[i])
                pays[i] += p
                bal[i] -= p
                left -= p
        for i in bal:
            if bal[i] < DUST:
                bal[i] = 0.0
                if paid_off[i] is None:
                    paid_off[i] = m
        total_p += sum(pays.values())
        if m == 1:
            first_pay = [pays[i] for i in range(len(debts))]
    never = any(b > DUST for b in bal.values())
    status = "paid-off"
    if never:
        stuck = any(bal[i] > DUST and bal[i] >= start[i] - DUST for i in bal)
        status = "payment-too-small" if stuck else "hit-limit"
    return {"months": m, "totalInterest": total_i, "totalPaid": total_p, "order": prio,
            "paidOffMonths": [paid_off[i] for i in range(len(debts))], "budget": monthly_budget,
            "neverPaysOff": never, "status": status, "maxMonths": cap, "firstMonthPayments": first_pay}


def py_fv(P, pmt, rate_pct, months):
    r = rate_pct / 1200.0
    if r == 0:
        return P + pmt * months
    g = (1 + r) ** months
    return P * g + pmt * (g - 1) / r


def py_clamped_inputs(rate_pct, months):
    r = as_float(rate_pct)
    r = 0.0 if not math.isfinite(r) else min(30.0, max(0.0, r))
    n = as_float(months)
    n = 0 if not math.isfinite(n) else int(min(720, max(0, math.floor(n + 0.5))))
    return r, n


def py_fv_exact(P, pmt, rate_pct, months):
    """Future value in 60-digit Decimal arithmetic (no expm1 tricks needed)."""
    rate_pct, months = py_clamped_inputs(rate_pct, months)
    ctx = decimal.Context(prec=60)
    P = max(decimal.Decimal(0), decimal.Decimal(repr(float(P))))
    pmt = max(decimal.Decimal(0), decimal.Decimal(repr(float(pmt))))
    r = ctx.divide(decimal.Decimal(repr(rate_pct)), decimal.Decimal(1200))
    if r == 0:
        return float(P + pmt * months)
    g = ctx.power(1 + r, months)
    return float(ctx.add(ctx.multiply(P, g), ctx.divide(ctx.multiply(pmt, g - 1), r)))


def py_paycheck(hourly, hours, rates):
    """Withholding in cents; each line stops at what's left of gross."""
    gross_c = math.floor(hourly * hours * 100 + 0.5 + 1e-7)
    left = gross_c
    lines = []
    total_pct = 0.0
    for k in ("federal", "state", "socialSecurity", "medicare"):
        v = as_float(rates.get(k)) if k in rates else {"federal": 10, "state": 4, "socialSecurity": 6.2, "medicare": 1.45}[k]
        v = min(100.0, max(0.0, v if math.isfinite(v) else 0.0))
        total_pct += v
        want = math.floor(gross_c * v / 100 + 0.5 + 1e-7)
        amt = min(want, left)
        left -= amt
        lines.append(amt / 100)
    return {"gross": gross_c / 100, "withheld": (gross_c - left) / 100, "net": left / 100,
            "overLimit": total_pct > 100 + 1e-9, "ratesTotal": total_pct, "lines": lines}


def py_goal_weeks(goal, saved, per_week):
    left_cents = round((goal - saved) * 100)
    if left_cents <= 0:
        return 0
    per_week = as_float(per_week)
    if not math.isfinite(per_week) or round(per_week * 100) <= 0:
        return None
    pw_cents = round(per_week * 100)
    return -(-left_cents // pw_cents)  # integer ceiling division in cents


def py_split(income):
    # money rounds half a cent UP (Python's round() would round half to even)
    cents = math.floor(income * 100 + 0.5)
    needs = math.floor(cents * 0.5 + 0.5)
    wants = math.floor(cents * 0.3 + 0.5)
    return {"needs": needs / 100, "wants": wants / 100, "savings": (cents - needs - wants) / 100}


def verify_value(v):
    """Compute a quiz 'verify' scenario with the Python math."""
    k = v.get("kind")
    if k == "goal":
        return py_goal_weeks(v["goal"], v["saved"], v["perWeek"])
    if k == "payoff":
        r = py_payoff(v["balance"], v["apr"], v.get("payment", 0), v.get("mode", "fixed"))
        if v["field"] == "years":
            return r["months"] / 12
        return r[v["field"]]
    if k == "debts":
        r = py_debts(v["debts"], v.get("extra", 0), v.get("method", "snowball"), v.get("rollover", True))
        return r[v["field"]]
    if k == "compound":
        fv = py_fv(v.get("start", 0), v.get("monthly", 0), v["rate"], v["years"] * 12)
        if v["field"] == "final":
            return fv
        return fv - v.get("start", 0) - v.get("monthly", 0) * v["years"] * 12
    if k == "compoundDiff":
        return py_fv(0, v["monthly"], v["rate"], v["years"] * 12) - py_fv(0, v["monthly"], v["rate"], v["years2"] * 12)
    raise ValueError("unknown verify kind: %r" % k)


# Safe arithmetic for "check" expressions
_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
        ast.Pow: operator.pow, ast.USub: operator.neg, ast.UAdd: operator.pos}


def safe_eval(expr):
    def ev(n):
        if isinstance(n, ast.Expression):
            return ev(n.body)
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)):
            return n.value
        if isinstance(n, ast.BinOp) and type(n.op) in _OPS:
            return _OPS[type(n.op)](ev(n.left), ev(n.right))
        if isinstance(n, ast.UnaryOp) and type(n.op) in _OPS:
            return _OPS[type(n.op)](ev(n.operand))
        raise ValueError("not allowed in check: " + ast.dump(n))
    return ev(ast.parse(expr, mode="eval"))


NUM_RE = re.compile(r"-?\$?\d[\d,]*(?:\.\d+)?")


def numbers_in(text):
    out = []
    for m in NUM_RE.findall(re.sub(r"<[^>]+>", " ", text)):
        try:
            out.append(float(m.replace("$", "").replace(",", "")))
        except ValueError:
            pass
    return out


# ---------------------------------------------------------------------------
# Content checks
# ---------------------------------------------------------------------------

ALLOWED_TAGS = {"b", "i", "br"}
ITEM_TYPES = {"mc", "number"}
UNITS = {None, "$", "%", "months", "weeks", "hours"}

PERSONAL_PATTERNS = [
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+"), "email address"),
    (re.compile(r"\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b"), "phone number"),
    (re.compile(r"\b(my|our) (son|daughter|kid|child|wife|husband|family)\b", re.I), "family reference"),
    (re.compile(r"\b\d{1,5} [A-Z][a-z]+ (Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr)\b"), "street address"),
]


def load_denylist():
    """Optional private word list (never shipped): tools/denylist.local.txt, one word per line."""
    p = ROOT / "tools" / "denylist.local.txt"
    if not p.exists():
        return []
    return [w.strip().lower() for w in p.read_text().splitlines() if w.strip() and not w.startswith("#")]


def check_html(where, text):
    for tag in re.findall(r"</?\s*([a-zA-Z0-9]+)", text):
        if tag.lower() not in ALLOWED_TAGS:
            err(f"{where}: HTML tag <{tag}> not allowed (use b, i, br)")
    for t in ("b", "i"):
        if len(re.findall(rf"<{t}>", text)) != len(re.findall(rf"</{t}>", text)):
            err(f"{where}: unbalanced <{t}> tags")


def all_strings(obj, path=""):
    if isinstance(obj, str):
        yield path, obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield from all_strings(v, f"{path}.{k}" if path else k)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from all_strings(v, f"{path}[{i}]")


def nonempty(v):
    return isinstance(v, str) and v.strip() != ""


def check_item(sec_id, kind, item, seen):
    iid = item.get("id")
    where = f"{sec_id}/{kind}/{iid}"
    if not nonempty(iid):
        err(f"{sec_id}/{kind}: item without id")
        return
    if iid in seen:
        err(f"duplicate id {iid}")
    seen.add(iid)
    typ = item.get("type")
    if typ not in ITEM_TYPES:
        err(f"{where}: type must be mc or number, got {typ!r}")
        return
    if not nonempty(item.get("prompt")):
        err(f"{where}: missing prompt")
    if not nonempty(item.get("explanation")):
        err(f"{where}: missing explanation")
    if "answer" not in item:
        err(f"{where}: missing answer")
        return
    for f in ("prompt", "explanation"):
        if nonempty(item.get(f)):
            check_html(where + "." + f, item[f])
    tol = item.get("tolerance", 0.01)
    expected = None
    source = None
    try:
        if "check" in item:
            expected, source = safe_eval(item["check"]), "check"
        if "verify" in item:
            vv = verify_value(item["verify"])
            if expected is not None and abs(vv - expected) > tol:
                err(f"{where}: check ({expected}) and verify ({vv}) disagree")
            expected, source = vv, "verify"
    except Exception as e:  # noqa: BLE001
        err(f"{where}: could not compute check/verify: {e}")
        return

    if typ == "mc":
        ch = item.get("choices")
        if not isinstance(ch, list) or len(ch) < 2 or not all(nonempty(c) for c in ch):
            err(f"{where}: needs at least 2 non-empty choices")
            return
        if len(set(ch)) != len(ch):
            err(f"{where}: duplicate choices")
        a = item["answer"]
        if not isinstance(a, int) or isinstance(a, bool) or not 0 <= a < len(ch):
            err(f"{where}: answer index {a!r} out of range 0..{len(ch) - 1}")
            return
        for c in ch:
            check_html(where + ".choice", c)
        if expected is not None:
            stats["numbers_checked"] = stats.get("numbers_checked", 0) + 1
            nums = numbers_in(ch[a])
            if not any(abs(n - expected) <= tol for n in nums):
                err(f"{where}: {source} gives {expected:.4f}, but correct choice {ch[a]!r} doesn't contain it (tol {tol})")
            for j, c in enumerate(ch):
                if j != a and any(abs(n - expected) <= tol for n in numbers_in(c)):
                    err(f"{where}: wrong choice {c!r} also matches the computed value {expected:.4f}")
        elif "reviewed" in item:
            if not nonempty(item["reviewed"]):
                err(f"{where}: 'reviewed' must say why no number check is needed")
        elif any(numbers_in(c) for c in ch) and re.search(r"\d", item.get("prompt", "")):
            warn(f"{where}: numeric multiple-choice without check/verify (review by hand)")
    else:
        a = item["answer"]
        if not isinstance(a, (int, float)) or isinstance(a, bool):
            err(f"{where}: number answer must be a number, got {a!r}")
            return
        if item.get("unit") not in UNITS:
            err(f"{where}: unknown unit {item.get('unit')!r}")
        if expected is None:
            err(f"{where}: number item needs a 'check' or 'verify' so the answer can be recomputed")
        else:
            stats["numbers_checked"] = stats.get("numbers_checked", 0) + 1
            if abs(expected - a) > max(tol, 0.005):
                err(f"{where}: answer {a} but {source} computes {expected:.4f}")
        if item.get("unit") == "$" and abs(round(a, 2) - a) > 1e-9:
            err(f"{where}: dollar answer {a} has more than 2 decimals")


# Specific numbers quoted in lesson text, recomputed here.
def claims():
    p2000min = py_payoff(2000, 24, mode="minimum")
    p2000 = py_payoff(2000, 24, 100)
    ex = [{"name": "Phone balance", "balance": 300, "minPayment": 25, "apr": 0},
          {"name": "Store card", "balance": 800, "minPayment": 30, "apr": 24},
          {"name": "Car loan", "balance": 4000, "minPayment": 150, "apr": 6}]
    s, a = py_debts(ex, 100, "snowball"), py_debts(ex, 100, "avalanche")
    fv30, fv40 = py_fv(0, 100, 5, 360), py_fv(0, 100, 5, 480)
    gross = 20 * 15
    net = gross - sum(round(gross * r / 100, 2) for r in (10, 4, 6.2, 1.45))
    return [
        ("basics", "take home about $235", net, 235, 1),
        ("credit", "about <b>12 years</b>", p2000min["months"] / 12, 12, 0.5),
        ("credit", "almost <b>$2,900</b>", p2000min["totalInterest"], 2900, 100),
        ("credit", "takes 26 months", p2000["months"], 26, 0),
        ("credit", "about $580 in interest", p2000["totalInterest"], 580, 5),
        ("credit", "$600 × 0.02 = $12", 600 * 24 / 1200, 12, 0.001),
        ("saving", "after 30 years about $83,000", fv30, 83000, 500),
        ("saving", "After 40 years about $153,000", fv40, 153000, 1000),
        ("saving", "add about $69,000", fv40 - fv30, 69000, 500),
        ("saving", "(300 − 40) ÷ 20 = 13 weeks", py_goal_weeks(300, 40, 20), 13, 0),
        ("snowball", "avalanche saves about $27", s["totalInterest"] - a["totalInterest"], 27, 1),
        ("snowball", "both finish in the same month", s["months"] - a["months"], 0, 0),
        ("snowball", "that $305 a month", 25 + 30 + 150 + 100, 305, 0),
        ("snowball", "that's $3,660", 305 * 12, 3660, 0),
        ("snowball", "pays $205 a month instead of $305", 25 + 30 + 150, 205, 0),
        ("budgeting", "$1,000 needs, $600 wants, $400 savings", py_split(2000)["wants"], 600, 0),
    ]


def check_content():
    meta = load_json(CONTENT / "app.json")
    if meta is None:
        return [], {}
    for f in ("title", "tagline", "howTo", "sections", "notice"):
        if f not in meta:
            err(f"app.json: missing {f}")
    if not isinstance(meta.get("howTo"), list) or len(meta.get("howTo", [])) < 3:
        err("app.json: howTo should be a list of at least 3 steps")
    for i, s in enumerate(meta.get("howTo", [])):
        check_html(f"app.json howTo[{i}]", s)
    tool_ids = set(re.findall(r"^\s*'([a-z-]+)': \{ title:", (ROOT / "js" / "tools.js").read_text(), re.M))
    if not tool_ids:
        err("could not read tool ids from js/tools.js")
    seen = set()
    secs = {}
    for sid in meta.get("sections", []):
        path = CONTENT / "sections" / f"{sid}.json"
        if not path.exists():
            err(f"app.json lists section {sid} but {path.relative_to(ROOT)} is missing")
            continue
        sec = load_json(path)
        if sec is None:
            continue
        secs[sid] = sec
        if sec.get("id") != sid:
            err(f"{path.name}: id {sec.get('id')!r} doesn't match file name")
        for f in ("title", "icon", "description"):
            if not nonempty(sec.get(f)):
                err(f"{sid}: missing {f}")
        for t in sec.get("tools", []):
            if t not in tool_ids:
                err(f"{sid}: unknown tool {t!r}")
        if not sec.get("tools"):
            err(f"{sid}: needs at least one tool")
        lessons = sec.get("lessons", [])
        if len(lessons) < 3:
            err(f"{sid}: needs at least 3 lessons")
        for L in lessons:
            lid = L.get("id")
            if not nonempty(lid) or not nonempty(L.get("title")):
                err(f"{sid}: lesson missing id/title")
                continue
            if lid in seen:
                err(f"duplicate id {lid}")
            seen.add(lid)
            if not isinstance(L.get("body"), list) or not L["body"]:
                err(f"{lid}: body must be a non-empty list of paragraphs")
            for k, p in enumerate(L.get("body", [])):
                check_html(f"{lid}.body[{k}]", p)
            for f in ("keyIdea", "example"):
                if f in L:
                    check_html(f"{lid}.{f}", L[f])
            if "workedExample" in L:
                we = L["workedExample"]
                if not we.get("debts") or "extra" not in we:
                    err(f"{lid}: workedExample needs debts and extra")
        for kind, minimum in (("practice", 4), ("quiz", 5)):
            items = sec.get(kind, [])
            if len(items) < minimum:
                err(f"{sid}: needs at least {minimum} {kind} items")
            for it in items:
                check_item(sid, kind, it, seen)
        cards = sec.get("flashcards", [])
        if len(cards) < 4:
            err(f"{sid}: needs at least 4 flashcards")
        for c in cards:
            if not nonempty(c.get("id")) or not nonempty(c.get("front")) or not nonempty(c.get("back")):
                err(f"{sid}: flashcard missing id/front/back")
                continue
            if c["id"] in seen:
                err(f"duplicate id {c['id']}")
            seen.add(c["id"])
        for sm in sec.get("samples", []):
            w = f"{sid}/sample/{sm.get('id')}"
            if not nonempty(sm.get("name")) or not isinstance(sm.get("income"), (int, float)) or not sm.get("cats"):
                err(f"{w}: needs name, income, cats")
                continue
            tot = 0
            for c in sm["cats"]:
                if c.get("group") not in ("need", "want", "save"):
                    err(f"{w}: bad group {c.get('group')!r}")
                if not isinstance(c.get("amount"), (int, float)) or c["amount"] < 0:
                    err(f"{w}: bad amount in {c.get('name')!r}")
                else:
                    tot += c["amount"]
            if tot > sm["income"]:
                err(f"{w}: sample budget spends {tot} but income is {sm['income']}")

    gl = load_json(CONTENT / "glossary.json")
    if gl is not None:
        terms = gl.get("terms", [])
        names = set()
        for t in terms:
            if not nonempty(t.get("term")) or not nonempty(t.get("def")):
                err(f"glossary: entry missing term/def: {t}")
                continue
            if t["term"].lower() in names:
                err(f"glossary: duplicate term {t['term']}")
            names.add(t["term"].lower())
            if t.get("section") not in secs:
                err(f"glossary: {t['term']} has unknown section {t.get('section')!r}")
        stats["glossary"] = len(terms)

    # Lesson text claims
    for sid, phrase, got, want, tol in claims():
        text = json.dumps(secs.get(sid, {}), ensure_ascii=False)
        if phrase.replace('"', '\\"') not in text:
            err(f"claim check: phrase {phrase!r} not found in {sid}.json (update the CLAIMS list)")
        elif abs(got - want) > tol:
            err(f"claim check: {sid} says {phrase!r} but the math gives {got:.2f}")
        else:
            stats["claims"] = stats.get("claims", 0) + 1

    # Personal info scan over all content
    deny = load_denylist()
    for p in sorted(CONTENT.rglob("*.json")):
        data = load_json(p)
        for where, s in all_strings(data):
            for rx, label in PERSONAL_PATTERNS:
                if rx.search(s):
                    err(f"{p.relative_to(ROOT)} {where}: looks like personal info ({label}): {s[:60]!r}")
            low = s.lower()
            for w in deny:
                if w in low:
                    err(f"{p.relative_to(ROOT)} {where}: contains a denylisted word")
            if re.search(r"https?://", s):
                err(f"{p.relative_to(ROOT)} {where}: external URL in content")
    return meta.get("sections", []), secs


# Teaching wording that must stay in place (review fixes). (file, phrase, why)
WORDING = [
    ("content/sections/credit.json", "FICO-style", "score weights are labeled FICO-style"),
    ("content/sections/credit.json", "approximate</b>. Scores vary by model", "score weights say approximate; scores vary by model"),
    ("content/sections/credit.json", "guideline, not a cutoff", "30% utilization is a guideline, not a cutoff"),
    ("content/sections/credit.json", "lower is better", "lower utilization is better"),
    ("content/sections/credit.json", "When your card has a grace period and you pay the <b>full statement balance</b> by the due date",
     "no-interest claim is tied to having a grace period"),
    ("content/sections/credit.json", "never need to carry a balance to build credit", "you never need to carry a balance"),
    ("content/sections/budgeting.json", "a guide, not a rule", "50/30/20 is a guide, not a rule"),
    ("content/sections/budgeting.json", "warnings in the Budget Builder are guides too", "budget warnings are guides"),
    ("content/sections/snowball.json", "<b>starting balance</b>", "snowball order is set by starting balance"),
    ("content/sections/snowball.json", "pays $205 a month instead of $305", "minimums-only pays less each month"),
    ("content/glossary.json", "guideline, not a cutoff", "glossary: utilization guideline"),
    ("content/glossary.json", "on cards that have one", "glossary: grace period depends on the card"),
    ("js/tools.js", "FICO-style weights, approximate; scores vary by model", "score tool label"),
    ("js/tools.js", "30% is a guideline, not a cutoff", "utilization tool note"),
    ("js/tools.js", "50/30/20 and these warnings are guides, not rules", "budget tool note"),
    ("js/tools.js", "smallest starting balance first", "snowball order heading"),
    ("js/tools.js", "less each month", "minimums-only monthly difference"),
    ("js/tools.js", "' a month at first, less as debts are paid off'", "minimums-only monthly dollars"),
    ("js/tools.js", "r.status === 'hit-limit'", "card simulator: 600-month message"),
    ("js/tools.js", "p.status === 'hit-limit'", "snowball: 600-month message"),
    ("js/tools.js", "r.overLimit", "paycheck: rates over 100% warning"),
]
# Phrases that contradict the wording above and must not come back.
FORBIDDEN = [
    (r"\bunder 30% is (healthy|the common target)\b", "30% treated as a cutoff"),
    (r"(The most common score \(FICO\) is based on)", "unqualified FICO weights"),
    (r"guideline, not a law", "old 50/30/20 wording"),
    (r"credit card for free", "no-interest claim without the grace-period condition"),
]


def check_wording():
    n = 0
    for rel, phrase, why in WORDING:
        text = (ROOT / rel).read_text(encoding="utf-8")
        if phrase not in text:
            err(f"wording: {rel} is missing {phrase!r} ({why})")
        else:
            n += 1
    files = sorted(CONTENT.rglob("*.json")) + [ROOT / "js" / "tools.js"]
    for f in files:
        text = f.read_text(encoding="utf-8")
        for rx, why in FORBIDDEN:
            if re.search(rx, text, re.I):
                err(f"wording: {f.relative_to(ROOT)} has {why} ({rx})")
    stats["wording"] = n


def load_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        err(f"{path.relative_to(ROOT)}: invalid JSON: {e}")
        return None


# ---------------------------------------------------------------------------
# Math: run js/money.js in Node and compare with the Python math
# ---------------------------------------------------------------------------

def build_cases():
    rng = random.Random(20261117)
    cases = []

    # Amortization
    pay_cases = [(1000, 18, 50), (500, 20, 50), (2000, 24, 100), (2500, 29.99, 75), (300, 0, 25),
                 (1200, 22, 60), (5000, 6, 150), (10, 24, 50), (999.99, 19.5, 33.33)]
    for _ in range(25):
        b = round(rng.uniform(100, 8000), 2)
        apr = round(rng.uniform(0, 30), 2)
        pmin = b * apr / 1200 + 1
        pay_cases.append((b, apr, round(rng.uniform(pmin, b / 2 + pmin), 2)))
    for b, apr, pay in pay_cases:
        cases.append(("payoff-fixed", {"fn": "payoff", "args": [{"balance": b, "apr": apr, "payment": pay}]},
                      py_payoff(b, apr, pay), closed_form_months(b, apr, pay), b))
    for b, apr in [(1000, 22), (2000, 24), (500, 18), (5000, 27), (24, 20), (3000, 0)]:
        cases.append(("payoff-min", {"fn": "payoff", "args": [{"balance": b, "apr": apr, "mode": "minimum"}]},
                      py_payoff(b, apr, mode="minimum"), None, b))
    cases.append(("payoff-never", {"fn": "payoff", "args": [{"balance": 1000, "apr": 24, "payment": 20}]},
                  py_payoff(1000, 24, 20), None, 1000))
    cases.append(("payoff-never-equal", {"fn": "payoff", "args": [{"balance": 1200, "apr": 12, "payment": 12}]},
                  py_payoff(1200, 12, 12), None, 1200))

    # Debt sets
    sets = [
        ([{"name": "Phone balance", "balance": 300, "minPayment": 25, "apr": 0},
          {"name": "Store card", "balance": 800, "minPayment": 30, "apr": 24},
          {"name": "Car loan", "balance": 4000, "minPayment": 150, "apr": 6}], 100),
        ([{"name": "A", "balance": 500, "minPayment": 25, "apr": 20},
          {"name": "B", "balance": 500, "minPayment": 25, "apr": 25},
          {"name": "C", "balance": 900, "minPayment": 30, "apr": 25}], 50),   # ties
        ([{"name": "Small", "balance": 40, "minPayment": 25, "apr": 10},
          {"name": "Big", "balance": 3000, "minPayment": 90, "apr": 19}], 300),  # paid off in month 1, leftover rolls
        ([{"name": "Never", "balance": 20000, "minPayment": 50, "apr": 29}], 0),  # never pays off
        ([{"name": "Zero", "balance": 0, "minPayment": 25, "apr": 10},
          {"name": "One", "balance": 700, "minPayment": 35, "apr": 15}], 20),
    ]
    for _ in range(40):
        n = rng.randint(2, 6)
        ds = []
        for k in range(n):
            b = round(rng.uniform(100, 15000), 2)
            apr = rng.choice([0, round(rng.uniform(3, 30), 2)])
            mn = round(max(25, b * rng.uniform(0.02, 0.04)), 2)
            ds.append({"name": f"D{k}", "balance": b, "minPayment": mn, "apr": apr})
        sets.append((ds, rng.choice([0, 25, 50, 100, 250, 500])))
    for ds, extra in sets:
        for method in ("snowball", "avalanche"):
            cases.append((f"debts-{method}", {"fn": "debtPlan", "args": [ds, {"extra": extra, "method": method}]},
                          py_debts(ds, extra, method), None, sum(d["balance"] for d in ds)))
        cases.append(("debts-minimums-only", {"fn": "debtPlan", "args": [ds, {"extra": 0, "rollover": False}]},
                      py_debts(ds, 0, "snowball", False), None, sum(d["balance"] for d in ds)))

    # Compound interest vs closed form
    for P, pmt, rate, yrs in [(1000, 100, 6, 10), (0, 100, 5, 40), (500, 50, 5, 20), (1000, 50, 6, 10),
                              (2500, 0, 7.5, 30), (0, 25, 0, 5), (100, 10, 12, 50)]:
        cases.append(("compound", {"fn": "compound", "args": [{"start": P, "monthly": pmt, "rate": rate, "years": yrs}]},
                      {"final": py_fv(P, pmt, rate, yrs * 12), "contributions": P + pmt * yrs * 12}, None, None))

    # Goals
    for g, s, w in [(300, 40, 20), (250, 0, 15), (600, 150, 25), (100, 100, 5), (100, 120, 5), (50, 0, 0),
                    (19.99, 0, 5), (1000, 0.01, 33.33), (70, 10, 20)]:
        cases.append(("goal", {"fn": "goalWeeks", "args": [g, s, w]}, py_goal_weeks(g, s, w), None, None))

    # 50/30/20
    for inc in [2000, 1500, 800, 3000, 1800, 0, 1234.57, 999.99, 600]:
        cases.append(("split", {"fn": "split503020", "args": [inc]}, py_split(inc), None, None))

    # Budget summary
    cats = [{"name": "a", "group": "need", "amount": 300}, {"name": "b", "group": "want", "amount": 120.5},
            {"name": "c", "group": "save", "amount": 100}, {"name": "d", "group": "need", "amount": "45"}]
    cases.append(("budget", {"fn": "budgetSummary", "args": [600, cats]},
                  {"total": 565.5, "remaining": 34.5, "over": False, "need": 345, "want": 120.5, "save": 100}, None, None))
    cases.append(("budget-over", {"fn": "budgetSummary", "args": [500, cats]},
                  {"total": 565.5, "remaining": -65.5, "over": True, "need": 345, "want": 120.5, "save": 100}, None, None))

    # Paycheck (example rates 10 + 4 + 6.2 + 1.45)
    for hourly, hours in [(15, 20), (12, 15), (14.25, 32)]:
        gross = round(hourly * hours, 2)
        withheld = round(sum(round(gross * r / 100 + 1e-9, 2) for r in (10, 4, 6.2, 1.45)), 2)
        cases.append(("paycheck", {"fn": "paycheck", "args": [{"hourly": hourly, "hours": hours}]},
                      {"gross": gross, "withheld": withheld, "net": round(gross - withheld, 2)}, None, None))

    # ---- Review fixes ----
    # 2) month cap: Infinity / huge / junk -> 600; fractional -> whole months; distinct statuses
    slow = {"balance": 10000, "apr": 24, "payment": 200.001}   # beats interest by 0.1¢: needs ~616 months
    for mm in ["__Infinity__", 1e9, 601, -5, 0, "__NaN__", "abc", None, 12.7, 600, 1]:
        args = dict(slow, maxMonths=mm) if mm is not None else dict(slow)
        cases.append(("payoff-cap", {"fn": "payoff", "args": [args]},
                      py_payoff(10000, 24, 200.001, cap=mm), None, 10000))
    cases.append(("payoff-cap", {"fn": "payoff", "args": [{"balance": 1000, "apr": 18, "payment": 50, "maxMonths": 12}]},
                  py_payoff(1000, 18, 50, cap=12), None, 1000))
    cases.append(("payoff-cap", {"fn": "payoff", "args": [{"balance": 1000, "apr": 18, "payment": 50, "maxMonths": "__Infinity__"}]},
                  py_payoff(1000, 18, 50, cap="__Infinity__"), None, 1000))
    # 5) custom minimum rules: bad values fall back to the default; a rule that only covers interest never pays off
    for rule in [{"floor": 10, "pct": 2}, {"floor": 0, "pct": 3}, {"floor": 0, "pct": 0}, {"floor": 5, "pct": 0},
                 {"floor": "__NaN__", "pct": -1}, {"floor": "__Infinity__", "pct": "__-Infinity__"},
                 {"floor": -25, "pct": 1}, {"floor": "abc"}, {"pct": 0}]:
        for b, apr in [(1000, 22), (2000, 24), (300, 0)]:
            cases.append(("payoff-rule", {"fn": "payoff", "args": [{"balance": b, "apr": apr, "mode": "minimum", "rule": rule}]},
                          py_payoff(b, apr, mode="minimum", rule=rule), None, b))
        f, pc = py_rule(rule)
        cases.append(("minpay-rule", {"fn": "minimumPayment", "args": [1000, 20, rule]},
                      min(max(min(f, 1020.0), 1000 * pc / 100 + 20), 1020.0), None, None))

    # 2 + 4) debt plans: $0/blank debts ignored, statuses, month cap
    base3 = sets[0][0]
    extra_sets = [
        ("debts-zero", [{"name": "Zero", "balance": 0, "minPayment": 500, "apr": 10}] + base3, 100, {}),
        ("debts-zero", base3 + [{"name": "Blank", "balance": "", "minPayment": 75, "apr": 20}], 0, {}),
        ("debts-zero", [{"name": "Neg", "balance": -50, "minPayment": 40, "apr": 5}, {"name": "Junk", "balance": "abc", "minPayment": 40, "apr": 5},
                        {"name": "Real", "balance": 900, "minPayment": 30, "apr": 18}], 10, {}),
        ("debts-never", [{"name": "Never", "balance": 20000, "minPayment": 50, "apr": 29}], 0, {}),
        ("debts-never", [{"name": "Stuck", "balance": 5000, "minPayment": 0, "apr": 0}, {"name": "Ok", "balance": 100, "minPayment": 25, "apr": 0}], 0, {"rollover": False}),
        ("debts-never", [{"name": "Slow", "balance": 10000, "minPayment": 200.001, "apr": 24}], 0, {"maxMonths": "__Infinity__"}),
        ("debts-never", [{"name": "Slow", "balance": 10000, "minPayment": 200.001, "apr": 24}], 0, {"maxMonths": 1e9}),
        ("debts-cap", base3, 100, {"maxMonths": 6}),
        ("debts-cap", base3, 100, {"maxMonths": 6.9}),
        ("debts-cap", base3, 100, {"maxMonths": -1}),
    ]
    for kind, ds, extra, opts in extra_sets:
        roll = opts.get("rollover", True)
        js_opts = {"extra": extra, "method": "snowball", **opts}
        cases.append((kind, {"fn": "debtPlan", "args": [ds, js_opts]},
                      py_debts(ds, extra, "snowball", roll, opts.get("maxMonths")), None, sum(py_bal(d) for d in ds)))

    # 3) savings inputs are clamped (rate 0..30, years 0..60) and the growth factor is never < 1
    for P, pmt, rate, yrs in [(1000, 50, -5, 10), (1000, 50, 99, 10), (100, 10, 6, 100), (100, 10, 6, -3),
                              (100, 10, "__NaN__", 5), ("__Infinity__", 10, 5, 5), (100, "abc", 5, 5), (0, 100, 5, 10.4)]:
        r_c, n_c = py_clamped_inputs(rate, as_float(yrs) * 12 if math.isfinite(as_float(yrs)) else 0)
        y_c = n_c // 12
        P_c = as_float(P); P_c = P_c if math.isfinite(P_c) and P_c > 0 else 0.0
        m_c = as_float(pmt); m_c = m_c if math.isfinite(m_c) and m_c > 0 else 0.0
        cases.append(("compound-clamp", {"fn": "compound", "args": [{"start": P, "monthly": pmt, "rate": rate, "years": yrs}]},
                      {"final": py_fv_exact(P_c, m_c, r_c, y_c * 12), "contributions": P_c + m_c * y_c * 12, "years": y_c}, None, None))
    # 3) futureValue: tiny rates (expm1/log1p), r = 0, clamped rate/months, vs. 60-digit Decimal
    for P, pmt, rate, n in [(0, 100, 1e-10, 120), (1000, 50, 1e-7, 600), (500, 25, 1e-13, 12), (500, 0, 0, 60),
                            (1000, 100, -3, 12), (0, 100, 5, 480), (0, 100, 45, 12), (100, 10, 6, 10000), (1000, 100, 6, 120),
                            (250, 40, 0.0001, 720), (0, 1, 12, 1)]:
        cases.append(("fv", {"fn": "futureValue", "args": [P, pmt, rate, n]}, py_fv_exact(P, pmt, rate, n), None, None))

    # 6) paycheck rates: clamp to 0..100 each, withholding never exceeds gross, net never negative
    for hourly, hours, rates in [(10, 10, {"federal": 90, "state": 50, "socialSecurity": 0, "medicare": 0}),
                                 (15, 20, {"federal": 1000}), (15, 20, {"federal": -10, "state": -4}),
                                 (13.37, 17, {"federal": 60, "state": 30, "socialSecurity": 6.2, "medicare": 3.8}),
                                 (14.25, 32, {"federal": 70, "state": 25, "socialSecurity": 6.2, "medicare": 1.45}),
                                 (9.99, 3, {"federal": 100, "state": 100, "socialSecurity": 100, "medicare": 100}),
                                 (12, 15, {"federal": "__NaN__", "state": "abc"})]:
        cases.append(("paycheck-cap", {"fn": "paycheck", "args": [{"hourly": hourly, "hours": hours, "rates": rates}]},
                      py_paycheck(hourly, hours, rates), None, None))

    # 7) goal weeks in whole cents: any positive shortfall -> at least 1 week
    for g, sv, w in [(100, 99.99, 1000), (0.07, 0, 0.01), (0.03, 0, 0.01), (1000000, 0.01, 0.03), (100, 100.001, 5),
                     (5, 4.99, 0), (10, 0, "__NaN__"), (10, 0, 0.001), (1.1, 0, 0.1), (0.3, 0.1, 0.1), (12345.67, 2345.66, 7.77)]:
        cases.append(("goal-cents", {"fn": "goalWeeks", "args": [g, sv, w]}, py_goal_weeks(as_float(g), as_float(sv), w), None, None))
    for _ in range(30):
        g = round(rng.uniform(1, 5000), 2)
        sv = round(rng.uniform(0, g * 1.1), 2)
        w = round(rng.choice([rng.uniform(0.01, 2), rng.uniform(1, 200)]), 2)
        cases.append(("goal-cents", {"fn": "goalWeeks", "args": [g, sv, w]}, py_goal_weeks(g, sv, w), None, None))

    cases.append(("utilization", {"fn": "utilization", "args": [300, 1000]}, 30.0, None, None))
    cases.append(("utilization-nolimit", {"fn": "utilization", "args": [300, 0]}, None, None, None))
    cases.append(("fmt", {"fn": "fmt", "args": [1234567.005]}, "$1,234,567.01", None, None))
    return cases


def close(a, b, tol=0.01):
    return abs(a - b) <= tol


def check_math():
    node = shutil.which("node")
    if not node:
        err("node not found: cannot test js/money.js (install Node.js)")
        return
    # 1) built-in self test
    r = subprocess.run([node, str(ROOT / "tools" / "test_money.js")], capture_output=True, text=True)
    if r.returncode != 0:
        err("tools/test_money.js self-test failed:\n" + r.stdout + r.stderr)
    cases = build_cases()
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump([c[1] for c in cases], f)
        path = f.name
    r = subprocess.run([node, str(ROOT / "tools" / "test_money.js"), path], capture_output=True, text=True)
    Path(path).unlink(missing_ok=True)
    if r.returncode != 0:
        err("node tools/test_money.js crashed:\n" + r.stderr)
        return
    results = json.loads(r.stdout)
    by_kind = {}
    for (kind, case, want, cf_months, principal), res in zip(cases, results):
        by_kind[kind] = by_kind.get(kind, 0) + 1
        label = f"math {kind} {json.dumps(case['args'])[:110]}"
        if not res["ok"]:
            err(f"{label}: JS error {res['error']}")
            continue
        got = res["value"]
        try:
            if kind.startswith("payoff"):
                if got["neverPaysOff"] != want["neverPaysOff"]:
                    err(f"{label}: neverPaysOff JS {got['neverPaysOff']} vs Python {want['neverPaysOff']}")
                    continue
                for k in ("status", "maxMonths"):
                    if got.get(k) != want[k]:
                        err(f"{label}: {k} JS {got.get(k)!r} vs Python {want[k]!r}")
                if got.get("status") == "payment-too-small" and got["months"] != 0:
                    err(f"{label}: payment-too-small should report 0 months, got {got['months']}")
                if got.get("status") == "hit-limit" and got["months"] != want["maxMonths"]:
                    err(f"{label}: hit-limit but months {got['months']} != cap {want['maxMonths']}")
                if not 1 <= (got.get("maxMonths") or 0) <= MAX_MONTHS or got["months"] > MAX_MONTHS:
                    err(f"{label}: month cap out of range ({got.get('maxMonths')}, months {got['months']})")
                if want["neverPaysOff"]:
                    continue
                if got["months"] != want["months"]:
                    err(f"{label}: months JS {got['months']} vs Python {want['months']}")
                if cf_months is not None and got["months"] != cf_months:
                    err(f"{label}: months JS {got['months']} vs closed form {cf_months}")
                for k in ("totalInterest", "totalPaid", "firstPayment", "lastPayment"):
                    if not close(got[k], want[k]):
                        err(f"{label}: {k} JS {got[k]:.4f} vs Python {want[k]:.4f}")
                if not close(got["totalPaid"], principal + got["totalInterest"]):
                    err(f"{label}: total paid != principal + interest")
            elif kind.startswith("debts"):
                if got["months"] > MAX_MONTHS:
                    err(f"{label}: ran {got['months']} months, more than {MAX_MONTHS}")
                if got.get("budget") is None or not close(got["budget"], want["budget"], 1e-9):
                    err(f"{label}: monthly budget JS {got['budget']} vs Python {want['budget']} ($0 debts must not add their minimum)")
                for k in ("months", "neverPaysOff", "order", "paidOffMonths", "status", "maxMonths"):
                    if got.get(k) != want[k]:
                        err(f"{label}: {k} JS {got.get(k)} vs Python {want[k]}")
                if not want["neverPaysOff"]:
                    for k in ("totalInterest", "totalPaid"):
                        if not close(got[k], want[k]):
                            err(f"{label}: {k} JS {got[k]:.4f} vs Python {want[k]:.4f}")
                    if not close(got["totalPaid"], principal + got["totalInterest"]):
                        err(f"{label}: total paid != principal + interest")
                    if max(got["paidOffMonths"]) != got["months"]:
                        err(f"{label}: last payoff month != months")
                if want["firstMonthPayments"] and not all(close(a, b) for a, b in zip(got["firstMonthPayments"], want["firstMonthPayments"])):
                    err(f"{label}: first-month payments JS {got['firstMonthPayments']} vs Python {want['firstMonthPayments']}")
            elif kind.startswith("compound"):
                if not close(got["final"], want["final"], 1e-6 * max(1, want["final"])):
                    err(f"{label}: final JS {got['final']} vs closed form {want['final']}")
                if not close(got["contributions"], want["contributions"]):
                    err(f"{label}: contributions JS {got['contributions']} vs {want['contributions']}")
                if "years" in want and got.get("years") != want["years"]:
                    err(f"{label}: years JS {got['years']} vs clamped {want['years']}")
                if got["final"] < got["contributions"] - 1e-6:
                    err(f"{label}: balance shrank below deposits (negative growth)")
            elif kind == "fv":
                if not (isinstance(got, (int, float)) and math.isfinite(got)) or not close(got, want, 1e-10 * max(1, abs(want))):
                    err(f"{label}: futureValue JS {got!r} vs 60-digit Decimal {want!r}")
            elif kind == "paycheck-cap":
                if got.get("lines") is None:
                    err(f"{label}: paycheck result has no line amounts")
                    continue
                for k in ("gross", "withheld", "net"):
                    if not close(got[k], want[k], 0.0001):
                        err(f"{label}: {k} JS {got[k]} vs Python {want[k]}")
                if got.get("overLimit") != want["overLimit"] or not close(got.get("ratesTotal") or 0, want["ratesTotal"], 1e-9):
                    err(f"{label}: overLimit/ratesTotal JS {got['overLimit']}/{got['ratesTotal']} vs Python {want['overLimit']}/{want['ratesTotal']}")
                if not all(close(a, b, 0.0001) for a, b in zip(got["lines"], want["lines"])):
                    err(f"{label}: lines JS {got['lines']} vs Python {want['lines']}")
                if got["net"] < 0 or got["withheld"] > got["gross"] + 1e-9 or any(x < 0 or x > got["gross"] + 1e-9 for x in got.get("lines")):
                    err(f"{label}: withholding exceeds gross or net is negative: {got}")
                if not close(sum(got.get("lines")), got["withheld"], 0.0001) or not close(got["withheld"] + got["net"], got["gross"], 0.0001):
                    err(f"{label}: lines don't add up: {got}")
            elif kind == "minpay-rule":
                if not close(got, want, 1e-9):
                    err(f"{label}: JS {got} vs Python {want}")
            elif kind in ("split", "budget", "budget-over", "paycheck"):
                for k, v in want.items():
                    if isinstance(v, bool) or v is None:
                        if got[k] != v:
                            err(f"{label}: {k} JS {got[k]} vs expected {v}")
                    elif not close(got[k], v, 0.0001):
                        err(f"{label}: {k} JS {got[k]} vs expected {v}")
                if kind == "split" and not close(sum(got.values()), case["args"][0], 0.0001):
                    err(f"{label}: split doesn't add back up to income")
            else:  # goal, goal-cents, utilization, fmt
                if kind == "goal-cents" and want and not (isinstance(got, int) and got >= 1):
                    err(f"{label}: goal weeks must be a whole number >= 1 when short, got {got!r}")
                if isinstance(want, float) and got is not None:
                    if not close(got, want, 1e-9):
                        err(f"{label}: JS {got} vs expected {want}")
                elif got != want:
                    err(f"{label}: JS {got!r} vs expected {want!r}")
        except (TypeError, KeyError, ValueError) as e:  # a malformed result is an error, not a crash
            err(f"{label}: unexpected result {got!r:.120} ({type(e).__name__}: {e})")
    stats["math_cases"] = len(cases)
    stats["math_by_kind"] = by_kind


# ---------------------------------------------------------------------------
# Budget Sheet: run js/sheet.js in Node and compare with independent Python
# ---------------------------------------------------------------------------

SHEET_SECTIONS = ["income", "need", "want", "save"]
SHEET_LABEL = {"income": "Income", "need": "Needs", "want": "Wants", "save": "Savings"}
SHEET_TOP = {"income": "Income", "need": "Expenses", "want": "Expenses", "save": "Savings"}
SHEET_ONE = {"income": "income", "need": "need", "want": "want", "save": "savings"}
MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August",
               "September", "October", "November", "December"]


def py_cents_parse(text):
    """Typed text -> cents via Decimal (ROUND_HALF_UP). None = blank, 'NaN' = invalid."""
    if text is None:
        return None
    s = re.sub(r"[$,\s]", "", str(text))
    if s == "":
        return None
    if not re.fullmatch(r"\d+(\.\d*)?|\.\d+", s):
        return "__NaN__"
    c = int((decimal.Decimal(s) * 100).quantize(decimal.Decimal(1), rounding=decimal.ROUND_HALF_UP))
    return "__NaN__" if c > 1_000_000_000 else c


def py_dollars_to_cents(x):
    if not isinstance(x, (int, float)) or not math.isfinite(x) or x <= 0:
        return 0
    return int((decimal.Decimal(repr(x)) * 100).quantize(decimal.Decimal(1), rounding=decimal.ROUND_HALF_UP))


def py_money(c):
    a = abs(c)
    return ("−$" if c < 0 else "$") + f"{a // 100:,}.{a % 100:02d}"


def py_plain(c):
    a = abs(c)
    return ("-" if c < 0 else "") + f"{a // 100}.{a % 100:02d}"


def py_month_label(k):
    return f"{MONTH_NAMES[int(k[5:7]) - 1]} {k[:4]}"


def py_good(section, diff):
    if diff == 0:
        return "even"
    more_is_good = section in ("income", "save")
    return "good" if (diff > 0) == more_is_good else "bad"


def py_sheet_summary(sheet):
    logged = {}
    for e in sheet["log"]:
        logged[e["rowId"]] = logged.get(e["rowId"], 0) + e["amount"]
    groups = {g: {"planned": 0, "actual": 0, "hasActual": False} for g in SHEET_SECTIONS}
    rows, statuses = [], []
    for r in sheet["rows"]:
        lg = logged.get(r["id"], 0)
        actual = (r["actual"] or 0) + lg
        has = r["actual"] is not None or lg > 0
        diff = actual - r["planned"]
        name = r["name"].strip() or f"this {SHEET_ONE[r['section']]} item"
        status = None
        if has and diff != 0:
            amt = py_money(abs(diff))
            if r["section"] == "income":
                status = ("good", f"You earned {amt} more than planned from {name}") if diff > 0 else ("bad", f"You earned {amt} less than planned from {name}")
            elif r["section"] == "save":
                status = ("good", f"You saved {amt} more than planned for {name}") if diff > 0 else ("bad", f"You saved {amt} less than planned for {name}")
            else:
                status = ("bad", f"You spent {amt} more than planned on {name}") if diff > 0 else ("good", f"You're {amt} under plan on {name}")
            statuses.append(status)
        rows.append({"id": r["id"], "actual": actual, "logged": lg, "hasActual": has, "diff": diff,
                     "good": py_good(r["section"], diff) if has else "none", "status": status})
        g = groups[r["section"]]
        g["planned"] += r["planned"]
        g["actual"] += actual
        g["hasActual"] = g["hasActual"] or has
    any_actual = any(x["hasActual"] for x in rows)
    inc_p, inc_a = groups["income"]["planned"], groups["income"]["actual"]
    sp_p = sum(groups[g]["planned"] for g in ("need", "want", "save"))
    sp_a = sum(groups[g]["actual"] for g in ("need", "want", "save"))
    left_p, left_a = inc_p - sp_p, inc_a - sp_a
    if not any_actual:
        overall = ("info", "No actual amounts yet. Type them in, or use the spending log as the month goes.")
    elif left_a > 0:
        overall = ("good", f"You have {py_money(left_a)} left this month")
    elif left_a == 0:
        overall = ("good", "You have $0.00 left this month. Every dollar was used")
    else:
        overall = ("bad", f"You spent {py_money(-left_a)} more than you earned")
    if inc_p == 0 and sp_p == 0:
        plan = ("info", "Start by typing your planned income")
    elif left_p > 0:
        plan = ("info", f"Your plan leaves {py_money(left_p)} without a job. Give it one (savings is a great choice)")
    elif left_p == 0:
        plan = ("good", "Your plan gives every dollar a job")
    else:
        plan = ("bad", f"Your plan spends {py_money(-left_p)} more than your income")
    return {"rows": rows, "groups": groups, "income": (inc_p, inc_a), "spent": (sp_p, sp_a), "left": (left_p, left_a),
            "hasActual": any_actual, "overall": overall, "plan": plan, "statuses": statuses,
            "logTotal": sum(e["amount"] for e in sheet["log"])}


def py_csv_cell(v):
    s = "" if v is None else str(v)
    if s[:1] in ("=", "+", "-", "@", "\t", "\r"):
        s = "'" + s
    if any(ch in s for ch in ',"\r\n'):
        s = '"' + s.replace('"', '""') + '"'
    return s


def py_sheet_csv(sheet):
    z = py_sheet_summary(sheet)
    byid = {r["id"]: r for r in sheet["rows"]}
    out = [["Section", "Group", "Item", "Planned", "Actual", "Difference"]]
    for g in SHEET_SECTIONS:
        for r, zr in zip(sheet["rows"], z["rows"]):
            if r["section"] != g:
                continue
            out.append([py_csv_cell(SHEET_TOP[g]), py_csv_cell(SHEET_LABEL[g]), py_csv_cell(r["name"]), py_plain(r["planned"]),
                        py_plain(zr["actual"]) if zr["hasActual"] else "", py_plain(zr["diff"]) if zr["hasActual"] else ""])
        t = z["groups"][g]
        out.append(["Subtotal", SHEET_LABEL[g], f"{SHEET_LABEL[g]} total", py_plain(t["planned"]), py_plain(t["actual"]), py_plain(t["actual"] - t["planned"])])
    for label, (p, a) in (("Total income", z["income"]), ("Total spent (needs + wants + savings)", z["spent"]),
                          ("Money left over (income - spent)", z["left"])):
        out.append(["Total", "", label, py_plain(p), py_plain(a), py_plain(a - p)])
    lines = [",".join(r) for r in out]
    lines.append("")
    lines.append(f"Spending log: {py_month_label(sheet['month'])}")
    lines.append("Date,Group,Item,Amount,Note")
    log = sorted(enumerate(sheet["log"]), key=lambda x: (x[1]["date"], x[0]))
    for _, e in log:
        r = byid.get(e["rowId"], {"name": "", "section": "want"})
        lines.append(",".join([e["date"], py_csv_cell(SHEET_LABEL[r["section"]]), py_csv_cell(r["name"]), py_plain(e["amount"]), py_csv_cell(e["note"])]))
    lines.append(f"Log total,,,{py_plain(z['logTotal'])},")
    return "﻿" + "\r\n".join(lines) + "\r\n"


def py_latest_before(keys, month):
    ok = [k for k in keys if re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", k) and k < month]
    return max(ok) if ok else None


def py_from_budget(sheet, budget):
    """Prefill rule (see js/sheet.js): builder rows win; same section+name keeps id/actual;
    unmatched old rows survive only if they hold an actual or log entries (planned -> 0)."""
    wanted = [("income", "Take-home pay", py_dollars_to_cents(budget.get("income")))]
    for c in budget.get("cats", []):
        sec = c.get("group") if c.get("group") in ("need", "want", "save") else "want"
        wanted.append((sec, str(c.get("name", ""))[:40], py_dollars_to_cents(c.get("amount"))))
    first = {}
    for r in sheet["rows"]:
        first.setdefault((r["section"], r["name"].strip().lower()), r)
    used, rows, nxt = set(), [], sheet["nextId"]
    for sec, name, planned in wanted:
        old = first.get((sec, name.strip().lower()))
        if old and old["id"] not in used:
            used.add(old["id"])
            rows.append({"id": old["id"], "section": sec, "name": name, "planned": planned, "actual": old["actual"]})
        else:
            rows.append({"id": f"r{nxt}", "section": sec, "name": name, "planned": planned, "actual": None})
            nxt += 1
    logged = {e["rowId"] for e in sheet["log"]}
    for r in sheet["rows"]:
        if r["id"] not in used and (r["actual"] is not None or r["id"] in logged):
            rows.append({**r, "planned": 0})
    order = {s: i for i, s in enumerate(SHEET_SECTIONS)}
    rows = [r for _, r in sorted(enumerate(rows), key=lambda x: (order[x[1]["section"]], x[0]))]
    return {"rows": rows, "nextId": nxt}


TRICKY_NAMES = ["Food", "Gas", "Phone, data", 'Say "hi"', "line\nbreak", "=SUM(A1:A9)", "+cmd", "-5", "@risk",
                "Café ☕", "  ", "Tab\there", "'quoted", "a,b,\"c\""]


def random_sheet(rng, month):
    rows, log, nid = [], [], 1
    for _ in range(rng.randint(0, 12)):
        sec = rng.choice(SHEET_SECTIONS)
        rows.append({"id": f"r{nid}", "section": sec, "name": rng.choice(TRICKY_NAMES),
                     "planned": rng.choice([0, rng.randint(1, 200000)]),
                     "actual": rng.choice([None, 0, rng.randint(0, 200000)])})
        nid += 1
    days = [31, 29 if int(month[:4]) % 4 == 0 else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][int(month[5:]) - 1]
    spend = [r for r in rows if r["section"] != "income"]
    for _ in range(rng.randint(0, 8) if spend else 0):
        log.append({"id": f"l{nid}", "rowId": rng.choice(spend)["id"], "amount": rng.randint(1, 50000),
                    "note": rng.choice(["", "lunch", "gift, birthday", "=bad()", 'a "quote"']),
                    "date": f"{month}-{rng.randint(1, days):02d}"})
        nid += 1
    return {"v": 1, "month": month, "rows": rows, "log": log, "nextId": nid}


def build_sheet_cases():
    rng = random.Random(2026)
    cases = []  # (kind, case, expected)
    # parse typed amounts
    for t in ["12", "$1,234.5", ".75", "3.455", "3.454", "0.125", "007.10", "10000000", "10000000.01",
              "-5", "abc", "", "  ", ".", "1.2.3", "1e3", "0.1", "0.2", "99.995", "$ 40"]:
        cases.append(("sheet-parse", {"fn": "sheet.parseCents", "args": [t]}, py_cents_parse(t)))
    for x in [600, 0.285, 12.5, 0.005, 1e-9, -40, 199.99, 33.333]:
        cases.append(("sheet-tocents", {"fn": "sheet.toCents", "args": [x]}, py_dollars_to_cents(x)))
    for c in [0, 5, 100, 123456789, -2500, -1]:
        cases.append(("sheet-fmt", {"fn": "sheet.fmt", "args": [c]}, py_money(c)))
    # months
    for k, n, want in [("2026-11", 1, "2026-12"), ("2026-12", 1, "2027-01"), ("2026-01", -1, "2025-12"), ("2026-03", -14, "2025-01"), ("2026-06", 0, "2026-06")]:
        cases.append(("sheet-month", {"fn": "sheet.shiftMonth", "args": [k, n]}, want))
    for d, k, want in [("2028-02-29", "2028-02", True), ("2026-02-29", "2026-02", False), ("2026-11-31", "2026-11", False),
                       ("2026-11-30", "2026-11", True), ("2026-12-01", "2026-11", False), ("junk", "2026-11", False)]:
        cases.append(("sheet-date", {"fn": "sheet.dateInMonth", "args": [d, k]}, want))
    # totals / differences / left over / wording on random sheets + fixed edge sheets
    months = ["2026-11", "2026-02", "2028-02", "2025-12"]
    sheets = [random_sheet(rng, months[i % 4]) for i in range(40)]
    sheets.append({"v": 1, "month": "2026-11", "rows": [], "log": [], "nextId": 1})
    sheets.append({"v": 1, "month": "2026-11", "nextId": 5, "log": [], "rows": [  # left exactly $0
        {"id": "r1", "section": "income", "name": "Job", "planned": 50000, "actual": 50000},
        {"id": "r2", "section": "need", "name": "Food", "planned": 30000, "actual": 32000},
        {"id": "r3", "section": "save", "name": "Car", "planned": 20000, "actual": 18000},
        {"id": "r4", "section": "want", "name": "", "planned": 0, "actual": None}]})
    sheets.append({"v": 1, "month": "2026-11", "nextId": 3, "rows": [  # the example from the brief: spent $30 more than earned
        {"id": "r1", "section": "income", "name": "Job", "planned": 40000, "actual": 40000},
        {"id": "r2", "section": "need", "name": "Food", "planned": 10000, "actual": 12000}],
        "log": [{"id": "l3", "rowId": "r2", "amount": 31000, "note": "", "date": "2026-11-02"}]})
    for sh in sheets:
        cases.append(("sheet-summary", {"fn": "sheet.summarize", "args": [sh]}, py_sheet_summary(sh)))
        cases.append(("sheet-csv", {"fn": "sheet.toCSV", "args": [sh]}, py_sheet_csv(sh)))
        cases.append(("sheet-hasdata", {"fn": "sheet.hasData", "args": [sh]},
                      bool(sh["log"]) or any(r["planned"] != 0 or r["actual"] is not None for r in sh["rows"])))
    # spending log add/delete sequences: actual = typed + sum(log) after every step; delete subtracts
    for i in range(25):
        sh = random_sheet(rng, "2026-11")
        sh["log"] = []
        ops, live, exp_errors, nid = [], [], [], sh["nextId"]
        spend = [r for r in sh["rows"] if r["section"] != "income"]
        incomes = [r for r in sh["rows"] if r["section"] == "income"]
        for _ in range(rng.randint(1, 12)):
            roll = rng.random()
            if live and roll < 0.3:
                lid = rng.choice(live)
                live.remove(lid)
                ops.append({"op": "deleteLog", "id": lid[0]})
                exp_errors.append(None)
            elif spend and roll < 0.85:
                r = rng.choice(spend)
                amt = rng.randint(1, 30000)
                ops.append({"op": "addLog", "entry": {"rowId": r["id"], "amount": amt, "note": "n", "date": f"2026-11-{rng.randint(1, 30):02d}"}})
                live.append((f"l{nid}", r["id"], amt))
                nid += 1
                exp_errors.append(None)
            else:  # invalid entries must be refused and change nothing
                bad = rng.choice(["income", "zero", "date", "norow"])
                if bad == "income" and not incomes:
                    bad = "norow"
                if bad in ("zero", "date") and not spend:
                    bad = "norow"
                entry = {"rowId": "nope", "amount": 100, "note": "", "date": "2026-11-05"}
                if bad == "income":
                    entry["rowId"] = incomes[0]["id"]
                elif bad == "zero":
                    entry.update(rowId=spend[0]["id"], amount=0)
                elif bad == "date":
                    entry.update(rowId=spend[0]["id"], date="2026-10-31")
                ops.append({"op": "addLog", "entry": entry})
                exp_errors.append("error")
        final_log = {"rows": sh["rows"], "log": [{"id": l, "rowId": r, "amount": a, "note": "n", "date": "2026-11-01"} for l, r, a in live],
                     "month": "2026-11"}
        cases.append(("sheet-log", {"fn": "sheetOps", "args": [sh, ops]},
                      {"errors": exp_errors, "actuals": {x["id"]: x["actual"] for x in py_sheet_summary(final_log)["rows"]},
                       "logIds": sorted(l for l, _, _ in live)}))
    # removing a row removes its log entries; addRow keeps groups together
    sh = {"v": 1, "month": "2026-11", "nextId": 4, "rows": [
        {"id": "r1", "section": "need", "name": "Food", "planned": 100, "actual": None},
        {"id": "r2", "section": "want", "name": "Fun", "planned": 100, "actual": None},
        {"id": "r3", "section": "need", "name": "Gas", "planned": 100, "actual": None}], "log": []}
    cases.append(("sheet-rows", {"fn": "sheetOps", "args": [sh, [
        {"op": "addLog", "entry": {"rowId": "r1", "amount": 500, "date": "2026-11-03"}},
        {"op": "addLog", "entry": {"rowId": "r2", "amount": 700, "date": "2026-11-03"}},
        {"op": "removeRow", "id": "r1"},
        {"op": "addRow", "section": "need", "name": "Bus"},
        {"op": "setRow", "id": "r2", "patch": {"planned": -5, "actual": 250, "name": "Movies\nnight"}}]]},
        {"order": ["r2", "r3", "r6"], "logRows": ["r2"], "r2": {"planned": 100, "actual": 250, "name": "Movies night"}}))
    # copy last month's plan
    keysets = [(["2026-09", "2026-07", "2025-12", "2026-11", "2026-13", "abc", "2027-01"], "2026-11"),
               (["2026-09", "2026-07", "2025-12"], "2026-01"), (["2026-11"], "2026-11"), ([], "2026-05"), (["2026-10"], "2026-11")]
    for keys, month in keysets:
        cases.append(("sheet-latest", {"fn": "sheet.latestBefore", "args": [{k: {"v": 1} for k in keys}, month]}, py_latest_before(keys, month)))
    for i in range(6):
        src = random_sheet(rng, "2026-10")
        cases.append(("sheet-copy", {"fn": "sheet.copyPlan", "args": [src, "2026-11"]},
                      {"month": "2026-11", "log": [], "rows": [(r["section"], r["name"], r["planned"], None) for r in src["rows"]]}))
    # prefill from the Budget Builder
    builder = [{"income": 600, "cats": [{"name": "Phone bill", "group": "need", "amount": 40}, {"name": "Gas", "group": "need", "amount": 50},
                                        {"name": "Eating out", "group": "want", "amount": 60.555}, {"name": "Savings", "group": "save", "amount": 100},
                                        {"name": "Odd", "group": "bogus", "amount": -5}]},
               {"income": 1234.5, "cats": []}, {"cats": [{"name": "food", "group": "need", "amount": 0.285}]}]
    base = {"v": 1, "month": "2026-11", "nextId": 6, "rows": [
        {"id": "r1", "section": "need", "name": " GAS ", "planned": 1000, "actual": 4200},
        {"id": "r2", "section": "want", "name": "Clothes", "planned": 2000, "actual": None},
        {"id": "r3", "section": "want", "name": "Games", "planned": 0, "actual": None},
        {"id": "r4", "section": "need", "name": "Food", "planned": 5000, "actual": None},
        {"id": "r5", "section": "income", "name": "Take-home pay", "planned": 0, "actual": 61000}],
        "log": [{"id": "l6", "rowId": "r3", "amount": 900, "note": "", "date": "2026-11-04"}]}
    for b in builder:
        for sh in (base, {"v": 1, "month": "2026-11", "nextId": 1, "rows": [], "log": []}):
            cases.append(("sheet-prefill", {"fn": "sheet.fromBudget", "args": [sh, b]}, py_from_budget(sh, b)))
    return cases


# Hand-checked CSV cells: (input, exact expected cell)
CSV_KNOWN = [
    ("plain", "plain"), ("=SUM(A1:A2)", "'=SUM(A1:A2)"), ("+1", "'+1"), ("-5", "'-5"), ("@x", "'@x"),
    ("a,b", '"a,b"'), ('say "hi"', '"say ""hi"""'), ("a\nb", '"a\nb"'), ("a\r\nb", '"a\r\nb"'),
    ("=1,2", "\"'=1,2\""), ("\tx", "'\tx"), (" =x", " =x"), ("Café ☕", "Café ☕"), ("", ""),
]

CSV_FIXED_SHEET = {"v": 1, "month": "2026-11", "nextId": 9, "rows": [
    {"id": "r1", "section": "income", "name": "Job", "planned": 40000, "actual": 42500},
    {"id": "r2", "section": "need", "name": "Food, snacks", "planned": 8000, "actual": None},
    {"id": "r3", "section": "want", "name": "=HYPERLINK(\"x\")", "planned": 5000, "actual": 3500},
    {"id": "r4", "section": "save", "name": "Car", "planned": 10000, "actual": 12000}],
    "log": [{"id": "l5", "rowId": "r2", "amount": 2550, "note": "lunch \"big\"", "date": "2026-11-09"},
            {"id": "l6", "rowId": "r2", "amount": 7450, "note": "", "date": "2026-11-02"}]}
CSV_FIXED_EXPECTED = (
    "﻿Section,Group,Item,Planned,Actual,Difference\r\n"
    "Income,Income,Job,400.00,425.00,25.00\r\n"
    "Subtotal,Income,Income total,400.00,425.00,25.00\r\n"
    "Expenses,Needs,\"Food, snacks\",80.00,100.00,20.00\r\n"
    "Subtotal,Needs,Needs total,80.00,100.00,20.00\r\n"
    "Expenses,Wants,\"'=HYPERLINK(\"\"x\"\")\",50.00,35.00,-15.00\r\n"
    "Subtotal,Wants,Wants total,50.00,35.00,-15.00\r\n"
    "Savings,Savings,Car,100.00,120.00,20.00\r\n"
    "Subtotal,Savings,Savings total,100.00,120.00,20.00\r\n"
    "Total,,Total income,400.00,425.00,25.00\r\n"
    "Total,,Total spent (needs + wants + savings),230.00,255.00,25.00\r\n"
    "Total,,Money left over (income - spent),170.00,170.00,0.00\r\n"
    "\r\n"
    "Spending log: November 2026\r\n"
    "Date,Group,Item,Amount,Note\r\n"
    "2026-11-02,Needs,\"Food, snacks\",74.50,\r\n"
    "2026-11-09,Needs,\"Food, snacks\",25.50,\"lunch \"\"big\"\"\"\r\n"
    "Log total,,,100.00,\r\n")


def check_csv_text(label, text, sheet):
    """Structural checks on one CSV string from js/sheet.js."""
    raw = text.encode("utf-8")
    if not raw.startswith(b"\xef\xbb\xbf") or raw.count(b"\xef\xbb\xbf") != 1:
        err(f"{label}: CSV must start with exactly one UTF-8 BOM")
    body = text[1:]
    outside_quotes = re.sub(r'"(?:[^"]|"")*"', "", body)
    if re.search(r"(?<!\r)\n", outside_quotes) or not body.endswith("\r\n"):
        err(f"{label}: CSV lines must end with CRLF")
    import csv
    import io
    parsed = list(csv.reader(io.StringIO(body, newline="")))
    if not parsed or parsed[0] != ["Section", "Group", "Item", "Planned", "Actual", "Difference"]:
        err(f"{label}: CSV header is {parsed[:1]}")
        return
    names = [r["name"] for r in sheet["rows"]]
    item_cells = [row[2] for row in parsed[1:] if row and row[0] in ("Income", "Expenses", "Savings")]
    want_cells = []
    for g in SHEET_SECTIONS:
        want_cells += [("'" + n if n[:1] in "=+-@\t\r" and n else n) for n, r in zip(names, sheet["rows"]) if r["section"] == g]
    if item_cells != want_cells:
        err(f"{label}: item names don't round-trip through a CSV reader: {item_cells!r} vs {want_cells!r}")
    for row in parsed:
        for cell in row:
            if cell[:1] in ("=", "+", "-", "@") and not re.fullmatch(r"-\d+\.\d\d", cell):
                err(f"{label}: unguarded formula-like cell {cell!r}")
    z = py_sheet_summary(sheet)
    tot = {row[2]: row[3:6] for row in parsed if row and row[0] == "Total"}
    for key, (p, a) in (("Total income", z["income"]), ("Money left over (income - spent)", z["left"])):
        if tot.get(key) != [py_plain(p), py_plain(a), py_plain(a - p)]:
            err(f"{label}: {key} row {tot.get(key)} vs Python {[py_plain(p), py_plain(a), py_plain(a - p)]}")
    logrow = [row for row in parsed if row and row[0] == "Log total"]
    if not logrow or logrow[0][3] != py_plain(z["logTotal"]):
        err(f"{label}: log total row {logrow} vs {py_plain(z['logTotal'])}")


def check_sheet():
    node = shutil.which("node")
    if not node:
        return  # check_math already reported this
    cases = build_sheet_cases()
    extra = [("sheet-csvcell", {"fn": "sheet.csvText", "args": [i]}, o) for i, o in CSV_KNOWN]
    extra.append(("sheet-csvfixed", {"fn": "sheet.toCSV", "args": [CSV_FIXED_SHEET]}, CSV_FIXED_EXPECTED))
    extra.append(("sheet-csvname", {"fn": "sheet.csvFilename", "args": ["2026-11"]}, "money-lab-budget-2026-11.csv"))
    cases += extra
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump([c[1] for c in cases], f)
        path = f.name
    r = subprocess.run([node, str(ROOT / "tools" / "test_money.js"), path], capture_output=True, text=True)
    Path(path).unlink(missing_ok=True)
    if r.returncode != 0:
        err("node tools/test_money.js crashed on sheet cases:\n" + r.stderr)
        return
    results = json.loads(r.stdout)
    by_kind = {}
    for (kind, case, want), res in zip(cases, results):
        by_kind[kind] = by_kind.get(kind, 0) + 1
        label = f"sheet {kind} {json.dumps(case['args'], ensure_ascii=False)[:90]}"
        if not res["ok"]:
            err(f"{label}: JS error {res['error']}")
            continue
        got = res["value"]
        try:
            if kind == "sheet-summary":
                for k in ("income", "spent", "left"):
                    g = got[k]
                    if (g["planned"], g["actual"], g["diff"]) != (want[k][0], want[k][1], want[k][1] - want[k][0]):
                        err(f"{label}: {k} JS {g} vs Python {want[k]}")
                for gid in SHEET_SECTIONS:
                    g, w = got["groups"][gid], want["groups"][gid]
                    if (g["planned"], g["actual"], g["diff"], g["hasActual"]) != (w["planned"], w["actual"], w["actual"] - w["planned"], w["hasActual"]):
                        err(f"{label}: group {gid} JS {g} vs Python {w}")
                for gr, wr in zip(got["rows"], want["rows"]):
                    st = (gr["status"]["kind"], gr["status"]["text"]) if gr["status"] else None
                    if (gr["actual"], gr["logged"], gr["hasActual"], gr["diff"], gr["good"], st) != (wr["actual"], wr["logged"], wr["hasActual"], wr["diff"], wr["good"], wr["status"]):
                        err(f"{label}: row {gr['id']} JS {gr} vs Python {wr}")
                for k in ("overall", "plan"):
                    if (got[k]["kind"], got[k]["text"]) != want[k]:
                        err(f"{label}: {k} wording JS {got[k]} vs Python {want[k]}")
                if [(s["kind"], s["text"]) for s in got["statuses"]] != want["statuses"] or got["logTotal"] != want["logTotal"] or got["hasActual"] != want["hasActual"]:
                    err(f"{label}: statuses/log total differ: JS {got['statuses']} vs Python {want['statuses']}")
                if not all(isinstance(v, int) for gr in got["rows"] for v in (gr["actual"], gr["diff"])):
                    err(f"{label}: money must stay in whole cents")
            elif kind == "sheet-csv":
                if got != want:
                    err(f"{label}: CSV differs from the Python build\n  JS: {got[:300]!r}\n  Py: {want[:300]!r}")
                case_sheet = case["args"][0]
                check_csv_text(label, got, case_sheet)
            elif kind == "sheet-csvfixed":
                if got != want:
                    err(f"{label}: CSV differs from the hand-written expected file\n  JS: {got!r}")
                check_csv_text(label, got, case["args"][0])
            elif kind == "sheet-log":
                errs = ["error" if e else None for e in got["errors"]]
                if errs != want["errors"]:
                    err(f"{label}: accepted/refused entries JS {errs} vs expected {want['errors']}")
                acts = {x["id"]: x["actual"] for x in got["summary"]["rows"]}
                if acts != want["actuals"]:
                    err(f"{label}: row actuals after add/delete JS {acts} vs Python {want['actuals']}")
                if sorted(e["id"] for e in got["sheet"]["log"]) != want["logIds"]:
                    err(f"{label}: log ids JS {[e['id'] for e in got['sheet']['log']]} vs {want['logIds']}")
                # every step: actual == typed + logged so far
                steps_ok = all(isinstance(a, int) for step in got["after"] for _, a in step)
                if not steps_ok:
                    err(f"{label}: non-integer cents in a step")
            elif kind == "sheet-rows":
                rows = got["sheet"]["rows"]
                if [r["id"] for r in rows] != want["order"] or sorted({e["rowId"] for e in got["sheet"]["log"]}) != want["logRows"]:
                    err(f"{label}: rows {[r['id'] for r in rows]} / log rows {[e['rowId'] for e in got['sheet']['log']]}")
                r2 = [r for r in rows if r["id"] == "r2"][0]
                if {k: r2[k] for k in ("planned", "actual", "name")} != want["r2"]:
                    err(f"{label}: setRow result {r2} vs {want['r2']} (negative planned must be refused, line breaks removed)")
            elif kind == "sheet-copy":
                rows = [(r["section"], r["name"], r["planned"], r["actual"]) for r in got["rows"]]
                if got["month"] != want["month"] or got["log"] != [] or rows != want["rows"] or len({r["id"] for r in got["rows"]}) != len(rows):
                    err(f"{label}: copyPlan JS {got} vs expected {want}")
            elif kind == "sheet-prefill":
                rows = [{k: r[k] for k in ("id", "section", "name", "planned", "actual")} for r in got["rows"]]
                if rows != want["rows"] or got["nextId"] != want["nextId"] or got["log"] != case["args"][0]["log"]:
                    err(f"{label}: fromBudget JS {rows} (next {got['nextId']}) vs Python {want['rows']} (next {want['nextId']})")
            else:  # parse, tocents, fmt, month, date, latest, hasdata, csvcell, csvname
                if got != want:
                    err(f"{label}: JS {got!r} vs expected {want!r}")
        except (TypeError, KeyError, ValueError, IndexError) as e:
            err(f"{label}: unexpected result {str(got)[:120]} ({type(e).__name__}: {e})")
    stats["sheet_cases"] = len(cases)
    stats["sheet_by_kind"] = by_kind


# ---------------------------------------------------------------------------
# Static files
# ---------------------------------------------------------------------------

def check_static(section_ids):
    for f in ("index.html", "manifest.json", "sw.js", "css/styles.css", "icons/icon.svg", ".nojekyll",
              "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png"):
        if not (ROOT / f).exists():
            err(f"missing file {f}")
    man = load_json(ROOT / "manifest.json") or {}
    for f in ("name", "short_name", "start_url", "scope", "display", "icons", "theme_color", "background_color"):
        if f not in man:
            err(f"manifest.json: missing {f}")
    for ic in man.get("icons", []):
        if not (ROOT / ic["src"]).exists():
            err(f"manifest.json: icon {ic['src']} missing")
        if ic["src"].startswith("/"):
            err(f"manifest.json: icon path must be relative: {ic['src']}")
    if str(man.get("start_url", "")).startswith("/") or str(man.get("scope", "")).startswith("/"):
        err("manifest.json: start_url/scope must be relative for GitHub Pages subpaths")

    sw = (ROOT / "sw.js").read_text()
    if not re.search(r"var VERSION = '[^']+';", sw):
        err("sw.js: VERSION not found")
    core = re.findall(r"'([^']+)'", sw.split("var CORE")[1].split("];")[0])
    for c in core:
        if c != "./" and not (ROOT / c).exists():
            err(f"sw.js caches {c} but it doesn't exist")
    need = ["index.html", "manifest.json", "content/app.json", "content/glossary.json"]
    need += [str(p.relative_to(ROOT)) for p in sorted((ROOT / "js").glob("*.js"))]
    need += [str(p.relative_to(ROOT)) for p in sorted((ROOT / "css").glob("*.css"))]
    need += [f"content/sections/{s}.json" for s in section_ids]
    for n in need:
        if n not in core:
            err(f"sw.js CORE is missing {n} (it won't work offline)")

    html = (ROOT / "index.html").read_text()
    for src in re.findall(r'<script src="([^"]+)"', html):
        if not (ROOT / src).exists():
            err(f"index.html loads missing script {src}")
    for js in (ROOT / "js").glob("*.js"):
        if js.name not in html:
            err(f"index.html doesn't load js/{js.name}")

    deny = load_denylist()
    files = [ROOT / "index.html", ROOT / "manifest.json", ROOT / "sw.js"] + list((ROOT / "js").glob("*.js")) + list((ROOT / "css").glob("*.css"))
    for p in files:
        text = p.read_text(encoding="utf-8")
        rel = p.relative_to(ROOT)
        for m in re.findall(r"https?://[^\s'\")]+", text):
            if not m.startswith("http://www.w3.org/2000/svg"):
                err(f"{rel}: external URL {m}")
        if re.search(r'(?:src|href)="/(?!/)', text) or "<base" in text:
            err(f"{rel}: absolute path or <base> tag (breaks GitHub Pages subpaths)")
        if re.search(r"\b(gtag|google-analytics|analytics\.js|XMLHttpRequest|sendBeacon)\b", text):
            err(f"{rel}: looks like tracking / network code")
        for rx, label in PERSONAL_PATTERNS:
            if rx.search(text):
                err(f"{rel}: looks like personal info ({label})")
        for w in deny:
            if w in text.lower():
                err(f"{rel}: contains a denylisted word")


def main():
    section_ids, secs = check_content()
    check_wording()
    check_static(section_ids)
    check_math()
    check_sheet()

    print("Money Lab validation")
    print("====================")
    for sid in section_ids:
        s = secs.get(sid)
        if s:
            print(f"  {s['icon']} {s['title']:<14} lessons {len(s['lessons'])}  practice {len(s['practice'])}  "
                  f"quiz {len(s['quiz'])}  flashcards {len(s['flashcards'])}  tools {', '.join(s['tools'])}")
    print(f"  glossary terms: {stats.get('glossary', 0)}")
    print(f"  numeric answers recomputed: {stats.get('numbers_checked', 0)}")
    print(f"  lesson-text number claims checked: {stats.get('claims', 0)}")
    print(f"  teaching-wording phrases checked: {stats.get('wording', 0)}")
    print(f"  money.js vs Python math cases: {stats.get('math_cases', 0)} "
          f"({', '.join(f'{k} {v}' for k, v in sorted(stats.get('math_by_kind', {}).items()))})")
    print(f"  sheet.js vs Python cases: {stats.get('sheet_cases', 0)} "
          f"({', '.join(f'{k[6:]} {v}' for k, v in sorted(stats.get('sheet_by_kind', {}).items()))})")
    if warnings:
        print(f"\nWarnings ({len(warnings)}):")
        for w in warnings:
            print("  -", w)
    if errors:
        print(f"\nErrors ({len(errors)}):")
        for e in errors:
            print("  -", e)
    print(f"\n{len(errors)} errors, {len(warnings)} warnings")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
