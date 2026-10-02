import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import {
  HacClient,
  HacError,
  UnexpectedPageError,
  checkCategoryTotals,
  parseClasswork,
  type Assignment,
  type Classwork,
  type Course,
  type Credentials,
  type GradeReport,
  type ResponseInfo,
} from '../src/index.ts';

const DATA_DIR = '.hac';
const SESSION_FILE = `${DATA_DIR}/session.json`;
const CAPTURE_DIR = `${DATA_DIR}/captures`;

const USAGE = `Usage: node cli/hac.ts <command> [options]

Commands:
  login                  Log in and save the session
  grades                 Course averages with formative and summative breakdown, as of today
  assignments [course]   Assignments, optionally only for courses whose name contains [course]
  capture                Log in from scratch and save every response to ${CAPTURE_DIR}

Options:
  --mp <period>   Marking period, e.g. 2 (default: current)
  --json          Print JSON
  --timing        Print each request to stderr`;

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    mp: { type: 'string' },
    json: { type: 'boolean', default: false },
    timing: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});
const [command, courseFilter] = positionals;

try {
  process.loadEnvFile();
} catch {
  // No .env file; use the environment as it is.
}
const baseUrl = process.env.HAC_URL ?? '';

if (flags.help || !command) {
  console.log(USAGE);
  process.exit(flags.help ? 0 : 1);
}
if (!baseUrl) fail('Set HAC_URL in .env (see .env.example).');

try {
  await run();
} catch (error) {
  if (error instanceof UnexpectedPageError) {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(`${DATA_DIR}/unexpected.html`, error.html);
    fail(`${error.message}. The page was saved to ${DATA_DIR}/unexpected.html.`);
  }
  if (error instanceof HacError) fail(error.message);
  throw error;
}

async function run(): Promise<void> {
  switch (command) {
    case 'login': {
      const client = createClient({ fresh: true });
      await client.login(envCredentials() ?? (await askCredentials()));
      saveSession(client);
      console.log('Logged in.');
      return;
    }
    case 'grades': {
      const report = await withSession((client) => client.getGrades(flags.mp));
      if (flags.json) printJson(report);
      else printGrades(report);
      return;
    }
    case 'assignments': {
      const { courses } = await withSession((client) => client.getClasswork(flags.mp));
      const filter = courseFilter?.toLowerCase();
      const matching = filter ? courses.filter((course) => course.name.toLowerCase().includes(filter)) : courses;
      if (flags.json) printJson(matching);
      else printAssignments(matching);
      return;
    }
    case 'capture':
      return capture();
    default:
      fail(`Unknown command "${command}".\n\n${USAGE}`);
  }
}

// Runs `fetch` with a client that picks up the saved session and saves it again afterwards.
async function withSession<T>(fetch: (client: HacClient) => Promise<T>): Promise<T> {
  const client = createClient();
  const result = await fetch(client);
  saveSession(client);
  return result;
}

// Logs in from scratch and saves every response, for checking the parsers against real pages.
async function capture(): Promise<void> {
  mkdirSync(CAPTURE_DIR, { recursive: true });
  let count = 0;
  let classworkHtml = '';
  const client = createClient({
    fresh: true,
    onResponse(info) {
      logResponse(info);
      const page = new URL(info.url).pathname.split('/').pop() || 'index';
      writeFileSync(`${CAPTURE_DIR}/${String(++count).padStart(2, '0')}-${info.method}-${page}.html`, info.html);
      if (page === 'Assignments.aspx' && info.html) classworkHtml = info.html;
    },
  });

  await client.login(envCredentials() ?? (await askCredentials()));
  const current = await client.getClasswork();
  summarize(current);
  for (const period of current.markingPeriods) {
    if (period.id !== current.markingPeriod) summarize(await client.getClasswork(period.id));
  }
  saveSession(client);

  const started = performance.now();
  parseClasswork(classworkHtml);
  console.error(`\nParsing one classwork page: ${(performance.now() - started).toFixed(1)} ms`);
  console.error(`Saved ${count} responses to ${CAPTURE_DIR}`);
}

function summarize({ markingPeriod, courses }: Classwork): void {
  const assignments = courses.reduce((total, course) => total + course.assignments.length, 0);
  const mismatches = courses.flatMap(checkCategoryTotals);
  const check = mismatches.length ? `${mismatches.length} category totals don't match HAC` : 'category totals match HAC';
  console.error(`  -> marking period ${markingPeriod}: ${courses.length} courses, ${assignments} assignments, ${check}`);
  for (const mismatch of mismatches) console.error(`     ${mismatch}`);
}

function createClient(options: { fresh?: boolean; onResponse?: (info: ResponseInfo) => void } = {}): HacClient {
  return new HacClient(baseUrl, {
    cookies: options.fresh ? undefined : loadSession(),
    credentials: envCredentials() ?? askCredentials,
    onResponse: options.onResponse ?? (flags.timing ? logResponse : undefined),
  });
}

function envCredentials(): Credentials | undefined {
  const { HAC_USERNAME: username, HAC_PASSWORD: password } = process.env;
  return username && password ? { username, password } : undefined;
}

async function askCredentials(): Promise<Credentials> {
  if (!process.stdin.isTTY) {
    fail('Not logged in. Run "node cli/hac.ts login" first, or set HAC_USERNAME and HAC_PASSWORD in .env.');
  }
  const username = await ask('HAC username: ');
  const password = await askHidden('HAC password: ');
  return { username, password };
}

async function ask(question: string): Promise<string> {
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await prompt.question(question)).trim();
  } finally {
    prompt.close();
  }
}

// Like ask(), but doesn't echo what's typed.
function askHidden(question: string): Promise<string> {
  const { stdin, stderr } = process;
  stderr.write(question);
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();

  return new Promise((resolve) => {
    let value = '';
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\u0003') process.exit(130); // Ctrl+C
        if (char === '\r' || char === '\n') {
          stdin.off('data', onData);
          stdin.setRawMode(false);
          stdin.pause();
          stderr.write('\n');
          resolve(value);
          return;
        }
        value = char === '\u007f' || char === '\b' ? value.slice(0, -1) : value + char;
      }
    };
    stdin.on('data', onData);
  });
}

function loadSession(): Record<string, string> | undefined {
  if (!existsSync(SESSION_FILE)) return undefined;
  const saved = JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as { url: string; cookies: Record<string, string> };
  return saved.url === baseUrl ? saved.cookies : undefined;
}

function saveSession(client: HacClient): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SESSION_FILE, `${JSON.stringify({ url: baseUrl, cookies: client.cookies }, null, 2)}\n`);
}

function printGrades({ markingPeriod, asOf, courses }: GradeReport): void {
  console.log(`Marking period ${markingPeriod?.label ?? '?'}, as of ${asOf}\n`);
  printTable([
    ['Course', 'Average', 'Formative', 'Summative', ''],
    ...courses.map((course) => [
      course.name,
      percentLabel(course.average) || '-',
      percentLabel(course.formative?.percent ?? null) || '-',
      percentLabel(course.summative?.percent ?? null) || '-',
      course.missing ? `${course.missing} missing` : '',
    ]),
  ]);
}

function printAssignments(courses: Course[]): void {
  for (const course of courses) {
    console.log(`\n${course.name}  ${formatNumber(course.exactAverage ?? course.average)}`);
    if (course.assignments.length === 0) {
      console.log('  No assignments');
      continue;
    }
    printTable(
      [
        ['Due', 'Assignment', 'Score', '%', 'Of grade', 'Category'],
        ...course.assignments.map((assignment) => [
          assignment.dueDate ?? '',
          assignment.name,
          scoreLabel(assignment),
          percentLabel(assignment.percent),
          percentLabel(assignment.weightInGrade),
          assignment.category,
        ]),
      ],
      '  ',
    );
  }
}

function scoreLabel({ graded, missing, score, rawScore, totalPoints }: Assignment): string {
  if (missing) return `missing, 0/${formatNumber(totalPoints)}`;
  if (!graded) return rawScore || 'not graded';
  const earned = formatNumber(score);
  return totalPoints === null ? `+${earned} extra` : `${earned}/${formatNumber(totalPoints)}`;
}

function percentLabel(value: number | null): string {
  return value === null ? '' : `${formatNumber(value)}%`;
}

function printTable(rows: string[][], indent = ''): void {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }
  for (const row of rows) {
    console.log(indent + row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i] ?? 0))).join('  '));
  }
}

function formatNumber(value: number | null): string {
  return value === null ? '' : String(Math.round(value * 100) / 100);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function logResponse({ method, url, status, ms, html }: ResponseInfo): void {
  const size = html ? `${Math.round(html.length / 1024)} KB` : '';
  console.error(`${method.padEnd(4)} ${status} ${`${Math.round(ms)} ms`.padStart(8)} ${size.padStart(7)}  ${new URL(url).pathname}`);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
