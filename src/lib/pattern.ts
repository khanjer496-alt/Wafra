/**
 * The personal pattern: a small mosaic made from what the person told Wafra
 * during onboarding. It is decoration with a meaning, never a chart:
 *
 * - it is built ONLY from the name's initial, the chosen goals, the watched
 *   categories (the categories that have a monthly limit) and whether
 *   reminders have something to remind about;
 * - it never receives money. `PatternInput` has no amount field, and a
 *   budget's limit is dropped before this module sees it — changing a limit
 *   can never change the picture (scripts/test/repair/pattern.test.cjs);
 * - no bank tiles. A bank's colours would say which bank the person uses.
 *
 * Composition follows the approved boards (boards_e.py: M_NAME, M_GOALS,
 * M_WATCH, M_REMIND) on a 6 × 2 grid. Every answer owns fixed cells, so the
 * same answers always draw the same pattern in any order, and a missing
 * answer leaves its cell empty rather than inventing one.
 *
 * It appears only on onboarding, Home's header, the lock screen and the
 * recap cover. Pure: no React, no platform, no store.
 */
import type { PatternColor } from '@/constants/theme';
import type { AppState, CategoryId, GoalId } from '@/lib/types';

export type PatternKind = 'square' | 'circle' | 'quarter' | 'half' | 'ring' | 'dot' | 'bars' | 'glyph' | 'letter';
export type PatternGroup = 'name' | 'goals' | 'watch' | 'remind';

export interface PatternTile {
  /** Stable identity: `${group}:${what}`. */
  key: string;
  group: PatternGroup;
  kind: PatternKind;
  /** 0-based cell, column 0 at the reading start (mirrors under RTL). */
  col: number;
  row: number;
  /** The shape, or the ground of a glyph/letter tile. */
  color: PatternColor;
  /** The glyph's or letter's colour on its ground. */
  mark?: PatternColor;
  /** Quarter shapes turn in right angles. */
  rotation?: 0 | 90 | 180 | 270;
  /** A category glyph tile draws this category's icon. */
  category?: CategoryId;
  /** A letter tile's single character. */
  letter?: string;
  /** Position in the reveal order, for a staggered first appearance. */
  order: number;
}

/** Whether each kind of reminder has something to remind about. */
export interface PatternReminders {
  bills: boolean;
  cards: boolean;
  dailySummary: boolean;
}

/** Everything the pattern may know. Deliberately no money. */
export interface PatternInput {
  name?: string | null;
  goals?: readonly GoalId[];
  /** Watched categories, in the person's own order. */
  watched?: readonly CategoryId[];
  reminders?: Partial<PatternReminders>;
}

export const PATTERN_COLUMNS = 6;
export const PATTERN_ROWS = 2;

type Cell = Omit<PatternTile, 'key' | 'group' | 'order'>;

/** One cell per goal, as drawn on the boards. */
const GOAL_CELLS: Record<GoalId, Cell> = {
  bills: { col: 1, row: 0, kind: 'quarter', color: 'green', rotation: 90 },
  salary: { col: 2, row: 0, kind: 'circle', color: 'mint' },
  subscriptions: { col: 1, row: 1, kind: 'ring', color: 'green' },
  'cash-cards': { col: 0, row: 1, kind: 'half', color: 'ochre' },
  'spend-less': { col: 4, row: 0, kind: 'quarter', color: 'clay', rotation: 180 },
};
const GOAL_ORDER: readonly GoalId[] = ['bills', 'salary', 'subscriptions', 'cash-cards', 'spend-less'];

/** Two watched categories at most: glyph tiles on sand, alternating tone. */
const WATCH_CELLS: readonly Pick<Cell, 'col' | 'row' | 'mark'>[] = [
  { col: 3, row: 0, mark: 'clay' },
  { col: 2, row: 1, mark: 'green' },
];

const REMIND_CELLS: Record<keyof PatternReminders | 'rhythm', Cell> = {
  bills: { col: 5, row: 0, kind: 'dot', color: 'ochre' },
  rhythm: { col: 3, row: 1, kind: 'dot', color: 'cream' },
  cards: { col: 4, row: 1, kind: 'ring', color: 'ochre' },
  dailySummary: { col: 5, row: 1, kind: 'bars', color: 'mint' },
};

/** The first character of the name, when it is a letter. */
export function patternInitial(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null;
  const first = Array.from(name.trim())[0];
  if (!first || !/\p{L}/u.test(first)) return null;
  return first.toLocaleUpperCase('en-US');
}

/** Deterministic tile list. Same input, same tiles, in the same order. */
export function buildPattern(input: PatternInput): PatternTile[] {
  const tiles: PatternTile[] = [];
  const push = (key: string, group: PatternGroup, cell: Cell) => {
    tiles.push({ key, group, ...cell, order: tiles.length });
  };

  const initial = patternInitial(input.name);
  push('name:you', 'name', initial
    ? { col: 0, row: 0, kind: 'letter', color: 'clay', mark: 'cream', letter: initial }
    : { col: 0, row: 0, kind: 'square', color: 'clay' });

  const goals = new Set(input.goals ?? []);
  for (const goal of GOAL_ORDER) {
    if (goals.has(goal)) push(`goals:${goal}`, 'goals', GOAL_CELLS[goal]);
  }

  const watched: CategoryId[] = [];
  for (const category of input.watched ?? []) {
    if (!watched.includes(category)) watched.push(category);
    if (watched.length === WATCH_CELLS.length) break;
  }
  watched.forEach((category, index) => {
    const cell = WATCH_CELLS[index]!;
    push(`watch:${category}`, 'watch', { col: cell.col, row: cell.row, kind: 'glyph', color: 'sand', mark: cell.mark, category });
  });

  const reminders = input.reminders ?? {};
  const anyReminder = !!(reminders.bills || reminders.cards || reminders.dailySummary);
  if (reminders.bills) push('remind:bills', 'remind', REMIND_CELLS.bills);
  if (anyReminder) push('remind:rhythm', 'remind', REMIND_CELLS.rhythm);
  if (reminders.cards) push('remind:cards', 'remind', REMIND_CELLS.cards);
  if (reminders.dailySummary) push('remind:daily', 'remind', REMIND_CELLS.dailySummary);

  return tiles;
}

/** Only the fields the pattern reads. */
export type PatternStateFields = Pick<AppState, 'userName' | 'wafraGoals' | 'budgets' | 'bills' | 'cardDues' | 'accounts' | 'dailySummary'>;

/**
 * The input for a ledger: the stored name (never the placeholder), the goals
 * from onboarding, the categories that have a monthly limit (their order, not
 * their amounts), and which reminders have something to remind about —
 * payment reminders fire for bills and card statements, the daily summary is
 * the person's own switch.
 */
export function patternInputFromState(state: PatternStateFields): PatternInput {
  return {
    name: state.userName === 'there' ? null : state.userName,
    goals: state.wafraGoals ?? [],
    watched: state.budgets.map((budget) => budget.category),
    reminders: {
      bills: state.bills.length > 0,
      cards: state.cardDues.length > 0 ||
        state.accounts.some((account) => !account.archived && account.kind === 'card' && account.cardType === 'credit'),
      dailySummary: state.dailySummary === true,
    },
  };
}

/** The mosaic's size for a tile size and gap, in points. */
export function patternSize(tile: number, gap: number): { width: number; height: number } {
  return {
    width: PATTERN_COLUMNS * tile + (PATTERN_COLUMNS - 1) * gap,
    height: PATTERN_ROWS * tile + (PATTERN_ROWS - 1) * gap,
  };
}
