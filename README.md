# fx-value-date

FX **settlement / value-date** calculation — spot (T+2 / T+1), tom, and forward tenors across **two currency holiday calendars**, with the USD intermediate-day rule, modified-following adjustment, and the end-of-month rule. Zero dependencies.

```
npm install fx-value-date
```

## Why

An FX trade settles not "two days later" but two *good business days* later — where "good" depends on the holiday calendars of **both** currencies (and, for a cross, of USD). Then forward tenors roll from spot with the modified-following and end-of-month conventions. No npm package encoded these FX-specific settlement rules. This one does — and stays dependency-free by letting you **inject** each currency's holiday calendar.

```ts
import { spotValueDate, forwardValueDate, calendarFromDates } from "fx-value-date";

const usd = calendarFromDates(["2026-07-03", "2026-12-25"]); // US holidays (weekday)
const eur = calendarFromDates(["2026-05-01", "2026-12-25"]);

// T+2 that would land on US Independence Day rolls forward:
spotValueDate({ pair: "EUR/USD", tradeDate: "2026-07-01", base: eur, quote: usd });
// "2026-07-06"

forwardValueDate({ pair: "EUR/USD", tradeDate: "2026-04-28", tenor: "1M", base: eur, quote: usd });
// end-of-month rule + modified-following
```

## API

Dates are `"YYYY-MM-DD"`. You supply holiday calendars as `(isoDate) => boolean` predicates — weekends are handled internally, so a calendar need only flag weekday holidays. `calendarFromDates(dates)` builds one from a list/Set.

- **`spotValueDate({ pair, tradeDate, base, quote, usd?, spotLag? })`** — the spot value date. `spotLag` defaults to 1 for T+1 pairs (USD/CAD, USD/TRY, …) and 2 otherwise. For a non-USD cross, pass `usd` to apply the intermediate-day rule (the T+1 day must be USD-good).
- **`tomValueDate(...)`** — T+1 value date.
- **`forwardValueDate({ ..., tenor })`** — value date for a tenor measured from spot: `"1W"`, `"3M"`, `"1Y"`, or the short dates `"ON"` / `"TN"` / `"SN"`. Month/year tenors apply the end-of-month rule; all adjust modified-following on both calendars.
- **`adjust(date, base, quote, convention?)`** — business-day adjustment (`following`, `modified-following`, `preceding`, `modified-preceding`).
- **`spotLag(pair)`** — 1 or 2; **`calendarFromDates(dates)`** — build a calendar.

Malformed pairs/dates throw `RangeError`.

## Related

Pairs with [`fx-forward-math`](https://github.com/moshejs/fx-forward-math) (forward points, cross-rates). The equity/bond-market date counterparts are [`us-equity-market-calendar`](https://github.com/moshejs/us-equity-market-calendar) and [`sifma-holidays`](https://github.com/moshejs/sifma-holidays). Part of a markets toolkit alongside [`day-count`](https://github.com/moshejs/day-count) and [`newyorkfed`](https://github.com/moshejs/newyorkfed).

## Author

Built by **[Moshe Malka](https://moshemalka.com)** — engineering leader in New York City. Studio work at [Quentin.Code](https://www.quentin.software/).

MIT © Moshe Malka
