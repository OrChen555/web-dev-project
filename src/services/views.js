const Article = require('../models/article');
const ViewBucket = require('../models/viewBucket');
const { markSeen } = require('./seen');

// One reader opening one article. Three things follow from it, and they belong
// together so that no caller records one and forgets the others: the counter
// the feed sorts and shows, the fifteen minute bucket the analytics chart reads,
// and the row that marks the article as seen on this device.
//
// Every opening counts, as the requirements ask, so the counter and the bucket
// go up each time. Seen is an upsert and stays one row however often.
//
// Returns false when there is no published article with that id, so that the
// caller can answer 404. A draft cannot be viewed by the public, so it cannot
// collect views either.
async function record(articleId, visitorId) {
  const article = await Article.findOneAndUpdate(
    { _id: articleId, published: { $ne: null } },
    { $inc: { viewCount: 1 } },
    { projection: { _id: 1 } }
  );
  if (!article) return false;

  await Promise.all([
    ViewBucket.updateOne(
      { article: article._id, bucket: ViewBucket.windowFor(new Date()) },
      { $inc: { count: 1 } },
      { upsert: true }
    ),
    markSeen(visitorId, article._id)
  ]);

  return true;
}

module.exports = { record };
