# Groundwork

A personal plan tracker: weekly targets, a daily routine, habits, year goals, a learning roadmap and checklists, on one page that works on a phone. It also has a built-in MCP connector, so Claude can read and update the plan.

- One Cloudflare Worker with no build step and no npm install.
- All data lives in one SQLite Durable Object.
- `public/` is plain HTML, CSS and JavaScript.
- `/mcp?key=...` exposes 13 tools to Claude.

## Run it

1. Edit `src/seed.js`, the starting plan. It is loaded once, on first run. The one in this repository is an example.
2. Create `.dev.vars` with `APP_PASSWORD`, `SESSION_SECRET` and `MCP_KEY`.
3. Start it locally with `npx wrangler dev --port 8799`.
4. Deploy with `npx wrangler deploy`, after setting the same three values with `npx wrangler secret put`.

## License

MIT (see `LICENSE`).
