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

const formatDuration = (seconds) => I18n.formatDurationShort(seconds);
const formatDate = (timestamp) => I18n.formatDate(timestamp);

function siteStatus(site) {
    if (site.paused) return { key: 'paused', label: I18n.tsp('status.paused') };
    if (site.last_status === 'up') return { key: 'up', label: I18n.tsp('status.up') };
    if (site.last_status === 'down') return { key: 'down', label: I18n.tsp('status.down') };
    return { key: 'unknown', label: I18n.tsp('status.unknown') };
}

function sslLabel(site) {
    if (!site.ssl_expires_at) return '';
    if (site.ssl_expired) return `<span class="badge badge-danger">${escapeHtml(I18n.t('ssl.expired'))}</span>`;
    const days = Math.ceil((site.ssl_expires_at - Date.now() / 1000) / 86400);
    const cls = days <= 30 ? 'badge-warning' : 'badge-ok';
    return `<span class="badge ${cls}">${escapeHtml(I18n.t('ssl.expiresIn', { n: days }))}</span>`;
}

function render(data) {
    if (data.ui_language && I18n.getLanguage() !== data.ui_language) {
        I18n.setLanguage(data.ui_language);
    }
    const title = data.title || I18n.tsp('titleDefault');
    document.title = title;
    document.getElementById('status-title').textContent = title;
    document.getElementById('status-description').textContent = data.description || '';
    document.getElementById('status-meta').textContent = I18n.tsp('updated', { time: I18n.formatTime(Date.now() / 1000) });

    const sites = data.sites || [];
    const active = sites.filter((site) => !site.paused);
    const downCount = active.filter((site) => site.last_status === 'down').length;
    const unknownCount = active.filter((site) => site.last_status !== 'up' && site.last_status !== 'down').length;

    const banner = document.getElementById('overall-banner');
    if (!sites.length) {
        banner.className = 'overall-banner';
        banner.textContent = I18n.tsp('banner.noServices');
    } else if (!active.length) {
        banner.className = 'overall-banner';
        banner.textContent = I18n.tsp('banner.allPaused');
    } else if (downCount > 0) {
        banner.className = 'overall-banner down';
        banner.textContent = I18n.tsp('banner.problems', { down: downCount, total: active.length });
    } else if (unknownCount > 0) {
        banner.className = 'overall-banner';
        banner.textContent = I18n.tPluralStatus(unknownCount, 'banner.awaiting');
    } else {
        banner.className = 'overall-banner ok';
        banner.textContent = I18n.tsp('banner.allOk');
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
                        <span>${escapeHtml(I18n.tsp('uptime24', { value: formatPercent(site.uptime_24h) }))}</span>
                        <span>${escapeHtml(I18n.tsp('uptime7', { value: formatPercent(site.uptime_7d) }))}</span>
                        ${site.last_check ? `<span>${escapeHtml(I18n.tsp('checkedAt', { date: formatDate(site.last_check) }))}</span>` : ''}
                    </div>
                    ${sslLabel(site) ? `<div class="site-badges" style="margin-top:.55rem">${sslLabel(site)}</div>` : ''}
                </article>`;
        }).join('');
    }

    const incidents = data.incidents || [];
    const incidentsBlock = document.getElementById('public-incidents');
    if (!incidents.length) {
        incidentsBlock.innerHTML = `<p class="hint">${escapeHtml(I18n.tsp('incidentsNone'))}</p>`;
    } else {
        incidentsBlock.innerHTML = incidents.map((incident) => `
            <div class="public-incident">
                <strong>${escapeHtml(incident.site_name || I18n.tsp('incidentSite'))}</strong>
                — ${escapeHtml(formatDate(incident.started_at))},
                ${incident.ongoing ? `<span class="badge badge-danger">${escapeHtml(I18n.tsp('incidentOngoing'))}</span>` : `<span class="badge badge-ok">${escapeHtml(I18n.tsp('incidentRecovered'))}</span>`}
                <span class="hint">(${escapeHtml(formatDuration(incident.duration_seconds))})</span>
            </div>`).join('');
    }
}

async function loadStatus() {
    try {
        const response = await fetch('/api/public/status', { credentials: 'same-origin' });
        if (response.status === 404) {
            document.getElementById('status-title').textContent = I18n.tsp('banner.disabled');
            document.getElementById('status-description').textContent = '';
            document.getElementById('status-meta').textContent = '';
            const banner = document.getElementById('overall-banner');
            banner.className = 'overall-banner';
            banner.textContent = I18n.tsp('banner.disabledDesc');
            document.getElementById('public-grid').innerHTML = '';
            document.getElementById('public-incidents').innerHTML = '';
            return;
        }
        if (!response.ok) throw new Error('Request failed');
        render(await response.json());
    } catch (error) {
        const banner = document.getElementById('overall-banner');
        banner.className = 'overall-banner down';
        banner.textContent = I18n.tsp('banner.loadFailed');
    }
}

loadStatus();
setInterval(loadStatus, REFRESH_MS);
