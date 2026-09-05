# 13115 Task Tracker API

Azure Functions backend for the FTC Team 13115 task tracker app.

## Endpoints

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Verify Google/Apple id token, create/fetch user |
| GET | `/api/tasks` | List all tasks |
| POST | `/api/tasks` | Create a task (assigned or open) |
| PATCH | `/api/tasks/{id}` | `claim`, `accept`, `decline` (reason required), or `complete` |
| GET | `/api/tasks/{id}/events` | Task history |
| POST | `/api/extension-requests` | Request a due-date extension |
| GET | `/api/extension-requests?status=pending` | List extension requests |
| PATCH | `/api/extension-requests/{id}` | Approve/deny an extension |
| GET | `/api/users` | List team members |
| PATCH | `/api/users/{id}` | Change a user's role |

## Local setup

1. `npm install`
2. Copy `local.settings.json.example` to `local.settings.json` and fill in:
   - `SQL_CONNECTION_STRING` — from your Azure SQL Database
   - `GOOGLE_CLIENT_ID` — from Google Cloud Console OAuth credentials
   - `APPLE_CLIENT_ID` — your app's bundle ID / Services ID for Sign in with Apple
3. Run `schema.sql` against your database once to create the tables.
4. Install [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local) and run `func start`.

## Deploying

Deploy to an Azure Function App (Consumption plan, free tier) via the Azure CLI, VS Code Azure Functions extension, or GitHub Actions.
