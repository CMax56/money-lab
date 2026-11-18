#!/usr/bin/env python3
# Browser check for the Budget Sheet: fills sample data, logs a purchase, checks CSV download (BOM), print = 1 Letter page, no console errors, saves screenshots.
# Needs a local server first:  python3 -m http.server 8765 --bind 127.0.0.1  (from the project root)
import subprocess, sys
from playwright.sync_api import sync_playwright
URL='http://127.0.0.1:8765/#/tool/sheet'
vals={'Paycheck':(600,640),'Allowance or gifts':(40,40),'Phone':(40,40),'Gas or bus fare':(50,65),'Food and snacks':(60,80),
 'Eating out':(60,45),'Fun and entertainment':(50,50),'Clothes':(40,0),'Savings account':(150,150),'Emergency fund':(50,60)}
with sync_playwright() as p:
    b=p.chromium.launch()
    for name,vp in [('budget-sheet',{'width':390,'height':844}),('budget-sheet-desktop',{'width':1280,'height':900})]:
        ctx=b.new_context(viewport=vp, accept_downloads=True); pg=ctx.new_page()
        errs=[]; pg.on('console', lambda m: errs.append(m.text) if m.type=='error' else None); pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(URL); pg.wait_for_timeout(800)
        for item,(pl,ac) in vals.items():
            pg.get_by_label('Planned for '+item, exact=True).fill(str(pl))
            pg.get_by_label('Actual for '+item, exact=True).fill(str(ac))
        pg.get_by_label('Category').select_option(label='Clothes') if pg.locator('#lc2 option', has_text='Clothes').count() else None
        pg.get_by_label('Amount', exact=True).fill('25'); pg.get_by_label('Note (optional)').fill('T-shirt')
        pg.get_by_role('button', name='+ Add to log').click(); pg.wait_for_timeout(300)
        status=pg.evaluate("[...document.querySelectorAll('[aria-live]')].map(e=>e.innerText.trim()).filter(Boolean).join(' || ')")
        print(name,'STATUS:',status[:900])
        with pg.expect_download() as d: pg.get_by_role('button', name='⬇ Download CSV').click()
        dl=d.value; path='/tmp/'+dl.suggested_filename; dl.save_as(path); raw=open(path,'rb').read()
        print('CSV',dl.suggested_filename,'BOM',raw[:3]==b'\xef\xbb\xbf'); print(raw.decode('utf-8-sig')[:1200])
        pg.evaluate('window.scrollTo(0,0)'); pg.add_style_tag(content='.topbar,.subtabs,.sticky-sum{position:static!important}body{position:relative}.tabbar{position:absolute!important}'); pg.wait_for_timeout(300)
        pg.screenshot(path=f'/workspace/money-lab/screenshots/{name}.png', full_page=True)
        pg.emulate_media(media='print'); pg.pdf(path='/tmp/sheet.pdf', format='Letter'); pg.screenshot(path=f'/tmp/{name}-print.png', full_page=True)
        print('PDF', [l for l in subprocess.run(['pdfinfo','/tmp/sheet.pdf'],capture_output=True,text=True).stdout.splitlines() if l.startswith('Pages')])
        print('ERRS',errs); ctx.close()
