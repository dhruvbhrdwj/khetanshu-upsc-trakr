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
const fmtClock = ms => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
};

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

function weekInfo(today, T) {
  const days = weekDays(today);
  const idx = days.indexOf(today);
  const goalD = S().dailyGoal * 60;
  const goalW = S().weeklyGoal * 60;
  const before = sumDays(T, days.slice(0, idx));
  const todayMin = T.get(today) || 0;
  const done = before + todayMin;
  const daysLeft = 7 - idx;
  // Whatever was missed earlier in the week is spread over the days that remain.
  const pace = Math.max(0, goalW - before) / daysLeft;
  const target = Math.max(goalD, Math.ceil(pace));
  const debt = Math.max(0, Math.round((goalW / 7) * idx - before));
  return { days, idx, before, todayMin, done, daysLeft, pace, target, debt, goalD, goalW, weekLeft: Math.max(0, goalW - done) };
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
  return { i, name, next, pct };
}

/* ---------- badges ---------- */

const BADGES = [
  { id: 'first', icon: '👣', name: 'First Step', desc: 'Log your first session.', test: c => c.sessions.length > 0 },
  { id: 'fullday', icon: '✅', name: 'Full Day', desc: 'Hit the daily goal once.', test: c => c.goalDays >= 1 },
  { id: 'sun', icon: '☀️', name: 'Burn Like a Sun', desc: 'Study 12+ hours in one day. (Kalam)', test: c => c.bestDay >= 720 },
  { id: 'brahma', icon: '🌅', name: 'Brahma Muhurta', desc: 'Start a timed session between 4 and 6 AM.', test: c => c.early },
  { id: 'breaking2', icon: '🏃', name: 'Breaking2', desc: 'One unbroken session of 2+ hours. (Kipchoge)', test: c => c.longest >= 120 },
  { id: 's3', icon: '🔥', name: 'On Fire', desc: '3-day goal streak.', test: c => c.best >= 3 },
  { id: 'cr7', icon: '⚽', name: 'CR7', desc: '7-day goal streak. Siuuu.', test: c => c.best >= 7 },
  { id: 'quota', icon: '🎯', name: 'Quota Crusher', desc: 'Hit the weekly quota.', test: c => c.quotaWeeks >= 1 },
  { id: 'comeback', icon: '🔁', name: 'Comeback', desc: 'Miss a day, still finish the week\'s quota.', test: c => c.comeback },
  { id: 'perfect', icon: '💎', name: 'Perfect Week', desc: 'Daily goal hit on all 7 days of a week.', test: c => c.perfect },
  { id: 's21', icon: '🧱', name: 'Habit Forged', desc: '21-day goal streak.', test: c => c.best >= 21 },
  { id: 'wings', icon: '🕊️', name: 'Wings of Fire', desc: '100 hours total. (Kalam)', test: c => c.total >= 6000 },
  { id: 'everest', icon: '🏔️', name: 'Everest', desc: '8,848 minutes total. (Tenzing)', test: c => c.total >= 8848 },
  { id: 'q4', icon: '📅', name: 'Month of Steel', desc: '4 quota weeks in a row.', test: c => c.bestWeekRun >= 4 },
  { id: 's50', icon: '⚔️', name: 'Unbreakable', desc: '50-day goal streak.', test: c => c.best >= 50 },
  { id: 'missile', icon: '🚀', name: 'Missile Man', desc: '1,000 hours total. (Kalam)', test: c => c.total >= 60000 },
];

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
    longest: Math.max(0, ...ss.filter(s => s.src !== 'manual').map(s => s.min)),
    early: ss.some(s => {
      if (s.src === 'manual' || !s.at) return false;
      const h = new Date(s.at - s.min * 60000).getHours();
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
      if (!quiet) { toast(`${b.icon} Badge unlocked: ${b.name}`, 'good'); confetti(); }
    }
  }
  save();
}

/* ---------- quotes ---------- */

const quoteIndexFor = day => ((dayNumber(day) % QUOTES.length) + QUOTES.length) % QUOTES.length;
let stripQuote = null;

function renderQuoteStrip() {
  if (stripQuote === null) stripQuote = quoteIndexFor(dayKey());
  const q = QUOTES[stripQuote];
  $('#qsText').textContent = `“${q.q}”`;
  $('#qsAuthor').textContent = `— ${q.a}`;
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
  const colors = ['#e2672a', '#f3a25b', '#2e8b57', '#3a6fd8', '#f2c94c'];
  for (let i = 0; i < 70; i++) {
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

function addSession(min, src, day = dayKey()) {
  min = Math.round(min);
  if (min < 1) return;
  state.sessions.push({ id: uid(), day, at: Date.now(), min, subject: S().subject, src });
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
    toast(`Today's target done: ${fmtHM(W.todayMin)}. Anything more is a bonus.`, 'good');
  }
  const wk = 'w' + W.days[0];
  if (W.done >= W.goalW && !c[wk]) {
    c[wk] = 1;
    confetti();
    toast(`WEEKLY QUOTA COMPLETE. ${S().weeklyGoal} hours. That's how officers are made.`, 'good');
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

function sessionItem(s, showDay) {
  const time = s.at ? new Date(s.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const meta = [showDay ? shortDate(s.day) : '', s.src, s.src === 'manual' ? '' : time].filter(Boolean).join(' · ');
  return `<li><div><span class="s-sub">${esc(s.subject)}</span><span class="s-meta">${esc(meta)}</span></div>
    <b>${fmtHM(s.min)}</b><button class="icon-btn" data-del="${esc(s.id)}" aria-label="Delete session">✕</button></li>`;
}

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
  $('#hello').textContent = `${greeting()}, ${S().name || 'aspirant'}`;
  $('#rankName').textContent = r.name;
  $('#xpFill').style.width = r.pct + '%';
  $('#xpText').textContent = `${xp.toLocaleString()} XP`;
  $('#rankBig').textContent = r.name;
  $('#rankFill').style.width = r.pct + '%';
  $('#rankNext').textContent = r.next
    ? `${(r.next[0] - xp).toLocaleString()} XP to ${r.next[1]}`
    : 'Top of the ladder. Now keep it.';
  $('#ladder').innerHTML = RANKS.map(([x, n], i) =>
    `<li class="${i < r.i ? 'done' : i === r.i ? 'cur' : ''}"><span>${esc(n)}</span><small>${x.toLocaleString()} XP</small></li>`).join('');
}

function renderToday(T) {
  const today = dayKey();
  const W = weekInfo(today, T);
  const goalD = W.goalD;

  const pct = clamp(W.todayMin / W.target, 0, 1);
  const C = 2 * Math.PI * 52;
  const ring = $('#ringFg');
  ring.style.strokeDasharray = C;
  ring.style.strokeDashoffset = C * (1 - pct);
  ring.classList.toggle('met', W.todayMin >= W.target);
  $('#todayDone').textContent = fmtH(W.todayMin);
  $('#todayTarget').textContent = fmtH(W.target).replace(/\.0$/, '');
  $('#todayLeft').textContent = W.todayMin >= W.target ? 'Done ✔' : fmtHM(W.target - W.todayMin);
  $('#streakDays').textContent = `${dayStreak(T, today)} 🔥`;
  $('#streakWeeks').textContent = `${weekStreak(T, today)} 🎯`;

  const banner = $('#statusBanner');
  banner.hidden = false;
  if (W.done >= W.goalW) {
    banner.className = 'banner good';
    banner.textContent = `Weekly quota done: ${fmtH(W.done)}h. Keep the daily habit alive; extra hours are pure bonus.`;
  } else if (W.debt > 0) {
    banner.className = 'banner bad';
    banner.innerHTML = `<b>You're ${fmtHM(W.debt)} behind this week.</b> Today's target is raised to ${fmtHM(W.target)} so you still finish ${S().weeklyGoal}h by ${DOW[parseYmd(W.days[6]).getDay()]}.` +
      (W.pace > 16 * 60 ? ' This is the danger zone. Every single hour counts now.' : ' No excuses.');
  } else if (W.todayMin >= W.target) {
    banner.className = 'banner good';
    banner.textContent = 'Today\'s target is done. Bank a little extra for the week if you can.';
  } else {
    banner.hidden = true;
  }

  const max = Math.max(goalD * 1.4, ...W.days.map(d => T.get(d) || 0));
  const bars = $('#weekBars');
  bars.style.setProperty('--g', (goalD / max * 100) + '%');
  bars.innerHTML = W.days.map(d => {
    const m = T.get(d) || 0;
    const cls = [
      m >= goalD ? 'met' : '',
      d === today ? 'today' : '',
      d > today ? 'future' : '',
      d < today && m < goalD ? 'miss' : '',
    ].join(' ');
    return `<div class="wb ${cls}" title="${shortDate(d)}: ${fmtHM(m)}">
      <div class="wb-col"><div class="wb-fill" style="height:${(m / max) * 100}%"></div></div>
      <div class="wb-val">${m ? fmtH(m) : '–'}</div>
      <div class="wb-day">${DOW[parseYmd(d).getDay()]}</div></div>`;
  }).join('');

  $('#weekPill').textContent = `${fmtH(W.done)} / ${S().weeklyGoal}h`;
  $('#weekPill').classList.toggle('good', W.done >= W.goalW);
  $('#weekMeta').innerHTML = W.done >= W.goalW
    ? `Quota complete with ${W.daysLeft - 1} day${W.daysLeft === 2 ? '' : 's'} to spare.`
    : `<b>${fmtHM(W.weekLeft)}</b> left this week · ${W.daysLeft} day${W.daysLeft > 1 ? 's' : ''} including today · pace needed <b>${fmtH(W.pace)}h/day</b>.`;

  const todays = state.sessions.filter(s => s.day === today).sort((a, b) => b.at - a.at);
  $('#todaySessions').innerHTML = todays.length
    ? todays.map(s => sessionItem(s, false)).join('')
    : '<li class="empty">Nothing yet. The clock is already running; start yours.</li>';

  $('#focusPill').textContent = `${fmtH(W.todayMin)} / ${fmtH(W.target).replace(/\.0$/, '')}h`;
  $('#focusFill').style.width = pct * 100 + '%';
  $('#focusText').textContent = W.todayMin >= W.target
    ? 'Target hit. Every extra minute goes to the weekly bank.'
    : `${fmtHM(W.target - W.todayMin)} to go, about ${Math.ceil((W.target - W.todayMin) / S().focusMin)} more Pomodoros of ${S().focusMin} min.`;
}

function renderStats(T) {
  const today = dayKey();
  const ctx = badgeContext(T);
  const daysStudied = [...T.values()].filter(m => m > 0).length;
  $('#totals').innerHTML = [
    ['Total hours', fmtH(ctx.total)],
    ['Days studied', daysStudied],
    ['Goal days', ctx.goalDays],
    ['Best day', fmtHM(ctx.bestDay)],
    ['Best streak', `${ctx.best} days`],
    ['Quota weeks', ctx.quotaWeeks],
  ].map(([l, v]) => `<div><span class="label">${l}</span><span class="value">${v}</span></div>`).join('');

  const got = state.meta.badges;
  $('#badgeCount').textContent = `${Object.keys(got).length} / ${BADGES.length}`;
  $('#badges').innerHTML = BADGES.map(b => `<div class="badge ${got[b.id] ? 'on' : ''}" title="${esc(b.desc)}">
      <span class="b-icon">${b.icon}</span><b>${esc(b.name)}</b><small>${esc(b.desc)}</small></div>`).join('');

  const WT = weekTotals(T);
  const gW = S().weeklyGoal * 60;
  const cur = weekStartKey(today);
  const rows = [];
  for (let i = 0; i < 8; i++) {
    const wk = addDays(cur, -7 * i);
    const m = WT.get(wk) || 0;
    const hit = m >= gW;
    const label = i === 0 ? 'This week' : `Wk of ${shortDate(wk)}`;
    rows.push(`<div class="wk ${hit ? 'hit' : i === 0 ? 'cur' : 'miss'}">
      <span class="wk-label">${label}</span>
      <span class="wk-bar"><i style="width:${clamp(m / gW, 0, 1) * 100}%"></i></span>
      <span class="wk-val">${fmtH(m)}h ${hit ? '✔' : i === 0 ? '' : '✘'}</span></div>`);
  }
  $('#weeks').innerHTML = rows.join('');

  const days = new Set(weekDays(today));
  const bySub = new Map();
  for (const s of state.sessions) if (days.has(s.day)) bySub.set(s.subject, (bySub.get(s.subject) || 0) + s.min);
  const subs = [...bySub].sort((a, b) => b[1] - a[1]);
  const top = subs.length ? subs[0][1] : 1;
  $('#subjects').innerHTML = subs.length
    ? subs.map(([n, m]) => `<div class="wk"><span class="wk-label">${esc(n)}</span><span class="wk-bar"><i style="width:${m / top * 100}%"></i></span><span class="wk-val">${fmtHM(m)}</span></div>`).join('')
    : '<p class="muted small">No sessions this week yet.</p>';

  const recent = [...state.sessions].sort((a, b) => (b.day.localeCompare(a.day)) || (b.at - a.at)).slice(0, 30);
  $('#recentSessions').innerHTML = recent.length
    ? recent.map(s => sessionItem(s, true)).join('')
    : '<li class="empty">No sessions yet.</li>';
}

function renderAlarms() {
  const list = [...state.alarms].sort((a, b) => a.time.localeCompare(b.time));
  $('#alarmList').innerHTML = list.length ? list.map(a => `<li class="${a.enabled ? '' : 'off'}">
      <div><span class="al-time">${esc(a.time)}</span><span class="al-label">${esc(a.label || 'Alarm')}</span>
      <small>${a.repeat === 'daily' ? 'Every day' : 'Once'}</small></div>
      <label class="switch"><input type="checkbox" data-toggle="${esc(a.id)}" ${a.enabled ? 'checked' : ''} aria-label="Enabled"><span></span></label>
      <button class="icon-btn" data-delalarm="${esc(a.id)}" aria-label="Delete alarm">✕</button></li>`).join('')
    : '<li class="empty">No alarms set.</li>';

  const n = !('Notification' in window) ? 'unsupported' : Notification.permission;
  $('#notifState').textContent = {
    granted: 'Notifications are on. You\'ll get alerts even when the tab is in the background.',
    denied: 'Notifications are blocked. Allow them in your browser\'s site settings to get alerts.',
    default: 'Turn on notifications so alarms and timers reach you while you\'re in another tab.',
    unsupported: 'This browser doesn\'t support notifications; alarms will still ring with sound.',
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
  renderToday(T);
  renderStats(T);
  renderAlarms();
  renderTimer();
}

/* ---------- tabs ---------- */

function go(tab) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + tab));
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
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
  toast(msg, wasFocus ? 'good' : '');
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
    toast(`Logged ${fmtHM(el / 60000)}.`, 'good');
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
  const label = t.mode === 'pomo' ? PHASE[t.phase] : t.mode === 'watch' ? 'Deep work' : 'Timer';
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
    pomo: `${S().focusMin} min focus · ${S().shortMin} min break · long break of ${S().longMin} min every ${S().longEvery}. Completed focus blocks are logged automatically.`,
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

const timeToday = (hhmm, base) => {
  const [h, m] = hhmm.split(':').map(Number);
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
  go('focus');
}

/* ---------- morning briefing ---------- */

function showBriefing() {
  const today = dayKey();
  const T = totals();
  const W = weekInfo(today, T);
  const q = QUOTES[quoteIndexFor(today)];
  const firstTime = !state.meta.lastBriefing && state.sessions.length === 0;
  const lines = [];

  $('#bfDate').textContent = parseYmd(today).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  $('#bfHello').textContent = `${greeting()}, ${S().name || 'aspirant'}.`;
  $('#bfQuote').textContent = `“${q.q}”`;
  $('#bfAuthor').textContent = `— ${q.a}`;

  if (firstTime) {
    lines.push(`<p>The deal: <b>${S().dailyGoal}h every day, ${S().weeklyGoal}h every week.</b> Miss hours today and they land on tomorrow. The week's quota is non-negotiable.</p>`);
  } else {
    const y = addDays(today, -1);
    const yMin = T.get(y) || 0;
    if (W.idx === 0) {
      const lastWeek = sumDays(T, weekDays(y));
      const hit = lastWeek >= W.goalW;
      lines.push(hit
        ? `<p class="ok">✔ Last week: <b>${fmtH(lastWeek)}h</b>. Quota crushed. Quota-week streak: ${weekStreak(T, y)}.</p>`
        : `<p class="no">✘ Last week: <b>${fmtH(lastWeek)}h of ${S().weeklyGoal}h</b>, missed by ${fmtHM(W.goalW - lastWeek)}. New week, clean slate. Don't waste it.</p>`);
    } else if (yMin >= W.goalD) {
      lines.push(`<p class="ok">✔ Yesterday: <b>${fmtHM(yMin)}</b>. Goal hit. Streak: ${dayStreak(T, y)} 🔥</p>`);
    } else {
      lines.push(`<p class="no">✘ Yesterday: <b>${fmtHM(yMin)} of ${S().dailyGoal}h</b>, ${fmtHM(W.goalD - yMin)} short. That debt is now yours to repay this week.</p>`);
    }
  }
  lines.push(`<div class="bf-target"><span>Today's target</span><b>${fmtHM(W.target)}</b></div>`);
  if (W.target > W.goalD) {
    lines.push(`<p class="small">${fmtHM(W.goalW - W.before)} needed in the ${W.daysLeft} days left this week. That's your daily ${S().dailyGoal}h plus ${fmtHM(W.target - W.goalD)} of catch-up.</p>`);
  }

  $('#bfReport').innerHTML = lines.join('');
  $('#bfGo').textContent = W.target > W.goalD ? 'I\'ll make it up today' : 'Let\'s go';
  $('#briefing').hidden = false;
}

function maybeBriefing() {
  if (state.meta.lastBriefing !== dayKey()) showBriefing();
}

/* ---------- events ---------- */

document.addEventListener('click', e => {
  const el = e.target.closest('button, [data-go]');
  if (!el) return;
  if (el.dataset.tab) return go(el.dataset.tab);
  if (el.dataset.go) return go(el.dataset.go);
  if (el.dataset.add) {
    addSession(Number(el.dataset.add), 'manual');
    return toast(`+${fmtHM(Number(el.dataset.add))} logged to ${S().subject}.`, 'good');
  }
  if (el.dataset.del) return deleteSession(el.dataset.del);
  if (el.dataset.delalarm) {
    state.alarms = state.alarms.filter(a => a.id !== el.dataset.delalarm);
    save(); return renderAlarms();
  }
  if (el.dataset.mode) return switchMode(el.dataset.mode);
});

$('#tStart').addEventListener('click', toggleStart);
$('#tLeft').addEventListener('click', leftAction);
$('#tRight').addEventListener('click', rightAction);

$('#qsNext').addEventListener('click', () => {
  stripQuote = (stripQuote + 1) % QUOTES.length;
  renderQuoteStrip();
});

$('#bfGo').addEventListener('click', () => {
  audio();
  state.meta.lastBriefing = dayKey();
  save();
  $('#briefing').hidden = true;
});

$('#ringStop').addEventListener('click', stopRing);
$('#ringAlt').addEventListener('click', () => { stopRing(); if (ringAltFn) ringAltFn(); });

$('#customLog').addEventListener('submit', e => {
  e.preventDefault();
  const day = $('#clDate').value;
  const min = (Number($('#clHours').value) || 0) * 60 + (Number($('#clMins').value) || 0);
  if (!DAY_RE.test(day) || min < 1) return toast('Enter a day and some time.', 'bad');
  if (day > dayKey()) return toast('You can\'t log the future. Go study it instead.', 'bad');
  addSession(clamp(min, 1, 24 * 60), 'manual', day);
  toast(`Logged ${fmtHM(min)} on ${shortDate(day)}.`, 'good');
});

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
  toast(`Alarm set for ${time}.`, 'good');
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
    stripQuote = null;
    boot();
    toast('Backup imported.', 'good');
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
  checkAlarms(now);
  const d = dayKey(now);
  if (d !== lastDay) {
    lastDay = d;
    if (!timer().running) { timer().cycle = 0; save(); }
    stripQuote = null;
    renderQuoteStrip();
    renderAll();
    maybeBriefing();
  }
}

function boot() {
  $('#clDate').value = dayKey();
  $('#clDate').max = dayKey();
  renderSubjects();
  fillSettings();
  checkBadges(totals(), true);
  lastDay = null;
  tick();
  syncWakeLock();
}

boot();
setInterval(tick, 500);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
