# The editor area and Impact Analytics

What [pull request 23](https://github.com/OrChen555/web-dev-project/pull/23)
added, plus the analytics dashboard from the `analytics-improvements` branch.
Person 5's part: the editor's area, the analytics page, and the demo data.

---

## The pages

| Page | What the editor can do |
|---|---|
| `/editor/articles` | See every article. Filter by state, category and title, sort by last change or views |
| `/editor/articles/:id` | Read the article, edit it, approve and publish, return it with a note, delete it. For an update to a published article, see the live version and the new one side by side, with the changes marked |
| `/editor/analytics` | A dashboard for the whole site. Open one article from it to see its views over time, with a dashed line at every update and a before/after table |

Each page is an EJS view in `src/views/editor/` and a script in `public/js/`
(`editor-list.js`, `editor-review.js`, `editor-analytics.js`).

## The analytics page

It opens on a **dashboard for the whole site**, not on a list of articles, so it
reads as statistics and not as a place to read articles:

- **Headline numbers:** views in the range (and the change from the period
  before), articles viewed out of those live, new articles published, updates published.
- **Views over time** for all articles together.
- **The 10 most viewed articles** in the range, with their share of all views.
- **Views per category**, as a bar chart.
- **One article's report:** search a title at the bottom, or click
  "לניתוח הכתבה" in a table. The report is the per-article chart and the
  before/after table. `?article=<id>` in the address opens it directly.

One range (24 hours, 7 days, 30 days, all time) is shared by the dashboard and
the report. Default is 7 days.

## The API

| Endpoint | What it does |
|---|---|
| `GET /api/articles?all=true` | The editor's list |
| `POST /api/articles/:id/approve` | Publishes the new version |
| `POST /api/articles/:id/return` | Sends it back to the reporter. A note is required |
| `DELETE /api/articles/:id` | Deletes it, with its comments and views |
| `GET /api/articles/:id/views?range=24h\|7d\|30d\|all` | One article's chart data |
| `GET /api/analytics/overview?range=24h\|7d\|30d\|all` | The dashboard's numbers for the whole site |

All editor only. Approve and return go through the state machine
(`services/articleState.js`), which checks the role and the state again.

## The server code

| File | What it does |
|---|---|
| `controllers/editor.js` | Reads each request, calls a service, answers |
| `services/newsroom.js` | The editor's list and delete |
| `services/analytics.js` | `series`: one article's chart, the 15 minute view buckets summed into windows (at most 400 points), and the before/after numbers. `overview`: the dashboard, summed inside MongoDB |
| `routes/analytics.js` | The dashboard route, `/api/analytics/overview` |
| `services/listing.js` | Paging, search and query checks, moved out of `feed.js` so the feed and the editor's list share them |
| `models/article.js` | Two indexes for the editor's list |
| `models/viewBucket.js` | An index on `bucket`, so the dashboard can read every article in a time range |

## Decisions

- **An editor's edit of a published article goes straight to pending.** The
  editor is the one who approves it. Readers keep seeing the old version until
  then.
- **After login,** a reporter lands on their area and an editor on theirs.
- **The analytics page opens on a dashboard,** not a grid of article cards. The
  cards looked like a feed to read, and hid that the page is about numbers.
- **Chart.js** comes from npm and is served by the app, not a CDN, so it works
  without internet.

## The demo data

`npm run seed:demo` **empties the database**, then writes:

- 6 accounts: `admin`, the editor `michal`, 4 reporters. Password `password`
- 639 articles: 635 published, plus one in each state a reporter can produce
- comments, and views in fifteen minute buckets for the chart

Seed again shortly before a demo, since the times are relative to now.

This used to be `npm run seed`, which was removed once `seed:demo` covered the
same states with far more data.

## Check it yourself

1. Log in as `michal`. Filter "עדכונים לכתבות שפורסמו", open one, approve it.
2. Return a pending article: without a note it is refused.
3. Open סטטיסטיקות: the dashboard shows. Switch ranges, then search a title or
   click "לניתוח הכתבה" to open one article's report. Back returns to the dashboard.
4. Log in as `dana` and open `/editor/articles`: 403.
