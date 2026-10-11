# PR 23: the editor area and Impact Analytics

What [pull request 23](https://github.com/OrChen555/web-dev-project/pull/23)
added. Person 5's part: the editor's area, the analytics chart, and the demo
data.

---

## The pages

| Page | What the editor can do |
|---|---|
| `/editor/articles` | See every article. Filter by state, category and title, sort by last change or views |
| `/editor/articles/:id` | Read the article, edit it, approve and publish, return it with a note, delete it. For an update to a published article, see the live version and the new one side by side, with the changes marked |
| `/editor/analytics` | Pick an article and see its views over time on a chart, with a dashed line at every update and a before/after table |

Each page is an EJS view in `src/views/editor/` and a script in `public/js/`
(`editor-list.js`, `editor-review.js`, `editor-analytics.js`).

## The API

| Endpoint | What it does |
|---|---|
| `GET /api/articles?all=true` | The editor's list |
| `POST /api/articles/:id/approve` | Publishes the new version |
| `POST /api/articles/:id/return` | Sends it back to the reporter. A note is required |
| `DELETE /api/articles/:id` | Deletes it, with its comments and views |
| `GET /api/articles/:id/views?range=24h\|7d\|30d\|all` | The chart data |

All editor only. Approve and return go through the state machine
(`services/articleState.js`), which checks the role and the state again.

## The server code

| File | What it does |
|---|---|
| `controllers/editor.js` | Reads each request, calls a service, answers |
| `services/newsroom.js` | The editor's list and delete |
| `services/analytics.js` | Sums the 15 minute view buckets into the chart's windows (at most 400 points), and the before/after numbers |
| `services/listing.js` | Paging, search and query checks, moved out of `feed.js` so the feed and the editor's list share them |
| `models/article.js` | Two indexes for the editor's list |

## Decisions

- **An editor's edit of a published article goes straight to pending.** The
  editor is the one who approves it. Readers keep seeing the old version until
  then.
- **After login,** a reporter lands on their area and an editor on theirs.
- **Chart.js** comes from npm and is served by the app, not a CDN, so it works
  without internet.

## The demo data

`npm run seed` **empties the database**, then writes:

- 8 accounts: `admin`, the editor `michal`, 6 reporters. Password `password`
- 510 articles in every state and category, about 30 updated after publishing
- about 1,000 comments, and views over time for the chart

The text comes from word lists in `scripts/demo-content.js`. Seed again shortly
before a demo, since the times are relative to now.

## Check it yourself

1. Log in as `michal`. Filter "עדכונים לכתבות שפורסמו", open one, approve it.
2. Return a pending article: without a note it is refused.
3. Open סטטיסטיקות, pick an article, switch ranges.
4. Log in as `dana` and open `/editor/articles`: 403.
