// What the public sees of one article: a card in the feed, and the top of its
// own page. Kept in one place so the two cannot drift apart, and here rather
// than in a controller so that controllers share it without importing each
// other.
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

module.exports = { asCard };
