import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UnexpectedPageError } from '../src/errors.ts';
import { parseClasswork, parsePeriodChoices } from '../src/parsers/classwork.ts';
import type { Assignment } from '../src/types.ts';
import { fixture } from './helpers.ts';

// The fixture is a snapshot of 10 September: some work in it is past due, some isn't yet.
const classwork = parseClasswork(fixture('classwork.html'), '2026-09-10');
const [english, physics] = classwork.courses;
const byName = (assignments: Assignment[], name: string) => assignments.find((assignment) => assignment.name === name)!;

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
  assert.equal(english.assignments.length, 5);
  assert.deepEqual(byName(english.assignments, 'Essay 1'), {
    id: '3000101|1|3',
    name: 'Essay 1',
    category: 'Summative Assessment',
    dueDate: '2026-09-04',
    assignedDate: '2026-09-02',
    graded: true,
    counted: true,
    missing: false,
    score: 86,
    rawScore: '86.00',
    totalPoints: 100,
    percent: 86,
    weight: 1,
    weightedScore: 86,
    weightedTotalPoints: 100,
    weightInCategory: 100,
    weightInGrade: 70,
    canBeDropped: false,
    extraCredit: false,
    hasAttachments: true,
  });
});

test('keeps ungraded and extra credit assignments', () => {
  const ungraded = byName(physics.assignments, 'Unit 2 Test');
  assert.equal(ungraded.graded, false);
  assert.equal(ungraded.score, null);
  assert.equal(ungraded.rawScore, '');
  assert.equal(ungraded.percent, null);
  assert.equal(ungraded.totalPoints, 100);

  const bonus = byName(physics.assignments, 'Bonus Video');
  assert.equal(bonus.graded, true);
  assert.equal(bonus.score, 5);
  assert.equal(bonus.totalPoints, null);
  assert.equal(bonus.extraCredit, true);
});

test('counts work from its due date and weighs it the way HAC does', () => {
  const summary = ({ name, counted, missing, weightInCategory, weightInGrade }: Assignment) => ({
    name,
    counted,
    missing,
    weightInCategory,
    weightInGrade,
  });

  assert.deepEqual(english.assignments.map(summary), [
    // Graded already, but not due until the 30th, so it doesn't count yet.
    { name: 'Discussion Grade', counted: false, missing: false, weightInCategory: null, weightInGrade: null },
    // Weighted zero, so leaving it blank costs nothing.
    { name: 'Retest Raw', counted: true, missing: false, weightInCategory: null, weightInGrade: null },
    { name: 'Essay 1', counted: true, missing: false, weightInCategory: 100, weightInGrade: 70 },
    { name: 'Reading Quiz', counted: true, missing: false, weightInCategory: 33.33, weightInGrade: 10 },
    { name: 'Annotations', counted: true, missing: false, weightInCategory: 66.67, weightInGrade: 20 },
  ]);
  // Physics only has formative work counted so far, so that category is the whole average.
  assert.deepEqual(physics.assignments.map(summary), [
    { name: 'Unit 2 Test', counted: false, missing: false, weightInCategory: null, weightInGrade: null },
    { name: 'Homework 3', counted: true, missing: true, weightInCategory: 16.67, weightInGrade: 16.67 },
    { name: 'Bonus Video', counted: true, missing: false, weightInCategory: null, weightInGrade: null },
    { name: 'Lab Report', counted: true, missing: false, weightInCategory: 83.33, weightInGrade: 83.33 },
  ]);
});

test('reads the marking periods HAC offers when a run has more than one', () => {
  assert.deepEqual(parsePeriodChoices(fixture('period-choice.html')), [
    { value: '8/10/2026|12/18/2026', label: 'D1', start: '2026-08-10', end: '2026-12-18' },
    { value: '10/12/2026|12/18/2026', label: 'M2', start: '2026-10-12', end: '2026-12-18' },
  ]);
  assert.deepEqual(parsePeriodChoices(fixture('classwork.html')), []);
});

test('rejects a page that is not the classwork page', () => {
  assert.throws(() => parseClasswork('<html><body><form></form></body></html>'), UnexpectedPageError);
});
