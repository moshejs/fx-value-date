/**
 * fx-value-date — FX settlement / value-date calculation.
 *
 * Spot (T+2, with the T+1 special cases), tom, spot-next, and forward tenor
 * value dates across TWO currency holiday calendars, applying the USD
 * intermediate-holiday rule, the modified-following business-day adjustment,
 * and the end-of-month rule.
 *
 * Zero dependencies: you inject each currency's holiday calendar as a
 * predicate (e.g. wrap `date-holidays`, or pass a Set of dates). Dates are
 * "YYYY-MM-DD" strings.
 */

export type DateInput = string | Date;

/** Returns true if the given "YYYY-MM-DD" date is a holiday for a currency. */
export type HolidayCalendar = (isoDate: string) => boolean;

export interface Calendars {
  /** Base-currency holiday calendar (currency before the "/"). */
  base: HolidayCalendar;
  /** Quote-currency holiday calendar. */
  quote: HolidayCalendar;
  /**
   * USD holiday calendar, used for the intermediate-day rule when neither
   * side of the pair is USD. Optional; defaults to weekends-only.
   */
  usd?: HolidayCalendar;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

interface YMD {
  y: number;
  m: number;
  d: number;
}

function toYMD(input: DateInput, label = "date"): YMD {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) throw new RangeError(`Invalid Date for ${label}`);
    return { y: input.getUTCFullYear(), m: input.getUTCMonth() + 1, d: input.getUTCDate() };
  }
  const m = DATE_RE.exec(input);
  if (!m) throw new RangeError(`Invalid date for ${label}: "${input}" (expected YYYY-MM-DD)`);
  const ymd = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  const check = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d));
  if (
    check.getUTCFullYear() !== ymd.y ||
    check.getUTCMonth() + 1 !== ymd.m ||
    check.getUTCDate() !== ymd.d
  ) {
    throw new RangeError(`Invalid calendar date for ${label}: "${input}"`);
  }
  return ymd;
}

function iso(a: YMD): string {
  return `${String(a.y).padStart(4, "0")}-${String(a.m).padStart(2, "0")}-${String(a.d).padStart(2, "0")}`;
}

function dow(a: YMD): number {
  return new Date(Date.UTC(a.y, a.m - 1, a.d)).getUTCDay();
}

function isWeekend(a: YMD): boolean {
  const w = dow(a);
  return w === 0 || w === 6;
}

function addDays(a: YMD, n: number): YMD {
  const t = new Date(Date.UTC(a.y, a.m - 1, a.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const WEEKENDS_ONLY: HolidayCalendar = () => false;

function parsePairCurrencies(pair: string): { base: string; quote: string } {
  const m = /^([A-Z]{3})\/([A-Z]{3})$/.exec(pair.trim().toUpperCase());
  if (!m) throw new RangeError(`Invalid currency pair: "${pair}" (expected "BASE/QUOTE")`);
  return { base: m[1]!, quote: m[2]! };
}

/** A currency's business day = not a weekend and not that currency's holiday. */
function isBusinessDay(a: YMD, cal: HolidayCalendar): boolean {
  return !isWeekend(a) && !cal(iso(a));
}

/** Business day on both legs' calendars (the pair's joint business day). */
function isJointBusinessDay(a: YMD, base: HolidayCalendar, quote: HolidayCalendar): boolean {
  return isBusinessDay(a, base) && isBusinessDay(a, quote);
}

/**
 * Spot lag for a pair: T+1 for USD/CAD, USD/TRY, USD/PHP, USD/RUB and the
 * "same-day/next-day" majors; T+2 otherwise. Override via {@link SpotOptions}.
 */
const T1_PAIRS = new Set(["USD/CAD", "USD/TRY", "USD/PHP", "USD/RUB", "CAD/USD"]);

export interface SpotOptions extends Calendars {
  /** Override the spot lag in business days (default: 1 for T+1 pairs, else 2). */
  spotLag?: number;
  /** The trade date. */
  tradeDate: DateInput;
  /** The currency pair, "BASE/QUOTE". */
  pair: string;
}

/** How many business days after trade date the pair settles spot (1 or 2). */
export function spotLag(pair: string): number {
  const { base, quote } = parsePairCurrencies(pair);
  return T1_PAIRS.has(`${base}/${quote}`) ? 1 : 2;
}

/**
 * The spot value date for a pair.
 *
 * The rule: advance `spotLag` (usually 2) currency-business days from the
 * trade date on BOTH legs' calendars. For the intermediate day of a T+2
 * cross where neither currency is USD, the day must additionally be a USD
 * business day (the "USD must be good on T+1" rule); it need not be a
 * settlement day. The final value date must be a joint business day.
 *
 * ```ts
 * // trade Wed 2026-07-01; T+2 would land on Fri Jul 3 (US Independence Day
 * // observed), so it rolls to the next good business day:
 * spotValueDate({ pair: "EUR/USD", tradeDate: "2026-07-01", base, quote });
 * // "2026-07-06"
 * ```
 */
export function spotValueDate(opts: SpotOptions): string {
  const { base, quote } = opts;
  const usd = opts.usd ?? WEEKENDS_ONLY;
  const { base: baseCcy, quote: quoteCcy } = parsePairCurrencies(opts.pair);
  const lag = opts.spotLag ?? spotLag(opts.pair);
  if (!Number.isInteger(lag) || lag < 0) throw new RangeError(`spotLag must be ≥ 0, got ${lag}`);

  const usdInvolved = baseCcy === "USD" || quoteCcy === "USD";
  let cur = toYMD(opts.tradeDate, "tradeDate");

  // Step through `lag` business days. Intermediate days need only be joint
  // business days; when USD is not in the pair, they must also be USD-good.
  let stepped = 0;
  while (stepped < lag) {
    cur = addDays(cur, 1);
    const jointOk = isJointBusinessDay(cur, base, quote);
    if (!jointOk) continue;
    // For non-USD crosses, an intermediate day must be a USD business day.
    if (!usdInvolved && stepped < lag - 1 && !isBusinessDay(cur, usd)) continue;
    stepped++;
  }
  // Ensure the final value date is a joint business day (roll forward if not —
  // e.g. a USD holiday on the value date of a EUR/GBP cross).
  while (!isJointBusinessDay(cur, base, quote) || (!usdInvolved && !isBusinessDay(cur, usd))) {
    cur = addDays(cur, 1);
  }
  return iso(cur);
}

/** The tom (tomorrow / T+1) value date: one joint business day after trade. */
export function tomValueDate(opts: Omit<SpotOptions, "spotLag">): string {
  return spotValueDate({ ...opts, spotLag: 1 });
}

export type BusinessDayConvention =
  | "following"
  | "modified-following"
  | "preceding"
  | "modified-preceding";

/** Adjust a date to a joint business day per the convention. */
export function adjust(
  date: DateInput,
  base: HolidayCalendar,
  quote: HolidayCalendar,
  convention: BusinessDayConvention = "modified-following",
): string {
  let a = toYMD(date, "date");
  const good = (x: YMD) => isJointBusinessDay(x, base, quote);
  if (good(a)) return iso(a);

  if (convention === "following" || convention === "modified-following") {
    let f = a;
    while (!good(f)) f = addDays(f, 1);
    if (convention === "modified-following" && f.m !== a.m) {
      // rolled into next month → go backward instead
      let p = a;
      while (!good(p)) p = addDays(p, -1);
      return iso(p);
    }
    return iso(f);
  }
  // preceding / modified-preceding
  let p = a;
  while (!good(p)) p = addDays(p, -1);
  if (convention === "modified-preceding" && p.m !== a.m) {
    let f = a;
    while (!good(f)) f = addDays(f, 1);
    return iso(f);
  }
  return iso(p);
}

export interface ForwardOptions extends SpotOptions {
  /** Tenor like "1W", "2W", "1M", "3M", "6M", "1Y", or "ON"/"TN"/"SN". */
  tenor: string;
}

const TENOR_RE = /^(\d+)(D|W|M|Y)$/;

/**
 * The value date for a forward tenor, measured from spot (the market
 * convention). Week/day tenors add calendar days then adjust
 * modified-following; month/year tenors add months with the end-of-month
 * rule, then adjust modified-following on both calendars.
 *
 * Also accepts the short-dated tenors "ON" (overnight, trade→T+1),
 * "TN" (tom-next), and "SN" (spot-next).
 */
export function forwardValueDate(opts: ForwardOptions): string {
  const { base, quote } = opts;
  const tenor = opts.tenor.trim().toUpperCase();

  if (tenor === "ON") return tomValueDate(opts);
  if (tenor === "TN") {
    const tom = tomValueDate(opts);
    return nextJointBusinessDay(tom, base, quote);
  }
  const spot = spotValueDate(opts);
  if (tenor === "SN") return nextJointBusinessDay(spot, base, quote);

  const m = TENOR_RE.exec(tenor);
  if (!m) throw new RangeError(`Invalid tenor: "${opts.tenor}" (e.g. "1W", "3M", "1Y", "ON")`);
  const n = Number(m[1]);
  const unit = m[2];

  const spotY = toYMD(spot);
  if (unit === "D" || unit === "W") {
    const days = unit === "W" ? n * 7 : n;
    return adjust(iso(addDays(spotY, days)), base, quote, "modified-following");
  }

  // Month / year tenor with the end-of-month rule.
  const months = unit === "M" ? n : n * 12;
  const spotIsEom = spotY.d === lastDayOfMonth(spotY.y, spotY.m);
  const total = spotY.y * 12 + (spotY.m - 1) + months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const targetDay = spotIsEom ? lastDayOfMonth(ty, tm) : Math.min(spotY.d, lastDayOfMonth(ty, tm));
  return adjust(iso({ y: ty, m: tm, d: targetDay }), base, quote, "modified-following");
}

function nextJointBusinessDay(date: DateInput, base: HolidayCalendar, quote: HolidayCalendar): string {
  let cur = addDays(toYMD(date), 1);
  while (!isJointBusinessDay(cur, base, quote)) cur = addDays(cur, 1);
  return iso(cur);
}

/**
 * Build a `HolidayCalendar` from a set/array of "YYYY-MM-DD" holiday dates.
 * Weekends are handled separately, so the set need only list weekday holidays.
 */
export function calendarFromDates(dates: Iterable<string>): HolidayCalendar {
  const set = dates instanceof Set ? dates : new Set(dates);
  return (isoDate: string) => set.has(isoDate);
}
