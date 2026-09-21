const { HttpError } = require('../errors');

// Runs only when no route matched. It answers through the error middleware so
// that every error response in the application is shaped in one place.
const notFound = (req, res, next) => next(new HttpError(404, `No route for ${req.method} ${req.originalUrl}`));

module.exports = notFound;
