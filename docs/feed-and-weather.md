# PR 8: the feed and weather contracts

What [pull request 8](https://github.com/OrChen555/web-dev-project/pull/8)
(`docs/feed-contract` into `main`) changed, and why. It is person 2's part:
the reader-facing home feed and the weather widget, from the API contract down
to the indexes.

The PR started as documentation only, answering the open questions the feed
had in `docs/api.md` and `docs/data-model.md`. The implementation was built on
stacked branches on top of it, each reviewed as its own PR and merged back into
this one before it went to `main`:

| PR | Branch | What it added |
|---|---|---|
| 9 | `feature/feed-seen-filter` | The feed query moved to a service, the seen / not seen filter, 400s for unknown values |
| 10 | `feature/feed-page` | The toolbar and card template, cards drawn without a reload, filters kept in the address |
| 12 | `feature/feed-infinite-scroll` | The next 20 as the reader nears the end, end-of-feed and retry states |
| 13 | `feature/weather-widget` | The weather service, its endpoint and the sidebar widget |
| 14 | `perf/feed-indexes` | Every feed query explained on 3,000 articles, the category indexes |
| 18 | `bug/fixes` | Fixes for what review and the QA checklist found |

31 files, about 2,850 lines added and 180 removed.

---

## The decisions

The two open questions person 2 owned in `data-model.md` are answered:

**1. How large may a visitor's seen list get?** Both a cap and an expiry. The
filter uses the **1,000 articles a device most recently opened for the first
time**, and rows **expire 90 days** after that first opening. The cap keeps
`$in` / `$nin` cheap; the TTL keeps a device that stopped visiting from keeping
its rows forever. Reopening an article does not reset either.

**2. What does a feed card need?** `id, title, summary, image, category,
reporter { id, name }, publishedAt, viewCount, commentCount, seen`. No `body`.
`seen` is always sent, filtered or not, so the card can mark what the reader has
opened.

And the `needs input` block on the list endpoint in `api.md` became a contract:

| Param | Values | Default |
|---|---|---|
| `q` | free text, every word matched as part of a word | none |
| `category` | the category enum | all |
| `sort` | `recent` \| `popular` | `recent` |
| `seen` | `yes` \| `no` | both |
| `limit` | 1–50 | 20 |
| `after` | a `nextCursor` | first page |

An unknown `category`, `sort` or `seen`, a parameter sent twice, or a cursor
that does not decode is a **400**. The full text, and the weather contract,
are in [api.md](./api.md).

---

## Server

### The feed — `src/services/feed.js`

The query, the cursor and the validation moved out of
`controllers/articles.js` into a service, so the controller only shapes the
response. The controller lost about 110 lines.

- **Search matches part of a word.** The text index on `published.title`
  matched whole words only, and in Hebrew, where prefixes are glued on, `גשר`
  missed `הגשר`. Search is now a case-insensitive regular expression per word,
  every word required, final letters (ך ם ן ף ץ) matching their other form.
  Trimmed, and cut to 100 characters and 5 words.
- **Unknown values are refused**, not quietly ignored.
- **The answer is `Cache-Control: no-store`.** It carries this device's seen
  flags, and on Back the browser reused its cached copy, so an article the
  reader had just opened still showed as unread.
- `GET /api/articles?mine=true` (a reporter's own list) goes through
  `feed.mine()` in the same service.

### Seen — `src/services/seen.js`

`seenIds()` reads a device's newest 1,000 rows for the filter. `seenAmong()`
checks only the articles on the page, one lookup per id on the unique index, so
an unfiltered scroll costs nothing however long the history. `markSeen()` is an
upsert, so opening an article twice is still one row.

`models/visitorView.js` gained an index on `(visitorId, createdAt)` for the
newest 1,000, and a TTL index on `createdAt` for the 90 days.

### Views — `src/services/views.js`

New endpoint: `POST /api/articles/:id/views` → **204**, or **404** if there is
no published article with that id. No session needed; the device comes from the
visitor cookie. It does three things together:

1. adds one to `viewCount`, which the popular sort uses
2. adds one to the fifteen minute window in `viewbuckets`, for the analytics chart
3. marks the article seen for this device

**Temporary:** the feed card sends it when a reader clicks through, since there
is no article page yet. When person 3 builds the page, it counts its own views
and the `opened` call in `public/js/feed.js` must go, or each visit from the
feed counts twice.

### Weather — `src/services/weather.js`

New endpoint: `GET /api/weather?city=<key>` →
`{ city, temperature, condition, updatedAt, stale }`.

- **Five cities**, a fixed list: `tel-aviv` (the default), `jerusalem`,
  `haifa`, `beer-sheva`, `eilat`. Anything else is a **400**. Free text would
  let a stranger make us call the provider as often as they like.
- **Fetched in the background, never inside a request.** `server.js` calls
  `weather.start()` once it is listening. All five cities come in one request
  to [Open-Meteo](https://open-meteo.com) (no key), every 10 minutes, and
  readers are answered from memory.
- **Short timeouts, retried.** About one connection in five to Open-Meteo
  stalls in its TLS handshake from here. Each attempt gets 2.5 seconds, three
  attempts, then a retry in a minute.
- **When the provider fails**, readers keep the last reading. It is marked
  `stale` after 15 minutes, the lag the requirements allow, and dropped after
  three hours. With nothing to serve the answer is **503** with `Retry-After`.

`WEATHER_URL` is new in `config.js` and `.env.example`. It is optional and only
there so a test can point the service at something that fails.

### Indexes — `src/models/article.js`

| Index | |
|---|---|
| `{ category: 1 }` | **removed** |
| `{ category: 1, publishedAt: -1, _id: -1 }` | **added** |
| `{ category: 1, viewCount: -1, _id: -1 }` | **added** |
| text on `published.title` | **removed**, search is a regular expression now |

Without them a category page read 112 to 431 keys for a page of 21, sometimes
sorting in memory. With them, 21 to 41. The compound indexes also serve a bare
category filter, so the single-field one went. Every query shape, before and
after, is in the new [indexes.md](./indexes.md).

### Smaller changes

- **`src/app.js`** holds the Hebrew names of the categories and the cities in
  `app.locals`, so every view says the same thing. The server refuses to start
  if a category or city has no name, rather than showing a bare English key on
  the live site.
- **`partials/bottom.ejs`** takes `scripts: [...]` as well as a single
  `script`, loaded deferred in order after `site.js`. Noted in
  `CONTRIBUTING.md`.
- **`controllers/home.js`** loads `feed.js` and `weather.js` on the home page.

---

## Browser

### The feed — `public/js/feed.js`, `src/views/home.ejs`

- Cards drawn from a `<template>`, as text, never as HTML.
- **Search as you type**, 300 ms after the last key.
- **Category, seen and sort in the address**, so a reload, Back or a shared link
  opens the same feed. Changing a filter starts again from the first page.
- **Endless scroll**: the next 20 load as the reader nears the end, one request
  at a time. A "load more" button for anyone on a keyboard.
- **Every state**: loading skeletons, empty, error with retry, a failed next
  page with its own retry, and the end of the feed. A request that never
  answers gives up after 10 seconds.
- A card the reader has opened is marked `נקראה`.

### Weather — `public/js/weather.js`

A sidebar widget with a city select. The choice is remembered per browser. It
shows the temperature, a condition icon and text, and the time of the reading;
marks a stale reading as possibly out of date; and on a 503 offers a retry and
tries again on its own once `Retry-After` has passed.

Styles for both are in `public/css/components.css`.

---

## Testing it

Two new scripts, both run by hand:

| | |
|---|---|
| `npm run seed:demo` | **Empties the database** and writes 6 accounts and 635 published articles: 600 ordinary and 35 placed on purpose. Same data every run. Local databases only. `-- --count=3000` for the performance checks |
| `npm run seen -- <visitor cookie> [count]` | Marks every other one of the newest articles as seen for one browser. `--clear` undoes it |

The new [qa-feed.md](./qa-feed.md) is the manual checklist against that data,
sections A to L: published only, the card, search, category, seen and views,
sort, infinite scroll, no reload, bad input to the API, weather, look and feel,
and performance.

Measured on the bulk data (from `HANDOFF.md`):

| | |
|---|---|
| Feed, 3,005 articles | 21 keys for a page of 21, both sorts, also on page 20 |
| One category | 21–41 keys, down from 112–431 |
| Scrolling to the end of 1,005 articles with ties | no duplicates, nothing missing |
| 25 readers asking for the weather at once | one request to Open-Meteo |

---

## Docs touched

| | |
|---|---|
| `docs/api.md` | The feed query, the card, the views POST, the weather endpoint |
| `docs/data-model.md` | Open questions 1 and 2 answered, the index table updated |
| `docs/indexes.md` | **New.** Every feed query explained, before and after |
| `docs/qa-feed.md` | **New.** The manual checklist |
| `HANDOFF.md` | The feed, seen filter and weather marked done; person 2's tasks closed |
| `README.md` | The feed and weather under Features, `WEATHER_URL` |
| `CONTRIBUTING.md` | `scripts: [...]` on a page |

## Left for others

- **Person 3:** count views from the article page, and remove `opened` from
  `public/js/feed.js`.
- **Persons 3, 4 and 5:** the `needs input` blocks still open in `api.md`.
