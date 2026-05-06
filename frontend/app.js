'use strict';

// ─── Auth token ───────────────────────────────────────────────────────────────
const auth = {
  getToken()  { return localStorage.getItem('retail_token'); },
  setToken(t) { localStorage.setItem('retail_token', t); },
  clearToken(){ localStorage.removeItem('retail_token'); },
};

// ─── API ──────────────────────────────────────────────────────────────────────
const api = {
  _h() {
    const t = auth.getToken();
    return t ? { 'Authorization': `Bearer ${t}` } : {};
  },
  async _get(path) {
    const r = await fetch(path, { headers: this._h() });
    if (r.status === 401) { logout(); return null; }
    return r.json();
  },
  async _post(path, body) {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this._h() },
      body: JSON.stringify(body),
    });
    if (r.status === 401) { logout(); return null; }
    return r.json();
  },
  stats:         () => api._get('/api/stats'),
  monthlyRevenue:() => api._get('/api/revenue/monthly'),
  topCustomers:  () => api._get('/api/customers/top'),
  topProducts:   () => api._get('/api/products/top'),
  segments:      () => api._get('/api/segments'),
  products:      () => api._get('/api/products'),
  recommend:     (stock_code, top_n = 5) => api._post('/api/recommend', { stock_code, top_n }),
};

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  chart:        null,
  segDonut:     null,
  segBar:       null,
  products:     [],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
let _renderToken = 0;

function freshToken() {
  return ++_renderToken;
}

function isStale(token) {
  return token !== _renderToken;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function icon(name, filled = false) {
  const cls = filled ? 'material-symbols-outlined icon-filled' : 'material-symbols-outlined';
  return `<span class="${cls}">${name}</span>`;
}

const fmt = {
  currency: (n) => '$' + Number(n).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }),
  currencyShort: (n) => '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }),
  number:   (n) => Number(n).toLocaleString(),
};

function setHTML(el, html) {
  el.innerHTML = html;
}

function q(selector, root = document) {
  return root.querySelector(selector);
}

function sparklineSVG(data, color) {
  const w = 72, h = 32;
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = ((i / (data.length - 1)) * w).toFixed(1);
    const y = (h - ((v - min) / range) * (h - 4) - 2).toFixed(1);
    return `${x},${y}`;
  });
  const line = pts.join(' ');
  const fill = `${pts[0].split(',')[0]},${h} ${line} ${pts[pts.length - 1].split(',')[0]},${h}`;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none">
    <polygon points="${fill}" fill="${color}" fill-opacity="0.15"/>
    <polyline points="${line}" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

// ─── Dashboard (merged: Overview + Segments + Recommendations) ───────────────
async function renderDashboard() {
  const token = freshToken();
  const page = q('#page');

  const AVATAR_COLORS = [
    { bg: 'rgba(240,192,96,0.15)',  fg: '#f0c060' },
    { bg: 'rgba(76,201,160,0.15)',  fg: '#4cc9a0' },
    { bg: 'rgba(240,120,80,0.15)',  fg: '#f07850' },
    { bg: 'rgba(136,153,187,0.15)', fg: '#8899bb' },
    { bg: 'rgba(72,149,200,0.15)',  fg: '#4895c8' },
  ];

  const SEG_CONFIGS = [
    {
      label: 'VIP',
      desc: 'Highest-value customers. Frequent buyers with large orders. Requires priority attention.',
      iconChar: '◆',
      badgeText: 'Top Tier',
      color: '#f0c060',
      spark: [40,55,45,70,60,80,75,90,85,100],
    },
    {
      label: 'Loyal',
      desc: 'Regular customers with a high purchase frequency. Core of your recurring revenue.',
      iconChar: '♥',
      badgeText: 'Healthy',
      color: '#4cc9a0',
      spark: [30,45,40,55,50,65,60,70,68,75],
    },
    {
      label: 'Average',
      desc: "Previously active customers who haven't purchased recently. Prime re-engagement candidates.",
      iconChar: '▲',
      badgeText: 'Monitor',
      color: '#f07850',
      spark: [60,55,50,48,45,42,40,38,35,30],
    },
    {
      label: 'Inactive',
      desc: 'Customers with no activity for an extended period. Require aggressive win-back strategies.',
      iconChar: '●',
      badgeText: 'Dormant',
      color: '#8899bb',
      spark: [80,70,65,55,50,40,35,28,22,15],
    },
  ];

  // destroy any existing charts before re-render
  if (state.chart)    { state.chart.destroy();    state.chart    = null; }
  if (state.segDonut) { state.segDonut.destroy();  state.segDonut = null; }
  if (state.segBar)   { state.segBar.destroy();    state.segBar   = null; }

  setHTML(page, `
    <div class="space-y">

      <!-- ── Overview ── -->
      <section class="grid-3">
        <div class="stat-card">
          <div class="stat-label">Total Revenue</div>
          <div class="stat-bottom">
            <div class="stat-value loading-text" id="stat-revenue">loading…</div>
            <div class="stat-badge">${icon('show_chart')} Live</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Customers</div>
          <div class="stat-bottom">
            <div class="stat-value loading-text" id="stat-customers">loading…</div>
            <div class="stat-badge">${icon('show_chart')} Live</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Transactions</div>
          <div class="stat-bottom">
            <div class="stat-value loading-text" id="stat-transactions">loading…</div>
            <div class="stat-badge">${icon('show_chart')} Live</div>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="section-title">Monthly Revenue</div>
        <div class="section-sub">Gross revenue over time</div>
        <div style="position:relative;height:280px;" id="chart-wrap">
          <canvas id="revenue-chart"></canvas>
        </div>
      </section>

      <!-- ── Product Recommendations ── -->
      <div class="dash-section-header">
        <h2 class="dash-section-title">Product Recommendations</h2>
        <p class="dash-section-sub">Identify cross-selling opportunities based on customer purchase history.</p>
      </div>
      <section class="card" style="max-width:900px;">
        <div class="section-title">Search a Product</div>
        <label style="font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:var(--on-surface-variant);display:block;margin-bottom:8px;">
          Search by SKU or Name
        </label>
        <div class="input-wrap" style="position:relative;max-width:600px;">
          ${icon('search')}
          <input id="product-search" class="input-field" type="text"
            placeholder="e.g. White Hanging Heart T-Light Holder" autocomplete="off">
          <ul id="product-dropdown" class="dropdown"></ul>
        </div>
        <p style="font-size:12px;color:var(--on-surface-variant);margin-top:10px;">
          Select a product from the list to see recommendations.
        </p>
      </section>
      <section id="rec-results" style="display:none;max-width:900px;" class="space-y">
        <div style="border-bottom:1px solid var(--outline-variant);padding-bottom:16px;">
          <div class="section-title" style="margin-bottom:4px;">Top Matches</div>
          <p id="rec-subtitle" style="font-size:12px;color:var(--on-surface-variant);"></p>
        </div>
        <div id="rec-list"></div>
      </section>

      <!-- ── Customer Segments ── -->
      <div class="dash-section-header">
        <h2 class="dash-section-title">Customer Segments</h2>
        <p class="dash-section-sub">Customer clusters based on Recency, Frequency, and Monetary purchasing behavior.</p>
      </div>
      <div id="segments-area"><div class="loading-text">Loading segments…</div></div>

      <!-- ── Top 5 ── -->
      <div class="dash-section-header">
        <h2 class="dash-section-title">Top Performers</h2>
        <p class="dash-section-sub">Highest-value customers and best-selling products.</p>
      </div>
      <section class="grid-2">
        <div class="card" id="top-customers-card">
          <div class="section-title">Top 5 Customers by Spending</div>
          <div class="loading-text">loading…</div>
        </div>
        <div class="card" id="top-products-card">
          <div class="section-title">Top 5 Products by Quantity</div>
          <div class="loading-text">loading…</div>
        </div>
      </section>

    </div>
  `);

  // fetch all data in parallel
  const [stats, monthly, topCust, topProd, segData] = await Promise.all([
    api.stats(), api.monthlyRevenue(), api.topCustomers(), api.topProducts(), api.segments(),
  ]);
  if (isStale(token)) return;

  // ── Stats ──
  const revEl = q('#stat-revenue');
  const cusEl = q('#stat-customers');
  const txEl  = q('#stat-transactions');
  if (revEl) { revEl.textContent = fmt.currency(stats.revenue);    revEl.classList.remove('loading-text'); }
  if (cusEl) { cusEl.textContent = fmt.number(stats.customers);    cusEl.classList.remove('loading-text'); }
  if (txEl)  { txEl.textContent  = fmt.number(stats.transactions); txEl.classList.remove('loading-text'); }

  // ── Revenue chart ──
  const canvas    = q('#revenue-chart');
  const chartWrap = q('#chart-wrap');
  if (canvas && monthly.length === 0) {
    setHTML(chartWrap, '<div class="empty-state" style="height:100%;display:flex;flex-direction:column;justify-content:center;">' +
      icon('bar_chart') + '<p>No monthly data available.</p></div>');
  } else if (canvas) {
    state.chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: monthly.map(d => d.month),
        datasets: [{
          data: monthly.map(d => d.revenue),
          fill: true,
          borderColor: '#006193',
          backgroundColor: (context) => {
            const { ctx, chartArea } = context.chart;
            if (!chartArea) return 'rgba(0,97,147,0.06)';
            const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            g.addColorStop(0, 'rgba(0,97,147,0.14)');
            g.addColorStop(1, 'rgba(0,97,147,0)');
            return g;
          },
          borderWidth: 2,
          pointBackgroundColor: '#006193',
          pointRadius: 3,
          pointHoverRadius: 5,
          tension: 0.4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => fmt.currency(c.raw) } },
        },
        scales: {
          x: { border: { display: false }, grid: { display: false }, ticks: { color: '#9096a8', font: { size: 11, family: 'DM Sans' } } },
          y: { border: { display: false }, grid: { color: '#eaecf1' }, ticks: { color: '#9096a8', font: { size: 11, family: 'DM Sans' }, callback: (v) => `$${(v / 1000).toFixed(0)}k` } },
        },
      },
    });
  }

  // ── Top Customers ──
  const custCard = q('#top-customers-card');
  if (custCard) {
    setHTML(custCard, `
      <div class="section-title">Top 5 Customers</div>
      <div class="section-sub">By total spending</div>
      ${topCust.length === 0
        ? '<p class="loading-text">No data.</p>'
        : `<ul class="list-rows">
            ${topCust.map((c, i) => `
              <li class="list-item">
                <div style="display:flex;align-items:center;gap:10px;">
                  <div class="avatar-sm" style="background:${AVATAR_COLORS[i].bg};color:${AVATAR_COLORS[i].fg};">
                    #${esc(String(c.customer_id).slice(-3))}
                  </div>
                  <div>
                    <div style="font-size:13px;font-weight:500;">Customer ${esc(c.customer_id)}</div>
                    <div style="font-size:11px;color:var(--on-surface-variant);">${esc(c.frequency)} orders</div>
                  </div>
                </div>
                <span style="font-family:'DM Mono',monospace;font-size:13px;font-weight:500;color:var(--on-surface);">${fmt.currency(c.monetary)}</span>
              </li>
            `).join('')}
          </ul>`
      }
    `);
  }

  // ── Top Products ──
  const prodCard = q('#top-products-card');
  if (prodCard) {
    setHTML(prodCard, `
      <div class="section-title">Top 5 Products</div>
      <div class="section-sub">By quantity sold</div>
      ${topProd.length === 0
        ? '<p class="loading-text">No data.</p>'
        : `<ul class="list-rows">
            ${topProd.map(p => `
              <li class="list-item">
                <span style="font-size:13px;font-weight:500;flex:1;padding-right:12px;color:var(--on-surface);">${esc(p.product)}</span>
                <span style="font-family:'DM Mono',monospace;font-size:12px;font-weight:500;color:var(--on-surface-variant);flex-shrink:0;">${fmt.number(p.quantity_sold)} units</span>
              </li>
            `).join('')}
          </ul>`
      }
    `);
  }

  // ── Segments ──
  const segArea = q('#segments-area');
  if (segArea) {
    if (segData.averages.length === 0) {
      setHTML(segArea, `<div class="empty-state">${icon('group_off')}<p>No segment data available.</p></div>`);
    } else {
      const countMap = {};
      segData.counts.forEach(c => { countMap[c.cluster] = c.customers; });
      const sorted   = [...segData.averages].sort((a, b) => b.monetary - a.monetary);
      const totalCusts = Object.values(countMap).reduce((a, b) => a + b, 0);
      const segments = sorted.map((seg, i) => ({ ...seg, ...(SEG_CONFIGS[i] || SEG_CONFIGS[3]), customers: countMap[seg.cluster] || 0 }));
      const segColors = segments.map(s => s.color);

      const metricMap = {
        recency:   { label: 'Recency (days)',    data: segments.map(s => s.recency),   fmt: v => v.toFixed(2) },
        frequency: { label: 'Frequency (orders)', data: segments.map(s => s.frequency), fmt: v => v.toFixed(2) },
        monetary:  { label: 'Monetary (avg)',     data: segments.map(s => s.monetary),  fmt: v => v >= 1000 ? `$${(v/1000).toFixed(0)}k` : `$${v.toFixed(0)}` },
      };
      let activeMetric = 'recency';

      setHTML(segArea, `
        <div class="seg-cards-row">
          ${segments.map(seg => `
            <div class="seg-card" style="border-color:${seg.color}30;">
              <div class="seg-card-glow" style="background:${seg.color};"></div>
              <div class="seg-card-header">
                <div class="seg-icon-wrap">
                  <div class="seg-icon" style="background:${seg.color}20;color:${seg.color};">${seg.iconChar}</div>
                  <span class="seg-label">${esc(seg.label)}</span>
                </div>
                <span class="badge" style="color:${seg.color};background:${seg.color}15;border-color:${seg.color}30;">${esc(seg.badgeText)}</span>
              </div>
              <p class="seg-desc">${esc(seg.desc)}</p>
              <div class="seg-stats">
                <div><div class="seg-stat-label">Recency</div><div class="seg-stat-val">${seg.recency}d</div></div>
                <div><div class="seg-stat-label">Frequency</div><div class="seg-stat-val">${seg.frequency}x</div></div>
                <div><div class="seg-stat-label">Monetary</div><div class="seg-stat-val">${fmt.currencyShort(seg.monetary)}</div></div>
              </div>
              <div class="seg-customers">
                <div>
                  <div class="seg-customers-label">Customers</div>
                  <div class="seg-customers-val" style="color:${seg.color};">${fmt.number(seg.customers)}</div>
                  <div class="seg-customers-pct">${totalCusts ? ((seg.customers/totalCusts)*100).toFixed(1) : 0}% of total</div>
                </div>
                ${sparklineSVG(seg.spark, seg.color)}
              </div>
            </div>
          `).join('')}
        </div>

        <div class="seg-charts-row">
          <div class="seg-chart-card">
            <div class="section-title">Customer Distribution</div>
            <div style="font-size:11px;color:var(--on-surface-variant);margin-bottom:8px;">Share by segment</div>
            <div class="seg-donut-wrap">
              <div style="width:170px;height:170px;flex-shrink:0;">
                <canvas id="seg-donut" width="170" height="170"></canvas>
              </div>
              <div class="seg-donut-legend">
                ${segments.map(s => `
                  <div class="seg-legend-row">
                    <div style="width:10px;height:10px;border-radius:2px;background:${s.color};flex-shrink:0;"></div>
                    <span class="seg-legend-name">${esc(s.label)}</span>
                    <span class="seg-legend-pct">${totalCusts ? ((s.customers/totalCusts)*100).toFixed(1) : 0}%</span>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>

          <div class="seg-chart-card">
            <div class="section-title">RFM Averages by Segment</div>
            <div style="font-size:11px;color:var(--on-surface-variant);margin-bottom:14px;">Compare metric performance across tiers</div>
            <div class="metric-tabs" id="metric-tabs">
              <button class="metric-tab active" data-metric="recency">Recency (days)</button>
              <button class="metric-tab" data-metric="frequency">Frequency (orders)</button>
              <button class="metric-tab" data-metric="monetary">Monetary (avg)</button>
            </div>
            <div style="position:relative;height:180px;margin-top:14px;"><canvas id="seg-bar"></canvas></div>
          </div>
        </div>
      `);

      const centerTextPlugin = {
        id: 'centerText',
        afterDraw(chart) {
          const { ctx, chartArea: { top, bottom, left, right } } = chart;
          const cx = (left + right) / 2, cy = (top + bottom) / 2;
          ctx.save();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = `600 18px 'DM Mono', monospace`;
          ctx.fillStyle = 'var(--on-surface, #0c0f14)';
          ctx.fillText(totalCusts.toLocaleString(), cx, cy - 9);
          ctx.font = `400 10px 'DM Sans', sans-serif`;
          ctx.fillStyle = 'var(--on-surface-variant, #5a6070)';
          ctx.fillText('Total Customers', cx, cy + 9);
          ctx.restore();
        },
      };

      state.segDonut = new Chart(document.getElementById('seg-donut'), {
        type: 'doughnut',
        data: {
          labels: segments.map(s => s.label),
          datasets: [{ data: segments.map(s => s.customers), backgroundColor: segColors, borderColor: 'transparent', borderWidth: 2, hoverOffset: 6 }],
        },
        options: {
          responsive: false,
          cutout: '70%',
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed.toLocaleString()}` } } },
        },
        plugins: [centerTextPlugin],
      });

      const valueLabelPlugin = {
        id: 'valueLabels',
        afterDatasetsDraw(chart) {
          const { ctx, data } = chart;
          chart.getDatasetMeta(0).data.forEach((bar, i) => {
            const raw = data.datasets[0].data[i];
            const label = metricMap[activeMetric].fmt(Number(raw));
            ctx.save();
            ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--on-surface').trim() || '#0c0f14';
            ctx.font = `500 11px 'DM Mono', monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(label, bar.x, bar.y - 4);
            ctx.restore();
          });
        },
      };

      state.segBar = new Chart(document.getElementById('seg-bar'), {
        type: 'bar',
        data: {
          labels: segments.map(s => s.label),
          datasets: [{
            data: metricMap.recency.data,
            backgroundColor: segColors.map(c => c + 'bb'),
            borderRadius: 6,
            borderSkipped: false,
            minBarLength: 8,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { top: 24 } },
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false }, ticks: { color: 'var(--on-surface-variant)', font: { size: 11, family: 'DM Sans' } }, border: { display: false } },
            y: { display: false, beginAtZero: true },
          },
        },
        plugins: [valueLabelPlugin],
      });

      document.querySelectorAll('.metric-tab').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.metric-tab').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          activeMetric = btn.dataset.metric;
          state.segBar.data.datasets[0].data = metricMap[activeMetric].data;
          state.segBar.update();
        });
      });
    }
  }

  // ── Recommendations search ──
  if (state.products.length === 0) {
    state.products = await api.products();
  }
  if (isStale(token)) return;

  const searchInput = q('#product-search');
  const dropdown    = q('#product-dropdown');
  if (!searchInput || !dropdown) return;

  function renderDropdown(items) {
    if (items.length === 0) { dropdown.classList.remove('open'); return; }
    setHTML(dropdown, items.map(p => `
      <li class="dropdown-item" data-code="${esc(String(p.stock_code))}" data-desc="${esc(p.description)}">
        <strong style="color:var(--primary);">${esc(String(p.stock_code))}</strong> — ${esc(p.description)}
      </li>
    `).join(''));
    dropdown.classList.add('open');
  }

  async function fetchAndShowResults(selected) {
    const recResults  = q('#rec-results');
    const recSubtitle = q('#rec-subtitle');
    const recList     = q('#rec-list');
    recSubtitle.textContent = `Based on "${selected.description}"`;
    recResults.style.display = 'block';
    setHTML(recList, `<p class="loading-text">Computing recommendations…</p>`);

    const fetchToken = freshToken();
    const results = await api.recommend(selected.stock_code);
    if (isStale(fetchToken)) return;

    if (results.length === 0) {
      setHTML(recList, `<div class="empty-state">${icon('search_off')}<p>No recommendations found for this product.</p></div>`);
      return;
    }

    setHTML(recList, `
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${results.map((rec, i) => {
          const pct = Math.round(rec.similarity * 100);
          let badgeBg, badgeColor;
          if (pct >= 90)      { badgeBg = '#ffddb1'; badgeColor = '#7d5400'; }
          else if (pct >= 75) { badgeBg = '#cce5ff'; badgeColor = '#006193'; }
          else                { badgeBg = '#e0e2e8'; badgeColor = '#404850'; }
          return `
            <div class="rec-item">
              <div style="display:flex;align-items:center;gap:14px;flex:1;min-width:0;">
                <div class="rec-rank">${i + 1}</div>
                <div style="min-width:0;">
                  <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(rec.description)}</div>
                  <div style="font-size:12px;color:var(--on-surface-variant);">SKU: ${esc(rec.stock_code)}</div>
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
                <span class="match-badge" style="background:${badgeBg};color:${badgeColor};">${icon('trending_up')} ${pct}% Match</span>
                ${icon('chevron_right')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `);
  }

  searchInput.addEventListener('input', () => {
    const q2 = searchInput.value.toLowerCase().trim();
    if (q2.length < 2) { dropdown.classList.remove('open'); return; }
    const filtered = state.products.filter(p =>
      p.description?.toLowerCase().includes(q2) || String(p.stock_code).toLowerCase().includes(q2)
    ).slice(0, 8);
    renderDropdown(filtered);
  });

  dropdown.addEventListener('mousedown', (e) => {
    const item = e.target.closest('.dropdown-item');
    if (!item) return;
    const selected = { stock_code: item.dataset.code, description: item.dataset.desc };
    searchInput.value = `${selected.stock_code} — ${selected.description}`;
    dropdown.classList.remove('open');
    fetchAndShowResults(selected);
  });

  searchInput.addEventListener('blur', () => {
    setTimeout(() => dropdown.classList.remove('open'), 160);
  });
}

// ─── Update Data ──────────────────────────────────────────────────────────────
async function renderUpdateData() {
  const token = freshToken();
  const page = q('#page');

  setHTML(page, `
    <div class="space-y" style="max-width:700px;">
      <div class="page-header">
        <h1>Update Data</h1>
        <p>Replace the current dataset by dropping a new Excel or CSV file.</p>
      </div>

      <section class="card">
        <div class="section-title">Current File</div>
        <div id="file-info" class="loading-text">Loading…</div>
      </section>

      <section class="card">
        <div class="section-title">Upload New File</div>
        <div class="drop-zone" id="drop-zone">
          <span class="material-symbols-outlined">upload_file</span>
          <div class="drop-zone-title">Drop your file here</div>
          <div class="drop-zone-sub">or click to browse — .xlsx, .xls, .csv accepted</div>
          <div id="chosen-file"></div>
        </div>
        <input type="file" id="file-input" accept=".xlsx,.xls,.csv" style="display:none;">

        <div style="margin-top:20px;display:flex;gap:12px;align-items:center;">
          <button id="upload-btn" class="btn-primary" disabled>
            ${icon('cloud_upload')} Replace Dataset
          </button>
          <span id="upload-status"></span>
        </div>
      </section>
    </div>
  `);

  // Load current file info
  const info = await api._get('/api/datafile');
  if (isStale(token)) return;
  const fileInfoEl = q('#file-info');
  if (fileInfoEl) {
    fileInfoEl.classList.remove('loading-text');
    fileInfoEl.innerHTML = info.exists
      ? `<div style="display:flex;align-items:center;gap:10px;">
           ${icon('description')}
           <span style="font-weight:600;">${esc(info.name)}</span>
           <span style="color:var(--on-surface-variant);font-size:13px;">${info.size_mb} MB</span>
         </div>`
      : `<span style="color:var(--on-surface-variant);">No data file found.</span>`;
  }

  const dropZone  = q('#drop-zone');
  const fileInput = q('#file-input');
  const uploadBtn = q('#upload-btn');
  let chosenFile  = null;

  function setFile(file) {
    if (!file) return;
    chosenFile = file;
    setHTML(q('#chosen-file'), `<div class="file-pill">${icon('check_circle')} ${esc(file.name)}</div>`);
    uploadBtn.disabled = false;
    setHTML(q('#upload-status'), '');
  }

  dropZone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) setFile(fileInput.files[0]);
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) setFile(file);
  });

  uploadBtn.addEventListener('click', async () => {
    if (!chosenFile) return;

    uploadBtn.disabled = true;
    setHTML(uploadBtn, `${icon('hourglass_empty')} Uploading…`);
    setHTML(q('#upload-status'), '');

    const form = new FormData();
    form.append('file', chosenFile);

    try {
      const res = await fetch('/api/upload', { method: 'POST', headers: api._h(), body: form });
      const data = await res.json();

      if (!res.ok) {
        setHTML(q('#upload-status'), `
          <span class="upload-status error">${icon('error')} ${esc(data.detail || 'Upload failed.')}</span>
        `);
      } else {
        setHTML(q('#upload-status'), `
          <span class="upload-status success">${icon('check_circle')} Loaded ${Number(data.rows).toLocaleString()} rows successfully.</span>
        `);
        // refresh file info
        const updated = await api._get('/api/datafile');
        const fi = q('#file-info');
        if (fi && updated.exists) {
          fi.innerHTML = `<div style="display:flex;align-items:center;gap:10px;">
            ${icon('description')}
            <span style="font-weight:600;">${esc(updated.name)}</span>
            <span style="color:var(--on-surface-variant);font-size:13px;">${updated.size_mb} MB</span>
          </div>`;
        }
        // reset
        chosenFile = null;
        setHTML(q('#chosen-file'), '');
        fileInput.value = '';
      }
    } catch {
      setHTML(q('#upload-status'), `
        <span class="upload-status error">${icon('error')} Network error — is the server running?</span>
      `);
    }

    setHTML(uploadBtn, `${icon('cloud_upload')} Replace Dataset`);
    uploadBtn.disabled = !chosenFile;
  });
}

// ─── Auth UI ──────────────────────────────────────────────────────────────────

function showLogin() {
  q('#login-overlay').classList.remove('hidden');
  q('#app').classList.add('hidden');
  q('#login-pane').style.display = '';
  q('#register-pane').style.display = 'none';
  const le = q('#login-error');
  const re = q('#register-error');
  if (le) { le.style.display = 'none'; le.textContent = ''; }
  if (re) { re.style.display = 'none'; re.textContent = ''; }
}

function showApp(username) {
  q('#login-overlay').classList.add('hidden');
  q('#app').classList.remove('hidden');
  const chip = q('#topbar-username');
  if (chip) chip.textContent = username;
}

function logout() {
  auth.clearToken();
  freshToken();
  showLogin();
}

function initAuthHandlers() {
  const loginBtn    = q('#login-btn');
  const loginErr    = q('#login-error');
  const registerBtn = q('#register-btn');
  const regErr      = q('#register-error');

  async function doLogin() {
    const username = q('#login-username').value.trim();
    const password = q('#login-password').value;
    if (!username || !password) {
      loginErr.textContent = 'Please enter username and password.';
      loginErr.style.display = 'block';
      return;
    }
    loginBtn.disabled = true;
    loginBtn.textContent = 'Signing in…';
    loginErr.style.display = 'none';
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await r.json();
      if (!r.ok) {
        loginErr.textContent = data.detail || 'Login failed.';
        loginErr.style.display = 'block';
      } else {
        auth.setToken(data.access_token);
        showApp(username);
        if (!location.hash) location.hash = '#dashboard';
        navigate();
      }
    } catch {
      loginErr.textContent = 'Network error — is the server running?';
      loginErr.style.display = 'block';
    }
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign in';
  }

  loginBtn.addEventListener('click', doLogin);
  q('#login-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

  async function doRegister() {
    const username = q('#reg-username').value.trim();
    const password = q('#reg-password').value;
    const confirm  = q('#reg-confirm').value;
    if (!username || !password) {
      regErr.textContent = 'Please fill in all fields.';
      regErr.style.display = 'block';
      return;
    }
    if (password !== confirm) {
      regErr.textContent = 'Passwords do not match.';
      regErr.style.display = 'block';
      return;
    }
    registerBtn.disabled = true;
    registerBtn.textContent = 'Creating account…';
    regErr.style.display = 'none';
    try {
      const r = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await r.json();
      if (!r.ok) {
        regErr.textContent = data.detail || 'Registration failed.';
        regErr.style.display = 'block';
      } else {
        q('#register-pane').style.display = 'none';
        q('#login-pane').style.display = '';
        q('#login-username').value = username;
        q('#login-password').value = '';
        q('#login-password').focus();
      }
    } catch {
      regErr.textContent = 'Network error — is the server running?';
      regErr.style.display = 'block';
    }
    registerBtn.disabled = false;
    registerBtn.textContent = 'Create account';
  }

  registerBtn.addEventListener('click', doRegister);
  q('#reg-confirm').addEventListener('keydown', (e) => { if (e.key === 'Enter') doRegister(); });

  q('#go-register').addEventListener('click', (e) => {
    e.preventDefault();
    q('#login-pane').style.display = 'none';
    q('#register-pane').style.display = '';
  });

  q('#go-login').addEventListener('click', (e) => {
    e.preventDefault();
    q('#register-pane').style.display = 'none';
    q('#login-pane').style.display = '';
  });

  q('#logout-btn').addEventListener('click', logout);
}

// ─── Router ───────────────────────────────────────────────────────────────────
const PAGES = {
  dashboard:     { title: 'Dashboard',   render: renderDashboard   },
  'update-data': { title: 'Update Data', render: renderUpdateData  },
};

function navigate() {
  const hash = (location.hash.slice(1) || 'dashboard');
  const page = PAGES[hash] || PAGES.dashboard;
  const activeHash = PAGES[hash] ? hash : 'dashboard';

  q('#page-title').textContent = page.title;

  document.querySelectorAll('.nav-link').forEach(link => {
    const linkHash = link.getAttribute('href').slice(1);
    link.classList.toggle('active', linkHash === activeHash);
  });

  page.render();
}

window.addEventListener('hashchange', navigate);

window.addEventListener('DOMContentLoaded', async () => {
  initAuthHandlers();
  const token = auth.getToken();
  if (!token) { showLogin(); return; }
  const r = await fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${token}` } });
  if (!r.ok) { auth.clearToken(); showLogin(); return; }
  const { username } = await r.json();
  showApp(username);
  if (!location.hash) location.hash = '#dashboard';
  navigate();
});
