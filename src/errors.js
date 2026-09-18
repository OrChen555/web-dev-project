// Thrown where we have already decided what the client should be told. Anything
// else that reaches the error middleware is a bug, and becomes a 500.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

module.exports = { HttpError };
