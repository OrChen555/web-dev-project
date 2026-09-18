const fs = require('fs');
const path = require('path');

const config = require('./config');

const directory = path.join(__dirname, '..', 'logs');

// logs/ is not in version control, so it does not exist in a fresh clone.
fs.mkdirSync(directory, { recursive: true });

const file = fs.createWriteStream(path.join(directory, 'app.log'), { flags: 'a' });

function write(level, message, details) {
  const entry = { time: new Date().toISOString(), level, message, ...details };

  // Writing a log line must never be the thing that stops the process, and a
  // caller can hand us something circular without meaning to.
  let line;
  try {
    line = JSON.stringify(entry);
  } catch {
    line = JSON.stringify({ time: entry.time, level, message, details: 'could not be serialised' });
  }

  file.write(line + '\n');
  if (!config.isProduction) console.log(line);
}

const info = (message, details) => write('info', message, details);
const warn = (message, details) => write('warn', message, details);
const error = (message, details) => write('error', message, details);

module.exports = { info, warn, error };
