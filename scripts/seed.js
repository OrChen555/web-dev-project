const mongoose = require('mongoose');

const config = require('../src/config');
const db = require('../src/db');
const User = require('../src/models/user');
const Article = require('../src/models/article');
const Comment = require('../src/models/comment');
const ViewBucket = require('../src/models/viewBucket');
const VisitorView = require('../src/models/visitorView');
const { BANKS, OPENERS, CLOSERS, UPDATES, NOTES, COMMENTERS, REMARKS } = require('./demo-content');

// Two layers. Ten articles chosen by hand to cover every state, including the
// awkward one: published, with an update waiting. Then five hundred generated
// ones, which is what the requirements ask the defence to run on: every state
// and category, articles updated several times after going out, comments, and
// enough views over time for the Impact Analytics chart to show something.
//
// For the index measurements, --bulk=3000 still pads the collection with filler.

const PASSWORD = process.env.SEED_PASSWORD || 'password';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SLOT = ViewBucket.WINDOW_MINUTES * MINUTE;

const NOW = Date.now();
const daysAgo = (n) => new Date(NOW - n * DAY);

// A seeded generator rather than Math.random, so every run writes the same
// articles in the same states, and the article somebody picked for the demo
// yesterday is still there today. The view counts differ a little from run to
// run, because the curves run up to the present.
//
// The simplest one there is: multiply by a fixed number and keep the remainder.
// Each value comes from the one before it, so the same start gives the same list.
function generator(seed) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

const random = generator(20261007);
const between = (low, high) => low + random() * (high - low);
const whole = (low, high) => Math.floor(between(low, high + 1));
const pick = (list) => list[Math.floor(random() * list.length)];
const chance = (p) => random() < p;

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// Turns an expected number of views into a whole number that wobbles around it,
// so the curve looks like real traffic rather than a smooth formula. An expected
// 0.3 comes out as 1 about a third of the time and 0 otherwise.
const roughly = (expected) => Math.floor(expected * between(0.6, 1.4) + random());

const copy = (title, summary) => ({
  title,
  summary,
  body: Array.from({ length: 6 }, (_, i) => summary + ' פסקה ' + (i + 1) + '.').join('\n\n')
});

async function people() {
  // password is a virtual: the model hashes it on save, so a readable password
  // never reaches the database.
  const password = PASSWORD;

  // Several reporters rather than one, because the only way to check that a
  // reporter cannot touch someone else's article is to have someone else.
  const [admin, dana, yonatan, michal, noa, amir, shira, eitan] = await User.create([
    { username: 'admin', password, name: 'מנהלת המערכת', role: 'editor', isAdmin: true },
    { username: 'dana', password, name: 'דנה לוי', role: 'reporter' },
    { username: 'yonatan', password, name: 'יונתן שגב', role: 'reporter' },
    { username: 'michal', password, name: 'מיכל ברנע', role: 'editor' },
    { username: 'noa', password, name: 'נועה כהן', role: 'reporter' },
    { username: 'amir', password, name: 'אמיר חדד', role: 'reporter' },
    { username: 'shira', password, name: 'שירה אלון', role: 'reporter' },
    { username: 'eitan', password, name: 'איתן מזרחי', role: 'reporter' }
  ]);

  return { admin, dana, yonatan, michal, noa, amir, shira, eitan, reporters: [dana, yonatan, noa, amir, shira, eitan] };
}

// The hand-picked ten -----------------------------------------------------------

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
      draftStatus: row.status || null
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
    await VisitorView.create({ visitorId: 'seed-visitor-1', article: article._id });
  }

  return talked.length * 3;
}

// The generated five hundred --------------------------------------------------------

// How many of each, so that every filter on every screen has something in it.
// "update" is published with a rewrite waiting for the editor; "revising" is
// published with the reporter still working on the rewrite; "revision-returned"
// is a rewrite the editor sent back.
const MIX = {
  draft: 30,
  pending: 30,
  returned: 15,
  update: 15,
  revising: 8,
  'revision-returned': 4,
  published: 398
};

// How many of the published ones have been updated more than once after going
// out. These are the articles the Impact Analytics chart is for.
const UPDATED = 30;

const used = new Set();

function story(category) {
  const bank = BANKS[category];

  let title;
  do {
    title = pick(bank.sources) + ': ' + pick(bank.headlines);
  } while (used.has(title) && used.size < 5000);
  used.add(title);

  const lines = shuffle([...bank.lines]);
  const paragraphs = [
    pick(OPENERS) + ' ' + lines[0],
    lines[1] + ' ' + lines[2],
    lines[3],
    lines[4] + ' ' + lines[5],
    pick(CLOSERS)
  ];

  return {
    title,
    summary: lines[6] || lines[0],
    body: paragraphs.join('\n\n')
  };
}

// The same story, a version on. An update adds a paragraph and sometimes
// sharpens the headline, which is what the editor's comparison has to show.
function rewrite(version, category, n) {
  const next = { ...version, body: version.body + '\n\n' + UPDATES[n % UPDATES.length] };
  if (chance(0.4)) next.title = version.title.split(': ')[0] + ': ' + pick(BANKS[category].headlines);
  if (chance(0.3)) next.summary = pick(BANKS[category].lines);
  return next;
}

const image = (n) => (chance(0.9) ? `https://picsum.photos/seed/daily-web-${n}/800/450` : undefined);

// Whole hours, sometimes a quarter past: the example in the requirements is an
// update at 14:00, and the chart reads better when the markers land on a tick.
const onTheHour = (time) => {
  const date = new Date(time);
  date.setMinutes(pick([0, 0, 0, 15, 30, 45]), 0, 0);
  return date.getTime();
};

// When the editor approved each version. The first is the publication, the rest
// are updates. An article never updated is spread over the last 45 days, more
// of them recent than old, like a real feed (squaring a number between 0 and 1
// pushes it towards 0).
function publications(updates) {
  if (!updates) return [onTheHour(NOW - HOUR - 45 * DAY * random() ** 2)];

  // The updates share out the time between the first publication and two hours
  // ago in equal slices, each landing somewhere in the second half of its slice.
  const first = NOW - between(3, 12) * DAY;
  const slice = (NOW - 2 * HOUR - first) / updates;

  const times = [first];
  for (let i = 1; i <= updates; i++) times.push(first + slice * (i - between(0, 0.5)));

  return times.map(onTheHour);
}

// Reading habits by hour of the day: quiet at night, busy with the morning
// coffee and again in the evening.
const DAY_SHAPE = [0.35, 0.25, 0.18, 0.15, 0.15, 0.25, 0.5, 0.85, 1.1, 1.2, 1.15, 1.1,
  1.1, 1.05, 1, 1, 1.05, 1.1, 1.2, 1.35, 1.4, 1.3, 1, 0.6];

// Every fifteen minute window from the first publication to now. Readers come
// in a burst that fades, and each update brings a burst of its own, which is
// exactly the before and after the chart has to make visible. Only windows with
// at least one view are written, as the real counting would.
//
// "Fades" is Math.exp(-age / fade): 1 at the moment of publishing, then smaller
// and smaller as the hours pass.
function traffic(articleId, times, featured) {
  const peak = featured ? between(18, 45) : between(0.5, 15);
  const fade = between(8, 30) * HOUR;
  const steady = featured ? between(0.4, 1.5) : 0;
  const bursts = times.slice(1).map((at) => ({ at, size: peak * between(0.5, 1.4), fade: between(4, 14) * HOUR }));

  const rows = [];
  let total = 0;

  for (let t = ViewBucket.windowFor(new Date(times[0])).getTime(); t < NOW; t += SLOT) {
    let expected = peak * Math.exp(-(t - times[0]) / fade) + steady;
    for (const burst of bursts) {
      if (t >= burst.at) expected += burst.size * Math.exp(-(t - burst.at) / burst.fade);
    }
    expected *= DAY_SHAPE[new Date(t).getHours()];

    // Long faded and nothing more to come: the rest of the windows would all be
    // zeros, so stop rather than walk to the present.
    if (!steady && expected < 0.01 && t > times[times.length - 1]) break;

    const count = roughly(expected);
    if (count > 0) {
      rows.push({ article: articleId, bucket: new Date(t), count });
      total += count;
    }
  }

  return { rows, total };
}

function comments(articleId, from, count) {
  return Array.from({ length: count }, () => {
    const at = new Date(from + random() * (NOW - from));
    return {
      article: articleId,
      author: pick(COMMENTERS),
      text: pick(REMARKS),
      visitorId: 'seed-visitor-' + whole(1, 400),
      createdAt: at,
      updatedAt: at
    };
  });
}

// Built through the model, so every document is cast and validated exactly as
// the application would, then written to the collection directly. Saving one by
// one through mongoose would stamp every article "updated just now", and the
// editor's list sorts by exactly that.
function prepare(fields, createdAt, updatedAt) {
  const article = new Article(fields);
  const invalid = article.validateSync();
  if (invalid) throw invalid;

  return { ...article.toObject({ virtuals: false }), createdAt: new Date(createdAt), updatedAt: new Date(updatedAt) };
}

function demo(staff) {
  const editors = [staff.michal, staff.admin];
  const kinds = shuffle(Object.entries(MIX).flatMap(([kind, n]) => Array(n).fill(kind)));

  // The articles with several updates are picked from the published and update
  // kinds, so some of them also have a further rewrite waiting.
  let updatedLeft = UPDATED;

  const articles = [];
  const live = [];

  kinds.forEach((kind, n) => {
    const category = Article.CATEGORIES[n % Article.CATEGORIES.length];
    const reporter = pick(staff.reporters);
    const first = { ...story(category), image: image(n) };
    const fields = { _id: new mongoose.Types.ObjectId(), reporter: reporter._id, category };

    if (['draft', 'pending', 'returned'].includes(kind)) {
      const created = NOW - between(0.2, 9) * DAY;
      const touched = created + random() * (NOW - created);

      fields.draft = first;
      fields.draftStatus = kind;
      if (kind === 'returned') fields.editorNote = { text: pick(NOTES), by: pick(editors)._id, at: new Date(touched) };

      articles.push(prepare(fields, created, touched));
      return;
    }

    const featured = updatedLeft > 0 && (kind === 'update' || chance(0.1));
    if (featured) updatedLeft--;

    const times = publications(featured ? whole(2, 4) : (chance(0.08) ? 1 : 0));

    // The published copy is the last approved version, so it carries every
    // update that was approved along the way.
    let copy = first;
    for (let i = 1; i < times.length; i++) copy = rewrite(copy, category, n + i);

    fields.published = copy;
    fields.publishedAt = new Date(times[times.length - 1]);
    fields.publishHistory = times.map((at) => ({ at: new Date(at), by: pick(editors)._id }));

    let touched = times[times.length - 1];

    if (kind !== 'published') {
      fields.draft = rewrite(copy, category, n + times.length);
      fields.draftStatus = { update: 'pending', revising: 'draft', 'revision-returned': 'returned' }[kind];
      touched = touched + random() * (NOW - touched);
      if (kind === 'revision-returned') fields.editorNote = { text: pick(NOTES), by: pick(editors)._id, at: new Date(touched) };
    }

    live.push({ fields, times, featured, created: times[0] - between(1, 48) * HOUR, touched });
  });

  // Views and comments in a second pass. How many random numbers a curve uses
  // depends on how long the article has been out, which depends on when the
  // seed runs; drawn in the loop above, that would change every article after
  // the first one from run to run. Here only the numbers change, not the copy.
  const buckets = [];
  const talk = [];

  for (const { fields, times, featured, created, touched } of live) {
    const views = traffic(fields._id, times, featured);
    buckets.push(...views.rows);
    fields.viewCount = views.total;

    const said = comments(fields._id, times[0], featured ? whole(3, 12) : whole(0, 4));
    talk.push(...said);
    fields.commentCount = said.length;

    articles.push(prepare(fields, created, touched));
  }

  return { articles, buckets, talk };
}

// The hand-picked ten get traffic from the same model as the rest, so their
// charts look like everybody else's. The one with an update waiting is treated
// as one of the featured, because it is the first one anybody will open.
async function trafficForPlan(articles) {
  const rows = [];

  for (const article of articles.filter((a) => a.published)) {
    const times = article.publishHistory.map((p) => p.at.getTime());
    const views = traffic(article._id, times, times.length > 1);
    rows.push(...views.rows);
    await Article.updateOne({ _id: article._id }, { $set: { viewCount: views.total } });
  }

  return rows;
}

async function insert(Model, rows) {
  for (let i = 0; i < rows.length; i += 10000) {
    await Model.collection.insertMany(rows.slice(i, i + 10000), { ordered: false });
  }
  return rows.length;
}

// Filler for measuring indexes. Not demo data, and it is not meant to read well.
async function filler(count, reporter) {
  const rows = Array.from({ length: count }, (_, i) => ({
    reporter: reporter._id,
    category: Article.CATEGORIES[i % Article.CATEGORIES.length],
    published: copy('כתבת מילוי ' + (i + 1), 'נועדה למדידת אינדקסים בלבד'),
    publishedAt: new Date(NOW - i * MINUTE),
    draftStatus: null,
    viewCount: Math.floor(random() * 5000)
  }));

  for (let i = 0; i < rows.length; i += 500) {
    await Article.insertMany(rows.slice(i, i + 500));
  }

  return count;
}

async function run() {
  const asked = process.argv.find((a) => a.startsWith('--bulk='));
  const extra = asked ? Number(asked.split('=')[1]) : 0;

  // This empties every collection, so it refuses to run against anything that
  // is not obviously a local database. One stale .env should not be able to
  // wipe something shared.
  const local = /\/\/(localhost|127\.0\.0\.1)[:/]/.test(config.mongoUri);
  if (!local && !process.argv.includes('--force')) {
    console.error('Refusing to wipe a database that is not local: ' + config.mongoUri.replace(/\/\/.*@/, '//'));
    console.error('Pass --force if that is really what you want.');
    process.exit(1);
  }

  await db.connect(config.mongoUri);

  for (const model of [User, Article, Comment, ViewBucket, VisitorView]) {
    await model.deleteMany({});
    await model.syncIndexes();
  }

  const staff = await people();
  const picked = await write(plan(staff), staff.michal);
  const pickedComments = await conversation(picked);

  // Before the traffic for the hand-picked ten, which draws a different number
  // of random values depending on the time of day; see demo().
  const generated = demo(staff);
  const pickedViews = await trafficForPlan(picked);

  await insert(Article, generated.articles);
  await insert(Comment, generated.talk);
  const buckets = await insert(ViewBucket, [...pickedViews, ...generated.buckets]);

  const padding = extra > 0 ? await filler(extra, staff.dana) : 0;

  const count = (where) => Article.countDocuments(where);
  const [total, drafts, pending, returned, live, updates, several] = await Promise.all([
    count({}),
    count({ draftStatus: 'draft' }),
    count({ draftStatus: 'pending' }),
    count({ draftStatus: 'returned' }),
    count({ published: { $ne: null } }),
    count({ published: { $ne: null }, draftStatus: 'pending' }),
    count({ 'publishHistory.2': { $exists: true } })
  ]);
  const views = await ViewBucket.aggregate([{ $group: { _id: null, n: { $sum: '$count' } } }]);

  console.log('users      ' + (staff.reporters.length + 2) + '     admin, one editor (michal), ' + staff.reporters.length + ' reporters');
  console.log('articles   ' + total);
  console.log('  draft            ' + drafts);
  console.log('  pending          ' + pending + '   of which ' + updates + ' are updates to published articles');
  console.log('  returned         ' + returned);
  console.log('  published        ' + live + '   of which ' + several + ' were updated at least twice');
  console.log('comments   ' + (pickedComments + generated.talk.length));
  console.log('views      ' + (views[0] ? views[0].n : 0) + ' in ' + buckets + ' fifteen minute buckets');
  if (padding) console.log('filler     ' + padding + '  extra articles, for index measurements only');
  console.log('password   every account: ' + PASSWORD);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
