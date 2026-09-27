const Article = require('../models/article');

// The reporter's own area. Everything on the screen comes from
// GET /api/articles?mine=true, so this only renders the frame.
function articles(req, res) {
  res.render('reporter/articles', {
    title: 'ניהול כתבות',
    script: '/js/reporter-articles.js',
    statuses: Article.DRAFT_STATUSES
  });
}

module.exports = { articles };
