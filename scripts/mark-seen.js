const mongoose = require('mongoose');

const config = require('../src/config');
const db = require('../src/db');
const Article = require('../src/models/article');
const VisitorView = require('../src/models/visitorView');
const { markSeen } = require('../src/services/seen');

// Marks articles as seen for one browser, the way the article page will once
// person 3 has built it. Until then this is the only way to see the seen and
// not seen filter do anything.
//
//   npm run seen -- <visitor cookie> [count]
//   npm run seen -- <visitor cookie> --clear
//
// The cookie is the "visitor" value from DevTools > Application > Cookies, as
// shown there (s%3A...), or the bare id inside it. Every other article among
// the newest ones is marked, so the first page of the feed has both kinds.

// A signed cookie reads s:<id>.<signature>, URL-encoded in the browser. The id
// is a UUID, which has no dots, so the signature is whatever follows the last.
function idFrom(raw) {
  let value = decodeURIComponent(raw.trim());
  if (value.startsWith('s:')) value = value.slice(2, value.lastIndexOf('.'));
  return value;
}

async function run() {
  const [raw, second] = process.argv.slice(2);
  if (!raw) {
    console.error('Usage: npm run seen -- <visitor cookie> [count | --clear]');
    process.exit(1);
  }

  const visitorId = idFrom(raw);
  if (!/^[0-9a-f-]{36}$/i.test(visitorId)) {
    console.error('That does not look like a visitor cookie: ' + visitorId);
    process.exit(1);
  }

  await db.connect(config.mongoUri);

  if (second === '--clear') {
    const { deletedCount } = await VisitorView.deleteMany({ visitorId });
    console.log(`Cleared ${deletedCount} seen articles for ${visitorId}`);
    return mongoose.disconnect();
  }

  const count = Number(second || 10);
  const newest = await Article.find({ published: { $ne: null } })
    .sort({ publishedAt: -1, _id: -1 })
    .limit(count * 2)
    .select('published.title');

  const marked = newest.filter((_, i) => i % 2 === 1);
  for (const article of marked) await markSeen(visitorId, article._id);

  console.log(`Marked ${marked.length} articles as seen for ${visitorId}:`);
  for (const article of marked) console.log('  ' + article.published.title);
  console.log('Reload the home page: these carry "נקראה", and the הצגה filter now works.');

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
