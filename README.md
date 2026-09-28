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
cp .env.example .env   # set WORKER_TOKEN
npm run dev
```

Open `http://localhost:8787/`. Without Upstash variables the server uses in-memory storage, which loses tasks and settings on restart.

## Deploy to Vercel

1. Import the repo as a Vercel project with the default root directory (`extension/` is excluded by `.vercelignore`).
2. Add the Upstash Redis integration from the Vercel Marketplace. It sets the storage env variables automatically.
3. Set `WORKER_TOKEN` in the project env settings.
4. Deploy and check `https://<your-app>.vercel.app/health` – it should show `"storage": "redis"`.
5. Open the dashboard and fill in Settings.

## Install the extension (per Octo profile / VPS browser)

1. `chrome://extensions` → Developer mode → Load unpacked → select the `extension/` folder.
2. In the side panel set:
   - Server URL: your Vercel URL
   - Worker ID: unique per account, e.g. `acc-1`
   - Worker token: same as server `WORKER_TOKEN`
   - Auto click submit button: leave off until filling works correctly
3. Click `Start Auto`.

## API

| Endpoint | Auth header | Purpose |
| --- | --- | --- |
| `GET /api/settings` | none | AI settings and prompt (the API key is never returned, only whether one is saved) |
| `PUT /api/settings` | none | Save `{ provider, apiKey, model, baseUrl, prompt }`; omit `apiKey` to keep the saved one |
| `POST /api/tasks` | none | `{ workerId, url }` or `{ workerId, urls: [] }`: fetch projects, write bids, queue |
| `GET /api/tasks` | none | Recent tasks with their bids |
| `POST /api/tasks/:id/retry` | none | Write the bid again and re-queue a finished or failed task |
| `GET /api/workers` | none | Workers and last check-in time |
| `GET /api/results` | none | Recent results |
| `GET /api/worker/next-task?workerId=` | `x-worker-token` | Claim the next task |
| `POST /api/worker/task-result` | `x-worker-token` | Report `success` / `fail` |
| `POST /api/draft-bid` | `x-worker-token` | Write a bid for page-extracted project data (fallback) |

## Known limits

- The dashboard has no login. Anyone with the server URL can change settings and spend your AI credits, so keep the URL private.
- `success` means the submit button was clicked. The extension does not yet check whether Freelancer accepted the bid.
- The extension's page selectors (bid box, submit button) are best guesses and need checking against the live bid form.
- Only the proposal text is filled. Bid amount and delivery time are left as Freelancer pre-fills them.
