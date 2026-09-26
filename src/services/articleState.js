const { HttpError } = require('../errors');

// The only place in the system where draftStatus changes.
//
// Every rule about who may move an article, and from which state to which, is
// written once here. Putting the ownership check in a middleware instead would
// leave the service itself unguarded, and anything calling it directly — a
// script, a later controller, a seed — could walk straight past the rule.
//
// The requirements list four transitions and then say that no other transition
// is permitted. That sentence is this file.

const owns = (article, actor) =>
  actor.role === 'reporter' && String(article.reporter) === String(actor._id);

const isEditor = (actor) => actor.role === 'editor';

const ACTIONS = {
  // A reporter sends their own work to the editor. Allowed from a fresh draft
  // and from one that came back for changes.
  submit: {
    past: 'submitted',
    from: ['draft', 'returned'],
    allowed: owns,
    refusal: 'Only the reporter who owns this article can send it for approval',
    apply(article) {
      article.draftStatus = 'pending';
    }
  },

  // The moment the public sees new copy. The working version becomes the
  // published one, and the approval is recorded so that the analytics chart can
  // mark it later.
  approve: {
    past: 'approved',
    from: ['pending'],
    allowed: (article, actor) => isEditor(actor),
    refusal: 'Only an editor can publish an article',
    apply(article, actor) {
      const at = new Date();

      article.published = article.draft;
      article.publishedAt = at;
      article.publishHistory.push({ at, by: actor._id });

      article.draft = null;

      // Not 'draft'. There is no working copy left, and leaving a status on it
      // put every published article into the draftStatus index looking like one
      // waiting for an editor.
      article.draftStatus = null;
      article.editorNote = null;
    }
  },

  // Sent back with a note. The note is not optional: the requirement is that
  // the reporter can see what the editor asked for.
  return: {
    past: 'returned',
    from: ['pending'],
    allowed: (article, actor) => isEditor(actor),
    refusal: 'Only an editor can return an article for changes',
    needsNote: true,
    apply(article, actor, note) {
      article.draftStatus = 'returned';
      article.editorNote = { text: note, by: actor._id, at: new Date() };
    }
  },

  // Editing something that is already out. The published copy is left exactly
  // where it is and a working copy is made from it, which is what lets readers
  // carry on seeing the approved version throughout.
  revise: {
    past: 'revised',
    from: ['published'],
    allowed: (article, actor) => owns(article, actor) || isEditor(actor),
    refusal: 'Only the reporter who owns this article, or an editor, can revise it',
    apply(article) {
      article.draft = {
        title: article.published.title,
        summary: article.published.summary,
        body: article.published.body,
        image: article.published.image
      };
      article.draftStatus = 'draft';
    }
  }
};

// What the article is right now, in the terms the transitions are written in.
// An article that is live and has a working copy is described by the working
// copy, because that is the thing a transition would move.
function stateOf(article) {
  if (article.draft) return article.draftStatus;
  return article.published ? 'published' : 'draft';
}

function apply(article, name, actor, note) {
  const action = ACTIONS[name];
  if (!action) throw new HttpError(400, `There is no such action as "${name}"`);

  const from = stateOf(article);

  // The refusal names both ends, because "not allowed" on its own tells whoever
  // is reading the log nothing about what they tried to do.
  if (!action.from.includes(from)) {
    throw new HttpError(409, `An article that is "${from}" cannot be ${action.past}`);
  }

  if (!action.allowed(article, actor)) throw new HttpError(403, action.refusal);

  if (action.needsNote && !String(note || '').trim()) {
    throw new HttpError(400, 'A note is required when sending an article back');
  }

  action.apply(article, actor, String(note || '').trim());
  return article;
}

// Only the owner or editor can edit the article. 
const mayEdit = (article, actor) => owns(article, actor) || isEditor(actor);

module.exports = { apply, stateOf, mayEdit, isEditor, ACTIONS: Object.keys(ACTIONS) };
