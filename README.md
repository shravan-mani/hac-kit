# hac-kit

A small client for PowerSchool's Home Access Center (HAC) that doesn't use a browser. It logs in with plain HTTP requests, fetches only the pages it needs, and parses HAC's server-rendered HTML into JSON, so the same code can run in a CLI, a serverless function, or a mobile app.

It currently covers grades and assignments.

## Setup

Requires Node 22.18 or newer, which runs the TypeScript sources directly.

```sh
npm install
cp .env.example .env
```

Then set `HAC_URL` in `.env` to your district's HAC address.

## CLI

```sh
node cli/hac.ts login              # asks for your HAC username and password
node cli/hac.ts grades
node cli/hac.ts assignments calc   # only courses whose name contains "calc"
node cli/hac.ts grades --mp 2 --json
```

The session cookie is kept in `.hac/session.json`, so later commands skip logging in. When it expires you're asked to log in again, or it happens automatically if `HAC_USERNAME` and `HAC_PASSWORD` are set in `.env`. Neither `.hac/` nor `.env` is committed.

## Library

```ts
import { HacClient } from './src/index.ts';

const client = new HacClient('https://hac.example.org', {
  credentials: { username, password },
});

const current = await client.getClasswork();
const earlier = await client.getClasswork('1');
```

`credentials` can also be a function, which is only called when a login is actually needed. To reuse a session, pass `client.cookies` back in as `cookies`.

## How it works

| What | Requests |
| --- | --- |
| Log in | `GET` + `POST /HomeAccess/Account/LogOn` |
| Grades and assignments | `GET /HomeAccess/Content/Student/Assignments.aspx` |
| Another marking period | `POST` back to the same page, as its Refresh View button does |

With a saved session, grades and assignments take a single request. If HAC sends the client back to the login page, it logs in again and retries once.

## Development

```sh
npm test
npm run typecheck
node cli/hac.ts capture   # saves raw HAC responses to .hac/captures to check the parsers against
```
