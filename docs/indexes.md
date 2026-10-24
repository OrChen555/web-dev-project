# Feed indexes: what was measured

Every query shape the public feed can send, explained on a bulk seed, before
and after the indexes changed. The model in `src/models/article.js` points
here; this page is the evidence for what is and is not indexed.

## Setup

- MongoDB 7.0.43, the `mongo:7` container from `docker-compose.yml`.
- `npm run seed:demo -- --count=3000`: **3,000+ published articles** across seven categories.
  Seven categories, one article a minute, random view counts.
- A visitor with **1,000 articles seen**, the ceiling in `services/seen.js`,
  spread evenly through the feed. Two harder visitors as well: one who has seen
  only **5**, and one who has read **the newest 1,000**, the way a reader
  scrolling from the top would.
- The queries are not written out by hand. The measuring script calls the real
  `feed.page()` for each shape, captures the `find` it sends through
  mongoose's debug hook, and runs `explain('executionStats')` on exactly that.
  For each one it checks that the explained query returned what the app got;
  all 176 did.
- Page 2 uses the real `nextCursor` from page 1. A page asks for 21 rows: the
  20 shown, and one to know whether there is another page.
- **Keys** and **docs** are `totalKeysExamined` and `totalDocsExamined`. For
  a page of 21 the ideal is 21 and 21. **ms** is the median of seven runs of
  the query against a local database, after a warm-up; it is here for scale,
  and the keys are the number to read.

## What changed

| Index | Before | After |
|---|---|---|
| `{ publishedAt: -1, _id: -1 }` | yes | yes |
| `{ viewCount: -1, _id: -1 }` | yes | yes |
| `{ category: 1 }` | yes | **removed** |
| `{ category: 1, publishedAt: -1, _id: -1 }` | – | **added** |
| `{ category: 1, viewCount: -1, _id: -1 }` | – | **added** |
| text on `published.title` | yes | yes |

**Why.** With a category, the feed had no index that was both filtered by
category and in feed order. The planner either walked the whole feed order and
threw away the six other categories (one row in seven kept), or read every
article in the category through `{ category: 1 }` and sorted them in memory.
Across the 26 category shapes without a search:

- keys read for a page of 21: **10–431 before, 10–164 after**
- documents fetched: **5–431 before, 5–41 after**
- in-memory sorts: **7 before, 2 after**. The ones left after are for
  the reader who has seen five articles: the planner looks those five up by
  `_id` and sorts them, which is the right plan for so few
- the plain category feed, no seen filter: 112–151 keys before, 21–41 after

The cost before grows with the size of the site: one row in seven is
kept, so a category page reads about seven times what it shows, and the
in-memory plan reads the entire category. After, it reads what it shows.

`{ category: 1 }` went because both new indexes begin with `category`, so
anything it could serve, they serve. One index fewer to keep up on every write.

**An existing database keeps the old one.** Mongoose builds missing indexes when
the app starts but never drops one the schema no longer lists, so a database
from before this change still has `category_1` until indexes are synced.
`npm run seed:demo` does that (it calls `syncIndexes()`), and so does
`Article.syncIndexes()` on its own for a database whose data should be kept.

The indexes without a category were already exact: **21 keys, 21 documents**
for every page of the unfiltered feed, in both orders. Nothing changed there.

## What no index fixes, and why that is acceptable

**Search.** The shapes in the table below that say "text index" were measured
when search was a text index. It has since been replaced, because a text index
matches whole words only and missed Hebrew words with a prefix; search is now a
regular expression per word, matching inside words. Measured again on 3,035
articles, page 1 of 21:

| Search | Returned | Keys | Docs | ms |
|---|--:|--:|--:|--:|
| a common word, newest first | 21 | 678 | 678 | 2 |
| a common word, in one category | 21 | 127 | 127 | 1 |
| a word in one title | 1 | 3,038 | 3,038 | 8 |
| a word in no title, either sort | 0 | 3,038 | 3,038 | 5 |

The planner walks the feed order and tests each title until it has a page, so
a common word stops early and a rare one reads every article once. The old text
index read 6,000 documents for a common word; the regular expression reads at
most one per article, and never sorts in memory. The worst case grows with the
size of the site, about 2 ms per thousand articles here, which at the 500
articles of the demo is nothing. If it ever mattered, the fix is a list of
title fragments on each article with an ordinary index on it.

**Not seen, for someone who has seen the top of the feed.** A `$nin` cannot be
answered from an index, so the scan passes over every seen article before it
finds an unseen one. For the reader of the newest 1,000, the first page of
`seen=no` newest-first reads **1,021 keys** (6.67 ms). This is the reason for the
1,000 ceiling in `services/seen.js`: it is also the ceiling on this cost.
Later pages start past the seen block and read 22.

**Seen, for someone who has seen very little.** Already handled by the planner:
it looks the seen ids up in `_id` (10 keys) and sorts the handful it finds,
rather than walking the feed looking for them.

## Deep pages

Cursor paging is meant to cost the same on page 20 as on page 2. Checked on the
new indexes, following the real cursor down the feed:

| Sort | Category | Page | Keys | Docs | Plan |
|---|---|--:|--:|--:|---|
| recent | – | 2 | 21 | 21 | two ranges, merged |
| recent | – | 5 | 21 | 21 | two ranges, merged |
| recent | – | 10 | 21 | 21 | two ranges, merged |
| recent | – | 20 | 21 | 21 | two ranges, merged |
| recent | sports | 2 | 41 | 41 | IXSCAN(category_1_publishedAt_-1__id_-1) |
| recent | sports | 5 | 21 | 21 | two ranges, merged |
| recent | sports | 10 | 21 | 21 | two ranges, merged |
| recent | sports | 20 | 21 | 21 | two ranges, merged |
| popular | – | 2 | 21 | 21 | two ranges, merged |
| popular | – | 5 | 21 | 21 | two ranges, merged |
| popular | – | 10 | 21 | 21 | two ranges, merged |
| popular | – | 20 | 21 | 21 | two ranges, merged |
| popular | sports | 2 | 41 | 41 | IXSCAN(category_1_viewCount_-1__id_-1) |
| popular | sports | 5 | 21 | 21 | two ranges, merged |
| popular | sports | 10 | 21 | 21 | two ranges, merged |
| popular | sports | 20 | 21 | 21 | two ranges, merged |

Page 2 of a category reads 41 keys: that close to the top, the planner prefers
one scan of the category with the cursor as a filter, and it is right to. From
page 5 on it bounds both halves of the cursor condition in the index and
merges them, and every page reads 21.

## Every shape

Sort, category, search, seen and page, crossed. "Search matches all" is a word
in every filler headline, "matches one" is a number that appears in one.
Shapes with no second page are left out.

| Sort | Category | Search | Seen | Page | Returned | Keys before | Keys after | Docs before | Docs after | ms before | ms after | Plan before | Plan after |
|---|---|---|---|--:|--:|--:|--:|--:|--:|--:|--:|---|---|
| recent | – | – | – | 1 | 21 | 21 | 21 | 21 | 21 | 2.13 | 2.13 | publishedAt_-1__id_-1 | publishedAt_-1__id_-1 |
| recent | – | – | – | 2 | 21 | 21 | 21 | 21 | 21 | 2.31 | 3 | two ranges of publishedAt_-1__id_-1, merged | two ranges of publishedAt_-1__id_-1, merged |
| recent | – | – | yes | 1 | 21 | 62 | 62 | 62 | 62 | 3.12 | 2.7 | publishedAt_-1__id_-1 | publishedAt_-1__id_-1 |
| recent | – | – | yes | 2 | 21 | 64 | 64 | 21 | 21 | 3.41 | 5.6 | two ranges of publishedAt_-1__id_-1, merged | two ranges of publishedAt_-1__id_-1, merged |
| recent | – | – | no | 1 | 21 | 31 | 31 | 31 | 31 | 3.31 | 2.32 | publishedAt_-1__id_-1 | publishedAt_-1__id_-1 |
| recent | – | – | no | 2 | 21 | 32 | 32 | 21 | 21 | 3.04 | 2.96 | two ranges of publishedAt_-1__id_-1, merged | two ranges of publishedAt_-1__id_-1, merged |
| recent | – | matches all | – | 1 | 21 | 3000 | 3000 | 6000 | 6000 | 7.74 | 7.73 | text index, then in-memory sort | text index, then in-memory sort |
| recent | – | matches all | – | 2 | 21 | 3000 | 3000 | 6000 | 6000 | 8.74 | 8.28 | text index, then in-memory sort | text index, then in-memory sort |
| recent | – | matches all | yes | 1 | 21 | 3000 | 3000 | 6000 | 6000 | 7.79 | 7.71 | text index, then in-memory sort | text index, then in-memory sort |
| recent | – | matches all | yes | 2 | 21 | 3000 | 3000 | 6000 | 6000 | 8.3 | 8.45 | text index, then in-memory sort | text index, then in-memory sort |
| recent | – | matches all | no | 1 | 21 | 3000 | 3000 | 6000 | 6000 | 8.06 | 8.96 | text index, then in-memory sort | text index, then in-memory sort |
| recent | – | matches all | no | 2 | 21 | 3000 | 3000 | 6000 | 6000 | 8.78 | 9.85 | text index, then in-memory sort | text index, then in-memory sort |
| recent | – | matches one | – | 1 | 1 | 1 | 1 | 2 | 2 | 1.63 | 1.57 | text index, then in-memory sort | text index, then in-memory sort |
| recent | – | matches one | yes | 1 | 0 | 1 | 1 | 2 | 2 | 1.88 | 1.72 | text index, then in-memory sort | text index, then in-memory sort |
| recent | – | matches one | no | 1 | 1 | 1 | 1 | 2 | 2 | 1.86 | 1.84 | text index, then in-memory sort | text index, then in-memory sort |
| recent | sports | – | – | 1 | 21 | 144 | 21 | 144 | 21 | 1.88 | 2.27 | publishedAt_-1__id_-1 | category_1_publishedAt_-1__id_-1 |
| recent | sports | – | – | 2 | 21 | 147 | 41 | 147 | 41 | 2.18 | 4.13 | two ranges of publishedAt_-1__id_-1, merged | category_1_publishedAt_-1__id_-1 |
| recent | sports | – | yes | 1 | 21 | 431 | 62 | 431 | 21 | 2.59 | 4.11 | publishedAt_-1__id_-1 | category_1_publishedAt_-1__id_-1 |
| recent | sports | – | yes | 2 | 21 | 431 | 64 | 431 | 21 | 3.12 | 3.34 | category_1, then in-memory sort | publishedAt_-1__id_-1 + category_1_publishedAt_-1__id_-1, merged |
| recent | sports | – | no | 1 | 21 | 214 | 31 | 214 | 21 | 2.18 | 3.11 | publishedAt_-1__id_-1 | category_1_publishedAt_-1__id_-1 |
| recent | sports | – | no | 2 | 21 | 218 | 32 | 145 | 21 | 3.3 | 4.15 | two ranges of publishedAt_-1__id_-1, merged | two ranges of category_1_publishedAt_-1__id_-1, merged |
| recent | sports | matches all | – | 1 | 21 | 3000 | 3000 | 6000 | 6000 | 6.5 | 8.63 | text index, then in-memory sort | text index, then in-memory sort |
| recent | sports | matches all | – | 2 | 21 | 3000 | 3000 | 6000 | 6000 | 7.28 | 10.48 | text index, then in-memory sort | text index, then in-memory sort |
| recent | sports | matches all | yes | 1 | 21 | 3000 | 3000 | 6000 | 6000 | 7.14 | 8.8 | text index, then in-memory sort | text index, then in-memory sort |
| recent | sports | matches all | yes | 2 | 21 | 3000 | 3000 | 6000 | 6000 | 7.8 | 9 | text index, then in-memory sort | text index, then in-memory sort |
| recent | sports | matches all | no | 1 | 21 | 3000 | 3000 | 6000 | 6000 | 7.35 | 6.22 | text index, then in-memory sort | text index, then in-memory sort |
| recent | sports | matches all | no | 2 | 21 | 3000 | 3000 | 6000 | 6000 | 8.77 | 6.99 | text index, then in-memory sort | text index, then in-memory sort |
| recent | sports | matches one | – | 1 | 0 | 1 | 1 | 2 | 2 | 2.02 | 1.43 | text index, then in-memory sort | text index, then in-memory sort |
| recent | sports | matches one | yes | 1 | 0 | 1 | 1 | 2 | 2 | 2.42 | 2.46 | text index, then in-memory sort | text index, then in-memory sort |
| recent | sports | matches one | no | 1 | 0 | 1 | 1 | 2 | 2 | 2.6 | 2.65 | text index, then in-memory sort | text index, then in-memory sort |
| popular | – | – | – | 1 | 21 | 21 | 21 | 21 | 21 | 2.8 | 2.32 | viewCount_-1__id_-1 | viewCount_-1__id_-1 |
| popular | – | – | – | 2 | 21 | 21 | 21 | 21 | 21 | 4.31 | 2.76 | two ranges of viewCount_-1__id_-1, merged | two ranges of viewCount_-1__id_-1, merged |
| popular | – | – | yes | 1 | 21 | 48 | 48 | 48 | 48 | 4.51 | 3.05 | viewCount_-1__id_-1 | viewCount_-1__id_-1 |
| popular | – | – | yes | 2 | 21 | 55 | 55 | 21 | 21 | 5.42 | 4.57 | two ranges of viewCount_-1__id_-1, merged | two ranges of viewCount_-1__id_-1, merged |
| popular | – | – | no | 1 | 21 | 38 | 38 | 38 | 38 | 5.25 | 3.27 | viewCount_-1__id_-1 | viewCount_-1__id_-1 |
| popular | – | – | no | 2 | 21 | 34 | 34 | 21 | 21 | 5.28 | 4.23 | two ranges of viewCount_-1__id_-1, merged | two ranges of viewCount_-1__id_-1, merged |
| popular | – | matches all | – | 1 | 21 | 3000 | 3000 | 6000 | 6000 | 7.7 | 6.75 | text index, then in-memory sort | text index, then in-memory sort |
| popular | – | matches all | – | 2 | 21 | 3000 | 3000 | 6000 | 6000 | 8.69 | 8.21 | text index, then in-memory sort | text index, then in-memory sort |
| popular | – | matches all | yes | 1 | 21 | 3000 | 3000 | 6000 | 6000 | 8.69 | 8.45 | text index, then in-memory sort | text index, then in-memory sort |
| popular | – | matches all | yes | 2 | 21 | 3000 | 3000 | 6000 | 6000 | 9.21 | 9.68 | text index, then in-memory sort | text index, then in-memory sort |
| popular | – | matches all | no | 1 | 21 | 3000 | 3000 | 6000 | 6000 | 8.98 | 9.26 | text index, then in-memory sort | text index, then in-memory sort |
| popular | – | matches all | no | 2 | 21 | 3000 | 3000 | 6000 | 6000 | 9.84 | 10.3 | text index, then in-memory sort | text index, then in-memory sort |
| popular | – | matches one | – | 1 | 1 | 1 | 1 | 2 | 2 | 2.37 | 2.06 | text index, then in-memory sort | text index, then in-memory sort |
| popular | – | matches one | yes | 1 | 0 | 1 | 1 | 2 | 2 | 2.79 | 3.33 | text index, then in-memory sort | text index, then in-memory sort |
| popular | – | matches one | no | 1 | 1 | 1 | 1 | 2 | 2 | 3.71 | 3.42 | text index, then in-memory sort | text index, then in-memory sort |
| popular | sports | – | – | 1 | 21 | 112 | 21 | 112 | 21 | 4.13 | 4.3 | viewCount_-1__id_-1 | category_1_viewCount_-1__id_-1 |
| popular | sports | – | – | 2 | 21 | 151 | 41 | 151 | 41 | 3.55 | 3.88 | two ranges of viewCount_-1__id_-1, merged | category_1_viewCount_-1__id_-1 |
| popular | sports | – | yes | 1 | 21 | 302 | 53 | 302 | 21 | 4.9 | 3.35 | viewCount_-1__id_-1 | category_1_viewCount_-1__id_-1 |
| popular | sports | – | yes | 2 | 21 | 431 | 61 | 431 | 21 | 4.06 | 4.42 | category_1, then in-memory sort | viewCount_-1__id_-1 + category_1_viewCount_-1__id_-1, merged |
| popular | sports | – | no | 1 | 21 | 194 | 38 | 194 | 21 | 4.42 | 4.76 | viewCount_-1__id_-1 | category_1_viewCount_-1__id_-1 |
| popular | sports | – | no | 2 | 21 | 211 | 30 | 145 | 21 | 6.09 | 3.86 | two ranges of viewCount_-1__id_-1, merged | two ranges of category_1_viewCount_-1__id_-1, merged |
| popular | sports | matches all | – | 1 | 21 | 3000 | 3000 | 6000 | 6000 | 7.67 | 7.58 | text index, then in-memory sort | text index, then in-memory sort |
| popular | sports | matches all | – | 2 | 21 | 3000 | 3000 | 6000 | 6000 | 7.76 | 8.56 | text index, then in-memory sort | text index, then in-memory sort |
| popular | sports | matches all | yes | 1 | 21 | 3000 | 3000 | 6000 | 6000 | 7.82 | 10.19 | text index, then in-memory sort | text index, then in-memory sort |
| popular | sports | matches all | yes | 2 | 21 | 3000 | 3000 | 6000 | 6000 | 8.86 | 9.42 | text index, then in-memory sort | text index, then in-memory sort |
| popular | sports | matches all | no | 1 | 21 | 3000 | 3000 | 6000 | 6000 | 8.19 | 8.21 | text index, then in-memory sort | text index, then in-memory sort |
| popular | sports | matches all | no | 2 | 21 | 3000 | 3000 | 6000 | 6000 | 8.86 | 8.86 | text index, then in-memory sort | text index, then in-memory sort |
| popular | sports | matches one | – | 1 | 0 | 1 | 1 | 2 | 2 | 1.67 | 1.92 | text index, then in-memory sort | text index, then in-memory sort |
| popular | sports | matches one | yes | 1 | 0 | 1 | 1 | 2 | 2 | 2.56 | 2.77 | text index, then in-memory sort | text index, then in-memory sort |
| popular | sports | matches one | no | 1 | 0 | 1 | 1 | 2 | 2 | 2.32 | 3.53 | text index, then in-memory sort | text index, then in-memory sort |
| recent | – | – | yes, 5 seen | 1 | 5 | 10 | 10 | 5 | 5 | 2.16 | 3 | _id_, then in-memory sort | _id_, then in-memory sort |
| recent | – | – | no, 5 seen | 1 | 21 | 21 | 21 | 21 | 21 | 3 | 3.63 | publishedAt_-1__id_-1 | publishedAt_-1__id_-1 |
| recent | – | – | no, 5 seen | 2 | 21 | 22 | 22 | 21 | 21 | 2.66 | 3.07 | two ranges of publishedAt_-1__id_-1, merged | two ranges of publishedAt_-1__id_-1, merged |
| recent | sports | – | yes, 5 seen | 1 | 1 | 10 | 10 | 5 | 5 | 4.67 | 2.79 | _id_, then in-memory sort | _id_, then in-memory sort |
| recent | sports | – | no, 5 seen | 1 | 21 | 144 | 21 | 144 | 21 | 2.7 | 2.83 | publishedAt_-1__id_-1 | category_1_publishedAt_-1__id_-1 |
| recent | sports | – | no, 5 seen | 2 | 21 | 148 | 41 | 147 | 41 | 3.19 | 3.36 | two ranges of publishedAt_-1__id_-1, merged | category_1_publishedAt_-1__id_-1 |
| popular | – | – | yes, 5 seen | 1 | 5 | 10 | 10 | 5 | 5 | 1.87 | 2.12 | _id_, then in-memory sort | _id_, then in-memory sort |
| popular | – | – | no, 5 seen | 1 | 21 | 21 | 21 | 21 | 21 | 3.28 | 2.5 | viewCount_-1__id_-1 | viewCount_-1__id_-1 |
| popular | – | – | no, 5 seen | 2 | 21 | 22 | 22 | 21 | 21 | 4.16 | 3.78 | two ranges of viewCount_-1__id_-1, merged | two ranges of viewCount_-1__id_-1, merged |
| popular | sports | – | yes, 5 seen | 1 | 1 | 10 | 10 | 5 | 5 | 5.85 | 2.44 | _id_, then in-memory sort | _id_, then in-memory sort |
| popular | sports | – | no, 5 seen | 1 | 21 | 112 | 21 | 112 | 21 | 3.54 | 2.61 | viewCount_-1__id_-1 | category_1_viewCount_-1__id_-1 |
| popular | sports | – | no, 5 seen | 2 | 21 | 152 | 41 | 151 | 41 | 2.97 | 3.07 | two ranges of viewCount_-1__id_-1, merged | category_1_viewCount_-1__id_-1 |
| recent | – | – | yes, newest 1,000 seen | 1 | 21 | 21 | 21 | 21 | 21 | 2.98 | 3.46 | publishedAt_-1__id_-1 | publishedAt_-1__id_-1 |
| recent | – | – | yes, newest 1,000 seen | 2 | 21 | 22 | 22 | 21 | 21 | 3.1 | 4.71 | two ranges of publishedAt_-1__id_-1, merged | two ranges of publishedAt_-1__id_-1, merged |
| recent | – | – | no, newest 1,000 seen | 1 | 21 | 1021 | 1021 | 1021 | 1021 | 6.67 | 6.55 | publishedAt_-1__id_-1 | publishedAt_-1__id_-1 |
| recent | – | – | no, newest 1,000 seen | 2 | 21 | 22 | 22 | 21 | 21 | 4.3 | 3.91 | two ranges of publishedAt_-1__id_-1, merged | two ranges of publishedAt_-1__id_-1, merged |
| recent | sports | – | yes, newest 1,000 seen | 1 | 21 | 144 | 21 | 144 | 21 | 3.04 | 3.14 | publishedAt_-1__id_-1 | category_1_publishedAt_-1__id_-1 |
| recent | sports | – | yes, newest 1,000 seen | 2 | 21 | 148 | 41 | 147 | 41 | 3.97 | 5.09 | two ranges of publishedAt_-1__id_-1, merged | category_1_publishedAt_-1__id_-1 |
| recent | sports | – | no, newest 1,000 seen | 1 | 21 | 431 | 164 | 431 | 21 | 4.07 | 4.82 | category_1, then in-memory sort | category_1_publishedAt_-1__id_-1 |
| recent | sports | – | no, newest 1,000 seen | 2 | 21 | 148 | 22 | 147 | 21 | 4.75 | 4.17 | two ranges of publishedAt_-1__id_-1, merged | two ranges of category_1_publishedAt_-1__id_-1, merged |
| popular | – | – | yes, newest 1,000 seen | 1 | 21 | 74 | 74 | 74 | 74 | 4 | 4.05 | viewCount_-1__id_-1 | viewCount_-1__id_-1 |
| popular | – | – | yes, newest 1,000 seen | 2 | 21 | 66 | 66 | 21 | 21 | 3.98 | 5.01 | two ranges of viewCount_-1__id_-1, merged | two ranges of viewCount_-1__id_-1, merged |
| popular | – | – | no, newest 1,000 seen | 1 | 21 | 26 | 26 | 26 | 26 | 4.85 | 4 | viewCount_-1__id_-1 | viewCount_-1__id_-1 |
| popular | – | – | no, newest 1,000 seen | 2 | 21 | 29 | 29 | 21 | 21 | 5.14 | 4.87 | two ranges of viewCount_-1__id_-1, merged | two ranges of viewCount_-1__id_-1, merged |
| popular | sports | – | yes, newest 1,000 seen | 1 | 21 | 431 | 82 | 431 | 21 | 4.27 | 3.95 | category_1, then in-memory sort | category_1_viewCount_-1__id_-1 |
| popular | sports | – | yes, newest 1,000 seen | 2 | 21 | 431 | 55 | 431 | 21 | 3.76 | 3.67 | category_1, then in-memory sort | viewCount_-1__id_-1 + category_1_viewCount_-1__id_-1, merged |
| popular | sports | – | no, newest 1,000 seen | 1 | 21 | 134 | 27 | 134 | 21 | 3.72 | 4.53 | viewCount_-1__id_-1 | category_1_viewCount_-1__id_-1 |
| popular | sports | – | no, newest 1,000 seen | 2 | 21 | 175 | 28 | 98 | 21 | 6.3 | 4.73 | two ranges of viewCount_-1__id_-1, merged | two ranges of category_1_viewCount_-1__id_-1, merged |

## Repeating this

The scripts are not in the repository; they lived in a scratch directory. The
method is above: seed with `--bulk=3000`, call `feed.page()` with
`mongoose.set('debug', ...)` capturing the `find`, and explain what was
captured. Measure again whenever the feed learns a new filter.
