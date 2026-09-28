# Freelancer Bid Bot (Server + Extension)

- `server/` – dashboard and API. It holds the AI settings and bid prompt, writes bids, and keeps a task queue per worker. Runs locally or on Vercel.
- `extension/` – Chrome extension worker, one per Freelancer account. It takes tasks from the server, opens the project, pastes the server's bid, optionally submits, and reports the result.

## Flow

1. In the dashboard **Settings**, choose the AI provider, paste the API key, and edit the bid prompt.
2. In **Queue projects**, choose a Worker ID, paste project URLs, and click **Create bids and queue**.
3. For each URL the server loads the project from Freelancer's public API (title, description, budget, skills), fills your prompt, and asks the AI for a bid. The bid is shown in the task list.
4. The extension with that Worker ID checks the server every 30 seconds, receives the task with the bid, opens the project, pastes the bid, and clicks submit if "Auto click submit button" is on.
5. The extension reports `success` or `fail`, which appears in the Result column.

If Freelancer's API can't find a project, the task is still queued. The worker then reads the project from the page and asks the server for the bid, which still uses the dashboard settings.

If a bid can't be generated (no key, provider error), the task is marked failed with the reason. Fix the settings and click **Retry**: the server writes the bid again with the current settings and re-queues it.

A dispatched task with no result within `TASK_TIMEOUT_MS` is re-queued, up to `MAX_ATTEMPTS` total tries, then marked failed.

## Bid prompt placeholders

| Placeholder | Filled with |
| --- | --- |
| `{title}` | Project title |
| `{description}` | Full project description |
| `{budget}` | Budget range, e.g. `$250-$750 USD` or `$15-$25 USD per hour` |
| `{skills}` | Skills listed on the project |
| `{url}` | Project URL |

Put your own background (experience, portfolio links, tone) directly in the prompt text.

## Run the server locally

```bash
npm install
cp .env.example .env   # set DASHBOARD_PASSWORD and WORKER_TOKEN
npm run dev
```

Open `http://localhost:8787/`. Without Upstash variables the server uses in-memory storage, which loses tasks and settings on restart.

## Deploy to Vercel

1. Import the repo as a Vercel project with the default root directory (`extension/` is excluded by `.vercelignore`).
2. Add the Upstash Redis integration from the Vercel Marketplace. It sets the storage env variables automatically.
3. Set `DASHBOARD_PASSWORD` and `WORKER_TOKEN` in the project env settings.
4. Deploy and check `https://<your-app>.vercel.app/health` – it should show `"storage": "redis"` and `"passwordEnabled": true`.
5. Open the dashboard, log in, and fill in Settings.

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
   - Bid prompt: edit freely, same placeholders as the server.
3. Paste a project URL and press `Go` (opens the page) or `Go + Create Bid` (reads the project, writes the bid with your key, types it, and submits if "Click the submit button" is on).

"Type like a human" types the bid character by character with random pauses; the speed setting controls how long that takes. Leave the submit checkbox off until you have watched a few bids being filled correctly.

### Server mode (optional)

Open "Server mode" at the bottom of the panel, set the Server URL and Worker token (same as `WORKER_TOKEN`), and click `Start Auto`. The worker then picks up projects queued on the dashboard. Bids for queued tasks are written by the server; if a task arrives without a bid, the extension writes one with its own key, or asks the server if no key is saved in the panel.

## API

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `POST /api/login` | none | `{ password }` sets the session cookie |
| `POST /api/logout` | none | Clears the session cookie |
| `GET /api/session` | none | `{ passwordEnabled, loggedIn }` |
| `GET /api/settings` | session cookie | AI settings and prompt (the API key is never returned, only whether one is saved) |
| `PUT /api/settings` | session cookie | Save `{ provider, apiKey, model, baseUrl, prompt }`; omit `apiKey` to keep the saved one |
| `POST /api/settings/test` | session cookie | Check `{ provider, apiKey, model, baseUrl }`: key accepted, model available, and one test reply |
| `POST /api/settings/models` | session cookie | List the chat models the key can use, newest first |
| `POST /api/tasks` | session cookie | `{ workerId, url }` or `{ workerId, urls: [] }`: fetch projects, write bids, queue |
| `GET /api/tasks` | session cookie | Recent tasks with their bids |
| `POST /api/tasks/:id/retry` | session cookie | Write the bid again and re-queue a finished or failed task |
| `GET /api/workers` | session cookie | Workers and last check-in time |
| `GET /api/results` | session cookie | Recent results |
| `GET /api/worker/next-task?workerId=` | `x-worker-token` | Claim the next task |
| `POST /api/worker/task-result` | `x-worker-token` | Report `success` / `fail` |
| `POST /api/draft-bid` | `x-worker-token` | Write a bid for page-extracted project data (fallback) |

## Known limits

- Without `DASHBOARD_PASSWORD` the dashboard is open. Anyone with the server URL could then change settings and spend your AI credits.
- `success` means the submit button was clicked. The extension does not yet check whether Freelancer accepted the bid.
- The extension's page selectors (bid box, submit button) are best guesses and need checking against the live bid form.
- Only the proposal text is filled. Bid amount and delivery time are left as Freelancer pre-fills them.
