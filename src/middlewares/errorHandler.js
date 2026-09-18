const logger = require('../logger');

// Mongoose reports an id it cannot parse as a CastError. From the caller's side
// such a URL simply names nothing, so it answers 404 rather than 400, and we
// avoid announcing that our ids are ObjectIds.
function statusFor(err) {
  if (err.status) return err.status;
  if (err.name === 'CastError') return 404;
  if (err.name === 'ValidationError') return 400;
  if (err.type === 'entity.parse.failed') return 400;
  return 500;
}

// The fourth parameter is what marks this as Express's error middleware, so it
// stays even though nothing here calls it.
function errorHandler(err, req, res, next) {
  const status = statusFor(err);
  const where = { status, method: req.method, url: req.originalUrl };

  if (status >= 500) logger.error(err.message, { ...where, stack: err.stack });
  else logger.warn(err.message, where);

  // A response that already began cannot be answered a second time.
  if (res.headersSent) return next(err);

  // Our own faults are recorded in full and described to the caller in one line.
  const message = status === 500 ? 'Something went wrong on our side' : err.message;

  if (req.originalUrl.startsWith('/api')) return res.status(status).json({ error: message });
  res.status(status).render('error', { title: String(status), status, message });
}

module.exports = errorHandler;
