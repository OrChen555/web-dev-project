const { HttpError } = require('../errors');
const Article = require('../models/article');
const feed = require('../services/feed');

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

async function list(req, res) {
  const { articles, seen, nextCursor } = await feed.page(req.query, req.visitorId);

  // The article page leaves this off: by the time a reader is on it, it is seen.
  const cards = articles.map((article) => ({ ...asCard(article), seen: seen.has(String(article._id)) }));

  res.json({ articles: cards, nextCursor });
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
