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
