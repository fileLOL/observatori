let data;
const DEFAULT_PAGE_SIZE = 24;
const pageSize = () => Number(data && data.pageSize) || DEFAULT_PAGE_SIZE;
const state = { topic: 'Tots', query: '', limit: DEFAULT_PAGE_SIZE };
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const formatDate = iso => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || '');
};
const stampOf = iso => {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(t) ? 0 : t;
};
const formatMoment = iso => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ca-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

async function init() {
  const [content, stances] = await Promise.all([
    fetch('data/content.json').then(r => r.json()),
    fetch('data/stances.json').then(r => r.json())
  ]);
  data = content;
  data.stances = stances;
  data.news = (data.news || []).slice().sort((a, b) => stampOf(b.date) - stampOf(a.date));
  state.topic = 'Tots';
  state.limit = pageSize();
  renderFilters();
  renderNews();
  renderPolicies();
  renderMovements();
  renderReferences();
  renderTimestamps();
  renderTicker();
  $('#moreNews').addEventListener('click', () => { state.limit += pageSize(); renderNews(); });
  const search = $('#searchNews');
  let timer;
  search.addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.query = e.target.value.trim(); state.limit = pageSize(); renderNews(); }, 160);
  });
  initNavToggle();
}

function initNavToggle() {
  const top = $('.top');
  const toggle = $('.nav-toggle');
  const nav = $('#navPrincipal');
  if (!top || !toggle || !nav) return;
  const setOpen = open => {
    top.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  const listen = (target, type, handler) => {
    if (target && typeof target.addEventListener === 'function') target.addEventListener(type, handler);
  };
  listen(toggle, 'click', () => setOpen(!top.classList.contains('nav-open')));
  listen(nav, 'click', e => { if (e.target.closest('a')) setOpen(false); });
  listen(document, 'keydown', e => { if (e.key === 'Escape') setOpen(false); });
  listen(globalThis.window, 'resize', () => { if (globalThis.innerWidth > 850) setOpen(false); });
}

function matches(item) {
  if (state.topic !== 'Tots' && item.topic !== state.topic) return false;
  if (!state.query) return true;
  const hay = norm(`${item.title} ${item.text} ${item.source} ${item.topic}`);
  return state.query.split(/\s+/).filter(Boolean).every(word => hay.includes(norm(word)));
}

function renderFilters() {
  const el = $('#filters');
  const topics = ['Tots', ...(data.topics || [])].filter((t, i, all) => all.indexOf(t) === i);
  el.innerHTML = topics.map(topic => {
    const count = topic === 'Tots' ? data.news.length : data.news.filter(n => n.topic === topic).length;
    return `<button class="filter ${topic === state.topic ? 'active' : ''}" data-topic="${esc(topic)}">${esc(topic)}<span class="n">${count}</span></button>`;
  }).join('');
  el.onclick = e => {
    const b = e.target.closest('.filter');
    if (!b) return;
    state.topic = b.dataset.topic;
    state.limit = pageSize();
    el.querySelectorAll('.filter').forEach(x => x.classList.toggle('active', x === b));
    renderNews();
  };
}

const classOf = value => (value === 'A favor' ? 'yes' : value === 'En contra' ? 'no' : value === 'Abstenció' ? 'mixed' : 'unknown');

function partyGrid(positions, parties) {
  return `<div class="party-grid">${parties.map(party => {
    const value = positions[party] || 'No consta';
    return `<div class="party-cell ${classOf(value)}"><b>${esc(party)}</b>${esc(value)}</div>`;
  }).join('')}</div>`;
}

function renderNews() {
  const items = data.news.filter(matches);
  const visible = items.slice(0, state.limit);
  const grid = $('#news');
  grid.innerHTML = visible.length
    ? visible.map(n => `<article class="news"><div class="topic">${esc(n.topic)}</div><h3>${esc(n.title)}</h3><p>${esc(n.text)}</p><div class="meta"><span>${esc(n.source)} · <time datetime="${esc(n.date)}">${esc(formatDate(n.date))}</time></span><a href="${esc(n.url)}" target="_blank" rel="noopener">Font ↗</a></div></article>`).join('')
    : '<div class="empty">Cap resultat amb aquests criteris. Prova un altre tema o una altra paraula.</div>';
  $('#newsCount').textContent = `${visible.length} de ${items.length} notícies`;
  const more = $('#moreNews');
  more.hidden = visible.length >= items.length;
}

function renderTimestamps() {
  const when = data.updatedAt || data.updated;
  const text = when ? `Darrera actualització: ${formatMoment(when)}` : '';
  $('#lastUpdate').textContent = text;
  $('#footerUpdate').textContent = `${text} · Projecte obert · dades i criteris revisables`;
  const ok = (data.feedStatus || []).filter(f => f.ok).length;
  const total = (data.feedStatus || []).length;
  if (total) $('#lastUpdate').title = `${ok}/${total} feeds llegits correctament`;
}

function relatedNews(id) {
  return (data.news || []).filter(item => item.issue === id);
}

function renderPolicies() {
  const stances = data.stances || {};
  const parties = stances.parties || [];
  const issues = Object.entries(stances.issues || {});
  $('#policyList').innerHTML = issues.map(([id, issue]) => {
    const related = relatedNews(id);
    const block = related.length
      ? `<div class="issue-news"><span class="label">Notícies relacionades · ${related.length}</span><ul>${related.map(n => `<li><time datetime="${esc(n.date)}">${esc(formatDate(n.date))}</time><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)} ↗</a></li>`).join('')}</ul></div>`
      : '<div class="issue-news"><span class="label">Notícies relacionades</span><p class="stance-note">Cap notícia d’avui encaixa amb aquesta mesura.</p></div>';
    return `<article class="policy"><div><h3>${esc(issue.label)}</h3><p>${esc(issue.desc)}<br><br><a href="${esc(issue.url)}" target="_blank" rel="noopener" style="color:#ffd400">${esc(issue.source)} ↗</a></p>${block}</div><div class="stance-wrap">${partyGrid(issue.positions, parties)}</div></article>`;
  }).join('');
}

function renderMovements() {
  $('#movementGrid').innerHTML = (data.movements || []).map(m => `<article class="movement"><div class="symbol">${esc(m.symbol)}</div><h3>${esc(m.topic)}</h3><p class="seu-tag">${esc(m.seu || '')}</p><ul class="links">${(m.groups || []).map(g => `<li><a href="${esc(g.web)}" target="_blank" rel="noopener">${esc(g.name)} ↗</a></li>`).join('')}</ul><p style="font-size:13px;color:#666;line-height:1.5">${esc(m.note)}</p></article>`).join('');
}

function renderReferences() {
  $('#referenceGrid').innerHTML = (data.referencias || []).map(r => `<article class="reference"><span class="type">${esc(r.type)}</span><h3>${esc(r.name)}</h3><p>${esc(r.note)}</p><a href="${esc(r.url)}" target="_blank" rel="noopener">Obre ↗</a></article>`).join('');
}

function renderTicker() {
  const top = ['Tots', ...(data.topics || [])]
    .filter(t => t !== 'Tots' && t !== 'Altres')
    .map(t => ({ t, n: data.news.filter(n => n.topic === t).length }))
    .filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 8)
    .map(x => x.t);
  if (top.length) $('#tickerText').textContent = top.join(' · ');
}

init();
