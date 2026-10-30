'use strict';

/* ---------- basics ---------- */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const KEY = 'quota.v1';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const SUBJECTS = [
  'General', 'Polity', 'History', 'Geography', 'Economy', 'Environment', 'Science & Tech',
  'Ethics (GS4)', 'Current Affairs', 'Answer Writing', 'Essay', 'CSAT', 'Optional', 'Revision',
];

const DEFAULTS = {
  settings: {
    name: 'Khitanshu',
    dailyGoal: 9,
    weeklyGoal: 63,
    linkWeekly: true,
    weekStart: 1,
    dayCutoff: 3,
    focusMin: 50,
    shortMin: 10,
    longMin: 20,
    longEvery: 3,
    autoBreak: true,
    autoFocus: false,
    countMin: 30,
    countStudy: true,
    volume: 0.7,
    nudgeEnabled: true,
    nudgeTime: '20:00',
    subject: 'General',
    logMode: 'clock',
  },
  sessions: [],
  alarms: [
    { id: 'a1', time: '06:00', label: 'Rise. Newspaper first.', repeat: 'daily', enabled: true, lastFired: null },
  ],
  snooze: null,
  meta: { lastBriefing: null, badges: {}, celebrated: {}, lastNudge: null },
  timer: null,
};

const RANKS = [
  [0, 'Aspirant'],
  [1500, 'Newspaper Regular'],
  [5000, 'NCERT Finisher'],
  [12000, 'Prelims Qualified'],
  [25000, 'Mains Warrior'],
  [45000, 'Interview Call'],
  [70000, 'LBSNAA Probationer'],
  [100000, 'Sub-Divisional Magistrate'],
  [140000, 'District Collector'],
  [200000, 'Joint Secretary'],
  [280000, 'Cabinet Secretary'],
];

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function load() {
  const base = structuredClone(DEFAULTS);
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && typeof raw === 'object') {
      const s = {
        ...base, ...raw,
        settings: { ...base.settings, ...raw.settings },
        meta: { ...base.meta, ...raw.meta },
      };
      s.sessions = (Array.isArray(raw.sessions) ? raw.sessions : [])
        .filter(x => x && DAY_RE.test(x.day) && Number.isFinite(x.min) && x.min > 0);
      s.alarms = Array.isArray(raw.alarms) ? raw.alarms : base.alarms;
      return s;
    }
  } catch (e) { /* corrupted storage: start fresh */ }
  return base;
}

let state = load();
const S = () => state.settings;

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage blocked */ }
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtHM = min => {
  min = Math.max(0, Math.round(min));
  return `${Math.floor(min / 60)}h ${pad(min % 60)}m`;
};
const fmtH = min => (min / 60).toFixed(1);
const fmtGoal = h => `${+h.toFixed(2)}h`;
const fmtClock = ms => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
};
const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/* ---------- dates ---------- */

const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const shortDate = s => parseYmd(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const dayNumber = s => Math.round(parseYmd(s).getTime() / 864e5);

// The study "day" ends at dayCutoff (e.g. 3 AM), so late nights count for the day before.
const dayKey = (ts = Date.now()) => ymd(new Date(ts - S().dayCutoff * 3600000));

function weekStartKey(day) {
  const d = parseYmd(day);
  d.setDate(d.getDate() - ((d.getDay() - S().weekStart + 7) % 7));
  return ymd(d);
}
const weekDays = day => { const s = weekStartKey(day); return Array.from({ length: 7 }, (_, i) => addDays(s, i)); };

/* ---------- derived numbers ---------- */

function totals() {
  const m = new Map();
  for (const s of state.sessions) m.set(s.day, (m.get(s.day) || 0) + s.min);
  return m;
}
const sumDays = (T, days) => days.reduce((a, d) => a + (T.get(d) || 0), 0);

// The first day Quota was used (or the earliest logged day). Days before it don't count against the quota.
function startDay() {
  let first = state.meta.startDay || dayKey();
  for (const s of state.sessions) if (s.day < first) first = s.day;
  return first;
}

function weekInfo(today, T) {
  const days = weekDays(today);
  const idx = days.indexOf(today);
  const goalD = S().dailyGoal * 60;
  // In the week Quota was started, the quota covers only the days from the start.
  const from = Math.max(0, days.findIndex(d => d >= startDay()));
  const goalW = Math.round(S().weeklyGoal * 60 * (7 - from) / 7);
  const before = sumDays(T, days.slice(0, idx));
  const todayMin = T.get(today) || 0;
  const done = before + todayMin;
  const daysLeft = 7 - idx;
  // Whatever was missed earlier in the week is spread over the days that remain.
  const pace = Math.max(0, goalW - before) / daysLeft;
  const target = Math.max(goalD, Math.ceil(pace));
  const debt = Math.max(0, Math.round((goalW / (7 - from)) * (idx - from) - before));
  return { days, idx, from, before, todayMin, done, daysLeft, pace, target, debt, goalD, goalW, weekLeft: Math.max(0, goalW - done) };
}

function dayStreak(T, today) {
  const g = S().dailyGoal * 60;
  let d = (T.get(today) || 0) >= g ? today : addDays(today, -1);
  let n = 0;
  while ((T.get(d) || 0) >= g) { n++; d = addDays(d, -1); }
  return n;
}

function weekTotals(T) {
  const w = new Map();
  for (const [d, m] of T) { const k = weekStartKey(d); w.set(k, (w.get(k) || 0) + m); }
  return w;
}

function weekStreak(T, today) {
  const W = weekTotals(T), g = S().weeklyGoal * 60;
  let wk = weekStartKey(today);
  if ((W.get(wk) || 0) < g) wk = addDays(wk, -7);
  let n = 0;
  while ((W.get(wk) || 0) >= g) { n++; wk = addDays(wk, -7); }
  return n;
}

function bestStreak(T) {
  const g = S().dailyGoal * 60;
  const met = [...T].filter(([, m]) => m >= g).map(([d]) => d).sort();
  let best = 0, run = 0, prev = null;
  for (const d of met) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

function computeXP(T) {
  const gD = S().dailyGoal * 60, gW = S().weeklyGoal * 60;
  let xp = 0;
  for (const m of T.values()) xp += Math.round(m) + (m >= gD ? 120 : 0);
  for (const m of weekTotals(T).values()) if (m >= gW) xp += 600;
  return xp;
}

function rankFor(xp) {
  let i = 0;
  while (i + 1 < RANKS.length && xp >= RANKS[i + 1][0]) i++;
  const [lo, name] = RANKS[i];
  const next = RANKS[i + 1];
  const pct = next ? ((xp - lo) / (next[0] - lo)) * 100 : 100;
  return { i, lo, name, next, pct };
}

/* ---------- badges ---------- */

const BADGES = [
  { id: 'first', name: 'First step', desc: 'Log your first session.', test: c => c.sessions.length > 0 },
  { id: 'fullday', name: 'Full day', desc: 'Hit the daily goal once.', test: c => c.goalDays >= 1 },
  { id: 'sun', name: 'Burn like a sun', desc: 'Study 12+ hours in one day. (Kalam)', test: c => c.bestDay >= 720 },
  { id: 'brahma', name: 'Brahma muhurta', desc: 'Start a session between 4 and 6 AM.', test: c => c.early },
  { id: 'breaking2', name: 'Breaking2', desc: 'One unbroken session of 2+ hours. (Kipchoge)', test: c => c.longest >= 120 },
  { id: 's3', name: 'On fire', desc: '3-day goal streak.', test: c => c.best >= 3 },
  { id: 'cr7', name: 'CR7', desc: '7-day goal streak. Siuuu.', test: c => c.best >= 7 },
  { id: 'quota', name: 'Quota crusher', desc: 'Hit the weekly quota.', test: c => c.quotaWeeks >= 1 },
  { id: 'comeback', name: 'Comeback', desc: 'Miss a day, still finish the week\'s quota.', test: c => c.comeback },
  { id: 'perfect', name: 'Perfect week', desc: 'Daily goal hit on all 7 days of a week.', test: c => c.perfect },
  { id: 's21', name: 'Habit forged', desc: '21-day goal streak.', test: c => c.best >= 21 },
  { id: 'wings', name: 'Wings of Fire', desc: '100 hours total. (Kalam)', test: c => c.total >= 6000 },
  { id: 'everest', name: 'Everest', desc: '8,848 minutes total. (Tenzing)', test: c => c.total >= 8848 },
  { id: 'q4', name: 'Month of steel', desc: '4 quota weeks in a row.', test: c => c.bestWeekRun >= 4 },
  { id: 's50', name: 'Unbreakable', desc: '50-day goal streak.', test: c => c.best >= 50 },
  { id: 'missile', name: 'Missile Man', desc: '1,000 hours total. (Kalam)', test: c => c.total >= 60000 },
];

// Start time of a session in ms, when we know it: clock entries carry from/to, timers carry their end.
function sessionStart(s) {
  if (s.from && TIME_RE.test(s.from)) {
    const d = parseYmd(s.day);
    const [h, m] = s.from.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    if (h < S().dayCutoff) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  if (s.src !== 'manual' && s.at) return s.at - s.min * 60000;
  return null;
}

function badgeContext(T) {
  const gD = S().dailyGoal * 60, gW = S().weeklyGoal * 60;
  const W = weekTotals(T);
  let comeback = false, perfect = false, quotaWeeks = 0;
  for (const [wk, m] of W) {
    if (m < gW) continue;
    quotaWeeks++;
    const days = Array.from({ length: 7 }, (_, i) => addDays(wk, i));
    const short = days.filter(d => (T.get(d) || 0) < gD).length;
    if (short > 0) comeback = true;
    if (short === 0) perfect = true;
  }
  const weeksHit = [...W].filter(([, m]) => m >= gW).map(([w]) => w).sort();
  let bestWeekRun = 0, run = 0, prev = null;
  for (const w of weeksHit) {
    run = prev && addDays(prev, 7) === w ? run + 1 : 1;
    bestWeekRun = Math.max(bestWeekRun, run);
    prev = w;
  }
  const ss = state.sessions;
  return {
    sessions: ss,
    total: [...T.values()].reduce((a, b) => a + b, 0),
    goalDays: [...T.values()].filter(m => m >= gD).length,
    bestDay: Math.max(0, ...T.values()),
    longest: Math.max(0, ...ss.filter(s => s.src !== 'manual' || s.from).map(s => s.min)),
    early: ss.some(s => {
      const t = sessionStart(s);
      if (t == null) return false;
      const h = new Date(t).getHours();
      return h >= 4 && h < 6;
    }),
    best: bestStreak(T),
    quotaWeeks, comeback, perfect, bestWeekRun,
  };
}

function checkBadges(T, quiet = false) {
  const ctx = badgeContext(T);
  for (const b of BADGES) {
    if (!state.meta.badges[b.id] && b.test(ctx)) {
      state.meta.badges[b.id] = dayKey();
      if (!quiet) { toast(`Badge unlocked: ${b.name}`); confetti(); }
    }
  }
  save();
}

/* ---------- sound ---------- */

let actx = null;
function audio() {
  if (!actx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    actx = new C();
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}

function tone(freq, start, dur, type = 'sine', vol = 1) {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  const t = a.currentTime + start;
  const v = Math.max(0.0002, S().volume * vol * 0.5);
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

const chime = () => { tone(660, 0, 0.4); tone(880, 0.18, 0.4); tone(1320, 0.36, 0.7); };
const beeps = () => { [0, 0.22, 0.44, 0.66].forEach(t => tone(988, t, 0.14, 'square', 0.45)); };

// Browsers only allow audio after a user gesture, so unlock it on the first tap.
document.addEventListener('pointerdown', () => audio(), { once: true });

/* ---------- notifications ---------- */

async function notify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg) return reg.showNotification(title, { body, icon: 'icon.svg', tag: 'quota', renotify: true });
    new Notification(title, { body, icon: 'icon.svg' });
  } catch (e) { /* notifications unavailable */ }
}

/* ---------- toasts & confetti ---------- */

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), 3200);
  setTimeout(() => el.remove(), 3700);
}

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const wrap = document.createElement('div');
  wrap.className = 'confetti';
  const colors = ['#ff6b1f', '#ffffff', '#ffb27a'];
  for (let i = 0; i < 60; i++) {
    const p = document.createElement('i');
    p.style.left = Math.random() * 100 + 'vw';
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = Math.random() * 0.4 + 's';
    p.style.setProperty('--dx', (Math.random() * 240 - 120) + 'px');
    p.style.setProperty('--r', (Math.random() * 900) + 'deg');
    wrap.appendChild(p);
  }
  document.body.appendChild(wrap);
  setTimeout(() => wrap.remove(), 3000);
}

/* ---------- sessions ---------- */

function addSession(min, src, day = dayKey(), extra = {}) {
  min = Math.round(min);
  if (min < 1) return;
  state.sessions.push({ id: uid(), day, at: Date.now(), min, subject: S().subject, src, ...extra });
  save();
  afterChange();
}

function afterChange() {
  const T = totals();
  const today = dayKey();
  const W = weekInfo(today, T);
  const c = state.meta.celebrated;
  if (W.todayMin >= W.target && !c['d' + today]) {
    c['d' + today] = 1;
    confetti(); chime();
    toast(`Today's target done: ${fmtHM(W.todayMin)}.`);
  }
  const wk = 'w' + W.days[0];
  if (W.done >= W.goalW && !c[wk]) {
    c[wk] = 1;
    confetti();
    toast(`Weekly quota complete: ${fmtGoal(W.goalW / 60)}. That's how officers are made.`);
  }
  checkBadges(T);
  renderAll();
}

function deleteSession(id) {
  const s = state.sessions.find(x => x.id === id);
  if (!s || !confirm(`Delete ${fmtHM(s.min)} of ${s.subject} on ${shortDate(s.day)}?`)) return;
  state.sessions = state.sessions.filter(x => x.id !== id);
  save();
  renderAll();
}

const SRC = { manual: 'Logged', pomodoro: 'Pomodoro', stopwatch: 'Stopwatch', timer: 'Countdown' };

function entryItem(s, showDay) {
  const when = s.from ? `${s.from} – ${s.to}` : SRC[s.src] || 'Logged';
  const meta = [showDay ? shortDate(s.day) : '', s.subject].filter(Boolean).join(' · ');
  return `<li><div><span class="e-main num">${esc(when)}</span><span class="e-meta">${esc(meta)}</span></div>
    <b class="num">${fmtHM(s.min)}</b><button class="icon-btn" data-del="${esc(s.id)}" aria-label="Delete entry"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></li>`;
}

const sortEntries = (a, b) => (b.day.localeCompare(a.day)) || ((sessionStart(b) ?? b.at) - (sessionStart(a) ?? a.at));

/* ---------- rendering ---------- */

function greeting() {
  const h = new Date().getHours();
  if (h < 4) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function renderHeader(T) {
  const xp = computeXP(T);
  const r = rankFor(xp);
  $('#rankName').textContent = r.name;
  $('#xpText').textContent = `${xp.toLocaleString()} XP`;
  $('#rankBig').textContent = r.name;
  $('#rankXp').textContent = `${xp.toLocaleString()} XP`;
  $('#rankFill').style.width = r.pct + '%';
  $('#rankEnds').innerHTML = r.next
    ? `<span>${r.lo.toLocaleString()}</span><span>${esc(r.next[1])} at ${r.next[0].toLocaleString()}</span>`
    : '<span>Top of the ladder</span>';
  $('#rankLine').textContent = r.next ? `${(r.next[0] - xp).toLocaleString()} XP to ${r.next[1]}` : 'Top of the ladder. Now keep it.';
  $('#ladder').innerHTML = RANKS.map(([x, n], i) =>
    `<li class="${i < r.i ? 'done' : i === r.i ? 'cur' : ''}"><span>${esc(n)}</span><span class="num">${x.toLocaleString()}</span></li>`).join('');
}

function renderClock() {
  const now = new Date();
  $('#nowTime').textContent = hhmm(now);
  $('#nowSec').textContent = ':' + pad(now.getSeconds());
}

function renderHome(T) {
  const today = dayKey();
  const W = weekInfo(today, T);
  const goalD = W.goalD;

  $('#dateTitle').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  $('#hello').textContent = `${greeting()}, ${S().name || 'aspirant'}`;
  renderClock();

  // The finding: the one thing that needs attention, read before anything else.
  const finding = $('#finding');
  const lastDay = DOW[parseYmd(W.days[6]).getDay()];
  if (W.done >= W.goalW) {
    finding.innerHTML = `<span class="pill good">Quota done</span><span>${fmtH(W.done)}h this week. Keep the daily habit; extra hours are a bonus.</span>`;
  } else if (W.debt > 0) {
    finding.innerHTML = `<span class="pill bad">${fmtHM(W.debt)} behind</span><span>Today's target is raised to ${fmtHM(W.target)} so you still finish ${fmtGoal(W.goalW / 60)} by ${lastDay}.</span>`;
  } else if (W.todayMin >= W.target) {
    finding.innerHTML = `<span class="pill good">Today done</span><span>Bank a little extra for the week if you can.</span>`;
  } else {
    finding.innerHTML = '';
  }
  finding.hidden = !finding.innerHTML;

  // Today
  const met = W.todayMin >= W.target;
  const pct = clamp(W.todayMin / W.target, 0, 1);
  $('#todayDone').textContent = fmtHM(W.todayMin);
  $('#todayOf').textContent = met ? `of ${fmtHM(W.target)}, target done` : `of ${fmtHM(W.target)} · ${fmtHM(W.target - W.todayMin)} to go`;
  $('#todayTargetLabel').textContent = W.target > goalD ? `Goal ${fmtGoal(S().dailyGoal)} + ${fmtHM(W.target - goalD)} catch-up` : `Goal ${fmtGoal(S().dailyGoal)}`;
  $('#todayFill').style.width = pct * 100 + '%';
  $('#todayFill').classList.toggle('met', met);
  $('#todayEnd').textContent = fmtHM(W.target);

  const todays = state.sessions.filter(s => s.day === today).sort(sortEntries);
  $('#todaySessions').innerHTML = todays.length
    ? todays.map(s => entryItem(s, false)).join('')
    : '<li class="empty">Nothing logged yet today.</li>';

  // This week
  $('#weekRange').textContent = `${shortDate(W.days[0])} – ${shortDate(W.days[6])}`;
  $('#weekDone').textContent = `${fmtH(W.done)}h`;
  $('#weekOf').textContent = `of ${fmtGoal(W.goalW / 60)}${W.from ? ' (first week, from ' + DOW[parseYmd(W.days[W.from]).getDay()] + ')' : ''}`;
  $('#weekFill').style.width = clamp(W.done / W.goalW, 0, 1) * 100 + '%';
  $('#weekFill').classList.toggle('met', W.done >= W.goalW);
  $('#weekStrip').innerHTML = W.days.map(d => {
    const m = T.get(d) || 0;
    const cls = [m >= goalD ? 'met' : '', d === today ? 'today' : '', d > today ? 'future' : ''].join(' ');
    return `<li class="${cls}" aria-label="${DOW[parseYmd(d).getDay()]}: ${d > today ? 'upcoming' : fmtHM(m)}">
      <span>${DOW[parseYmd(d).getDay()][0]}</span>
      <span class="ws-col"><i style="height:${clamp(m / goalD, 0, 1) * 100}%"></i></span>
      <span class="ws-h">${d > today ? '–' : fmtH(m)}</span></li>`;
  }).join('');
  $('#weekFacts').innerHTML = [
    ['Left this week', fmtHM(W.weekLeft)],
    ['Days left', `${W.daysLeft} incl. today`],
    ['Daily pace needed', W.weekLeft ? `${fmtH(W.pace)} h/day` : '—', W.pace > goalD ? 'bad' : ''],
    ['Quota weeks in a row', String(weekStreak(T, today))],
  ].map(([l, v, c]) => `<div><dt>${l}</dt><dd class="${c || ''}">${v}</dd></div>`).join('');

  // Streak
  const streak = dayStreak(T, today);
  $('#streakN').textContent = streak;
  $('.flame').classList.toggle('cold', streak === 0);
  $('#streakBest').textContent = `Best ${bestStreak(T)} days`;
  renderCalendar(T, today);
  renderChart(T, today);
}

/* Month calendar: each day is one dot, filled when the daily goal was hit. */
let calMonth = null; // first day of the month on show, 'YYYY-MM-01'

function renderCalendar(T, today) {
  if (!calMonth) calMonth = today.slice(0, 8) + '01';
  const first = parseYmd(calMonth);
  const y = first.getFullYear(), m = first.getMonth();
  const days = new Date(y, m + 1, 0).getDate();
  const lead = (first.getDay() - S().weekStart + 7) % 7;
  const goalD = S().dailyGoal * 60;
  $('#calMonth').textContent = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  $('#calNext').disabled = calMonth >= today.slice(0, 8) + '01';

  const head = Array.from({ length: 7 }, (_, i) => `<span class="dow" aria-hidden="true">${DOW[(S().weekStart + i) % 7][0]}</span>`).join('');
  let cells = '<span></span>'.repeat(lead);
  for (let d = 1; d <= days; d++) {
    const key = `${y}-${pad(m + 1)}-${pad(d)}`;
    const min = T.get(key) || 0;
    const cls = key > today ? 'future' : min >= goalD ? 'met' : min > 0 ? 'part' : 'none';
    const label = `${shortDate(key)}: ${key > today ? 'upcoming' : fmtHM(min)}`;
    cells += `<span class="d ${cls}${key === today ? ' today' : ''}" role="listitem" title="${label}" aria-label="${label}">${d}</span>`;
  }
  $('#cal').innerHTML = head + cells;
}

let chartSig = '';
function renderChart(T, today) {
  const keys = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const values = keys.map(k => +((T.get(k) || 0) / 60).toFixed(2));
  const labels = keys.map(k => shortDate(k));
  const sig = JSON.stringify([values, labels, S().dailyGoal]);
  if (sig === chartSig || !window.Charts) return;
  chartSig = sig;
  const el = $('#chart14');
  el.innerHTML = '';
  Charts.bars(el, {
    labels, values, height: 250, highlight: 13,
    format: v => `${v.toFixed(1)} h`,
    tickFormat: v => `${v}h`,
    reference: { value: S().dailyGoal, label: `Goal ${fmtGoal(S().dailyGoal)}` },
  });
}

/* ---------- morning card ---------- */

function renderMorning(T) {
  const today = dayKey();
  const card = $('#morning');
  if (state.meta.lastBriefing === today) { card.hidden = true; return; }
  const W = weekInfo(today, T);
  const q = QUOTES[((dayNumber(today) % QUOTES.length) + QUOTES.length) % QUOTES.length];
  const firstTime = !state.meta.lastBriefing && state.sessions.length === 0;
  const lines = [];

  $('#mQuote').textContent = `“${q.q}”`;
  $('#mAuthor').textContent = q.a;

  if (firstTime) {
    lines.push(`<p>The deal: ${fmtGoal(S().dailyGoal)} every day, ${fmtGoal(S().weeklyGoal)} every week. Hours missed today land on tomorrow.</p>`);
  } else {
    const y = addDays(today, -1);
    const yMin = T.get(y) || 0;
    if (W.idx === 0) {
      const lastWeek = sumDays(T, weekDays(y));
      const lastGoal = weekInfo(y, T).goalW;
      lines.push(lastWeek >= lastGoal
        ? `<p><span class="pill good">Quota hit</span>Last week: ${fmtH(lastWeek)}h of ${fmtGoal(lastGoal / 60)}.</p>`
        : `<p><span class="pill bad">Missed by ${fmtHM(lastGoal - lastWeek)}</span>Last week: ${fmtH(lastWeek)}h of ${fmtGoal(lastGoal / 60)}. New week, clean slate.</p>`);
    } else if (yMin >= W.goalD) {
      lines.push(`<p><span class="pill good">Goal hit</span>Yesterday: ${fmtHM(yMin)}. Streak: ${dayStreak(T, y)} days.</p>`);
    } else {
      lines.push(`<p><span class="pill bad">${fmtHM(W.goalD - yMin)} short</span>Yesterday: ${fmtHM(yMin)} of ${fmtGoal(S().dailyGoal)}. That debt is yours to repay this week.</p>`);
    }
  }
  lines.push(`<p>Today's target: <b class="num">${fmtHM(W.target)}</b></p>`);
  $('#mReport').innerHTML = lines.join('');
  $('#mGo').textContent = W.target > W.goalD ? 'I\'ll make it up today' : 'Let\'s go';
  card.hidden = false;
}

/* ---------- log form ---------- */

function roundNow() {
  const d = new Date();
  d.setMinutes(Math.floor(d.getMinutes() / 5) * 5);
  return hhmm(d);
}

// Continue from the last logged session only if it ended recently; otherwise leave "From" for him to fill.
function lastClockEnd(day) {
  const ends = state.sessions.filter(s => s.day === day && s.to).sort((a, b) => b.at - a.at);
  if (!ends.length) return '';
  const gap = (toMin(hhmm(new Date())) - toMin(ends[0].to) + 1440) % 1440;
  return gap <= 4 * 60 ? ends[0].to : '';
}

function prefillLog() {
  const today = dayKey();
  $('#lgDay').value = today;
  $('#lgDay').max = today;
  $('#lgFrom').value = lastClockEnd(today);
  $('#lgTo').value = roundNow();
  $('#lgH').value = '';
  $('#lgM').value = '';
  updateLogPreview();
}

function setLogMode(mode) {
  S().logMode = mode;
  save();
  $('#logForm').dataset.mode = mode;
  $$('[data-logmode]').forEach(b => {
    const on = b.dataset.logmode === mode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
  });
  updateLogPreview();
}

// Reads the form; returns { min, from, to } or { error }.
function readLog() {
  if (S().logMode === 'clock') {
    const from = $('#lgFrom').value, to = $('#lgTo').value;
    if (!from || !to) return { error: 'Enter when you started and stopped.' };
    let min = toMin(to) - toMin(from);
    if (min <= 0) min += 24 * 60; // past midnight
    if (min > 16 * 60) return { error: 'That is over 16 hours. Check the times.' };
    return { min, from, to };
  }
  const h = Number($('#lgH').value) || 0, m = Number($('#lgM').value) || 0;
  const min = h * 60 + m;
  if (min < 1) return { error: 'Enter hours or minutes.' };
  if (min > 16 * 60) return { error: 'That is over 16 hours in one go.' };
  return { min };
}

function updateLogPreview() {
  const r = readLog();
  $('#lgSubmit').textContent = r.error ? 'Log' : `Log ${fmtHM(r.min)}`;
  $('#lgHint').textContent = '';
}

function overlaps(day, from, to) {
  const a0 = toMin(from), a1 = a0 + ((toMin(to) - a0 + 1440) % 1440 || 1440);
  return state.sessions.some(s => {
    if (s.day !== day || !s.from) return false;
    const b0 = toMin(s.from), b1 = b0 + s.min;
    return a0 < b1 && b0 < a1;
  });
}

function submitLog(e) {
  e.preventDefault();
  const r = readLog();
  const day = $('#lgDay').value;
  if (r.error) { $('#lgHint').textContent = r.error; return; }
  if (!DAY_RE.test(day)) { $('#lgHint').textContent = 'Pick a day.'; return; }
  if (day > dayKey()) { $('#lgHint').textContent = 'You can\'t log the future. Go study it instead.'; return; }
  if (r.from && overlaps(day, r.from, r.to) && !confirm(`${r.from} – ${r.to} overlaps a session you already logged. Log it anyway?`)) return;
  addSession(r.min, 'manual', day, r.from ? { from: r.from, to: r.to } : {});
  toast(`Logged ${fmtHM(r.min)}${day === dayKey() ? '' : ` on ${shortDate(day)}`}.`);
  prefillLog();
}

/* ---------- stats ---------- */

function renderStats(T) {
  const today = dayKey();
  const ctx = badgeContext(T);
  const daysStudied = [...T.values()].filter(m => m > 0).length;
  $('#totals').innerHTML = [
    ['Total hours', fmtH(ctx.total)],
    ['Days studied', daysStudied],
    ['Days the goal was hit', ctx.goalDays],
    ['Best day', fmtHM(ctx.bestDay)],
    ['Best streak', `${ctx.best} days`],
    ['Quota weeks', ctx.quotaWeeks],
  ].map(([l, v]) => `<div><dt>${l}</dt><dd>${v}</dd></div>`).join('');

  const got = state.meta.badges;
  $('#badgeCount').textContent = `${Object.keys(got).length} of ${BADGES.length}`;
  $('#badges').innerHTML = BADGES.map(b => `<li class="badge ${got[b.id] ? 'on' : ''}">
      <b>${esc(b.name)}</b><small>${got[b.id] ? `Earned ${shortDate(got[b.id])}` : esc(b.desc)}</small></li>`).join('');

  const WT = weekTotals(T);
  const gW = S().weeklyGoal * 60;
  const cur = weekStartKey(today);
  $('#quotaLabel').textContent = `Quota ${fmtGoal(S().weeklyGoal)}`;
  const rows = [];
  for (let i = 0; i < 8; i++) {
    const wk = addDays(cur, -7 * i);
    const m = WT.get(wk) || 0;
    const cls = i === 0 ? 'cur' : m >= gW ? 'hit' : 'miss';
    rows.push(`<div class="wk ${cls}"><span class="wk-label">${i === 0 ? 'This week' : `Week of ${shortDate(wk)}`}</span>
      <span class="wk-bar"><i style="width:${clamp(m / gW, 0, 1) * 100}%"></i></span>
      <span class="wk-val">${fmtH(m)}h</span></div>`);
  }
  $('#weeks').innerHTML = rows.join('');

  const days = new Set(weekDays(today));
  const bySub = new Map();
  for (const s of state.sessions) if (days.has(s.day)) bySub.set(s.subject, (bySub.get(s.subject) || 0) + s.min);
  const subs = [...bySub].sort((a, b) => b[1] - a[1]);
  const top = subs.length ? subs[0][1] : 1;
  $('#subjects').innerHTML = subs.length
    ? subs.map(([n, m]) => `<div class="wk"><span class="wk-label">${esc(n)}</span><span class="wk-bar"><i style="width:${m / top * 100}%"></i></span><span class="wk-val">${fmtHM(m)}</span></div>`).join('')
    : '<p class="faint">Nothing logged this week yet.</p>';

  const recent = [...state.sessions].sort(sortEntries).slice(0, 30);
  $('#recentSessions').innerHTML = recent.length
    ? recent.map(s => entryItem(s, true)).join('')
    : '<li class="empty">No entries yet.</li>';
}

function renderAlarms() {
  const list = [...state.alarms].sort((a, b) => a.time.localeCompare(b.time));
  $('#alarmList').innerHTML = list.length ? list.map(a => `<li class="${a.enabled ? '' : 'off'}">
      <div><span class="al-time num">${esc(a.time)}</span><span>${esc(a.label || 'Alarm')}</span>
      <small>${a.repeat === 'daily' ? 'Every day' : 'Once'}</small></div>
      <label class="switch"><input type="checkbox" data-toggle="${esc(a.id)}" ${a.enabled ? 'checked' : ''} aria-label="Alarm on"><span></span></label>
      <button class="icon-btn" data-delalarm="${esc(a.id)}" aria-label="Delete alarm"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></li>`).join('')
    : '<li class="empty">No alarms set.</li>';

  const n = !('Notification' in window) ? 'unsupported' : Notification.permission;
  $('#notifState').textContent = {
    granted: 'Notifications are on. Alerts reach you when the tab is in the background.',
    denied: 'Notifications are blocked. Allow them in the browser\'s site settings to get alerts.',
    default: 'Turn on notifications so alarms and timers reach you in another tab.',
    unsupported: 'This browser doesn\'t support notifications; alarms still ring with sound.',
  }[n];
  $('#notifBtn').hidden = n !== 'default';
}

function fillSettings() {
  for (const el of $$('[data-set]')) {
    const v = S()[el.dataset.set];
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v;
  }
}

function renderSubjects() {
  const opts = SUBJECTS.map(s => `<option>${esc(s)}</option>`).join('');
  for (const sel of [$('#logSubject'), $('#timerSubject')]) { sel.innerHTML = opts; sel.value = S().subject; }
}

function renderAll() {
  const T = totals();
  renderHeader(T);
  renderMorning(T);
  renderHome(T);
  renderStats(T);
  renderAlarms();
  renderTimer();
}

/* ---------- tabs ---------- */

function go(tab) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + tab));
  $$('.nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  window.scrollTo({ top: 0 });
  renderTimer();
}

/* ---------- timer: Pomodoro / stopwatch / countdown ---------- */

const PHASE = { focus: 'Focus', short: 'Short break', long: 'Long break' };
const phaseLen = p => S()[p === 'focus' ? 'focusMin' : p === 'short' ? 'shortMin' : 'longMin'] * 60000;

function newTimer(mode = 'pomo') {
  return {
    mode, phase: 'focus', running: false, endAt: 0, left: null, startedAt: 0, elapsed: 0, cycle: 0,
    len: mode === 'count' ? S().countMin * 60000 : phaseLen('focus'),
  };
}
const timer = () => state.timer || (state.timer = newTimer());

const remaining = (t, now) => (t.running ? t.endAt - now : t.left ?? t.len);
const watchElapsed = (t, now) => t.elapsed + (t.running ? now - t.startedAt : 0);
const hasProgress = (t, now) => t.running || (t.mode === 'watch' ? t.elapsed > 0 : t.left !== null);

function setPhase(p) {
  const t = timer();
  Object.assign(t, { phase: p, len: phaseLen(p), left: null, running: false });
}

function startRunning(t, now = Date.now()) {
  if (t.mode === 'watch') t.startedAt = now;
  else { t.endAt = now + (t.left ?? t.len); t.left = null; }
  t.running = true;
}

function toggleStart() {
  audio();
  const t = timer(), now = Date.now();
  if (t.running) {
    if (t.mode === 'watch') t.elapsed += now - t.startedAt;
    else t.left = t.endAt - now;
    t.running = false;
  } else {
    if (t.mode === 'count' && t.left === null) t.len = S().countMin * 60000;
    startRunning(t, now);
  }
  save(); syncWakeLock(); renderTimer();
}

// Move to the next Pomodoro phase, crediting `credit` focus minutes.
function advancePhase(credit) {
  const t = timer();
  let next = 'focus';
  if (t.phase === 'focus') {
    t.cycle++;
    next = t.cycle % S().longEvery === 0 ? 'long' : 'short';
  }
  setPhase(next);
  if (next === 'focus' ? S().autoFocus : S().autoBreak) startRunning(t);
  save();
  if (credit >= 1) addSession(credit, 'pomodoro');
  syncWakeLock(); renderTimer();
}

function completeTimer() {
  const t = timer();
  if (t.mode === 'count') {
    const min = t.len / 60000;
    Object.assign(t, { running: false, left: null });
    save();
    if (S().countStudy) addSession(min, 'timer');
    ring('Timer finished', `${Math.round(min)} minutes are up.`);
    syncWakeLock(); renderTimer();
    return;
  }
  const wasFocus = t.phase === 'focus';
  const credit = wasFocus ? t.len / 60000 : 0;
  advancePhase(credit);
  chime();
  const msg = wasFocus
    ? `Focus block done (+${Math.round(credit)} min). Take your ${PHASE[timer().phase].toLowerCase()}.`
    : 'Break over. Back to the desk.';
  notify(wasFocus ? 'Focus block complete' : 'Break over', msg);
  toast(msg);
}

function leftAction() {
  const t = timer(), now = Date.now();
  if (t.mode === 'watch') {
    const el = watchElapsed(t, now);
    if (el >= 60000 && !confirm(`Discard ${fmtHM(el / 60000)} without logging it?`)) return;
    state.timer = newTimer('watch');
  } else if (t.mode === 'pomo') {
    const done = Math.floor((t.len - remaining(t, now)) / 60000);
    const log = t.phase === 'focus' && done >= 1 && confirm(`Log the ${done} min you already focused?`);
    setPhase(t.phase);
    if (log) addSession(done, 'pomodoro');
  } else {
    Object.assign(t, { running: false, left: null, len: S().countMin * 60000 });
  }
  save(); syncWakeLock(); renderTimer();
}

function rightAction() {
  const t = timer(), now = Date.now();
  if (t.mode === 'watch') {
    const el = watchElapsed(t, now);
    if (el < 60000) return toast('Less than a minute. Keep going.');
    if (el > 6 * 3600000 && !confirm(`That's a ${fmtHM(el / 60000)} single session. Did you forget to stop it? Log it anyway?`)) return;
    state.timer = newTimer('watch');
    addSession(el / 60000, 'stopwatch');
    toast(`Logged ${fmtHM(el / 60000)}.`);
  } else if (t.mode === 'pomo') {
    const credit = t.phase === 'focus' ? Math.floor((t.len - remaining(t, now)) / 60000) : 0;
    advancePhase(credit);
  }
  save(); syncWakeLock(); renderTimer();
}

function switchMode(mode) {
  const t = timer();
  if (t.mode === mode) return;
  if (t.running) return toast('Pause or finish the current timer first.');
  if (hasProgress(t, Date.now()) && !confirm('Discard the current timer?')) return;
  state.timer = newTimer(mode);
  save(); renderTimer();
}

function renderTimer(now = Date.now()) {
  const t = timer();
  const ms = t.mode === 'watch' ? watchElapsed(t, now) : remaining(t, now);
  const label = t.mode === 'pomo' ? PHASE[t.phase] : t.mode === 'watch' ? 'Deep work' : 'Countdown';
  const clock = fmtClock(ms);

  $$('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === t.mode));
  $('#clock').textContent = clock;
  $('#phaseLabel').textContent = label;
  document.body.dataset.phase = t.mode === 'pomo' ? t.phase : 'focus';
  document.body.classList.toggle('running', t.running);

  $('#tStart').textContent = t.running ? 'Pause' : hasProgress(t, now) ? 'Resume' : 'Start';
  $('#tLeft').textContent = t.mode === 'watch' ? 'Discard' : 'Reset';
  $('#tRight').textContent = t.mode === 'watch' ? 'Save' : 'Skip';
  $('#tRight').hidden = t.mode === 'count';
  $('#countWrap').hidden = $('#countStudyWrap').hidden = t.mode !== 'count';

  const dots = $('#dots');
  dots.hidden = t.mode !== 'pomo';
  if (t.mode === 'pomo') {
    const n = S().longEvery, inSet = t.cycle % n;
    dots.innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < inSet ? 'on' : ''}"></i>`).join('') +
      `<small>${t.cycle} done</small>`;
  }

  $('#timerHint').textContent = {
    pomo: `${S().focusMin} min focus, ${S().shortMin} min break, a ${S().longMin} min break every ${S().longEvery}. Finished focus blocks are logged automatically.`,
    watch: 'Open-ended deep work. Press Save when you stop to log the time.',
    count: 'A plain countdown with an alarm at the end. Tick "Count as study" to log it.',
  }[t.mode];

  document.title = t.running ? `${clock} · ${label} | Quota` : 'Quota · 63 hours, every week';
}

let wakeLock = null;
async function syncWakeLock() {
  const want = timer().running;
  try {
    if (want && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!want && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (e) { /* wake lock not allowed */ }
}

/* ---------- alarms, snooze & evening check-in ---------- */

let ringLoop = null, ringStopTimer = null, ringAltFn = null;

function ring(title, body, alt = null) {
  $('#ringTitle').textContent = title;
  $('#ringBody').textContent = body;
  const altBtn = $('#ringAlt');
  altBtn.hidden = !alt;
  if (alt) altBtn.textContent = alt.label;
  ringAltFn = alt && alt.fn;
  $('#ringing').hidden = false;
  beeps();
  clearInterval(ringLoop);
  clearTimeout(ringStopTimer);
  ringLoop = setInterval(beeps, 1600);
  ringStopTimer = setTimeout(stopRing, 120000);
  notify(title, body);
}

function stopRing() {
  clearInterval(ringLoop);
  clearTimeout(ringStopTimer);
  $('#ringing').hidden = true;
}

const timeToday = (t, base) => {
  const [h, m] = t.split(':').map(Number);
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m).getTime();
};

function checkAlarms(now) {
  const d = new Date(now);
  const today = ymd(d);
  // An alarm still fires if the tab was asleep and we wake up within 10 minutes of it.
  for (const a of state.alarms) {
    if (!a.enabled || a.lastFired === today) continue;
    const at = timeToday(a.time, d);
    if (now >= at && now - at < 10 * 60000) {
      a.lastFired = today;
      if (a.repeat === 'once') a.enabled = false;
      save(); renderAlarms();
      const label = a.label || 'Alarm';
      ring(a.time, label, { label: 'Snooze 5 min', fn: () => snooze(label) });
      return;
    }
  }
  if (state.snooze && now >= state.snooze.at) {
    const label = state.snooze.label;
    state.snooze = null;
    save();
    ring('Snoozed alarm', label, { label: 'Snooze 5 min', fn: () => snooze(label) });
    return;
  }
  if (S().nudgeEnabled && state.meta.lastNudge !== today) {
    const at = timeToday(S().nudgeTime, d);
    if (now >= at && now - at < 3 * 3600000) {
      state.meta.lastNudge = today;
      save();
      const W = weekInfo(dayKey(now), totals());
      const left = W.target - W.todayMin;
      if (left > 0) {
        ring('Check-in: you\'re behind',
          `${fmtHM(W.todayMin)} done, ${fmtHM(left)} still to go today. The week doesn't forgive. Get back to the desk.`,
          { label: 'Start a Pomodoro', fn: startPomodoroNow });
      }
    }
  }
}

function snooze(label) {
  state.snooze = { at: Date.now() + 5 * 60000, label };
  save();
  toast('Snoozed for 5 minutes.');
}

function startPomodoroNow() {
  const t = timer();
  if (!t.running) {
    state.timer = newTimer('pomo');
    startRunning(state.timer);
    save(); syncWakeLock();
  }
  go('timer');
}

/* ---------- events ---------- */

document.addEventListener('click', e => {
  const el = e.target.closest('button');
  if (!el) return;
  if (el.dataset.tab) return go(el.dataset.tab);
  if (el.dataset.del) return deleteSession(el.dataset.del);
  if (el.dataset.delalarm) {
    state.alarms = state.alarms.filter(a => a.id !== el.dataset.delalarm);
    save(); return renderAlarms();
  }
  if (el.dataset.mode) return switchMode(el.dataset.mode);
  if (el.dataset.logmode) return setLogMode(el.dataset.logmode);
});

$('#tStart').addEventListener('click', toggleStart);
$('#tLeft').addEventListener('click', leftAction);
$('#tRight').addEventListener('click', rightAction);

$('#mGo').addEventListener('click', () => {
  audio();
  state.meta.lastBriefing = dayKey();
  save();
  $('#morning').hidden = true;
});

$('#calPrev').addEventListener('click', () => {
  const d = parseYmd(calMonth); d.setMonth(d.getMonth() - 1); calMonth = ymd(d);
  renderCalendar(totals(), dayKey());
});
$('#calNext').addEventListener('click', () => {
  const d = parseYmd(calMonth); d.setMonth(d.getMonth() + 1); calMonth = ymd(d);
  renderCalendar(totals(), dayKey());
});

$('#ringStop').addEventListener('click', stopRing);
$('#ringAlt').addEventListener('click', () => { stopRing(); if (ringAltFn) ringAltFn(); });

$('#logForm').addEventListener('submit', submitLog);
$('#logForm').addEventListener('input', e => { if (e.target.id !== 'logSubject') updateLogPreview(); });

$('#alarmForm').addEventListener('submit', e => {
  e.preventDefault();
  const time = $('#alTime').value;
  if (!time) return;
  const now = new Date();
  const passed = timeToday(time, now) <= now.getTime();
  state.alarms.push({
    id: uid(), time, label: $('#alLabel').value.trim(), repeat: $('#alRepeat').value, enabled: true,
    // Don't ring instantly for a time that has already passed today.
    lastFired: passed ? ymd(now) : null,
  });
  save();
  $('#alLabel').value = '';
  renderAlarms();
  toast(`Alarm set for ${time}.`);
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().then(renderAlarms);
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.toggle) {
    const a = state.alarms.find(x => x.id === el.dataset.toggle);
    if (a) {
      a.enabled = el.checked;
      if (a.enabled && timeToday(a.time, new Date()) <= Date.now()) a.lastFired = ymd(new Date());
      save(); renderAlarms();
    }
    return;
  }
  const k = el.dataset.set;
  if (!k) return;
  let v;
  if (el.type === 'checkbox') v = el.checked;
  else if (el.type === 'number' || el.type === 'range') {
    v = Number(el.value);
    if (!Number.isFinite(v) || el.value === '') { fillSettings(); return; }
    v = clamp(v, Number(el.min), Number(el.max));
  } else if (el.dataset.num) v = Number(el.value);
  else v = el.value;

  S()[k] = v;
  if (S().linkWeekly && (k === 'dailyGoal' || k === 'linkWeekly')) S().weeklyGoal = +(S().dailyGoal * 7).toFixed(2);
  if (k === 'weeklyGoal') S().linkWeekly = Math.abs(v - S().dailyGoal * 7) < 0.01;

  const t = timer();
  if (!t.running && t.left === null) {
    if (t.mode === 'pomo') t.len = phaseLen(t.phase);
    if (t.mode === 'count') t.len = S().countMin * 60000;
  }
  save();
  fillSettings();
  renderSubjects();
  renderAll();
  if (k === 'volume') beeps();
});

$('#notifBtn').addEventListener('click', async () => {
  if ('Notification' in window) await Notification.requestPermission();
  renderAlarms();
});
$('#testSound').addEventListener('click', () => { audio(); chime(); setTimeout(beeps, 1200); });

$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `quota-backup-${dayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('#importFile').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!data || !Array.isArray(data.sessions)) throw new Error('bad file');
    if (!confirm(`Replace all current data with this backup (${data.sessions.length} sessions)?`)) return;
    localStorage.setItem(KEY, JSON.stringify(data));
    state = load();
    boot();
    toast('Backup imported.');
  } catch (err) {
    toast('That file isn\'t a Quota backup.', 'bad');
  }
});

$('#resetBtn').addEventListener('click', () => {
  if (prompt('This deletes every session, badge and setting. Type RESET to confirm.') !== 'RESET') return;
  state = structuredClone(DEFAULTS);
  save();
  boot();
  toast('Fresh start.');
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { tick(); syncWakeLock(); }
});

/* ---------- main loop ---------- */

let lastDay = null;
function tick() {
  const now = Date.now();
  const t = timer();
  if (t.running && t.mode !== 'watch' && now >= t.endAt) completeTimer();
  renderTimer(now);
  renderClock();
  checkAlarms(now);
  const d = dayKey(now);
  if (d !== lastDay) {
    if (lastDay && !t.running) { t.cycle = 0; save(); }
    lastDay = d;
    calMonth = null;
    chartSig = '';
    prefillLog();
    renderAll();
  }
}

function boot() {
  if (!state.meta.startDay) { state.meta.startDay = startDay(); save(); }
  renderSubjects();
  fillSettings();
  setLogMode(S().logMode === 'duration' ? 'duration' : 'clock');
  checkBadges(totals(), true);
  lastDay = null;
  calMonth = null;
  chartSig = '';
  tick();
  syncWakeLock();
}

boot();
setInterval(tick, 500);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
