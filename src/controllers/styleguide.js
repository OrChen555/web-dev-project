// Every component on one page, so that whoever builds the reporter screens or
// the editor queue can see what already exists and copy it rather than invent a
// fifth kind of button.
function styleguide(req, res) {
  res.render('styleguide', { title: 'מדריך הרכיבים' });
}

module.exports = { styleguide };
