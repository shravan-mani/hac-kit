import { CookieJar } from './cookies.ts';
import { HttpError } from './errors.ts';

export interface Page {
  /** URL the content came from. */
  url: string;
  status: number;
  html: string;
  /** Where the server redirected to, when redirects were not followed. */
  location?: string;
}

export interface ResponseInfo {
  method: string;
  url: string;
  status: number;
  ms: number;
  html: string;
}

export interface HttpOptions {
  /** Cookies from an earlier session. */
  cookies?: Record<string, string>;
  timeoutMs?: number;
  /** Replacement for the global fetch, e.g. in tests or other runtimes. */
  fetch?: typeof fetch;
  /** Called after every response, redirects included. */
  onResponse?: (info: ResponseInfo) => void;
}

export interface RequestOptions {
  form?: Record<string, string>;
  followRedirects?: boolean;
}

const MAX_REDIRECTS = 5;

/**
 * A cookie-keeping HTTP session against one origin. Redirects are followed here
 * rather than by fetch so that cookies set on intermediate responses, like the one
 * right after logging in, aren't lost.
 */
export class HttpSession {
  readonly cookies: CookieJar;
  readonly #origin: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #onResponse: ((info: ResponseInfo) => void) | undefined;

  constructor(baseUrl: string, options: HttpOptions = {}) {
    this.#origin = new URL(baseUrl).origin;
    this.cookies = new CookieJar(options.cookies);
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMs = options.timeoutMs ?? 20_000;
    this.#onResponse = options.onResponse;
  }

  get(url: string, followRedirects = true): Promise<Page> {
    return this.request('GET', url, { followRedirects });
  }

  post(url: string, form: Record<string, string>, followRedirects = true): Promise<Page> {
    return this.request('POST', url, { form, followRedirects });
  }

  async request(method: 'GET' | 'POST', url: string, options: RequestOptions = {}): Promise<Page> {
    const { followRedirects = true } = options;
    let form = options.form;
    let target = new URL(url, this.#origin);

    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const started = performance.now();
      const response = await this.#send(method, target, form);
      this.cookies.store(response.headers.getSetCookie());

      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        this.#onResponse?.({ method, url: target.href, status: response.status, ms: performance.now() - started, html: '' });
        const next = new URL(location, target);
        if (!followRedirects) return { url: target.href, status: response.status, html: '', location: next.href };
        if (response.status !== 307 && response.status !== 308) {
          method = 'GET';
          form = undefined;
        }
        target = next;
        continue;
      }

      let html: string;
      try {
        html = await response.text();
      } catch (error) {
        throw requestFailed(method, target, error);
      }
      this.#onResponse?.({ method, url: target.href, status: response.status, ms: performance.now() - started, html });
      if (!response.ok) throw new HttpError(`${method} ${target.pathname} returned ${response.status}`, response.status);
      return { url: target.href, status: response.status, html };
    }

    throw new HttpError(`Too many redirects from ${url}`);
  }

  async #send(method: string, url: URL, form: Record<string, string> | undefined): Promise<Response> {
    const cookie = this.cookies.header();
    try {
      return await this.#fetch(url, {
        method,
        headers: cookie ? { cookie } : {},
        body: form ? new URLSearchParams(form) : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      throw requestFailed(method, url, error);
    }
  }
}

function requestFailed(method: string, url: URL, error: unknown): HttpError {
  const reason = error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'failed';
  return new HttpError(`${method} ${url.pathname} ${reason}`, undefined, { cause: error });
}
