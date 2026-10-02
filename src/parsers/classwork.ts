import { HTMLElement, parse } from 'node-html-parser';
import { UnexpectedPageError } from '../errors.ts';
import { applyGradingRules, currentDate } from '../grading.ts';
import type { Assignment, Category, Classwork, Course, MarkingPeriod } from '../types.ts';

export const MARKING_PERIOD_FIELD = 'ctl00$plnMain$ddlReportCardRuns';
export const REFRESH_VIEW_TARGET = 'ctl00$plnMain$btnRefreshView';
export const PERIOD_CHOICE_FIELD = 'ctl00$plnMain$ddlMarkingPeriods';
export const PERIOD_CHOICE_BUTTON = 'ctl00$plnMain$btnContinue';
const CLASS_FILTER_FIELD = 'ctl00$plnMain$ddlClasses';

export interface PeriodChoice {
  /** Value HAC expects back, e.g. "10/12/2026|12/18/2026". */
  value: string;
  label: string;
  /** YYYY-MM-DD */
  start: string | null;
  /** YYYY-MM-DD */
  end: string | null;
}

// Script and style bodies are never needed, and skipping them keeps parsing fast.
const PARSE_OPTIONS = { blockTextElements: { script: false, noscript: false, style: false, pre: true } };

/**
 * Parses HAC's Classwork page (Content/Student/Assignments.aspx). `today` (YYYY-MM-DD) decides
 * which assignments are due, since HAC only counts work toward the average from its due date on.
 */
export function parseClasswork(html: string, today = currentDate()): Classwork {
  const root = parse(html, PARSE_OPTIONS);
  const periodSelect = root.querySelector(`select[name="${MARKING_PERIOD_FIELD}"]`);
  if (!periodSelect) throw new UnexpectedPageError('Classwork page has no marking period selector', html);

  const options = periodSelect.querySelectorAll('option');
  const markingPeriods: MarkingPeriod[] = options
    .map((option) => ({ id: option.getAttribute('value') ?? '', label: clean(option.text) }))
    .filter((period) => period.id !== '' && period.id !== 'ALL');

  // The class filter's options pair each course heading with HAC's section key.
  const sectionKeys = new Map(
    root
      .querySelectorAll(`select[name="${CLASS_FILTER_FIELD}"] option`)
      .map((option): [string, string] => [clean(option.text), option.getAttribute('value') ?? '']),
  );

  return {
    markingPeriod: options.find((option) => option.hasAttribute('selected'))?.getAttribute('value') ?? null,
    asOf: today,
    markingPeriods,
    courses: root.querySelectorAll('.AssignmentClass').map((block) => parseCourse(block, sectionKeys, today)),
  };
}

/**
 * When a report card run covers more than one marking period, such as a quarter and a semester
 * that end together, HAC asks which one to show instead of rendering classwork. Returns the
 * options it offers, or an empty list when the page is classwork already.
 */
export function parsePeriodChoices(html: string): PeriodChoice[] {
  const select = parse(html, PARSE_OPTIONS).querySelector(`select[name="${PERIOD_CHOICE_FIELD}"]`);
  return (select?.querySelectorAll('option') ?? []).map((option) => {
    const value = option.getAttribute('value') ?? '';
    const [start = '', end = ''] = value.split('|');
    return { value, label: clean(option.text), start: isoDate(start), end: isoDate(end) };
  });
}

function parseCourse(block: HTMLElement, sectionKeys: Map<string, string>, today: string): Course {
  const heading = block.querySelector('a.sg-header-heading');
  const title = clean(heading?.text);
  // "1001000 - 4 English Literature" is course code, section, then name.
  const [, code = '', section = '', name = title] = /^(\S+)\s+-\s+(\S+)\s+(.+)$/.exec(title) ?? [];
  const categories = parseCategories(block.querySelector('table[id*="dgCourseCategories"]'));
  const assignments = parseAssignments(block.querySelector('table[id*="dgCourseAssignments"]'));

  return {
    id: sectionKeys.get(title) ?? callArguments(heading?.getAttribute('onclick'))[0] ?? '',
    code,
    section,
    name,
    average: toNumber(textOf(block, '[id*="lblHdrAverage"]').replace(/^Average/i, '')),
    exactAverage: toNumber(textOf(block, '[id*="lblOverallAverage"]')),
    lastUpdated: isoDate(textOf(block, '[id*="lblLastUpdDate"]')),
    categories,
    assignments: applyGradingRules(categories, assignments, today),
  };
}

function parseAssignments(table: HTMLElement | null): Assignment[] {
  return readGrid(table).map((row) => {
    const cell = (column: string) => clean(row.get(column)?.text);
    const link = row.get('assignment')?.querySelector('a');
    const details = link?.getAttribute('title') ?? '';
    const rawScore = cell('score');
    const score = toNumber(rawScore);

    return {
      id: callArguments(link?.getAttribute('onclick')).join('|'),
      name: clean(link?.text) || cell('assignment'),
      category: cell('category'),
      dueDate: isoDate(cell('date due')),
      assignedDate: isoDate(cell('date assigned')),
      graded: score !== null,
      // Filled in by applyGradingRules once the course's category totals are known.
      counted: false,
      missing: false,
      score,
      rawScore,
      totalPoints: toNumber(cell('total points')),
      percent: toNumber(cell('percentage')),
      weight: toNumber(cell('weight')),
      weightedScore: toNumber(cell('weighted score')),
      weightedTotalPoints: toNumber(cell('weighted total points')),
      weightInCategory: null,
      weightInGrade: null,
      canBeDropped: detail(details, 'Can Be Dropped') === 'Y',
      extraCredit: !['', 'N'].includes(detail(details, 'Extra Credit')),
      hasAttachments: detail(details, 'Has Attachments') === 'Y',
    };
  });
}

function parseCategories(table: HTMLElement | null): Category[] {
  return readGrid(table).map((row) => {
    const cell = (column: string) => clean(row.get(column)?.text);
    return {
      name: cell('category'),
      points: toNumber(cell('students points')),
      maxPoints: toNumber(cell('maximum points')),
      percent: toNumber(cell('percent')),
      weight: toNumber(cell('category weight')),
      weightedPoints: toNumber(cell('category points')),
    };
  });
}

/** Data rows of a HAC grid, each keyed by its column header. Summary rows are skipped. */
function readGrid(table: HTMLElement | null): Map<string, HTMLElement>[] {
  const headerRow = table?.querySelector('tr.sg-asp-table-header-row');
  if (!table || !headerRow) return [];
  const headers = cellsOf(headerRow).map((cell) => columnKey(cell.text));
  return table
    .querySelectorAll('tr.sg-asp-table-data-row')
    .map((row) => new Map(cellsOf(row).map((cell, i): [string, HTMLElement] => [headers[i] ?? '', cell])));
}

function cellsOf(row: HTMLElement): HTMLElement[] {
  return row.childNodes.filter((node): node is HTMLElement => node instanceof HTMLElement && node.tagName === 'TD');
}

// "/ Maximum Points" -> "maximum points", "Student's Points" -> "students points"
function columnKey(header: string): string {
  return header.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
}

// Assignment link titles hold details like "Can Be Dropped: Y\nExtra Credit: N".
function detail(title: string, label: string): string {
  return new RegExp(`${label}:\\s*(\\S*)`).exec(title)?.[1] ?? '';
}

// "OpenAssignmentPopUp('3000101', '1', '3'); return false;" -> ["3000101", "1", "3"]
function callArguments(onclick: string | undefined): string[] {
  const args = /\(([^)]*)\)/.exec(onclick ?? '')?.[1];
  return args ? args.split(',').map((arg) => arg.trim().replace(/^'|'$/g, '')) : [];
}

function textOf(root: HTMLElement, selector: string): string {
  return clean(root.querySelector(selector)?.text);
}

function clean(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function toNumber(value: string): number | null {
  const digits = value.replace(/[%,]/g, '').trim();
  return /^-?\d*\.?\d+$/.test(digits) ? Number(digits) : null;
}

// "9/8/2026" -> "2026-09-08"
function isoDate(value: string): string | null {
  const match = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(value);
  if (!match) return null;
  const [, month = '', day = '', year = ''] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}
