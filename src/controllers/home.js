function home(req, res) {
  res.render('home', { title: 'הבית', scripts: ['/js/feed.js', '/js/weather.js'] });
}

module.exports = { home };
