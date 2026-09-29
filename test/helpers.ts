import { readFileSync } from 'node:fs';

export function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

const EMPTY_SUMMARY = '<div class="sg-login-text-left sg-login-validation-summary"></div>';

/** The login page with an error message in its validation summary. */
export function withLoginError(loginPage: string, message: string): string {
  return loginPage.replace(EMPTY_SUMMARY, EMPTY_SUMMARY.replace('</div>', `<ul><li>${message}</li></ul></div>`));
}
