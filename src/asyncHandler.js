// Wraps an async Express route handler so a rejected promise (e.g. a failed
// DB query) is passed to Express's error middleware instead of becoming an
// unhandled rejection that crashes the whole process.
module.exports = function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
};
