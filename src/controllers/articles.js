const mongoose = require('mongoose');

const { HttpError } = require('../errors');
const Article = require('../models/article');
const { apply } = require('../services/articleState');
const logger = require('../logger');

const MAX_LIMIT = 50;

// What the feed shows for one article. Kept in one place so the card and the
// article page cannot drift apart.
const asCard = (article) => ({
  id: article._id,
  title: article.published.title,
  summary: article.published.summary,
  image: article.published.image || null,
  category: article.category,
  reporter: article.reporter && { id: article.reporter._id, name: article.reporter.name },
  publishedAt: article.publishedAt,
  viewCount: article.viewCount,
  commentCount: article.commentCount
});

//asCard for the draft article. (no publishedAt, viewCount, commentCount )
const asDraft = (article) => ({
  id: String(article._id),
  state: article.state,
  category: article.category,
  title: article.draft.title,
  summary: article.draft.summary,
  body: article.draft.body,
  image: article.draft.image || null
});

// Picked out one at a time. reporter and draftStatus are missing on purpose: 
// a field that is never read cannot be forged.
const readBody = (body) => ({
  category: String(body.category || ''),
  title: String(body.title || '').trim(),
  summary: String(body.summary || '').trim(),
  body: String(body.body || '').trim(),
  image: String(body.image || '').trim()
});

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

async function list(req, res) {
  const sort = SORTS[req.query.sort] || SORTS.recent;
  // Anything that is not a whole number above zero falls back to the default.
  // Math.min alone let a negative through, and mongo reads .limit(-4) as "at most
  // none", so the feed came back empty and looked broken.
  const asked = Number(req.query.limit);
  const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, MAX_LIMIT) : 20;

  // Published only. A draft is not a thing the public can reach by any query.
  const where = { published: { $ne: null } };

  if (req.query.category) where.category = String(req.query.category);
  if (req.query.q) where.$text = { $search: String(req.query.q) };

  if (req.query.after) {
    const { value: at, id } = decode(String(req.query.after), sort.field);

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

  const page = found.slice(0, limit);
  const last = page[page.length - 1];

  res.json({
    articles: page.map(asCard),
    nextCursor: found.length > limit && last ? encode(last[sort.field], last._id) : null
  });
}

async function one(req, res) {
  const article = await Article.findById(req.params.id).populate('reporter', 'name');

  // An article that has never been approved does not exist as far as a reader
  // is concerned, and saying "not published yet" would confirm that it exists.
  if (!article || !article.published) throw new HttpError(404, 'No such article');

  res.json({
    ...asCard(article),
    body: article.published.body
  });
}

// Validates what the reporter typed and creates the article as a draft. 
async function create(req, res) {
  const { category, title, summary, body, image } = readBody(req.body);

  if (!title || !summary || !body) throw new HttpError(400, 'A title, a summary and a body are all required');
  if (!Article.CATEGORIES.includes(category)) {
    throw new HttpError(400, `Category must be one of: ${Article.CATEGORIES.join(', ')}`);
  }

  const article = await Article.create({
    category,
    draft: { title, summary, body, image: image || undefined },
    draftStatus: 'draft'
  });

  logger.info('article created', { by: req.user.username, article: String(article._id), category });

  // No Location header: it would name a URL that 404s until this is published.
  res.status(201).json(asDraft(article));
}

async function submit(req, res) {
  const article = req.target;
  apply(article, 'submit', req.user);
  await article.save();

  logger.info('article submitted', { by: req.user.username, article: String(article._id) });

  res.json({ id: String(article._id), state: article.state });
}

module.exports = { list, one, create, submit };
