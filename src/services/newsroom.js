const mongoose = require('mongoose');

const { HttpError } = require('../errors');
const Article = require('../models/article');
const Comment = require('../models/comment');
const ViewBucket = require('../models/viewBucket');
const VisitorView = require('../models/visitorView');

// The editor's side of the articles collection: every article whoever wrote it,
// in every state. The public feed asks "what is out", this asks "what is where".

const MAX_LIMIT = 50;

// The states as the editor filters by them. The first three are the working
// copy's status. "published" is every article readers can see, including one
// with a rewrite waiting, and "update" is exactly that rewrite case, because it
// is the one the editor has to read twice: what is out, and what would replace it.
const FILTERS = {
  draft: { draftStatus: 'draft' },
  pending: { draftStatus: 'pending' },
  returned: { draftStatus: 'returned' },
  published: { published: { $ne: null } },
  update: { published: { $ne: null }, draftStatus: 'pending' }
};

const SORTS = {
  updated: 'updatedAt',
  popular: 'viewCount'
};

const encode = (value, id) => Buffer.from(JSON.stringify([value, String(id)])).toString('base64url');

// The cursor comes back from the browser, so it is checked like anything else a
// stranger could have written: the id must be an id and not an operator, and the
// value must be the type the sort field holds.
function decode(cursor, field) {
  let value;
  let id;

  try {
    [value, id] = JSON.parse(Buffer.from(String(cursor), 'base64url').toString());
  } catch (err) {
    throw new HttpError(400, 'That is not a usable cursor');
  }

  if (typeof id !== 'string' || !mongoose.isValidObjectId(id)) {
    throw new HttpError(400, 'That is not a usable cursor');
  }

  if (field === 'updatedAt') {
    const at = typeof value === 'string' ? new Date(value) : new Date(NaN);
    if (Number.isNaN(at.getTime())) throw new HttpError(400, 'That is not a usable cursor');
    return { value: at, id };
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HttpError(400, 'That is not a usable cursor');
  }

  return { value, id };
}

// A title search typed by a person, used as a literal. Without escaping, a
// query of ".*" or "(a+)+" would be read as a pattern rather than as text.
const literal = (text) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

async function list({ status, category, q, sort, after, limit }) {
  const where = {};

  if (status) {
    if (!FILTERS[status]) throw new HttpError(400, `Status must be one of: ${Object.keys(FILTERS).join(', ')}`);
    Object.assign(where, FILTERS[status]);
  }

  if (category) {
    if (!Article.CATEGORIES.includes(category)) {
      throw new HttpError(400, `Category must be one of: ${Article.CATEGORIES.join(', ')}`);
    }
    where.category = category;
  }

  // Both titles, because an article that was never published has only the one in
  // its working copy, and a rewrite may have changed the headline.
  const text = String(q || '').trim().slice(0, 100);
  const searching = text ? [{ 'published.title': literal(text) }, { 'draft.title': literal(text) }] : null;

  if (sort && !SORTS[sort]) throw new HttpError(400, `Sort must be one of: ${Object.keys(SORTS).join(', ')}`);
  const field = SORTS[sort || 'updated'];

  const asked = Number(limit);
  const size = Number.isInteger(asked) && asked > 0 ? Math.min(asked, MAX_LIMIT) : 20;

  // Two $or conditions cannot share one key, so they meet under $and.
  const and = [];
  if (searching) and.push({ $or: searching });

  if (after) {
    const { value, id } = decode(after, field);
    and.push({ $or: [{ [field]: { $lt: value } }, { [field]: value, _id: { $lt: id } }] });
  }

  if (and.length) where.$and = and;

  // One extra row, only to learn whether another page exists.
  const found = await Article.find(where)
    .sort({ [field]: -1, _id: -1 })
    .limit(size + 1)
    .populate('reporter', 'name');

  const page = found.slice(0, size);
  const last = page[page.length - 1];

  return {
    articles: page,
    nextCursor: found.length > size && last ? encode(last[field], last._id) : null
  };
}

// The article and everything that only means something because of it. Left
// behind, the comments and view buckets would point at nothing and still be
// counted by anything that reads those collections.
async function remove(article) {
  await Promise.all([
    Comment.deleteMany({ article: article._id }),
    ViewBucket.deleteMany({ article: article._id }),
    VisitorView.deleteMany({ article: article._id })
  ]);

  await article.deleteOne();
}

module.exports = { list, remove, FILTERS: Object.keys(FILTERS), SORTS: Object.keys(SORTS) };
