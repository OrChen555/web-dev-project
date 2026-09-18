function home(req, res) {
  res.render('home', { title: 'הבית' });
}

module.exports = { home };
