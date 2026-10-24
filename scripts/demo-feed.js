const mongoose = require('mongoose');

const config = require('../src/config');
const db = require('../src/db');
const User = require('../src/models/user');
const Article = require('../src/models/article');
const Comment = require('../src/models/comment');
const ViewBucket = require('../src/models/viewBucket');
const VisitorView = require('../src/models/visitorView');

// Demo data for the home feed and nothing else: enough published articles to
// scroll, search, filter and sort, plus a handful placed on purpose so that
// every rule the feed keeps can be checked by eye. The QA checklist in
// docs/qa-feed.md refers to these by title.
//
// Not the defence seed, which is person 5's. This one exists so the feed can be
// tested before the reporter and editor areas can produce real articles.
//
// A fixed random seed, so every run writes the same articles and the checklist
// can name what should appear where.

const PASSWORD = process.env.SEED_PASSWORD || 'password';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.now();

function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = random(20260928);
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (low, high) => low + rand() * (high - low);

const SLOT = ViewBucket.WINDOW_MINUTES * 60 * 1000;

// How far back the steady trickle reaches. Covers the dashboard's widest fixed
// range with room to spare, without a row per window per article for months.
const TRICKLE_DAYS = 35;

// The most windows one article may fill. Enough for a readable curve on every
// range the chart offers, which never draws more than 400 points anyway.
const MAX_SLOTS = 220;

// Readers by hour of the day, quiet overnight and busiest in the evening. Without
// it every chart is a flat line, which is the one thing real traffic never is.
const DAY_SHAPE = [0.35, 0.25, 0.18, 0.15, 0.15, 0.25, 0.5, 0.85, 1.1, 1.2, 1.15, 1.1,
  1.1, 1.05, 1, 1, 1.05, 1.1, 1.2, 1.35, 1.4, 1.3, 1, 0.6];

// The analytics chart reads ViewBucket and nothing else, so without these rows
// every range on it is empty however many articles exist.
//
// The shape, not the total: an article's viewCount is already decided, and the
// deliberate ones in docs/qa-feed.md depend on keeping the exact number they
// were given. So this works out how busy each fifteen minute window was
// relatively, then hands out that article's views in proportion.
//
// Readers arrive in a burst when a version goes out and fade away after it, so
// each entry in publishHistory starts one. A few articles also keep a steady
// trickle, which is what gives the recent ranges something to draw for articles
// published months ago.
function traffic(article) {
  const times = (article.publishHistory || []).map((entry) => entry.at.getTime());
  if (!times.length || !article.viewCount) return [];

  const fade = between(8, 30) * HOUR;
  const steady = rand() < 0.25 ? between(0.05, 0.4) : 0;
  const bursts = times.map((at) => ({ at, size: between(0.9, 1.4), fade: between(4, 14) * HOUR }));

  const slots = [];

  // The trickle only runs over the last few weeks. Further back it would add a
  // row per window per article for months, which is most of the rows written for
  // a part of the chart nobody looks at: the dashboard's widest fixed range is 30
  // days, and the lifetime view is dominated by the bursts anyway.
  const trickleFrom = NOW - TRICKLE_DAYS * DAY;

  for (let t = ViewBucket.windowFor(new Date(times[0])).getTime(); t < NOW; t += SLOT) {
    let weight = t >= trickleFrom ? steady : 0;
    for (const burst of bursts) {
      if (t >= burst.at) weight += burst.size * Math.exp(-(t - burst.at) / burst.fade);
    }
    weight *= DAY_SHAPE[new Date(t).getHours()];

    // Faded to nothing, with no trickle still to come: every window from here on
    // would be a zero, so stop rather than walk months of them.
    if (weight < 0.0005 && t > times[times.length - 1] && (!steady || t >= trickleFrom)) break;

    if (weight > 0) slots.push({ at: t, weight });
  }

  if (!slots.length) return [];

  // The busiest windows only. Every window an article was ever read in would be
  // hundreds of thousands of rows across the feed, nearly all of them a 1 that
  // no range on the chart is wide enough to show separately. Dropping the quiet
  // ones keeps the shape, and the views they held move into the peaks.
  if (slots.length > MAX_SLOTS) {
    slots.sort((a, b) => b.weight - a.weight);
    slots.length = MAX_SLOTS;
    slots.sort((a, b) => a.at - b.at);
  }

  const sum = slots.reduce((total, slot) => total + slot.weight, 0);
  if (!sum) return [];

  // Largest remainder, so the rows add up to viewCount exactly rather than
  // drifting by the rounding on every one of them.
  const exact = slots.map((slot) => (slot.weight / sum) * article.viewCount);
  const rows = slots.map((slot, i) => ({ article: article._id, bucket: new Date(slot.at), count: Math.floor(exact[i]) }));

  let left = article.viewCount - rows.reduce((total, row) => total + row.count, 0);
  const order = exact.map((value, i) => [value - Math.floor(value), i]).sort((a, b) => b[0] - a[0]);
  for (let i = 0; i < order.length && left > 0; i++, left--) rows[order[i][1]].count += 1;

  return rows.filter((row) => row.count > 0);
}

// Three parts per headline, so seven categories give far more distinct titles
// than the demo needs and none of them repeat.
const WORDS = {
  news: {
    who: ['משטרת ישראל', 'כבאות והצלה', 'מד"א', 'עיריית תל אביב', 'רשות הטבע והגנים', 'משרד התחבורה', 'חברת החשמל', 'רכבת ישראל'],
    what: ['מזהירה מפני', 'מודיעה על', 'נערכת ל', 'פותחת בחקירה של', 'מציגה תוכנית ל', 'מסכמת את', 'מתריעה על', 'משיקה מבצע נגד'],
    about: ['עומסי תנועה', 'גל חום', 'שריפות בשטחים פתוחים', 'עבודות לילה', 'הצפות בכבישים', 'תאונות בצמתים', 'הפסקות חשמל', 'שיבושים בתחבורה']
  },
  politics: {
    who: ['הכנסת', 'הממשלה', 'ועדת הכספים', 'ראש האופוזיציה', 'שר האוצר', 'ועדת החוקה', 'סיעות הקואליציה', 'נשיא המדינה'],
    what: ['מאשרת', 'דוחה', 'דנה ב', 'מקדמת', 'בוחנת מחדש את', 'מקפיאה את', 'מצביעה על', 'מבקרת את'],
    about: ['תקציב המדינה', 'חוק הדיור', 'הרפורמה בחינוך', 'חוק הגיוס', 'תוכנית התחבורה', 'הסכם השכר', 'חוק התקשורת', 'מינוי השופטים']
  },
  economy: {
    who: ['בנק ישראל', 'הבורסה בתל אביב', 'רשות המסים', 'הלמ"ס', 'חברות הביטוח', 'ענקיות ההייטק', 'רשתות המזון', 'קרנות הפנסיה'],
    what: ['מדווחת על', 'צופה', 'נערכת ל', 'מזהירה מפני', 'מסכמת את', 'מודיעה על', 'חושפת את', 'מגיבה ל'],
    about: ['עליית הריבית', 'ירידת האינפלציה', 'זינוק בייצוא', 'מחירי הדיור', 'שער הדולר', 'גל גיוסים', 'יוקר המחיה', 'רבעון שיא']
  },
  sports: {
    who: ['מכבי תל אביב', 'הפועל באר שבע', 'נבחרת ישראל', 'בית"ר ירושלים', 'מכבי חיפה', 'הפועל ירושלים', 'נבחרת הנוער', 'בני סכנין'],
    what: ['מנצחת את', 'מפסידה ל', 'נפרדת מ', 'מתכוננת ל', 'חוגגת את', 'מחתימה את', 'נערכת מול', 'מסיימת את'],
    about: ['העונה הסדירה', 'משחק העונה', 'הדרבי', 'גמר הגביע', 'המאמן הוותיק', 'שלב הבתים', 'היריבה המסורתית', 'אליפות אירופה']
  },
  culture: {
    who: ['התיאטרון הלאומי', 'הפילהרמונית', 'פסטיבל הקולנוע', 'מוזיאון ישראל', 'להקת בת שבע', 'הספרייה הלאומית', 'האופרה הישראלית', 'יוצרי המוזיקה'],
    what: ['מציגים את', 'חוגגים את', 'משיקים את', 'מכריזים על', 'חוזרים אל', 'נפרדים מ', 'פותחים את', 'מארחים את'],
    about: ['העונה החדשה', 'תערוכת הקיץ', 'הבכורה המיוחלת', 'יצירות המופת', 'הפרויקט הקהילתי', 'ערב המחווה', 'סדרת ההופעות', 'האוסף הנדיר']
  },
  technology: {
    who: ['חברות הסייבר', 'מערך הדיגיטל', 'סטארט־אפ ישראלי', 'חוקרי הטכניון', 'ענקית השבבים', 'רשות החדשנות', 'מפתחי הבינה המלאכותית', 'חברות התקשורת'],
    what: ['חושפים את', 'משיקים את', 'מזהירים מפני', 'מפתחים את', 'בוחנים את', 'מגייסים ל', 'מדווחים על', 'משפרים את'],
    about: ['דור הרשתות הבא', 'מתקפת הכופרה', 'המעבד החדש', 'הרובוט הרפואי', 'אפליקציית התחבורה', 'המודל העברי', 'מערכת הזיהוי', 'הלוויין הזעיר']
  },
  health: {
    who: ['משרד הבריאות', 'בית החולים איכילוב', 'קופות החולים', 'חוקרי מכון ויצמן', 'איגוד הרופאים', 'מגן דוד אדום', 'שיבא', 'הדסה'],
    what: ['ממליצים על', 'מזהירים מפני', 'מדווחים על', 'משיקים את', 'בוחנים את', 'מסכמים את', 'נערכים ל', 'מציגים את'],
    about: ['חיסון השפעת', 'עומס במיון', 'טיפול חדשני', 'שעות השינה', 'תזונה בריאה', 'גל הקיץ', 'בדיקות הסקר', 'בריאות הנפש']
  }
};

const LEADS = [
  'הפרטים המלאים, התגובות הראשונות ומה זה אומר עבורכם.',
  'גורמים מעורבים מסבירים מה עומד מאחורי ההחלטה ומה הצעד הבא.',
  'ניתוח: למה זה קרה עכשיו, ומי ירוויח מזה.',
  'כל מה שצריך לדעת, בחמש נקודות קצרות.',
  'הכתבים שלנו בשטח מדווחים על ההתפתחויות האחרונות.',
  'המספרים, הציטוטים והשאלות שעדיין פתוחות.'
];

const body = (summary) => [
  summary,
  'לפי הגורמים שעמם שוחחנו, התהליך נמשך כבר כמה חודשים והגיע השבוע לנקודת הכרעה.',
  'מומחים שבחנו את הנתונים מעריכים כי ההשפעה תורגש כבר ברבעון הקרוב, אם כי חלקם מסתייגים מהתחזית.',
  'בתגובה נמסר כי כל ההיבטים נבחנו בקפידה וכי הציבור יעודכן בהמשך.',
  'נמשיך לעקוב ולעדכן.'
].join('\n\n');

// Every ordinary article has a picture. The grey placeholder is for the two
// deliberate ones below, with no image and with a broken one; scattered through
// the feed at random it only looked like a bug. picsum serves a fixed photo for
// each seed string, so a card keeps its image between runs. 400 by 300 is the
// card's 4:3 at twice its size, sharp on a dense screen and a third of the
// download of a larger one, which on a slow host is the grey box lasting less.
const imageFor = (i) => `https://picsum.photos/seed/daily-web-${i}/400/300`;

// Views pile up on a few articles, the way they do on a real site, and are not
// tied to the date, so sorting by popularity visibly reorders the feed.
const viewsFor = () => Math.floor(Math.pow(rand(), 3) * 20000);

async function people() {
  const password = PASSWORD;
  const [admin, michal, dana, yonatan, noa, amir] = await User.create([
    { username: 'admin', password, name: 'מנהלת המערכת', role: 'editor', isAdmin: true },
    { username: 'michal', password, name: 'מיכל ברנע', role: 'editor' },
    { username: 'dana', password, name: 'דנה לוי', role: 'reporter' },
    { username: 'yonatan', password, name: 'יונתן שגב', role: 'reporter' },
    { username: 'noa', password, name: 'נועה כהן', role: 'reporter' },
    { username: 'amir', password, name: 'אמיר חדד', role: 'reporter' }
  ]);
  return { admin, michal, reporters: [dana, yonatan, noa, amir] };
}

function published({ reporter, category, title, summary, image, at, views, editor }) {
  return {
    reporter: reporter._id || reporter,
    category,
    published: { title, summary, body: body(summary), image },
    publishedAt: at,
    publishHistory: [{ at, by: editor._id }],
    draft: null,
    draftStatus: null,
    viewCount: views,
    commentCount: Math.floor(rand() * 12)
  };
}

// The bulk of the feed: count articles spread over the last four months.
function ordinary(count, { reporters, michal }) {
  const categories = Article.CATEGORIES;
  const used = new Set();
  const rows = [];

  for (let i = 0; i < count; i++) {
    const category = categories[i % categories.length];
    const words = WORDS[category];

    // A verb ending in a one-letter preposition (ל, ב, מ) takes the noun onto
    // it, the way Hebrew is written: "נערכת לעומסי תנועה", not "נערכת ל עומסי".
    const headline = () => {
      const what = pick(words.what);
      return `${pick(words.who)} ${what}${/ [לבמ]$/.test(what) ? '' : ' '}${pick(words.about)}`;
    };

    // 512 combinations per category. A very large --count runs out of them,
    // and a number on the end keeps the titles distinct after that.
    let title = headline();
    for (let tries = 0; used.has(title) && tries < 50; tries++) title = headline();
    if (used.has(title)) title += ` (${i})`;
    used.add(title);

    rows.push(published({
      reporter: pick(reporters),
      category,
      title,
      summary: pick(LEADS),
      image: imageFor(i),
      at: new Date(NOW - Math.floor(rand() * 120 * DAY) - HOUR * 2),
      views: viewsFor(),
      editor: michal
    }));
  }

  return rows;
}

// The articles the checklist names. Each one exists to prove one rule.
function deliberate({ reporters, michal }, dates) {
  const [dana, yonatan, noa, amir] = reporters;
  const rows = [];
  const add = (row) => rows.push(published({ editor: michal, views: viewsFor(), ...row }));

  // Newest in the feed. Readers must see this title, never the draft's.
  rows.push({
    ...published({
      reporter: dana, category: 'news', editor: michal, views: 1200,
      title: 'נחנך גשר הרכבת החדש בחיפה',
      summary: 'הגרסה המאושרת. אם אתם רואים את המילה "עדכון" בכותרת, משהו שבור.',
      image: 'https://picsum.photos/seed/daily-web-bridge/400/300',
      at: new Date(NOW - 10 * 60 * 1000)
    }),
    draft: {
      title: 'נחנך גשר הרכבת החדש בחיפה — עדכון: הפקקים כבר כאן',
      summary: 'הנוסח שממתין לעורך. לא אמור להופיע בפיד.',
      body: 'טיוטה.'
    },
    draftStatus: 'pending'
  });

  // Search for one exact word, in Hebrew and in English.
  add({ reporter: noa, category: 'culture', title: 'פינגווינים בגן החיות התנכי חגגו יום הולדת', summary: 'בדיקת חיפוש: יש בדיוק כתבה אחת עם המילה הזו.', image: 'https://picsum.photos/seed/daily-web-penguin/400/300', at: new Date(NOW - 5 * HOUR) });
  add({ reporter: amir, category: 'technology', title: 'Apple חושפת מעבד חדש למחשבים ניידים', summary: 'בדיקת חיפוש באנגלית, בלי תלות באותיות גדולות וקטנות.', image: 'https://picsum.photos/seed/daily-web-chip/400/300', at: new Date(NOW - 7 * HOUR) });

  // Rendering edge cases.
  add({ reporter: yonatan, category: 'news', title: '<img src=x onerror="alert(\'xss\')"> בדיקת אבטחה בכותרת', summary: '<b>אם הטקסט הזה מודגש, או קפצה הודעה — יש XSS.</b>', image: 'https://picsum.photos/seed/daily-web-xss/400/300', at: new Date(NOW - 3 * HOUR) });
  add({ reporter: dana, category: 'economy', title: 'כותרת ארוכה במיוחד שנועדה לבדוק שהכרטיס לא נשבר, לא גולש מהמסך ולא דוחף את התמונה הצידה גם כשהכותרת ממשיכה וממשיכה עוד ועוד', summary: 'תקציר ארוך במיוחד. '.repeat(15).trim(), image: 'https://picsum.photos/seed/daily-web-long/400/300', at: new Date(NOW - 4 * HOUR) });
  add({ reporter: noa, category: 'health', title: 'כתבה עם תמונה שבורה', summary: 'הכתובת של התמונה לא קיימת. אמור להופיע המלבן האפור במקומה.', image: 'https://invalid.example/missing.jpg', at: new Date(NOW - 6 * HOUR) });
  add({ reporter: amir, category: 'sports', title: 'כתבה בלי תמונה בכלל', summary: 'אין שדה תמונה. אמור להופיע המלבן האפור.', image: undefined, at: new Date(NOW - 8 * HOUR) });

  // A reporter whose account no longer exists: the byline starts at the category.
  add({ reporter: new mongoose.Types.ObjectId(), category: 'politics', title: 'כתבה של כתב שהחשבון שלו נמחק', summary: 'שורת הקרדיט אמורה להתחיל בקטגוריה, בלי נקודה מיותרת לפניה.', image: 'https://picsum.photos/seed/daily-web-orphan/400/300', at: new Date(NOW - 9 * HOUR) });

  // Top of the popular sort, whatever the random views came out as.
  add({ reporter: yonatan, category: 'sports', title: 'הכתבה הנצפית ביותר באתר', summary: 'במיון לפי פופולריות היא ראשונה. במיון לפי תאריך היא רחוק למטה.', image: 'https://picsum.photos/seed/daily-web-popular/400/300', at: new Date(NOW - 60 * DAY), views: 250000 });

  // Last year, so the date on the card carries the year.
  add({ reporter: dana, category: 'culture', title: 'סיכום השנה בתרבות: מה ראינו ב־2025', summary: 'פורסמה בשנה שעברה. התאריך בכרטיס אמור לכלול את השנה.', image: 'https://picsum.photos/seed/daily-web-lastyear/400/300', at: new Date('2025-12-28T10:00:00Z') });

  // Twenty-five articles in the very same millisecond, placed around the 45th
  // in the feed so that a page break falls in the middle of them. Paging through
  // them must show each once: this is what the _id in the cursor is for.
  const tie = dates[35];
  for (let n = 1; n <= 25; n++) {
    add({ reporter: pick(reporters), category: 'news', title: `מבזק מחדר החדשות מספר ${n}`, summary: 'פורסמו כולן באותה מילישנייה בדיוק.', image: imageFor(1000 + n), at: tie });
  }

  // Never in the feed, however it is searched or filtered.
  const hidden = (title, draftStatus, extra = {}) => rows.push({
    reporter: dana._id, category: 'news', draft: { title, summary: 'לא אמורה להופיע בפיד.', body: 'טיוטה.' },
    draftStatus, published: null, publishedAt: null, ...extra
  });
  hidden('טיוטה סודית בהכנה', 'draft');
  hidden('טיוטה סודית שממתינה לאישור', 'pending');
  hidden('טיוטה סודית שהוחזרה לתיקונים', 'returned', { editorNote: { text: 'חסר מקור.', by: michal._id, at: new Date() } });

  return rows;
}

async function run() {
  const asked = process.argv.find((a) => a.startsWith('--count='));
  const count = asked ? Number(asked.split('=')[1]) : 600;
  if (!Number.isInteger(count) || count < 50) {
    console.error('--count has to be a whole number, 50 or more');
    process.exit(1);
  }

  // The same guard as seed.js: this empties every collection.
  const local = /\/\/(localhost|127\.0\.0\.1)[:/]/.test(config.mongoUri);
  if (!local && !process.argv.includes('--force')) {
    console.error('Refusing to wipe a database that is not local: ' + config.mongoUri.replace(/\/\/.*@/, '//'));
    process.exit(1);
  }

  await db.connect(config.mongoUri);

  for (const model of [User, Article, Comment, ViewBucket, VisitorView]) {
    await model.deleteMany({});
    await model.syncIndexes();
  }

  const staff = await people();
  const bulk = ordinary(count, staff);
  const dates = bulk.map((row) => row.publishedAt).sort((a, b) => b - a);
  const special = deliberate(staff, dates);

  for (let i = 0; i < bulk.length; i += 500) await Article.insertMany(bulk.slice(i, i + 500));
  await Article.insertMany(special);

  // After the articles are in, so every row has its _id and its publishHistory.
  // Written as it goes rather than gathered first: the whole history is hundreds
  // of thousands of rows, and holding them all to count them at the end is both
  // the memory and the spread that blew the stack.
  let batch = [];
  let written = 0;
  let oldestAt = Infinity;

  const flush = async () => {
    if (!batch.length) return;
    await ViewBucket.insertMany(batch, { ordered: false });
    written += batch.length;
    batch = [];
  };

  for await (const article of Article.find({ published: { $ne: null }, viewCount: { $gt: 0 } })
    .select('_id viewCount publishHistory').lean().cursor()) {
    for (const row of traffic(article)) {
      if (row.bucket.getTime() < oldestAt) oldestAt = row.bucket.getTime();
      batch.push(row);
    }
    if (batch.length >= 5000) await flush();
  }
  await flush();

  const live = await Article.countDocuments({ published: { $ne: null } });
  const drafts = await Article.countDocuments({ published: null });
  const oldest = written ? new Date(oldestAt) : null;

  console.log('users      6     admin, michal (editors) · dana, yonatan, noa, amir (reporters)');
  console.log('published  ' + live + '   ' + count + ' ordinary, plus the ones docs/qa-feed.md names');
  console.log('hidden     ' + (drafts + 1) + '     three drafts, plus one pending update on a live article');
  console.log('views      ' + written + ' fifteen minute buckets' + (oldest ? ', back to ' + oldest.toISOString().slice(0, 10) : ''));
  console.log('password   every account: ' + PASSWORD);
  console.log('');
  console.log('Next: npm start, open http://localhost:3000, and follow docs/qa-feed.md.');

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
