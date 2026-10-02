import { parse } from 'node-html-parser';
import { HacError, LoginError, SessionExpiredError, UnexpectedPageError } from './errors.ts';
import { formFields } from './forms.ts';
import { currentDate, summarizeGrades } from './grading.ts';
import { HttpSession, type HttpOptions, type Page } from './http.ts';
import {
  MARKING_PERIOD_FIELD,
  PERIOD_CHOICE_BUTTON,
  PERIOD_CHOICE_FIELD,
  REFRESH_VIEW_TARGET,
  parseClasswork,
  parsePeriodChoices,
} from './parsers/classwork.ts';
import { PASSWORD_FIELD, USERNAME_FIELD, parseLoginError, parseLoginForm } from './parsers/login.ts';
import type { Classwork, GradeReport } from './types.ts';

export interface Credentials {
  username: string;
  password: string;
}

export interface HacClientOptions extends HttpOptions {
  /**
   * Used to log in, and to log in again when the session expires. A function is
   * only called when a login is actually needed.
   */
  credentials?: Credentials | (() => Credentials | Promise<Credentials>);
  /**
   * The district's IANA time zone, e.g. "America/New_York". HAC counts assignments from their
   * due date on, so this decides what "today" is. Defaults to the local time zone.
   */
  timeZone?: string;
}

const HOME_PATH = '/HomeAccess/';
const LOGIN_PATH = '/HomeAccess/Account/LogOn?ReturnUrl=%2fHomeAccess%2f';
const CLASSWORK_PATH = '/HomeAccess/Content/Student/Assignments.aspx';

export class HacClient {
  readonly #http: HttpSession;
  readonly #timeZone: string | undefined;
  #credentials: HacClientOptions['credentials'];
  #loggedIn: boolean;

  constructor(baseUrl: string, options: HacClientOptions = {}) {
    this.#http = new HttpSession(baseUrl, options);
    this.#credentials = options.credentials;
    this.#timeZone = options.timeZone;
    this.#loggedIn = this.#http.cookies.size > 0;
  }

  /** Session cookies. Pass them back in as `options.cookies` to skip logging in next time. */
  get cookies(): Record<string, string> {
    return this.#http.cookies.toJSON();
  }

  async login(credentials?: Credentials): Promise<void> {
    if (credentials) this.#credentials = credentials;
    const { username, password } = await this.#resolveCredentials();

    const page = await this.#http.get(LOGIN_PATH);
    const form = parseLoginForm(page.html);
    const result = await this.#http.post(
      new URL(form.action || LOGIN_PATH, page.url).href,
      { ...form.fields, [USERNAME_FIELD]: username, [PASSWORD_FIELD]: password },
      false,
    );

    // A successful login redirects into the app; a failed one re-renders the form.
    if (!result.location || isLoginUrl(result.location)) {
      throw new LoginError(parseLoginError(result.html) ?? 'HAC did not accept the username or password');
    }
    // Follow that redirect the way a browser does. HAC sets up the student's session on its
    // landing page, and content pages answer with its error page until that has happened.
    await this.#http.get(result.location);
    this.#loggedIn = true;
  }

  /**
   * Grades and assignments for every course. `markingPeriod` can be an id ("2-2027")
   * or a label ("2"); the current period is used when it's left out.
   */
  getClasswork(markingPeriod?: string): Promise<Classwork> {
    return this.#authenticated(async () => {
      const page = await this.#openClasswork(await this.#load('GET', CLASSWORK_PATH));
      const classwork = this.#parseClasswork(page);
      if (!markingPeriod) return classwork;

      const period = classwork.markingPeriods.find(({ id, label }) => id === markingPeriod || label === markingPeriod);
      if (!period) {
        const available = classwork.markingPeriods.map(({ label }) => label).join(', ');
        throw new HacError(`Unknown marking period "${markingPeriod}" (available: ${available})`);
      }
      if (period.id === classwork.markingPeriod) return classwork;

      const switched = await this.#showPeriod(page, period.id);
      const requested = this.#parseClasswork(switched);

      // HAC remembers the marking period for the whole login session and opens on it next time,
      // while a fresh login opens on the current one. Put it back so that asking for the
      // current period keeps meaning the current period. If that fails, drop the session
      // rather than leave one that opens on the wrong period.
      if (classwork.markingPeriod) {
        try {
          await this.#showPeriod(switched, classwork.markingPeriod);
        } catch {
          this.#loggedIn = false;
        }
      }
      return requested;
    });
  }

  /**
   * Course averages with their formative and summative breakdown, counting work due up to
   * today. This is the current marking period unless `markingPeriod` says otherwise.
   */
  async getGrades(markingPeriod?: string): Promise<GradeReport> {
    return summarizeGrades(await this.getClasswork(markingPeriod));
  }

  async #resolveCredentials(): Promise<Credentials> {
    const source = this.#credentials;
    if (!source) throw new SessionExpiredError('Not logged in, and no credentials were provided');
    return typeof source === 'function' ? source() : source;
  }

  // Runs `operation` with a live session: logs in first if there isn't one, and once
  // more if HAC reports the session expired partway through.
  async #authenticated<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.#loggedIn) await this.login();
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof SessionExpiredError) || !this.#credentials) throw error;
      this.#loggedIn = false;
      await this.login();
      return operation();
    }
  }

  // Requests a page. A redirect to the login page means the session expired. HAC's error
  // page means the session state was lost while the login cookie still works; reopening
  // the home page rebuilds it, so that is tried once before giving up.
  async #load(method: 'GET' | 'POST', url: string, form?: Record<string, string>, reopened = false): Promise<Page> {
    const page = await this.#http.request(method, url, { form, followRedirects: false });
    if (page.location !== undefined) {
      if (isLoginUrl(page.location)) throw new SessionExpiredError('HAC session expired');
      return this.#http.get(page.location);
    }
    if (!isErrorPage(page.html)) return page;
    if (reopened) throw new UnexpectedPageError('HAC returned its error page', page.html);

    const home = await this.#http.get(HOME_PATH);
    if (isLoginUrl(home.url)) throw new SessionExpiredError('HAC session expired');
    return this.#load(method, url, form, true);
  }

  // The Refresh View button: reloads the classwork page for another marking period.
  async #showPeriod(page: Page, id: string): Promise<Page> {
    const switched = await this.#postBack(page, { __EVENTTARGET: REFRESH_VIEW_TARGET, [MARKING_PERIOD_FIELD]: id });
    return this.#openClasswork(switched);
  }

  // When a report card run covers more than one marking period, HAC asks which to show before
  // rendering any classwork. Answer with the quarter, which is the one that starts latest.
  async #openClasswork(page: Page): Promise<Page> {
    const choices = parsePeriodChoices(page.html);
    if (choices.length === 0) return page;
    const quarter = choices.reduce((latest, choice) => ((choice.start ?? '') > (latest.start ?? '') ? choice : latest));
    return this.#postBack(page, { [PERIOD_CHOICE_FIELD]: quarter.value, [PERIOD_CHOICE_BUTTON]: 'Continue' });
  }

  #parseClasswork(page: Page): Classwork {
    return parseClasswork(page.html, currentDate(this.#timeZone));
  }

  // Submits an ASP.NET WebForms postback the way the page itself would. Fields are collected
  // from the whole page because some of HAC's pages are malformed enough to lose the form element.
  #postBack(page: Page, overrides: Record<string, string>): Promise<Page> {
    const root = parse(page.html);
    const action = new URL(root.querySelector('form')?.getAttribute('action') ?? '', page.url).href;
    return this.#load('POST', action, { ...formFields(root), ...overrides });
  }
}

function isLoginUrl(url: string): boolean {
  return /\/Account\/LogOn/i.test(url);
}

function isErrorPage(html: string): boolean {
  return /<title>\s*Error\s*<\/title>/i.test(html);
}
