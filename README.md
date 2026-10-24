# The Daily Web

A newsroom. Reporters file copy, editors approve and publish it, and readers get
a news site. Final project for the web applications course.

Node and Express on an MVC layout, MongoDB through Mongoose, pages rendered with
EJS, and plain JavaScript in the browser. No front end framework and no CSS
library: everything you see was written here.

---

## Running it

**What you need:** Node 22 or newer, and a MongoDB to point at. The compose file
here starts one, or set `MONGODB_URI` to a MongoDB you already have and skip
Docker entirely.

22 and not 20: `connect-mongo` 6 ships as an ES module, and `require()` of one
only works from Node 22 onwards. `package.json` says so under `engines`, so npm
warns rather than letting it fail at startup.

```bash
npm install
cp .env.example .env
npm run db:up
npm run seed:demo
npm start
```

Then open <http://localhost:3000>.

`.env` is never committed. Copy `.env.example` and fill it in — the app lists
everything that is missing and stops at startup, rather than failing later
inside whichever request first needed the value.

### Environment

| | |
|---|---|
| `MONGODB_URI` | **Required.** Matches the container `npm run db:up` starts |
| `SESSION_SECRET` | **Required.** Any long random string. No default on purpose: a default secret is one everybody already knows |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | **Required.** The one administrator, created at startup if it is not there |
| `PORT` | Defaults to 3000 |
| `NODE_ENV` | Leave as `development` unless the site is behind HTTPS — in production the session cookie is marked secure, and a plain `http://` host will not send it |
| `SEED_PASSWORD` | What the seeded accounts get. Defaults to `password` |
| `WEATHER_URL` | Where the weather comes from. Defaults to Open-Meteo, which needs no key; only worth setting to point a test at something else |

## Commands

| | |
|---|---|
| `npm install` | Dependencies. Run it first, and again after pulling |
| `npm start` | The server |
| `npm run dev` | The server, restarting on every file change |
| `npm run seed:demo` | **Wipes the database** and fills it with the demo data below |
| `npm run seed:demo -- --count=3000` | The same, with 3,000 ordinary articles instead of 600, for measuring indexes |
| `npm run seen -- <visitor cookie> [count]` | Marks articles as seen for one browser. `--clear` instead of a count undoes it |
| `npm run db:up` / `db:down` | MongoDB in Docker. The data survives `down`, in a named volume |
| `npm run db:ui` / `db:ui:down` | A browser view of the data at <http://localhost:8081> |

## The demo data

`npm run seed:demo` **empties every collection first** and refuses to run
against a database that is not local, so it cannot touch anything shared.

It writes **635 published articles**: 600 ordinary ones over the last four
months, and 35 placed on purpose, each to prove one rule — a pending update
readers must not see, an XSS title, a broken image, a reporter whose account is
gone, 25 articles sharing one millisecond across a page break. Alongside them
sit four hidden articles, one in each state a reporter can put one in: a draft,
one waiting for the editor, one returned with a note, and a published article
with a rewrite pending. Plus comments, and views in fifteen minute buckets.

A fixed random seed writes the same data every run, so
[docs/qa-feed.md](./docs/qa-feed.md) can name exactly what should appear where.

| Account | Role |
|---|---|
| `admin` | Editor, and the one administrator |
| `michal` | Editor |
| `dana`, `yonatan`, `noa`, `amir` | Reporters |

Every account uses `password` unless `SEED_PASSWORD` says otherwise. More than
one reporter, because checking that a reporter cannot touch someone else's
article needs someone else.

---

## Project structure

    server.js           Reads config, opens the database, then listens
    src/models/     M   Mongoose schemas
    src/views/      V   EJS templates
    src/controllers/ C  Read the request, call a service, send the response
    src/routes/         URLs to controllers. No logic
    src/services/       Domain rules. No req, no res
    src/middlewares/    Anything between the request and a handler
    public/             Served as-is: stylesheets, browser scripts, images
    scripts/            Run by hand: the demo data, marking seen
    docs/               What was decided, and why

`src/config.js`, `db.js`, `errors.js`, `logger.js`, `session.js` and
`bootstrap.js` sit loose at the top of `src/` — they are infrastructure rather
than any one of M, V or C.

## Features

**Foundations** — MVC skeleton, configuration read in one place, central error
handling, a log of errors and significant events, and Docker for the database.

**Data layer** — five models: users, articles, comments, view buckets and
visitor views. An article carries its published copy and its working copy at the
same time, which is what lets readers keep seeing the approved version while a
rewrite is with the editor.

**Identity** — bcrypt passwords never returned by any endpoint, sessions stored
in MongoDB so a restart signs nobody out, and permission middlewares enforced on
the server. Roles are read from the database on every request, so an account
demoted a minute ago stops being able to act on the next click. Full CRUD for
accounts behind an administrator-only screen. There is no self-registration: in
a newsroom it would let anyone grant themselves an editor's powers.

**The feed** (`/`) — search as you type matching part of a word, a category
filter, a seen / not seen filter per device, sorting by date or popularity, and
cursor paging with endless scroll. The filters live in the address, so a shared
link or a reload opens the same feed. A category or sort the server does not
know is refused with a 400 rather than guessed at.

**The article page** (`/articles/:id`) — rendered on the server with the whole
article in the first response, so it reads the same to a search engine or with
scripts off. Opening it counts a view.

**Comments** — posted and loaded without a reload, held to three a minute per
device by the server. Editors can correct or remove one in place; the name and
the device behind a comment cannot be rewritten.

**Reporter's area** (`/reporter/articles`) — a reporter's own articles only,
with the editor screen that autosaves into the working copy and sends an article
for approval.

**Editor's area** (`/editor/articles`) — every article in the system, filtered by
state, category and title. A review page per article with approve, return for
corrections with a required note, edit and delete. For an update to a published
article it shows the published and pending copies side by side, with the words
removed and added marked.

**Analytics** (`/editor/analytics`) — views over time against the period before,
the most viewed articles, and views per category. Per article, a Chart.js line
over 24 hours, 7 days, 30 days or its whole life, with a marker at every
approval. Views are stored in fifteen minute buckets and summed on the server,
so the chart never receives more than 400 points.

**Weather** — a sidebar widget for five cities, the choice remembered per
browser. The server fetches all five in the background every ten minutes and
answers from memory, so nobody waits on the provider and it sees six requests an
hour. When it is down, readers get the last reading, marked as possibly out of
date after fifteen minutes.

**Design system** — tokens, a component library, light and dark. The site
follows the reader's preference and has a toggle that overrides it. Every colour
pair was checked to 4.5:1 in both.

## The style guide

With the server running and signed in, <http://localhost:3000/styleguide> shows
every component on one page: buttons, fields, the four status badges, the
article card, tables, notices, the empty state and the loading skeleton.

**Open it before building a screen.** It is a tool for us, not part of the site:
signed-in staff only.

## Where things are written down

| | |
|---|---|
| [CONTRIBUTING.md](./CONTRIBUTING.md) | How the code here is written |
| [docs/data-model.md](./docs/data-model.md) | The schemas, and why they are shaped that way |
| [docs/api.md](./docs/api.md) | Every endpoint |
| [docs/indexes.md](./docs/indexes.md) | What each feed query costs, measured |
| [docs/qa-feed.md](./docs/qa-feed.md) | The manual checklist for the feed and the weather |
| [docs/editor-and-analytics.md](./docs/editor-and-analytics.md) | The editor's area and the chart |
