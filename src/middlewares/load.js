const asyncHandler = require('./asyncHandler');
const { HttpError } = require('../errors');

// Fetches the document named by :id and puts it on the request, so that the
// rules after it and the handler at the end all work from one read instead of
// each doing their own.
//
// Generic because the model is what changes: load(User) here, load(Article) in
// the article routes. A rule that is always the same rule gets a name instead.
const load = (Model, as = 'target') => asyncHandler(async (req, res, next) => {
  const doc = await Model.findById(req.params.id);
  if (!doc) throw new HttpError(404, `No ${Model.modelName.toLowerCase()} with that id`);

  req[as] = doc;
  next();
});

module.exports = load;
