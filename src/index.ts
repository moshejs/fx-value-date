/**
 * fx-value-date — FX settlement / value-date calculation.
 *
 * Spot (T+2, with the T+1 special cases), tom, spot-next, and forward tenor
 * value dates across TWO currency holiday calendars, following the market
 * conventions: each currency counts its own business days to spot (USD needs
 * only one clear day, so a USD holiday on T+1 does not delay a USD pair), the
 * spot date must be good for both currencies (and for USD on a cross),
 * forwards roll modified-following with the end-end rule.
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
   * USD holiday calendar, used when neither side of the pair is USD: a
   * cross's value date may not be a USD holiday. Also used for the T+1 check
   * on MXN, CLP and ARS. Optional; defaults to weekends-only.
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

/** Pairs that settle T+1 (either orientation). */
const T1_CURRENCIES_VS_USD = new Set(["CAD", "TRY", "PHP", "RUB"]);

/**
 * Currencies whose T+1 day must also be a USD business day (two clear USD
 * days to spot), per market convention for these Latin American currencies.
 */
const USD_T1_CURRENCIES = new Set(["MXN", "CLP", "ARS"]);

export interface SpotOptions extends Calendars {
  /** Override the spot lag in business days (default: 1 for T+1 pairs, else 2). */
  spotLag?: number;
  /** The trade date. */
  tradeDate: DateInput;
  /** The currency pair, "BASE/QUOTE". */
  pair: string;
}

/**
 * How many business days after trade date the pair settles spot: 1 for
 * USD/CAD, USD/TRY, USD/PHP and USD/RUB (either orientation), else 2.
 */
export function spotLag(pair: string): number {
  const { base, quote } = parsePairCurrencies(pair);
  const other = base === "USD" ? quote : quote === "USD" ? base : null;
  return other !== null && T1_CURRENCIES_VS_USD.has(other) ? 1 : 2;
}

interface PairContext {
  baseCcy: string;
  quoteCcy: string;
  base: HolidayCalendar;
  quote: HolidayCalendar;
  usd: HolidayCalendar;
  /** Neither side is USD. */
  cross: boolean;
}

function pairContext(opts: { pair: string } & Calendars): PairContext {
  const { base: baseCcy, quote: quoteCcy } = parsePairCurrencies(opts.pair);
  const usd =
    baseCcy === "USD" ? opts.base : quoteCcy === "USD" ? opts.quote : (opts.usd ?? WEEKENDS_ONLY);
  return { baseCcy, quoteCcy, base: opts.base, quote: opts.quote, usd, cross: baseCcy !== "USD" && quoteCcy !== "USD" };
}

/** A valid value date: good for both currencies, and for USD on a cross. */
function isValueDate(a: YMD, ctx: PairContext): boolean {
  return isJointBusinessDay(a, ctx.base, ctx.quote) && (!ctx.cross || isBusinessDay(a, ctx.usd));
}

function addGoodDays(a: YMD, n: number, good: (x: YMD) => boolean): YMD {
  let cur = a;
  for (let i = 0; i < n; i++) {
    cur = addDays(cur, 1);
    while (!good(cur)) cur = addDays(cur, 1);
  }
  return cur;
}

function nextValueDate(a: YMD, ctx: PairContext): YMD {
  let cur = addDays(a, 1);
  while (!isValueDate(cur, ctx)) cur = addDays(cur, 1);
  return cur;
}

function rollToValueDate(a: YMD, ctx: PairContext): YMD {
  let cur = a;
  while (!isValueDate(cur, ctx)) cur = addDays(cur, 1);
  return cur;
}

function spotYMD(trade: YMD, lag: number, ctx: PairContext): YMD {
  // Each currency counts its own clear business days from the trade date:
  // USD needs lag − 1 (one clear day for T+2), every other currency needs
  // `lag`, and MXN/CLP/ARS count on their calendar AND USD's. The later of
  // the two legs, rolled forward to a valid value date, is spot.
  const leg = (ccy: string, cal: HolidayCalendar): YMD => {
    if (ccy === "USD") return addGoodDays(trade, Math.max(lag - 1, 0), (x) => isBusinessDay(x, cal));
    const withUsd = USD_T1_CURRENCIES.has(ccy);
    return addGoodDays(trade, lag, (x) => isBusinessDay(x, cal) && (!withUsd || isBusinessDay(x, ctx.usd)));
  };
  const a = leg(ctx.baseCcy, ctx.base);
  const b = leg(ctx.quoteCcy, ctx.quote);
  return rollToValueDate(iso(a) > iso(b) ? a : b, ctx);
}

function lagFor(opts: SpotOptions): number {
  const lag = opts.spotLag ?? spotLag(opts.pair);
  if (!Number.isInteger(lag) || lag < 0) throw new RangeError(`spotLag must be an integer ≥ 0, got ${lag}`);
  return lag;
}

/**
 * The spot value date for a pair.
 *
 * Each currency counts its own business days from the trade date: two for
 * most currencies, but only one for USD, so a USD holiday on T+1 does not
 * delay EUR/USD. (MXN, CLP and ARS are the exception: their T+1 must also be
 * a USD business day.) The later of the two dates is then rolled forward
 * until it is a business day for both currencies — and for USD too when the
 * pair is a cross, since a cross may not settle on a USD holiday.
 *
 * ```ts
 * // trade Wed 2026-07-01; T+2 would land on Fri Jul 3 (US Independence Day
 * // observed), so it rolls to the next good business day:
 * spotValueDate({ pair: "EUR/USD", tradeDate: "2026-07-01", base, quote });
 * // "2026-07-06"
 * ```
 */
export function spotValueDate(opts: SpotOptions): string {
  const ctx = pairContext(opts);
  return iso(spotYMD(toYMD(opts.tradeDate, "tradeDate"), lagFor(opts), ctx));
}

/**
 * The tom (tomorrow) value date: the first valid value date one business day
 * after trade (spot with a lag of 1).
 */
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
 * convention). Day and week tenors add calendar days; month and year tenors
 * add months. Either way the date is then adjusted modified-following onto a
 * valid value date (good for both currencies, and USD on a cross).
 *
 * End-end rule: when spot is the last valid value date of its month, a
 * month/year forward is the last valid value date of the target month. A
 * target day that does not exist (Jan 30 + 1M) is capped at the month end.
 *
 * Also accepts the short dates "ON" (overnight: value tom), "TN" (tom-next:
 * value spot), and "SN" (spot-next: the value date after spot).
 */
export function forwardValueDate(opts: ForwardOptions): string {
  const ctx = pairContext(opts);
  const trade = toYMD(opts.tradeDate, "tradeDate");
  const tenor = opts.tenor.trim().toUpperCase();
  const lag = lagFor(opts);
  const spot = spotYMD(trade, lag, ctx);

  if (tenor === "ON") return iso(spotYMD(trade, 1, ctx));
  if (tenor === "TN") {
    // Tom-next settles on spot; for T+1 pairs (tom = spot) it is the next day.
    const tom = spotYMD(trade, 1, ctx);
    return iso(iso(spot) > iso(tom) ? spot : nextValueDate(tom, ctx));
  }
  if (tenor === "SN") return iso(nextValueDate(spot, ctx));

  const m = TENOR_RE.exec(tenor);
  if (!m) throw new RangeError(`Invalid tenor: "${opts.tenor}" (e.g. "1W", "3M", "1Y", "ON")`);
  const n = Number(m[1]);
  const unit = m[2];

  if (unit === "D" || unit === "W") {
    return iso(modifiedFollowing(addDays(spot, unit === "W" ? n * 7 : n), ctx));
  }

  const months = unit === "M" ? n : n * 12;
  const total = spot.y * 12 + (spot.m - 1) + months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const last = lastDayOfMonth(ty, tm);
  if (isLastValueDateOfMonth(spot, ctx)) {
    let d: YMD = { y: ty, m: tm, d: last };
    while (!isValueDate(d, ctx)) d = addDays(d, -1);
    return iso(d);
  }
  return iso(modifiedFollowing({ y: ty, m: tm, d: Math.min(spot.d, last) }, ctx));
}

function isLastValueDateOfMonth(a: YMD, ctx: PairContext): boolean {
  if (!isValueDate(a, ctx)) return false;
  for (let d = addDays(a, 1); d.m === a.m; d = addDays(d, 1)) {
    if (isValueDate(d, ctx)) return false;
  }
  return true;
}

function modifiedFollowing(a: YMD, ctx: PairContext): YMD {
  let f = a;
  while (!isValueDate(f, ctx)) f = addDays(f, 1);
  if (f.m === a.m) return f;
  let p = a;
  while (!isValueDate(p, ctx)) p = addDays(p, -1);
  return p;
}

/**
 * Build a `HolidayCalendar` from a set/array of "YYYY-MM-DD" holiday dates.
 * Weekends are handled separately, so the set need only list weekday holidays.
 */
export function calendarFromDates(dates: Iterable<string>): HolidayCalendar {
  const set = dates instanceof Set ? dates : new Set(dates);
  return (isoDate: string) => set.has(isoDate);
}
