import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CookieJar } from '../src/cookies.ts';

test('stores and replaces cookies', () => {
  const jar = new CookieJar();
  jar.store(['a=1; path=/', 'token=abc==; HttpOnly']);
  jar.store(['a=2']);
  assert.equal(jar.header(), 'a=2; token=abc==');
});

test('drops cookies the server expires', () => {
  const jar = new CookieJar({ a: '1', b: '2', c: '3' });
  jar.store(['a=; expires=Mon, 11-Oct-1999 00:00:00 GMT', 'b=x; Max-Age=0']);
  assert.deepEqual(jar.toJSON(), { c: '3' });
});
