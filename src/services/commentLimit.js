const Comment = require('../models/comment');

const LIMIT = 3;
const WINDOW_MS = 60 * 1000;

// Counts by device, not by article: three comments a minute is about how fast
// one browser may write, wherever it writes. The index on (visitorId, createdAt)
// exists for this one query.
//
// Returns how many seconds until the device may post again, or 0 if it may now.
// Two requests landing in the same instant can both pass the check. That is
// accepted: the limit is there to stop flooding, not to be an exact ledger.
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

module.exports = { secondsUntilAllowed, LIMIT, WINDOW_MS };
