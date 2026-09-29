export interface MarkingPeriod {
  /** Value HAC uses to select the period, e.g. "1-2027". */
  id: string;
  /** Label shown in HAC, e.g. "1". */
  label: string;
}

export interface Classwork {
  /** Id of the marking period the courses below are for. */
  markingPeriod: string | null;
  markingPeriods: MarkingPeriod[];
  courses: Course[];
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
  score: number | null;
  /** The score cell as shown, which keeps non-numeric marks. Empty when ungraded. */
  rawScore: string;
  totalPoints: number | null;
  weight: number | null;
  weightedScore: number | null;
  weightedTotalPoints: number | null;
  percent: number | null;
  canBeDropped: boolean;
  extraCredit: boolean;
  hasAttachments: boolean;
}
