const mongoose = require('mongoose');

const { HttpError } = require('../errors');
const Article = require('../models/article');
const { seenIds } = require('./seen');

// The public feed: which published articles a query string asks for, in what
// order, and where the next page starts. It takes the query as it arrived and
// hands back documents, so the shape a reader sees stays with the controller.
// The visitor is who "seen" means: the ids this device has opened, which filter
// the feed when asked to and come back either way so each card can be marked.

const MAX_LIMIT = 50;

// Longer than any headline anyone would search for. The cap keeps a stranger
// from handing the text index a page of words to look up on every request.
const MAX_QUERY = 100;

// Paging carries the last row's sort value and its id, not an offset. Skipping
// re-reads everything before the offset, so deep pages get slower the further a
// reader scrolls, and an article published mid-scroll shifts every row after it
// so they would see one twice or miss one.
const SORTS = {
  recent: { field: 'publishedAt', order: -1 },
  popular: { field: 'viewCount', order: -1 }
};

const encode = (value, id) => Buffer.from(JSON.stringify([value, id])).toString('base64url');

// A cursor comes back from us, but it arrives in a query string like anything
// else, so it is read as something a stranger wrote. Parsing it only proves it
// was base64 and JSON: without a shape check an id of { "$gt": "" } lands in the
// query as an operator, and a sort value that is not a date reaches mongo as an
// Invalid Date and quietly matches nothing.
function decode(cursor, field) {
  let value;
  let id;

  try {
    [value, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString());
  } catch (err) {
    throw new HttpError(400, 'That is not a usable cursor');
  }

  if (typeof id !== 'string' || !mongoose.isValidObjectId(id)) {
    throw new HttpError(400, 'That is not a usable cursor');
  }

  if (field === 'publishedAt') {
    // A string, because that is what encode() produces for a Date and because
    // new Date() is too forgiving to lean on: null and true both come out as
    // 1970 rather than as an Invalid Date, and would page from the wrong end.
    const at = typeof value === 'string' ? new Date(value) : new Date(NaN);
    if (Number.isNaN(at.getTime())) throw new HttpError(400, 'That is not a usable cursor');
    return { value: at, id };
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HttpError(400, 'That is not a usable cursor');
  }

  return { value, id };
}

// Each of these reaches the query as-is, so it is either one of the values we
// know or the request is refused. An array (?category[]=a&category[]=b) is not
// a string and is refused with the rest. Left out or empty means the default.
function pick(value, allowed, name) {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new HttpError(400, `There is no such ${name} as "${String(value)}"`);
  }
  return value;
}

// Trimmed, so that "  " is no search at all rather than a search for nothing,
// and cut to the cap rather than refused: a reader who pastes a long line still
// gets results.
function searchText(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new HttpError(400, 'A search has to be a single piece of text');
  const text = [...value.trim()].slice(0, MAX_QUERY).join('').trim();
  return text || undefined;
}

async function page(query, visitorId) {
  // Checked against the keys rather than looked up on the object: SORTS.constructor
  // exists too, inherited, and would have reached mongo as a sort on nothing.
  const sort = SORTS[pick(query.sort, Object.keys(SORTS), 'sort') || 'recent'];
  const category = pick(query.category, Article.CATEGORIES, 'category');
  const q = searchText(query.q);

  // Anything that is not a whole number above zero falls back to the default.
  // Math.min alone let a negative through, and mongo reads .limit(-4) as "at most
  // none", so the feed came back empty and looked broken.
  const asked = Number(query.limit);
  const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, MAX_LIMIT) : 20;

  // Published only. A draft is not a thing the public can reach by any query.
  const where = { published: { $ne: null } };

  if (category) where.category = category;
  if (q) where.$text = { $search: q };

  // Read even when the feed is not filtered by it, because every card carries
  // the flag. Anything other than yes or no does not filter.
  const seen = await seenIds(visitorId);
  if (query.seen === 'yes') where._id = { $in: seen };
  if (query.seen === 'no') where._id = { $nin: seen };

  if (query.after) {
    const { value: at, id } = decode(String(query.after), sort.field);

    // Strictly past the last row: either the sort value is lower, or it ties
    // and the id is lower. Without the tie-break, articles published in the
    // same second would repeat or vanish between pages.
    where.$or = [
      { [sort.field]: { $lt: at } },
      { [sort.field]: at, _id: { $lt: id } }
    ];
  }

  // One more than asked for, purely to find out whether there is another page.
  const found = await Article.find(where)
    .sort({ [sort.field]: sort.order, _id: -1 })
    .limit(limit + 1)
    .populate('reporter', 'name');

  const articles = found.slice(0, limit);
  const last = articles[articles.length - 1];

  return {
    articles,
    seen: new Set(seen.map(String)),
    nextCursor: found.length > limit && last ? encode(last[sort.field], last._id) : null
  };
}

module.exports = { page };
