# HTTP API

The conventions every endpoint keeps to, and a list of the endpoints themselves.

The conventions are settled and apply to all of us. The endpoint details are not:
each section says who owns it, and the ones marked **needs input** are waiting on
that person to say what their screen actually needs. Fill yours in and open a
pull request against this file.

The data these endpoints move is described in [data-model.md](./data-model.md).

---

## One rule above the others

    /api/*        answers with JSON
    everything else   renders a page

The error middleware decides how to reply by reading that off the URL, so an
endpoint that breaks the rule gets the wrong kind of response when it fails.
This is why the health check lives at `/api/health` and not `/health`.

---

## URLs

A path names a **thing**, and the verb says what is being done to it.

```
GET    /api/articles          the collection
POST   /api/articles          add to it
GET    /api/articles/:id      one of them
PATCH  /api/articles/:id      change part of one
DELETE /api/articles/:id      remove one
```

Not `/api/getArticles`, not `/api/deleteArticle?id=5`. The verb is never in the
path.

State changes are the one place this bends. Approving an article is not an edit
of a field, it is an action with rules attached, so it reads as one:

```
POST   /api/articles/:id/submit     reporter sends it to the editor
POST   /api/articles/:id/approve    editor publishes it
POST   /api/articles/:id/return     editor sends it back, with a note
```

## Status codes

| Code | When |
|---|---|
| 200 | Fine |
| 201 | Created. Comes with a `Location` header |
| 204 | Fine, nothing to send back. Used after DELETE |
| 400 | The request was malformed or failed validation |
| 401 | We do not know who you are |
| 403 | We know, and you may not |
| 404 | No such thing |
| 429 | Too many requests, too quickly |
| 500 | Our fault |

**401 against 403** comes up a lot. 401 is *who are you*; 403 is *I know who you
are and the answer is still no*. A reporter trying to publish their own article
is a **403**.

## Errors

Every failure, whatever caused it, comes back in the same shape:

```json
{ "error": "No route for GET /api/nope" }
```

On a 500 the text is deliberately vague. The real message and its stack go to
`logs/app.log`, because a stack trace sent to the browser hands out our paths,
our libraries and their versions.

## Paging

Lists are paged by **cursor**, not by page number.

```
GET /api/articles?limit=20
    -> { "articles": [ ... ], "nextCursor": "..." }

GET /api/articles?limit=20&after=<nextCursor>
```

`nextCursor` is null on the last page. Two reasons it is not `?page=2`: skipping
re-reads and throws away everything before the offset, so deep pages get slower
the further a reader scrolls; and an article published mid-scroll shifts every
row after it, so the reader sees something twice or misses it. The cursor is tied
to the sort order, so **changing `sort` means starting again** without `after`.

## Identity

Sessions are cookies, `httpOnly` and signed. **No endpoint ever reads a role out
of the request body, a query string or a header.** The role comes from the
session, server side, on every request. A screen that hides a button has hidden a
button and nothing more.

Guests are identified by a separate anonymous `visitorId` cookie, which is what
makes the seen filter, the view count and the comment limit possible without an
account.

## Dates

ISO 8601 in UTC, as JSON gives them: `2026-09-20T14:07:00.000Z`. Formatting for
a Hebrew reader happens in the view, not in the API.

---

# The endpoints

## Session — person 1

```
POST   /api/session     { username, password }  -> 200 { id, name, role, isAdmin }
                                                   401 on a bad pair
DELETE /api/session                             -> 204
```

Login posts JSON rather than submitting a form to `/login`, so that the one rule
at the top holds without an exception.

There is **no registration endpoint**. Accounts are created by the administrator;
self-registration in a newsroom would let anyone grant themselves an editor's
powers.

## Users — person 1

```
GET    /api/users            -> 200 [ { id, username, name, role, isAdmin } ]
POST   /api/users            { username, password, name, role } -> 201
PATCH  /api/users/:id        { name?, role? }                   -> 200
DELETE /api/users/:id                                           -> 204
```

Administrator only. `isAdmin` is read-only: it is reported so the screen knows
which row is the administrator, and ignored if it appears in a body. The one
administrator is created at startup from the environment and cannot be made,
deleted or demoted through the API.

A password is at least 8 characters, checked in the model so that every route
that sets one is covered.

## Articles — person 1 builds these, persons 2, 4 and 5 read them

The write side and the state changes are settled. The query string on the list
endpoint and the card it returns are set by person 2, below.

```
GET    /api/articles         the public feed. Published only
GET    /api/articles/:id
POST   /api/articles         { category, title, summary, body, image } -> 201
PATCH  /api/articles/:id     saves into the working copy. This is the autosave
DELETE /api/articles/:id     editor only

POST   /api/articles/:id/revise 
POST   /api/articles/:id/submit    reporter, own article
POST   /api/articles/:id/approve   editor
POST   /api/articles/:id/return    editor, { note } required
```

**`revise`** is how an article that is already out gets rewritten. It copies the
published copy into the working one and answers 200 with it, ready to be edited.
`published` is left alone, so readers carry on seeing the approved version while
the rewrite is written and after it is sent — until an editor approves it.

**`PATCH`** is the autosave. Every field is optional and only the ones sent are
written, so a request carries whatever has changed:

```
PATCH /api/articles/:id   { title?, summary?, body?, image? }  -> 200 the draft
```

Every value has to be text: anything else is a **400**, rather than a client's
mistake being stored as somebody's headline. Emptying `title`, `summary` or `body`
keeps its previous value, because clearing a box to retype it is not a mistake
worth refusing mid-sentence; emptying `image` removes it, since it is the one
field that is not required. **`category` is
refused with a 400**: there is one on the article rather than one per version, so
changing it would reach readers with no editor approval. It is chosen at creation.

It writes `draft` and nothing else — never `published`, never `draftStatus`. Who
may call it depends on where the article is:

| The article | Who may edit it |
|---|---|
| `draft` or `returned` | the reporter who owns it, or any editor |
| `pending` | an editor only. It has been handed over |
| published with no working copy | nobody: **409**, revise it first |

### The feed query — person 2

All six are optional and combine freely. Leave one out, or send it empty, and it
does not filter. Sending `q`, `category`, `sort` or `seen` twice
(`?category=news&category=sports`) is a **400**.

| Param | Values | Default | Notes |
|---|---|---|---|
| `q` | free text | none | Text search on the published title. Trimmed and cut to 100 characters; blank means no search |
| `category` | one of the category enum | all | An unknown value is a **400** |
| `sort` | `recent` \| `popular` | `recent` | `popular` is by `viewCount`. Anything else is a **400** |
| `seen` | `yes` \| `no` | both | Against this device's `visitorId`. Anything else is a **400**. See the ceiling below |
| `limit` | whole number, 1–50 | 20 | Out of range or not a number falls back to 20; above 50 is cut to 50 |
| `after` | a `nextCursor` | first page | A cursor that does not decode is a **400** |

```
GET /api/articles?category=sports&sort=popular&seen=no&limit=20
    -> 200 { "articles": [ card, ... ], "nextCursor": "..." | null }
```

Changing `q`, `category`, `sort` or `seen` means starting again without
`after`. The cursor only knows its position in one ordering of one result set.

**The seen ceiling.** "Seen" means first opened on this device in the last 90
days, among the 1,000 articles it opened most recently for the first time.
Anything older or further back counts as not seen again, and opening it again
does not reset the clock. The reasoning is in
[data-model.md](./data-model.md#open-questions), question 1.

The 1,000 cap applies to the filter only. Without `seen`, each card's `seen`
flag is looked up for that page's articles alone, so a reader with a long
history can see `seen: true` on a card that `?seen=no` would still list.

### One card

```json
{
  "id": "66f1c0...",
  "title": "...",
  "summary": "...",
  "image": "https://example.com/photo.jpg",
  "category": "sports",
  "reporter": { "id": "66f1b9...", "name": "..." },
  "publishedAt": "2026-09-20T14:07:00.000Z",
  "viewCount": 1204,
  "commentCount": 17,
  "seen": true
}
```

- **`seen`** is always present, even when the request did not filter by it, so
  the card can mark articles the reader has already opened.
- **`viewCount` and `commentCount`** are shown on the card, and `viewCount` is
  what `sort=popular` orders by.
- **No `body`.** The feed never sends the article text; `GET /api/articles/:id`
  does, alongside the card fields other than `seen`.

### A reporter's own articles

```
GET /api/articles?mine=true[&status=draft|pending|returned]
    -> 200 { articles, nextCursor }   401 signed out
```

Their own work in every state, ordered by `updatedAt`. Not by either feed key: an
article that is not out has no publish date and no views, so every draft would tie.
`q` is a **400** here — the text index covers `published.title` only.

A row is the working copy where there is one, the published copy otherwise, plus
`state`, `updatedAt` and `editorNote` — null unless an editor sent it back.

`GET /api/articles/:id` answers **whoever may edit it** — the owner or any editor —
with that same row plus `published` and `draft` in full. Everybody else gets the
public copy, or **404** if it is not out; 404 rather than 403, because a 403 would
confirm the article exists.

> **needs input — person 5.** The editor's queue is the same collection with
> `status=pending` across every reporter. Say how you want it asked for.

## Comments — person 1 builds these, person 3 reads them

```
GET    /api/articles/:id/comments   -> 200 [ { id, author, text, createdAt } ]
POST   /api/articles/:id/comments   { author, text } -> 201 the new comment
DELETE /api/comments/:id            editor only
```

The POST returns **the one created comment**, so the page can append it to the
list. The requirement is that a new comment appears without reloading the whole
list, which means not re-fetching the collection after posting.

Three per minute per device, enforced server side. Over that is **429** with a
message meant for a reader to see, not a bare status code.

> **needs input — person 3.** Are `author` and `text` the whole form? Does the
> list need paging, or does an article show all of its comments?

## Views — person 1 builds these, person 3 writes, person 5 reads

```
POST   /api/articles/:id/views   -> 204   counts one view
GET    /api/articles/:id/views   -> 200   the series for the chart
```

The GET returns the buckets alongside the moments an update was published, so
that the chart can mark them:

```json
{
  "buckets": [ { "at": "2026-09-20T14:00:00.000Z", "count": 41 } ],
  "publications": [ { "at": "2026-09-20T13:45:00.000Z" } ]
}
```

> **needs input — person 5.** Does the chart ask for a date range or always the
> whole life of the article? For a long range, should buckets be summed into
> wider windows before they are sent?

## Weather — person 2

```
GET /api/weather?city=<key>   -> 200 { city, temperature, condition, updatedAt, stale }
                                 400 for a city not on the list
                                 503 when there is no reading to give, with Retry-After
```

```json
{
  "city": "tel-aviv",
  "temperature": 25,
  "condition": "partly-cloudy",
  "updatedAt": "2026-09-26T19:30:00.000Z",
  "stale": false
}
```

The widget on the home page reads this, never the provider directly. Going
through our server lets us swap providers without touching the page, and lets
one cached answer serve every reader instead of each of them calling out. The
provider is [Open-Meteo](https://open-meteo.com), which needs no key.

- **`city`** is one of `tel-aviv`, `jerusalem`, `haifa`, `beer-sheva`,
  `eilat`. Left out or empty means `tel-aviv`. Anything else, including the
  wrong case or the parameter sent twice, is a **400**. A fixed list because
  each city is a request to somebody else's service; the Hebrew names belong to
  the view, the same as categories.
- **`temperature`** is in °C, a whole number.
- **`condition`** is one of `clear`, `partly-cloudy`, `cloudy`, `fog`,
  `drizzle`, `rain`, `snow`, `thunderstorm`. The Hebrew text and the icon
  are chosen in the view.
- **`updatedAt`** is when the provider took the reading, not when this
  request was answered.
- **Cached server side for 10 minutes, per city.** Readers who ask while a city
  is being fetched share that one request.
- **When the provider fails** (an error, a 4 second timeout, or an answer in a
  shape we do not recognise), the last reading is served with `stale: true`,
  for up to three hours after it was taken. After a failure the provider is left
  alone for a minute, so an outage does not make every page wait out the
  timeout.
- **With nothing to serve** the answer is **503** with the usual `{ error }`
  body and a `Retry-After` header. The widget says the weather is not
  available, offers a retry, and tries again on its own once `Retry-After` has
  passed. If it already had a reading, it keeps showing it, marked as possibly
  out of date.

---

## Health — person 1

```
GET /api/health   -> 200 { status, database, uptime }
                     503 when the database does not answer
```

The status code carries the answer as much as the body does, so that anything
watching the server can tell without reading JSON.
