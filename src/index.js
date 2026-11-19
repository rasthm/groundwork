// Groundwork: a personal plan tracker.
// One Worker serves the site, a JSON API for the browser, and an MCP endpoint for Claude.
// All data lives in one SQLite-backed Durable Object.
import { DurableObject } from "cloudflare:workers";
import * as seed from "./seed.js";

const TRACKS = ["work", "free", "learn", "brand", "money", "life"];
const SOURCES = ["stipend", "freelance", "other"];
const STATUSES = ["todo", "doing", "done"];

// ---- dates: plain YYYY-MM-DD strings, weeks start on Monday, "today" is Indian time ----
const pad = (n) => String(n).padStart(2, "0");
const fmt = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s) => new Date(s + "T00:00:00Z");
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parse(s).getTime());
const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
const mondayOf = (s) => addDays(s, -((parse(s).getUTCDay() + 6) % 7));
const todayIST = () => fmt(new Date(Date.now() + 5.5 * 3600e3));

const str = (v, max = 500) => String(v ?? "").trim().slice(0, max);
const bad = (m) => { throw new Error(m); };
const need = (v, m) => (v === undefined || v === null || v === "" ? bad(m) : v);
const oneOf = (v, list, name) => (list.includes(v) ? v : bad(`${name} must be one of: ${list.join(", ")}`));
const clock = (v) => (v === undefined || v === null || v === "" ? null : /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : bad("time must be HH:MM in 24-hour form, for example 10:00 or 17:30"));
const num = (v, name) => { const n = Number(v); return Number.isFinite(n) ? n : bad(`${name} must be a number`); };

export class Store extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY, title TEXT NOT NULL, track TEXT NOT NULL DEFAULT 'life',
        week TEXT NOT NULL, date TEXT, time TEXT, done INTEGER NOT NULL DEFAULT 0, done_at TEXT, notes TEXT NOT NULL DEFAULT '',
        src TEXT NOT NULL DEFAULT 'me', pos INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS tasks_week ON tasks(week);
      CREATE TABLE IF NOT EXISTS goals(id INTEGER PRIMARY KEY, horizon TEXT NOT NULL, period TEXT NOT NULL,
        track TEXT NOT NULL DEFAULT 'life', title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, target REAL, current REAL,
        unit TEXT NOT NULL DEFAULT '', auto TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', pos INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS stages(stage INTEGER PRIMARY KEY, name TEXT, period TEXT, outcome TEXT);
      CREATE TABLE IF NOT EXISTS learn(id INTEGER PRIMARY KEY, stage INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'learn',
        title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'todo', pos INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS income(id INTEGER PRIMARY KEY, date TEXT NOT NULL, amount INTEGER NOT NULL,
        source TEXT NOT NULL DEFAULT 'freelance', note TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS reviews(week TEXT PRIMARY KEY, wins TEXT NOT NULL DEFAULT '', blockers TEXT NOT NULL DEFAULT '',
        focus TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS routine(id INTEGER PRIMARY KEY, track TEXT, title TEXT, weekday INTEGER);
      CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS habits(id INTEGER PRIMARY KEY, title TEXT NOT NULL, why TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS habit_log(habit_id INTEGER NOT NULL, date TEXT NOT NULL, PRIMARY KEY(habit_id, date));
    `);
    if (!this.meta("seeded")) this.seed();
    if (!this.meta("seeded_habits")) {
      for (const [title, why] of seed.habits) this.sql.exec("INSERT INTO habits(title,why) VALUES(?,?)", title, why);
      this.setMeta("seeded_habits", "1");
    }
  }

  rows(q, ...b) { return this.sql.exec(q, ...b).toArray(); }
  row(q, ...b) { return this.rows(q, ...b)[0] || null; }
  meta(k) { const r = this.row("SELECT v FROM meta WHERE k=?", k); return r ? r.v : null; }
  setMeta(k, v) { this.sql.exec("INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", k, String(v)); }
  update(table, key, id, fields) {
    const keys = Object.keys(fields);
    if (keys.length) this.sql.exec(`UPDATE ${table} SET ${keys.map((k) => k + "=?").join(",")} WHERE ${key}=?`, ...keys.map((k) => fields[k]), id);
  }

  seed() {
    const task = (week, track, title, date, src) =>
      this.sql.exec("INSERT INTO tasks(title,track,week,date,src) VALUES(?,?,?,?,?)", title, track, week, date, src);
    const goal = (horizon, period, track, title, target = null, unit = "", auto = "") =>
      this.sql.exec("INSERT INTO goals(horizon,period,track,title,target,current,unit,auto) VALUES(?,?,?,?,?,?,?,?)",
        horizon, period, track, title, target, target === null ? null : 0, unit, auto);

    for (const [track, title, weekday] of seed.routine) this.sql.exec("INSERT INTO routine(track,title,weekday) VALUES(?,?,?)", track, title, weekday);
    for (const [week, list] of Object.entries(seed.setup)) for (const [track, title] of list) task(week, track, title, null, "plan");

    // 2027: 52 weeks from Monday 4 January. A week belongs to the month its Monday falls in.
    const order = ["learn", "free", "work"];
    for (let i = 0; i < 52; i++) {
      const week = addDays("2027-01-04", i * 7);
      const month = seed.months[Number(week.slice(5, 7)) - 1];
      const n = Math.floor((Number(week.slice(8, 10)) - 1) / 7); // 0-based week of the month
      if (n > 3) { task(week, "life", "Buffer week: finish anything still open, then rest", addDays(week, 5), "plan"); continue; }
      month.weeks[n].forEach((title, j) => task(week, order[j], title, addDays(week, seed.targetDay[order[j]]), "plan"));
      task(week, "brand", seed.brandWeeks[n], addDays(week, seed.targetDay.brand), "plan");
    }

    seed.months.forEach((m, i) => {
      const period = `2027-${pad(i + 1)}`;
      goal("focus", period, "life", m.focus);
      for (const [track, title] of m.goals) goal("month", period, track, title);
      goal("month", period, "money", `Earn ₹${m.target.toLocaleString("en-IN")} this month`, m.target, "₹", "income");
    });
    for (const [track, title, target, unit, auto] of seed.yearGoals) goal("year", "2027", track, title, target, unit, auto);
    for (const [year, track, title] of seed.vision) goal("vision", year, track, title);
    for (const [stage, name, period, outcome] of seed.stages) this.sql.exec("INSERT INTO stages VALUES(?,?,?,?)", stage, name, period, outcome);
    for (const [stage, kind, title, detail] of seed.learn) this.sql.exec("INSERT INTO learn(stage,kind,title,detail) VALUES(?,?,?,?)", stage, kind, title, detail);
    this.setMeta("seeded", "1");
  }

  // Add the fixed daily rhythm to a week, once. Days already in the past are skipped.
  ensureRoutine(week, today) {
    if (this.meta("r:" + week)) return;
    for (const r of this.rows("SELECT * FROM routine ORDER BY id")) {
      const date = r.weekday === null ? null : addDays(week, r.weekday);
      if (date && date < today) continue;
      this.sql.exec("INSERT INTO tasks(title,track,week,date,src) VALUES(?,?,?,?,'routine')", r.title, r.track, week, date);
    }
    this.setMeta("r:" + week, "1");
  }

  state(today) {
    const t = isDate(today) ? today : todayIST();
    const week = mondayOf(t);
    this.ensureRoutine(week, t);
    this.ensureRoutine(addDays(week, 7), t);
    return {
      today: t,
      tasks: this.rows("SELECT * FROM tasks ORDER BY week, time IS NULL, time, pos, id"),
      goals: this.rows("SELECT * FROM goals ORDER BY period, pos, id"),
      stages: this.rows("SELECT * FROM stages ORDER BY stage"),
      learn: this.rows("SELECT * FROM learn ORDER BY stage, pos, id"),
      income: this.rows("SELECT * FROM income ORDER BY date DESC, id DESC"),
      reviews: this.rows("SELECT * FROM reviews"),
      habits: this.rows("SELECT * FROM habits ORDER BY id"),
      habit_log: this.rows("SELECT * FROM habit_log WHERE date>=?", addDays(t, -400)),
      playbooks: seed.playbooks,
    };
  }

  overview() {
    const today = todayIST(), week = mondayOf(today), month = today.slice(0, 7);
    this.ensureRoutine(week, today);
    const tasks = this.rows("SELECT id,title,track,date,time,done FROM tasks WHERE week=? ORDER BY date IS NULL, date, time IS NULL, time, id", week);
    const earned = (p) => this.row("SELECT COALESCE(SUM(amount),0) AS s FROM income WHERE date LIKE ?", p + "%").s;
    const monthTarget = this.row("SELECT target FROM goals WHERE horizon='month' AND period=? AND auto='income'", month);
    return {
      today, week_starts: week,
      month_focus: (this.row("SELECT title FROM goals WHERE horizon='focus' AND period=?", month) || {}).title || null,
      week_progress: { done: tasks.filter((t) => t.done).length, total: tasks.length },
      due_today: tasks.filter((t) => t.date === today && !t.done),
      open_this_week: tasks.filter((t) => !t.done),
      month_goals: this.rows("SELECT id,title,track,done,target,current,unit FROM goals WHERE horizon='month' AND period=?", month),
      income: { this_month: earned(month), month_target: monthTarget ? monthTarget.target : null, this_year: earned(today.slice(0, 4)) },
      habits_today: this.rows("SELECT h.id, h.title, EXISTS(SELECT 1 FROM habit_log l WHERE l.habit_id=h.id AND l.date=?) AS done FROM habits h ORDER BY h.id", today),
      learning_in_progress: this.rows("SELECT id,stage,title FROM learn WHERE status='doing'"),
      tracks: TRACKS,
    };
  }

  // Every read and write goes through here, for both the browser API and the Claude connector.
  call(op, a = {}) {
    switch (op) {
      case "state": return this.state(a.today);
      case "overview": return this.overview();

      case "tasks.list": {
        const today = todayIST();
        const from = mondayOf(isDate(a.from) ? a.from : isDate(a.week) ? a.week : today);
        const to = isDate(a.to) ? a.to : addDays(from, 6);
        let list = this.rows("SELECT * FROM tasks WHERE week>=? AND week<=? ORDER BY week, date IS NULL, date, id", from, mondayOf(to));
        if (a.track) list = list.filter((t) => t.track === a.track);
        if (a.done !== undefined) list = list.filter((t) => !!t.done === !!a.done);
        return list;
      }
      case "tasks.add": {
        const items = Array.isArray(a.tasks) ? a.tasks : [a];
        if (!items.length || items.length > 60) bad("Send between 1 and 60 tasks");
        const today = todayIST();
        return items.map((t) => {
          const title = need(str(t.title), "Each task needs a title");
          const track = t.track ? oneOf(t.track, TRACKS, "track") : "life";
          const date = t.date ? (isDate(t.date) ? t.date : bad("date must be YYYY-MM-DD")) : null;
          const week = mondayOf(date || (isDate(t.week) ? t.week : today));
          return this.row("INSERT INTO tasks(title,track,week,date,time,notes,src) VALUES(?,?,?,?,?,?,?) RETURNING *",
            title, track, week, date, clock(t.time), str(t.notes, 2000), str(t.src || a.src || "me", 12));
        });
      }
      case "tasks.update": {
        const id = num(need(a.id, "id is required"), "id");
        if (!this.row("SELECT id FROM tasks WHERE id=?", id)) bad(`No task with id ${id}`);
        const f = {};
        if (a.title !== undefined) f.title = need(str(a.title), "title cannot be empty");
        if (a.track !== undefined) f.track = oneOf(a.track, TRACKS, "track");
        if (a.notes !== undefined) f.notes = str(a.notes, 2000);
        if (a.week !== undefined) f.week = mondayOf(isDate(a.week) ? a.week : bad("week must be YYYY-MM-DD"));
        if (a.date !== undefined) {
          f.date = a.date ? (isDate(a.date) ? a.date : bad("date must be YYYY-MM-DD")) : null;
          if (f.date) f.week = mondayOf(f.date);
        }
        if (a.time !== undefined) f.time = clock(a.time);
        if (a.done !== undefined) { f.done = a.done ? 1 : 0; f.done_at = a.done ? new Date().toISOString() : null; }
        this.update("tasks", "id", id, f);
        return this.row("SELECT * FROM tasks WHERE id=?", id);
      }
      case "tasks.delete": {
        const id = num(need(a.id, "id is required"), "id");
        this.sql.exec("DELETE FROM tasks WHERE id=?", id);
        return { deleted: id };
      }

      case "goals.list": {
        let list = this.rows("SELECT * FROM goals ORDER BY period, pos, id");
        if (a.horizon) list = list.filter((g) => g.horizon === a.horizon);
        if (a.period) list = list.filter((g) => g.period === a.period);
        return list;
      }
      case "goals.save": {
        const f = {};
        if (a.title !== undefined) f.title = need(str(a.title), "title cannot be empty");
        if (a.track !== undefined) f.track = oneOf(a.track, TRACKS, "track");
        if (a.horizon !== undefined) f.horizon = oneOf(a.horizon, ["vision", "year", "month", "focus"], "horizon");
        if (a.period !== undefined) f.period = /^\d{4}(-\d{2})?$/.test(a.period) ? a.period : bad("period must be YYYY or YYYY-MM");
        if (a.done !== undefined) f.done = a.done ? 1 : 0;
        if (a.target !== undefined) f.target = a.target === null || a.target === "" ? null : num(a.target, "target");
        if (a.current !== undefined) f.current = a.current === null || a.current === "" ? null : num(a.current, "current");
        if (a.unit !== undefined) f.unit = str(a.unit, 20);
        if (a.notes !== undefined) f.notes = str(a.notes, 2000);
        if (a.id) {
          const id = num(a.id, "id");
          if (!this.row("SELECT id FROM goals WHERE id=?", id)) bad(`No goal with id ${id}`);
          this.update("goals", "id", id, f);
          return this.row("SELECT * FROM goals WHERE id=?", id);
        }
        need(f.title, "title is required"); need(f.horizon, "horizon is required"); need(f.period, "period is required");
        const g = this.row("INSERT INTO goals(horizon,period,title) VALUES(?,?,?) RETURNING id", f.horizon, f.period, f.title);
        this.update("goals", "id", g.id, f);
        return this.row("SELECT * FROM goals WHERE id=?", g.id);
      }
      case "goals.delete": {
        const id = num(need(a.id, "id is required"), "id");
        this.sql.exec("DELETE FROM goals WHERE id=?", id);
        return { deleted: id };
      }

      case "learn.list": return { stages: this.rows("SELECT * FROM stages ORDER BY stage"), items: this.rows("SELECT * FROM learn ORDER BY stage, pos, id") };
      case "learn.save": {
        const f = {};
        if (a.title !== undefined) f.title = need(str(a.title), "title cannot be empty");
        if (a.detail !== undefined) f.detail = str(a.detail, 1000);
        if (a.status !== undefined) f.status = oneOf(a.status, STATUSES, "status");
        if (a.kind !== undefined) f.kind = oneOf(a.kind, ["learn", "build", "figure"], "kind");
        if (a.stage !== undefined) {
          f.stage = num(a.stage, "stage");
          if (!this.row("SELECT stage FROM stages WHERE stage=?", f.stage)) bad(`No stage ${f.stage}`);
        }
        if (a.id) {
          const id = num(a.id, "id");
          if (!this.row("SELECT id FROM learn WHERE id=?", id)) bad(`No learning item with id ${id}`);
          this.update("learn", "id", id, f);
          return this.row("SELECT * FROM learn WHERE id=?", id);
        }
        need(f.title, "title is required"); need(f.stage, "stage is required");
        const r = this.row("INSERT INTO learn(stage,title) VALUES(?,?) RETURNING id", f.stage, f.title);
        this.update("learn", "id", r.id, f);
        return this.row("SELECT * FROM learn WHERE id=?", r.id);
      }
      case "learn.delete": {
        const id = num(need(a.id, "id is required"), "id");
        this.sql.exec("DELETE FROM learn WHERE id=?", id);
        return { deleted: id };
      }

      case "income.list": {
        const p = a.period ? str(a.period, 7) : todayIST().slice(0, 4);
        const entries = this.rows("SELECT * FROM income WHERE date LIKE ? ORDER BY date DESC, id DESC", p + "%");
        return { period: p, total: entries.reduce((s, e) => s + e.amount, 0), entries };
      }
      case "income.add": {
        const amount = Math.round(num(need(a.amount, "amount is required"), "amount"));
        if (amount <= 0 || amount > 1e9) bad("amount must be a positive number of rupees");
        const date = a.date ? (isDate(a.date) ? a.date : bad("date must be YYYY-MM-DD")) : todayIST();
        const source = a.source ? oneOf(a.source, SOURCES, "source") : "freelance";
        return this.row("INSERT INTO income(date,amount,source,note) VALUES(?,?,?,?) RETURNING *", date, amount, source, str(a.note, 300));
      }
      case "income.delete": {
        const id = num(need(a.id, "id is required"), "id");
        this.sql.exec("DELETE FROM income WHERE id=?", id);
        return { deleted: id };
      }

      case "review.save": {
        const week = mondayOf(isDate(a.week) ? a.week : todayIST());
        this.sql.exec("INSERT OR IGNORE INTO reviews(week) VALUES(?)", week);
        const f = {};
        for (const k of ["wins", "blockers", "focus"]) if (a[k] !== undefined) f[k] = str(a[k], 3000);
        this.update("reviews", "week", week, f);
        return this.row("SELECT * FROM reviews WHERE week=?", week);
      }
      case "habits.check": {
        const id = num(need(a.id, "id is required"), "id");
        if (!this.row("SELECT id FROM habits WHERE id=?", id)) bad(`No habit with id ${id}`);
        const date = a.date ? (isDate(a.date) ? a.date : bad("date must be YYYY-MM-DD")) : todayIST();
        if (a.done === false) this.sql.exec("DELETE FROM habit_log WHERE habit_id=? AND date=?", id, date);
        else this.sql.exec("INSERT OR IGNORE INTO habit_log(habit_id,date) VALUES(?,?)", id, date);
        return { id, date, done: a.done !== false };
      }
      case "habits.save": {
        const f = {};
        if (a.title !== undefined) f.title = need(str(a.title, 200), "title cannot be empty");
        if (a.why !== undefined) f.why = str(a.why, 300);
        if (a.id) { const id = num(a.id, "id"); this.update("habits", "id", id, f); return this.row("SELECT * FROM habits WHERE id=?", id); }
        need(f.title, "title is required");
        return this.row("INSERT INTO habits(title,why) VALUES(?,?) RETURNING *", f.title, f.why || "");
      }
      case "habits.delete": {
        const id = num(need(a.id, "id is required"), "id");
        this.sql.exec("DELETE FROM habits WHERE id=?", id); this.sql.exec("DELETE FROM habit_log WHERE habit_id=?", id);
        return { deleted: id };
      }
      case "review.get": return this.row("SELECT * FROM reviews WHERE week=?", mondayOf(isDate(a.week) ? a.week : todayIST()));

      // Login attempt limiting, per IP address: 8 wrong passwords locks that address out for 15 minutes.
      case "auth.locked": { const u = Number(this.meta("lock:" + a.ip) || 0); return u > Date.now(); }
      case "auth.fail": {
        const n = Number(this.meta("fail:" + a.ip) || 0) + 1;
        if (n >= 8) { this.setMeta("lock:" + a.ip, Date.now() + 15 * 60e3); this.setMeta("fail:" + a.ip, 0); } else this.setMeta("fail:" + a.ip, n);
        return n;
      }
      case "auth.ok": this.sql.exec("DELETE FROM meta WHERE k IN (?,?)", "fail:" + a.ip, "lock:" + a.ip); return true;

      default: bad(`Unknown operation: ${op}`);
    }
  }
}

// ---- HTTP helpers ----
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers } });

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function safeEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const p = new Uint8Array(x), q = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < p.length; i++) diff |= p[i] ^ q[i];
  return diff === 0;
}
async function sign(secret, text) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}
const SESSION_DAYS = 90;
async function newSession(env) {
  const exp = String(Date.now() + SESSION_DAYS * 864e5);
  return `${exp}.${await sign(env.SESSION_SECRET, exp)}`;
}
async function validSession(request, env) {
  const m = /(?:^|;\s*)gw=([^;]+)/.exec(request.headers.get("cookie") || "");
  if (!m || !env.SESSION_SECRET) return false;
  const [exp, mac] = m[1].split(".");
  if (!exp || !mac || Number(exp) < Date.now()) return false;
  return safeEq(mac, await sign(env.SESSION_SECRET, exp));
}
const cookie = (value, maxAge) => `gw=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

// Operations the browser may call. The auth.* operations are internal only.
const BROWSER_OPS = new Set(["tasks.list", "tasks.add", "tasks.update", "tasks.delete", "goals.list", "goals.save", "goals.delete",
  "learn.list", "learn.save", "learn.delete", "income.list", "income.add", "income.delete", "review.save", "review.get", "overview", "habits.check", "habits.save", "habits.delete"]);

async function handleApi(request, env, url, store) {
  const path = url.pathname, method = request.method;
  if (method === "POST") {
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) return json({ error: "Wrong origin" }, 403);
  }
  if (path === "/api/login" && method === "POST") {
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    if (await store.call("auth.locked", { ip })) return json({ error: "Too many wrong attempts. Try again in 15 minutes." }, 429);
    const body = await request.json().catch(() => ({}));
    if (!env.APP_PASSWORD || !env.SESSION_SECRET || !(await safeEq(body.password, env.APP_PASSWORD))) {
      await store.call("auth.fail", { ip });
      return json({ error: "Wrong password" }, 401);
    }
    await store.call("auth.ok", { ip });
    return json({ ok: true }, 200, { "set-cookie": cookie(await newSession(env), SESSION_DAYS * 86400) });
  }
  if (path === "/api/logout" && method === "POST") return json({ ok: true }, 200, { "set-cookie": cookie("", 0) });

  if (!(await validSession(request, env))) return json({ error: "Please log in" }, 401);

  if (path === "/api/state" && method === "GET") return json({ result: await store.call("state", { today: url.searchParams.get("today") }) });
  if (path === "/api/op" && method === "POST") {
    const body = await request.json().catch(() => null);
    if (!body || !BROWSER_OPS.has(body.op)) return json({ error: "Unknown operation" }, 400);
    try { return json({ result: await store.call(body.op, body.args || {}) }); }
    catch (e) { return json({ error: e.message }, 400); }
  }
  return json({ error: "Not found" }, 404);
}

// ---- MCP (Model Context Protocol) at /mcp?key=..., so Claude can read and change the tracker ----
const TRACK_NOTE = "Tracks: work (the Zephyr internship), free (freelance client work), learn (learning), brand (marketing and showing work), money, life.";
const obj = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const P = {
  id: { type: "integer", description: "The item's id, from a list or overview call." },
  date: { type: "string", description: "A day as YYYY-MM-DD (Indian time)." },
  week: { type: "string", description: "Any day inside the week, as YYYY-MM-DD. Weeks run Monday to Sunday." },
  track: { type: "string", enum: TRACKS, description: TRACK_NOTE },
};
const taskFields = {
  title: { type: "string", description: "What to do, as a short action, for example 'Send proposal to the bakery'." },
  track: P.track,
  date: { ...P.date, description: "The day the task is for, as YYYY-MM-DD. Leave out for 'any day this week'." },
  week: { ...P.week, description: "Use instead of date for a task with no fixed day. Defaults to the current week." },
  time: { type: "string", description: "Optional time of day as HH:MM in 24-hour form, for example '10:00' for a 10am meeting. Needs a date." },
  notes: { type: "string", description: "Optional extra detail." },
};
const MCP_TOOLS = [
  { name: "overview", op: "overview",
    description: "Start here. Returns today's date, this week's progress, tasks due today, open tasks this week, this month's focus and goals, income against target, and learning in progress. Call this before answering questions like 'what should I do today?' or before adding tasks, so dates and ids are correct.",
    inputSchema: obj({}) },
  { name: "tasks_list", op: "tasks.list",
    description: "List tasks for one week or a range of weeks. With no arguments it returns the current week. Use this to find a task's id before updating or deleting it.",
    inputSchema: obj({ week: P.week, from: { ...P.date, description: "Start of a range, YYYY-MM-DD." }, to: { ...P.date, description: "End of a range, YYYY-MM-DD." }, track: P.track, done: { type: "boolean", description: "true for finished tasks only, false for open tasks only." } }) },
  { name: "tasks_add", op: "tasks.add",
    description: "Add one or more tasks. Give each a date for a specific day, or a week for 'any day that week'. To plan a whole week, send all its tasks in one call.",
    inputSchema: obj({ tasks: { type: "array", minItems: 1, maxItems: 60, items: obj(taskFields, ["title"]) } }, ["tasks"]) },
  { name: "task_update", op: "tasks.update",
    description: "Change one task: mark it done or not done, rename it, move it to another day (date) or week, change its track or notes. Send only the fields that change. Set date to an empty string to make it 'any day'.",
    inputSchema: obj({ id: P.id, done: { type: "boolean" }, ...taskFields }, ["id"]) },
  { name: "task_delete", op: "tasks.delete",
    description: "Permanently delete one task. Confirm with the user first unless they clearly asked for it to be removed.",
    inputSchema: obj({ id: P.id }, ["id"]) },
  { name: "goals_list", op: "goals.list",
    description: "List goals. horizon is one of: vision (10-year milestones, period is a year), year (period '2027'), month (period like '2027-03'), focus (the one-line theme of a month).",
    inputSchema: obj({ horizon: { type: "string", enum: ["vision", "year", "month", "focus"] }, period: { type: "string", description: "A year 'YYYY' or a month 'YYYY-MM'." } }) },
  { name: "goal_save", op: "goals.save",
    description: "Create a goal (no id: title, horizon and period are required) or change one (with id: send only the fields that change). Use 'current' to update progress on a goal that has a numeric target, and 'done' to tick a goal off.",
    inputSchema: obj({ id: P.id, title: { type: "string" }, horizon: { type: "string", enum: ["vision", "year", "month", "focus"] }, period: { type: "string", description: "'YYYY' for vision and year goals, 'YYYY-MM' for month goals." }, track: P.track, done: { type: "boolean" }, target: { type: ["number", "null"], description: "A number to reach, if the goal is countable." }, current: { type: ["number", "null"], description: "Progress so far toward target." }, unit: { type: "string", description: "For example '₹' or 'projects'." }, notes: { type: "string" } }) },
  { name: "learning_list", op: "learn.list",
    description: "The learning roadmap: stages 1 to 7 with their items, plus stage 0, which holds decisions and open questions. Each item has a status of todo, doing or done, and a kind of learn, build (the proof project for a stage) or figure (a decision to make).",
    inputSchema: obj({}) },
  { name: "learning_save", op: "learn.save",
    description: "Add an item to the roadmap (no id: title and stage are required) or change one (with id), for example setting status to 'doing' or 'done'.",
    inputSchema: obj({ id: P.id, title: { type: "string" }, stage: { type: "integer", description: "0 for decisions, 1 to 7 for learning stages." }, kind: { type: "string", enum: ["learn", "build", "figure"] }, status: { type: "string", enum: STATUSES }, detail: { type: "string" } }) },
  { name: "income_add", op: "income.add",
    description: "Record money received, in whole rupees. source is stipend (the internship), freelance (client work) or other. date defaults to today.",
    inputSchema: obj({ amount: { type: "number", description: "Rupees received, for example 30000." }, source: { type: "string", enum: SOURCES }, date: P.date, note: { type: "string", description: "Who paid or what for." } }, ["amount"]) },
  { name: "income_list", op: "income.list",
    description: "List money received and the total, for a year ('2027') or a month ('2027-03'). Defaults to the current year.",
    inputSchema: obj({ period: { type: "string", description: "'YYYY' or 'YYYY-MM'." } }) },
  { name: "habit_check", op: "habits.check",
    description: "Tick a daily habit as done (or not done with done=false) for a day. Habit ids and today's status are in overview under habits_today. date defaults to today.",
    inputSchema: obj({ id: P.id, date: P.date, done: { type: "boolean" } }, ["id"]) },
  { name: "review_save", op: "review.save",
    description: "Save the weekly review: wins (what got finished), blockers (what got in the way) and focus (the one thing for next week). Defaults to the current week. Send only the fields to change.",
    inputSchema: obj({ week: P.week, wins: { type: "string" }, blockers: { type: "string" }, focus: { type: "string" } }) },
];
const mcpText = (t, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

async function handleMcp(request, store) {
  if (request.method !== "POST") return json({ error: "Use POST for MCP messages" }, 405);
  let msg;
  try { msg = await request.json(); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
  if (msg.id === undefined) return new Response(null, { status: 202 }); // notifications need no reply
  const reply = (result) => json({ jsonrpc: "2.0", id: msg.id, result });
  const err = (code, message) => json({ jsonrpc: "2.0", id: msg.id, error: { code, message } });
  switch (msg.method) {
    case "initialize":
      return reply({
        protocolVersion: (msg.params && msg.params.protocolVersion) || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "groundwork", version: "1.0.0" },
        instructions: `Groundwork is the user's personal plan tracker: daily and weekly tasks, month and year goals, 10-year milestones, a learning roadmap for becoming an AI engineer, and an income log in rupees. Call overview first to get today's date and current state. Dates are YYYY-MM-DD in Indian time and weeks run Monday to Sunday. ${TRACK_NOTE} When the user asks to plan a week, add tasks with a date for each day, a few per day, and keep the existing tasks unless asked to replace them.`,
      });
    case "ping": return reply({});
    case "tools/list": return reply({ tools: MCP_TOOLS.map(({ op, ...t }) => t) });
    case "tools/call": {
      const tool = MCP_TOOLS.find((t) => t.name === (msg.params && msg.params.name));
      if (!tool) return err(-32602, `Unknown tool: ${msg.params && msg.params.name}`);
      const args = { ...((msg.params && msg.params.arguments) || {}) };
      if (tool.op === "tasks.add") args.src = "claude";
      try { return reply(mcpText(JSON.stringify(await store.call(tool.op, args), null, 1))); }
      catch (e) { return reply(mcpText(`Error: ${e.message}`, true)); }
    }
    default: return err(-32601, `Method not found: ${msg.method}`);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const store = env.STORE.getByName("main");
    if (url.pathname === "/mcp") {
      const key = request.headers.get("x-api-key") || url.searchParams.get("key");
      if (!env.MCP_KEY || !(await safeEq(key, env.MCP_KEY))) return json({ error: "Invalid or missing key" }, 401);
      return handleMcp(request, store);
    }
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, url, store);
    return env.ASSETS.fetch(request);
  },
};
