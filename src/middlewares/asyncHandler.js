// Express 4 does not notice when an async handler rejects: the request is left
// hanging with no response and no error. Wrapping one sends the rejection on to
// the error middleware instead.
const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

module.exports = asyncHandler;
