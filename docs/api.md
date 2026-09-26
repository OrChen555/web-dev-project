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

POST   /api/articles/:id/submit    reporter, own article
POST   /api/articles/:id/approve   editor
POST   /api/articles/:id/return    editor, { note } required
```

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

> **needs input — persons 4 and 5.** The reporter's own list and the editor's
> queue are the same collection with a different filter. Say what you need:
> probably `mine=true` for the reporter and `status=pending` for the editor.

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

---

## Health — person 1

```
GET /api/health   -> 200 { status, database, uptime }
                     503 when the database does not answer
```

The status code carries the answer as much as the body does, so that anything
watching the server can tell without reading JSON.
