/* Money Lab — main UI and router. Plain JS, no dependencies, no network
 * calls except same-origin JSON content. Progress lives in localStorage. */
(function () {
  'use strict';

  var U = window.UI, M = window.Money, T = window.Tools;
  var h = U.h;
  var app = document.getElementById('app');
  var S = window.Store.load();
  var CONTENT = null;

  function show() {
    U.clear(app);
    for (var i = 0; i < arguments.length; i++) U.add(app, arguments[i]);
    window.scrollTo(0, 0);
  }

  function focusMain() { try { app.focus({ preventScroll: true }); } catch (e) { app.focus(); } }

  /* ---------- content ---------- */

  function getJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ': ' + r.status);
      return r.json();
    });
  }

  function loadContent() {
    return getJSON('content/app.json').then(function (meta) {
      return Promise.all([
        Promise.all(meta.sections.map(function (id) { return getJSON('content/sections/' + id + '.json'); })),
        getJSON('content/glossary.json')
      ]).then(function (res) {
        var byId = {};
        res[0].forEach(function (s) { byId[s.id] = s; });
        CONTENT = { app: meta, sections: res[0], byId: byId, glossary: res[1].terms };
      });
    });
  }

  /* ---------- progress ---------- */

  function sectionProgress(sec) {
    var lessons = sec.lessons.filter(function (l) { return S.lessons[l.id]; }).length;
    var practice = sec.practice.filter(function (p) { return S.practice[p.id] && S.practice[p.id].correct; }).length;
    var q = S.quizzes[sec.id];
    var quizPct = q ? q.best / q.total : 0;
    var frac = (lessons / sec.lessons.length + practice / sec.practice.length + quizPct) / 3;
    return { lessons: lessons, practice: practice, quiz: q, quizPct: quizPct, pct: Math.round(frac * 100) };
  }

  function bar(pct, label) {
    return h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': label || 'Progress' },
      h('span', { style: 'width:' + pct + '%' }));
  }

  /* ---------- home ---------- */

  function renderHome() {
    var total = 0;
    var cards = CONTENT.sections.map(function (sec, i) {
      var p = sectionProgress(sec);
      total += p.pct;
      return h('a', { class: 'sec-card', href: '#/s/' + sec.id },
        h('div', { class: 'sec-top' },
          h('span', { class: 'sec-icon', 'aria-hidden': 'true' }, sec.icon),
          h('div', null, h('span', { class: 'sec-num' }, 'Section ' + (i + 1)), h('h3', null, sec.title)),
          h('span', { class: 'badge' + (p.pct === 100 ? ' done' : '') }, p.pct === 100 ? '✓ Done' : p.pct + '%')),
        h('p', { class: 'small muted clamp' }, sec.description),
        bar(p.pct, sec.title + ' progress'),
        h('p', { class: 'tag-line' }, 'Lessons ' + p.lessons + '/' + sec.lessons.length + ' · Practice ' + p.practice + '/' + sec.practice.length + ' · Quiz ' + (p.quiz ? p.quiz.best + '/' + p.quiz.total : '—')));
    });
    var overall = Math.round(total / CONTENT.sections.length);
    var steps = h('ol', { class: 'howto' }, CONTENT.app.howTo.map(function (s) { return h('li', { html: s }); }));
    var howto = h('details', { class: 'card howto-card', open: S.tipDismissed ? null : 'open' },
      h('summary', null, h('h2', null, 'How to use this app')),
      steps,
      h('button', { class: 'btn ghost small', type: 'button', onclick: function () { S.tipDismissed = true; window.Store.save(); howto.open = false; } }, 'Got it, fold this up'));
    show(
      h('section', { class: 'hero' },
        h('h1', null, 'Money Lab'),
        h('p', null, CONTENT.app.tagline),
        h('div', { class: 'overall' }, h('span', null, 'Your progress: ', h('b', null, overall + '%')), bar(overall, 'Overall progress'))),
      howto,
      h('h2', { class: 'group-title' }, 'Sections'),
      h('div', { class: 'sec-grid' }, cards),
      h('h2', { class: 'group-title' }, 'Quick tools'),
      h('div', { class: 'quick' }, ['sheet', 'budget', 'card-sim', 'snowball', 'goals'].map(function (id) {
        var t = T.list[id];
        return h('a', { class: 'quick-link', href: '#/tool/' + id }, h('span', { 'aria-hidden': 'true' }, t.icon), ' ', t.title);
      })),
      h('p', { class: 'notice' }, CONTENT.app.notice));
  }

  /* ---------- section ---------- */

  var TABS = [
    { id: 'learn', label: 'Learn', icon: '📖' },
    { id: 'try', label: 'Try it', icon: '🛠' },
    { id: 'practice', label: 'Practice', icon: '✏️' },
    { id: 'quiz', label: 'Quiz', icon: '🏁' }
  ];

  function sectionHeader(sec, tab) {
    var idx = CONTENT.sections.indexOf(sec);
    return [
      h('a', { class: 'back', href: '#/' }, '← All sections'),
      h('div', { class: 'sec-head' }, h('span', { class: 'sec-icon', 'aria-hidden': 'true' }, sec.icon),
        h('div', null, h('span', { class: 'sec-num' }, 'Section ' + (idx + 1) + ' of ' + CONTENT.sections.length), h('h1', null, sec.title))),
      h('nav', { class: 'subtabs', 'aria-label': sec.title + ' parts' }, TABS.map(function (t) {
        return h('a', { href: '#/s/' + sec.id + '/' + t.id, 'aria-current': t.id === tab ? 'page' : null }, h('span', { 'aria-hidden': 'true' }, t.icon), t.label);
      }))
    ];
  }

  function nextTabLink(sec, tab) {
    var i = TABS.findIndex(function (t) { return t.id === tab; });
    if (i < TABS.length - 1) return h('a', { class: 'btn primary', href: '#/s/' + sec.id + '/' + TABS[i + 1].id }, 'Next: ' + TABS[i + 1].label + ' →');
    var si = CONTENT.sections.indexOf(sec);
    if (si < CONTENT.sections.length - 1) {
      var n = CONTENT.sections[si + 1];
      return h('a', { class: 'btn primary', href: '#/s/' + n.id }, 'Next section: ' + n.title + ' →');
    }
    return h('a', { class: 'btn primary', href: '#/progress' }, 'See your progress →');
  }

  function renderSection(sec, tab, arg) {
    if (tab === 'try') return renderTry(sec);
    if (tab === 'practice') return renderPractice(sec, arg);
    if (tab === 'quiz') return renderQuiz(sec);
    return renderLearn(sec, arg);
  }

  /* ----- learn: one lesson card at a time ----- */

  function renderLearn(sec, arg) {
    var i = Math.max(0, Math.min(sec.lessons.length - 1, (parseInt(arg, 10) || 1) - 1));
    var L = sec.lessons[i];
    window.Store.markLesson(L.id);
    var dots = h('div', { class: 'dots', role: 'list', 'aria-label': 'Lessons' }, sec.lessons.map(function (l, k) {
      return h('a', { role: 'listitem', class: 'dot' + (S.lessons[l.id] ? ' ok' : '') + (k === i ? ' current' : ''), href: '#/s/' + sec.id + '/learn/' + (k + 1),
        'aria-label': 'Lesson ' + (k + 1) + ': ' + l.title + (S.lessons[l.id] ? ' (read)' : ''), 'aria-current': k === i ? 'step' : null }, String(k + 1));
    }));
    var card = h('article', { class: 'card lesson' },
      h('p', { class: 'sec-num' }, 'Lesson ' + (i + 1) + ' of ' + sec.lessons.length),
      h('h2', null, L.title),
      L.body.map(function (p) { return h('p', { html: p }); }));
    if (L.workedExample) {
      var wx = h('div', { class: 'worked' });
      T.workedExample(wx, L.workedExample);
      card.appendChild(wx);
    }
    if (L.keyIdea) card.appendChild(h('div', { class: 'key' }, h('b', null, '🔑 Key idea: '), h('span', { html: L.keyIdea })));
    if (L.example) card.appendChild(h('div', { class: 'example' }, h('b', null, '💡 Example: '), h('span', { html: L.example })));
    if (L.tryTool && T.list[L.tryTool]) card.appendChild(h('p', null, h('a', { class: 'btn secondary', href: '#/tool/' + L.tryTool }, h('span', { 'aria-hidden': 'true' }, T.list[L.tryTool].icon + ' '), 'Open the ' + T.list[L.tryTool].title + ' →')));
    var prev = i > 0 ? h('a', { class: 'btn ghost', href: '#/s/' + sec.id + '/learn/' + i }, '← Back') : h('span');
    var next = i < sec.lessons.length - 1
      ? h('a', { class: 'btn primary', href: '#/s/' + sec.id + '/learn/' + (i + 2) }, 'Next lesson →')
      : nextTabLink(sec, 'learn');
    show(sectionHeader(sec, 'learn'), dots, card, h('div', { class: 'pager' }, prev, next));
  }

  /* ----- try it: the section's tools ----- */

  function toolCard(id, ctx) {
    var t = T.list[id];
    var body = h('div', { class: 'tool-body' });
    var card = h('section', { class: 'card tool', id: 'tool-' + id, 'aria-labelledby': 'h-' + id },
      h('h2', { id: 'h-' + id }, h('span', { 'aria-hidden': 'true' }, t.icon + ' '), t.title), body);
    try { t.render(body, ctx || {}); } catch (e) { body.appendChild(U.msg('bad', 'This tool hit a problem: ' + e.message)); if (window.console) console.error(e); }
    return card;
  }

  function renderTry(sec) {
    show(sectionHeader(sec, 'try'),
      sec.tools.length > 1 ? h('p', { class: 'muted small' }, 'This section has ' + sec.tools.length + ' tools: ' + sec.tools.map(function (id) { return T.list[id].title; }).join(', ') + '.') : null,
      sec.tools.map(function (id) { return toolCard(id, { section: sec }); }),
      h('div', { class: 'pager' }, h('span'), nextTabLink(sec, 'try')));
  }

  function renderToolPage(id) {
    var t = T.list[id];
    if (!t) return notFound();
    var sec = CONTENT.sections.find(function (s) { return s.tools.indexOf(id) !== -1; });
    show(h('a', { class: 'back', href: '#/tools' }, '← All tools'),
      toolCard(id, { section: sec }),
      sec ? h('p', { class: 'small no-print' }, 'Part of ', h('a', { href: '#/s/' + sec.id }, sec.icon + ' ' + sec.title), '. Read the lessons to learn the ideas behind it.') : null);
  }

  function renderTools() {
    show(h('h1', null, 'Tools'),
      h('p', { class: 'muted' }, 'Every calculator and game in one place.'),
      CONTENT.sections.map(function (sec) {
        return [h('h2', { class: 'group-title' }, sec.icon + ' ' + sec.title),
          h('div', { class: 'tool-grid' }, sec.tools.map(function (id) {
            var t = T.list[id];
            return h('a', { class: 'tool-link', href: '#/tool/' + id },
              h('span', { class: 'tool-ic', 'aria-hidden': 'true' }, t.icon),
              h('span', null, h('b', null, t.title), h('span', { class: 'small muted' }, t.blurb)));
          }))];
      }));
  }

  /* ----- questions (shared by practice and quiz) ----- */

  function parseAnswer(text) {
    var s = String(text || '').trim().replace(/[−–—]/g, '-').replace(/[$,%\s]/g, '').replace(/[a-z]+$/i, '');
    if (s === '' || !/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
    return parseFloat(s);
  }

  function isCorrect(item, given) {
    if (item.type === 'mc') return given === item.answer;
    var tol = item.tolerance != null ? item.tolerance : 0.01;
    return Math.abs(given - item.answer) <= tol + 1e-9;
  }

  function answerText(item) {
    if (item.type === 'mc') return item.choices[item.answer];
    var a = item.answer;
    if (item.unit === '$') return M.fmt(a);
    if (item.unit === '%') return a + '%';
    return a + (item.unit ? ' ' + item.unit : '');
  }

  /* Renders a question. onAnswer(correct, given) is called on each check. */
  function questionView(item, opts) {
    opts = opts || {};
    var box = h('div', { class: 'question' });
    var fb = h('div', { class: 'fb', 'aria-live': 'polite' });
    box.appendChild(h('p', { class: 'prompt', html: item.prompt }));
    var selected = null, locked = false, tries = 0;
    var choiceBtns = [];

    function feedback(ok, final) {
      U.clear(fb);
      if (ok) fb.appendChild(h('div', { class: 'feedback good' }, '✓ Correct!'));
      else if (!final) fb.appendChild(h('div', { class: 'feedback bad' }, '✗ Not quite. Try again, or show the answer.'));
      else fb.appendChild(h('div', { class: 'feedback bad' }, '✗ The answer is: ' + answerText(item)));
      if (ok || final) fb.appendChild(h('div', { class: 'explain' }, h('b', null, 'Why: '), h('span', { html: item.explanation })));
    }

    function check(given) {
      if (locked) return;
      tries++;
      var ok = isCorrect(item, given);
      var final = ok || opts.oneTry;
      if (final) lock(ok);
      feedback(ok, final);
      if (opts.onAnswer) opts.onAnswer(ok, given, final);
      if (!ok && !final && !showBtn.parentNode) actions.appendChild(showBtn);
    }

    function lock(ok) {
      locked = true;
      choiceBtns.forEach(function (b, k) {
        b.disabled = true;
        if (item.type === 'mc' && k === item.answer) b.classList.add('correct');
      });
      if (input) input.disabled = true;
      checkBtn.disabled = true;
      if (showBtn.parentNode) showBtn.parentNode.removeChild(showBtn);
    }

    var input = null;
    var checkBtn = h('button', { class: 'btn primary', type: 'button' }, 'Check');
    var showBtn = h('button', { class: 'btn ghost', type: 'button', onclick: function () {
      lock(false); feedback(false, true); if (opts.onReveal) opts.onReveal();
    } }, 'Show answer');
    var actions = h('div', { class: 'btn-row' }, checkBtn);

    if (item.type === 'mc') {
      var list = h('div', { class: 'choices', role: 'radiogroup', 'aria-label': 'Answer choices' });
      item.choices.forEach(function (c, k) {
        var b = h('button', { class: 'choice', type: 'button', role: 'radio', 'aria-checked': 'false', onclick: function () {
          if (locked) return;
          selected = k;
          choiceBtns.forEach(function (x, j) { x.classList.toggle('selected', j === k); x.setAttribute('aria-checked', j === k ? 'true' : 'false'); x.classList.remove('wrong'); });
        } }, h('span', { class: 'letter', 'aria-hidden': 'true' }, 'ABCD'.charAt(k)), h('span', { html: c }));
        choiceBtns.push(b);
        list.appendChild(b);
      });
      box.appendChild(list);
      checkBtn.addEventListener('click', function () {
        if (selected === null) { U.clear(fb).appendChild(h('div', { class: 'feedback warn' }, 'Pick an answer first.')); return; }
        if (selected !== item.answer) choiceBtns[selected].classList.add('wrong');
        check(selected);
      });
    } else {
      var id = U.nextId('ans');
      input = h('input', { id: id, type: 'text', inputmode: 'decimal', autocomplete: 'off', class: 'answer-input', placeholder: item.unit === '$' ? 'e.g. 125.50' : 'Type a number' });
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') checkBtn.click(); });
      box.appendChild(h('label', { for: id, class: 'small muted' }, 'Your answer' + (item.unit && item.unit !== '$' ? ' (' + item.unit + ')' : '')));
      box.appendChild(h('div', { class: 'num-wrap' + (item.unit === '$' ? ' has-pre' : '') + (item.unit === '%' ? ' has-suf' : '') },
        item.unit === '$' ? h('span', { class: 'pre', 'aria-hidden': 'true' }, '$') : null, input,
        item.unit === '%' ? h('span', { class: 'suf', 'aria-hidden': 'true' }, '%') : null));
      checkBtn.addEventListener('click', function () {
        var v = parseAnswer(input.value);
        if (!isFinite(v)) { U.clear(fb).appendChild(h('div', { class: 'feedback warn' }, 'Type a number, like 42 or 12.50.')); return; }
        check(v);
      });
    }
    box.appendChild(actions);
    box.appendChild(fb);
    box.isLocked = function () { return locked; };
    return box;
  }

  /* ----- practice ----- */

  function renderPractice(sec, arg) {
    var i = Math.max(0, Math.min(sec.practice.length - 1, (parseInt(arg, 10) || 1) - 1));
    var item = sec.practice[i];
    var dots = h('div', { class: 'dots', role: 'list', 'aria-label': 'Practice questions' }, sec.practice.map(function (p, k) {
      var r = S.practice[p.id];
      return h('a', { role: 'listitem', class: 'dot' + (r && r.correct ? ' ok' : r ? ' tried' : '') + (k === i ? ' current' : ''), href: '#/s/' + sec.id + '/practice/' + (k + 1),
        'aria-label': 'Question ' + (k + 1) + (r && r.correct ? ' (correct)' : r ? ' (tried)' : ''), 'aria-current': k === i ? 'step' : null }, String(k + 1));
    }));
    var done = sec.practice.filter(function (p) { return S.practice[p.id] && S.practice[p.id].correct; }).length;
    var next = i < sec.practice.length - 1 ? h('a', { class: 'btn primary', href: '#/s/' + sec.id + '/practice/' + (i + 2) }, 'Next question →') : nextTabLink(sec, 'practice');
    var q = questionView(item, { onAnswer: function (ok) { window.Store.recordPractice(item.id, ok); } });
    show(sectionHeader(sec, 'practice'),
      h('p', { class: 'muted small' }, done + ' of ' + sec.practice.length + ' solved. Practice doesn\'t count against you: try as many times as you like.'),
      dots,
      h('div', { class: 'card' }, h('p', { class: 'sec-num' }, 'Question ' + (i + 1) + ' of ' + sec.practice.length), q),
      h('div', { class: 'pager' }, i > 0 ? h('a', { class: 'btn ghost', href: '#/s/' + sec.id + '/practice/' + i }, '← Back') : h('span'), next));
  }

  /* ----- quiz ----- */

  function renderQuiz(sec) {
    var past = S.quizzes[sec.id];
    show(sectionHeader(sec, 'quiz'),
      h('div', { class: 'card center' },
        h('h2', null, sec.title + ' quiz'),
        h('p', null, sec.quiz.length + ' questions. One try each. You\'ll see the right answer and why after each one.'),
        past ? h('p', { class: 'muted' }, 'Best score: ' + past.best + '/' + past.total + ' · Last: ' + past.latest + '/' + past.total) : null,
        h('button', { class: 'btn primary', type: 'button', onclick: function () { runQuiz(sec); } }, past ? 'Retake quiz' : 'Start quiz')));
  }

  function runQuiz(sec) {
    var items = sec.quiz.slice();
    var i = 0, score = 0, results = [];
    var holder = h('div');
    show(sectionHeader(sec, 'quiz'), holder);
    function step() {
      U.clear(holder);
      if (i >= items.length) return finish();
      var item = items[i];
      var nextBtn = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: function () { i++; step(); } }, i < items.length - 1 ? 'Next question →' : 'See my score →');
      function done(ok) {
        if (ok) score++;
        results.push({ item: item, ok: ok });
        nextBtn.disabled = false;
        nextBtn.focus();
      }
      var q = questionView(item, { oneTry: true, onAnswer: function (ok) { done(ok); } });
      holder.appendChild(h('div', { class: 'quiz-top row-between' }, h('span', { class: 'sec-num' }, 'Question ' + (i + 1) + ' of ' + items.length), h('span', { class: 'small' }, 'Score: ' + score)));
      holder.appendChild(bar(Math.round(i / items.length * 100), 'Quiz progress'));
      holder.appendChild(h('div', { class: 'card' }, q));
      holder.appendChild(h('div', { class: 'pager' }, h('span'), nextBtn));
      var first = holder.querySelector('.choice, .answer-input');
      if (first && i > 0) first.focus();
    }
    function finish() {
      window.Store.recordQuiz(sec.id, score, items.length);
      var pct = Math.round(score / items.length * 100);
      var msg = pct === 100 ? 'Perfect score! 🎉' : pct >= 80 ? 'Great job! You know this stuff.' : pct >= 60 ? 'Good start. Review the ones you missed and try again.' : 'Keep going! Re-read the lessons, then retake it.';
      holder.appendChild(h('div', { class: 'card center', role: 'status' },
        h('p', { class: 'big-score' }, score + ' / ' + items.length),
        h('p', null, msg),
        h('p', { class: 'muted small' }, 'Best: ' + S.quizzes[sec.id].best + '/' + items.length)));
      holder.appendChild(h('h3', null, 'Review'));
      results.forEach(function (r, k) {
        holder.appendChild(h('details', { class: 'review ' + (r.ok ? 'ok' : 'miss') },
          h('summary', null, (r.ok ? '✓ ' : '✗ ') + 'Question ' + (k + 1)),
          h('p', { html: r.item.prompt }),
          h('p', null, h('b', null, 'Answer: '), h('span', { html: answerText(r.item) })),
          h('p', { html: r.item.explanation })));
      });
      holder.appendChild(h('div', { class: 'pager' },
        h('button', { class: 'btn ghost', type: 'button', onclick: function () { runQuiz(sec); } }, 'Retake'),
        nextTabLink(sec, 'quiz')));
      if (pct === 100 && !U.reducedMotion()) U.celebrate(holder, 'Perfect quiz!');
    }
    step();
  }

  /* ---------- flashcards ---------- */

  function renderCards(filter) {
    var all = [];
    CONTENT.sections.forEach(function (s) { s.flashcards.forEach(function (c) { all.push({ c: c, s: s }); }); });
    var deck = all.filter(function (x) { return !filter || x.s.id === filter; });
    var onlyLearning = false;
    var i = 0, flipped = false;
    var stage = h('div');
    var chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Choose a section' },
      h('a', { class: 'chip', href: '#/cards', 'aria-current': !filter ? 'page' : null }, 'All'),
      CONTENT.sections.map(function (s) { return h('a', { class: 'chip', href: '#/cards/' + s.id, 'aria-current': filter === s.id ? 'page' : null }, s.icon + ' ' + s.title); }));
    function current() { return onlyLearning ? deck.filter(function (x) { return S.cards[x.c.id] !== 'know'; }) : deck; }
    function draw() {
      U.clear(stage);
      var d = current();
      var known = deck.filter(function (x) { return S.cards[x.c.id] === 'know'; }).length;
      stage.appendChild(h('p', { class: 'muted small' }, known + ' of ' + deck.length + ' marked "Got it".'));
      if (!d.length) {
        stage.appendChild(h('div', { class: 'card center' }, h('p', null, 'You know every card here! 🎉'), h('button', { class: 'btn ghost', type: 'button', onclick: function () { onlyLearning = false; i = 0; draw(); } }, 'Show all cards')));
        return;
      }
      i = (i + d.length) % d.length;
      var x = d[i];
      var cardBtn = h('button', { class: 'flashcard' + (flipped ? ' flipped' : ''), type: 'button', 'aria-label': (flipped ? 'Answer: ' + x.c.back : 'Term: ' + x.c.front) + '. Tap to flip.',
        onclick: function () { flipped = !flipped; draw(); stage.querySelector('.flashcard').focus(); } },
        h('span', { class: 'side-label' }, flipped ? 'Meaning' : x.s.icon + ' ' + x.s.title),
        h('span', { class: 'fc-text' }, flipped ? x.c.back : x.c.front),
        h('span', { class: 'fc-hint' }, flipped ? 'Tap to see the word' : 'Tap to flip'));
      stage.appendChild(h('p', { class: 'center small' }, 'Card ' + (i + 1) + ' of ' + d.length));
      stage.appendChild(cardBtn);
      stage.appendChild(h('div', { class: 'btn-row two' },
        h('button', { class: 'btn ghost', type: 'button', onclick: function () { window.Store.setCard(x.c.id, 'learning'); flipped = false; i++; draw(); } }, '↻ Still learning'),
        h('button', { class: 'btn primary', type: 'button', onclick: function () { window.Store.setCard(x.c.id, 'know'); flipped = false; if (!onlyLearning) i++; draw(); } }, '✓ Got it')));
      stage.appendChild(h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost small', type: 'button', onclick: function () { flipped = false; i--; draw(); } }, '← Prev'),
        h('button', { class: 'btn ghost small', type: 'button', onclick: function () { flipped = false; i++; draw(); } }, 'Next →'),
        h('button', { class: 'btn ghost small', type: 'button', onclick: function () { deck.sort(function () { return Math.random() - 0.5; }); i = 0; flipped = false; draw(); } }, '🔀 Shuffle'),
        h('button', { class: 'btn ghost small' + (onlyLearning ? ' active' : ''), type: 'button', 'aria-pressed': onlyLearning ? 'true' : 'false', onclick: function () { onlyLearning = !onlyLearning; i = 0; flipped = false; draw(); } }, 'Only cards I\'m learning')));
    }
    show(h('h1', null, 'Flashcards'), chips, stage);
    draw();
  }

  /* ---------- glossary ---------- */

  function renderGlossary() {
    var terms = CONTENT.glossary.slice().sort(function (a, b) { return a.term.localeCompare(b.term); });
    var id = U.nextId('gq');
    var input = h('input', { id: id, type: 'search', placeholder: 'Search, e.g. APR', autocomplete: 'off' });
    var count = h('p', { class: 'muted small', 'aria-live': 'polite' });
    var list = h('dl', { class: 'glossary' });
    function draw() {
      var q = input.value.trim().toLowerCase();
      U.clear(list);
      var hits = terms.filter(function (t) { return !q || t.term.toLowerCase().indexOf(q) !== -1 || t.def.toLowerCase().indexOf(q) !== -1; });
      hits.forEach(function (t) {
        var sec = CONTENT.byId[t.section];
        list.appendChild(h('div', { class: 'g-item' },
          h('dt', null, t.term),
          h('dd', null, t.def, sec ? h('a', { class: 'g-sec small', href: '#/s/' + sec.id }, ' ' + sec.icon + ' ' + sec.title) : null)));
      });
      count.textContent = hits.length === terms.length ? terms.length + ' words' : hits.length + ' of ' + terms.length + ' words match';
      if (!hits.length) list.appendChild(h('p', null, 'No matches. Try a shorter word.'));
    }
    input.addEventListener('input', draw);
    show(h('h1', null, 'Glossary'), h('div', { class: 'field' }, h('label', { for: id }, 'Search money words'), input), count, list);
    draw();
  }

  /* ---------- progress ---------- */

  function renderProgress() {
    var rows = CONTENT.sections.map(function (sec) {
      var p = sectionProgress(sec);
      return h('tr', null,
        h('td', null, h('a', { href: '#/s/' + sec.id }, sec.icon + ' ' + sec.title)),
        h('td', null, p.lessons + '/' + sec.lessons.length),
        h('td', null, p.practice + '/' + sec.practice.length),
        h('td', null, p.quiz ? p.quiz.best + '/' + p.quiz.total : '—'),
        h('td', null, p.pct + '%'));
    });
    var cardsKnown = Object.keys(S.cards).filter(function (k) { return S.cards[k] === 'know'; }).length;
    var totalCards = CONTENT.sections.reduce(function (s, x) { return s + x.flashcards.length; }, 0);
    var status = h('p', { class: 'small', 'aria-live': 'polite' });
    show(h('h1', null, 'Your progress'),
      h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['Section', 'Lessons', 'Practice', 'Best quiz', 'Done'].map(function (t) { return h('th', { scope: 'col' }, t); }))),
        h('tbody', null, rows)))),
      h('div', { class: 'stats' },
        U.stat('Flashcards known', cardsKnown + '/' + totalCards),
        U.stat('Sort game best', S.games.sort != null ? S.games.sort + '/10' : '—'),
        U.stat('Savings goals', String(S.goals.length)),
        U.stat('Budget sheets', String(Object.keys(S.sheets || {}).length))),
      h('div', { class: 'card' },
        h('h2', null, 'Start over'),
        h('p', { class: 'small' }, 'Progress and saved calculator data live only in this browser on this device. Nothing is sent anywhere.'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn ghost danger', type: 'button', onclick: function () {
            if (window.confirm('Reset all lesson, practice, quiz, and flashcard progress? (Saved budgets, goals, and debts stay.)')) { window.Store.resetProgress(); renderProgress(); }
          } }, 'Reset progress'),
          h('button', { class: 'btn ghost danger', type: 'button', onclick: function () {
            if (window.confirm('Clear your saved budget, savings goals, and debt list? (Monthly budget sheets stay.)')) { window.Store.resetTools(); status.textContent = 'Saved calculator data cleared.'; }
          } }, 'Clear saved calculator data'),
          h('button', { class: 'btn ghost danger', type: 'button', onclick: function () {
            var n = Object.keys(S.sheets || {}).length;
            if (!n) { status.textContent = 'There are no saved budget sheets.'; return; }
            if (window.confirm('Delete all ' + U.plural(n, 'monthly budget sheet') + '? This can\'t be undone. (Download a CSV first if you want a copy.)')) { window.Store.resetSheets(); status.textContent = 'All budget sheets deleted.'; }
          } }, 'Delete all budget sheets')),
        status),
      h('p', { class: 'notice' }, CONTENT.app.notice));
  }

  function notFound() {
    show(h('div', { class: 'card center' }, h('h1', null, 'Page not found'), h('a', { class: 'btn primary', href: '#/' }, 'Go home')));
  }

  /* ---------- router ---------- */

  function setTab(name) {
    document.querySelectorAll('.tabbar a').forEach(function (a) {
      if (a.getAttribute('data-tab') === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  function route() {
    if (!CONTENT) return;
    var parts = (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean);
    var title = 'Money Lab';
    if (!parts.length) { setTab('home'); renderHome(); }
    else if (parts[0] === 's' && CONTENT.byId[parts[1]]) {
      setTab('home');
      var sec = CONTENT.byId[parts[1]];
      title = sec.title + ' · Money Lab';
      renderSection(sec, parts[2] || 'learn', parts[3]);
    }
    else if (parts[0] === 'tools' && parts[1]) { setTab('tools'); title = (T.list[parts[1]] ? T.list[parts[1]].title + ' · ' : '') + 'Money Lab'; renderToolPage(parts[1]); }
    else if (parts[0] === 'tools') { setTab('tools'); title = 'Tools · Money Lab'; renderTools(); }
    else if (parts[0] === 'tool') { setTab('tools'); title = (T.list[parts[1]] ? T.list[parts[1]].title + ' · ' : '') + 'Money Lab'; renderToolPage(parts[1]); }
    else if (parts[0] === 'cards') { setTab('cards'); title = 'Flashcards · Money Lab'; renderCards(CONTENT.byId[parts[1]] ? parts[1] : null); }
    else if (parts[0] === 'glossary') { setTab('glossary'); title = 'Glossary · Money Lab'; renderGlossary(); }
    else if (parts[0] === 'progress') { setTab('progress'); title = 'Progress · Money Lab'; renderProgress(); }
    else notFound();
    document.title = title;
    focusMain();
  }

  window.addEventListener('hashchange', route);

  loadContent().then(route).catch(function (e) {
    show(h('div', { class: 'card' }, h('h1', null, 'Couldn\'t load lessons'),
      h('p', null, 'Money Lab needs to be opened from a web server (not as a file). See README.md.'),
      h('p', { class: 'muted small' }, String(e && e.message || e))));
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
}());
