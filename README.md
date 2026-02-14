# GitHub User Email Scraper

Fetches GitHub user emails (from profile or commit history) using the GitHub API and saves results to a JSON file.

## Setup

1. Copy `.env.example` to `.env`.
2. Set at least one GitHub personal access token:
   - `GITHUB_TOKENS=token1,token2` (comma-separated for rate-limit rotation), or
   - `GITHUB_PERSONAL_ACCESS_TOKEN=token`
3. Install dependencies: `npm install`

**Windows + Git Bash:** If you see `stdout is not a tty`, run with `command node index.js ...` or use PowerShell/cmd.

## Usage

**With parameters** (CLI overrides .env):

```bash
node index.js <startPage> <endPage> [query]
```

- **startPage / endPage**: Pagination (e.g. `1` to `5`).
- **query**: Search query. If you pass it on the command line, it is used instead of `QUERY` in `.env`.

**With no parameters** (uses .env only):

```bash
node index.js
```

Uses `QUERY`, and optionally `START_PAGE` and `END_PAGE` from `.env` (default pages 1–1).

### Examples

```bash
# CLI query (use quotes on Windows if query contains >)
node index.js 1 3 "language:python repos:>1"
node index.js 1 1 "location:Berlin"

# No args: uses QUERY (and START_PAGE, END_PAGE) from .env
node index.js
```

Output is written to `data/users.json` (or `OUTPUT_PATH` from `.env`). Existing entries are kept; new users are appended. Re-running with the same pages skips usernames already in the file.

## Output format

Each item in the JSON array looks like:

```json
{
  "username": "octocat",
  "fullName": "The Octocat",
  "email": "user@example.com",
  "location": "San Francisco",
  "mostStarredRepo": { "name": "repo-name", "stars": 100 },
  "mostForkedRepo": { "name": "repo-name", "forks": 50 },
  "isEmailFromCommit": false,
  "query": "language:javascript",
  "pageNum": 1,
  "pageSize": 20,
  "scrapedAt": "2025-02-14T12:00:00.000Z"
}
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKENS` | Comma-separated tokens (used in rotation) |
| `GITHUB_PERSONAL_ACCESS_TOKEN` | Single token (alternative to `GITHUB_TOKENS`) |
| `QUERY` | Default search query when none given on CLI |
| `START_PAGE` | Default start page when running with no args (default: 1) |
| `END_PAGE` | Default end page when running with no args (default: 1) |
| `OUTPUT_PATH` | JSON output path (default: `data/users.json`) |
