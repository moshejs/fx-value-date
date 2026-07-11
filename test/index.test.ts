import { describe, expect, it } from "vitest";
import {
  adjust,
  calendarFromDates,
  forwardValueDate,
  spotLag,
  spotValueDate,
  tomValueDate,
} from "../src/index.js";

const NONE = () => false;
// US Independence Day 2026 observed (Fri Jul 3) + Christmas.
const USD_HOL = calendarFromDates(["2026-07-03", "2026-12-25"]);

describe("spot lag", () => {
  it("is T+1 for USD/CAD and T+2 for the majors", () => {
    expect(spotLag("USD/CAD")).toBe(1);
    expect(spotLag("EUR/USD")).toBe(2);
    expect(spotLag("GBP/JPY")).toBe(2);
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

  it("applies the USD intermediate-day rule on a non-USD cross", () => {
    // EUR/GBP trade Thu 2026-07-02. Without a USD calendar, T+1 is Jul 3 (good
    // for EUR & GBP) → spot Jul 6. WITH the USD holiday on Jul 3, the
    // intermediate day must be USD-good, so Jul 3 doesn't count → spot Jul 7.
    const base = { pair: "EUR/GBP", tradeDate: "2026-07-02", base: NONE, quote: NONE };
    expect(spotValueDate(base)).toBe("2026-07-06");
    expect(spotValueDate({ ...base, usd: USD_HOL })).toBe("2026-07-07");
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
