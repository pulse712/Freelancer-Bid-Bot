# Freelancer Bid Bot (Server + Extension)

- `server/` – task server: dashboard, per-worker queue, results, AI bid generation. Runs locally or on Vercel.
- `extension/` – Chrome extension worker: polls the server, opens the project, drafts the bid, fills it, optionally submits, reports the result.

## Flow

1. You queue project URLs for a worker on the dashboard (`/`).
2. The extension for that worker polls `GET /api/worker/next-task` every 30 seconds.
3. It opens the URL in its worker tab and reads title, description, and budget.
4. It asks `POST /api/draft-bid` for a bid, using the provider and API key set in the side panel.
5. It types the bid and clicks submit if "Auto click submit button" is on.
6. It reports `success` or `fail` to `POST /api/worker/task-result`.

A task that gets no result within `TASK_TIMEOUT_MS` is re-queued, up to `MAX_ATTEMPTS` total tries, then marked failed. Failed or finished tasks can be retried from the dashboard.

## Run the server locally

```bash
npm install
cp .env.example .env   # set ADMIN_KEY and WORKER_TOKEN
npm run dev
```

Open `http://localhost:8787/`. Without Upstash variables the server uses in-memory storage, which is fine locally and loses data on restart.

## Deploy to Vercel

1. Import this folder as a Vercel project (`extension/` is excluded by `.vercelignore`).
2. Add the Upstash Redis integration from the Vercel Marketplace. It sets the storage env variables automatically.
3. Set `ADMIN_KEY` and `WORKER_TOKEN` in the project env settings.
4. Deploy and check `https://<your-app>.vercel.app/health` – it should show `"storage": "redis"`.

## Install the extension (per Octo profile / VPS browser)

1. `chrome://extensions` → Developer mode → Load unpacked → select the `extension/` folder.
2. Open the side panel and set:
   - Backend URL: your Vercel URL
   - Worker ID: unique per account, e.g. `acc-1`
   - Worker Token: same as server `WORKER_TOKEN`
   - AI provider, API key, and optionally model and base URL
   - Auto click submit button: leave off until filling works correctly
3. Click `Start Auto`.

## API

| Endpoint | Auth header | Purpose |
| --- | --- | --- |
| `POST /api/tasks` | `x-admin-key` | Queue `{ workerId, url }` or `{ workerId, urls: [] }` |
| `GET /api/tasks` | `x-admin-key` | Recent tasks |
| `POST /api/tasks/:id/retry` | `x-admin-key` | Re-queue a finished or failed task |
| `GET /api/workers` | `x-admin-key` | Workers and last poll time |
| `GET /api/results` | `x-admin-key` | Recent results |
| `GET /api/worker/next-task?workerId=` | `x-worker-token` | Claim the next task |
| `POST /api/worker/task-result` | `x-worker-token` | Report `success` / `fail` |
| `POST /api/draft-bid` | `x-worker-token` | Generate a bid |

## Known limits

- `success` means the submit button was clicked. The extension does not yet check whether Freelancer accepted the bid.
- Page selectors are best guesses and need checking against the live Freelancer bid form.
- Project text is read from the page DOM. OCR is not implemented.
