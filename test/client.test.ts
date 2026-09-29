import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HacClient } from '../src/client.ts';
import { LoginError, SessionExpiredError, UnexpectedPageError } from '../src/errors.ts';
import { fixture, withLoginError } from './helpers.ts';

const BASE_URL = 'https://hac.example.org';
const credentials = { username: 'student', password: 'correct horse' };
const loginPage = fixture('login.html');
const classworkPage = fixture('classwork.html');
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
  const sessions = new Map<string, { ready: boolean }>();
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
      sessions.set(id, { ready: false });
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
        return new Response(period ? selectPeriod(classworkPage, period) : classworkPage);
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

  const classwork = await client.getClasswork('2');

  assert.equal(classwork.markingPeriod, '2-2027');
  const postback = hac.posts.at(-1);
  assert.equal(postback?.get('__EVENTTARGET'), 'ctl00$plnMain$btnRefreshView');
  assert.equal(postback?.get('__VIEWSTATE'), 'VIEWSTATE');
  assert.equal(postback?.get('ctl00$plnMain$ddlReportCardRuns'), '2-2027');
  assert.equal(postback?.get('ctl00$plnMain$ddlClasses'), 'ALL');
});

test('rejects an unknown marking period', async () => {
  const hac = fakeHac();
  const client = new HacClient(BASE_URL, { credentials, fetch: hac.fetch });

  await assert.rejects(client.getClasswork('9'), /Unknown marking period "9" \(available: 1, 2, 3, 4\)/);
});
