const { HttpError } = require('../errors');
const views = require('../services/views');
const { asCard } = require('../services/cards');

// Rendered on the server, with the whole article in the HTML, so that a search
// engine or a reader with scripts off sees the same page. Only the comments
// need the browser.
async function page(req, res) {
  // Counted here, while rendering, rather than by a script on the page: a view
  // then counts however the reader arrived and whether or not scripts run. It
  // is also the published check. A draft is not reachable by any URL, and 404
  // rather than "not published yet", which would confirm that it exists.
  const article = await views.record(req.params.id, req.visitorId);
  if (!article) throw new HttpError(404, 'No such article');

  // The article comes back with this visit already counted, so the number on
  // the page includes it. Only the reporter's name is still to be read.
  await article.populate('reporter', 'name');

  res.render('article', {
    title: article.published.title,
    description: article.published.summary,
    script: '/js/article.js',
    story: { ...asCard(article), body: article.published.body }
  });
}

module.exports = { page };
