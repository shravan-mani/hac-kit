export class HacError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** HAC rejected the username or password. */
export class LoginError extends HacError {}

/** The session is no longer valid and there are no credentials to log in again with. */
export class SessionExpiredError extends HacError {}

/** A page is missing the structure a parser relies on, usually after a HAC update. */
export class UnexpectedPageError extends HacError {
  html: string;

  constructor(message: string, html: string) {
    super(message);
    this.html = html;
  }
}

/** Network failure, timeout, or an error status from HAC. */
export class HttpError extends HacError {
  status: number | undefined;

  constructor(message: string, status?: number, options?: ErrorOptions) {
    super(message, options);
    this.status = status;
  }
}
