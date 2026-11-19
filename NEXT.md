# Groundwork: handoff notes

Personal plan tracker. Live at https://groundwork.orbit-fm.workers.dev. Password and Claude connector URL are in `.secrets.txt` (never commit or print it).

## How it is built

- One Cloudflare Worker, no build step, no npm install. Deploy with `npx wrangler deploy` from this folder.
- `src/index.js`: the Worker. Serves `/api/*` for the browser (cookie login) and `/mcp?key=...` for Claude (13 tools). All data is in one SQLite Durable Object (`Store`). Every read and write goes through `Store.call(op, args)`.
- `src/seed.js`: the starting plan (2027 weekly targets, daily routine, habits, goals, learning roadmap, checklists). It loads once, on first run. Editing it does not change the live data; change live data through the site or the connector.
- `public/`: the screens. `app.js` is plain JavaScript that redraws from one state object. `app.css` holds the design tokens at the top.
- Local testing: create `.dev.vars` with `APP_PASSWORD`, `SESSION_SECRET`, `MCP_KEY`, then `npx wrangler dev --port 8799`. Kill `workerd` and `node` afterwards.

## Tested

- Local: every API operation, login rules, the connector, and phone-size screenshots of all five pages.
- Live: pages load, login works, wrong password and missing key are refused, seeded data is present, connector lists its tools.

## Not done yet

1. **Phone check on the live site.** The brick wall width fix on the Plan page was deployed without a fresh screenshot. Open the Plan page on a phone and confirm the wall fits.
2. **Voice button.** The microphone button uses the browser's speech recognition. It has not been tried on a real phone.
3. **Reminders.** The owner wants a morning notification or email with the day's tasks. Options: a daily email through Resend (needs an API key; the test sender only delivers to the account owner's own address, which is fine here) triggered by a Worker cron at `30 1 * * *` (07:00 IST); or web push (needs a service worker and VAPID keys). Ask the owner which before building.
4. **Home-screen widget.** A web app cannot provide a true widget. The site can be installed to the home screen, and long-pressing its icon offers "Add a task".
5. **Portfolio.** The owner offered access to improve their portfolio site (`rasthm-portfolio`). The plan's marketing tasks depend on it showing each project's problem, build and result.
6. **Git.** This folder is not a git repository yet.
