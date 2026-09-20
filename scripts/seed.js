const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const config = require('../src/config');
const db = require('../src/db');
const User = require('../src/models/user');
const Article = require('../src/models/article');
const Comment = require('../src/models/comment');
const ViewBucket = require('../src/models/viewBucket');
const VisitorView = require('../src/models/visitorView');

// Ten articles chosen on purpose beat five hundred random ones for checking our
// own work. Random copy never produces a published article with an update
// waiting, and that is the case the whole version split exists for. The demo
// data for the defence is a separate job and belongs to whoever owns it.
//
// For the index measurements, --bulk=3000 pads the collection with filler.

const PASSWORD = process.env.SEED_PASSWORD || 'password';

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

const copy = (title, summary) => ({
  title,
  summary,
  body: Array.from({ length: 6 }, (_, i) => summary + ' פסקה ' + (i + 1) + '.').join('\n\n')
});

async function people() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  // Two reporters rather than one, because the only way to check that a
  // reporter cannot touch someone else's article is to have someone else.
  const [admin, dana, yonatan, michal] = await User.create([
    { username: 'admin', passwordHash, name: 'מנהלת המערכת', role: 'editor', isAdmin: true },
    { username: 'dana', passwordHash, name: 'דנה לוי', role: 'reporter' },
    { username: 'yonatan', passwordHash, name: 'יונתן שגב', role: 'reporter' },
    { username: 'michal', passwordHash, name: 'מיכל ברנע', role: 'editor' }
  ]);

  return { admin, dana, yonatan, michal };
}

function plan({ dana, yonatan, michal }) {
  return [
    { by: dana, category: 'news', draft: copy('טיוטה של דנה', 'כתבה שעדיין בכתיבה'), status: 'draft' },
    { by: yonatan, category: 'sports', draft: copy('טיוטה של יונתן', 'עוד כתבה בהכנה'), status: 'draft' },

    { by: dana, category: 'politics', draft: copy('ממתינה לאישור', 'הוגשה לעורך וממתינה'), status: 'pending' },
    { by: yonatan, category: 'economy', draft: copy('עוד אחת לאישור', 'בתור אצל העורך'), status: 'pending' },

    {
      by: dana, category: 'culture',
      draft: copy('הוחזרה לתיקונים', 'העורכת ביקשה שינויים'), status: 'returned',
      note: { text: 'חסר ציטוט ממקור שני, ואפשר לקצר את הפתיחה.', by: michal, at: daysAgo(1) }
    },

    { by: dana, category: 'news', live: copy('פורסמה לפני שבוע', 'כתבה שכבר באוויר'), since: 7 },
    { by: dana, category: 'technology', live: copy('פורסמה לפני ארבעה ימים', 'כתבה נוספת שפורסמה'), since: 4 },
    { by: yonatan, category: 'health', live: copy('פורסמה לפני יומיים', 'עוד כתבה שפורסמה'), since: 2 },
    { by: yonatan, category: 'sports', live: copy('פורסמה אתמול', 'כתבה שנשארת בלי תגובות'), since: 1 },

    // The case the version split exists for: readers keep seeing the approved
    // copy while a rewrite of it sits with the editor.
    {
      by: dana, category: 'economy',
      live: copy('פורסמה, ויש לה עדכון שממתין', 'הגרסה שהציבור רואה'), since: 5, updates: 3,
      draft: copy('פורסמה, ויש לה עדכון שממתין — נוסח מעודכן', 'הנוסח החדש שממתין לאישור'),
      status: 'pending'
    }
  ];
}

async function write(rows, editor) {
  const saved = [];

  for (const row of rows) {
    const article = new Article({
      reporter: row.by._id,
      category: row.category,
      draft: row.draft || null,
      draftStatus: row.status || 'draft'
    });

    if (row.live) {
      const updates = row.updates || 1;
      article.published = row.live;
      article.publishedAt = daysAgo(row.since);
      article.publishHistory = Array.from({ length: updates }, (_, i) => ({
        at: daysAgo(row.since + (updates - 1 - i) * 3),
        by: editor._id
      }));
    }

    if (row.note) {
      article.editorNote = { text: row.note.text, by: row.note.by._id, at: row.note.at };
    }

    saved.push(await article.save());
  }

  return saved;
}

async function conversation(articles) {
  // One published article is deliberately left without any comments, because an
  // empty list is where list rendering tends to break.
  const talked = articles.filter((a) => a.published).slice(0, 3);

  for (const article of talked) {
    const rows = [
      { author: 'אורח', text: 'כתבה מעניינת, תודה.', visitorId: 'seed-visitor-1' },
      { author: 'קורא מהצפון', text: 'הייתי שמח לראות יותר נתונים.', visitorId: 'seed-visitor-2' },
      { author: 'רותי', text: 'מחכה להמשך.', visitorId: 'seed-visitor-1' }
    ];

    await Comment.insertMany(rows.map((r) => Object.assign({ article: article._id }, r)));
    await Article.updateOne({ _id: article._id }, { $set: { commentCount: rows.length } });
  }

  return talked.length * 3;
}

async function traffic(articles) {
  const live = articles.filter((a) => a.published).slice(0, 3);
  let buckets = 0;

  for (const article of live) {
    let total = 0;

    for (let hour = 0; hour < 48; hour++) {
      const bucket = ViewBucket.windowFor(new Date(Date.now() - hour * 60 * 60 * 1000));

      // A visible lift over the last twelve hours, so the chart has something to
      // show rather than a flat line.
      const count = hour < 12 ? 30 + Math.floor(Math.random() * 20) : 5 + Math.floor(Math.random() * 8);

      await ViewBucket.updateOne({ article: article._id, bucket }, { $inc: { count } }, { upsert: true });
      total += count;
      buckets++;
    }

    await Article.updateOne({ _id: article._id }, { $set: { viewCount: total } });
    await VisitorView.create({ visitorId: 'seed-visitor-1', article: article._id });
  }

  return buckets;
}

// Filler for measuring indexes. Not demo data, and it is not meant to read well.
async function filler(count, reporter) {
  const rows = Array.from({ length: count }, (_, i) => ({
    reporter: reporter._id,
    category: Article.CATEGORIES[i % Article.CATEGORIES.length],
    published: copy('כתבת מילוי ' + (i + 1), 'נועדה למדידת אינדקסים בלבד'),
    publishedAt: new Date(Date.now() - i * 60 * 1000),
    draftStatus: 'draft',
    viewCount: Math.floor(Math.random() * 5000)
  }));

  for (let i = 0; i < rows.length; i += 500) {
    await Article.insertMany(rows.slice(i, i + 500));
  }

  return count;
}

async function run() {
  const asked = process.argv.find((a) => a.startsWith('--bulk='));
  const extra = asked ? Number(asked.split('=')[1]) : 0;

  await db.connect(config.mongoUri);

  for (const model of [User, Article, Comment, ViewBucket, VisitorView]) {
    await model.deleteMany({});
    await model.syncIndexes();
  }

  const staff = await people();
  const articles = await write(plan(staff), staff.michal);
  const comments = await conversation(articles);
  const buckets = await traffic(articles);
  const padding = extra > 0 ? await filler(extra, staff.dana) : 0;

  console.log('users      4     admin, two reporters, one editor');
  console.log('articles   ' + articles.length + '    every state, including one published with an update waiting');
  console.log('comments   ' + comments + '     one published article deliberately left with none');
  console.log('views      ' + buckets + '   fifteen minute buckets over two days');
  if (padding) console.log('filler     ' + padding + '  extra articles, for index measurements only');
  console.log('password   every account: ' + PASSWORD);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
