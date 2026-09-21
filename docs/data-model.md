# Data model

What the collections hold and why. Written before the schemas so that we argue
on this page rather than in a refactor.

Change it the way we change code: a branch, a pull request, a line in the commit
saying what moved. Sections marked **needs input** are waiting on whoever owns
that screen, and the questions at the bottom are open.

## The collections

| Collection | Holds | Written by | Read by |
|---|---|---|---|
| `users` | Reporters, editors, the one admin | Admin screen, seed | Login, bylines |
| `articles` | Copy, its published version, its working version | Reporters, editors | The feed, the article page |
| `comments` | What readers write | Readers | The article page |
| `viewbuckets` | Views, counted in time windows | The article page | The analytics chart |
| `visitorviews` | Which articles a device has opened | The article page | The seen / not seen filter |

The requirements ask for at least four models. `visitorviews` is the fifth and
exists for one reason, explained in its own section.

---

## users

```
username      String   required, unique, lowercase, trimmed
passwordHash  String   required, select: false
name          String   required          the byline the public sees
role          String   required, enum: reporter | editor
isAdmin       Boolean  default false
timestamps
```

**Why `role` has two values and not three.** The requirements describe three
kinds of user: guest, reporter, editor. Only two of them are rows. **A guest is
not a record, it is the absence of a session** — there is nothing to store about
someone who has not identified themselves.

**Why `isAdmin` is a flag and not a fourth role.** The admin does exactly one
thing an editor cannot: create users and set their role. A whole role for one
capability is more structure than the problem has. Keeping `role` to the three
kinds the requirements name also means the document and the code agree.

Four rules hold the admin account down:

1. **Exactly one, enforced by the database.** A unique index on `isAdmin`,
   partial, covering only documents where it is `true`. Mongo refuses a second.
   This is not a check in our code that somebody can forget to call.
2. **Created only at startup, from the environment.** Never through a route.
3. **The create-user endpoint ignores `isAdmin` in the body.** Sending it does
   nothing.
4. **Cannot be deleted or demoted.** Otherwise the system can be locked out of
   itself.

`passwordHash` is `select: false`, so it is left out of every query unless asked
for by name. A leak here would be one careless `res.json(user)` away otherwise.

---

## articles

This is the centre of the project. Read this section twice.

```
reporter        ObjectId  ref users, required
category        String    required, enum

published       { title, summary, body, image, publishedAt }  or null
draft           { title, summary, body, image }               or null
draftStatus     String    enum: draft | pending | returned, or null

editorNote      { text, by, at }  or null
publishHistory  [ { at, by } ]

viewCount       Number  default 0
commentCount    Number  default 0
timestamps
```

### The two subdocuments are the whole decision

`published` is what the public reads. `draft` is what is being worked on. They
exist at the same time and never overwrite each other.

The requirements are explicit about this: when a reporter edits an article that
is already out, readers keep seeing the approved version — **while it is being
written, and still after it has been sent for approval** — until an editor
approves. A single set of fields on the document cannot do that. Edit them in
place and the site publishes unapproved copy.

Approval is the only thing that moves content across: `published` takes what is
in `draft`, `draft` is cleared, and an entry is appended to `publishHistory`.

### The four states are read off the document, not stored in it

| State in the requirements | How the document looks |
|---|---|
| בהכנה | `draft` set, `draftStatus: draft` |
| ממתינה לאישור עורך | `draftStatus: pending` |
| הוחזרה לתיקונים | `draftStatus: returned`, `editorNote` set |
| פורסמה | `published` set, `draft` null, `draftStatus` null |
| **פורסמה, with an update waiting** | `published` set **and** `draftStatus: pending` |

The last row has no name in the requirements but is described in them at length.
**`draftStatus` is null whenever there is no working copy.** The enum has no
value for "nothing in progress", and leaving it at `draft` would put every
published article into the editor's queue index looking like a draft. It is set
when a draft is made and cleared again when one is approved.

It is the reason `draftStatus` is not called `status`: an article is not in one
state, it is two things at once — live to the public and mid-flow for the staff.

Expose this as a virtual so that no screen works it out for itself.

### publishHistory

Every approval appends `{ at, by }`. Without it there is no Impact Analytics:
the chart has to mark the moments an update went out, and a single `publishedAt`
that gets overwritten forgets all but the last one.

### The counters

`viewCount` and `commentCount` are kept up to date as views and comments arrive.
Sorting the feed by popularity has to read one indexed number; counting the
`viewbuckets` collection on every request would not survive a few thousand
articles.

---

## comments

```
article    ObjectId  ref articles, required
author     String    required          the name the reader typed
text       String    required, maxlength
visitorId  String    required          the device that posted it
timestamps
```

`visitorId` earns its place twice: the three-per-minute limit counts by device,
and moderation wants to see everything one device wrote.

Nothing here is trusted. `author` and `text` are whatever a stranger submitted,
and every screen that prints them uses `<%=`.

---

## viewbuckets

```
article   ObjectId  ref articles, required
bucket    Date      required          start of a fifteen minute window
count     Number    default 0
```

Unique on `(article, bucket)`. A view is one `$inc` with upsert — the document
is created by the first view in a window and incremented by the rest.

**Why not one document per view.** The requirements say the site may serve
thousands of readers at once and leave the storage decision to us. A document
per view makes the write cheap and the chart expensive: drawing a week means
reading every view in that week. Buckets invert it — the write is the same one
operation, and a week of chart data is a few hundred small documents.

**Why fifteen minutes.** The worked example in the requirements is an article
updated at 14:00, with the chart showing what the views did before and after.
Hourly buckets would smear the update into the hour containing it, which is
exactly the thing the chart exists to show.

---

## visitorviews

```
visitorId  String    required
article    ObjectId  ref articles, required
timestamps
```

Unique on `(visitorId, article)`.

This exists for the seen / not seen filter on the feed. A guest has no account,
so the only way to know what this browser has already opened is to record it
against the anonymous id in their cookie.

It cannot live in the browser. The filter combines with category, sorting and
paging over thousands of articles, so the database has to apply it — which means
the server has to know the answer.

> **Open question, see the bottom of this page.** Filtering with `$nin` over a
> visitor's list of seen articles is fine for a few hundred and poor for tens of
> thousands. Decide the ceiling before building on it.

---

## The state machine

One module owns these transitions. Nothing else writes `draftStatus`.

| From | To | Who | Also |
|---|---|---|---|
| — | `draft` | reporter | creates the article |
| `draft` | `pending` | reporter, own article only | |
| `pending` | `published` | editor | clears `draft`, appends to `publishHistory` |
| `pending` | `returned` | editor | **a note is required** |
| `returned` | `pending` | reporter, own article only | |
| published, no draft | `draft` | reporter (own) or editor | copies `published` into `draft` |

**Anything else is refused, on the server.** A reporter cannot publish their own
article. A returned article cannot jump to published. Hiding the button is not
the control; the rejection is.

Two things that look like transitions and are not:

- **An editor editing a pending article.** The requirements allow it. It changes
  `draft` and leaves `draftStatus` alone.
- **Autosave.** Writes `draft` continuously while a reporter types. This is what
  makes work survive a refresh, a closed browser or a different computer, and it
  is why the working copy lives on the server rather than in the browser.

---

## Indexes

Nothing here is decoration. The requirements ask the site to stay quick with
thousands of articles.

| Collection | Index | For |
|---|---|---|
| `users` | `username` unique | login |
| `users` | `isAdmin` unique, partial on `true` | the single admin |
| `articles` | `published.publishedAt` desc, `_id` | the feed, newest first, and its cursor |
| `articles` | `viewCount` desc, `_id` | the feed sorted by popularity, and its cursor |
| `articles` | `category` | the category filter |
| `articles` | `reporter` | a reporter's own list |
| `articles` | `draftStatus` | the editor's queue |
| `articles` | text on `published.title` | search |
| `comments` | `article`, `createdAt` | a page of comments |
| `comments` | `visitorId`, `createdAt` | the three per minute limit |
| `viewbuckets` | `article`, `bucket` unique | the upsert and the chart |
| `visitorviews` | `visitorId`, `article` unique | the seen filter |

**Paging is by cursor, not by `skip`.** Two reasons. `skip` reads and discards
everything before the offset, so deep pages get slower the further you scroll.
And an article published while a reader is scrolling shifts every later row, so
they see something twice or miss it entirely. A cursor of
`(sort field, _id)` has neither problem. Each sort order needs its own cursor.

---

## Deleting an article

Editors may delete. A delete removes the article and, with it, its comments and
its view buckets, so that nothing is left pointing at a document that is gone.

The alternative is a `deletedAt` flag that hides the article and keeps its
history. It is defensible, and it means every query in the project has to
remember to exclude deleted rows. We are choosing the simpler one; if the team
disagrees, this is the paragraph to change.

---

## Open questions

**1. How large may a visitor's seen list get?** Owner: **person 2**, with person
1. The seen / not seen filter needs a ceiling and a plan for what happens above
it. Options: cap the stored history per visitor, or expire rows after some time.

**2. What does a feed card actually need?** Owner: **person 2**. The fields the
card shows decide what the list endpoint returns. Title, image, summary,
category, reporter, published date — anything else?

**3. What does the analytics query return?** Owner: **person 5**. Buckets as
they are, or summed into larger windows for longer ranges? Does the chart ask
for a date range, or always the whole life of the article?

**4. Is the comment author free text or does it need anything else?**
Owner: **person 3**.

**5. The category list.** Owner: **the group**. The enum values are English and
stable; the Hebrew names live in the views. Which categories exist?
