// Wrapped so that these names belong to this screen only. See site.js.
// The () at the very end calls the function straight away, so everything in it
// runs once, as soon as the browser runs this file. The script tag is defer, so
// that is after the HTML has been read and every element below already exists.
(() => {
// Analytics (/editor/analytics): the dashboard view, "סטטיסטיקות צפייה" (the whole site).
const dashboard = document.getElementById('dashboard');
const overviewProblem = document.getElementById('overview-problem');
const kpiViews = document.getElementById('kpi-views');
const kpiViewsNote = document.getElementById('kpi-views-note');
const kpiViewed = document.getElementById('kpi-viewed');
const kpiViewedNote = document.getElementById('kpi-viewed-note');
const kpiPublished = document.getElementById('kpi-published');
const kpiUpdates = document.getElementById('kpi-updates');
const siteCanvas = document.getElementById('site-chart');
const siteCaption = document.getElementById('site-caption');
const topRows = document.getElementById('top');
const topEmpty = document.getElementById('top-empty');
const categoryCanvas = document.getElementById('category-chart');

// Analytics: the "ניתוח כתבה בודדת" search, at the bottom of the dashboard.
const find = document.getElementById('find');
const q = document.getElementById('q');
const resultsBox = document.getElementById('results-box');
const results = document.getElementById('results');
const pickerEmpty = document.getElementById('picker-empty');
const pickerProblem = document.getElementById('picker-problem');

// Analytics (/editor/analytics?article=<id>): one article's report.
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

// Analytics: the range buttons "24 שעות" / "7 ימים" / "30 יום" / "מאז ומעולם".
// Both views have their own set; they share one range between them.
const ranges = [...document.querySelectorAll('[data-range]')];

// The server answers in English; this is what the editor reads instead.
const WORDING = {
  400: 'הבקשה אינה תקינה.',
  401: 'פג תוקף החיבור. יש להתחבר מחדש.',
  403: 'האזור הזה הוא לעורכים.',
  404: 'הכתבה אינה קיימת.'
};

const explain = (code) => WORDING[code] || 'לא הצלחנו לטעון את הנתונים. נסו שוב.';

// Number and date formatting, all in Hebrew.
const number = (n) => Math.round(n).toLocaleString('he-IL');
const decimal = (n) => n.toLocaleString('he-IL', { maximumFractionDigits: 1 });
const percent = (n) => Math.round(n * 100) + '%';

const stamp = (ms, withDay) => new Date(ms).toLocaleString('he-IL', withDay
  ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
  : { hour: '2-digit', minute: '2-digit' });

const categoryName = (key) => site.categories[key] || key;

// Analytics: shows an error (e.g. "אין חיבור לשרת.") in one of the page's problem boxes.
const fail = (box, answer) => {
  box.textContent = answer.status ? explain(answer.status) : 'אין חיבור לשרת.';
  box.hidden = false;
};

// Builds a table cell holding text or elements. textContent, never HTML: titles are user input.
const cell = (...children) => {
  const td = document.createElement('td');
  td.append(...children);
  return td;
};

// Analytics: the "כותרת" cell of a picker table, kept wide enough to read.
const titleCell = (text) => Object.assign(cell(text), { className: 'title' });

// Analytics: the "לניתוח הכתבה" button, used in both tables. Opens that article's report.
const openButton = (id) => {
  const button = Object.assign(document.createElement('button'), {
    type: 'button',
    className: 'quiet',
    textContent: 'לניתוח הכתבה'
  });
  button.addEventListener('click', () => pick(id));
  return button;
};

// Shared state ----------------------------------------------------------------

// The selected time range, shared by the dashboard and the report.
let range = '7d';

// Every colour comes from tokens.css, read at the moment of drawing, so the
// charts follow the light and dark modes like the rest of the page.
const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Every chart on the page, by name, so a redraw can destroy the old one first.
const charts = {};

// The size of one chart window in words: "15 דקות", "שעה", "יום".
function windowName(minutes) {
  if (minutes < 60) return minutes + ' דקות';
  if (minutes === 60) return 'שעה';
  if (minutes < 1440) return (minutes / 60) + ' שעות';
  return 'יום';
}

// One line chart of views over time: "צפיות באתר לאורך זמן" on the dashboard,
// and the article's chart on its report.
function lineChart(name, target, series, extra = []) {
  if (charts[name]) charts[name].destroy();

  // Longer than a day, the axis labels need the date as well as the time.
  const span = series.buckets.length ? new Date(series.to) - new Date(series.from) : 0;
  const withDay = span > 24 * 60 * 60 * 1000;
  const ink = token('--ink-soft');
  const rule = token('--rule');

  charts[name] = new Chart(target, {
    type: 'line',
    data: {
      datasets: [{
        label: 'צפיות',
        // One point per window: x is the time in ms, y the views in it.
        data: series.buckets.map((b) => ({ x: new Date(b.at).getTime(), y: b.count })),
        borderColor: token('--accent'),
        backgroundColor: token('--accent-soft'),
        fill: true,
        borderWidth: 2,
        // No dots on the line, only when hovering.
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.25
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      // The tooltip follows the mouse along the x axis, no need to hit the line.
      interaction: { mode: 'index', intersect: false },
      // Room above the chart for the publication labels.
      layout: { padding: { top: 18 } },
      scales: {
        // A linear axis of milliseconds rather than Chart.js's time axis, which
        // needs a date library of its own. The labels are formatted here instead.
        x: {
          type: 'linear',
          min: new Date(series.from).getTime(),
          max: new Date(series.to).getTime(),
          ticks: { color: ink, maxTicksLimit: 8, callback: (value) => stamp(value, withDay) },
          grid: { color: rule }
        },
        y: {
          beginAtZero: true,
          ticks: { color: ink, precision: 0 },
          grid: { color: rule },
          title: { display: true, color: ink, text: 'צפיות בכל ' + windowName(series.stepMinutes) }
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
    // Extra drawing on top, like the publication markers.
    plugins: extra
  });
}

// The dashboard ---------------------------------------------------------------

// The last dashboard answer from the server, or null when it needs fetching.
let overview = null;
// Same idea as `drawing` below: only the newest dashboard request may paint.
let surveying = 0;

// Analytics: the note under "צפיות בטווח", e.g. "▲ +12% לעומת התקופה הקודמת".
function trend(now, before) {
  if (before === null) return 'מאז הצפייה הראשונה באתר';
  if (!before) return now ? 'לא היו צפיות בתקופה הקודמת' : '';
  const change = Math.round(((now - before) / before) * 100);
  const arrow = change > 0 ? '▲ +' : change < 0 ? '▼ ' : '';
  return arrow + change + '% לעומת התקופה הקודמת';
}

// Analytics: fills the tiles "צפיות בטווח", "כתבות שנצפו", "כתבות חדשות שפורסמו", "עדכונים שפורסמו".
function kpis() {
  kpiViews.textContent = number(overview.total);
  kpiViewsNote.textContent = trend(overview.total, overview.previousTotal);
  kpiViewed.textContent = number(overview.viewed);
  kpiViewedNote.textContent = 'מתוך ' + number(overview.live) + ' שבאוויר';
  kpiPublished.textContent = number(overview.published);
  kpiUpdates.textContent = number(overview.updates);
}

// Analytics: fills the "הנצפות ביותר בטווח" table.
function topTable() {
  topRows.replaceChildren();
  topEmpty.hidden = overview.top.length > 0;

  overview.top.forEach((row, index) => {
    const tr = document.createElement('tr');
    tr.append(
      cell(String(index + 1)),
      titleCell(row.title),
      cell(categoryName(row.category)),
      cell(number(row.views)),
      cell(percent(row.share)),
      cell(openButton(row.id))
    );
    topRows.append(tr);
  });
}

// Analytics: draws the "צפיות לפי קטגוריה" chart, one bar per category, biggest first.
function categoryChart() {
  if (charts.categories) charts.categories.destroy();

  // Copied before sorting so the server's order is kept.
  const sorted = [...overview.categories].sort((a, b) => b.views - a.views);
  const ink = token('--ink-soft');

  charts.categories = new Chart(categoryCanvas, {
    type: 'bar',
    data: {
      labels: sorted.map((row) => categoryName(row.category)),
      datasets: [{ label: 'צפיות', data: sorted.map((row) => row.views), backgroundColor: token('--accent') }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        // reverse, so in a right to left page the bars grow from the right.
        x: { reverse: true, beginAtZero: true, ticks: { color: ink, precision: 0 }, grid: { color: token('--rule') } },
        y: { position: 'right', ticks: { color: ink }, grid: { display: false } }
      },
      plugins: {
        legend: { display: false },
        tooltip: { rtl: true, callbacks: { label: (item) => number(item.parsed.x) + ' צפיות' } }
      }
    }
  });
}

// Analytics: draws every part of the "סטטיסטיקות צפייה" dashboard from the data already loaded.
function paintDashboard() {
  kpis();
  lineChart('site', siteCanvas, overview);
  // The line under the chart: "... צפיות בכל האתר בטווח שנבחר, בחלונות של ...".
  siteCaption.textContent = number(overview.total) + ' צפיות בכל האתר בטווח שנבחר, בחלונות של '
    + windowName(overview.stepMinutes) + '.';
  topTable();
  categoryChart();
}

// Fetches the dashboard numbers for the current range, then draws them.
async function survey() {
  const mine = ++surveying;
  overviewProblem.hidden = true;

  const answer = await site.request('GET', '/api/analytics/overview?range=' + range);
  if (mine !== surveying) return;

  if (!answer.ok) return fail(overviewProblem, answer);

  overview = answer.body;
  paintDashboard();
}

// The article picker ----------------------------------------------------------

// Every search carries a number, and an answer to anything but the latest is
// dropped: typing a word sends a search per pause, and an early one arriving
// last would otherwise paint its rows under the final query.
let generation = 0;

// Analytics: one row of the "ניתוח כתבה בודדת" results table.
function resultRow(article) {
  const tr = document.createElement('tr');
  tr.append(
    titleCell(article.title),
    cell(categoryName(article.category)),
    cell(number(article.viewCount)),
    cell(openButton(article.id))
  );
  return tr;
}

// Analytics: the "חיפוש לפי כותרת" box. Searches published articles; an empty box hides the results.
async function search() {
  const mine = ++generation;
  const text = q.value.trim();
  pickerProblem.hidden = true;

  // Nothing typed: hide the table instead of showing every article.
  if (!text) {
    resultsBox.hidden = true;
    pickerEmpty.hidden = true;
    return;
  }

  // The editor's list API, narrowed to the 8 most viewed published matches.
  const params = new URLSearchParams({ all: 'true', status: 'published', sort: 'popular', limit: '8', q: text });
  const answer = await site.request('GET', '/api/articles?' + params);
  if (mine !== generation) return;

  if (!answer.ok) return fail(pickerProblem, answer);

  results.replaceChildren(...answer.body.articles.map(resultRow));
  resultsBox.hidden = answer.body.articles.length === 0;
  pickerEmpty.hidden = answer.body.articles.length > 0;
}

// Waits for a short pause in typing, so not every letter sends a request.
let typing;
q.addEventListener('input', () => {
  clearTimeout(typing);
  typing = setTimeout(search, 300);
});

// Enter searches at once.
find.addEventListener('submit', (event) => {
  event.preventDefault();
  clearTimeout(typing);
  search();
});

// One article's report ----------------------------------------------------------

// The last report answer for the selected article.
let data = null;
// Counts chart requests. If you click 7d and then 30d quickly, the 7d answer can
// arrive last; each request remembers its number, and only the newest one draws.
let drawing = 0;

// Article report: the dashed "פרסום" / "עדכון" lines on the chart, one per publication,
// at the exact minute it happened, with a label so it does not depend on colour alone.
const markers = {
  id: 'publications',
  afterDatasetsDraw(target) {
    const { ctx, chartArea: area, scales: { x } } = target;
    const color = token('--state-pending');

    ctx.save();
    for (const entry of data.publications) {
      // Skip a publication that falls outside the visible range.
      const at = new Date(entry.at).getTime();
      if (at < x.min || at > x.max) continue;

      // The dashed vertical line.
      const left = x.getPixelForValue(at);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(left, area.top);
      ctx.lineTo(left, area.bottom);
      ctx.stroke();

      // The label above the line.
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = '600 12px Assistant, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(entry.first ? 'פרסום' : 'עדכון', left, area.top - 6);
    }
    ctx.restore();
  }
};

// Article report: the "שינוי" column, e.g. "+25%", or "חדש" when there was nothing before.
function change(before, after) {
  if (!before) return after ? 'חדש' : '—';
  const value = ((after - before) / before) * 100;
  return (value > 0 ? '+' : '') + Math.round(value) + '%';
}

// Article report: fills the "לפני ואחרי כל פרסום" table, one row per publication.
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

// Draws the article's chart, with the publication markers on top.
const drawReport = () => lineChart('article', canvas, data, [markers]);

// Fetches one article's series for the current range, then fills the report.
async function show() {
  const mine = ++drawing;
  chartProblem.hidden = true;

  const answer = await site.request('GET', '/api/articles/' + encodeURIComponent(selected) + '/views?range=' + range);
  if (mine !== drawing) return;

  if (!answer.ok) return fail(chartProblem, answer);

  data = answer.body;

  // Article report heading: title, then "... צפיות בסך הכל · ... פרסומים בטווח".
  reportTitle.textContent = data.article.title;
  reportMeta.textContent = categoryName(data.article.category)
    + ' · ' + number(data.article.viewCount) + ' צפיות בסך הכל'
    + ' · ' + data.publications.length + ' פרסומים בטווח';
  reportLink.href = '/editor/articles/' + data.article.id;

  // The line under the chart: "... צפיות בטווח שנבחר ..." and what the dashed lines mean.
  caption.textContent = number(data.total) + ' צפיות בטווח שנבחר, בחלונות של ' + windowName(data.stepMinutes) + '. '
    + 'הקווים המקווקווים הם רגעי האישור והפרסום.';

  drawReport();
  table();
}

// Switching views ---------------------------------------------------------------

// The id of the article whose report is open, or '' on the dashboard.
let selected = report.dataset.selected || '';

// Where the dashboard was scrolled to, so coming back from a report lands on
// the same spot rather than at the top.
let dashScroll = 0;

// The dashboard is loaded the first time it is shown, and again when the range changes.
function showDashboard() {
  report.hidden = true;
  dashboard.hidden = false;
  if (overview) paintDashboard(); else survey();
  window.scrollTo(0, dashScroll);
}

// Swaps to one article's report and loads it.
function showReport() {
  dashboard.hidden = true;
  report.hidden = false;
  window.scrollTo(0, 0);
  show();
}

// A new entry in the history, so the browser's own back button returns to the
// dashboard, and the address bar names the article so a reload opens the same chart.
function pick(id) {
  dashScroll = window.scrollY;
  selected = id;
  history.pushState({ article: id }, '', '?article=' + encodeURIComponent(id));
  showReport();
}

// The browser's back and forward buttons, between the dashboard and a report.
window.addEventListener('popstate', () => {
  selected = new URLSearchParams(location.search).get('article') || '';
  if (selected) showReport(); else showDashboard();
});

// The "חזרה ללוח הבקרה" button. After a pick it is the same as the browser's;
// when the page was opened straight on a report there is nothing to go back to,
// so it swaps to the dashboard and rewrites the address instead.
back.addEventListener('click', () => {
  if (history.state && history.state.article) {
    history.back();
    return;
  }
  history.replaceState(null, '', location.pathname);
  selected = '';
  showDashboard();
});

// A range click updates both sets of buttons, then reloads whichever view is showing.
for (const button of ranges) {
  button.addEventListener('click', () => {
    range = button.dataset.range;
    for (const other of ranges) other.setAttribute('aria-pressed', String(other.dataset.range === range));

    // The dashboard's numbers are now for the old range; drop them so it refetches.
    overview = null;
    if (!report.hidden) show(); else survey();
  });
}

// The "מצב כהה" toggle in the masthead changes data-theme, and a canvas does not restyle
// itself, so whatever is on screen is drawn again in the new colours.
new MutationObserver(() => {
  if (!report.hidden && data) drawReport();
  if (!dashboard.hidden && overview) paintDashboard();
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// First paint: the report if the address names an article, the dashboard otherwise.
if (selected) showReport(); else showDashboard();
})();
