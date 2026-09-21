const logger = require('../logger');
const { HttpError } = require('../errors');

// Decides both the code and the wording, because some of these errors carry a
// message written for us rather than for whoever is asking.
//
// A CastError means mongoose could not read the id. From the caller's side that
// URL simply names nothing, so it answers 404 rather than 400 — and its own
// message says the model name, the field and that we use mongoose, so it is
// replaced rather than forwarded.
function describe(err) {
  // instanceof, not err.status. Libraries set a status of their own: body-parser
  // marks a malformed body 400 and attaches its own wording, which would then be
  // forwarded untouched. Only a message we wrote ourselves is safe to repeat.
  if (err instanceof HttpError) return { status: err.status, message: err.message };
  if (err.name === 'CastError') return { status: 404, message: 'No such thing' };
  if (err.name === 'ValidationError') return { status: 400, message: 'Some of the values are not valid' };
  if (err.type === 'entity.parse.failed') return { status: 400, message: 'The request body is not valid JSON' };
  return { status: 500, message: 'Something went wrong on our side' };
}

// The fourth parameter is what marks this as Express's error middleware, so it
// stays even though nothing here calls it.
function errorHandler(err, req, res, next) {
  const { status, message } = describe(err);
  const where = { status, method: req.method, url: req.originalUrl };

  if (status >= 500) logger.error(err.message, { ...where, stack: err.stack });
  else logger.warn(err.message, where);

  // A response that already began cannot be answered a second time.
  if (res.headersSent) return next(err);

  // The trailing slash matters: without it /apiary would answer with JSON.
  if (req.originalUrl.startsWith('/api/')) return res.status(status).json({ error: message });

  // 401 on a page means nobody is signed in, and the useful answer to that is the
  // login screen rather than an error page saying so. Doing it here rather than
  // in a second guard means every page route added later gets it too.
  if (status === 401) return res.redirect('/login');

  res.status(status).render('error', { title: String(status), status, message });
}

module.exports = errorHandler;
