const { HttpError } = require('../errors');
const Article = require('../models/article');

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

// Paging carries the last row's sort value and its id, not an offset. Skipping
// re-reads everything before the offset, so deep pages get slower the further a
// reader scrolls, and an article published mid-scroll shifts every row after it
// so they would see one twice or miss one.
const SORTS = {
  recent: { field: 'publishedAt', order: -1 },
  popular: { field: 'viewCount', order: -1 }
};

const encode = (value, id) => Buffer.from(JSON.stringify([value, id])).toString('base64url');

function decode(cursor) {
  try {
    const [value, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    return { value, id };
  } catch (err) {
    throw new HttpError(400, 'That is not a usable cursor');
  }
}

async function list(req, res) {
  const sort = SORTS[req.query.sort] || SORTS.recent;
  const limit = Math.min(Number(req.query.limit) || 20, MAX_LIMIT);

  // Published only. A draft is not a thing the public can reach by any query.
  const where = { published: { $ne: null } };

  if (req.query.category) where.category = String(req.query.category);
  if (req.query.q) where.$text = { $search: String(req.query.q) };

  if (req.query.after) {
    const { value, id } = decode(String(req.query.after));
    const at = sort.field === 'publishedAt' ? new Date(value) : value;

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

module.exports = { list, one };
