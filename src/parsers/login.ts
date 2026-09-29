import { parse } from 'node-html-parser';
import { UnexpectedPageError } from '../errors.ts';
import { formFields } from '../forms.ts';

export const USERNAME_FIELD = 'LogOnDetails.UserName';
export const PASSWORD_FIELD = 'LogOnDetails.Password';

export interface LoginForm {
  action: string;
  fields: Record<string, string>;
}

export function parseLoginForm(html: string): LoginForm {
  const form = parse(html).querySelector(`input[name="${USERNAME_FIELD}"]`)?.closest('form');
  if (!form) throw new UnexpectedPageError('Login form not found', html);
  const submitter = form.querySelector('button[type="submit"], input[type="submit"]');
  return { action: form.getAttribute('action') ?? '', fields: formFields(form, submitter) };
}

/** The message HAC shows above the login form after a failed attempt, if any. */
export function parseLoginError(html: string): string | null {
  const summary = parse(html).querySelector('.sg-login-validation-summary, .validation-summary-errors');
  return summary?.text.replace(/\s+/g, ' ').trim() || null;
}
