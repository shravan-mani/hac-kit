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
node cli/hac.ts grades             # this quarter so far: average, formative and summative per class
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

const grades = await client.getGrades();       // this quarter, as of today
const classwork = await client.getClasswork(); // the same, with every assignment
const earlier = await client.getClasswork('1');
```

`credentials` can also be a function, which is only called when a login is actually needed. To reuse a session, pass `client.cookies` back in as `cookies`. What counts toward an average depends on the date, so pass `timeZone` (for example `America/New_York`) when running somewhere other than the district's time zone.

## Data

`getGrades()` returns the current marking period as of today, one entry per course:

```json
{
  "markingPeriod": { "id": "1-2027", "label": "1" },
  "asOf": "2026-09-10",
  "courses": [
    {
      "name": "English Literature",
      "average": 87.2,
      "formative": { "name": "Formative Assessment", "points": 27, "maxPoints": 30, "percent": 90, "weight": 30 },
      "summative": { "name": "Summative Assessment", "points": 86, "maxPoints": 100, "percent": 86, "weight": 70 },
      "missing": 0
    }
  ]
}
```

The numbers are HAC's own, so they match what the portal shows. `formative` or `summative` is null until work in that category is due. Course ids, codes and every category are in the full output.

`getClasswork()` returns the same courses with their assignments as well. One assignment looks like this:

```json
{
  "id": "3000101|1|3",
  "name": "Essay 1",
  "category": "Summative Assessment",
  "dueDate": "2026-09-04",
  "assignedDate": "2026-09-02",
  "graded": true,
  "counted": true,
  "missing": false,
  "score": 86,
  "rawScore": "86.00",
  "totalPoints": 100,
  "percent": 86,
  "weight": 1,
  "weightedScore": 86,
  "weightedTotalPoints": 100,
  "weightInCategory": 100,
  "weightInGrade": 70,
  "canBeDropped": false,
  "extraCredit": false,
  "hasAttachments": true
}
```

HAC counts an assignment toward the average from its due date on. From then, a blank score counts as zero, which is what `missing` flags, while work that isn't due yet doesn't count even if it's graded. Extra credit adds points without adding to the total.

`weight` is HAC's own multiplier for the assignment inside its category, usually 1. `weightInCategory` and `weightInGrade` are the percent of its category, and of the course average, that the assignment accounts for. Both are null until it counts, and for extra credit.

## How it works

| What | Requests |
| --- | --- |
| Log in | `GET` + `POST /HomeAccess/Account/LogOn`, then open `/HomeAccess/`, where HAC sets up the session |
| Grades and assignments | `GET /HomeAccess/Content/Student/Assignments.aspx` |
| Another marking period | `POST` back to the same page, as its Refresh View button does |
| A run that spans a quarter and a semester | HAC asks which to show, and the client answers with the quarter |

With a saved session, grades and assignments take a single request. If HAC sends the client back to the login page, it logs in again and retries once.

HAC remembers the marking period you last viewed for the whole login session, while a fresh login opens on the current one. After viewing another period the client switches back, so asking for the current period always means the current period.

## Development

```sh
npm test
npm run typecheck
node cli/hac.ts capture   # saves raw HAC responses to .hac/captures to check the parsers against
```
