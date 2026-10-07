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

// Which of these few articles a device has opened, for marking the cards on a
// page the filter did not choose. One lookup per id on the unique index rather
// than the whole list, so a long history costs nothing on an unfiltered scroll.
// It does not apply the thousand cap, so a card far enough back can say seen
// while ?seen=no still lists it. The TTL still applies: an expired row is gone.
async function seenAmong(visitorId, articleIds) {
  if (articleIds.length === 0) return [];

  const rows = await VisitorView.find({ visitorId, article: { $in: articleIds } })
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

module.exports = { seenIds, seenAmong, markSeen, MAX_SEEN };
