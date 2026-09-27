const Article = require('../models/article');

// The reporter's own area, two screens. Both render the frame only: everything
// on them comes from the article endpoints, so nothing is read here.

function list(req, res) {
  res.render('reporter/list', {
    title: 'ניהול כתבות',
    script: '/js/reporter-list.js',
    statuses: Article.DRAFT_STATUSES
  });
}

// The id is passed through so the script does not read it out of the address bar.
function editor(req, res) {
  res.render('reporter/editor', {
    title: 'עריכת כתבה',
    script: '/js/reporter-editor.js',
    id: req.params.id
  });
}

module.exports = { list, editor };
