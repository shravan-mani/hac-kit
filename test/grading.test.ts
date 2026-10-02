import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkCategoryTotals, summarizeGrades } from '../src/grading.ts';
import { parseClasswork } from '../src/parsers/classwork.ts';
import { fixture } from './helpers.ts';

const classwork = parseClasswork(fixture('classwork.html'), '2026-09-10');
const { courses } = classwork;
const [english] = courses;

test('category totals match the assignments that make them up', () => {
  assert.deepEqual(courses.flatMap(checkCategoryTotals), []);
});

test('summarizes each course by formative and summative average', () => {
  const report = summarizeGrades(classwork);

  assert.deepEqual(report.markingPeriod, { id: '1-2027', label: '1' });
  assert.equal(report.asOf, '2026-09-10');
  assert.deepEqual(
    report.courses.map(({ name, average, formative, summative, missing }) => ({
      name,
      average,
      formative: formative?.percent ?? null,
      summative: summative?.percent ?? null,
      missing,
    })),
    [
      { name: 'English Literature', average: 87.2, formative: 90, summative: 86, missing: 0 },
      // Nothing summative has counted yet, and one homework is due with no score.
      { name: 'Physics', average: 83.33, formative: 83.333, summative: null, missing: 1 },
    ],
  );
});

test('reports a category total the assignments do not explain', () => {
  const categories = english.categories.map((category) =>
    category.name === 'Formative Assessment' ? { ...category, maxPoints: 40 } : category,
  );

  assert.deepEqual(checkCategoryTotals({ ...english, categories }), [
    'English Literature / Formative Assessment: assignments add up to 27/30, HAC shows 27/40',
  ]);
});
