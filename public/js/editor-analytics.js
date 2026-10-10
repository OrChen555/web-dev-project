// Wrapped so that these names belong to this screen only. See site.js.
// The () at the very end calls the function straight away, so everything in it
// runs once, as soon as the browser runs this file. The script tag is defer, so
// that is after the HTML has been read and every element below already exists.
(() => {
const browse = document.getElementById('browse');
const find = document.getElementById('find');
const q = document.getElementById('q');
const choices = document.getElementById('choices');
const pickerLoading = document.getElementById('picker-loading');
const pickerEmpty = document.getElementById('picker-empty');
const pickerProblem = document.getElementById('picker-problem');
const sentinel = document.getElementById('sentinel');
const report = document.getElementById('report');
const back = document.getElementById('back');
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

const day = (iso) => new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'long' });

// The grid of articles ---------------------------------------------------------

let cursor = null;
let done = false;
let busy = false;
let loaded = false;

// Every request carries a number, and an answer to anything but the latest is
// dropped: typing a word sends a search per letter, and an early one arriving
// last would otherwise paint its cards under the final query.
let generation = 0;

// One card. A real button, so the keyboard reaches it and Enter opens it.
// textContent throughout: a title is whatever its author typed.
function card(article) {
  const li = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'choice';

  const thumb = document.createElement('span');
  thumb.className = 'choice-thumb';
  if (article.image) thumb.style.backgroundImage = 'url("' + encodeURI(article.image) + '")';

  const title = document.createElement('span');
  title.className = 'choice-title';
  title.textContent = article.title;

  const meta = document.createElement('span');
  meta.className = 'choice-meta';
  meta.textContent = (site.categories[article.category] || article.category)
    + ' · ' + number(article.viewCount) + ' צפיות'
    + (article.publishedAt ? ' · ' + day(article.publishedAt) : '');

  button.append(thumb, title, meta);
  button.addEventListener('click', () => pick(article.id));
  li.append(button);
  return li;
}

async function list() {
  if (busy || done) return;
  busy = true;
  const mine = generation;

  pickerProblem.hidden = true;
  pickerLoading.hidden = false;

  const params = new URLSearchParams({ all: 'true', status: 'published', sort: 'popular', limit: '24' });
  if (q.value.trim()) params.set('q', q.value.trim());
  if (cursor) params.set('after', cursor);

  const answer = await site.request('GET', '/api/articles?' + params);
  if (mine !== generation) return;

  busy = false;
  pickerLoading.hidden = true;

  if (!answer.ok) {
    done = true;
    pickerProblem.textContent = answer.status ? explain(answer.status) : 'אין חיבור לשרת.';
    pickerProblem.hidden = false;
    return;
  }

  for (const article of answer.body.articles) choices.append(card(article));
  cursor = answer.body.nextCursor;
  done = !cursor;
  loaded = true;
  pickerEmpty.hidden = choices.children.length > 0;

  // A short page can leave the sentinel on screen, and the observer only fires
  // on a crossing. Asking again here is what keeps a tall window filling.
  if (!done && !browse.hidden && sentinel.getBoundingClientRect().top < window.innerHeight) list();
}

function restart() {
  generation++;
  busy = false;
  done = false;
  cursor = null;
  choices.replaceChildren();
  pickerEmpty.hidden = true;
  list();
}

let typing;
q.addEventListener('input', () => {
  clearTimeout(typing);
  typing = setTimeout(restart, 300);
});

find.addEventListener('submit', (event) => {
  event.preventDefault();
  clearTimeout(typing);
  restart();
});

// An observer rather than a scroll listener, which would fire on every pixel.
// While the chart is showing the grid is hidden, and nothing is loaded for it.
new IntersectionObserver((entries) => {
  if (!browse.hidden && entries.some((entry) => entry.isIntersecting)) list();
}, { rootMargin: '400px' }).observe(sentinel);

// The chart -------------------------------------------------------------------

let range = 'all';
let chart = null;
let data = null;
// Counts chart requests. If you click 7d and then 30d quickly, the 7d answer can
// arrive last; each request remembers its number, and only the newest one draws.
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

  const answer = await site.request('GET', '/api/articles/' + encodeURIComponent(selected) + '/views?range=' + range);
  if (mine !== drawing) return;

  if (!answer.ok) {
    chartProblem.textContent = answer.status ? explain(answer.status) : 'אין חיבור לשרת.';
    chartProblem.hidden = false;
    return;
  }

  data = answer.body;

  reportTitle.textContent = data.article.title;
  reportMeta.textContent = (site.categories[data.article.category] || data.article.category)
    + ' · ' + number(data.article.viewCount) + ' צפיות בסך הכל'
    + ' · ' + data.publications.length + ' פרסומים בטווח';
  reportLink.href = '/editor/articles/' + data.article.id;

  caption.textContent = number(data.total) + ' צפיות בטווח שנבחר, בחלונות של ' + windowName(data.stepMinutes) + '. '
    + 'הקווים המקווקווים הם רגעי האישור והפרסום.';

  draw();
  table();
}

// Switching views ---------------------------------------------------------------

let selected = report.dataset.selected || '';

// Where the grid was scrolled to, so coming back from a chart lands on the same
// cards rather than at the top of a long list.
let gridScroll = 0;

function showGrid() {
  report.hidden = true;
  browse.hidden = false;
  if (!loaded) list();
  window.scrollTo(0, gridScroll);
}

function showChart() {
  browse.hidden = true;
  report.hidden = false;
  window.scrollTo(0, 0);
  show();
}

// A new entry in the history, so the browser's own back button returns to the
// grid, and the address bar names the article so a reload opens the same chart.
function pick(id) {
  gridScroll = window.scrollY;
  selected = id;
  history.pushState({ article: id }, '', '?article=' + encodeURIComponent(id));
  showChart();
}

// The browser's back and forward buttons, between the grid and a chart.
window.addEventListener('popstate', () => {
  selected = new URLSearchParams(location.search).get('article') || '';
  if (selected) showChart(); else showGrid();
});

// The page's own back button. After a pick it is the same as the browser's;
// when the page was opened straight on a chart there is nothing to go back to,
// so it swaps to the grid and rewrites the address instead.
back.addEventListener('click', () => {
  if (history.state && history.state.article) {
    history.back();
    return;
  }
  history.replaceState(null, '', location.pathname);
  selected = '';
  showGrid();
});

for (const button of ranges) {
  button.addEventListener('click', () => {
    range = button.dataset.range;
    for (const other of ranges) other.setAttribute('aria-pressed', String(other === button));
    if (selected) show();
  });
}

// The toggle in the masthead changes data-theme, and a canvas does not restyle
// itself, so the chart is drawn again in the new colours.
new MutationObserver(() => { if (chart && data && !report.hidden) draw(); })
  .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

if (selected) showChart(); else showGrid();
})();
