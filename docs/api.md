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

The write side and the state changes are settled. **The query string on the list
endpoint needs input from person 2**, who knows what the feed requires.

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

> **needs input — person 2.** Which of these does the feed send, and is anything
> missing: `q`, `category`, `sort=recent|popular`, `seen=yes|no`, `limit`,
> `after`. And what does one card need in the response? Currently assumed:
> `id, title, summary, image, category, reporter { id, name }, publishedAt`.

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

### The editor's list — person 5

```
GET /api/articles?all=true[&status=…][&category=…][&q=…][&sort=updated|popular][&limit][&after]
    -> 200 { articles, nextCursor }   401 signed out   403 not an editor
```

Every article from every reporter. `all=true` is picked out on the route, so the
public feed never runs the editor check and the editor's list never runs the
feed's. `status` is one of:

| `status` | What it matches |
|---|---|
| `pending` | waiting for an editor — new articles and updates alike |
| `update` | published **and** a rewrite waiting: the case where the editor compares versions |
| `draft` | a working copy the reporter has not sent yet |
| `returned` | sent back with a note |
| `published` | everything readers can see, with or without a rewrite in progress |

Without `status`, everything. `q` matches part of the title, in either copy, as
literal text. Sorted by `updatedAt` by default, cursor paged like the feed.

A row is `{ id, state, isLive, hasUpdate, category, title, summary, image,
reporter { id, name }, updatedAt, publishedAt, viewCount, commentCount,
editorNote }`, the title and summary from the working copy where there is one.

### The editor's actions — person 5

```
POST   /api/articles/:id/approve    -> 200 the row       409 not pending
POST   /api/articles/:id/return     { note } -> 200      400 no note, 409 not pending
DELETE /api/articles/:id            -> 204               with its comments and views
```

All three are editor only, and approve and return go through the state machine,
which checks the role a second time. An approval of an update moves the working
copy over the published one and appends to `publishHistory`.

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
GET    /api/articles/:id/views?range=24h|7d|30d|all   -> 200   the series, editor only
```

The GET returns the buckets alongside the moments an update was published, so
that the chart can mark them:

```json
{
  "article": { "id": "…", "title": "…", "category": "news", "publishedAt": "…", "viewCount": 1520 },
  "range": "7d",
  "from": "2026-09-13T14:00:00.000Z",
  "to": "2026-09-20T14:15:00.000Z",
  "stepMinutes": 30,
  "total": 1480,
  "buckets": [ { "at": "2026-09-20T14:00:00.000Z", "count": 41 } ],
  "publications": [ { "at": "2026-09-20T13:45:00.000Z", "by": "מיכל ברנע", "first": false } ],
  "impact": [ { "at": "…", "first": false, "before": 120, "after": 310, "beforeRate": 5, "afterRate": 12.9 } ],
  "impactHours": 24
}
```

`range` defaults to `all`, the whole life of the article from its first
publication. **The buckets are summed on the server into wider windows** for
longer ranges, the narrowest of 15, 30, 60, 120, 180, 360, 720 or 1440 minutes that
keeps the answer at 400 points or fewer, so a month costs the browser the same
as a day. Windows with no views come back as zeros rather than missing, or the
line would skip over a quiet stretch. `impact` is the views in the 24 hours
before and after each publication, and per hour, so an update made this
morning is compared fairly with one made last week.

---

## Health — person 1

```
GET /api/health   -> 200 { status, database, uptime }
                     503 when the database does not answer
```

The status code carries the answer as much as the body does, so that anything
watching the server can tell without reading JSON.
