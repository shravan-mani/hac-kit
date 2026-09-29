import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UnexpectedPageError } from '../src/errors.ts';
import { parseClasswork } from '../src/parsers/classwork.ts';
import { fixture } from './helpers.ts';

const classwork = parseClasswork(fixture('classwork.html'));
const [english, physics] = classwork.courses;

test('reads the marking periods', () => {
  assert.equal(classwork.markingPeriod, '1-2027');
  assert.deepEqual(classwork.markingPeriods, [
    { id: '1-2027', label: '1' },
    { id: '2-2027', label: '2' },
    { id: '3-2027', label: '3' },
    { id: '4-2027', label: '4' },
  ]);
});

test('reads each course header', () => {
  assert.equal(classwork.courses.length, 2);
  const { categories, assignments, ...header } = english;
  assert.deepEqual(header, {
    id: '3000101|1',
    code: '1001000',
    section: '4',
    name: 'English Literature',
    average: 87,
    exactAverage: 87.2,
    lastUpdated: '2026-09-08',
  });
});

test('reads category weights and skips the total row', () => {
  assert.deepEqual(english.categories, [
    { name: 'Formative Assessment', points: 27, maxPoints: 30, percent: 90, weight: 30, weightedPoints: 27 },
    { name: 'Summative Assessment', points: 86, maxPoints: 100, percent: 86, weight: 70, weightedPoints: 60.2 },
  ]);
});

test('reads assignments', () => {
  assert.equal(english.assignments.length, 3);
  assert.deepEqual(english.assignments[0], {
    id: '3000101|1|3',
    name: 'Essay 1',
    category: 'Summative Assessment',
    dueDate: '2026-09-04',
    assignedDate: '2026-09-02',
    score: 86,
    rawScore: '86.00',
    totalPoints: 100,
    weight: 1,
    weightedScore: 86,
    weightedTotalPoints: 100,
    percent: 86,
    canBeDropped: false,
    extraCredit: false,
    hasAttachments: true,
  });
});

test('keeps ungraded and extra credit assignments', () => {
  const [ungraded, bonus] = physics.assignments;

  assert.equal(ungraded.name, 'Unit 2 Test');
  assert.equal(ungraded.score, null);
  assert.equal(ungraded.rawScore, '');
  assert.equal(ungraded.percent, null);
  assert.equal(ungraded.totalPoints, 100);

  assert.equal(bonus.name, 'Bonus Video');
  assert.equal(bonus.score, 5);
  assert.equal(bonus.totalPoints, null);
  assert.equal(bonus.extraCredit, true);
});

test('rejects a page that is not the classwork page', () => {
  assert.throws(() => parseClasswork('<html><body><form></form></body></html>'), UnexpectedPageError);
});
