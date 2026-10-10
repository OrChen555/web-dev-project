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
will warn rather than let it fail at startup.

```bash
npm install
cp .env.example .env
npm run db:up
npm run seed
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

## The commands

| | |
|---|---|
| `npm install` | Dependencies. Run it first, and again after pulling |
| `npm start` | The server |
| `npm run dev` | The server, restarting on every file change |
| `npm run seed` | **Wipes the database** and fills it with development data |
| `npm run seed -- --bulk=3000` | The same, plus filler articles for measuring indexes |
| `npm run seed:demo` | **Wipes the database** and fills it with feed demo data instead. `-- --count=3000` for more |
| `npm run seen -- <visitor cookie> [count]` | Marks articles as seen for one browser. `--clear` instead of a count undoes it |
| `npm run db:up` / `db:down` | MongoDB in Docker. The data survives `down`, in a named volume |
| `npm run db:ui` / `db:ui:down` | A browser view of the data at <http://localhost:8081> |

### About the seed

`npm run seed` **empties every collection first**, so do not run it against
anything you want to keep.

It creates four accounts and ten articles chosen to cover every state an article
can be in, including the awkward one: published, with an update waiting for the
editor. Ten deliberate articles are more useful for development than hundreds of
random ones, because random copy never produces that case.

| Account | Role | Password |
|---|---|---|
| `admin` | Editor, and the one administrator | `password` |
| `michal` | Editor | `password` |
| `dana` | Reporter | `password` |
| `yonatan` | Reporter | `password` |

Two reporters rather than one, because checking that a reporter cannot touch
someone else's article needs someone else.

### The feed demo

`npm run seed:demo` is for testing the home feed before the reporter and editor
areas can produce real articles. It **also empties every collection**, and
refuses to run against a database that is not local.

It creates six accounts (`admin` and `michal` as editors; `dana`, `yonatan`,
`noa` and `amir` as reporters, all with `password`) and 635 published articles:
600 ordinary ones over the last four months, and 35 placed on purpose, each to
prove one rule. A pending update readers must not see, an XSS title, a broken
image, a reporter whose account is gone, 25 articles in the same millisecond
across a page break. A fixed random seed writes the same data every run, so
[docs/qa-feed.md](./docs/qa-feed.md) can name what should appear where.

Until the article page exists, `npm run seen` is the quick way to see the
seen / not seen filter do anything. Take the `visitor` cookie from DevTools.

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
    scripts/            Run by hand. The seed, the feed demo, marking seen
    docs/               What was decided, and why

`src/config.js`, `db.js`, `errors.js`, `logger.js`, `session.js` and
`bootstrap.js` sit loose at the top of `src/` — they are infrastructure rather
than any one of M, V or C.

The details are in [CONTRIBUTING.md](./CONTRIBUTING.md), and the design behind
the data and the API is in [docs/data-model.md](./docs/data-model.md) and
[docs/api.md](./docs/api.md). What every feed query costs, and why the indexes
are what they are, is in [docs/indexes.md](./docs/indexes.md), and the manual
checklist for the feed and the weather is [docs/qa-feed.md](./docs/qa-feed.md).

## The style guide

With the server running and signed in, <http://localhost:3000/styleguide> shows
every component in the system on one page: buttons, fields, the four article
status badges, the article card, tables, notices, the empty state and the
loading skeleton.

**Open it before building a screen.** It is a tool for us, not part of the site:
signed-in staff only, and it does not exist in production.

The site follows the reader's light or dark preference and has a toggle in the
masthead that overrides it. Every colour pair was checked to 4.5:1 in both.

---

## Features

### Done

**Foundations** — MVC skeleton, configuration read in one place, central error
handling, a log file of errors and significant events, the MongoDB connection,
and Docker for the database.

**Data layer** — five models: users, articles, comments, view buckets and
visitor views. An article carries its published copy and its working copy at the
same time, which is what lets readers keep seeing the approved version while a
rewrite is with the editor. Every feed query explained on 3,000 articles, and
indexed where the numbers asked for it: [docs/indexes.md](./docs/indexes.md).

**Identity** — passwords hashed with bcrypt and never returned by any endpoint,
sessions stored in MongoDB so a restart does not sign anybody out, a sign-in
screen, and permission middlewares enforced on the server. Full CRUD for
accounts with an administrator-only screen. There is no self-registration: in a
newsroom it would let anyone grant themselves an editor's powers.

**Design system** — tokens, a component library, light and dark, and the style
guide above.

**Articles** — the state machine that owns every transition between the four
article states, and the feed API: search, a category filter, a seen / not seen
filter per device, sorting by date or popularity, and cursor paging. Search
matches part of a word, so `גשר` finds `הגשר`. A category or sort it does not
know is refused with a 400 rather than guessed at. "Seen" covers the 1,000
articles a device opened most recently, for 90 days.

**Views** — `POST /api/articles/:id/views` counts a view, adds it to the fifteen
minute window the analytics chart reads, and marks the article seen for that
device, all in one service. For now the feed card sends it; the article page
takes it over.

**The feed** — the home page. Cards drawn from the API; search as you type; the
category, seen and sort filters kept in the address, so a shared link or a
reload opens the same feed; and endless scrolling, with a "load more" button
for anyone on a keyboard and a retry when a page fails. Loading, empty, error
and end-of-feed states, in light and dark, down to a phone.

**Weather** — a sidebar widget for five cities, the choice remembered per
browser. It reads Open-Meteo through our own endpoint. The server fetches all
five cities in the background every ten minutes and answers readers from memory,
so nobody waits on the provider and it sees six requests an hour. When the
provider is down, readers get the last reading, marked as possibly out of date
after fifteen minutes.

### Still to come

The article page with its comments, the reporter's work area, and the editor's
queue with the analytics chart. Each is listed with its owner at the bottom of
[HANDOFF.md](./HANDOFF.md), along with everything already decided.
