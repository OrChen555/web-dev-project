# QA: the home feed and the weather widget

Manual checks for person 2's part: the feed, its search, filters, sort and
endless scroll, and the weather widget. Each test says what to do and what
should happen. If what you see differs, that is a bug — note the test id.

The expectations are written against the demo data below, which is the same on
every run.

---

## Setup

```bash
npm run db:up
npm run seed:demo
npm start
```

`npm run seed:demo` **empties the database** and writes:

- 6 accounts, password `password`: `admin`, `michal` (editors) · `dana`,
  `yonatan`, `noa`, `amir` (reporters)
- **635 published articles**: 600 ordinary ones over the last four months, and
  35 placed on purpose (listed below)
- **4 things that must never appear in the feed**: three drafts whose titles
  start with `טיוטה סודית`, and an unapproved update to the newest article

`npm run seed:demo -- --count=3000` writes 3,000 ordinary articles instead of
600, for the performance tests.

### The deliberate articles

| Title | Why it is there |
|---|---|
| `נחנך גשר הרכבת החדש בחיפה` | Newest. Has a pending update titled `... — עדכון: הפקקים כבר כאן` that readers must not see |
| `פינגווינים בגן החיות התנכי חגגו יום הולדת` | The only match for `פינגווינים`, and for parts of it: `פינגווין`, `גווינ` |
| `Apple חושפת מעבד חדש למחשבים ניידים` | Search in English, case-insensitive |
| `<img src=x onerror=...> בדיקת אבטחה בכותרת` | XSS: must show as plain text |
| `כותרת ארוכה במיוחד ...` | Long title and summary |
| `כתבה עם תמונה שבורה` | Image URL that does not exist |
| `כתבה בלי תמונה בכלל` | No image |
| `כתבה של כתב שהחשבון שלו נמחק` | Reporter account does not exist |
| `הכתבה הנצפית ביותר באתר` | 250,000 views: first by popularity, 60 days old |
| `סיכום השנה בתרבות: מה ראינו ב־2025` | Published last year |
| `מבזק מחדר החדשות מספר 1` … `25` | 25 articles in the very same millisecond, across a page break |

### Marking articles as seen

Clicking a card's title marks it seen and counts a view, even though the
article page itself is still a 404 (person 3). To mark several at once without
clicking:

1. Open <http://localhost:3000> in the browser you are testing with.
2. DevTools (F12) → **Application** → **Cookies** → `http://localhost:3000` →
   copy the **value** of the `visitor` cookie (it starts with `s%3A`).
3. Run:

```bash
npm run seen -- "<the cookie value>" 5
```

It marks every other article among the newest 10 (the 2nd, 4th, 6th, 8th and 10th), and prints their titles.
`npm run seen -- "<the cookie value>" --clear` undoes it.

### Checking that nothing reloaded

Several tests say **no reload**. To check: in the DevTools console type
`window.marker = 1` before the action and `window.marker` after it. It still
answers `1` if the page did not reload. The Network tab should show only
`fetch` requests to `/api/...`, never a new document.

---

## A. Published articles only

**A1. Only published articles in the feed**
1. Open <http://localhost:3000>.
2. Type `סודית` in **חיפוש**.
- Expected: "אין כאן כתבות". None of the three `טיוטה סודית` drafts appears,
  under any filter or sort.

**A2. A pending update stays hidden**
1. Open the home page and look at the first card.
- Expected: its title is `נחנך גשר הרכבת החדש בחיפה`. The words `עדכון` or
  `הפקקים` appear nowhere on it. Searching for `הפקקים` finds nothing.

**A3. A draft cannot be reached through the API either**
1. Open <http://localhost:3000/api/articles?limit=50> and search the page
   (Ctrl+F) for `סודית`.
- Expected: not found.

---

## B. The article card

**B1. What a card shows**
1. Look at any ordinary card.
- Expected: an image on the side, the title as a link, a summary, and a line
  with **reporter · category (in Hebrew) · date · views**, for example
  `דנה לוי · כלכלה · 3 באוגוסט · 1,204 צפיות`.

**B1b. Every ordinary card has a picture**
1. Scroll through the first 100 cards.
- Expected: every card has a photo, except `כתבה בלי תמונה בכלל` and
  `כתבה עם תמונה שבורה` (B4). A photo still on its way from the image host
  shows the same grey box for a moment; that is loading, not missing.

**B2. The title leads to the article page**
1. Hover over a title.
- Expected: the status bar shows `http://localhost:3000/articles/<id>`.
  Clicking it gives a 404 until person 3 builds the page. That is expected,
  not our bug.

**B3. XSS**
1. Find the card `... בדיקת אבטחה בכותרת` (2nd from the top).
- Expected: the title shows the literal text `<img src=x onerror="alert('xss')">`.
  No alert pops up. The summary shows `<b>` as text and is **not** bold.

**B4. Missing and broken images**
1. Find `כתבה בלי תמונה בכלל` and `כתבה עם תמונה שבורה`.
- Expected: both show a grey rectangle in place of the picture. No broken-image
  icon and no empty gap. The card keeps its shape.

**B5. Long title**
1. Find `כותרת ארוכה במיוחד ...`.
- Expected: the title wraps onto several lines, and nothing spills out of the
  card or pushes the image aside. The same holds at phone width (K1).

**B6. Missing reporter**
1. Search `נמחק`.
- Expected: the byline starts with `פוליטיקה ·`. No reporter name, and no stray
  `·` before the category.

**B7. Date formats**
1. Look at any recent card, then search `2025`.
- Expected: recent cards show day and month only (`28 בספטמבר`). The 2025
  article shows the year too (`28 בדצמבר 2025`).

---

## C. Search

**C1. Exact word**
1. Type `פינגווינים`.
- Expected: after a short pause (about 0.3s), exactly one card, followed by
  "אלה כל הכתבות". No reload.

**C2. English, any case**
1. Search `apple`, then `APPLE`.
- Expected: both find `Apple חושפת מעבד חדש למחשבים ניידים`.

**C3. Part of a word**
1. Search `פינגווין` (without the ending), then `גווינ`, then `ppl`.
- Expected: each finds its one article. `פינגווין` ends in ן, while the title
  has נ in that place: the five final letters match either form.

**C3b. Several words, in any order**
1. Search `גשר חיפה`, then `חיפה גשר`.
- Expected: both find `נחנך גשר הרכבת החדש בחיפה` (`חיפה` is found inside
  `בחיפה`).

**C3c. Characters that mean something in a pattern**
1. Search `.*`, then `(`, then `\`.
- Expected: "אין כאן כתבות" each time. Not every article, and not an error:
  they are searched for as plain text.

**C4. Many results, and paging inside a search**
1. Search `מבזק`.
- Expected: 20 cards at first. Scrolling loads the rest, 25 in total, then
  "אלה כל הכתבות".

**C5. Enter does not reload**
1. Type a word and press Enter.
- Expected: results appear immediately, with no reload and no `?q=` form
  submission.

**C6. Clearing the search**
1. Clear the field.
- Expected: the full feed returns, starting again from the top.

**C7. Fast typing**
1. Type `כלכלה` quickly, then delete it quickly.
- Expected: the feed ends up matching what is in the box. A stale result never
  replaces a newer one.

---

## D. Category

**D1. Filter**
1. Choose **ספורט** in **קטגוריה**.
- Expected: every card's byline says `ספורט`. No reload.

**D2. Every category**
1. Go through all seven categories.
- Expected: each shows only its own articles and none is empty (about 86 each).

**D3. Combined with search**
1. Category **טכנולוגיה**, search `apple`.
- Expected: the Apple article. Then switch the category to **בריאות**: "אין כאן
  כתבות".

**D4. Back to all**
1. Choose **הכל**.
- Expected: the full feed again.

---

## E. Seen / not seen, and the view counter

**E0. Clicking a card**
1. Note the views on the 4th card (`פינגווינים ...`), e.g. `9,037 צפיות`.
2. Click its title. The 404 page opens (person 3's page is not built yet).
3. Press Back.
- Expected: that card now ends with `· 9,038 צפיות · נקראה`. **הצגה** →
  **רק שכבר נקראו** shows exactly this card.
4. Click it again, and Back.
- Expected: `9,039 צפיות`: every opening counts. Still one card under **רק
  שכבר נקראו**: seen is once.
5. Middle-click (or Ctrl+click) another card's title, which opens a new tab.
- Expected: on this tab the card updates at once, without a reload.

For E1–E4, clear what E0 did (`npm run seen -- "<cookie>" --clear`) and run the
steps in *Marking articles as seen* with count 5.

**E1. The marker**
1. Reload the home page.
- Expected: among the first 10 cards, every second one (2, 4, 6, 8, 10) ends
  its byline with `· נקראה`.

**E2. Seen only**
1. **הצגה** → **רק שכבר נקראו**.
- Expected: exactly the 5 marked articles, each with `נקראה`, then "אלה כל
  הכתבות".

**E3. Not seen only**
1. **הצגה** → **רק שלא נקראו**.
- Expected: the full feed without those 5. No card says `נקראה`.

**E4. Combined**
1. **רק שכבר נקראו** + search `מבזק`. Those articles are around card 45, far
   from the newest 10 that were marked.
- Expected: "אין כאן כתבות". Now **רק שלא נקראו** + `מבזק`: all 25.

**E5. Per browser**
1. Open the site in a private window (a new visitor cookie).
- Expected: nothing says `נקראה`, and **רק שכבר נקראו** is empty.

**E6. Clearing**
1. Run `npm run seen -- "<cookie>" --clear` and reload.
- Expected: no `נקראה` markers left.

---

## F. Sort

**F1. Newest first (default)**
1. Open the home page.
- Expected: `נחנך גשר הרכבת החדש בחיפה` first, then dates going down as you
  scroll.

**F2. Most viewed**
1. **מיון** → **הנצפות ביותר**.
- Expected: `הכתבה הנצפית ביותר באתר` first, with its date **30 ביולי**. The
  order changes visibly from F1.

**F3. Sort with a filter**
1. Category **ספורט** + **הנצפות ביותר**.
- Expected: the same article first (it is a sports article).

---

## G. Infinite scroll

**G1. Loads by itself**
1. On the full feed, scroll down slowly.
- Expected: 20 cards at first. Before you reach the bottom, grey placeholder
  cards appear briefly and 20 more arrive. There is no "page 2" and no reload.

**G2. No duplicates, nothing skipped**
1. On the home page, paste this into the console:

```js
let after = null, ids = new Set(), total = 0;
do {
  const r = await (await fetch('/api/articles' + (after ? '?after=' + after : ''))).json();
  r.articles.forEach((a) => { ids.add(a.id); total++; });
  after = r.nextCursor;
} while (after);
console.log(total, ids.size);
```

- Expected: `635 635`. Do the same with `?sort=popular&after=` (change the
  URL): also `635 635`.

**G3. Same-millisecond articles**
1. Scroll the default feed to about card 70.
- Expected: `מבזק מחדר החדשות מספר 25` down to `1`, each exactly once. A page
  break falls in the middle of them (cards 44–68).

**G4. End of the feed**
1. Category **בריאות**, then scroll all the way down.
- Expected: once all health articles are in, the feed ends with "אלה כל
  הכתבות". No more placeholders, and the **טעינת כתבות נוספות** button is gone.

**G5. Changing a filter mid-scroll**
1. Scroll down to about 100 cards, then change **מיון**.
- Expected: the feed starts over from the top with the new order, 20 cards,
  and no old cards mixed in.

**G6. The button, for keyboard users**
1. Reload, then press Tab repeatedly past the cards.
- Expected: there is a **טעינת כתבות נוספות** button below the cards. Enter on
  it loads 20 more and moves focus to the first new card.

**G7. A failed next page**
1. Load the feed and scroll a little.
2. Stop the server (Ctrl+C in its terminal).
3. Scroll to the bottom.
- Expected: the cards already loaded stay. A red box "לא הצלחנו לטעון עוד
  כתבות." appears with **נסו שוב**.
4. Start the server again (`npm start`) and press **נסו שוב**.
- Expected: the next 20 load and scrolling carries on.

**G8. A failed first page**
1. With the server stopped, change a filter.
- Expected: "לא הצלחנו לטעון את הכתבות. בדקו את החיבור ונסו שוב." with **נסו
  שוב**. It never gets stuck on shimmering placeholders.
2. Start the server and press **נסו שוב**.
- Expected: the feed loads.

---

## H. No reload, and the address bar

**H1. Nothing reloads**
1. Set `window.marker = 1` (see Setup), then search, change every select,
   and scroll.
- Expected: `window.marker` is still `1`.

**H2. Filters are in the address**
1. Search `מבזק`, category **חדשות**, sort **הנצפות ביותר**.
- Expected: the address bar shows `/?q=מבזק&category=news&sort=popular`.
   Reloading, or pasting it into a new tab, opens the same feed with the same
   filters selected.

**H3. Defaults stay out of the address**
1. Set everything back to the defaults.
- Expected: the address is plain `/`.

**H4. A hand-edited address**
1. Open `http://localhost:3000/?category=cars&sort=oldest&seen=maybe`.
- Expected: no error. The selects fall back to **הכל**, **כל הכתבות** and
   **החדשות ביותר**, and the full feed loads.

**H5. Back leaves the page**
1. Arrive from another page (for example `/login`), change filters a few times,
   then press Back.
- Expected: you return to `/login`, not step back through each filter.

---

## I. Bad input to the API

Open each URL in the browser. Each expected result is the status code (visible
in DevTools → Network) and the JSON body.

| # | URL | Expected |
|---|---|---|
| I1 | `/api/articles?category=cars` | 400 `There is no such category as "cars"` |
| I2 | `/api/articles?sort=oldest` | 400 `There is no such sort as "oldest"` |
| I3 | `/api/articles?after=garbage` | 400 `That is not a usable cursor` |
| I4 | `/api/articles?category[]=news` | 400, not a crash |
| I5 | `/api/articles?q[]=x` | 400 `A search has to be a single piece of text` |
| I6 | `/api/articles?limit=-5` | 200 with 20 articles |
| I7 | `/api/articles?limit=1000` | 200 with 50 articles, the maximum |
| I8 | `/api/articles?seen=maybe` | 200, not filtered |
| I9 | `/api/articles/not-an-id` | 404 `{"error": ...}` |
| I10 | `/api/weather?city=paris` | 400 `There is no such city as "paris"` |
| I11 | `/api/weather?city=__proto__` | 400, not a crash |
| I12 | `/api/articles?sort=constructor` | 400, not a crash |

Two more that need a POST, from the console:
`await fetch('/api/articles/000000000000000000000000/views', {method: 'POST'})`
answers **404** (no such article), and so does `/api/articles/nope/views`.

After all of them the server is still up (`/api/health` answers
`"status":"ok"`), and each error is in `logs/app.log`.

---

## J. Weather

**J1. It shows**
1. Open the home page.
- Expected: the sidebar card **מזג אוויר**, with a temperature (e.g. `28°`), an
  icon, a Hebrew description (e.g. `מעונן חלקית`) and `עודכן בשעה HH:MM`. Before
  that, a grey placeholder for a moment.

**J2. At most 15 minutes old**
1. Compare `עודכן בשעה` with the clock.
- Expected: no more than about 15 minutes behind (Open-Meteo updates every 15
  minutes, and our cache adds up to 10). The time is Israel time.

**J3. Changing city**
1. Choose each city in the select: תל אביב, ירושלים, חיפה, באר שבע, אילת.
- Expected: each one loads without a reload. Eilat is noticeably warmer than
  Jerusalem.

**J4. The city is remembered**
1. Choose **חיפה** and reload.
- Expected: still **חיפה**.

**J5. One request for thousands of readers**
1. Start the server and look at `logs/app.log`.
- Expected: a `weather fetched` line with `"cities":5` right after `the presses
  are running`: all five cities, one request, before any reader asks.
2. In a terminal, request a city 300 times at once:

```bash
for i in $(seq 1 300); do curl -s -o /dev/null "localhost:3000/api/weather?city=jerusalem" & done; wait
```

- Expected: all answered in well under a second, and **no** new `weather
  fetched` line. Readers are served from memory; the next fetch is 10 minutes
  after the last, whatever the traffic.

**J5b. A stalled connection is retried**
- Expected: if `logs/app.log` shows `weather attempt failed, trying again`, the
  next line within a few seconds is `weather fetched`. About one connection in
  five to Open-Meteo stalls from this network; three short attempts get
  through.

**J6. The provider is down**
1. Stop the server and start it against a host that does not exist
   (PowerShell):

```powershell
$env:WEATHER_URL="https://invalid.example/v1/forecast"; npm start
```

2. Open the home page.
- Expected: the feed works normally. The widget says "מזג האוויר לא זמין
  כרגע." with **נסו שוב**. `/api/weather` answers **503** with a
  `Retry-After` header of about a minute. `logs/app.log` has `weather attempt
  failed` twice, then `weather fetch failed`. The page never hangs.
3. Stop it, clear the variable, and start normally:

```powershell
Remove-Item Env:WEATHER_URL; npm start
```

**J7. Stale reading (optional, takes 16 minutes)**
1. Start the server so a reading is fetched, then disconnect from the internet
   (turn off Wi-Fi).
2. Wait over 15 minutes, then change the city.
- Expected: the reading still shows, with "ייתכן שהנתונים אינם עדכניים. ננסה
  שוב בקרוב." underneath it. Reconnect, and within a few minutes the widget
  refreshes by itself and the note is gone.

---

## K. Look and feel

**K1. Phone width**
1. DevTools → device toolbar (Ctrl+Shift+M) → iPhone.
- Expected: one column. The weather card is above the feed, the filters wrap
   onto two rows, and cards stack the image above the text. No sideways
   scrolling at all.

**K2. Tablet**
1. iPad size.
- Expected: nothing overlaps and nothing is cut off.

**K3. Dark mode**
1. Press the moon button in the masthead.
- Expected: everything turns dark, including cards, selects, the weather card
   and the placeholders. All text stays readable. Reloading keeps dark.

**K4. Keyboard**
1. Use Tab only, from the top.
- Expected: every field, select, card title and button can be reached, each
   with a visible focus ring.

**K5. No console errors**
1. DevTools → Console, and go through sections C to G.
- Expected: no red errors. The broken image in B4 may log one failed image
   request; that is expected.

---

## L. Performance

**L1. Thousands of articles**
1. Stop the server, run `npm run seed:demo -- --count=3000`, and start it again.
2. Open the Network tab and use the feed: scroll, search, filter, sort.
- Expected: `/api/articles` answers in tens of milliseconds, just as with 600.
   Scrolling stays smooth.

**L2. The indexes are used**
- Expected: the numbers in `docs/indexes.md`. Every feed query reads roughly as
   many index keys as the articles it returns.

When done, run `npm run seed:demo` again to return to the 600-article data the
tests above expect.
