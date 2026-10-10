import { describe, expect, it } from "vitest";
import {
  adjust,
  calendarFromDates,
  forwardValueDate,
  spotLag,
  spotValueDate,
  tomValueDate,
} from "../src/index.js";
import { holidays as refHolidays, oneWeek as refOneWeek, spot as refSpot } from "./fixtures.js";

const NONE = () => false;
// US Independence Day 2026 observed (Fri Jul 3) + Christmas.
const USD_HOL = calendarFromDates(["2026-07-03", "2026-12-25"]);

describe("spot lag", () => {
  it("is T+1 for USD/CAD and T+2 for the majors", () => {
    expect(spotLag("USD/CAD")).toBe(1);
    expect(spotLag("EUR/USD")).toBe(2);
    expect(spotLag("GBP/JPY")).toBe(2);
  });

  it("T+1 pairs are recognised in either orientation (1.0.0 missed TRY/USD etc.)", () => {
    for (const p of ["USD/TRY", "TRY/USD", "USD/PHP", "PHP/USD", "USD/RUB", "RUB/USD", "CAD/USD"]) {
      expect(spotLag(p), p).toBe(1);
    }
    expect(spotLag("EUR/CAD")).toBe(2);
  });
});

describe("spot value date", () => {
  it("plain T+2 with no holidays", () => {
    // Mon 2026-03-16 → Wed 2026-03-18
    expect(spotValueDate({ pair: "EUR/USD", tradeDate: "2026-03-16", base: NONE, quote: NONE })).toBe(
      "2026-03-18",
    );
  });

  it("T+2 counts over a weekend", () => {
    // Thu 2026-03-19 → Fri 20 (1), Mon 23 (2)
    expect(spotValueDate({ pair: "EUR/USD", tradeDate: "2026-03-19", base: NONE, quote: NONE })).toBe(
      "2026-03-23",
    );
  });

  it("rolls when T+2 lands on a US holiday (EUR/USD)", () => {
    // Wed 2026-07-01 → Thu Jul 2 (1); Fri Jul 3 is US holiday; skip weekend → Mon Jul 6 (2)
    expect(
      spotValueDate({ pair: "EUR/USD", tradeDate: "2026-07-01", base: NONE, quote: USD_HOL }),
    ).toBe("2026-07-06");
  });

  it("USD/CAD settles T+1", () => {
    // Mon 2026-03-16 → Tue 2026-03-17
    expect(spotValueDate({ pair: "USD/CAD", tradeDate: "2026-03-16", base: NONE, quote: NONE })).toBe(
      "2026-03-17",
    );
  });

  it("a USD holiday on T+1 does not delay a USD pair (USD needs one clear day)", () => {
    // EUR/USD trade Thu 2026-07-02: T+1 Fri Jul 3 is a US holiday but a EUR
    // business day, so it counts; spot is Mon Jul 6. (1.0.0 returned Jul 7.)
    expect(
      spotValueDate({ pair: "EUR/USD", tradeDate: "2026-07-02", base: NONE, quote: USD_HOL }),
    ).toBe("2026-07-06");
    expect(
      spotValueDate({ pair: "USD/JPY", tradeDate: "2026-07-02", base: USD_HOL, quote: NONE }),
    ).toBe("2026-07-06");
  });

  it("a cross ignores USD on T+1 but may not settle on a USD holiday", () => {
    // EUR/GBP trade Thu 2026-07-02: T+1 Jul 3 is good for EUR and GBP → spot
    // Mon Jul 6. (1.0.0 inverted the rule, demanding a USD-good T+1: Jul 7.)
    const base = { pair: "EUR/GBP", tradeDate: "2026-07-02", base: NONE, quote: NONE };
    expect(spotValueDate(base)).toBe("2026-07-06");
    expect(spotValueDate({ ...base, usd: USD_HOL })).toBe("2026-07-06");
    // Trade Wed Jul 1: T+2 = Fri Jul 3 is a USD holiday → rolls to Mon Jul 6.
    expect(spotValueDate({ ...base, tradeDate: "2026-07-01", usd: USD_HOL })).toBe("2026-07-06");
  });

  it("each currency counts its own business days", () => {
    // EUR/JPY trade Wed 2026-03-18; Thu 19 is a EUR holiday, Fri 20 a JPY one.
    // EUR: Fri, Mon → Mon 23. JPY: Thu, Mon → Mon 23. Spot Mon 23.
    // (1.0.0 counted only days good for both: Mon 23, Tue 24 → Tue 24.)
    const eur = calendarFromDates(["2026-03-19"]);
    const jpy = calendarFromDates(["2026-03-20"]);
    expect(spotValueDate({ pair: "EUR/JPY", tradeDate: "2026-03-18", base: eur, quote: jpy })).toBe(
      "2026-03-23",
    );
  });

  it("matches ObjectLab Kit's documented examples (July 4 2006 USD holiday)", () => {
    const usd = calendarFromDates(["2006-07-04"]);
    expect(spotValueDate({ pair: "EUR/USD", tradeDate: "2006-06-30", base: NONE, quote: usd })).toBe(
      "2006-07-05",
    );
    expect(spotValueDate({ pair: "EUR/USD", tradeDate: "2006-07-03", base: NONE, quote: usd })).toBe(
      "2006-07-05",
    );
    expect(
      spotValueDate({ pair: "EUR/GBP", tradeDate: "2006-06-30", base: NONE, quote: NONE, usd }),
    ).toBe("2006-07-05");
    // MXN's T+1 must also be a USD business day.
    expect(
      spotValueDate({ pair: "EUR/MXN", tradeDate: "2006-07-03", base: NONE, quote: NONE, usd }),
    ).toBe("2006-07-06");
    // Wikipedia: a USD/JPY spot traded on July 3 settles July 5.
    expect(spotValueDate({ pair: "USD/JPY", tradeDate: "2006-07-03", base: usd, quote: NONE })).toBe(
      "2006-07-05",
    );
  });

  it("a T+1 pair's value date must not be a US holiday", () => {
    // USD/CAD trade Thu 2026-07-02 → Fri Jul 3 is a US holiday → Mon Jul 6.
    expect(spotValueDate({ pair: "USD/CAD", tradeDate: "2026-07-02", base: USD_HOL, quote: NONE })).toBe(
      "2026-07-06",
    );
  });

  it("tom is T+1", () => {
    expect(tomValueDate({ pair: "EUR/USD", tradeDate: "2026-03-16", base: NONE, quote: NONE })).toBe(
      "2026-03-17",
    );
  });
});

describe("business-day adjustment", () => {
  it("modified-following rolls back when it crosses a month end", () => {
    // 2026-05-31 is a Sunday. Following → Mon Jun 1 (next month) → modified
    // rolls back to Fri May 29.
    expect(adjust("2026-05-31", NONE, NONE, "modified-following")).toBe("2026-05-29");
    // plain following crosses into June
    expect(adjust("2026-05-31", NONE, NONE, "following")).toBe("2026-06-01");
  });

  it("preceding and modified-preceding", () => {
    // 2026-03-01 is a Sunday → preceding Fri Feb 27; modified-preceding stays
    // (same-ish month behavior) — Feb 27 is still February so no change.
    expect(adjust("2026-03-01", NONE, NONE, "preceding")).toBe("2026-02-27");
  });

  it("leaves a good business day unchanged", () => {
    expect(adjust("2026-03-17", NONE, NONE)).toBe("2026-03-17");
  });
});

describe("forward tenors", () => {
  const common = { pair: "EUR/USD", base: NONE, quote: NONE };

  it("week tenors add calendar weeks from spot then adjust", () => {
    // spot for trade Mon 2026-03-16 is Wed 2026-03-18; +1W = Wed 2026-03-25
    expect(forwardValueDate({ ...common, tradeDate: "2026-03-16", tenor: "1W" })).toBe("2026-03-25");
  });

  it("month tenors add months with modified-following", () => {
    // spot 2026-03-18 + 1M = 2026-04-18 (Sat) → modified-following → Mon Apr 20
    expect(forwardValueDate({ ...common, tradeDate: "2026-03-16", tenor: "1M" })).toBe("2026-04-20");
  });

  it("applies the end-of-month rule when spot is a month end", () => {
    // Trade Tue 2026-04-28 → spot Thu 2026-04-30 (month end). +1M → end of May
    // → Sun May 31 → modified-following back to Fri May 29.
    expect(forwardValueDate({ ...common, tradeDate: "2026-04-28", tenor: "1M" })).toBe("2026-05-29");
  });

  it("end-end: spot on the last business day of a month → last business day of the target month", () => {
    // Trade Wed 2026-05-27 → spot Fri 2026-05-29, the last business day of
    // May (30/31 are a weekend). 1M = last business day of June = Tue Jun 30.
    // (1.0.0 only recognised the last *calendar* day and returned Jun 29.)
    expect(forwardValueDate({ ...common, tradeDate: "2026-05-27", tenor: "1M" })).toBe("2026-06-30");
    // Holiday-driven month end: Apr 30 2026 is a EUR holiday, so Wed Apr 29
    // is the last good day. Trade Mon Apr 27 → spot Apr 29 → 1M = Fri May 29.
    const eur = calendarFromDates(["2026-04-30"]);
    expect(
      forwardValueDate({ pair: "EUR/USD", tradeDate: "2026-04-27", base: eur, quote: NONE, tenor: "1M" }),
    ).toBe("2026-05-29");
  });

  it("a cross's forward date avoids USD holidays", () => {
    // EUR/GBP trade Mon 2026-06-01 → spot Wed Jun 3 → 1M = Fri Jul 3, a USD
    // holiday → Mon Jul 6.
    expect(
      forwardValueDate({ pair: "EUR/GBP", tradeDate: "2026-06-01", base: NONE, quote: NONE, usd: USD_HOL, tenor: "1M" }),
    ).toBe("2026-07-06");
  });

  it("TN settles on spot, even when spot rolls past a USD holiday", () => {
    const t = { pair: "EUR/GBP", tradeDate: "2026-07-01", base: NONE, quote: NONE, usd: USD_HOL };
    expect(forwardValueDate({ ...t, tenor: "ON" })).toBe("2026-07-02");
    expect(forwardValueDate({ ...t, tenor: "TN" })).toBe("2026-07-06"); // = spot (1.0.0: Jul 3, a USD holiday)
    expect(spotValueDate(t)).toBe("2026-07-06");
    expect(forwardValueDate({ ...t, tenor: "SN" })).toBe("2026-07-07");
  });

  it("handles ON / TN / SN short dates", () => {
    const t = { ...common, tradeDate: "2026-03-16" };
    expect(forwardValueDate({ ...t, tenor: "ON" })).toBe("2026-03-17"); // trade+1
    expect(forwardValueDate({ ...t, tenor: "TN" })).toBe("2026-03-18"); // tom+1
    expect(forwardValueDate({ ...t, tenor: "SN" })).toBe("2026-03-19"); // spot+1
  });

  it("1Y tenor", () => {
    // spot 2026-03-18 + 1Y = 2027-03-18 (Thu, good)
    expect(forwardValueDate({ ...common, tradeDate: "2026-03-16", tenor: "1Y" })).toBe("2027-03-18");
  });

  it("rejects an invalid tenor", () => {
    expect(() => forwardValueDate({ ...common, tradeDate: "2026-03-16", tenor: "5X" })).toThrow(
      RangeError,
    );
  });
});

describe("cross-check against ObjectLab Kit 1.4.0 (test/fixtures.ts)", () => {
  const cal = (c: string) => calendarFromDates(refHolidays[c] ?? []);
  const run = (table: Record<string, string[]>, tenor?: string) => {
    let n = 0;
    for (const [pair, rows] of Object.entries(table)) {
      const [b, q] = pair.split("/") as [string, string];
      const o = { pair, base: cal(b), quote: cal(q), usd: cal("USD") };
      for (const row of rows) {
        const [tradeDate, expected] = row.split(" ") as [string, string];
        const got = tenor ? forwardValueDate({ ...o, tradeDate, tenor }) : spotValueDate({ ...o, tradeDate });
        expect(got, `${pair} ${tenor ?? "spot"} ${tradeDate}`).toBe(expected);
        n++;
      }
    }
    return n;
  };

  it("spot dates for 12 pairs over a year of dense random holidays", () => {
    expect(run(refSpot)).toBeGreaterThan(3000);
  });

  it("1W forward dates", () => {
    expect(run(refOneWeek, "1W")).toBeGreaterThan(3000);
  });
});

describe("validation", () => {
  it("rejects bad pairs and dates", () => {
    expect(() => spotValueDate({ pair: "EURUSD", tradeDate: "2026-03-16", base: NONE, quote: NONE })).toThrow(
      RangeError,
    );
    expect(() => spotValueDate({ pair: "EUR/USD", tradeDate: "2026-3-16", base: NONE, quote: NONE })).toThrow(
      RangeError,
    );
  });
});
