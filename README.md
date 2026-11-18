# Money Lab

An interactive money course for high-school students: budgeting, saving, banking, credit cards, and paying off debt with the snowball method.

It's a static website (HTML, CSS, and plain JavaScript) with no build step, no frameworks, no outside services, and no tracking. It works offline once installed (PWA).

## Run it locally

The app loads its lessons with `fetch`, so it has to be served over HTTP. Opening `index.html` as a file won't work.

```sh
cd money-lab
python3 -m http.server 8000
# open http://localhost:8000/
```

On a phone, open the site and choose **Add to Home Screen** to install it like an app.

## Host it (GitHub Pages or any static host)

Upload the folder as it is. Every URL is relative, so it works under a subpath like `https://<user>.github.io/money-lab/`. `.nojekyll` is included so GitHub Pages serves every file untouched.

When you change any app file, bump `VERSION` in `sw.js` (for example `moneylab-v3`). Otherwise installed copies keep the old cached files.

## What's inside

```
index.html            app shell (top bar, bottom tab bar)
css/styles.css        all styles (mobile-first, dark mode, reduced motion)
js/money.js           ALL money math: pure functions, no DOM, also runs in Node
js/store.js           localStorage progress + saved calculator inputs
js/ui.js              small DOM helpers (fields, sliders, messages)
js/charts.js          hand-rolled SVG charts (donut, line, stacked bars, meter)
js/tools.js           the interactive tools (sort game, budget builder, simulators…)
js/app.js             router, home page, lessons, practice, quizzes, flashcards, glossary, progress
content/app.json      title, "how to use" steps, section order, notice
content/sections/*.json  one file per section: lessons, practice, quiz, flashcards
content/glossary.json searchable glossary
icons/                app icons (icon.svg + PNGs made by tools/make_icons.py)
sw.js, manifest.json  offline support / installable app
tools/validate.py     content + math + privacy checks (run before publishing)
tools/test_money.js   runs js/money.js in Node for validate.py
tools/screenshots.py  headless-browser smoke test + screenshots
tools/make_icons.py   regenerates the PNG icons
```

## How the math works

Every calculation is in `js/money.js`, and the app shows each rule on screen:

- **Debt interest:** each month, interest = balance × APR ÷ 12 ÷ 100 is added *before* the payment. The last payment is only what's left. Money is rounded to cents for display only.
- **Credit card minimum payment ("a common rule"):** the larger of $25 (or the whole balance, if that's less) and 1% of the balance plus that month's interest.
- **Snowball / avalanche:** each month, add interest to every debt, then pay every minimum. The rest of the fixed monthly budget (extra money plus minimums freed up from paid-off debts) goes to the target debt. Leftover from a debt paid off mid-month rolls to the next target in the same month. Snowball = smallest starting balance first (a tie goes to the higher APR). Avalanche = highest APR first (a tie goes to the smaller balance). Any plan longer than 600 months (50 years) is reported as "never".
- **Compound interest:** compounds monthly, with deposits added at the end of each month. FV = P(1+r)^n + PMT((1+r)^n − 1)/r.
- **Savings goal:** weeks = ceil((goal − saved) ÷ per week).
- **Paycheck:** Social Security 6.2% and Medicare 1.45% are the real rates. Federal 10% and state 4% are **made-up example rates** and are labeled that way in the app.

## Add or edit content

Each section is one JSON file in `content/sections/`. To add a section, create the file and add its id to `sections` in `content/app.json` and to `CORE` in `sw.js`.

- **Lesson:** `{ "id", "title", "body": ["paragraph", …], "keyIdea", "example" }`. Text can use `<b>`, `<i>`, and `<br>` only.
- **Multiple-choice question:** `{ "id", "type": "mc", "prompt", "choices": [...], "answer": <index from 0>, "explanation" }`
- **Number question:** `{ "id", "type": "number", "prompt", "answer": 12.5, "unit": "$" | "%" | "months" | "weeks" | "hours", "explanation", "check": "600 * 24 / 12 / 100" }`

Every number question needs one of these so the validator can recompute the answer:
- `"check"`: a plain arithmetic expression.
- `"verify"`: a scenario such as `{ "kind": "payoff", "balance": 1000, "apr": 18, "payment": 50, "field": "months" }`. The other kinds are `goal`, `debts`, `compound`, and `compoundDiff` (see `tools/validate.py`).

Multiple-choice questions with numbers can use `check` or `verify` too. The computed value must then appear in the correct choice and in no wrong choice. Use `"tolerance"` for "about $198"-style answers.

A multiple-choice question with numbers that aren't a calculation can have `"reviewed": "why"` instead.

Then run:

```sh
python3 tools/validate.py      # must end with "0 errors"
python3 tools/screenshots.py   # optional: browser smoke test + screenshots (needs Python playwright)
```

## Privacy

- No accounts, no analytics, no ads, no outside requests. The Content-Security-Policy in `index.html` blocks loading anything from other sites.
- Progress (lessons read, practice, quiz scores, flashcards) and saved calculator inputs (budget, savings goals, debts) are stored only in this browser's `localStorage`. **Progress → Reset progress** and **Clear saved calculator data** erase them.
- The content has no names or personal details. `tools/validate.py` scans for emails, phone numbers, street addresses, and family references. It can also check a private word list: put words, one per line, in `tools/denylist.local.txt`. **Don't publish that file.**
- Everything here is for learning, not financial advice. Fees and tax rates are realistic examples.

## Budget Sheet

**Tools → Budget Sheet** is a real monthly budget you fill in yourself. It has income lines plus Needs, Wants, and Savings rows, each with Planned, Actual, and Difference, and plain-language status lines. It also has:

- a quick spending log that adds to a row's Actual
- one sheet per month, with a "Copy last month's plan" button
- a button to prefill from the Budget Builder
- Print (fits one page)
- Download CSV (opens in Excel or Google Sheets)

Sheets are saved only in this browser. The math and CSV code is in `js/sheet.js` and is tested by `tools/validate.py`. To browser-test the sheet, start a server on port 8765 and run `python3 tools/sheet_check.py`.
