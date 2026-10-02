export interface MarkingPeriod {
  /** Value HAC uses to select the period, e.g. "1-2027". */
  id: string;
  /** Label shown in HAC, e.g. "1". */
  label: string;
}

export interface Classwork {
  /** Id of the marking period the courses below are for. */
  markingPeriod: string | null;
  /** YYYY-MM-DD the page was read as of. HAC counts work due on or before this date. */
  asOf: string;
  markingPeriods: MarkingPeriod[];
  courses: Course[];
}

/** Course averages for one marking period, counting work due up to `asOf`. */
export interface GradeReport {
  markingPeriod: MarkingPeriod | null;
  /** YYYY-MM-DD */
  asOf: string;
  courses: CourseGrade[];
}

export interface CourseGrade {
  id: string;
  code: string;
  section: string;
  name: string;
  /** Overall average in percent, as HAC computes it. Null until something counts. */
  average: number | null;
  /** Null until work in the category counts. */
  formative: Category | null;
  summative: Category | null;
  /** Every category HAC averages for the course, with its weight. */
  categories: Category[];
  /** Assignments that are due with no score, counting as zero. */
  missing: number;
  /** YYYY-MM-DD */
  lastUpdated: string | null;
}

export interface Course {
  /** HAC's key for the course section, e.g. "3000101|1". */
  id: string;
  code: string;
  section: string;
  name: string;
  /** Average as HAC shows it in the course header (rounded). */
  average: number | null;
  /** Unrounded average from the category breakdown, when HAC shows one. */
  exactAverage: number | null;
  /** YYYY-MM-DD */
  lastUpdated: string | null;
  categories: Category[];
  assignments: Assignment[];
}

export interface Category {
  name: string;
  points: number | null;
  maxPoints: number | null;
  percent: number | null;
  weight: number | null;
  weightedPoints: number | null;
}

export interface Assignment {
  /** Section key plus HAC's assignment number, e.g. "3000101|1|3". */
  id: string;
  name: string;
  category: string;
  /** YYYY-MM-DD */
  dueDate: string | null;
  /** YYYY-MM-DD */
  assignedDate: string | null;
  /** Whether a numeric score has been entered. */
  graded: boolean;
  /** Whether HAC counts this assignment toward the average yet. It does from the due date on. */
  counted: boolean;
  /** Due with no score entered, so HAC counts it as zero against the average. */
  missing: boolean;
  score: number | null;
  /** The score cell as shown, which keeps non-numeric marks. Empty when ungraded. */
  rawScore: string;
  /** Null for extra credit, which adds points without adding to the maximum. */
  totalPoints: number | null;
  percent: number | null;
  /** HAC's multiplier for this assignment within its category, usually 1. */
  weight: number | null;
  weightedScore: number | null;
  weightedTotalPoints: number | null;
  /** Percent of its category's points this assignment accounts for. Null until it counts, and for extra credit. */
  weightInCategory: number | null;
  /** Percent of the course average this assignment accounts for. Null until it counts, and for extra credit. */
  weightInGrade: number | null;
  canBeDropped: boolean;
  extraCredit: boolean;
  hasAttachments: boolean;
}
