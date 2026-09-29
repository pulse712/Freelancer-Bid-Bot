# Freelancer Bid Bot (Server + Extension)

- `server/` – dashboard and API. Queue Freelancer URLs per worker and watch results. Runs locally or on Vercel.
- `extension/` – Chrome extension worker, one per Freelancer account. It writes bids with its own AI key, takes queued tasks from the server, opens the project, types the bid, and reports the result.

## Flow

1. In the extension, set Worker ID, AI provider, API key, prompt, and budget rules.
2. On the dashboard, choose a Worker ID, paste project URLs, and click **Queue projects**.
3. For each URL the server loads the project from Freelancer's public API when it can, then queues the task.
4. The extension with that Worker ID checks the server every 30 seconds, opens the project, writes the bid with its API key, types it, and clicks submit if that option is on.
5. The extension reports `success` or `fail`, which appears in Working results.

If Freelancer's API can't find a project, the task is still queued. The worker reads the project from the page.

A dispatched task with no result within `TASK_TIMEOUT_MS` is re-queued, up to `MAX_ATTEMPTS` total tries, then marked failed.

## Bid prompt placeholders

| Placeholder | Filled with |
| --- | --- |
| `{title}` | Project title |
| `{description}` | Full project description |
| `{budget}` | Budget range, e.g. `$250-$750 USD` or `$15-$25 USD per hour` |
| `{skills}` | Skills listed on the project |
| `{url}` | Project URL |

Put your own background (experience, portfolio links, tone) directly in the prompt text in the extension.

## Run the server locally

```bash
npm install
cp .env.example .env   # set DASHBOARD_PASSWORD and WORKER_TOKEN
npm run dev
```

Open `http://localhost:8787/`. Without Upstash variables the server uses in-memory storage, which loses tasks on restart.

## Deploy to Vercel

1. Import the repo as a Vercel project with the default root directory (`extension/` is excluded by `.vercelignore`).
2. Add the Upstash Redis integration from the Vercel Marketplace. It sets the storage env variables automatically.
3. Set `DASHBOARD_PASSWORD` and `WORKER_TOKEN` in the project env settings.
4. Deploy and check `https://<your-app>.vercel.app/health` – it should show `"storage": "redis"` and `"passwordEnabled": true`.
5. Open the dashboard, log in, and queue projects for a Worker ID that matches an extension.

## Dashboard login

- `DASHBOARD_PASSWORD` protects the dashboard page and every `/api/*` route except the worker routes, which use `WORKER_TOKEN`.
- Logging in sets a signed, HttpOnly cookie valid for 30 days. Changing the password logs every browser out.
- Wrong passwords are limited to 10 tries per 10 minutes per IP address.
- If `DASHBOARD_PASSWORD` is empty the dashboard is open and shows a warning banner.

## Install the extension (per Octo profile / VPS browser)

1. `chrome://extensions` → Developer mode → Load unpacked → select the `extension/` folder.
2. Open the side panel (click the toolbar icon) and fill in:
   - Worker: a Name for this account and a Worker ID (e.g. `acc-1`).
   - AI: provider and API key. `Test key` checks the key; `Load models` lists the models the key can use.
   - Bid prompt: edit freely, same placeholders as above.
3. Paste a project URL and press `Go` (opens the page) or `Go + Create Bid` (reads the project, writes the bid with your key, types it, and submits if "Click the Place Bid button" is on).

"Type like a human" types the bid character by character with random pauses; the speed setting controls how long that takes. Leave the submit checkbox off until you have watched a few bids being filled correctly.

### Server mode (optional)

Open "Server mode" at the bottom of the panel, set the Server URL and Worker token (same as `WORKER_TOKEN`), and click `Start Auto`. The worker then picks up projects queued on the dashboard and writes each bid with the key saved in the panel.

## API

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `POST /api/login` | none | `{ password }` sets the session cookie |
| `POST /api/logout` | none | Clears the session cookie |
| `GET /api/session` | none | `{ passwordEnabled, loggedIn }` |
| `POST /api/tasks` | session cookie | `{ workerId, url }` or `{ workerId, urls: [] }`: fetch project info if possible, then queue |
| `GET /api/tasks` | session cookie | Recent tasks |
| `POST /api/tasks/:id/retry` | session cookie | Re-queue a finished or failed task |
| `GET /api/workers` | session cookie | Workers and last check-in time |
| `GET /api/results` | session cookie | Recent results |
| `GET /api/worker/next-task?workerId=` | `x-worker-token` | Claim the next task |
| `POST /api/worker/task-result` | `x-worker-token` | Report `success` / `fail` |
| `POST /api/draft-bid` | `x-worker-token` | Fallback bid write if the extension has no API key (needs leftover server AI settings) |

## Known limits

- Without `DASHBOARD_PASSWORD` the dashboard is open. Anyone with the server URL can queue projects.
- `success` means the submit button was clicked. The extension does not yet check whether Freelancer accepted the bid.
- The extension's page selectors (bid box, submit button) are best guesses and need checking against the live bid form.
