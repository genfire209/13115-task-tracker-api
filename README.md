# 13115 Task Tracker API

Express.js backend for the FTC Team 13115 task tracker app, hosted on
**Azure App Service (Free F1 tier)** and backed by an **Azure SQL Database
(Free tier)**.

Note: this runs on plain App Service rather than Azure Functions because
the "Azure for Students Starter" subscription this was built under blocks
the `Microsoft.Storage` provider entirely, and Azure Functions require a
storage account. App Service needs no storage account, so it works within
that restriction.

## Endpoints

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| POST | `/api/auth/login` | Verify Google/Apple id token, create/fetch user |
| GET | `/api/tasks` | List all tasks |
| POST | `/api/tasks` | Create a task (assigned or open) |
| PATCH | `/api/tasks/:id` | `claim`, `accept`, `decline` (reason required), or `complete` |
| GET | `/api/tasks/:id/events` | Task history |
| POST | `/api/extension-requests` | Request a due-date extension |
| GET | `/api/extension-requests?status=pending` | List extension requests |
| PATCH | `/api/extension-requests/:id` | Approve/deny an extension |
| GET | `/api/users` | List team members |
| PATCH | `/api/users/:id` | Change a user's role |
| GET | `/api/meets?season=2026` | Every NJ meet this season, ours flagged |
| GET | `/api/meets/:season/:code` | One meet: matches (teams, scores, estimated start times), rankings |
| GET | `/api/meets/active` | The meet in meet mode, and our next match |
| POST | `/api/meets/active` | Captain/admin: start meet mode (`{ season, eventCode }`) |
| DELETE | `/api/meets/active` | Captain/admin: end meet mode |

## Meet mode

While a captain/admin has a meet in meet mode, every approved member gets a
push ~10 and ~5 minutes before each 13115 match, and the result after it.
Published FTC schedule times are often placeholders, so start times are
estimated from the event's real progress (`src/meetAlerts.js`): nothing is
estimated until the first match has been played. The server checks every
minute; `.github/workflows/meet-tick.yml` pings `/api/cron/meet-tick` every
5 minutes as a backup and to keep the free-tier app awake. Admins can start
a test run (`testOnly`, optionally another `teamNumber`) whose alerts go only
to them. Its tables are created at startup if missing (`src/schema.js`).

## Authentication

`POST /api/auth/login` verifies the Google id token and returns the user plus
a `sessionToken` (HMAC-signed with `SESSION_SECRET`, valid 30 days). Every
other `/api` route except `/api/health` and the cron routes requires
`Authorization: Bearer <sessionToken>`, and the signed-in user is the only
identity the server uses - `actorId` / `requesterId` / `createdBy` in a
request are ignored. Who may do what is checked per route (see
`src/authenticate.js` and `canTakeAction` in `src/routes/tasks.js`).

A user's id is their email, so members see everyone else's id as a stable
`u_...` stand-in (`userIdsFor` in `src/authenticate.js`) and the roster's
`email` field is empty; captains and admins see real ids and emails.

`ALLOW_LEGACY_CLIENTS=true` lets app builds from before session tokens keep
working during a rollout; it reopens the old hole, so turn it off once
everyone has updated.

Forced updates (`src/appVersion.js`): the app sends its build number as
`X-App-Build`. An admin sets the oldest build still allowed from the app
(Profile → Required app version, i.e. `PUT /api/app-version`, never above
their own build); older builds - and tokenless pre-9 builds, which send no
build - then get 426 on everything except `/api/health`, `/api/cron` and
`GET /api/app-version`. Pre-9 builds can't show an update screen, so their
`GET /api/tasks` returns one "Update required" task instead.

`npm test` runs the server against an in-memory fake database and checks
these rules.

## Live deployment

- **Resource group**: `rg-13115-tasktracker` (Central US)
- **App Service**: `app-13115-tasktracker` — https://app-13115-tasktracker.azurewebsites.net (Free F1 plan)
- **SQL Server**: `sql-13115-tasktracker.database.windows.net`
- **Database**: `task_tracker` (Free tier, 5 DTU, 32MB storage cap)

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `SQL_CONNECTION_STRING`, `GOOGLE_CLIENT_ID`, `APPLE_CLIENT_ID`
3. `npm start`

## Deploying

```
az webapp deploy --resource-group rg-13115-tasktracker --name app-13115-tasktracker --src-path <zip> --type zip
```

Or connect this repo to the Web App's deployment center in the Azure Portal for git-based auto-deploy on push.
