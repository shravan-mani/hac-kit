import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HacClient } from '../src/client.ts';
import { LoginError, SessionExpiredError, UnexpectedPageError } from '../src/errors.ts';
import { fixture, withLoginError } from './helpers.ts';

const BASE_URL = 'https://hac.example.org';
const credentials = { username: 'student', password: 'correct horse' };
const loginPage = fixture('login.html');
const classworkPage = fixture('classwork.html');
const periodChoicePage = fixture('period-choice.html');
const errorPage = fixture('error.html');

const LOGIN = 'GET /HomeAccess/Account/LogOn';
const SUBMIT_LOGIN = 'POST /HomeAccess/Account/LogOn';
const HOME = 'GET /HomeAccess/';
const WEEK_VIEW = 'GET /HomeAccess/Home/WeekView';
const CLASSWORK = 'GET /HomeAccess/Content/Student/Assignments.aspx';

/**
 * Just enough of HAC's behaviour to exercise the client: a login cookie, session state
 * that is only set up once the landing page has been opened, and HAC's error page for
 * content requested before that.
 */
function fakeHac({ classworkAlwaysFails = false } = {}) {
  // HAC remembers the marking period per session. A fresh login opens on the current one, 1.
  const sessions = new Map<string, { ready: boolean; period: string; choosing?: string }>();
  const requests: string[] = [];
  const posts: URLSearchParams[] = [];
  let issued = 0;

  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init.method ?? 'GET';
    const cookies = new Headers(init.headers).get('cookie') ?? '';
    const form = new URLSearchParams(init.body instanceof URLSearchParams ? init.body : undefined);
    requests.push(`${method} ${url.pathname}`);
    if (method === 'POST') posts.push(form);

    if (url.pathname === '/HomeAccess/Account/LogOn') {
      if (method === 'GET') {
        return new Response(loginPage, { headers: { 'set-cookie': 'antiforgery=a1; path=/HomeAccess; HttpOnly' } });
      }
      const accepted =
        cookies.includes('antiforgery=a1') &&
        form.get('__RequestVerificationToken') === 'TOKEN' &&
        form.get('LogOnDetails.UserName') === credentials.username &&
        form.get('LogOnDetails.Password') === credentials.password;
      if (!accepted) return new Response(withLoginError(loginPage, 'Invalid user name or password.'));

      const id = `s${++issued}`;
      sessions.set(id, { ready: false, period: '1-2027' });
      return redirect('/HomeAccess/', `.AuthCookie=${id}; path=/; HttpOnly`);
    }

    const session = sessions.get(/\.AuthCookie=(\w+)/.exec(cookies)?.[1] ?? '');
    if (!session) return redirect('/HomeAccess/Account/LogOn?ReturnUrl=%2fHomeAccess%2f');

    switch (url.pathname) {
      case '/HomeAccess/':
        return redirect('/HomeAccess/Home/WeekView');
      case '/HomeAccess/Home/WeekView':
        session.ready = true;
        return new Response('<!DOCTYPE html><title>Home View Summary</title>');
      case '/HomeAccess/Content/Student/Assignments.aspx': {
        if (!session.ready || classworkAlwaysFails) return new Response(errorPage);
        const period = form.get('ctl00$plnMain$ddlReportCardRuns');
        if (form.get('ctl00$plnMain$btnContinue') === 'Continue') {
          session.period = session.choosing ?? session.period;
        } else if (period === '2-2027') {
          // Run 2 covers a quarter and a semester, so HAC asks which one to show first.
          session.choosing = period;
          return new Response(periodChoicePage);
        } else if (period) {
          session.period = period;
        }
        return new Response(selectPeriod(classworkPage, session.period));
      }
      default:
        return new Response('Not found', { status: 404 });
    }
  };

  return {
    fetch,
    requests,
    posts,
    /** Logs everyone out, as when HAC's login cookie expires. */
    expireSessions() {
      sessions.clear();
    },
    /** Drops the server-side session state but keeps logins valid. */
    loseSessionState() {
      for (const session of sessions.values()) session.ready = false;
    },
  };
}

/** The classwork page's form submissions, in order, without the login. */
function postbacks(hac: ReturnType<typeof fakeHac>): URLSearchParams[] {
  return hac.posts.filter((form) => form.has('__EVENTTARGET'));
}

function redirect(location: string, setCookie?: string): Response {
  const headers: Record<string, string> = { location };
  if (setCookie) headers['set-cookie'] = setCookie;
  return new Response(null, { status: 302, headers });
}

function selectPeriod(html: string, period: string): string {
  return html
    .replace('<option selected="selected" value="1-2027">', '<option value="1-2027">')
    .replace(`<option value="${period}">`, `<option selected="selected" value="${period}">`);
}

test('logs in, opens the landing page like a browser, then loads classwork', async () => {
  const hac = fakeHac();
  const client = new HacClient(BASE_URL, { credentials, fetch: hac.fetch });

  const classwork = await client.getClasswork();

  assert.equal(classwork.courses.length, 2);
  assert.deepEqual(hac.requests, [LOGIN, SUBMIT_LOGIN, HOME, WEEK_VIEW, CLASSWORK]);
});

test('gets the quarter summary with the date it is as of', async () => {
  const hac = fakeHac();
  const client = new HacClient(BASE_URL, { credentials, fetch: hac.fetch });

  const report = await client.getGrades();

  assert.match(report.asOf, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(report.markingPeriod?.label, '1');
  assert.deepEqual(report.courses.map((course) => course.name), ['English Literature', 'Physics']);
});

test('reuses a saved session without logging in', async () => {
  const hac = fakeHac();
  const first = new HacClient(BASE_URL, { credentials, fetch: hac.fetch });
  await first.login();
  const before = hac.requests.length;

  const client = new HacClient(BASE_URL, { cookies: first.cookies, fetch: hac.fetch });
  await client.getClasswork();

  assert.deepEqual(hac.requests.slice(before), [CLASSWORK]);
});

test('logs in again when the session has expired', async () => {
  const hac = fakeHac();
  const client = new HacClient(BASE_URL, { credentials, fetch: hac.fetch });
  await client.login();
  hac.expireSessions();
  const before = hac.requests.length;

  await client.getClasswork();

  assert.deepEqual(hac.requests.slice(before), [CLASSWORK, LOGIN, SUBMIT_LOGIN, HOME, WEEK_VIEW, CLASSWORK]);
});

test('rebuilds lost session state without logging in again', async () => {
  const hac = fakeHac();
  const first = new HacClient(BASE_URL, { credentials, fetch: hac.fetch });
  await first.login();
  hac.loseSessionState();
  const before = hac.requests.length;

  const client = new HacClient(BASE_URL, { cookies: first.cookies, fetch: hac.fetch });
  const classwork = await client.getClasswork();

  assert.equal(classwork.courses.length, 2);
  assert.deepEqual(hac.requests.slice(before), [CLASSWORK, HOME, WEEK_VIEW, CLASSWORK]);
});

test('gives up with the page when HAC keeps returning its error page', async () => {
  const hac = fakeHac({ classworkAlwaysFails: true });
  const client = new HacClient(BASE_URL, { credentials, fetch: hac.fetch });

  await assert.rejects(client.getClasswork(), UnexpectedPageError);
  assert.deepEqual(hac.requests.slice(-4), [CLASSWORK, HOME, WEEK_VIEW, CLASSWORK]);
});

test('only asks for credentials when a login is needed', async () => {
  const hac = fakeHac();
  const first = new HacClient(BASE_URL, { credentials, fetch: hac.fetch });
  await first.login();
  let asked = 0;
  const client = new HacClient(BASE_URL, {
    cookies: first.cookies,
    fetch: hac.fetch,
    credentials: () => {
      asked++;
      return credentials;
    },
  });

  await client.getClasswork();
  assert.equal(asked, 0);

  hac.expireSessions();
  await client.getClasswork();
  assert.equal(asked, 1);
});

test('rejects a wrong password with the message HAC shows', async () => {
  const hac = fakeHac();
  const client = new HacClient(BASE_URL, { credentials: { ...credentials, password: 'wrong' }, fetch: hac.fetch });

  await assert.rejects(client.getClasswork(), { name: 'LoginError', message: 'Invalid user name or password.' });
  await assert.rejects(client.login(), LoginError);
});

test('reports an expired session when there are no credentials', async () => {
  const hac = fakeHac();
  const first = new HacClient(BASE_URL, { credentials, fetch: hac.fetch });
  await first.login();
  hac.expireSessions();

  const client = new HacClient(BASE_URL, { cookies: first.cookies, fetch: hac.fetch });

  await assert.rejects(client.getClasswork(), SessionExpiredError);
});

test('switches marking period with a postback', async () => {
  const hac = fakeHac();
  const client = new HacClient(BASE_URL, { credentials, fetch: hac.fetch });

  const classwork = await client.getClasswork('3');

  assert.equal(classwork.markingPeriod, '3-2027');
  const [postback] = postbacks(hac);
  assert.equal(postback.get('__EVENTTARGET'), 'ctl00$plnMain$btnRefreshView');
  assert.equal(postback.get('__VIEWSTATE'), 'VIEWSTATE');
  assert.equal(postback.get('ctl00$plnMain$ddlReportCardRuns'), '3-2027');
  assert.equal(postback.get('ctl00$plnMain$ddlClasses'), 'ALL');
});

test('leaves the session on the current marking period after viewing another', async () => {
  const hac = fakeHac();
  const client = new HacClient(BASE_URL, { credentials, fetch: hac.fetch });

  assert.equal((await client.getClasswork('3')).markingPeriod, '3-2027');
  assert.equal((await client.getClasswork('2')).markingPeriod, '2-2027');

  assert.equal((await client.getClasswork()).markingPeriod, '1-2027');
  assert.equal((await client.getGrades()).markingPeriod?.label, '1');
});

test('drops the session when it cannot be put back on the current marking period', async () => {
  const hac = fakeHac();
  const client = new HacClient(BASE_URL, { credentials, fetch: hac.fetch });
  await client.getClasswork();

  // The restore is the second postback of the switch. Let the first one through, then fail.
  let postbacks = 0;
  const flaky: typeof fetch = async (input, init) => {
    if (init?.body instanceof URLSearchParams && init.body.has('__EVENTTARGET') && ++postbacks === 2) {
      throw new Error('connection reset');
    }
    return hac.fetch(input, init);
  };
  const unlucky = new HacClient(BASE_URL, { cookies: client.cookies, credentials, fetch: flaky });

  assert.equal((await unlucky.getClasswork('3')).markingPeriod, '3-2027');
  const before = hac.requests.length;
  assert.equal((await unlucky.getClasswork()).markingPeriod, '1-2027');
  assert.deepEqual(hac.requests.slice(before, before + 2), [LOGIN, SUBMIT_LOGIN]);
});

test("answers HAC's marking period question with the quarter", async () => {
  const hac = fakeHac();
  const client = new HacClient(BASE_URL, { credentials, fetch: hac.fetch });

  const classwork = await client.getClasswork('2');

  assert.equal(classwork.markingPeriod, '2-2027');
  const [refresh, choice] = postbacks(hac);
  assert.equal(refresh.get('ctl00$plnMain$ddlReportCardRuns'), '2-2027');
  assert.equal(choice.get('ctl00$plnMain$ddlMarkingPeriods'), '10/12/2026|12/18/2026');
  assert.equal(choice.get('ctl00$plnMain$btnContinue'), 'Continue');
  assert.equal(choice.get('__EVENTTARGET'), '');
  assert.equal(choice.get('__VIEWSTATE'), 'CHOICE_VIEWSTATE');
});

test('rejects an unknown marking period', async () => {
  const hac = fakeHac();
  const client = new HacClient(BASE_URL, { credentials, fetch: hac.fetch });

  await assert.rejects(client.getClasswork('9'), /Unknown marking period "9" \(available: 1, 2, 3, 4\)/);
});
