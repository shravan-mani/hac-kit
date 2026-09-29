/**
 * Minimal cookie jar for a single host. Domain and Path are ignored because every
 * request goes to the same HAC origin under /HomeAccess.
 */
export class CookieJar {
  #cookies = new Map<string, string>();

  constructor(initial: Record<string, string> = {}) {
    for (const [name, value] of Object.entries(initial)) this.#cookies.set(name, value);
  }

  get size(): number {
    return this.#cookies.size;
  }

  store(setCookieHeaders: string[]): void {
    for (const header of setCookieHeaders) {
      const [pair = '', ...attributes] = header.split(';');
      const eq = pair.indexOf('=');
      if (eq < 1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === '' || isExpired(attributes)) this.#cookies.delete(name);
      else this.#cookies.set(name, value);
    }
  }

  header(): string {
    return Array.from(this.#cookies, ([name, value]) => `${name}=${value}`).join('; ');
  }

  toJSON(): Record<string, string> {
    return Object.fromEntries(this.#cookies);
  }
}

function isExpired(attributes: string[]): boolean {
  for (const attribute of attributes) {
    const eq = attribute.indexOf('=');
    if (eq < 0) continue;
    const key = attribute.slice(0, eq).trim().toLowerCase();
    const value = attribute.slice(eq + 1).trim();
    if (key === 'max-age' && Number(value) <= 0) return true;
    if (key === 'expires' && Date.parse(value) < Date.now()) return true;
  }
  return false;
}
