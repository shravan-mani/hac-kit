import type { Assignment, Category, Classwork, Course, GradeReport } from './types.ts';

// How HAC averages a course, as checked against its own category totals:
// - Every assignment due on or before today counts, and a blank score counts as zero. Work
//   that isn't due yet doesn't count, even if it's already graded.
// - Extra credit adds its points without adding to the maximum.
// - A category's average is its weighted points over its weighted maximum, and the course
//   average combines the categories that have counted work in proportion to their weights.

/** Marks which assignments count as of `today` (YYYY-MM-DD) and how much each one weighs. */
export function applyGradingRules(categories: Category[], assignments: Assignment[], today: string): Assignment[] {
  const byName = new Map(categories.map((category): [string, Category] => [category.name, category]));
  const totalWeight = categories.reduce((total, category) => total + (category.weight ?? 0), 0);

  return assignments.map((assignment) => {
    const counted = isCounted(assignment, today);
    const category = byName.get(assignment.category);
    const share = counted && category?.maxPoints ? maxPoints(assignment) / category.maxPoints : 0;
    return {
      ...assignment,
      counted,
      // Zero-weight rows (like raw retest scores) and extra credit cost nothing when blank.
      missing: counted && !assignment.graded && maxPoints(assignment) > 0,
      weightInCategory: share ? round(share * 100) : null,
      weightInGrade: share && category?.weight && totalWeight ? round((share * category.weight * 100) / totalWeight) : null,
    };
  });
}

/**
 * Compares each category total HAC shows with what its assignments add up to under the rules
 * above. A mismatch means HAC counted something differently, such as a dropped score.
 */
export function checkCategoryTotals(course: Course): string[] {
  return course.categories.flatMap((category) => {
    const counted = course.assignments.filter((assignment) => assignment.counted && assignment.category === category.name);
    const points = sum(counted.map(earnedPoints));
    const max = sum(counted.map(maxPoints));
    if (isClose(points, category.points) && isClose(max, category.maxPoints)) return [];
    return [
      `${course.name} / ${category.name}: assignments add up to ${round(points)}/${round(max)}, ` +
        `HAC shows ${category.points}/${category.maxPoints}`,
    ];
  });
}

/** Each course's average and its formative and summative averages, from HAC's own category totals. */
export function summarizeGrades(classwork: Classwork): GradeReport {
  return {
    markingPeriod: classwork.markingPeriods.find(({ id }) => id === classwork.markingPeriod) ?? null,
    asOf: classwork.asOf,
    courses: classwork.courses.map((course) => ({
      id: course.id,
      code: course.code,
      section: course.section,
      name: course.name,
      average: course.exactAverage ?? course.average,
      formative: findCategory(course.categories, /formative/i),
      summative: findCategory(course.categories, /summative/i),
      categories: course.categories,
      missing: course.assignments.filter((assignment) => assignment.missing).length,
      lastUpdated: course.lastUpdated,
    })),
  };
}

function findCategory(categories: Category[], name: RegExp): Category | null {
  return categories.find((category) => name.test(category.name)) ?? null;
}

/** Today's date as YYYY-MM-DD in an IANA time zone, or the local one. */
export function currentDate(timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(
    new Date(),
  );
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function isCounted({ dueDate, graded }: Assignment, today: string): boolean {
  return dueDate === null ? graded : dueDate <= today;
}

// Extra credit rows have no weighted score, only the raw one.
function earnedPoints({ weightedScore, score, weight }: Assignment): number {
  return weightedScore ?? (score ?? 0) * (weight ?? 1);
}

function maxPoints({ extraCredit, totalPoints, weightedTotalPoints }: Assignment): number {
  return extraCredit || totalPoints === null ? 0 : (weightedTotalPoints ?? 0);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function isClose(value: number, expected: number | null): boolean {
  return expected !== null && Math.abs(value - expected) < 0.01;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
