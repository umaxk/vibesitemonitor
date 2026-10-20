const API = {
    async login(password) {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        return res.ok;
    },
    async logout() {
        await fetch('/api/logout', { method: 'POST' });
    },
    async getSites() {
        const res = await fetch('/api/sites');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    },
    async addSite(url, name, interval) {
        const res = await fetch('/api/sites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, name, check_interval_seconds: interval || null })
        });
        return res.ok;
    },
    async updateSite(oldUrl, url, name, interval) {
        const res = await fetch(`/api/sites/${encodeURIComponent(oldUrl)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, name, check_interval_seconds: interval || null })
        });
        return res.ok;
    },
    async deleteSite(url) {
        const res = await fetch(`/api/sites/${encodeURIComponent(url)}`, {
            method: 'DELETE'
        });
        return res.ok;
    },
    async updateSettings(projectName, interval, timeout, incidentHideHours) {
        const res = await fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                project_name: projectName,
                check_interval_seconds: interval,
                timeout_seconds: timeout,
                incident_hide_hours: incidentHideHours
            })
        });
        return res.ok;
    },
    async getHistory(url) {
        const res = await fetch(`/api/history/${encodeURIComponent(url)}`);
        if (!res.ok) return null;
        return res.json();
    }
};

let sitesData = [];
let refreshInterval = null;
let incidentHideHours = 12;
let defaultCheckInterval = 60;
let currentDetailUrl = null;
let editingSiteUrl = null;
let editingDefaultInterval = false;

function showLogin() {
    stopRefresh();
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
}

function showApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
}

async function checkAuth() {
    try {
        await loadSites();
        showApp();
        startRefresh();
    } catch {
        showLogin();
    }
}

function startRefresh() {
    stopRefresh();
    refreshInterval = setInterval(refreshSites, 10000);
}

function stopRefresh() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
}

async function refreshSites() {
    try {
        await loadSites();
    } catch {
        showLogin();
    }
}

async function loadSites() {
    const data = await API.getSites();
    sitesData = data.sites;
    incidentHideHours = data.incident_hide_hours;
    defaultCheckInterval = data.check_interval_seconds;
    renderSites();
    document.getElementById('app-title').textContent = data.project_name;
    document.getElementById('login-title').textContent = data.project_name;
    document.title = data.project_name;
    document.getElementById('interval-badge').textContent =
        `Сайтов: ${sitesData.length} | Интервал: ${data.check_interval_seconds}с`;
}

async function openSettingsModal() {
    try {
        const data = await API.getSites();
        document.getElementById('project-name-input').value = data.project_name;
        document.getElementById('interval-input').value = data.check_interval_seconds;
        document.getElementById('timeout-input').value = data.timeout_seconds;
        document.getElementById('incident-hide-input').value = data.incident_hide_hours;
        document.getElementById('settings-modal').classList.remove('hidden');
    } catch {
        showLogin();
    }
}

function openAddModal() {
    editingSiteUrl = null;
    editingDefaultInterval = false;
    document.getElementById('add-modal-title').textContent = 'Добавить сайт';
    document.getElementById('confirm-add-btn').textContent = 'Добавить';
    document.getElementById('new-site-url').value = '';
    document.getElementById('new-site-name').value = '';
    document.getElementById('new-site-interval').value = '';
    document.getElementById('add-modal').classList.remove('hidden');
    document.getElementById('new-site-url').focus();
}

function openEditModal(url) {
    const site = sitesData.find(item => item.url === url);
    if (!site) return;
    editingSiteUrl = site.url;
    editingDefaultInterval = site.check_interval_seconds == null;
    document.getElementById('add-modal-title').textContent = 'Редактировать сайт';
    document.getElementById('confirm-add-btn').textContent = 'Сохранить';
    document.getElementById('new-site-url').value = site.url;
    document.getElementById('new-site-name').value = site.name || '';
    document.getElementById('new-site-interval').value =
        site.check_interval_seconds ?? defaultCheckInterval;
    document.getElementById('add-modal').classList.remove('hidden');
    document.getElementById('new-site-url').focus();
}

function closeAddModal() {
    editingSiteUrl = null;
    editingDefaultInterval = false;
    document.getElementById('add-modal').classList.add('hidden');
}

function normalizeStatus(status) {
    return status === 'up' || status === 'down' ? status : 'unknown';
}

function renderSites() {
    const grid = document.getElementById('sites-grid');
    if (sitesData.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column: 1/-1;">
                <h3>Нет сайтов для мониторинга</h3>
                <p>Добавьте первый сайт кнопкой выше</p>
            </div>`;
        return;
    }
    grid.innerHTML = sitesData.map((site, index) => {
        const status = normalizeStatus(site.status);
        const incidentInfo = getIncidentInfo(site);
        return `
        <div class="site-card ${status}" data-site-index="${index}">
            <div class="site-card-header">
                <span class="site-name">${escapeHtml(site.name)}</span>
                <span class="status-dot ${status}"></span>
            </div>
            <div class="site-url">${escapeHtml(site.url)}</div>
            <div class="site-meta">
                ${site.http_code != null ? `<span>HTTP ${site.http_code}</span>` : ''}
                ${site.latency_ms != null ? `<span>${site.latency_ms}мс</span>` : ''}
                ${site.last_check ? `<span>${formatTime(site.last_check)}</span>` : ''}
                ${site.check_interval_seconds ? `<span>Интервал: ${site.check_interval_seconds}с</span>` : ''}
                ${incidentInfo ? `<span class="incident-badge">${incidentInfo}</span>` : ''}
                ${site.error ? `<span style="color:#ef4444">${escapeHtml(site.error)}</span>` : ''}
            </div>
        </div>`;
    }).join('');
}

function getIncidentInfo(site) {
    if (!site.last_incident_time) return null;
    const now = Date.now() / 1000;
    const diffSeconds = Math.max(0, now - site.last_incident_time);
    const diffHours = diffSeconds / 3600;
    if (diffHours > incidentHideHours) return null;
    const prefix = normalizeStatus(site.status) === 'down' ? 'Инцидент' : 'Последний инцидент';
    if (diffHours >= 1) {
        const hours = Math.floor(diffHours);
        const minutes = Math.floor((diffHours - hours) * 60);
        return `${prefix}: ${hours}ч ${minutes}мин назад`;
    }
    return `${prefix}: ${Math.floor(diffSeconds / 60)}мин назад`;
}

async function openDetail(url) {
    const data = await API.getHistory(url);
    if (!data) return;
    currentDetailUrl = url;
    const modal = document.getElementById('modal');
    const title = document.getElementById('modal-title');
    const body = document.getElementById('modal-body');
    title.textContent = url;

    const content = data.history.length === 0
        ? '<p style="color:#64748b">История пуста</p>'
        : `
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
                <tbody>
                    ${data.history.map(h => `
                        <tr>
                            <td>${formatTime(h.timestamp)}</td>
                            <td>
                                <span class="history-status">
                                    <span class="status-dot ${normalizeStatus(h.status)}"></span>
                                    ${h.status === 'up' ? 'Доступен' : 'Недоступен'}
                                </span>
                            </td>
                            <td>${h.http_code ?? '—'}</td>
                            <td>${h.latency_ms != null ? h.latency_ms + 'мс' : '—'}</td>
                            <td style="color:${h.error ? '#ef4444' : '#64748b'}">${escapeHtml(h.error ?? '—')}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;

    body.innerHTML = `${content}
        <div class="site-actions">
            <button class="btn-primary" data-action="edit-site">Редактировать</button>
            <button class="delete-btn" data-action="delete-site">Удалить сайт</button>
        </div>`;
    modal.classList.remove('hidden');
}

async function deleteSite(url) {
    if (!confirm(`Удалить ${url}?`)) return;
    const ok = await API.deleteSite(url);
    if (!ok) {
        alert('Не удалось удалить сайт');
        return;
    }
    closeModal();
    refreshSites();
}

function closeModal() {
    currentDetailUrl = null;
    document.getElementById('modal').classList.add('hidden');
}

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
}

function formatTime(ts) {
    if (!ts) return '—';
    return new Date(ts * 1000).toLocaleString('ru-RU');
}

document.getElementById('sites-grid').addEventListener('click', (event) => {
    const card = event.target.closest('.site-card');
    if (!card) return;
    const site = sitesData[Number(card.dataset.siteIndex)];
    if (site) openDetail(site.url);
});

document.getElementById('modal-body').addEventListener('click', (event) => {
    if (!currentDetailUrl) return;
    if (event.target.closest('[data-action="edit-site"]')) {
        openEditModal(currentDetailUrl);
    } else if (event.target.closest('[data-action="delete-site"]')) {
        deleteSite(currentDetailUrl);
    }
});

document.getElementById('login-btn').addEventListener('click', async () => {
    const button = document.getElementById('login-btn');
    const password = document.getElementById('password-input').value;
    const error = document.getElementById('login-error');
    button.disabled = true;
    try {
        const ok = await API.login(password);
        if (ok) {
            error.classList.add('hidden');
            await checkAuth();
        } else {
            error.classList.remove('hidden');
        }
    } finally {
        button.disabled = false;
    }
});

document.getElementById('password-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('login-btn').click();
});

document.getElementById('logout-btn').addEventListener('click', async () => {
    await API.logout();
    showLogin();
});

document.getElementById('interval-badge').addEventListener('click', openSettingsModal);

document.getElementById('add-site-btn').addEventListener('click', openAddModal);

document.getElementById('add-modal-close').addEventListener('click', closeAddModal);

document.getElementById('confirm-add-btn').addEventListener('click', async () => {
    const url = document.getElementById('new-site-url').value.trim();
    const name = document.getElementById('new-site-name').value.trim();
    const interval = document.getElementById('new-site-interval').value;
    if (!url) return;
    const isEditing = editingSiteUrl !== null;
    let intervalValue = interval ? parseInt(interval) : null;
    if (isEditing && editingDefaultInterval && intervalValue === defaultCheckInterval) {
        intervalValue = null;
    }
    const ok = isEditing
        ? await API.updateSite(editingSiteUrl, url, name, intervalValue)
        : await API.addSite(url, name, intervalValue);
    if (ok) {
        closeAddModal();
        if (isEditing) closeModal();
        refreshSites();
    } else {
        alert(isEditing
            ? 'Не удалось сохранить сайт: проверьте URL или такой сайт уже есть'
            : 'Не удалось добавить сайт: проверьте URL или такой сайт уже есть');
    }
});

document.getElementById('save-settings-btn').addEventListener('click', async () => {
    const projectName = document.getElementById('project-name-input').value.trim();
    const interval = parseInt(document.getElementById('interval-input').value);
    const timeout = parseInt(document.getElementById('timeout-input').value);
    const incidentHideHours = parseInt(document.getElementById('incident-hide-input').value);
    if (projectName && interval >= 5 && timeout >= 1 && incidentHideHours >= 1) {
        const ok = await API.updateSettings(projectName, interval, timeout, incidentHideHours);
        if (ok) {
            document.getElementById('settings-modal').classList.add('hidden');
            refreshSites();
        } else {
            alert('Не удалось сохранить настройки');
        }
    }
});

document.getElementById('settings-modal-close').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.add('hidden');
});

document.getElementById('settings-modal').addEventListener('click', (e) => {
    if (e.target.id === 'settings-modal') {
        document.getElementById('settings-modal').classList.add('hidden');
    }
});

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') closeModal();
});

checkAuth();
