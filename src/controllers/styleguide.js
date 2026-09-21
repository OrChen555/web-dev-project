const config = require('../config');
const { HttpError } = require('../errors');

// Every component on one page, so that whoever builds the reporter screens or
// the editor queue can see what already exists and copy it rather than invent a
// fifth kind of button.
//
// It is a tool for the people building the site, not part of it: signed in
// staff only, and in production it does not exist at all. A 404 rather than a
// 403, so that it does not advertise itself.
function styleguide(req, res) {
  if (config.isProduction) throw new HttpError(404, `No route for ${req.method} ${req.originalUrl}`);
  res.render('styleguide', { title: 'מדריך הרכיבים' });
}

module.exports = { styleguide };
