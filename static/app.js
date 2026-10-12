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
        if (res.status === 401) throw new Error('unauthorized');
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
let projectName = 'VibeMonitor';
let incidentHideHours = 12;

function showLogin() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
}

function showApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
}

async function checkAuth() {
    try {
        await API.getSites();
        showApp();
        startRefresh();
    } catch {
        showLogin();
    }
}

function startRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(loadSites, 10000);
}

async function loadSites() {
    try {
        const data = await API.getSites();
        sitesData = data.sites;
        projectName = data.project_name;
        incidentHideHours = data.incident_hide_hours;
        renderSites();
        document.getElementById('app-title').textContent = projectName;
        document.getElementById('login-title').textContent = projectName;
        document.title = projectName;
        document.getElementById('interval-badge').textContent =
            `Сайтов: ${sitesData.length} | Интервал: ${data.check_interval_seconds}с`;
    } catch {
        showLogin();
    }
}

function openSettingsModal() {
    API.getSites().then(data => {
        document.getElementById('project-name-input').value = data.project_name;
        document.getElementById('interval-input').value = data.check_interval_seconds;
        document.getElementById('timeout-input').value = data.timeout_seconds;
        document.getElementById('incident-hide-input').value = data.incident_hide_hours;
        document.getElementById('settings-modal').classList.remove('hidden');
    });
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
    grid.innerHTML = sitesData.map(site => {
        const incidentInfo = getIncidentInfo(site);
        return `
        <div class="site-card ${site.status}" onclick="openDetail('${site.url}')">
            <div class="site-card-header">
                <span class="site-name">${escapeHtml(site.name)}</span>
                <span class="status-dot ${site.status}"></span>
            </div>
            <div class="site-url">${escapeHtml(site.url)}</div>
            <div class="site-meta">
                ${site.http_code ? `<span>HTTP ${site.http_code}</span>` : ''}
                ${site.latency_ms ? `<span>${site.latency_ms}мс</span>` : ''}
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
    const diffSeconds = now - site.last_incident_time;
    const diffHours = diffSeconds / 3600;
    if (diffHours > incidentHideHours) return null;
    if (diffHours >= 1) {
        const hours = Math.floor(diffHours);
        const minutes = Math.floor((diffHours - hours) * 60);
        return `Инцидент: ${hours}ч ${minutes}мин назад`;
    }
    const minutes = Math.floor(diffSeconds / 60);
    return `Инцидент: ${minutes}мин назад`;
}

async function openDetail(url) {
    const data = await API.getHistory(url);
    if (!data) return;
    const modal = document.getElementById('modal');
    const title = document.getElementById('modal-title');
    const body = document.getElementById('modal-body');
    title.textContent = url;

    if (data.history.length === 0) {
        body.innerHTML = '<p style="color:#64748b">История пуста</p>';
    } else {
        body.innerHTML = `
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
                                    <span class="status-dot ${h.status}"></span>
                                    ${h.status === 'up' ? 'Доступен' : 'Недоступен'}
                                </span>
                            </td>
                            <td>${h.http_code ?? '—'}</td>
                            <td>${h.latency_ms ? h.latency_ms + 'мс' : '—'}</td>
                            <td style="color:${h.error ? '#ef4444' : '#64748b'}">${h.error ?? '—'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <button class="delete-btn" onclick="deleteSite('${url}')">Удалить сайт</button>
        `;
    }
    modal.classList.remove('hidden');
}

async function deleteSite(url) {
    if (!confirm(`Удалить ${url}?`)) return;
    await API.deleteSite(url);
    closeModal();
    loadSites();
}

function closeModal() {
    document.getElementById('modal').classList.add('hidden');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatTime(ts) {
    return new Date(ts * 1000).toLocaleString('ru-RU');
}

document.getElementById('login-btn').addEventListener('click', async () => {
    const password = document.getElementById('password-input').value;
    const ok = await API.login(password);
    if (ok) {
        document.getElementById('login-error').classList.add('hidden');
        showApp();
        loadSites();
        startRefresh();
    } else {
        document.getElementById('login-error').classList.remove('hidden');
    }
});

document.getElementById('password-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('login-btn').click();
});

document.getElementById('logout-btn').addEventListener('click', async () => {
    await API.logout();
    if (refreshInterval) clearInterval(refreshInterval);
    showLogin();
});

document.getElementById('interval-badge').addEventListener('click', openSettingsModal);

document.getElementById('add-site-btn').addEventListener('click', () => {
    document.getElementById('add-modal').classList.remove('hidden');
    document.getElementById('new-site-url').focus();
});

document.getElementById('add-modal-close').addEventListener('click', () => {
    document.getElementById('add-modal').classList.add('hidden');
});

document.getElementById('confirm-add-btn').addEventListener('click', async () => {
    const url = document.getElementById('new-site-url').value.trim();
    const name = document.getElementById('new-site-name').value.trim();
    const interval = document.getElementById('new-site-interval').value;
    if (!url) return;
    const ok = await API.addSite(url, name, interval ? parseInt(interval) : null);
    if (ok) {
        document.getElementById('new-site-url').value = '';
        document.getElementById('new-site-name').value = '';
        document.getElementById('new-site-interval').value = '';
        document.getElementById('add-modal').classList.add('hidden');
        loadSites();
    }
});

document.getElementById('save-settings-btn').addEventListener('click', async () => {
    const projectName = document.getElementById('project-name-input').value.trim();
    const interval = parseInt(document.getElementById('interval-input').value);
    const timeout = parseInt(document.getElementById('timeout-input').value);
    const incidentHideHours = parseInt(document.getElementById('incident-hide-input').value);
    if (projectName && interval >= 5 && timeout >= 1 && incidentHideHours >= 1) {
        await API.updateSettings(projectName, interval, timeout, incidentHideHours);
        document.getElementById('settings-modal').classList.add('hidden');
        loadSites();
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
