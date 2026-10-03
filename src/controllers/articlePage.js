const { HttpError } = require('../errors');
const Article = require('../models/article');
const views = require('../services/views');
const { asCard } = require('./articles');

// Rendered on the server, with the whole article in the HTML, so that a search
// engine or a reader with scripts off sees the same page.
async function page(req, res) {
  // Counted here, while rendering, rather than by a script on the page: a view
  // then counts however the reader arrived and whether or not scripts run. It
  // is also the published check. A draft is not reachable by any URL, and 404
  // rather than "not published yet", which would confirm that it exists.
  if (!(await views.record(req.params.id, req.visitorId))) throw new HttpError(404, 'No such article');

  // Read after the view is counted, so the number on the page includes it.
  const article = await Article.findById(req.params.id).populate('reporter', 'name');
  if (!article || !article.published) throw new HttpError(404, 'No such article');

  res.render('article', {
    title: article.published.title,
    description: article.published.summary,
    story: { ...asCard(article), body: article.published.body }
  });
}

module.exports = { page };
