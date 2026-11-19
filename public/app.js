(() => {
"use strict";

const TRACKS = { work: "Zephyr", free: "Freelance", learn: "Learning", brand: "Marketing", money: "Money", life: "Life" };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const YEAR_START = "2027-01-04"; // Monday of week 1 of the 52-week plan
const VIEWS = ["week", "plan", "learn", "lists", "money"];

// ---- small helpers ----
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); };
const mondayOf = (s) => addDays(s, -((parse(s).getDay() + 6) % 7));
const todayStr = () => fmt(new Date());
const inr = (n) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
const short = (s) => { const d = parse(s); return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`; };
const range = (w) => `${short(w)} to ${short(addDays(w, 6))} ${addDays(w, 6).slice(0, 4)}`;
const weekNo = (w) => Math.round((parse(w) - parse(YEAR_START)) / 6048e5) + 1;
const clock = (t) => { if (!t) return ""; const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}${m ? ":" + pad(m) : ""}${h < 12 ? "am" : "pm"}`; };
const CHECK = '<span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 5"/></svg></span>';
const ICONS = {
  week: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  plan: '<path d="M3 6h18v12H3zM3 12h18M9 6v6M15 12v6"/>',
  learn: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M9 8h6"/>',
  lists: '<path d="M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17M12 6h8M12 12h8M12 18h8"/>',
  money: '<circle cx="12" cy="12" r="9"/><path d="M9 8h6M9 11h6M9 11c4.5 0 4.5 4 0 4l4.5 3"/>',
};
const MIC = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const LOGO = '<span class="logo"><svg viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="8" fill="#f3f5f8"/><rect x="5" y="16" width="8" height="5" rx="1.5" fill="#07080a"/><rect x="15" y="16" width="8" height="5" rx="1.5" fill="#07080a"/><rect x="10" y="8" width="8" height="5" rx="1.5" fill="#07080a"/></svg><b>ground<span>work</span></b></span>';
const NAV = { week: "Week", plan: "Plan", learn: "Learn", lists: "Checklists", money: "Money" };

// One note a day, in rotation. Written for the owner when this was built.
const NOTES = [
  "You built a 19-page site for a Dubai company before you had a degree. The work already speaks. Keep adding to it.",
  "Nobody can argue with a finished project. Finish one more this week.",
  "You do not need to feel ready. You need to do today's 45 minutes.",
  "Missing one day is normal. Missing two is a choice. Come back today.",
  "The people who doubt you are judging last year's version. Show them this year's.",
  "A house is built one brick at a time, and so is the person who can afford it.",
  "Skill is what is left after a lot of ordinary days. Make this an ordinary day.",
  "Send the message. The worst answer you can get is the one you already have.",
  "You are allowed to be a beginner. You are not allowed to stop.",
  "Charge what the work is worth. You are the one who knows how hard it was.",
  "Rest is part of the plan. Quitting is the only thing that is off it.",
  "Proof beats promises. Publish what you made.",
  "Someone is going to be glad you did not give up this year. Probably you.",
  "You asked how to become the best. Start by being someone who shows up on Tuesday.",
  "Small, checked steps. That is how I work, and it is how you will get there.",
  "Do the work that future you will thank you for, then go to sleep on time.",
];

// ---- state ----
let D = null, view = "week", week = null, moneyMonth = null, loadedAt = 0, addDay = undefined;

async function req(path, opt) {
  const r = await fetch(path, opt);
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== "/api/login") { D = null; renderLogin(); throw new Error("login"); }
  if (!r.ok) throw new Error(j.error || "Something went wrong. Please try again.");
  return j;
}
const post = (path, body) => req(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const call = (op, args = {}) => post("/api/op", { op, args }).then((j) => j.result);
async function load() {
  D = (await req("/api/state?today=" + todayStr())).result;
  loadedAt = Date.now();
  if (!week) week = mondayOf(D.today);
  if (!moneyMonth) moneyMonth = D.today.slice(0, 7);
}

let toastTimer;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}
// Run a change, show any error, and redraw.
async function act(fn) {
  try { await fn(); } catch (e) { if (e.message !== "login") toast(e.message); }
  if (D) render();
}
const put = (list, item) => { const i = list.findIndex((x) => x.id === item.id); if (i >= 0) list[i] = item; else list.push(item); };
const drop = (list, id) => { const i = list.findIndex((x) => x.id === id); if (i >= 0) list.splice(i, 1); };
const sumIncome = (prefix) => D.income.filter((e) => e.date.startsWith(prefix)).reduce((s, e) => s + e.amount, 0);
const goalNow = (g) => (g.auto === "income" ? sumIncome(g.period) : g.current || 0);
function weekStats() {
  const s = {};
  for (const t of D.tasks) { const w = (s[t.week] ??= { d: 0, n: 0 }); w.n++; if (t.done) w.d++; }
  return s;
}

// ---- views ----
function taskRow(t) {
  const meta = [`<span><i class="dot t-${t.track}"></i>${TRACKS[t.track] || t.track}</span>`];
  if (t.time) meta.unshift(`<span class="num">${clock(t.time)}</span>`);
  if (t.src === "plan") meta.push('<span class="tag">Week target</span>');
  if (t.notes) meta.push(`<span>${esc(t.notes.slice(0, 70))}</span>`);
  return `<li class="task${t.done ? " done" : ""}">
    <button class="chk" data-act="toggle" data-id="${t.id}" aria-pressed="${!!t.done}" aria-label="${t.done ? "Mark as not done" : "Mark as done"}: ${esc(t.title)}">${CHECK}</button>
    <button class="tbody" data-act="edit-task" data-id="${t.id}"><span class="ttl">${esc(t.title)}</span><span class="tmeta">${meta.join("")}</span></button>
  </li>`;
}

function vWeek() {
  const ts = D.tasks.filter((t) => t.week === week);
  const done = ts.filter((t) => t.done).length;
  const focus = D.goals.find((g) => g.horizon === "focus" && g.period === week.slice(0, 7));
  const n = weekNo(week), thisWeek = mondayOf(D.today);
  const label = n >= 1 && n <= 52 ? `Week ${n} of 52` : week < YEAR_START ? "Getting ready for 2027" : "After the 2027 plan";
  const review = D.reviews.find((r) => r.week === week) || {};
  const byTime = (a, b) => (a.time || "99") < (b.time || "99") ? -1 : (a.time || "99") > (b.time || "99") ? 1 : a.id - b.id;

  const anyDay = ts.filter((t) => !t.date);
  let days = anyDay.length ? `<section class="day"><header><h3>Any day this week</h3></header><ul>${anyDay.map(taskRow).join("")}</ul></section>` : "";
  DAYS.forEach((d, i) => {
    const date = addDays(week, i), list = ts.filter((t) => t.date === date).sort(byTime);
    const isToday = date === D.today;
    if (!list.length && date < D.today) return; // an empty day in the past has nothing to show
    days += `<section class="day${isToday ? " today" : ""}" ${isToday ? 'id="today"' : ""}>
      <header><h3>${d} ${parse(date).getDate()}</h3>${isToday ? '<span class="tag now">Today</span>' : ""}<span class="count">${list.filter((t) => t.done).length}/${list.length}</span></header>
      ${list.length ? `<ul>${list.map(taskRow).join("")}</ul>` : '<p class="empty">Nothing planned.</p>'}
    </section>`;
  });

  const defDay = addDay !== undefined ? addDay : week === thisWeek ? D.today : "";
  const dayOpts = `<option value="">Any day</option>` + DAYS.map((d, i) => { const v = addDays(week, i); return `<option value="${v}"${v === defDay ? " selected" : ""}>${d} ${parse(v).getDate()}</option>`; }).join("");
  const mic = "webkitSpeechRecognition" in window || "SpeechRecognition" in window;

  return `<section class="head">
      <p class="chip">${label}</p><h1>${short(week)} to <span class="tide">${short(addDays(week, 6))}</span></h1>
      ${focus ? `<p class="muted">${MONTHS[Number(week.slice(5, 7)) - 1]}: ${esc(focus.title)}</p>` : ""}
      <div class="progress"><div class="spread"><span class="count">${done} of ${ts.length} done</span><span class="count">${ts.length ? Math.round((done / ts.length) * 100) : 0}%</span></div>
      <div class="bar" style="--p:${ts.length ? done / ts.length : 0}"><i></i></div></div>
      <div class="weeknav">
        <button class="btn icon" data-act="week-step" data-n="-1" aria-label="Previous week">‹</button>
        <button class="btn" data-act="week-now"${week === thisWeek ? " disabled" : ""}>This week</button>
        <button class="btn icon" data-act="week-step" data-n="1" aria-label="Next week">›</button>
      </div>
    </section>
    <blockquote class="note"><p>${NOTES[Math.floor(parse(D.today) / 864e5) % NOTES.length]}</p><cite>A note from Fable</cite></blockquote>
    <form class="card addtask" data-form="add-task">
      <input type="text" name="title" id="newtask" placeholder="Add a task (try: Client call at 10)" aria-label="New task" autocomplete="off" required maxlength="300">
      <select name="date" aria-label="Day">${dayOpts}</select>
      <select name="track" aria-label="Area">${Object.entries(TRACKS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
      <div class="go">${mic ? `<button type="button" class="btn icon" data-act="mic" aria-label="Speak a task" title="Speak a task">${MIC}</button>` : ""}<button class="btn primary">Add</button></div>
    </form>
    ${habitsCard()}
    <div class="stack" style="gap:24px">${days}</div>
    <section class="card stack">
      <div><h2>Sunday review</h2><p class="muted">Three short answers. They save as you type.</p></div>
      <label class="f">What did I finish?<textarea data-review="wins" maxlength="3000">${esc(review.wins)}</textarea></label>
      <label class="f">What got in the way?<textarea data-review="blockers" maxlength="3000">${esc(review.blockers)}</textarea></label>
      <label class="f">The one thing for next week<textarea data-review="focus" maxlength="3000">${esc(review.focus)}</textarea></label>
    </section>`;
}

function habitsCard() {
  if (!D.habits.length) return "";
  const has = new Set(D.habit_log.map((l) => l.habit_id + "|" + l.date));
  const rows = D.habits.map((h) => {
    let streak = 0, d = has.has(h.id + "|" + D.today) ? D.today : addDays(D.today, -1);
    while (has.has(h.id + "|" + d)) { streak++; d = addDays(d, -1); }
    const cells = DAYS.map((name, i) => {
      const date = addDays(week, i), on = has.has(h.id + "|" + date);
      return `<button class="hday${on ? " on" : ""}${date === D.today ? " today" : ""}" data-act="habit" data-id="${h.id}" data-date="${date}" aria-pressed="${on}" aria-label="${esc(h.title)}, ${name} ${parse(date).getDate()}"${date > D.today ? " disabled" : ""}>${name[0]}</button>`;
    }).join("");
    return `<li class="habit"><div class="spread" style="align-items:flex-start"><button data-act="edit-habit" data-id="${h.id}"><h3>${esc(h.title)}</h3><p class="why">${esc(h.why)}</p></button>${streak > 1 ? `<span class="streak">${streak} days</span>` : ""}</div><div class="hdays">${cells}</div></li>`;
  }).join("");
  return `<section class="stack"><div class="spread"><h2>Every day</h2><button class="btn small" data-act="add-habit">Add a habit</button></div><div class="card"><ul>${rows}</ul></div></section>`;
}

function goalRow(g) {
  if (g.target !== null && g.target !== undefined) {
    const cur = goalNow(g), money = g.unit === "₹";
    const text = money ? `${inr(cur)} of ${inr(g.target)}` : `${cur} of ${g.target} ${esc(g.unit)}`;
    return `<li class="goal"><div class="top2"><button class="gt" data-act="edit-goal" data-id="${g.id}"><i class="dot t-${g.track}"></i>${esc(g.title)}</button>
      ${g.auto ? "" : `<button class="btn small" data-act="goal-plus" data-id="${g.id}" aria-label="${money ? "Update amount" : "Add one"}: ${esc(g.title)}">${money ? "Update" : "+1"}</button>`}</div>
      <div class="prog"><div class="bar" style="--p:${Math.min(1, cur / g.target)}"><i></i></div><span class="count">${text}${g.auto ? " · from the Money page" : ""}</span></div></li>`;
  }
  return `<li class="goal${g.done ? " done" : ""}"><div class="top2">
    <button class="chk" data-act="goal-toggle" data-id="${g.id}" aria-pressed="${!!g.done}" aria-label="${g.done ? "Mark as not done" : "Mark as done"}: ${esc(g.title)}">${CHECK}</button>
    <button class="gt" data-act="edit-goal" data-id="${g.id}"><i class="dot t-${g.track}"></i>${esc(g.title)}</button></div></li>`;
}

function vPlan() {
  const stats = weekStats(), thisWeek = mondayOf(D.today);
  let wall = "";
  for (let q = 0; q < 4; q++) {
    let bricks = "";
    for (let i = 0; i < 13; i++) {
      const w = addDays(YEAR_START, (q * 13 + i) * 7), s = stats[w], p = s && s.n ? s.d / s.n : 0;
      bricks += `<button class="brick${w === thisWeek ? " now" : ""}" style="--p:${p.toFixed(2)}" data-act="goto" data-week="${w}" title="Week ${q * 13 + i + 1}: ${range(w)}" aria-label="Week ${q * 13 + i + 1}, ${range(w)}, ${Math.round(p * 100)} percent done"></button>`;
    }
    wall += `<div class="course"><span class="label">Q${q + 1}</span><div class="bricks">${bricks}</div></div>`;
  }
  const laid = Object.entries(stats).filter(([w, s]) => w >= YEAR_START && s.n && s.d === s.n).length;
  const yearGoals = D.goals.filter((g) => g.horizon === "year");
  const curMonth = D.today.slice(0, 7) < "2027-01" ? "2027-01" : D.today.slice(0, 7);

  let months = "";
  MONTHS.forEach((name, i) => {
    const period = `2027-${pad(i + 1)}`;
    const focus = D.goals.find((g) => g.horizon === "focus" && g.period === period);
    const goals = D.goals.filter((g) => g.horizon === "month" && g.period === period);
    let weeks = "", d = 0, n = 0;
    for (let k = 0; k < 52; k++) {
      const w = addDays(YEAR_START, k * 7);
      if (w.slice(0, 7) !== period) continue;
      const s = stats[w] || { d: 0, n: 0 }; d += s.d; n += s.n;
      weeks += `<button class="wk" data-act="goto" data-week="${w}"><span>Week ${k + 1} · ${short(w)} to ${short(addDays(w, 6))}</span><span class="count">${s.d}/${s.n}</span></button>`;
    }
    months += `<details${period === curMonth ? " open" : ""}><summary><div class="spread"><h3>${name}</h3><span class="count">${d}/${n}</span></div><span class="muted">${focus ? esc(focus.title) : ""}</span></summary>
      <div class="in"><ul>${goals.map(goalRow).join("")}</ul>${weeks}</div></details>`;
  });

  const vis = D.goals.filter((g) => g.horizon === "vision");
  const years = [...new Set(vis.map((g) => g.period))].sort();
  const vision = years.map((y) => `<div class="year"><span class="num">${y}</span><ul>${vis.filter((g) => g.period === y).map(goalRow).join("")}</ul></div>`).join("");

  return `<section class="head"><p class="chip">2027</p><h1>One brick <span class="tide">a week.</span></h1>
      <p class="muted">Each brick is a week. It fills in as you tick off that week's tasks. ${laid} of 52 fully laid.</p>
      <div class="card wall" style="width:100%">${wall}</div></section>
    <section class="stack"><h2>Goals for the year</h2><div class="card"><ul>${yearGoals.map(goalRow).join("")}</ul></div></section>
    <section class="stack"><h2>Month by month</h2>${months}</section>
    <section class="stack"><div><h2>The 10-year picture</h2><p class="muted">A first draft. Tap any line to change the wording or the year.</p></div>
      <div class="card">${vision}</div>
      <button class="btn" data-act="add-vision">Add a milestone</button></section>`;
}

function vLearn() {
  const order = [...D.stages].sort((a, b) => (a.stage === 0) - (b.stage === 0) || a.stage - b.stage);
  const firstOpen = order.find((s) => s.stage > 0 && D.learn.some((i) => i.stage === s.stage && i.status !== "done"));
  const all = D.learn.filter((i) => i.stage > 0), doneAll = all.filter((i) => i.status === "done").length;
  const html = order.map((s) => {
    const items = D.learn.filter((i) => i.stage === s.stage), done = items.filter((i) => i.status === "done").length;
    const rows = items.map((i) => `<li class="item ${i.status}">
        <button class="st" data-act="learn-cycle" data-id="${i.id}" aria-label="Status ${i.status}, tap to change: ${esc(i.title)}"><i></i></button>
        <button class="tbody" data-act="edit-learn" data-id="${i.id}"><span class="ttl">${esc(i.title)}</span>
        <span class="tmeta">${i.kind === "build" ? '<span class="tag">Build this</span>' : ""}${i.status === "doing" ? '<span class="tag">In progress</span>' : ""}${i.detail ? `<span>${esc(i.detail)}</span>` : ""}</span></button></li>`).join("");
    return `<details${firstOpen && firstOpen.stage === s.stage ? " open" : ""}><summary>
        <div class="spread"><h3>${s.stage ? `Stage ${s.stage}: ` : ""}${esc(s.name)}</h3><span class="count">${done}/${items.length}</span></div>
        <span class="muted">${s.period ? esc(s.period) + " · " : ""}${esc(s.outcome)}</span>
        <div class="bar" style="--p:${items.length ? done / items.length : 0}"><i></i></div></summary>
      <div class="in"><ul>${rows}</ul><button class="btn small" data-act="add-learn" data-stage="${s.stage}" style="justify-self:start">Add an item</button></div></details>`;
  }).join("");
  return `<section class="head"><p class="chip">Roadmap</p><h1>From learner to <span class="tide">AI engineer.</span></h1>
      <p class="muted">Seven stages. Tap the circle to move an item from not started, to in progress, to done. Each stage ends with something you build and publish. Tools in this field change quickly, so at the start of each stage ask Claude what is current.</p>
      <div class="progress"><span class="count">${doneAll} of ${all.length} done</span><div class="bar" style="--p:${all.length ? doneAll / all.length : 0}"><i></i></div></div></section>
    <section class="stack">${html}</section>`;
}

function vLists() {
  const html = D.playbooks.map((p) => `<section class="stack"><h2>${esc(p.name)}</h2>${p.phases.map(([name, steps], i) => `<div class="card stack">
      <div class="spread"><h3>${esc(name)}</h3><button class="btn small" data-act="use-phase" data-pb="${p.id}" data-phase="${i}">Add to a week</button></div>
      <ul class="steps">${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>`).join("")}</section>`).join("");
  return `<section class="head"><p class="chip">Checklists</p><h1>Do it properly, <span class="tide">every time.</span></h1>
    <p class="muted">Run these on every project so nothing is missed. "Add to a week" copies a phase into your week as tasks you can tick off.</p></section>${html}`;
}

function vMoney() {
  const m = moneyMonth, y = m.slice(0, 4);
  const entries = D.income.filter((e) => e.date.startsWith(m));
  const earned = sumIncome(m);
  const target = (p) => { const g = D.goals.find((g) => g.horizon === "month" && g.period === p && g.auto === "income"); return g ? g.target : 0; };
  const yg = D.goals.find((g) => g.horizon === "year" && g.period === y && g.auto === "income");
  const months = MONTHS.map((_, i) => `${y}-${pad(i + 1)}`);
  const max = Math.max(1, ...months.map((p) => Math.max(target(p), sumIncome(p))));
  const chart = months.map((p, i) => `<button class="col" data-act="money-month" data-m="${p}" aria-pressed="${p === m}" aria-label="${MONTHS[i]}: ${inr(sumIncome(p))} earned, target ${inr(target(p))}" title="${MONTHS[i]}: ${inr(sumIncome(p))} of ${inr(target(p))}">
      <span class="plot"><i class="tg" style="--t:${target(p) / max}"></i><i class="ea" style="--e:${sumIncome(p) / max}"></i></span><small>${MONTHS[i][0]}</small></button>`).join("");
  const saving = D.goals.find((g) => g.horizon === "year" && g.unit === "₹" && !g.auto);
  const tg = target(m);
  return `<section class="head"><p class="chip">Money in</p><h1>${MONTHS[Number(m.slice(5)) - 1]} <span class="tide">${y}</span></h1>
      <div class="card stack" style="width:100%"><p class="big">${inr(earned)}</p>
        ${tg ? `<div class="bar" style="--p:${Math.min(1, earned / tg)}"><i></i></div><p class="count">Target ${inr(tg)} · ${earned >= tg ? "reached" : inr(tg - earned) + " to go"}</p>` : '<p class="count">No target set for this month</p>'}
        <div class="row"><button class="btn icon" data-act="money-step" data-n="-1" aria-label="Previous month">‹</button><button class="btn icon" data-act="money-step" data-n="1" aria-label="Next month">›</button></div></div></section>
    <section class="stack"><h2>${y} so far</h2><div class="card stack">
      <div class="chart">${chart}</div>
      <p class="count">Solid bar: earned. Dashed outline: target. Tap a month to open it.</p>
      <p>${inr(sumIncome(y))} earned${yg ? ` of ${inr(yg.target)}` : ""}</p>
      ${saving ? `<div class="stack" style="gap:6px"><div class="spread"><span>Saved</span><button class="btn small" data-act="goal-plus" data-id="${saving.id}">Update</button></div>
        <div class="bar" style="--p:${Math.min(1, (saving.current || 0) / saving.target)}"><i></i></div><p class="count">${inr(saving.current)} of ${inr(saving.target)}</p></div>` : ""}</div></section>
    <section class="stack"><h2>Record money received</h2>
      <form class="card incform" data-form="add-income">
        <label class="f">Amount (₹)<input type="number" name="amount" min="1" step="1" inputmode="numeric" required></label>
        <label class="f">From<select name="source"><option value="freelance">Freelance</option><option value="stipend">Stipend</option><option value="other">Other</option></select></label>
        <label class="f">Date<input type="date" name="date" value="${D.today}" required></label>
        <label class="f">Note<input type="text" name="note" maxlength="300" placeholder="Who paid, or what for"></label>
        <button class="btn primary wide">Save</button></form></section>
    <section class="stack"><h2>Received in ${MONTHS[Number(m.slice(5)) - 1]}</h2><div class="card">
      ${entries.length ? entries.map((e) => `<div class="entry"><div><p class="num">${inr(e.amount)}</p><p class="count">${short(e.date)} · ${esc(e.source)}${e.note ? " · " + esc(e.note) : ""}</p></div>
        <button class="btn small danger" data-act="del-income" data-id="${e.id}">Remove</button></div>`).join("") : '<p class="muted">Nothing recorded for this month yet.</p>'}</div></section>`;
}

function render() {
  const body = { week: vWeek, plan: vPlan, learn: vLearn, lists: vLists, money: vMoney }[view]();
  const nav = VIEWS.map((v) => `<button data-act="nav" data-view="${v}"${v === view ? ' aria-current="page"' : ""}><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[v]}</svg>${NAV[v]}</button>`).join("");
  const open = [...document.querySelectorAll("details")].map((d) => d.open);
  const keep = document.querySelectorAll("details").length;
  $("#app").innerHTML = `<div class="shell"><header class="top">${LOGO}<button class="btn small" data-act="logout">Log out</button></header><nav class="nav" aria-label="Sections">${nav}</nav><main>${body}</main></div>`;
  const now = document.querySelectorAll("details");
  if (now.length === keep && render.last === view) now.forEach((d, i) => { d.open = open[i]; });
  render.last = view;
}

function renderLogin(error) {
  $("#app").innerHTML = `<div class="login"><form data-form="login"><div class="head">${LOGO}<h1>Your plan, <span class="tide">one week</span> at a time.</h1></div>
    <label class="f">Password<input type="password" name="password" autocomplete="current-password" required autofocus></label>
    ${error ? `<p class="err">${esc(error)}</p>` : ""}<button class="btn primary">Open my plan</button></form></div>`;
}

// ---- the edit sheet ----
function sheet(title, fields, { onSave, onDelete, extra } = {}) {
  const dlg = $("#sheet");
  const field = (f) => {
    const a = `name="${f.name}" id="f-${f.name}"${f.required ? " required" : ""}`;
    let input;
    if (f.type === "textarea") input = `<textarea ${a} maxlength="2000">${esc(f.value)}</textarea>`;
    else if (f.type === "select") input = `<select ${a}>${f.options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(f.value ?? "") ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    else input = `<input type="${f.type || "text"}" ${a} value="${esc(f.value)}"${f.type === "number" ? ' step="any" inputmode="decimal"' : ' maxlength="500"'}>`;
    return `<label class="f">${esc(f.label)}${input}</label>`;
  };
  dlg.innerHTML = `<form class="sheet" method="dialog"><h2>${esc(title)}</h2>${fields.map(field).join("")}
    <div class="actions">${onDelete ? '<button type="button" class="btn danger" data-x="delete">Delete</button>' : ""}${extra ? `<button type="button" class="btn" data-x="extra">${esc(extra.label)}</button>` : ""}
    <button type="button" class="btn" data-x="cancel">Cancel</button><button class="btn primary">Save</button></div></form>`;
  const form = $("form", dlg);
  form.onsubmit = (e) => { e.preventDefault(); const v = Object.fromEntries(new FormData(form)); dlg.close(); act(() => onSave(v)); };
  form.onclick = (e) => {
    const x = e.target.closest("[data-x]"); if (!x) return;
    if (x.dataset.x === "cancel") dlg.close();
    if (x.dataset.x === "extra") { dlg.close(); act(extra.run); }
    if (x.dataset.x === "delete") {
      if (x.dataset.sure) { dlg.close(); act(onDelete); } else { x.dataset.sure = "1"; x.textContent = "Tap again to delete"; }
    }
  };
  dlg.showModal();
}
const trackOpts = Object.entries(TRACKS);

// ---- actions ----
const A = {
  nav: (el) => { view = el.dataset.view; location.hash = view; render(); window.scrollTo(0, 0); },
  "week-step": (el) => { week = addDays(week, 7 * Number(el.dataset.n)); addDay = undefined; render(); },
  "week-now": () => { week = mondayOf(D.today); addDay = undefined; render(); },
  goto: (el) => { week = el.dataset.week; view = "week"; location.hash = "week"; addDay = undefined; render(); window.scrollTo(0, 0); },
  logout: () => post("/api/logout", {}).then(() => { D = null; renderLogin(); }),

  toggle: (el) => {
    const t = D.tasks.find((x) => x.id === Number(el.dataset.id)); if (!t) return;
    t.done = t.done ? 0 : 1; render();
    call("tasks.update", { id: t.id, done: !!t.done }).catch((e) => { t.done = t.done ? 0 : 1; if (e.message !== "login") toast(e.message); if (D) render(); });
  },
  "edit-task": (el) => {
    const t = D.tasks.find((x) => x.id === Number(el.dataset.id)); if (!t) return;
    sheet("Edit task", [
      { name: "title", label: "Task", value: t.title, required: true },
      { name: "track", label: "Area", type: "select", value: t.track, options: trackOpts },
      { name: "date", label: "Day (leave empty for any day this week)", type: "date", value: t.date || "" },
      { name: "time", label: "Time (optional)", type: "time", value: t.time || "" },
      { name: "notes", label: "Notes", type: "textarea", value: t.notes },
    ], {
      onSave: async (v) => put(D.tasks, await call("tasks.update", { id: t.id, ...v })),
      onDelete: async () => { await call("tasks.delete", { id: t.id }); drop(D.tasks, t.id); },
      extra: { label: "Move to next week", run: async () => put(D.tasks, await call("tasks.update", t.date ? { id: t.id, date: addDays(t.date, 7) } : { id: t.id, week: addDays(t.week, 7) })) },
    });
  },
  mic: (el) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition, input = $("#newtask");
    const r = new SR(); r.lang = "en-IN"; r.interimResults = false;
    el.classList.add("live"); el.disabled = true;
    r.onresult = (e) => { input.value = e.results[0][0].transcript; input.focus(); };
    r.onerror = () => toast("I could not hear that. Check that the microphone is allowed, then try again.");
    r.onend = () => { el.classList.remove("live"); el.disabled = false; };
    r.start();
  },

  habit: (el) => {
    const id = Number(el.dataset.id), date = el.dataset.date;
    const i = D.habit_log.findIndex((l) => l.habit_id === id && l.date === date), on = i < 0;
    if (on) D.habit_log.push({ habit_id: id, date }); else D.habit_log.splice(i, 1);
    render();
    call("habits.check", { id, date, done: on }).catch((e) => { if (e.message !== "login") toast(e.message); });
  },
  "edit-habit": (el) => {
    const h = D.habits.find((x) => x.id === Number(el.dataset.id));
    sheet("Edit habit", [{ name: "title", label: "Habit", value: h.title, required: true }, { name: "why", label: "Why it matters", value: h.why }], {
      onSave: async (v) => put(D.habits, await call("habits.save", { id: h.id, ...v })),
      onDelete: async () => { await call("habits.delete", { id: h.id }); drop(D.habits, h.id); },
    });
  },
  "add-habit": () => sheet("Add a habit", [{ name: "title", label: "Habit", value: "", required: true }, { name: "why", label: "Why it matters", value: "" }],
    { onSave: async (v) => put(D.habits, await call("habits.save", v)) }),
  "goal-toggle": (el) => {
    const g = D.goals.find((x) => x.id === Number(el.dataset.id));
    act(async () => put(D.goals, await call("goals.save", { id: g.id, done: !g.done })));
  },
  "goal-plus": (el) => {
    const g = D.goals.find((x) => x.id === Number(el.dataset.id));
    if (g.unit !== "₹") return act(async () => put(D.goals, await call("goals.save", { id: g.id, current: (g.current || 0) + 1 })));
    sheet(g.title, [{ name: "current", label: "Amount so far (₹)", type: "number", value: g.current || 0, required: true }],
      { onSave: async (v) => put(D.goals, await call("goals.save", { id: g.id, current: v.current })) });
  },
  "edit-goal": (el) => {
    const g = D.goals.find((x) => x.id === Number(el.dataset.id));
    const fields = [{ name: "title", label: "Goal", value: g.title, required: true }, { name: "track", label: "Area", type: "select", value: g.track, options: trackOpts }];
    if (g.horizon === "vision") fields.push({ name: "period", label: "Year", type: "number", value: g.period, required: true });
    if (g.target !== null) { fields.push({ name: "target", label: "Target", type: "number", value: g.target, required: true }); if (!g.auto) fields.push({ name: "current", label: "So far", type: "number", value: g.current || 0 }); }
    sheet("Edit goal", fields, {
      onSave: async (v) => put(D.goals, await call("goals.save", { id: g.id, ...v })),
      onDelete: async () => { await call("goals.delete", { id: g.id }); drop(D.goals, g.id); },
    });
  },
  "add-vision": () => sheet("Add a milestone", [
    { name: "title", label: "Milestone", value: "", required: true },
    { name: "period", label: "Year", type: "number", value: 2028, required: true },
    { name: "track", label: "Area", type: "select", value: "life", options: trackOpts },
  ], { onSave: async (v) => put(D.goals, await call("goals.save", { ...v, horizon: "vision" })) }),

  "learn-cycle": (el) => {
    const i = D.learn.find((x) => x.id === Number(el.dataset.id));
    const next = { todo: "doing", doing: "done", done: "todo" }[i.status];
    act(async () => put(D.learn, await call("learn.save", { id: i.id, status: next })));
  },
  "edit-learn": (el) => {
    const i = D.learn.find((x) => x.id === Number(el.dataset.id));
    sheet("Edit item", [
      { name: "title", label: "Item", value: i.title, required: true },
      { name: "detail", label: "Note", type: "textarea", value: i.detail },
      { name: "status", label: "Status", type: "select", value: i.status, options: [["todo", "Not started"], ["doing", "In progress"], ["done", "Done"]] },
    ], {
      onSave: async (v) => put(D.learn, await call("learn.save", { id: i.id, ...v })),
      onDelete: async () => { await call("learn.delete", { id: i.id }); drop(D.learn, i.id); },
    });
  },
  "add-learn": (el) => {
    const stage = Number(el.dataset.stage);
    sheet("Add an item", [
      { name: "title", label: stage ? "What to learn or build" : "Question to answer", value: "", required: true },
      { name: "detail", label: "Note", type: "textarea", value: "" },
    ], { onSave: async (v) => put(D.learn, await call("learn.save", { ...v, stage, kind: stage ? "learn" : "figure" })) });
  },

  "use-phase": (el) => {
    const pb = D.playbooks.find((p) => p.id === el.dataset.pb), [name, steps] = pb.phases[Number(el.dataset.phase)];
    const cur = mondayOf(D.today);
    sheet(`${pb.name}: ${name}`, [
      { name: "project", label: "Project name (goes in front of each task)", value: "", required: true },
      { name: "week", label: "Which week", type: "select", value: cur, options: [0, 1, 2, 3].map((k) => { const w = addDays(cur, k * 7); return [w, k === 0 ? "This week" : `Week of ${short(w)}`]; }) },
      { name: "track", label: "Area", type: "select", value: pb.id === "launch" ? "brand" : "free", options: trackOpts },
    ], { onSave: async (v) => {
      const made = await call("tasks.add", { tasks: steps.map((s) => ({ title: `${v.project}: ${s}`, track: v.track, week: v.week })) });
      made.forEach((t) => put(D.tasks, t));
      toast(`${made.length} tasks added. Open the Week page to see them.`);
    } });
  },

  "money-month": (el) => { moneyMonth = el.dataset.m; render(); },
  "money-step": (el) => { const d = parse(moneyMonth + "-01"); d.setMonth(d.getMonth() + Number(el.dataset.n)); moneyMonth = fmt(d).slice(0, 7); render(); },
  "del-income": (el) => {
    if (!el.dataset.sure) { el.dataset.sure = "1"; el.textContent = "Tap again"; return; }
    const id = Number(el.dataset.id);
    act(async () => { await call("income.delete", { id }); drop(D.income, id); });
  },
};

// Pull a time such as "at 10", "at 10:30" or "at 5 pm" out of a typed or spoken task.
function readTime(title) {
  const m = /\bat (\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?=$|[\s,.])/i.exec(title);
  if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2] || 0), ap = (m[3] || "").toLowerCase();
  if (h > 23 || min > 59) return null;
  if (ap.startsWith("p") && h < 12) h += 12;
  if (ap.startsWith("a") && h === 12) h = 0;
  if (!ap && h >= 1 && h <= 7) h += 12; // "at 5" almost always means the afternoon
  return `${pad(h)}:${pad(min)}`;
}

const FORMS = {
  login: async (v) => {
    try { await post("/api/login", { password: v.password }); await load(); render(); }
    catch (e) { renderLogin(e.message); }
  },
  "add-task": (v) => act(async () => {
    const time = v.date ? readTime(v.title) : null;
    const made = await call("tasks.add", { tasks: [{ title: v.title, track: v.track, date: v.date || undefined, week, time: time || undefined }] });
    made.forEach((t) => put(D.tasks, t));
    addDay = v.date;
  }),
  "add-income": (v) => act(async () => {
    const e = await call("income.add", v);
    D.income.unshift(e); moneyMonth = e.date.slice(0, 7);
  }),
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (el && A[el.dataset.act] && !el.disabled) A[el.dataset.act](el);
});
document.addEventListener("submit", (e) => {
  const f = e.target.closest("[data-form]"); if (!f) return;
  e.preventDefault();
  FORMS[f.dataset.form](Object.fromEntries(new FormData(f)));
});
document.addEventListener("change", (e) => {
  const el = e.target.closest("[data-review]"); if (!el || !D) return;
  call("review.save", { week, [el.dataset.review]: el.value })
    .then((r) => { const i = D.reviews.findIndex((x) => x.week === r.week); if (i >= 0) D.reviews[i] = r; else D.reviews.push(r); })
    .catch((err) => { if (err.message !== "login") toast(err.message); });
});
window.addEventListener("hashchange", () => {
  const v = location.hash.slice(1);
  if (D && VIEWS.includes(v) && v !== view) { view = v; render(); }
});
// Pick up changes made on another device or by Claude when the page comes back into view.
document.addEventListener("visibilitychange", () => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
  if (document.visibilityState === "visible" && D && Date.now() - loadedAt > 30e3 && !$("#sheet").open && !typing) load().then(render).catch(() => {});
});

(async () => {
  const h = location.hash.slice(1);
  if (VIEWS.includes(h)) view = h;
  try { await load(); render(); if (h === "add") $("#newtask")?.focus(); }
  catch (e) { if (e.message !== "login") $("#app").innerHTML = `<p class="boot">${esc(e.message)}</p>`; }
})();
})();
