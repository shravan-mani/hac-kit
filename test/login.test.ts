import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLoginError, parseLoginForm } from '../src/parsers/login.ts';
import { fixture, withLoginError } from './helpers.ts';

const loginPage = fixture('login.html');

test('collects the login fields a browser would send', () => {
  assert.deepEqual(parseLoginForm(loginPage), {
    action: '/HomeAccess/Account/LogOn?ReturnUrl=%2fHomeAccess%2f',
    fields: {
      __RequestVerificationToken: 'TOKEN',
      Type: 'Normal',
      LocalLogin: 'False',
      SiteCode: '',
      SCKTY00328510CustomEnabled: 'False',
      SCKTY00436568CustomEnabled: 'False',
      Database: '10',
      VerificationOption: 'UsernamePassword',
      'LogOnDetails.UserName': '',
      tempUN: '',
      tempPW: '',
      'LogOnDetails.Password': '',
      login: '',
    },
  });
});

test('finds the error message after a failed login', () => {
  assert.equal(parseLoginError(loginPage), null);
  assert.equal(parseLoginError(withLoginError(loginPage, 'Invalid user name or password.')), 'Invalid user name or password.');
});
