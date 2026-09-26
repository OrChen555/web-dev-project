const VisitorView = require('../models/visitorView');

// What a device has already opened, for the seen and not seen filter on the
// feed and the flag on each card.
//
// The feed filters with $in / $nin over this list, which is cheap for a
// thousand ids and poor for tens of thousands, so only the newest thousand
// count. Anything further back reads as not seen again, as does anything the
// TTL index on the model has already removed.
const MAX_SEEN = 1000;

async function seenIds(visitorId) {
  const rows = await VisitorView.find({ visitorId })
    .sort({ createdAt: -1 })
    .limit(MAX_SEEN)
    .select('article')
    .lean();

  return rows.map((row) => row.article);
}

// An upsert, so opening an article twice is still one row, and the first
// opening is the one createdAt remembers.
async function markSeen(visitorId, articleId) {
  await VisitorView.updateOne(
    { visitorId, article: articleId },
    { $setOnInsert: { visitorId, article: articleId } },
    { upsert: true }
  );
}

module.exports = { seenIds, markSeen, MAX_SEEN };
