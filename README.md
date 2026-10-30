# Quota: 63 hours, every week

A no-nonsense study-hour tracker built for Khitanshu's UPSC preparation.

**The deal:** 9 hours every day, 63 hours every week. Miss hours today and they land on tomorrow. The weekly quota is non-negotiable.

## What it does

- **One clean home screen.** Today's date and a live clock; hours done today against the target; a log form; this week's total with a 7-day strip; a month calendar with the streak flame (a filled dot for each day the goal was hit); and a 14-day bar chart against the goal line.
- **Manual logging comes first.** Read the table clock and enter *From* and *To* (e.g. 09:10 → 11:40), or switch to *Duration* to enter hours and minutes. You can pick a past day, tag a subject, delete mistakes, and you'll be warned if a session overlaps one you've already logged.
- **Debt carries forward.** Fall short and the hours you missed are spread over the days left in the week. Today's target goes up (e.g. *9h → 9h 44m*) and a red banner says exactly how far behind you are.
- **Daily briefing.** The first time you open the app each day, a card at the top shows a motivational quote (Kalam, Tenzing Norgay, Kipchoge, Ronaldo, Vivekananda and more), yesterday's result (or last week's on the first day of a new week) and today's target. Tap *"I'll make it up today"* to put it away.
- **A fair first week.** The quota for the week you start is prorated to the days you've been using Quota, so day one doesn't open with 36 hours of debt.
- **Focus timers**
  - **Pomodoro:** 50 min focus / 10 min break / 20 min long break every 3 by default. Each completed focus block is logged automatically.
  - **Stopwatch:** open-ended deep work. Press *Save* to log it.
  - **Timer:** a plain countdown that rings at the end, with an option to count it as study.
  - The screen stays awake while a timer runs, where the browser supports it.
- **Alarms.** Daily or one-time alarms with labels, a loud repeating ring and snooze. There's also an **evening check-in** (8 PM by default) that rings if you're behind on today's target and offers to start a Pomodoro straight away.
- **Gamified**
  - **XP:** 1 per minute studied, +120 for each day you hit the goal, +600 for each week you hit the quota.
  - **Ranks:** Aspirant → NCERT Finisher → Prelims Qualified → Mains Warrior → … → District Collector → Cabinet Secretary.
  - **Streaks:** consecutive goal days and consecutive quota weeks.
  - **16 badges:** *Breaking2* (a 2-hour unbroken session), *CR7* (a 7-day streak), *Everest* (8,848 minutes), *Wings of Fire* (100 hours), *Brahma Muhurta* (a session started between 4 and 6 AM), *Comeback*, *Perfect Week* and more.
- **UPSC subjects.** Tag sessions as Polity, History, Economy, Ethics, Answer Writing and so on, then see this week's split in Stats.
- **Everything is configurable** in Settings: daily goal, weekly quota, which day the week starts, when the study day ends (late nights before 3 AM count for the previous day), Pomodoro lengths and volume.

## Data & privacy

There's no account and no server. Everything is stored in the browser on this device (`localStorage`). Use **Settings → Export backup** now and then, and **Import backup** to move to a new device. Clearing browser data wipes it.

## Limits

Alarms and timers run while the page is open. A background tab is fine, but a fully closed browser can't ring. On a phone, add the site to the home screen and keep it open while studying. Turn on notifications in the Timer tab so alerts reach you from other tabs.

## Run it

It's a static site with no build step:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

### Publish with GitHub Pages

1. Go to the repo → **Settings → Pages**.
2. Under *Build and deployment* pick **Deploy from a branch**, then branch **`main`**, folder **`/ (root)`**, and click **Save**.
3. After about a minute the site is live at `https://dhruvbhrdwj.github.io/khetanshu-upsc-trakr/`.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Layout: Home, Timer (Pomodoro + alarms), Stats, Settings |
| `app.js` | All logic: quota maths, timers, alarms, XP, badges, storage |
| `quotes.js` | The daily quote list. Add your own here. |
| `styles.css` | Styling: a warm dark theme, with orange only on study data |
| `charts.js` | Small SVG chart helper (the 14-day bar chart) |
| `sw.js`, `manifest.webmanifest`, `icon.svg` | Installable, offline-capable app |
