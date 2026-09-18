# Working on The Daily Web

Five people are writing this and every one of us has to be able to explain any
line of it. That is the reason for most of what follows.

## Layout

The three MVC roles are three directories side by side in `src/`:

    src/models/         M   Mongoose schemas. Nothing else lives here.
    src/views/          V   EJS templates. Pages include partials/top and bottom.
    src/controllers/    C   Read the request, call a service, send the response.

Everything around them:

    server.js           Reads config, opens the database, then listens.
    src/app.js          Builds and exports the Express app. Never listens.
    src/config.js       The only file that reads process.env.
    src/db.js           The connection. The only file outside models/ to require mongoose.
    src/errors.js       HttpError, for the failures we raise on purpose.
    src/logger.js       Writes the log file.
    src/routes/         URLs to controllers. No logic.
    src/services/       Domain rules. No req, no res.
    src/middlewares/    Anything that runs between the request and a handler.
    public/             Served as-is.

A controller that queries the database, or a service that touches `req`, is in
the wrong file. That separation is graded, so it is worth being strict about.

`models/` and `services/` are empty until the pull requests that fill them. They
are here so that nobody puts a schema in a controller or a rule in a route.

We do not create a directory before there is a file to put in it.

## Style

Two spaces, single quotes, semicolons, English names. The interface is in Hebrew;
the code and the comments are in English.

Requires at the top in three groups, blank line between: Node builtins,
installed packages, then our own files.

`const` unless you reassign. Arrow functions for one-liners, `function` for
anything longer. Early returns on one line: `if (!article) return next();`

Short, concrete names. `row`, `rows`, `article`, `missed`. Not
`articleDataResponseObject`.

`module.exports = { ... }` at the end of the file.

## Comments

Comment the decision, not the code. If a reader can see what a line does, it
does not need a comment; if they would wonder why it is written that way, it
does.

Write them as sentences, capital letter and full stop, one to three lines. No
JSDoc blocks. No section dividers. No emoji, here or anywhere else.

## Errors

Handle what can actually go wrong. A `try/catch` around code that cannot throw
is noise, and it hides the places that really do need one.

Async handlers go through `asyncHandler` so a rejected promise reaches the error
middleware instead of hanging the request. Express 4 does not do this for us.

Error responses are JSON under `/api` and a rendered page everywhere else. One
middleware decides that, not each handler.

## Commits and pull requests

Commit as you work, not in one pile at the end. Short subject line, present
tense. A body only when there was a decision worth recording; the diff already
says what changed.

One concern per pull request. If the description needs the word "and", it is two
pull requests. Keep them under about 300 lines so they can actually be read.

Nothing reaches main except through a pull request, even a small change, so the
history says what went in and why. Describe what the change does and how you
checked it.

When someone else is around to read it, ask them, especially for anything the
rest of us build on. We are each examined on the whole system separately, so
reading each other's pull requests is the cheap way to get there.

## Using AI tools

Allowed, and say so openly. Two rules.

Type the code yourself. Pasting a generated file leaves you unable to answer for
it, and it reads differently from the rest of the repo.

If you cannot explain a line without looking it up, delete it. A line nobody in
the group can defend costs more than the feature it implements.
