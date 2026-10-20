const REFRESH_MS = 30000;

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

function formatPercent(value) {
    return value === null || value === undefined ? '—' : `${Number(value).toFixed(1)}%`;
}

function formatDuration(seconds) {
    if (seconds === null || seconds === undefined) return '—';
    const total = Math.max(0, Math.floor(seconds));
    if (total < 60) return `${total} сек`;
    if (total < 3600) return `${Math.floor(total / 60)} мин`;
    if (total < 86400) return `${Math.floor(total / 3600)} ч`;
    return `${Math.floor(total / 86400)} дн`;
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

function siteStatus(site) {
    if (site.paused) return { key: 'paused', label: 'На паузе' };
    if (site.last_status === 'up') return { key: 'up', label: 'Работает' };
    if (site.last_status === 'down') return { key: 'down', label: 'Недоступен' };
    return { key: 'unknown', label: 'Нет данных' };
}

function sslLabel(site) {
    if (!site.ssl_expires_at) return '';
    if (site.ssl_expired) return '<span class="badge badge-danger">SSL истёк</span>';
    const days = Math.ceil((site.ssl_expires_at - Date.now() / 1000) / 86400);
    const cls = days <= 30 ? 'badge-warning' : 'badge-ok';
    return `<span class="badge ${cls}">SSL ${days} дн</span>`;
}

function render(data) {
    document.title = data.title || 'Статус сервисов';
    document.getElementById('status-title').textContent = data.title || 'Статус сервисов';
    document.getElementById('status-description').textContent = data.description || '';
    document.getElementById('status-meta').textContent = `Обновлено ${new Date().toLocaleTimeString('ru-RU')}`;

    const sites = data.sites || [];
    const active = sites.filter((site) => !site.paused);
    const downCount = active.filter((site) => site.last_status === 'down').length;
    const unknownCount = active.filter((site) => site.last_status !== 'up' && site.last_status !== 'down').length;

    const banner = document.getElementById('overall-banner');
    if (!sites.length) {
        banner.className = 'overall-banner';
        banner.textContent = 'Публичные сервисы пока не добавлены';
    } else if (!active.length) {
        banner.className = 'overall-banner';
        banner.textContent = 'Все сервисы на паузе';
    } else if (downCount > 0) {
        banner.className = 'overall-banner down';
        banner.textContent = `Есть проблемы: недоступно ${downCount} из ${active.length}`;
    } else if (unknownCount > 0) {
        banner.className = 'overall-banner';
        banner.textContent = `Ожидаем данные по ${unknownCount} сервис(ам)`;
    } else {
        banner.className = 'overall-banner ok';
        banner.textContent = 'Все сервисы работают нормально';
    }

    const grid = document.getElementById('public-grid');
    if (!sites.length) {
        grid.innerHTML = '';
    } else {
        grid.innerHTML = sites.map((site) => {
            const status = siteStatus(site);
            return `
                <article class="public-card ${status.key}">
                    <div class="public-card-head">
                        <div>
                            <h3>${escapeHtml(site.name || site.url)}</h3>
                            <a class="site-url" href="${escapeHtml(safeUrl(site.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(site.url)}</a>
                        </div>
                        <span class="status-pill ${status.key}"><span class="dot"></span>${status.label}</span>
                    </div>
                    <div class="public-metrics">
                        <span>24ч: ${escapeHtml(formatPercent(site.uptime_24h))}</span>
                        <span>7д: ${escapeHtml(formatPercent(site.uptime_7d))}</span>
                        ${site.last_check ? `<span>Проверен ${escapeHtml(formatDate(site.last_check))}</span>` : ''}
                    </div>
                    ${sslLabel(site) ? `<div class="site-badges" style="margin-top:.55rem">${sslLabel(site)}</div>` : ''}
                </article>`;
        }).join('');
    }

    const incidents = data.incidents || [];
    const incidentsBlock = document.getElementById('public-incidents');
    if (!incidents.length) {
        incidentsBlock.innerHTML = '<p class="hint">За последние 7 дней инцидентов не было.</p>';
    } else {
        incidentsBlock.innerHTML = incidents.map((incident) => `
            <div class="public-incident">
                <strong>${escapeHtml(incident.site_name || 'Сайт')}</strong>
                — ${escapeHtml(formatDate(incident.started_at))},
                ${incident.ongoing ? '<span class="badge badge-danger">идёт</span>' : '<span class="badge badge-ok">восстановлен</span>'}
                <span class="hint">(${escapeHtml(formatDuration(incident.duration_seconds))})</span>
            </div>`).join('');
    }
}

async function loadStatus() {
    try {
        const response = await fetch('/api/public/status', { credentials: 'same-origin' });
        if (response.status === 404) {
            document.getElementById('status-title').textContent = 'Статус-страница отключена';
            document.getElementById('status-description').textContent = '';
            document.getElementById('status-meta').textContent = '';
            const banner = document.getElementById('overall-banner');
            banner.className = 'overall-banner';
            banner.textContent = 'Администратор отключил публичную страницу статуса.';
            document.getElementById('public-grid').innerHTML = '';
            document.getElementById('public-incidents').innerHTML = '';
            return;
        }
        if (!response.ok) throw new Error('Ошибка загрузки');
        render(await response.json());
    } catch (error) {
        const banner = document.getElementById('overall-banner');
        banner.className = 'overall-banner down';
        banner.textContent = 'Не удалось загрузить статус. Повторная попытка...';
    }
}

loadStatus();
setInterval(loadStatus, REFRESH_MS);
