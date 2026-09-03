(() => {
  'use strict';

  // IPC_PRODUCTS, IPC_CATEGORIES, IPC_REGIONS, IPC_REGION_PERIOD vienen de js/data.js (embebidos, sin fetch)
  const productsById = new Map(IPC_PRODUCTS.map(p => [p.id, p]));
  const catById = new Map(IPC_CATEGORIES.map(c => [c.id, c]));
  const COLORS = ['#0f6e5c', '#c23636', '#2563eb', '#e08e0b', '#8b5cf6', '#0891b2', '#be185d', '#65a30d', '#9333ea', '#0d9488', '#ea580c', '#4338ca', '#059669'];
  const colorFor = (id) => COLORS[IPC_PRODUCTS.findIndex(p => p.id === id) % COLORS.length];

  const state = {
    selected: new Set(),
    weights: new Map(),
    period: '60',
    normalize: false,
    search: '',
  };

  let mainChart, cestaChart, donutChart, regionChart;

  function init() {
    restore();
    applyUrlParams();
    document.getElementById('lastUpdate').textContent = fmtPeriod(productsById.get('general').meta.lastPeriod);
    renderCategoryGrid();
    wireEvents();
    initRegionSelect();
    initTheme();
    renderAll();
  }

  // ---------------- Persistencia ----------------
  function restore() {
    try {
      const raw = localStorage.getItem('ipc_v2_state');
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.selected) state.selected = new Set(s.selected);
      if (s.weights) state.weights = new Map(Object.entries(s.weights));
      if (s.period) state.period = s.period;
      if (typeof s.normalize === 'boolean') state.normalize = s.normalize;
      if (s.expense) state.expense = s.expense;
    } catch (e) { /* ignorar estado corrupto */ }
  }
  function persist() {
    try {
      localStorage.setItem('ipc_v2_state', JSON.stringify({
        selected: [...state.selected], weights: Object.fromEntries(state.weights),
        period: state.period, normalize: state.normalize, expense: state.expense,
      }));
    } catch (e) { /* almacenamiento no disponible */ }
  }
  function applyUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const p = params.get('products');
    if (p) state.selected = new Set(p.split(',').filter(id => productsById.has(id)));
    if (params.get('period')) state.period = params.get('period');
    if (params.get('normalize') === '1') state.normalize = true;
  }
  function shareUrl() {
    const params = new URLSearchParams();
    if (state.selected.size) params.set('products', [...state.selected].join(','));
    params.set('period', state.period);
    if (state.normalize) params.set('normalize', '1');
    const url = new URL(window.location.href);
    url.search = params.toString();
    return url.toString();
  }

  // ---------------- Rango de periodo ----------------
  function activeRange() {
    if (state.period === 'all') return { from: null, to: null };
    const periods = productsById.get('general').meta;
    const last = periods.lastPeriod;
    const [y, m] = last.split('-').map(Number);
    let year = y, month = m - Number(state.period);
    while (month <= 0) { month += 12; year -= 1; }
    return { from: `${year}-${String(month).padStart(2, '0')}`, to: null };
  }
  function periodsInRange(p, range) {
    return Object.keys(p.series).sort().filter(per => (!range.from || per >= range.from) && (!range.to || per <= range.to));
  }
  function changeInRange(p, range) {
    const per = periodsInRange(p, range);
    if (per.length < 2) return null;
    return round2((p.series[per[per.length - 1]] / p.series[per[0]] - 1) * 100);
  }
  function yoyChange(p) {
    const periods = Object.keys(p.series).sort();
    const last = periods[periods.length - 1];
    const [y, m] = last.split('-');
    const prev = `${Number(y) - 1}-${m}`;
    if (!(prev in p.series)) return null;
    return round2((p.series[last] / p.series[prev] - 1) * 100);
  }
  function changeFromStart(p) {
    const periods = Object.keys(p.series).sort();
    return round2((p.series[periods[periods.length - 1]] / p.series[periods[0]] - 1) * 100);
  }

  // ---------------- Categorías (= productos, selector único) ----------------
  function renderCategoryGrid() {
    const grid = document.getElementById('categoryGrid');
    const q = state.search.trim().toLowerCase();
    grid.innerHTML = '';
    for (const p of IPC_PRODUCTS) {
      if (q && !p.name.toLowerCase().includes(q)) continue;
      const cat = catById.get(p.category);
      const card = document.createElement('div');
      card.className = 'cat-card';
      card.setAttribute('role', 'option');
      card.tabIndex = 0;
      const selected = state.selected.has(p.id);
      card.setAttribute('aria-selected', String(selected));
      const yoy = yoyChange(p);
      card.innerHTML = `
        <div class="cat-top"><span class="cat-icon">${cat.icon}</span><span>${esc(p.name)}</span></div>
        <div class="cat-metrics"><span>Índice: <b>${fmtNum(p.meta.lastValue)}</b></span><span>Interanual: <b class="${yoy >= 0 ? 'up' : 'down'}">${fmtPct(yoy)}</b></span></div>
      `;
      const toggle = () => {
        if (state.selected.has(p.id)) { state.selected.delete(p.id); state.weights.delete(p.id); }
        else { state.selected.add(p.id); if (!state.weights.has(p.id)) state.weights.set(p.id, 1); }
        persist(); renderCategoryGrid(); renderAll();
      };
      card.addEventListener('click', toggle);
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      grid.appendChild(card);
    }
  }

  function selectedProducts() { return [...state.selected].map(id => productsById.get(id)).filter(Boolean); }

  // ---------------- Render global ----------------
  function renderAll() {
    const range = activeRange();
    renderKpis(range);
    renderChart(range);
    renderCompareTable(range);
    renderCesta(range);
  }

  function renderKpis(range) {
    const wrap = document.getElementById('kpiCards');
    const prods = selectedProducts().length ? selectedProducts() : [productsById.get('general')];
    const withChange = prods.map(p => ({ p, c: changeInRange(p, range) })).filter(x => x.c !== null);
    const avgAcum = withChange.length ? round2(avg(withChange.map(x => x.c))) : null;
    const most = withChange.slice().sort((a, b) => b.c - a.c)[0];
    const least = withChange.slice().sort((a, b) => a.c - b.c)[0];
    wrap.innerHTML = [
      kpi('Inflación media (periodo)', fmtPct(avgAcum)),
      kpi('Más ha subido', most ? `${most.p.name} (${fmtPct(most.c)})` : '—', true),
      kpi('Menos ha subido', least ? `${least.p.name} (${fmtPct(least.c)})` : '—', true),
    ].join('');
  }
  function kpi(label, val, small) { return `<div class="kpi-card"><div class="kpi-label">${label}</div><div class="kpi-value${small ? ' small' : ''}">${val}</div></div>`; }

  function renderChart(range) {
    const canvas = document.getElementById('mainChart');
    const empty = document.getElementById('chartEmpty');
    const prods = selectedProducts();
    empty.classList.toggle('hidden', prods.length > 0);
    canvas.style.display = prods.length ? 'block' : 'none';
    if (!prods.length) { if (mainChart) { mainChart.destroy(); mainChart = null; } return; }

    let periodSet = new Set();
    prods.forEach(p => periodsInRange(p, range).forEach(per => periodSet.add(per)));
    const periods = [...periodSet].sort();
    const datasets = prods.map(p => {
      const basePeriod = periods.find(per => per in p.series);
      const base = p.series[basePeriod];
      return {
        label: p.name,
        data: periods.map(per => per in p.series ? (state.normalize ? round2((p.series[per] / base) * 100) : p.series[per]) : null),
        borderColor: colorFor(p.id), backgroundColor: colorFor(p.id),
        spanGaps: true, tension: .15, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2,
      };
    });
    const cfg = {
      type: 'line',
      data: { labels: periods.map(fmtPeriod), datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } } },
        scales: { x: { ticks: { maxTicksLimit: 9 }, grid: { display: false } }, y: { title: { display: true, text: state.normalize ? 'Base 100 al inicio' : 'Índice' } } },
      },
    };
    if (mainChart) { mainChart.data = cfg.data; mainChart.options = cfg.options; mainChart.update(); }
    else mainChart = new Chart(canvas, cfg);
  }

  function renderCompareTable(range) {
    const tbody = document.querySelector('#compareTable tbody');
    const prods = selectedProducts();
    if (!prods.length) { tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Elige categorías para comparar.</td></tr>'; return; }
    const rows = prods.map(p => ({ p, yoy: yoyChange(p), per: changeInRange(p, range), start: changeFromStart(p) }))
      .sort((a, b) => (b.per ?? -Infinity) - (a.per ?? -Infinity));
    tbody.innerHTML = rows.map(r => `
      <tr><td>${esc(r.p.name)}</td>
        <td class="num ${cls(r.yoy)}">${fmtPct(r.yoy)}</td>
        <td class="num ${cls(r.per)}">${fmtPct(r.per)}</td>
        <td class="num ${cls(r.start)}">${fmtPct(r.start)}</td></tr>
    `).join('');
  }

  // ---------------- Cartera ----------------
  function renderCesta(range) {
    const prods = selectedProducts();
    const rows = document.getElementById('weightRows');
    rows.innerHTML = prods.length ? prods.map(p => `
      <div class="weight-row" data-id="${p.id}">
        <span><span class="sw" style="background:${colorFor(p.id)}"></span>${esc(p.name)}</span>
        <input type="number" min="0" step="1" value="${state.weights.get(p.id) ?? 1}" aria-label="Peso ${esc(p.name)}">
      </div>`).join('') : '<p class="note">Selecciona categorías arriba para construir tu cartera.</p>';

    rows.querySelectorAll('.weight-row input').forEach(inp => {
      inp.addEventListener('input', (e) => {
        const id = e.target.closest('.weight-row').dataset.id;
        state.weights.set(id, Math.max(0, Number(e.target.value) || 0));
        persist(); renderCesta(activeRange());
      });
    });

    const items = prods.map(p => ({ id: p.id, w: state.weights.get(p.id) ?? 1 })).filter(it => it.w > 0);
    const basket = computeBasket(items, range);
    renderDonut(prods);
    renderCestaChart(basket);
    renderCartKpis(basket, prods, range);
    renderScenario(basket);
  }

  function computeBasket(items, range) {
    if (!items.length) return { periods: [], values: [] };
    let common = null;
    for (const it of items) {
      const ps = new Set(Object.keys(productsById.get(it.id).series));
      common = common === null ? ps : new Set([...common].filter(x => ps.has(x)));
    }
    let periods = [...common].sort();
    if (range.from) periods = periods.filter(p => p >= range.from);
    if (range.to) periods = periods.filter(p => p <= range.to);
    const totalW = items.reduce((s, it) => s + it.w, 0);
    const values = periods.map(per => round3(items.reduce((s, it) => s + productsById.get(it.id).series[per] * it.w, 0) / totalW));
    return { periods, values };
  }

  function renderDonut(prods) {
    const canvas = document.getElementById('donutChart');
    const data = prods.map(p => state.weights.get(p.id) ?? 1);
    const cfg = {
      type: 'doughnut',
      data: { labels: prods.map(p => p.name), datasets: [{ data, backgroundColor: prods.map(p => colorFor(p.id)), borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, cutout: '62%' },
    };
    if (donutChart) { donutChart.data = cfg.data; donutChart.update(); } else donutChart = new Chart(canvas, cfg);
  }

  function renderCestaChart(basket) {
    const canvas = document.getElementById('cestaChart');
    if (!basket.periods.length) { if (cestaChart) { cestaChart.destroy(); cestaChart = null; } return; }
    const cfg = {
      type: 'line',
      data: { labels: basket.periods.map(fmtPeriod), datasets: [{ label: 'Índice cartera', data: basket.values, borderColor: '#0f6e5c', backgroundColor: 'rgba(15,110,92,.12)', fill: true, tension: .15, pointRadius: 0, borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 8 }, grid: { display: false } } } },
    };
    if (cestaChart) { cestaChart.data = cfg.data; cestaChart.update(); } else cestaChart = new Chart(canvas, cfg);
  }

  function renderCartKpis(basket, prods, range) {
    const wrap = document.getElementById('cartKpis');
    if (!basket.values.length) { wrap.innerHTML = kpi('Inflación de mi cartera', '—'); return; }
    const first = basket.values[0], last = basket.values[basket.values.length - 1];
    const cum = round2((last / first - 1) * 100);
    const changes = prods.map(p => ({ p, c: changeInRange(p, range) })).filter(x => x.c !== null).sort((a, b) => b.c - a.c);
    wrap.innerHTML = [
      kpi(`Inflación cartera (${fmtPeriod(basket.periods[0])} — ${fmtPeriod(basket.periods.at(-1))})`, fmtPct(cum)),
      kpi('Más contribuye', changes[0] ? `${changes[0].p.name} (${fmtPct(changes[0].c)})` : '—', true),
      kpi('Menos contribuye', changes.at(-1) ? `${changes.at(-1).p.name} (${fmtPct(changes.at(-1).c)})` : '—', true),
    ].join('');
  }

  function renderScenario(basket) {
    const input = document.getElementById('expenseInput');
    const result = document.getElementById('scenarioResult');
    if (state.expense) input.value = state.expense;
    const update = () => {
      const amount = Number(input.value);
      if (!amount || !basket.values.length) { result.textContent = ''; return; }
      const eq = round2(amount * (basket.values.at(-1) / basket.values[0]));
      result.textContent = `≈ ${fmtEur(eq)}/mes en ${fmtPeriod(basket.periods.at(-1))}`;
      state.expense = amount; persist();
    };
    input.oninput = update; update();
  }

  // ---------------- Comunidades autónomas ----------------
  function initRegionSelect() {
    const sel = document.getElementById('regionCategorySelect');
    sel.innerHTML = IPC_PRODUCTS.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    document.getElementById('regionPeriod').textContent = fmtPeriod(IPC_REGION_PERIOD);
    sel.addEventListener('change', renderRegionChart);
    renderRegionChart();
  }

  function renderRegionChart() {
    const pid = document.getElementById('regionCategorySelect').value || 'general';
    const canvas = document.getElementById('regionChart');
    const rows = IPC_REGIONS.map(r => ({ name: r.name, value: r[pid] })).sort((a, b) => b.value - a.value);
    const national = productsById.get(pid).series[IPC_REGION_PERIOD];
    const cfg = {
      type: 'bar',
      data: {
        labels: rows.map(r => r.name),
        datasets: [{
          label: 'Índice regional',
          data: rows.map(r => r.value),
          backgroundColor: rows.map(r => r.value >= (national ?? 0) ? '#c23636' : '#0f6e5c'),
        }],
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `${fmtNum(ctx.parsed.x)}${national ? ` (nacional: ${fmtNum(national)})` : ''}` } },
        },
        scales: { x: { title: { display: true, text: 'Índice' } } },
      },
    };
    if (regionChart) { regionChart.data = cfg.data; regionChart.options = cfg.options; regionChart.update(); }
    else regionChart = new Chart(canvas, cfg);
  }

  // ---------------- Exportación ----------------
  function exportCsv() {
    const prods = selectedProducts();
    if (!prods.length) { alert('Elige al menos una categoría.'); return; }
    const range = activeRange();
    let periodSet = new Set();
    prods.forEach(p => periodsInRange(p, range).forEach(per => periodSet.add(per)));
    const periods = [...periodSet].sort();
    const lines = [['periodo', ...prods.map(p => p.name)].join(';')];
    for (const per of periods) lines.push([per, ...prods.map(p => p.series[per] ?? '')].join(';'));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ipc.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }
  function exportImg() {
    if (!mainChart) { alert('No hay gráfico que exportar.'); return; }
    const a = document.createElement('a'); a.href = mainChart.toBase64Image(); a.download = 'ipc.png'; a.click();
  }
  async function share() {
    const url = shareUrl();
    try { await navigator.clipboard.writeText(url); alert('Enlace copiado:\n' + url); }
    catch (e) { window.prompt('Copia este enlace:', url); }
  }

  // ---------------- Tema ----------------
  function initTheme() {
    const saved = localStorage.getItem('ipc_v2_theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setTheme(saved);
  }
  function setTheme(mode) {
    document.documentElement.setAttribute('data-theme', mode);
    document.getElementById('themeToggle').textContent = mode === 'dark' ? '☀️' : '🌙';
    localStorage.setItem('ipc_v2_theme', mode);
  }

  // ---------------- Eventos ----------------
  function wireEvents() {
    document.getElementById('searchInput').addEventListener('input', debounce(e => { state.search = e.target.value; renderCategoryGrid(); }, 120));
    document.getElementById('clearSelBtn').addEventListener('click', () => { state.selected.clear(); state.weights.clear(); persist(); renderCategoryGrid(); renderAll(); });
    document.querySelectorAll('#periodPills button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#periodPills button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.period = btn.dataset.p; persist(); renderAll();
      });
    });
    document.getElementById('normalizeToggle').addEventListener('change', e => { state.normalize = e.target.checked; persist(); renderChart(activeRange()); });
    document.getElementById('exportCsvBtn').addEventListener('click', exportCsv);
    document.getElementById('exportImgBtn').addEventListener('click', exportImg);
    document.getElementById('shareBtn').addEventListener('click', share);
    document.getElementById('themeToggle').addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      setTheme(cur === 'dark' ? 'light' : 'dark');
    });
    // Activar botón de periodo guardado
    const activeBtn = document.querySelector(`#periodPills button[data-p="${state.period}"]`);
    if (activeBtn) { document.querySelectorAll('#periodPills button').forEach(b => b.classList.remove('active')); activeBtn.classList.add('active'); }
    document.getElementById('normalizeToggle').checked = state.normalize;
  }

  // ---------------- Utilidades ----------------
  const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  function fmtPeriod(p) { if (!p) return ''; const [y, m] = p.split('-'); return `${MONTHS[+m - 1]} ${y}`; }
  function fmtNum(n) { return n == null || isNaN(n) ? '—' : n.toLocaleString('es-ES', { maximumFractionDigits: 2 }); }
  function fmtPct(n) { return n == null || isNaN(n) ? '—' : `${n > 0 ? '+' : ''}${n.toLocaleString('es-ES', { maximumFractionDigits: 2 })}%`; }
  function fmtEur(n) { return n == null || isNaN(n) ? '—' : n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }); }
  function cls(n) { return n == null ? '' : (n >= 0 ? 'up' : 'down'); }
  function round2(n) { return Math.round(n * 100) / 100; }
  function round3(n) { return Math.round(n * 1000) / 1000; }
  function avg(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  document.addEventListener('DOMContentLoaded', init);
})();
