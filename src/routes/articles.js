const express = require('express');

const asyncHandler = require('../middlewares/asyncHandler');
const load = require('../middlewares/load');
const { requireAuth, requireRole } = require('../middlewares/auth');
const Article = require('../models/article');
const { list, one, view, create, update, revise, submit } = require('../controllers/articles');
const editor = require('../controllers/editor');

// Mounted at /api/articles in routes/index.js, so '/' here is /api/articles.
const router = express.Router();

// ?all=true is the editor's list: every article in every state. It shares the
// collection's URL, so it is picked out here, and next('route') hands any other
// request on to the public feed below without running the editor check.
const everything = (req, res, next) => (req.query.all === 'true' ? next() : next('route'));
router.get('/', everything, requireRole('editor'), asyncHandler(editor.list));

// Reading the published site needs no session: these are the public feed and
// the public article. Everything that writes belongs to the reporter and editor
// areas and goes through the state machine.
router.get('/', asyncHandler(list));
router.get('/:id', asyncHandler(one));

// A guest's view counts as much as anyone's, so this needs no session either.
// The device comes from the visitor cookie, never from the body.
router.post('/:id/views', asyncHandler(view));

// Writing a new article: reporters only.
router.post('/',
  requireAuth,
  requireRole('reporter'),
  asyncHandler(create)
);

// Editing the working copy. load(Article) finds the article and puts it on req.target (404 if none).
router.patch('/:id',
  requireAuth,
  load(Article),
  asyncHandler(update)
);

// Starting a rewrite of an article that is already published.
router.post('/:id/revise',
  requireAuth,
  load(Article),
  asyncHandler(revise)
);

// The reporter sends the working copy to the editor.
router.post('/:id/submit',
  requireAuth,
  requireRole('reporter'),
  load(Article),
  asyncHandler(submit)
);

// The editor's three. requireRole is the first line of defence; the state
// machine checks the role again, so a later caller that skips this route is
// still refused.
// Publish the working copy.
router.post('/:id/approve',
  requireRole('editor'),
  load(Article),
  asyncHandler(editor.approve)
);

// Send it back to the reporter with a note.
router.post('/:id/return',
  requireRole('editor'),
  load(Article),
  asyncHandler(editor.sendBack)
);

// Delete the article with its comments and views.
router.delete('/:id',
  requireRole('editor'),
  load(Article),
  asyncHandler(editor.remove)
);

// The series for the Impact Analytics chart. Counting a view is the article
// page's job; reading them back is the editor's.
router.get('/:id/views',
  requireRole('editor'),
  load(Article),
  asyncHandler(editor.views)
);

module.exports = router;
