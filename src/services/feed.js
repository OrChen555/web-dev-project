const { HttpError } = require('../errors');
const Article = require('../models/article');
const { seenIds, seenAmong } = require('./seen');
const { pick, searchText, titleContains, limitOf, run } = require('./listing');

// The public feed: which published articles a query string asks for, in what
// order, and where the next page starts. It takes the query as it arrived and
// hands back documents, so the shape a reader sees stays with the controller.
// The visitor is who "seen" means: the ids this device has opened, which filter
// the feed when asked to and come back either way so each card can be marked.

// Paging carries the last row's sort value and its id, not an offset. Skipping
// re-reads everything before the offset, so deep pages get slower the further a
// reader scrolls, and an article published mid-scroll shifts every row after it
// so they would see one twice or miss one. The paging, the search and the query
// string checks themselves live in services/listing.js, shared with the
// editor's list.
const SORTS = {
  recent: { field: 'publishedAt', order: -1 },
  popular: { field: 'viewCount', order: -1 }
};

// A reporter's own list. Not one of the feed's keys: an article that is not out
// has no publish date and no views, so every draft would tie.
const UPDATED = { field: 'updatedAt', order: -1 };

async function page(query, visitorId) {
  // Checked against the keys rather than looked up on the object: SORTS.constructor
  // exists too, inherited, and would have reached mongo as a sort on nothing.
  const sort = SORTS[pick(query.sort, Object.keys(SORTS), 'sort') || 'recent'];
  const category = pick(query.category, Article.CATEGORIES, 'category');
  // Refused like the others, so a typo in the client is an error rather than a
  // filter that quietly does nothing.
  const seenFilter = pick(query.seen, ['yes', 'no'], 'seen filter');
  const q = searchText(query.q);
  const limit = limitOf(query.limit);

  // Published only. A draft is not a thing the public can reach by any query.
  const where = { published: { $ne: null } };

  if (category) where.category = category;
  if (q) where.$and = titleContains(q);

  // Filtering needs the whole list before the query runs. Without a filter only
  // this page's cards need the flag, so they are looked up after it instead.
  if (seenFilter) {
    const seen = await seenIds(visitorId);
    where._id = seenFilter === 'yes' ? { $in: seen } : { $nin: seen };

    const { articles, nextCursor } = await run(where, sort, limit, query.after);
    return { articles, seen: new Set(seen.map(String)), nextCursor };
  }

  const { articles, nextCursor } = await run(where, sort, limit, query.after);
  const seen = await seenAmong(visitorId, articles.map((article) => article._id));

  return { articles, seen: new Set(seen.map(String)), nextCursor };
}

// A reporter's own work in every state, newest edit first. Drafts are included
// here and only here, so the reporter is required rather than optional.
async function mine(query, reporterId) {
  const where = { reporter: reporterId };

  if (query.status) {
    const status = String(query.status);
    if (!Article.DRAFT_STATUSES.includes(status)) {
      throw new HttpError(400, `Status must be one of: ${Article.DRAFT_STATUSES.join(', ')}`);
    }
    where.draftStatus = status;
  }

  const category = pick(query.category, Article.CATEGORIES, 'category');
  if (category) where.category = category;

  // The title search reads published.title only, so it would miss every draft.
  if (query.q) throw new HttpError(400, 'Searching your own articles is not supported yet');

  return run(where, UPDATED, limitOf(query.limit), query.after);
}

module.exports = { page, mine };
