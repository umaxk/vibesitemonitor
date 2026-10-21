const state = {
    user: null,
    sites: [],
    meta: {},
    settings: null,
    detailSiteId: null,
    detailRange: '24h',
    detailSite: null,
    detailStats: null,
    detailIncidents: [],
    charts: [],
    editingSiteId: null,
    filters: {
        search: '',
        status: 'all',
        tag: 'all',
        sort: 'name'
    }
};

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function safeUrl(value) {
    const url = String(value ?? '').trim();
    return /^https?:\/\//i.test(url) ? url : '#';
}

function csrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
}

async function api(path, options = {}) {
    const opts = { credentials: 'same-origin', ...options };
    if (opts.body && typeof opts.body !== 'string') {
        opts.body = JSON.stringify(opts.body);
    }
    const method = (opts.method || 'GET').toUpperCase();
    opts.headers = { ...(opts.headers || {}) };
    if (opts.body) {
        opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
    }
    if (method !== 'GET' && method !== 'HEAD') {
        opts.headers['X-CSRF-Token'] = csrfToken();
    }
    let response = await fetch(path, opts);
    if (response.status === 403 && method !== 'GET' && method !== 'HEAD') {
        let probe = null;
        try {
            probe = await response.clone().json();
        } catch (error) {
            probe = null;
        }
        if (probe && probe.detail === 'CSRF check failed') {
            opts.headers['X-CSRF-Token'] = csrfToken();
            response = await fetch(path, opts);
        }
    }
    let data = null;
    try {
        data = await response.json();
    } catch (error) {
        data = null;
    }
    if (!response.ok) {
        if (response.status === 401 && path !== '/api/login') {
            showLogin();
        }
        let detail = response.statusText;
        if (typeof data?.detail === 'string') {
            detail = data.detail;
        } else if (Array.isArray(data?.detail)) {
            detail = data.detail.map((item) => item.msg).filter(Boolean).join('; ');
        }
        throw new Error(detail || 'Ошибка запроса');
    }
    return data;
}

function updateUserBadge() {
    const badge = $('#user-badge');
    if (!state.user) {
        badge.textContent = '';
        badge.classList.add('hidden');
        return;
    }
    badge.textContent = `${state.user.username} · ${state.user.role}`;
    badge.classList.remove('hidden');
}

function showLogin() {
    state.user = null;
    state.sites = [];
    closeAllModals();
    updateUserBadge();
    $('#app').classList.add('hidden');
    $('#login-screen').classList.remove('hidden');
    $('#password-input').value = '';
    $('#login-error').classList.add('hidden');
    setTimeout(() => $('#username-input').focus(), 50);
}

function showApp() {
    $('#login-screen').classList.add('hidden');
    $('#app').classList.remove('hidden');
}

function applyTheme() {
    const light = localStorage.getItem('vibemonitor-theme') === 'light';
    document.body.classList.toggle('light', light);
    $('#theme-btn').textContent = light ? '☾' : '◐';
}

function toggleTheme() {
    const light = !document.body.classList.contains('light');
    localStorage.setItem('vibemonitor-theme', light ? 'light' : 'dark');
    applyTheme();
    if (state.detailSite) {
        renderCharts(state.detailSite, state.detailStats, state.detailIncidents);
    }
}

function toast(message, type = 'info') {
    const container = $('#toast-container') || (() => {
        const el = document.createElement('div');
        el.id = 'toast-container';
        document.body.appendChild(el);
        return el;
    })();
    const item = document.createElement('div');
    item.className = `toast toast-${type}`;
    item.textContent = message;
    container.appendChild(item);
    setTimeout(() => item.classList.add('toast-visible'), 10);
    setTimeout(() => {
        item.classList.remove('toast-visible');
        setTimeout(() => item.remove(), 300);
    }, 3200);
}

function formatAgo(timestamp) {
    if (!timestamp) return '—';
    const diff = Math.max(0, Math.floor(Date.now() / 1000 - timestamp));
    if (diff < 10) return 'только что';
    if (diff < 60) return `${diff} сек назад`;
    if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
    return `${Math.floor(diff / 86400)} дн назад`;
}

function formatDate(timestamp) {
    if (!timestamp) return '—';
    return new Date(timestamp * 1000).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatDuration(seconds) {
    if (seconds === null || seconds === undefined) return '—';
    const total = Math.max(0, Math.floor(seconds));
    if (total < 60) return `${total} сек`;
    if (total < 3600) return `${Math.floor(total / 60)} мин`;
    if (total < 86400) return `${Math.floor(total / 3600)} ч ${Math.floor((total % 3600) / 60)} мин`;
    return `${Math.floor(total / 86400)} дн ${Math.floor((total % 86400) / 3600)} ч`;
}

function formatLatency(value) {
    return value === null || value === undefined ? '—' : `${Math.round(value)} мс`;
}

function formatPercent(value) {
    return value === null || value === undefined ? '—' : `${Number(value).toFixed(1)}%`;
}

function siteStatus(site) {
    if (site.paused) return { key: 'paused', label: 'Пауза' };
    if (site.last_status === 'up') return { key: 'up', label: 'Доступен' };
    if (site.last_status === 'down') return { key: 'down', label: 'Недоступен' };
    return { key: 'unknown', label: 'Нет данных' };
}

function sslBadge(site) {
    if (!site.ssl_expires_at && !site.ssl_error) return '';
    if (site.ssl_error && !site.ssl_expires_at) {
        return '<span class="badge badge-warning" title="Не удалось проверить SSL">SSL ?</span>';
    }
    if (site.ssl_expired) {
        return '<span class="badge badge-danger">SSL истёк</span>';
    }
    const days = Math.ceil((site.ssl_expires_at - Date.now() / 1000) / 86400);
    const cls = days <= 30 ? 'badge-warning' : 'badge-ok';
    return `<span class="badge ${cls}" title="Сертификат действителен до ${escapeHtml(formatDate(site.ssl_expires_at))}">SSL ${days} дн</span>`;
}

function incidentNotice(site) {
    const hideHours = Number(state.meta.incident_hide_hours || 12);
    if (site.paused || site.last_status !== 'down' || !site.last_incident_time) return '';
    if (Date.now() / 1000 - site.last_incident_time > hideHours * 3600) return '';
    return `<div class="incident-strip">Инцидент с ${escapeHtml(formatDate(site.last_incident_time))}</div>`;
}

function renderSites() {
    const grid = $('#sites-grid');
    const filtered = state.sites
        .filter((site) => {
            const search = state.filters.search.toLowerCase();
            const matchesSearch = !search
                || site.name.toLowerCase().includes(search)
                || site.url.toLowerCase().includes(search)
                || site.tags.some((tag) => tag.toLowerCase().includes(search));
            const status = siteStatus(site).key;
            const matchesStatus = state.filters.status === 'all' || status === state.filters.status;
            const matchesTag = state.filters.tag === 'all' || site.tags.includes(state.filters.tag);
            return matchesSearch && matchesStatus && matchesTag;
        })
        .sort((a, b) => {
            if (state.filters.sort === 'latency') {
                const av = a.last_latency_ms ?? Number.MAX_SAFE_INTEGER;
                const bv = b.last_latency_ms ?? Number.MAX_SAFE_INTEGER;
                return av - bv;
            }
            if (state.filters.sort === 'status') {
                const rank = { down: 0, unknown: 1, paused: 2, up: 3 };
                const diff = rank[siteStatus(a).key] - rank[siteStatus(b).key];
                if (diff !== 0) return diff;
            }
            return (a.name || a.url).localeCompare(b.name || b.url, 'ru');
        });

    if (!filtered.length) {
        grid.innerHTML = '<div class="empty-state">Ничего не найдено</div>';
        return;
    }

    grid.innerHTML = filtered.map((site) => {
        const status = siteStatus(site);
        const admin = state.user?.role === 'admin';
        const tags = site.tags
            .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
            .join('');
        const actions = admin ? `
            <div class="card-actions">
                <button class="btn-icon small" data-action="check" title="Проверить сейчас">↻</button>
                <button class="btn-icon small" data-action="pause" title="${site.paused ? 'Возобновить' : 'Поставить на паузу'}">${site.paused ? '▶' : '⏸'}</button>
            </div>` : '';
        return `
            <article class="site-card status-${status.key}" data-id="${site.id}">
                <div class="site-card-top">
                    <div class="site-card-heading">
                        <h3>${escapeHtml(site.name || site.url)}</h3>
                        <a class="site-url" href="${escapeHtml(safeUrl(site.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(site.url)}</a>
                    </div>
                    <span class="status-pill ${status.key}"><span class="dot"></span>${status.label}</span>
                </div>
                ${incidentNotice(site)}
                <div class="site-meta">
                    <span>${site.last_check ? `Проверен ${escapeHtml(formatAgo(site.last_check))}` : 'Ещё не проверялся'}</span>
                    <span>HTTP ${site.last_http_code ?? '—'}</span>
                    <span>${escapeHtml(formatLatency(site.last_latency_ms))}</span>
                    <span>24ч: ${escapeHtml(formatPercent(site.uptime_24h))}</span>
                </div>
                <div class="site-badges">
                    ${site.paused ? '<span class="badge">Пауза</span>' : ''}
                    ${site.public ? '<span class="badge badge-public">Публичный</span>' : ''}
                    ${sslBadge(site)}
                </div>
                ${tags ? `<div class="tags">${tags}</div>` : ''}
                ${site.last_status === 'down' && site.last_error ? `<div class="site-error">${escapeHtml(site.last_error)}</div>` : ''}
                <div class="site-card-footer">
                    <span class="hint">${site.check_interval_seconds ? `Каждые ${site.check_interval_seconds} сек` : ''}</span>
                    ${actions}
                </div>
            </article>`;
    }).join('');
}

function populateTagFilter() {
    const select = $('#tag-filter');
    const tags = [...new Set(state.sites.flatMap((site) => site.tags))].sort((a, b) => a.localeCompare(b, 'ru'));
    select.innerHTML = '<option value="all">Все теги</option>'
        + tags.map((tag) => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`).join('');
    if (tags.includes(state.filters.tag)) {
        select.value = state.filters.tag;
    } else {
        state.filters.tag = 'all';
        select.value = 'all';
    }
}

async function loadSites() {
    const data = await api('/api/sites');
    state.sites = data.sites;
    state.meta = data;
    $('#app-title').textContent = data.project_name || 'VibeMonitor';
    document.title = data.project_name || 'VibeMonitor';
    $('#add-site-btn').classList.toggle('hidden', state.user?.role !== 'admin');
    $('#settings-btn').classList.toggle('hidden', state.user?.role !== 'admin');
    populateTagFilter();
    renderSites();
}

async function handleCardAction(action, siteId) {
    const site = state.sites.find((item) => item.id === siteId);
    if (!site) return;
    try {
        if (action === 'check') {
            site.checking = true;
            toast('Проверяем сайт...', 'info');
            await api(`/api/sites/${siteId}/check`, { method: 'POST' });
            toast('Проверка завершена', 'success');
        } else if (action === 'pause') {
            await api(`/api/sites/${siteId}/pause`, {
                method: 'POST',
                body: { paused: !site.paused }
            });
            toast(site.paused ? 'Сайт возобновлён' : 'Сайт на паузе', 'success');
        }
        await loadSites();
        if (state.detailSiteId === siteId) {
            await loadDetail();
        }
    } catch (error) {
        toast(error.message, 'error');
    }
}

function renderStatCards(stats, site) {
    return `
        <div class="stat-grid">
            <div class="stat-card"><span>Аптайм</span><strong>${escapeHtml(formatPercent(stats.uptime_percent))}</strong></div>
            <div class="stat-card"><span>Проверок</span><strong>${stats.checks_count ?? 0}</strong></div>
            <div class="stat-card"><span>Средний отклик</span><strong>${escapeHtml(formatLatency(stats.avg_latency_ms))}</strong></div>
            <div class="stat-card"><span>SSL</span><strong>${site.ssl_expires_at ? escapeHtml(formatDate(site.ssl_expires_at)) : '—'}</strong></div>
        </div>`;
}

function renderIncidents(incidents) {
    if (!incidents.length) {
        return '<p class="hint">Инцидентов за выбранный период нет.</p>';
    }
    const admin = state.user?.role === 'admin';
    return `<div class="incident-list">${incidents.map((incident) => {
        const stateLabel = incident.ongoing
            ? '<span class="badge badge-danger">Идёт</span>'
            : '<span class="badge badge-ok">Восстановлен</span>';
        const ack = incident.acknowledged_at
            ? `<span class="hint">Подтверждён ${escapeHtml(formatDate(incident.acknowledged_at))}</span>`
            : '<span class="hint">Не подтверждён</span>';
        const controls = admin ? `
            <div class="incident-controls">
                ${!incident.acknowledged_at ? `<button class="btn-secondary small" data-incident-ack="${incident.id}">Подтвердить</button>` : ''}
                <button class="btn-secondary small" data-incident-note="${incident.id}">Заметка</button>
            </div>` : '';
        return `
            <div class="incident-item">
                <div class="incident-head">
                    <div><strong>${escapeHtml(formatDate(incident.started_at))}</strong> ${stateLabel}</div>
                    <span class="hint">${escapeHtml(formatDuration(incident.duration_seconds))}</span>
                </div>
                ${incident.last_error ? `<div class="site-error">${escapeHtml(incident.last_error)}</div>` : ''}
                ${incident.note ? `<p class="incident-note">${escapeHtml(incident.note)}</p>` : ''}
                <div class="incident-foot">${ack}${controls}</div>
            </div>`;
    }).join('')}</div>`;
}

function renderCheckLog(checks) {
    const rows = checks.map((check) => {
        const up = check.status === 'up';
        return `
            <tr>
                <td>${escapeHtml(formatDate(check.timestamp))}</td>
                <td><span class="history-status ${up ? 'up' : 'down'}"><span class="history-dot"></span>${up ? 'Доступен' : 'Недоступен'}</span></td>
                <td>${check.http_code ?? '—'}</td>
                <td>${escapeHtml(formatLatency(check.latency_ms))}</td>
                <td class="${check.error ? 'history-error' : 'history-muted'}">${escapeHtml(check.error || '—')}</td>
            </tr>`;
    }).join('');
    return `
        <details class="check-log">
            <summary>
                <span class="check-log-chevron">›</span>
                <span class="check-log-title">Лог запросов</span>
                <span class="hint">последние ${checks.length}</span>
            </summary>
            <div class="check-log-body">
                ${checks.length ? `
                    <table class="history-table">
                        <thead>
                            <tr>
                                <th>Время</th>
                                <th>Статус</th>
                                <th>HTTP</th>
                                <th>Задержка</th>
                                <th>Ошибка</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>` : '<p class="hint">Записей пока нет.</p>'}
            </div>
        </details>`;
}

function renderDetail(site, stats, incidents, checks) {
    const status = siteStatus(site);
    const admin = state.user?.role === 'admin';
    const body = $('#modal-body');
    body.innerHTML = `
        <div class="detail-head">
            <div>
                <a class="site-url" href="${escapeHtml(safeUrl(site.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(site.url)}</a>
                <div class="detail-badges">
                    <span class="status-pill ${status.key}"><span class="dot"></span>${status.label}</span>
                    ${site.paused ? '<span class="badge">Пауза</span>' : ''}
                    ${site.public ? '<span class="badge badge-public">Публичный</span>' : ''}
                    ${sslBadge(site)}
                </div>
            </div>
            <div class="detail-actions">
                ${admin ? `
                    <button class="btn-secondary small" data-detail-action="check">Проверить</button>
                    <button class="btn-secondary small" data-detail-action="pause">${site.paused ? 'Возобновить' : 'Пауза'}</button>
                    <button class="btn-danger small" data-detail-action="delete">Удалить</button>` : ''}
            </div>
        </div>
        <div class="range-switch">
            ${['24h', '7d', '30d'].map((range) => `
                <button class="range-btn ${state.detailRange === range ? 'active' : ''}" data-range="${range}">${range}</button>
            `).join('')}
        </div>
        ${renderStatCards(stats, site)}
        <div class="chart-block">
            <h3>Задержка</h3>
            <div class="chart-wrap"><canvas id="latency-chart"></canvas></div>
        </div>
        <div class="chart-block">
            <h3>Аптайм</h3>
            <div class="chart-wrap"><canvas id="uptime-chart"></canvas></div>
        </div>
        <div class="chart-block">
            <h3>Инциденты</h3>
            ${renderIncidents(incidents)}
            ${renderCheckLog(checks)}
        </div>`;
    renderCharts(site, stats, incidents);
}

function chartColors() {
    const light = document.body.classList.contains('light');
    return {
        text: light ? '#4b5563' : '#a8b3c7',
        grid: light ? 'rgba(15, 23, 42, 0.08)' : 'rgba(148, 163, 184, 0.14)',
        accent: '#38bdf8',
        accentFill: light ? 'rgba(14, 165, 233, 0.12)' : 'rgba(56, 189, 248, 0.18)',
        up: light ? '#15803d' : '#4ade80',
        down: light ? '#b91c1c' : '#f87171'
    };
}

function destroyCharts() {
    state.charts.forEach((chart) => {
        try {
            chart.destroy();
        } catch (error) {
            // ignore
        }
    });
    state.charts = [];
}

function renderCharts(site, stats, incidents) {
    destroyCharts();
    if (!stats || !stats.points) return;
    const colors = chartColors();
    const latencyCanvas = document.getElementById('latency-chart');
    const uptimeCanvas = document.getElementById('uptime-chart');
    if (!latencyCanvas || !uptimeCanvas) return;

    const labels = stats.points.map((point) => new Date(point.timestamp * 1000).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }));
    const latency = stats.points.map((point) => point.latency_ms);
    const uptime = stats.points.map((point) => point.uptime_percent);

    const sharedOptions = {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
            legend: { display: false },
            tooltip: { intersect: false, mode: 'index' }
        },
        scales: {
            x: {
                ticks: { color: colors.text, maxTicksLimit: 8, maxRotation: 0 },
                grid: { color: colors.grid }
            },
            y: {
                ticks: { color: colors.text },
                grid: { color: colors.grid },
                beginAtZero: true
            }
        }
    };

    state.charts.push(new Chart(latencyCanvas, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Задержка, мс',
                data: latency,
                borderColor: colors.accent,
                backgroundColor: colors.accentFill,
                fill: true,
                tension: 0.3,
                pointRadius: 2,
                pointHoverRadius: 4,
                spanGaps: true
            }]
        },
        options: sharedOptions
    }));

    state.charts.push(new Chart(uptimeCanvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Аптайм, %',
                data: uptime,
                backgroundColor: uptime.map((value) => (value !== null && value < 100 ? colors.down : colors.up)),
                borderRadius: 3
            }]
        },
        options: {
            ...sharedOptions,
            scales: {
                ...sharedOptions.scales,
                y: {
                    ...sharedOptions.scales.y,
                    min: 0,
                    max: 100
                }
            }
        }
    }));
}

async function loadDetail() {
    const siteId = state.detailSiteId;
    if (!siteId) return;
    try {
        const [data, checksData] = await Promise.all([
            api(`/api/sites/${siteId}/stats?range=${encodeURIComponent(state.detailRange)}`),
            api(`/api/sites/${siteId}/checks?limit=100`)
        ]);
        if (state.detailSiteId !== siteId) return;
        state.detailSite = data.site;
        state.detailStats = data.stats;
        state.detailIncidents = data.incidents;
        const site = data.site;
        $('#modal-title').textContent = site.name || site.url;
        $('#edit-site-btn').classList.toggle('hidden', state.user?.role !== 'admin');
        renderDetail(site, data.stats, data.incidents, checksData.checks);
    } catch (error) {
        toast(error.message, 'error');
    }
}

async function openSiteDetail(siteId) {
    state.detailSiteId = siteId;
    state.detailRange = '24h';
    state.detailSite = state.sites.find((site) => site.id === siteId) || null;
    state.detailStats = null;
    state.detailIncidents = [];
    if (state.detailSite) {
        $('#modal-title').textContent = state.detailSite.name || state.detailSite.url;
    }
    $('#edit-site-btn').classList.add('hidden');
    $('#modal-body').innerHTML = '<p class="hint">Загрузка...</p>';
    openModal('modal');
    await loadDetail();
}

async function handleDetailAction(action) {
    const site = state.detailSite;
    if (!site) return;
    try {
        if (action === 'check') {
            toast('Проверяем сайт...', 'info');
            await api(`/api/sites/${site.id}/check`, { method: 'POST' });
            toast('Проверка завершена', 'success');
        } else if (action === 'pause') {
            await api(`/api/sites/${site.id}/pause`, {
                method: 'POST',
                body: { paused: !site.paused }
            });
            toast(site.paused ? 'Сайт возобновлён' : 'Сайт на паузе', 'success');
        } else if (action === 'delete') {
            if (!confirm(`Удалить ${site.name || site.url}? История проверок и инциденты также будут удалены.`)) return;
            await api(`/api/sites/${site.id}`, { method: 'DELETE' });
            toast('Сайт удалён', 'success');
            closeModal('modal');
            state.detailSiteId = null;
            await loadSites();
            return;
        }
        await loadSites();
        await loadDetail();
    } catch (error) {
        toast(error.message, 'error');
    }
}

async function handleIncidentAction(action, incidentId) {
    try {
        if (action === 'ack') {
            await api(`/api/incidents/${incidentId}/ack`, { method: 'POST' });
            toast('Инцидент подтверждён', 'success');
        } else if (action === 'note') {
            const note = prompt('Заметка к инциденту:');
            if (note === null) return;
            await api(`/api/incidents/${incidentId}`, {
                method: 'PATCH',
                body: { note }
            });
            toast('Заметка сохранена', 'success');
        }
        await loadDetail();
        await loadSites();
    } catch (error) {
        toast(error.message, 'error');
    }
}

function openAddSite(site = null) {
    state.editingSiteId = site ? site.id : null;
    $('#add-modal-title').textContent = site ? 'Редактировать сайт' : 'Добавить сайт';
    $('#confirm-add-btn').textContent = site ? 'Сохранить' : 'Добавить';
    $('#new-site-url').value = site?.url || '';
    $('#new-site-name').value = site?.name || '';
    $('#new-site-interval').value = site?.check_interval_seconds || '';
    $('#new-site-tags').value = site?.tags?.join(', ') || '';
    $('#new-site-public').checked = Boolean(site?.public);
    openModal('add-modal');
    setTimeout(() => $('#new-site-url').focus(), 50);
}

async function saveSite() {
    const url = $('#new-site-url').value.trim();
    const name = $('#new-site-name').value.trim();
    const interval = $('#new-site-interval').value;
    const tags = $('#new-site-tags').value.split(',').map((tag) => tag.trim()).filter(Boolean);
    const isPublic = $('#new-site-public').checked;
    if (!url) {
        toast('Укажите URL', 'error');
        return;
    }
    const payload = {
        url,
        name,
        check_interval_seconds: interval ? Number(interval) : null,
        tags,
        public: isPublic
    };
    try {
        if (state.editingSiteId) {
            await api(`/api/sites/${state.editingSiteId}`, { method: 'PUT', body: payload });
            toast('Сайт обновлён', 'success');
        } else {
            await api('/api/sites', { method: 'POST', body: payload });
            toast('Сайт добавлен', 'success');
        }
        closeModal('add-modal');
        await loadSites();
        if (state.detailSiteId) {
            await loadDetail();
        }
    } catch (error) {
        toast(error.message, 'error');
    }
}

function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove('hidden');
    document.body.classList.add('modal-open');
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add('hidden');
    if (id === 'modal') {
        destroyCharts();
    }
    if (!document.querySelector('.modal:not(.hidden)')) {
        document.body.classList.remove('modal-open');
    }
}

function closeAllModals() {
    document.querySelectorAll('.modal:not(.hidden)').forEach((modal) => closeModal(modal.id));
    destroyCharts();
}

function collectSettings() {
    const base = state.settings || {};
    return {
        ...base,
        project_name: $('#project-name-input').value.trim() || 'VibeMonitor',
        check_interval_seconds: Number($('#interval-input').value),
        timeout_seconds: Number($('#timeout-input').value),
        incident_hide_hours: Number($('#incident-hide-input').value),
        retention_days: Number($('#retention-input').value),
        incident_retention_days: Number($('#incident-retention-input').value),
        ssl_check_interval_seconds: Number($('#ssl-interval-input').value) * 3600,
        status_page_enabled: $('#status-enabled-input').checked,
        status_page_title: $('#status-title-input').value.trim() || 'Статус сервисов',
        status_page_description: $('#status-description-input').value.trim()
    };
}

function fillSettingsForm(settings) {
    state.settings = settings;
    $('#project-name-input').value = settings.project_name || '';
    $('#interval-input').value = settings.check_interval_seconds;
    $('#timeout-input').value = settings.timeout_seconds;
    $('#incident-hide-input').value = settings.incident_hide_hours;
    $('#retention-input').value = settings.retention_days;
    $('#incident-retention-input').value = settings.incident_retention_days;
    $('#ssl-interval-input').value = Math.max(1, Math.round(settings.ssl_check_interval_seconds / 3600));
    $('#status-enabled-input').checked = Boolean(settings.status_page_enabled);
    $('#status-title-input').value = settings.status_page_title || '';
    $('#status-description-input').value = settings.status_page_description || '';
}

async function saveSettings() {
    try {
        const payload = collectSettings();
        await api('/api/settings', { method: 'PUT', body: payload });
        state.settings = payload;
        toast('Настройки сохранены', 'success');
        await loadSites();
    } catch (error) {
        toast(error.message, 'error');
    }
}

function renderRecipients(recipients, telegramConfigured) {
    $('#telegram-status').textContent = telegramConfigured
        ? 'Telegram настроен: уведомления отправляются перечисленным получателям.'
        : 'TELEGRAM_BOT_TOKEN не задан. Уведомления отключены.';
    const list = $('#recipients-list');
    if (!recipients.length) {
        list.innerHTML = '<p class="hint">Получатели не добавлены.</p>';
        return;
    }
    list.innerHTML = recipients.map((recipient) => `
        <div class="list-row">
            <div>
                <strong>${escapeHtml(recipient.label || recipient.chat_id)}</strong>
                <div class="hint">${escapeHtml(recipient.chat_id)}</div>
            </div>
            <label class="toggle-label"><input type="checkbox" data-recipient-toggle="${recipient.id}" ${recipient.enabled ? 'checked' : ''}> вкл</label>
            <button class="btn-danger small" data-delete-recipient="${recipient.id}">Удалить</button>
        </div>`).join('');
}

function renderUsers(users) {
    const list = $('#users-list');
    list.innerHTML = users.map((user) => `
        <div class="list-row">
            <div>
                <strong>${escapeHtml(user.username)}</strong>
                ${state.user && user.username === state.user.username ? '<span class="hint"> (вы)</span>' : ''}
            </div>
            <select data-user-role="${user.id}">
                <option value="viewer" ${user.role === 'viewer' ? 'selected' : ''}>viewer</option>
                <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>admin</option>
            </select>
            <button class="btn-secondary small" data-reset-password="${user.id}">Пароль</button>
            <button class="btn-danger small" data-delete-user="${user.id}">Удалить</button>
        </div>`).join('');
}

async function loadSettingsData() {
    const [settingsData, recipientsData, usersData] = await Promise.all([
        api('/api/settings'),
        api('/api/recipients'),
        api('/api/users')
    ]);
    fillSettingsForm(settingsData.settings);
    renderRecipients(recipientsData.recipients, recipientsData.telegram_configured);
    renderUsers(usersData.users);
}

async function openSettings() {
    openModal('settings-modal');
    try {
        await loadSettingsData();
    } catch (error) {
        toast(error.message, 'error');
    }
}

async function addRecipient() {
    const chatId = $('#recipient-chat-input').value.trim();
    const label = $('#recipient-label-input').value.trim();
    if (!chatId) {
        toast('Укажите chat_id', 'error');
        return;
    }
    try {
        await api('/api/recipients', { method: 'POST', body: { chat_id: chatId, label } });
        $('#recipient-chat-input').value = '';
        $('#recipient-label-input').value = '';
        toast('Получатель добавлен', 'success');
        await loadSettingsData();
    } catch (error) {
        toast(error.message, 'error');
    }
}

async function addUser() {
    const username = $('#new-user-name').value.trim();
    const password = $('#new-user-password').value;
    const role = $('#new-user-role').value;
    if (!username || !password) {
        toast('Укажите логин и пароль', 'error');
        return;
    }
    try {
        await api('/api/users', { method: 'POST', body: { username, password, role } });
        $('#new-user-name').value = '';
        $('#new-user-password').value = '';
        toast('Пользователь добавлен', 'success');
        await loadSettingsData();
    } catch (error) {
        toast(error.message, 'error');
    }
}

function bindEvents() {
    $('#login-btn').addEventListener('click', async () => {
        const username = $('#username-input').value.trim();
        const password = $('#password-input').value;
        if (!username || !password) {
            $('#login-error').textContent = 'Введите логин и пароль';
            $('#login-error').classList.remove('hidden');
            return;
        }
        try {
            await api('/api/login', { method: 'POST', body: { username, password } });
            state.user = await api('/api/me');
            $('#login-error').classList.add('hidden');
            showApp();
            updateUserBadge();
            await loadSites();
        } catch (error) {
            $('#login-error').textContent = error.message === 'Too many attempts'
                ? 'Слишком много попыток, попробуйте позже'
                : 'Неверный логин или пароль';
            $('#login-error').classList.remove('hidden');
        }
    });

    $('#password-input').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') $('#login-btn').click();
    });
    $('#username-input').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') $('#password-input').focus();
    });

    $('#logout-btn').addEventListener('click', async () => {
        try {
            await api('/api/logout', { method: 'POST' });
        } catch (error) {
            // ignore
        }
        showLogin();
    });

    $('#logout-all-btn').addEventListener('click', async () => {
        if (!confirm('Завершить все активные сессии, включая текущую?')) return;
        try {
            await api('/api/logout-all', { method: 'POST' });
        } catch (error) {
            // ignore
        }
        showLogin();
    });

    $('#theme-btn').addEventListener('click', toggleTheme);
    $('#settings-btn').addEventListener('click', openSettings);
    $('#add-site-btn').addEventListener('click', () => openAddSite());
    $('#confirm-add-btn').addEventListener('click', saveSite);
    $('#save-settings-btn').addEventListener('click', saveSettings);
    $('#save-status-btn').addEventListener('click', saveSettings);
    $('#add-recipient-btn').addEventListener('click', addRecipient);
    $('#add-user-btn').addEventListener('click', addUser);

    $('#search-input').addEventListener('input', (event) => {
        state.filters.search = event.target.value.trim();
        renderSites();
    });
    $('#status-filter').addEventListener('change', (event) => {
        state.filters.status = event.target.value;
        renderSites();
    });
    $('#tag-filter').addEventListener('change', (event) => {
        state.filters.tag = event.target.value;
        renderSites();
    });
    $('#sort-select').addEventListener('change', (event) => {
        state.filters.sort = event.target.value;
        renderSites();
    });

    $('#sites-grid').addEventListener('click', (event) => {
        if (event.target.closest('a')) return;
        const action = event.target.closest('[data-action]');
        const card = event.target.closest('.site-card');
        if (!card) return;
        const siteId = Number(card.dataset.id);
        if (action) {
            event.preventDefault();
            handleCardAction(action.dataset.action, siteId);
            return;
        }
        openSiteDetail(siteId);
    });

    $('#modal-body').addEventListener('click', (event) => {
        const range = event.target.closest('[data-range]');
        if (range) {
            state.detailRange = range.dataset.range;
            loadDetail();
            return;
        }
        const action = event.target.closest('[data-detail-action]');
        if (action) {
            handleDetailAction(action.dataset.detailAction);
            return;
        }
        const ack = event.target.closest('[data-incident-ack]');
        if (ack) {
            handleIncidentAction('ack', Number(ack.dataset.incidentAck));
            return;
        }
        const note = event.target.closest('[data-incident-note]');
        if (note) {
            handleIncidentAction('note', Number(note.dataset.incidentNote));
        }
    });

    $('#edit-site-btn').addEventListener('click', () => {
        if (state.detailSite) openAddSite(state.detailSite);
    });

    document.querySelectorAll('[data-close]').forEach((button) => {
        button.addEventListener('click', () => closeModal(button.dataset.close));
    });
    document.querySelectorAll('.modal').forEach((modal) => {
        modal.addEventListener('click', (event) => {
            if (event.target === modal) closeModal(modal.id);
        });
    });
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        const open = [...document.querySelectorAll('.modal:not(.hidden)')]
            .sort((a, b) => Number(getComputedStyle(a).zIndex || 0) - Number(getComputedStyle(b).zIndex || 0));
        if (open.length) closeModal(open[open.length - 1].id);
    });

    document.querySelectorAll('.tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.add('hidden'));
            tab.classList.add('active');
            const panel = document.getElementById(`tab-${tab.dataset.tab}`);
            if (panel) panel.classList.remove('hidden');
        });
    });

    $('#recipients-list').addEventListener('change', async (event) => {
        const toggle = event.target.closest('[data-recipient-toggle]');
        if (!toggle) return;
        try {
            await api(`/api/recipients/${toggle.dataset.recipientToggle}`, {
                method: 'PUT',
                body: { enabled: toggle.checked }
            });
            toast(toggle.checked ? 'Получатель включён' : 'Получатель отключён', 'success');
        } catch (error) {
            toast(error.message, 'error');
            await loadSettingsData();
        }
    });

    $('#recipients-list').addEventListener('click', async (event) => {
        const button = event.target.closest('[data-delete-recipient]');
        if (!button) return;
        if (!confirm('Удалить получателя?')) return;
        try {
            await api(`/api/recipients/${button.dataset.deleteRecipient}`, { method: 'DELETE' });
            toast('Получатель удалён', 'success');
            await loadSettingsData();
        } catch (error) {
            toast(error.message, 'error');
        }
    });

    $('#test-notifications-btn').addEventListener('click', async () => {
        try {
            await api('/api/notifications/test', { method: 'POST' });
            toast('Тестовое сообщение отправлено', 'success');
        } catch (error) {
            toast(error.message, 'error');
        }
    });

    $('#users-list').addEventListener('change', async (event) => {
        const select = event.target.closest('[data-user-role]');
        if (!select) return;
        try {
            await api(`/api/users/${select.dataset.userRole}`, {
                method: 'PUT',
                body: { role: select.value }
            });
            toast('Роль обновлена', 'success');
            if (Number(select.dataset.userRole) === state.user?.id) {
                window.location.reload();
                return;
            }
            await loadSettingsData();
        } catch (error) {
            toast(error.message, 'error');
            await loadSettingsData();
        }
    });

    $('#users-list').addEventListener('click', async (event) => {
        const deleteButton = event.target.closest('[data-delete-user]');
        if (deleteButton) {
            if (!confirm('Удалить пользователя?')) return;
            try {
                await api(`/api/users/${deleteButton.dataset.deleteUser}`, { method: 'DELETE' });
                toast('Пользователь удалён', 'success');
                await loadSettingsData();
            } catch (error) {
                toast(error.message, 'error');
            }
            return;
        }
        const resetButton = event.target.closest('[data-reset-password]');
        if (resetButton) {
            const password = prompt('Новый пароль (минимум 8 символов):');
            if (!password) return;
            try {
                await api(`/api/users/${resetButton.dataset.resetPassword}`, {
                    method: 'PUT',
                    body: { password }
                });
                toast('Пароль обновлён', 'success');
            } catch (error) {
                toast(error.message, 'error');
            }
        }
    });
}

async function init() {
    applyTheme();
    bindEvents();
    try {
        state.user = await api('/api/me');
        showApp();
        updateUserBadge();
        await loadSites();
    } catch (error) {
        showLogin();
    }
}

init();
