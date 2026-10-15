const Comment = require('../models/comment');

const LIMIT = 3;
const WINDOW_MS = 60 * 1000;

// Counts by device, not by article: three comments a minute is about how fast
// one browser may write, wherever it writes. The index on (visitorId, createdAt)
// exists for this one query.
//
// Returns how many seconds until the device may post again, or 0 if it may now.
async function secondsUntilAllowed(visitorId, now = Date.now()) {
  const recent = await Comment.find({
    visitorId,
    createdAt: { $gte: new Date(now - WINDOW_MS) }
  }).sort({ createdAt: 1 }).limit(LIMIT).select('createdAt');

  if (recent.length < LIMIT) return 0;

  // The window slides: the oldest of the three leaving it is what frees a slot.
  const free = recent[0].createdAt.getTime() + WINDOW_MS;
  return Math.max(1, Math.ceil((free - now) / 1000));
}

// The end of the queue for each device that has a comment in progress.
const queues = new Map();

// Checking the limit and saving the comment are two steps. Run side by side,
// ten requests from one device all passed the check before any of them had
// saved, and up to all ten got in. So each device's requests take turns: the
// next one starts only when the one before it has saved or been refused, and
// always sees it. Other devices are not held up.
//
// The queue lives in this process, which is enough because the site runs as one.
// A second server process would need the database to do the counting instead.
function takeTurns(visitorId, task) {
  const before = queues.get(visitorId) || Promise.resolve();
  const turn = before.then(task, task);
  const done = turn.catch(() => {});

  queues.set(visitorId, done);
  done.then(() => {
    if (queues.get(visitorId) === done) queues.delete(visitorId);
  });

  return turn;
}

// Saves the comment if the device is under the limit. Answers { comment } when
// it was saved, or { wait } with the seconds until it may post again.
function admit(visitorId, save) {
  return takeTurns(visitorId, async () => {
    const wait = await secondsUntilAllowed(visitorId);
    if (wait > 0) return { wait };
    return { comment: await save() };
  });
}

module.exports = { admit, secondsUntilAllowed, LIMIT, WINDOW_MS };
