# fx-value-date

FX **settlement / value-date** calculation — spot (T+2 / T+1), tom, and forward tenors across **two currency holiday calendars**, following market conventions: per-currency spot counting, the USD T+1 rule, no USD-holiday value dates for crosses, modified-following, and the end-end rule. Zero dependencies.

```
npm install fx-value-date
```

## Why

An FX trade settles not "two days later" but two *good business days* later — where "good" depends on the holiday calendars of **both** currencies (and, for a cross, of USD). Then forward tenors roll from spot with the modified-following and end-end conventions. No npm package encoded these FX-specific settlement rules. This one does — and stays dependency-free by letting you **inject** each currency's holiday calendar.

```ts
import { spotValueDate, forwardValueDate, calendarFromDates } from "fx-value-date";

const usd = calendarFromDates(["2026-07-03", "2026-12-25"]); // US holidays (weekday)
const eur = calendarFromDates(["2026-05-01", "2026-12-25"]);

// T+2 that would land on US Independence Day rolls forward:
spotValueDate({ pair: "EUR/USD", tradeDate: "2026-07-01", base: eur, quote: usd });
// "2026-07-06"

// …but a USD holiday on T+1 does not delay a USD pair (USD needs one clear day):
spotValueDate({ pair: "EUR/USD", tradeDate: "2026-07-02", base: eur, quote: usd });
// "2026-07-06"

forwardValueDate({ pair: "EUR/USD", tradeDate: "2026-04-28", tenor: "1M", base: eur, quote: usd });
// "2026-05-29": spot Apr 30 is a month end, so 1M is the last good day of May (end-end rule)
```

## API

Dates are `"YYYY-MM-DD"`. You supply holiday calendars as `(isoDate) => boolean` predicates — weekends are handled internally, so a calendar need only flag weekday holidays. `calendarFromDates(dates)` builds one from a list/Set.

- **`spotValueDate({ pair, tradeDate, base, quote, usd?, spotLag? })`** — the spot value date. `spotLag` defaults to 1 for USD/CAD, USD/TRY, USD/PHP and USD/RUB (either orientation) and 2 otherwise. For a non-USD cross, pass `usd` so the value date avoids USD holidays.
- **`tomValueDate(...)`** — the tom value date (spot with a lag of 1).
- **`forwardValueDate({ ..., tenor })`** — value date for a tenor measured from spot: `"1D"`, `"1W"`, `"3M"`, `"1Y"`, or the short dates `"ON"` (value tom), `"TN"` (value spot) and `"SN"` (the value date after spot). Everything adjusts modified-following onto a valid value date; month/year tenors apply the end-end rule.
- **`adjust(date, base, quote, convention?)`** — business-day adjustment on the two calendars (`following`, `modified-following`, `preceding`, `modified-preceding`).
- **`spotLag(pair)`** — 1 or 2; **`calendarFromDates(dates)`** — build a calendar.

Malformed pairs, dates and tenors throw `RangeError`.

## Conventions

- **Spot.** Each currency counts its own business days from the trade date: `spotLag` days for most currencies, but one fewer for USD. So a USD holiday on T+1 does not delay EUR/USD, while a EUR holiday on T+1 does. The later of the two dates is rolled forward until it is a business day for both currencies.
- **MXN, CLP, ARS.** For these currencies T+1 must also be a USD business day, which needs the USD calendar (`usd`, or the USD side of the pair).
- **Crosses.** A cross such as EUR/GBP ignores USD holidays on T+1, but its value date may not be a USD holiday. Spot, tom, short dates and forwards all roll past one.
- **T+1 pairs.** The single day must be a business day in both currencies, which for USD/CAD means not a US holiday.
- **Forwards.** Tenors run from spot. A target day that doesn't exist is capped at the month end (Jan 30 + 1M → Feb 28), then the date is adjusted modified-following. **End-end:** when spot is the last valid value date of its month, month/year forwards go to the last valid value date of the target month.
- **Weekends** are Saturday and Sunday for every currency. Markets with Friday/Saturday or Friday–Sunday weekends (SAR, some Gulf currencies) are not modelled.

Verified against [ObjectLab Kit](https://objectlabkit.sourceforge.net/currency.html) 1.4.0, an independent Java implementation. Over 10,956 spot dates for 12 pairs (including USD/CAD, USD/TRY, USD/MXN, EUR/MXN and four crosses) on dense random holiday calendars, every result matched. Week, month and year tenors matched too, except where ObjectLab does not apply the end-end rule, which is documented on [Wikipedia](https://en.wikipedia.org/wiki/Foreign_exchange_date_conventions). A subset is committed as `test/fixtures.ts`.

## Related

Pairs with [`fx-forward-math`](https://github.com/moshejs/fx-forward-math) (forward points, cross-rates). The equity/bond-market date counterparts are [`us-equity-market-calendar`](https://github.com/moshejs/us-equity-market-calendar) and [`sifma-holidays`](https://github.com/moshejs/sifma-holidays). Part of a markets toolkit alongside [`day-count-conventions`](https://github.com/moshejs/day-count) and [`newyorkfed`](https://github.com/moshejs/newyorkfed).

## Author

Built by **[Moshe Malka](https://moshemalka.com)** — engineering leader in New York City. Studio work at [Quentin.Code](https://www.quentin.software/).

MIT © Moshe Malka
