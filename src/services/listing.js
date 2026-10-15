const mongoose = require('mongoose');

const { HttpError } = require('../errors');
const Article = require('../models/article');

// What every list of articles needs, whoever is asking: reading the query
// string safely, searching titles, and paging by cursor. The public feed
// (services/feed.js) and the editor's list (services/newsroom.js) both build on
// these, so a fix made here reaches both.

// The most rows one page can ask for.
const MAX_LIMIT = 50;

// Longer than any headline anyone would search for. The cap keeps a stranger
// from handing the database a page of text to look for on every request.
const MAX_QUERY = 100;

// Which sort fields hold a Date, so that decode knows what encode will have stored.
const DATE_SORTS = ['publishedAt', 'updatedAt'];

// A cursor is [sort value, id] as JSON, made URL-safe with base64url.
const encode = (value, id) => Buffer.from(JSON.stringify([value, id])).toString('base64url');

// A cursor comes back from us, but it arrives in a query string like anything
// else, so it is read as something a stranger wrote. Parsing it only proves it
// was base64 and JSON: without a shape check an id of { "$gt": "" } lands in the
// query as an operator, and a sort value that is not a date reaches mongo as an
// Invalid Date and quietly matches nothing.
function decode(cursor, field) {
  let value;
  let id;

  // Undo encode(). Anything that is not our format fails here.
  try {
    [value, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString());
  } catch (err) {
    throw new HttpError(400, 'That is not a usable cursor');
  }

  if (typeof id !== 'string' || !mongoose.isValidObjectId(id)) {
    throw new HttpError(400, 'That is not a usable cursor');
  }

  if (DATE_SORTS.includes(field)) {
    // A string, because that is what encode() produces for a Date and because
    // new Date() is too forgiving to lean on: null and true both come out as
    // 1970 rather than as an Invalid Date, and would page from the wrong end.
    const at = typeof value === 'string' ? new Date(value) : new Date(NaN);
    if (Number.isNaN(at.getTime())) throw new HttpError(400, 'That is not a usable cursor');
    return { value: at, id };
  }

  // Otherwise the sort is a number (viewCount).
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HttpError(400, 'That is not a usable cursor');
  }

  return { value, id };
}

// Each of these reaches the query as-is, so it is either one of the values we
// know or the request is refused. An array (?category[]=a&category[]=b) is not
// a string and is refused with the rest. Checked against a list rather than
// looked up on an object, because an object also answers to "constructor".
// Left out or empty means the default.
function pick(value, allowed, name) {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new HttpError(400, `There is no such ${name} as "${String(value)}"`);
  }
  return value;
}

// Trimmed, so that "  " is no search at all rather than a search for nothing,
// and cut to the cap rather than refused: a reader who pastes a long line still
// gets results.
function searchText(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new HttpError(400, 'A search has to be a single piece of text');
  const text = [...value.trim()].slice(0, MAX_QUERY).join('').trim();
  return text || undefined;
}

// Every word the reader typed has to appear somewhere in the title, as part of
// a word or a whole one: "פינגווין" finds "פינגווינים", and "גשר חיפה" finds a
// title with both, in any order.
//
// Not the text index. It matches whole words only, and Hebrew glues prefixes
// onto its words, so a search for "גשר" missed "הגשר", "בגשר" and "לגשר". A
// regular expression matches inside words, at the cost of testing titles one
// by one; docs/indexes.md has what that costs on 3,000 articles.
//
// Escaped, because the words are a stranger's: ".*" or "(a+)+$" would otherwise
// be run as a pattern, and the second can keep the database busy for seconds.
//
// Five Hebrew letters change shape at the end of a word, and a reader typing
// the start of one writes the final shape: "פינגווין" is how you type your way
// to "פינגווינים", whose נ is not a ן. Each of the five matches both of its
// shapes, typed either way.
// Only the first five words count, to keep the query small.
const MAX_WORDS = 5;
// Puts a backslash before every regex symbol, so it is matched as plain text.
const escape = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SHAPES = { כ: '[כך]', ך: '[כך]', מ: '[מם]', ם: '[מם]', נ: '[נן]', ן: '[נן]', פ: '[פף]', ף: '[פף]', צ: '[צץ]', ץ: '[צץ]' };
// The final regex for one word: escaped, with both shapes of each final letter.
const pattern = (word) => escape(word).replace(/[כךמםנןפףצץ]/g, (letter) => SHAPES[letter]);

// One condition per word, meant to go under $and: run() below uses $or for the
// cursor, and two $or keys cannot sit side by side. With more than one field, a
// word may be found in any of them, so the editor's list can search the
// published title and the working one at once.
function titleContains(q, fields = ['published.title']) {
  // Split on spaces; each word becomes one condition that must match.
  return q.split(/\s+/).slice(0, MAX_WORDS).map((word) => {
    const matches = fields.map((field) => ({ [field]: { $regex: pattern(word), $options: 'i' } }));
    return matches.length === 1 ? matches[0] : { $or: matches };
  });
}

// Anything that is not a whole number above zero falls back to the default.
// Math.min alone let a negative through, and mongo reads .limit(-4) as "at most
// none", so the feed came back empty and looked broken.
function limitOf(value) {
  const asked = Number(value);
  return Number.isInteger(asked) && asked > 0 ? Math.min(asked, MAX_LIMIT) : 20;
}

// Runs the query one page at a time, starting strictly past the cursor if any.
async function run(where, sort, limit, after) {
  if (after) {
    const { value: at, id } = decode(String(after), sort.field);

    // Strictly past the last row: either the sort value is lower, or it ties
    // and the id is lower. Without the tie-break, articles published in the
    // same second would repeat or vanish between pages.
    where.$or = [
      { [sort.field]: { $lt: at } },
      { [sort.field]: at, _id: { $lt: id } }
    ];
  }

  // One more than asked for, purely to find out whether there is another page.
  const found = await Article.find(where)
    // _id breaks ties, so the order never changes between pages.
    .sort({ [sort.field]: sort.order, _id: -1 })
    .limit(limit + 1)
    .populate('reporter', 'name');

  // Drop the extra row; the last kept row is where the next page will start.
  const articles = found.slice(0, limit);
  const last = articles[articles.length - 1];

  return {
    articles,
    nextCursor: found.length > limit && last ? encode(last[sort.field], last._id) : null
  };
}

module.exports = { pick, searchText, titleContains, limitOf, run };
