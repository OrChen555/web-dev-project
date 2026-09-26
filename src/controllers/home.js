function home(req, res) {
  res.render('home', { title: 'הבית', script: '/js/feed.js' });
}

module.exports = { home };
