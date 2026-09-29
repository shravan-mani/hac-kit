import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HacClient } from '../src/client.ts';
import { LoginError, SessionExpiredError } from '../src/errors.ts';
import { fixture, withLoginError } from './helpers.ts';

const BASE_URL = 'https://hac.example.org';
const credentials = { username: 'student', password: 'correct horse' };
const loginPage = fixture('login.html');
const classworkPage = fixture('classwork.html');

const LOGIN = 'GET /HomeAccess/Account/LogOn';
const SUBMIT_LOGIN = 'POST /HomeAccess/Account/LogOn';
const CLASSWORK = 'GET /HomeAccess/Content/Student/Assignments.aspx';

/** Just enough of HAC's login and session behaviour to exercise the client. */
function fakeHac() {
  const sessions = new Set<string>();
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

      const session = `s${++issued}`;
      sessions.add(session);
      return new Response(null, {
        status: 302,
        headers: { location: '/HomeAccess/', 'set-cookie': `.AuthCookie=${session}; path=/; HttpOnly` },
      });
    }

    const session = /\.AuthCookie=(\w+)/.exec(cookies)?.[1];
    if (!session || !sessions.has(session)) {
      return new Response(null, { status: 302, headers: { location: '/HomeAccess/Account/LogOn?ReturnUrl=%2fHomeAccess%2f' } });
    }
    if (url.pathname === '/HomeAccess/Content/Student/Assignments.aspx') {
      const period = form.get('ctl00$plnMain$ddlReportCardRuns');
      return new Response(period ? selectPeriod(classworkPage, period) : classworkPage);
    }
    return new Response('Not found', { status: 404 });
  };

  return { fetch, requests, posts, expireSessions: () => sessions.clear() };
}

function selectPeriod(html: string, period: string): string {
  return html
    .replace('<option selected="selected" value="1-2027">', '<option value="1-2027">')
    .replace(`<option value="${period}">`, `<option selected="selected" value="${period}">`);
}

test('logs in and loads classwork in three requests', async () => {
  const hac = fakeHac();
  const client = new HacClient(BASE_URL, { credentials, fetch: hac.fetch });

  const classwork = await client.getClasswork();

  assert.equal(classwork.courses.length, 2);
  assert.deepEqual(hac.requests, [LOGIN, SUBMIT_LOGIN, CLASSWORK]);
});

test('reuses a saved session without logging in', async () => {
  const hac = fakeHac();
  const first = new HacClient(BASE_URL, { credentials, fetch: hac.fetch });
  await first.login();

  const client = new HacClient(BASE_URL, { cookies: first.cookies, fetch: hac.fetch });
  await client.getClasswork();

  assert.deepEqual(hac.requests.slice(2), [CLASSWORK]);
});

test('logs in again when the session has expired', async () => {
  const hac = fakeHac();
  const client = new HacClient(BASE_URL, { credentials, fetch: hac.fetch });
  await client.login();
  hac.expireSessions();

  await client.getClasswork();

  assert.deepEqual(hac.requests, [LOGIN, SUBMIT_LOGIN, CLASSWORK, LOGIN, SUBMIT_LOGIN, CLASSWORK]);
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
