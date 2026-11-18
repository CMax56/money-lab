/* Money Lab local storage. Everything stays in this browser's localStorage.
 * Nothing is ever sent anywhere. */
(function (global) {
  'use strict';

  var KEY = 'moneylab.v1';

  function blank() {
    return {
      version: 1,
      lessons: {},     // lessonId -> true (read)
      practice: {},    // itemId -> { correct: bool, attempts: n }
      quizzes: {},     // sectionId -> { best, latest, total, history: [{ at, score, total }] }
      cards: {},       // cardId -> 'know' | 'learning'
      games: {},       // gameId -> best score
      // saved calculator inputs (so they are there next time)
      budget: null,    // { income, cats: [{ name, group, amount }] }
      goals: [],       // [{ id, name, goal, saved, perWeek }]
      debts: null,     // { list: [{ name, balance, minPayment, apr }], extra }
      sheets: {},      // Budget Sheet: 'YYYY-MM' -> sheet (see js/sheet.js for the model; money in cents)
      tipDismissed: false
    };
  }

  var state = null;

  function load() {
    var base = blank();
    try {
      var raw = global.localStorage.getItem(KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        if (saved && typeof saved === 'object') {
          for (var k in saved) if (Object.prototype.hasOwnProperty.call(base, k)) base[k] = saved[k];
        }
      }
    } catch (e) { /* storage blocked or corrupt: start fresh in memory */ }
    if (!base.sheets || typeof base.sheets !== 'object' || Array.isArray(base.sheets)) base.sheets = {};
    state = base;
    return state;
  }

  function save() {
    try { global.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  function resetProgress() {
    var keep = { budget: state.budget, goals: state.goals, debts: state.debts, sheets: state.sheets };
    var fresh = blank();
    Object.keys(fresh).forEach(function (k) { state[k] = fresh[k]; });
    state.budget = keep.budget; state.goals = keep.goals; state.debts = keep.debts; state.sheets = keep.sheets;
    save();
  }

  function resetTools() {
    state.budget = null; state.goals = []; state.debts = null;
    save();
  }

  function resetSheets() { state.sheets = {}; save(); }

  function markLesson(id) { if (!state.lessons[id]) { state.lessons[id] = true; save(); } }

  function recordPractice(id, correct) {
    var r = state.practice[id] || { correct: false, attempts: 0 };
    r.attempts++;
    if (correct) r.correct = true;
    state.practice[id] = r;
    save();
  }

  function recordQuiz(sectionId, score, total) {
    var q = state.quizzes[sectionId] || { best: 0, latest: 0, total: total, history: [] };
    q.latest = score; q.total = total;
    if (score > q.best) q.best = score;
    q.history.push({ at: new Date().toISOString(), score: score, total: total });
    if (q.history.length > 20) q.history = q.history.slice(-20);
    state.quizzes[sectionId] = q;
    save();
  }

  function setCard(id, v) { state.cards[id] = v; save(); }

  function recordGame(id, score) {
    if (!(state.games[id] >= score)) { state.games[id] = score; save(); }
  }

  global.Store = {
    load: load, save: save, resetProgress: resetProgress, resetTools: resetTools, resetSheets: resetSheets,
    markLesson: markLesson, recordPractice: recordPractice, recordQuiz: recordQuiz,
    setCard: setCard, recordGame: recordGame,
    get state() { return state; }
  };
}(window));
