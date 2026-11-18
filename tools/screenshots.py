#!/usr/bin/env python3
"""Smoke-test every screen in a headless browser and take screenshots.

Run from anywhere:  python3 tools/screenshots.py
Needs: Python playwright with chromium installed.

Starts a local static server (python -m http.server) on a free port, then:
  1. Visits every route (home, each section x each tab, tools, cards,
     glossary, progress) and fails on any console error or page error.
  2. Plays through a practice question and a full quiz.
  3. Saves screenshots to screenshots/ at phone (390x844) and desktop
     (1280x900) sizes: home, budget, credit-card, snowball (+ -desktop).
Exit code 0 = no browser errors.
"""
import json
import socket
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "screenshots"


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def main():
    OUT.mkdir(exist_ok=True)
    port = free_port()
    # Serve from a subfolder path to prove relative URLs work under a GitHub Pages-style subpath.
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
                           cwd=str(ROOT.parent), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f"http://127.0.0.1:{port}/{ROOT.name}/"
    errors = []
    try:
        for _ in range(50):
            try:
                socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
                break
            except OSError:
                time.sleep(0.1)
        meta = json.loads((ROOT / "content" / "app.json").read_text())
        with sync_playwright() as p:
            browser = p.chromium.launch()

            def new_page(w, hgt, mobile):
                ctx = browser.new_context(viewport={"width": w, "height": hgt}, device_scale_factor=2 if mobile else 1,
                                          is_mobile=mobile, has_touch=mobile, service_workers="block")
                page = ctx.new_page()
                page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text} @ {page.url}") if m.type == "error" else None)
                page.on("pageerror", lambda e: errors.append(f"pageerror: {e} @ {page.url}"))
                page.on("requestfailed", lambda r: errors.append(f"requestfailed: {r.url}"))
                return ctx, page

            def go(page, route):
                page.goto(base + "index.html#" + route)
                page.wait_for_selector("#app > :not(.loading)")
                page.wait_for_timeout(150)

            # Full-page captures stitch the page together, so sticky/fixed bars would be
            # painted in the middle. For screenshots only, pin them to the page ends.
            SHOT_CSS = (".topbar,.subtabs,.sticky-sum{position:static!important}"
                        "body{position:relative}.tabbar{position:absolute!important}")

            def shot(page, name):
                page.add_style_tag(content=SHOT_CSS)
                page.wait_for_timeout(100)
                page.screenshot(path=str(OUT / name), full_page=True)

            # ---- 1. every route ----
            ctx, page = new_page(390, 844, True)
            routes = ["/", "/tools", "/cards", "/glossary", "/progress"]
            for sid in meta["sections"]:
                for tab in ["learn", "try", "practice", "quiz"]:
                    routes.append(f"/s/{sid}/{tab}")
                sec = json.loads((ROOT / "content" / "sections" / f"{sid}.json").read_text())
                for i in range(len(sec["lessons"])):
                    routes.append(f"/s/{sid}/learn/{i + 1}")
                for t in sec["tools"]:
                    routes.append(f"/tool/{t}")
                routes.append(f"/cards/{sid}")
            for r in routes:
                go(page, r)
                if page.locator("text=This tool hit a problem").count():
                    errors.append(f"tool error shown on {r}")
            print(f"visited {len(routes)} routes")

            # ---- 2. interactions ----
            go(page, "/s/credit/practice/1")
            page.fill(".answer-input", "12")
            page.click("text=Check")
            assert page.locator(".feedback.good").count() == 1, "practice: correct answer not accepted"
            go(page, "/s/budgeting/quiz")
            page.click("text=Start quiz")
            n = len(json.loads((ROOT / "content" / "sections" / "budgeting.json").read_text())["quiz"])
            for _ in range(n):
                if page.locator(".choice").count():
                    page.locator(".choice").first.click()
                else:
                    page.fill(".answer-input", "1")
                page.click("button:has-text('Check')")
                page.locator(".pager button.primary").click()
            assert page.locator(".big-score").count() == 1, "quiz did not finish"
            go(page, "/s/basics/try")
            for _ in range(10):
                page.locator(".bin-need").click()
            assert page.locator(".sort-done").count() == 1, "sort game did not finish"
            go(page, "/glossary")
            page.fill("input[type=search]", "apr")
            assert page.locator(".g-item").count() >= 1, "glossary search found nothing"
            go(page, "/cards")
            page.click(".flashcard")
            assert page.locator(".flashcard.flipped").count() == 1, "flashcard did not flip"
            go(page, "/tool/goals")
            page.click("text=Save goal")
            assert page.locator(".goal").count() >= 1, "goal not saved"
            go(page, "/tool/account")
            for _ in range(2):
                page.click("text=New game")
            assert page.locator(".log li.bad").count() >= 1, "overdraft fee not shown"

            # Review fixes: each "doesn't finish" / guard message shows in the real UI.
            go(page, "/tool/card-sim")
            page.get_by_label("Card balance").fill("2000")
            page.get_by_label("Monthly payment").fill("40")  # 2000 x 24% / 12 = $40 interest
            assert page.locator("text=This payment never pays it off").count() == 1, "card-sim: payment-too-small message missing"
            page.get_by_label("Card balance").fill("100000")
            page.get_by_label("Monthly payment").fill("2000.01")  # barely beats $2,000 interest
            assert page.locator("text=Still not paid off after 50 years").count() == 1, "card-sim: hit-limit message missing"
            go(page, "/tool/paycheck")
            page.click("text=Change the tax rates")
            page.get_by_label("Federal income tax").fill("95")
            assert page.locator("text=more than 100%").count() == 1, "paycheck: over-100% warning missing"
            assert page.locator(".stub .total td.num").inner_text().strip() == "$0.00", "paycheck: net pay not $0.00"
            go(page, "/tool/snowball")
            page.click("text=Load example")
            page.click("text=+ Add a debt")
            last = page.locator(".debt-row").last.locator("input")
            last.nth(0).fill("Paid-off card")
            last.nth(1).fill("0")
            last.nth(2).fill("50")
            page.wait_for_timeout(200)
            assert page.locator("text=Their minimums are not added").count() == 1, "snowball: $0 debt not skipped"
            print("review-fix UI checks: payment-too-small, hit-limit, paycheck >100%, $0 debt skipped")
            ctx.close()

            # ---- 3. screenshots ----
            for suffix, (w, hgt, mobile) in {"": (390, 844, True), "-desktop": (1280, 900, False)}.items():
                ctx, page = new_page(w, hgt, mobile)
                go(page, "/")
                shot(page, f"home{suffix}.png")

                go(page, "/tool/budget")
                page.click("text=Teen with a part-time job")
                page.wait_for_timeout(200)
                shot(page, f"budget{suffix}.png")

                go(page, "/tool/card-sim")
                page.wait_for_selector(".linechart")
                shot(page, f"credit-card{suffix}.png")

                go(page, "/tool/snowball")
                page.click("text=Load example")
                page.click("text=+ Add a debt")
                last = page.locator(".debt-row").last.locator("input")
                last.nth(0).fill("Credit card")
                last.nth(1).fill("1500")
                last.nth(2).fill("45")
                last.nth(3).fill("27")
                page.wait_for_selector(".linechart")
                page.wait_for_timeout(200)
                shot(page, f"snowball{suffix}.png")
                ctx.close()
            browser.close()
    finally:
        srv.terminate()

    for name in ["home", "budget", "credit-card", "snowball"]:
        for s in ["", "-desktop"]:
            print("screenshot:", (OUT / f"{name}{s}.png").relative_to(ROOT))
    if errors:
        print(f"\n{len(errors)} browser error(s):")
        for e in errors:
            print("  ", e)
        return 1
    print("browser errors: 0")
    return 0


if __name__ == "__main__":
    sys.exit(main())
