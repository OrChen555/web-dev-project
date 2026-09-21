# The Daily Web

A newsroom: reporters file copy, editors approve and publish it, and readers get
a news site. Final project for the web applications course.

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

`.env` is not in version control. Copy `.env.example` and fill it in; the app
lists everything that is missing and stops, rather than failing later inside
whichever request first needed the value.

## The commands

| | |
|---|---|
| `npm install` | Dependencies. Run it first, and again after pulling |
| `npm start` | The server |
| `npm run dev` | The server, restarting on every file change |
| `npm run seed` | Wipes the database and fills it with development data |
| `npm run seed -- --bulk=3000` | The same, plus filler articles for measuring indexes |
| `npm run db:up` | MongoDB in Docker |
| `npm run db:down` | Stops it. The data survives, in a named volume |
| `npm run db:ui` | A browser view of the data at <http://localhost:8081> |

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

Set `SEED_PASSWORD` in `.env` to use something else. Two reporters rather than
one, because checking that a reporter cannot touch someone else's article needs
someone else.

## The style guide

With the server running, <http://localhost:3000/styleguide> shows every
component in the system on one page. Screens are built from those; see
[CONTRIBUTING.md](./CONTRIBUTING.md) for the rules.

## Project structure

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the layout and the conventions, and
[docs/data-model.md](./docs/data-model.md) and [docs/api.md](./docs/api.md) for
the design.

## Features

<!-- Each of us fills in their own part as it lands. -->
