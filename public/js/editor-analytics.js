// Wrapped so that these names belong to this screen only. See site.js.
// The () at the very end calls the function straight away, so everything in it
// runs once, as soon as the browser runs this file. The script tag is defer, so
// that is after the HTML has been read and every element below already exists.
(() => {
const panel = document.getElementById('chart-panel');
const find = document.getElementById('find');
const q = document.getElementById('q');
const choices = document.getElementById('choices');
const pickerLoading = document.getElementById('picker-loading');
const pickerEmpty = document.getElementById('picker-empty');
const pickerProblem = document.getElementById('picker-problem');
const more = document.getElementById('more');
const nothing = document.getElementById('nothing');
const report = document.getElementById('report');
const reportTitle = document.getElementById('report-title');
const reportMeta = document.getElementById('report-meta');
const reportLink = document.getElementById('report-link');
const chartProblem = document.getElementById('chart-problem');
const caption = document.getElementById('chart-caption');
const impact = document.getElementById('impact');
const impactHint = document.getElementById('impact-hint');
const impactEmpty = document.getElementById('impact-empty');
const canvas = document.getElementById('chart');
const ranges = [...document.querySelectorAll('[data-range]')];

const CATEGORIES = {
  news: 'חדשות',
  politics: 'פוליטיקה',
  economy: 'כלכלה',
  sports: 'ספורט',
  culture: 'תרבות',
  technology: 'טכנולוגיה',
  health: 'בריאות'
};

const WORDING = {
  400: 'הבקשה אינה תקינה.',
  401: 'פג תוקף החיבור. יש להתחבר מחדש.',
  403: 'האזור הזה הוא לעורכים.',
  404: 'הכתבה אינה קיימת.'
};

const explain = (code) => WORDING[code] || 'לא הצלחנו לטעון את הנתונים. נסו שוב.';

const number = (n) => Math.round(n).toLocaleString('he-IL');
const decimal = (n) => n.toLocaleString('he-IL', { maximumFractionDigits: 1 });

const stamp = (ms, withDay) => new Date(ms).toLocaleString('he-IL', withDay
  ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
  : { hour: '2-digit', minute: '2-digit' });

async function get(url) {
  try {
    const response = await fetch(url);
    return { ok: response.ok, status: response.status, body: response.ok ? await response.json() : null };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

// Picking an article ----------------------------------------------------------

let cursor = null;
let generation = 0;
let selected = panel.dataset.selected || '';

function choice(article) {
  const li = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'choice';
  button.dataset.id = article.id;
  button.setAttribute('aria-pressed', String(article.id === selected));

  const title = document.createElement('span');
  title.className = 'choice-title';
  title.textContent = article.title;

  const meta = document.createElement('span');
  meta.className = 'choice-meta';
  meta.textContent = number(article.viewCount) + ' צפיות · ' + (CATEGORIES[article.category] || article.category);

  button.append(title, meta);
  button.addEventListener('click', () => pick(article.id));
  li.append(button);
  return li;
}

async function list(fresh) {
  const mine = ++generation;
  if (fresh) {
    cursor = null;
    choices.replaceChildren();
  }

  pickerProblem.hidden = true;
  pickerEmpty.hidden = true;
  pickerLoading.hidden = false;
  more.hidden = true;

  const params = new URLSearchParams({ all: 'true', status: 'published', sort: 'popular', limit: '15' });
  if (q.value.trim()) params.set('q', q.value.trim());
  if (cursor) params.set('after', cursor);

  const answer = await get('/api/articles?' + params);

  // A later search has been typed since; its answer is the one that counts.
  if (mine !== generation) return;
  pickerLoading.hidden = true;

  if (!answer.ok) {
    pickerProblem.textContent = answer.status ? explain(answer.status) : 'אין חיבור לשרת.';
    pickerProblem.hidden = false;
    return;
  }

  for (const article of answer.body.articles) choices.append(choice(article));
  cursor = answer.body.nextCursor;
  more.hidden = !cursor;
  pickerEmpty.hidden = choices.children.length > 0;
}

let typing;
q.addEventListener('input', () => {
  clearTimeout(typing);
  typing = setTimeout(() => list(true), 300);
});

find.addEventListener('submit', (event) => {
  event.preventDefault();
  clearTimeout(typing);
  list(true);
});

more.addEventListener('click', () => list(false));

// The chart -------------------------------------------------------------------

let range = 'all';
let chart = null;
let data = null;
let drawing = 0;

// Every colour comes from tokens.css, read at the moment of drawing, so the
// chart follows the light and dark modes like the rest of the page.
const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// The update markers. Chart.js draws the line; this draws one vertical rule per
// publication over it, at the exact minute it happened rather than snapped to
// the nearest window, with a label so it does not depend on colour alone.
const markers = {
  id: 'publications',
  afterDatasetsDraw(target) {
    const { ctx, chartArea: area, scales: { x } } = target;
    const color = token('--state-pending');

    ctx.save();
    for (const entry of data.publications) {
      const at = new Date(entry.at).getTime();
      if (at < x.min || at > x.max) continue;

      const left = x.getPixelForValue(at);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(left, area.top);
      ctx.lineTo(left, area.bottom);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = '600 12px Assistant, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(entry.first ? 'פרסום' : 'עדכון', left, area.top - 6);
    }
    ctx.restore();
  }
};

function draw() {
  if (chart) chart.destroy();

  const span = data.buckets.length ? new Date(data.to) - new Date(data.from) : 0;
  const withDay = span > 24 * 60 * 60 * 1000;
  const ink = token('--ink-soft');
  const rule = token('--rule');
  const accent = token('--accent');

  chart = new Chart(canvas, {
    type: 'line',
    data: {
      datasets: [{
        label: 'צפיות',
        data: data.buckets.map((b) => ({ x: new Date(b.at).getTime(), y: b.count })),
        borderColor: accent,
        backgroundColor: token('--accent-soft'),
        fill: true,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.25
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 18 } },
      scales: {
        // A linear axis of milliseconds rather than Chart.js's time axis, which
        // needs a date library of its own. The labels are formatted here instead.
        x: {
          type: 'linear',
          min: new Date(data.from).getTime(),
          max: new Date(data.to).getTime(),
          ticks: { color: ink, maxTicksLimit: 8, callback: (value) => stamp(value, withDay) },
          grid: { color: rule }
        },
        y: {
          beginAtZero: true,
          ticks: { color: ink, precision: 0 },
          grid: { color: rule },
          title: { display: true, color: ink, text: 'צפיות בכל ' + windowName(data.stepMinutes) }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          rtl: true,
          callbacks: {
            title: (items) => stamp(items[0].parsed.x, true),
            label: (item) => number(item.parsed.y) + ' צפיות'
          }
        }
      }
    },
    plugins: [markers]
  });
}

function windowName(minutes) {
  if (minutes < 60) return minutes + ' דקות';
  if (minutes === 60) return 'שעה';
  if (minutes < 1440) return (minutes / 60) + ' שעות';
  return 'יום';
}

function change(before, after) {
  if (!before) return after ? 'חדש' : '—';
  const percent = ((after - before) / before) * 100;
  return (percent > 0 ? '+' : '') + Math.round(percent) + '%';
}

function table() {
  impact.replaceChildren();
  impactEmpty.hidden = data.impact.length > 0;
  impactHint.textContent = 'סכום הצפיות ב־' + data.impactHours + ' השעות שלפני כל פרסום ושאחריו, ובממוצע לשעה. '
    + 'כשפרסום קרה לאחרונה, הממוצע שאחריו מחושב רק על השעות שכבר עברו.';

  for (const row of data.impact) {
    const tr = document.createElement('tr');
    const cells = [
      stamp(new Date(row.at).getTime(), true),
      row.first ? 'פרסום ראשון' : 'עדכון',
      number(row.before),
      number(row.after),
      decimal(row.beforeRate),
      decimal(row.afterRate),
      row.first ? '—' : change(row.beforeRate, row.afterRate)
    ];
    for (const text of cells) tr.append(Object.assign(document.createElement('td'), { textContent: text }));
    impact.append(tr);
  }
}

async function show() {
  const mine = ++drawing;
  chartProblem.hidden = true;

  const answer = await get('/api/articles/' + encodeURIComponent(selected) + '/views?range=' + range);
  if (mine !== drawing) return;

  if (!answer.ok) {
    chartProblem.textContent = answer.status ? explain(answer.status) : 'אין חיבור לשרת.';
    chartProblem.hidden = false;
    return;
  }

  data = answer.body;

  reportTitle.textContent = data.article.title;
  reportMeta.textContent = (CATEGORIES[data.article.category] || data.article.category)
    + ' · ' + number(data.article.viewCount) + ' צפיות בסך הכל'
    + ' · ' + data.publications.length + ' פרסומים בטווח';
  reportLink.href = '/editor/articles/' + data.article.id;

  caption.textContent = number(data.total) + ' צפיות בטווח שנבחר, בחלונות של ' + windowName(data.stepMinutes) + '. '
    + 'הקווים המקווקווים הם רגעי האישור והפרסום.';

  nothing.hidden = true;
  report.hidden = false;
  draw();
  table();
}

function pick(id) {
  selected = id;
  for (const button of choices.querySelectorAll('.choice')) {
    button.setAttribute('aria-pressed', String(button.dataset.id === id));
  }

  // In the address bar, so a reload or a shared link opens the same chart.
  history.replaceState(null, '', '?article=' + encodeURIComponent(id));

  // The list is long, and a pick far down it would otherwise redraw a chart
  // that is off the top of the screen, so the click looks like it did nothing.
  // Only when the chart is out of sight, and without the animation for anybody
  // who has asked their system for less motion.
  if (panel.getBoundingClientRect().top < 0) {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    panel.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
  }

  show();
}

for (const button of ranges) {
  button.addEventListener('click', () => {
    range = button.dataset.range;
    for (const other of ranges) other.setAttribute('aria-pressed', String(other === button));
    if (selected) show();
  });
}

// The toggle in the masthead changes data-theme, and a canvas does not restyle
// itself, so the chart is drawn again in the new colours.
new MutationObserver(() => { if (chart && data) draw(); })
  .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

list(true);
if (selected) show();
})();
