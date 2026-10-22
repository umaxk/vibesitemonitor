(function (global) {
    'use strict';

    const DICT = {
        ru: {
            common: {
                loading: 'Загрузка...',
                delete: 'Удалить',
                save: 'Сохранить',
                dash: '—'
            },
            login: {
                subtitle: 'Вход в панель мониторинга',
                username: 'Логин',
                password: 'Пароль',
                submit: 'Войти',
                enter: 'Введите логин и пароль',
                badCredentials: 'Неверный логин или пароль',
                tooMany: 'Слишком много попыток, попробуйте позже'
            },
            header: {
                searchPlaceholder: 'Поиск сайта...',
                themeTitle: 'Сменить тему',
                filtersTitle: 'Фильтры',
                settingsTitle: 'Настройки',
                accountTitle: 'Аккаунт'
            },
            filter: {
                statusAll: 'Все статусы',
                statusUp: 'Доступны',
                statusDown: 'Недоступны',
                statusUnknown: 'Без данных',
                statusPaused: 'На паузе',
                tagAll: 'Все теги',
                sortName: 'По имени',
                sortStatus: 'По статусу',
                sortLatency: 'По задержке'
            },
            menu: {
                logout: 'Выйти',
                logoutTitle: 'Выйти из текущей сессии',
                logoutAll: 'Выйти везде',
                logoutAllTitle: 'Завершить все активные сессии'
            },
            fab: {
                title: 'Добавить сайт'
            },
            status: {
                up: 'Доступен',
                down: 'Недоступен',
                paused: 'Пауза',
                unknown: 'Нет данных'
            },
            card: {
                checkTitle: 'Проверить сейчас',
                resumeTitle: 'Возобновить',
                pauseTitle: 'Поставить на паузу',
                checkedAt: 'Проверен {ago}',
                neverChecked: 'Ещё не проверялся',
                everyNsec: 'Каждые {n} сек',
                uptime24: '24ч: {value}',
                badgePublic: 'Публичный'
            },
            ssl: {
                column: 'SSL',
                unknownTitle: 'Не удалось проверить SSL',
                expired: 'SSL истёк',
                validUntil: 'Сертификат действителен до {date}',
                expiresIn: 'SSL {n} дн'
            },
            incident: {
                since: 'Инцидент с {date}'
            },
            empty: {
                filtered: 'Ничего не найдено'
            },
            detail: {
                edit: 'Редактировать',
                check: 'Проверить',
                resume: 'Возобновить',
                pause: 'Пауза',
                statUptime: 'Аптайм',
                statChecks: 'Проверок',
                statAvgLatency: 'Средний отклик',
                chartLatency: 'Задержка',
                chartUptime: 'Аптайм',
                chartIncidents: 'Инциденты',
                latencyDataset: 'Задержка, мс',
                uptimeDataset: 'Аптайм, %'
            },
            incidents: {
                none: 'Инцидентов за выбранный период нет.',
                ongoing: 'Идёт',
                recovered: 'Восстановлен',
                acked: 'Подтверждён {date}',
                notAcked: 'Не подтверждён',
                ackBtn: 'Подтвердить',
                noteBtn: 'Заметка'
            },
            log: {
                title: 'Лог запросов',
                lastN: 'последние {n}',
                time: 'Время',
                state: 'Статус',
                http: 'HTTP',
                latency: 'Задержка',
                error: 'Ошибка',
                empty: 'Записей пока нет.'
            },
            tab: {
                general: 'Общие',
                status: 'Статус-страница',
                notifications: 'Уведомления',
                users: 'Пользователи'
            },
            settings: {
                title: 'Настройки',
                projectName: 'Название проекта',
                interval: 'Интервал проверки (сек)',
                timeout: 'Таймаут (сек)',
                incidentHide: 'Скрывать инцидент в карточке (часов)',
                sslInterval: 'SSL-проверка (часов)',
                retention: 'Хранить проверки (дней)',
                incidentRetention: 'Хранить инциденты (дней)',
                language: 'Язык интерфейса',
                save: 'Сохранить'
            },
            statuspage: {
                enabled: 'Включить публичную страницу /status',
                title: 'Заголовок',
                description: 'Описание',
                hint: 'На странице показываются только сайты с включённым флагом «Публичный».'
            },
            recipients: {
                chatId: 'chat_id, например 123456789',
                label: 'Подпись',
                add: 'Добавить',
                test: 'Отправить тест',
                empty: 'Получатели не добавлены.',
                on: 'вкл',
                telegramOk: 'Telegram настроен: уведомления отправляются перечисленным получателям.',
                telegramOff: 'TELEGRAM_BOT_TOKEN не задан. Уведомления отключены.'
            },
            users: {
                newName: 'Логин',
                newPassword: 'Пароль (мин. 8)',
                add: 'Добавить',
                you: ' (вы)',
                password: 'Пароль'
            },
            add: {
                add: 'Добавить сайт',
                edit: 'Редактировать сайт',
                url: 'URL *',
                urlPlaceholder: 'https://example.com',
                name: 'Название',
                namePlaceholder: 'Example',
                interval: 'Интервал проверки (сек) — необязательно',
                intervalPlaceholder: 'По умолчанию',
                tags: 'Теги (через запятую)',
                tagsPlaceholder: 'prod, api',
                public: 'Показывать на публичной статус-странице',
                confirm: 'Добавить'
            },
            toast: {
                checking: 'Проверяем сайт...',
                checked: 'Проверка завершена',
                resumed: 'Сайт возобновлён',
                paused: 'Сайт на паузе',
                deleted: 'Сайт удалён',
                incidentAcked: 'Инцидент подтверждён',
                noteSaved: 'Заметка сохранена',
                siteUpdated: 'Сайт обновлён',
                siteAdded: 'Сайт добавлен',
                needUrl: 'Укажите URL',
                needChatId: 'Укажите chat_id',
                needLoginPass: 'Укажите логин и пароль',
                settingsSaved: 'Настройки сохранены',
                recipientAdded: 'Получатель добавлен',
                recipientEnabled: 'Получатель включён',
                recipientDisabled: 'Получатель отключён',
                recipientDeleted: 'Получатель удалён',
                userAdded: 'Пользователь добавлен',
                roleUpdated: 'Роль обновлена',
                userDeleted: 'Пользователь удалён',
                passwordUpdated: 'Пароль обновлён',
                testSent: 'Тестовое сообщение отправлено'
            },
            confirm: {
                deleteSite: 'Удалить {name}? История проверок и инциденты также будут удалены.',
                logoutAll: 'Завершить все активные сессии, включая текущую?',
                deleteRecipient: 'Удалить получателя?',
                deleteUser: 'Удалить пользователя?'
            },
            prompt: {
                incidentNote: 'Заметка к инциденту:',
                newPassword: 'Новый пароль (минимум 8 символов):'
            },
            error: {
                generic: 'Ошибка запроса',
                siteNotFound: 'Сайт не найден',
                siteExists: 'Такой сайт уже есть',
                privateAddress: 'URL указывает на частный или зарезервированный адрес',
                invalidRange: 'Неверный период',
                incidentNotFound: 'Инцидент не найден',
                recipientExists: 'Такой получатель уже есть',
                recipientNotFound: 'Получатель не найден',
                invalidUsername: 'Некорректный логин',
                userExists: 'Такой пользователь уже есть',
                userNotFound: 'Пользователь не найден',
                lastAdminDemote: 'Нельзя понизить последнего администратора',
                lastAdminDelete: 'Нельзя удалить последнего администратора',
                cannotDeleteSelf: 'Нельзя удалить себя'
            },
            unit: {
                sec: 'сек',
                min: 'мин',
                hr: 'ч',
                day: 'дн',
                ms: 'мс'
            },
            ago: {
                justNow: 'только что',
                suffix: ' назад'
            }
        },
        en: {
            common: {
                loading: 'Loading...',
                delete: 'Delete',
                save: 'Save',
                dash: '—'
            },
            login: {
                subtitle: 'Sign in to the monitoring panel',
                username: 'Username',
                password: 'Password',
                submit: 'Sign in',
                enter: 'Enter username and password',
                badCredentials: 'Invalid username or password',
                tooMany: 'Too many attempts, try again later'
            },
            header: {
                searchPlaceholder: 'Search sites...',
                themeTitle: 'Switch theme',
                filtersTitle: 'Filters',
                settingsTitle: 'Settings',
                accountTitle: 'Account'
            },
            filter: {
                statusAll: 'All statuses',
                statusUp: 'Reachable',
                statusDown: 'Unreachable',
                statusUnknown: 'No data',
                statusPaused: 'Paused',
                tagAll: 'All tags',
                sortName: 'By name',
                sortStatus: 'By status',
                sortLatency: 'By latency'
            },
            menu: {
                logout: 'Log out',
                logoutTitle: 'End the current session',
                logoutAll: 'Log out everywhere',
                logoutAllTitle: 'End all active sessions'
            },
            fab: {
                title: 'Add site'
            },
            status: {
                up: 'Up',
                down: 'Down',
                paused: 'Paused',
                unknown: 'No data'
            },
            card: {
                checkTitle: 'Check now',
                resumeTitle: 'Resume',
                pauseTitle: 'Pause',
                checkedAt: 'Checked {ago}',
                neverChecked: 'Not checked yet',
                everyNsec: 'Every {n} sec',
                uptime24: '24h: {value}',
                badgePublic: 'Public'
            },
            ssl: {
                column: 'SSL',
                unknownTitle: 'SSL could not be checked',
                expired: 'SSL expired',
                validUntil: 'Certificate valid until {date}',
                expiresIn: 'SSL {n} d'
            },
            incident: {
                since: 'Incident since {date}'
            },
            empty: {
                filtered: 'Nothing found'
            },
            detail: {
                edit: 'Edit',
                check: 'Check',
                resume: 'Resume',
                pause: 'Pause',
                statUptime: 'Uptime',
                statChecks: 'Checks',
                statAvgLatency: 'Avg. response',
                chartLatency: 'Latency',
                chartUptime: 'Uptime',
                chartIncidents: 'Incidents',
                latencyDataset: 'Latency, ms',
                uptimeDataset: 'Uptime, %'
            },
            incidents: {
                none: 'No incidents in the selected period.',
                ongoing: 'Ongoing',
                recovered: 'Recovered',
                acked: 'Acknowledged {date}',
                notAcked: 'Not acknowledged',
                ackBtn: 'Acknowledge',
                noteBtn: 'Note'
            },
            log: {
                title: 'Request log',
                lastN: 'last {n}',
                time: 'Time',
                state: 'Status',
                http: 'HTTP',
                latency: 'Latency',
                error: 'Error',
                empty: 'No records yet.'
            },
            tab: {
                general: 'General',
                status: 'Status page',
                notifications: 'Notifications',
                users: 'Users'
            },
            settings: {
                title: 'Settings',
                projectName: 'Project name',
                interval: 'Check interval (sec)',
                timeout: 'Timeout (sec)',
                incidentHide: 'Hide incident in card (hours)',
                sslInterval: 'SSL check (hours)',
                retention: 'Keep checks (days)',
                incidentRetention: 'Keep incidents (days)',
                language: 'Language',
                save: 'Save'
            },
            statuspage: {
                enabled: 'Enable the public /status page',
                title: 'Title',
                description: 'Description',
                hint: 'Only sites with the “Public” flag will be shown on the page.'
            },
            recipients: {
                chatId: 'chat_id, e.g. 123456789',
                label: 'Label',
                add: 'Add',
                test: 'Send test',
                empty: 'No recipients added.',
                on: 'on',
                telegramOk: 'Telegram is configured: notifications are sent to the listed recipients.',
                telegramOff: 'TELEGRAM_BOT_TOKEN is not set. Notifications are disabled.'
            },
            users: {
                newName: 'Username',
                newPassword: 'Password (min. 8)',
                add: 'Add',
                you: ' (you)',
                password: 'Password'
            },
            add: {
                add: 'Add site',
                edit: 'Edit site',
                url: 'URL *',
                urlPlaceholder: 'https://example.com',
                name: 'Name',
                namePlaceholder: 'Example',
                interval: 'Check interval (sec) — optional',
                intervalPlaceholder: 'Default',
                tags: 'Tags (comma-separated)',
                tagsPlaceholder: 'prod, api',
                public: 'Show on the public status page',
                confirm: 'Add'
            },
            toast: {
                checking: 'Checking site...',
                checked: 'Check completed',
                resumed: 'Site resumed',
                paused: 'Site paused',
                deleted: 'Site deleted',
                incidentAcked: 'Incident acknowledged',
                noteSaved: 'Note saved',
                siteUpdated: 'Site updated',
                siteAdded: 'Site added',
                needUrl: 'Enter the URL',
                needChatId: 'Enter chat_id',
                needLoginPass: 'Enter username and password',
                settingsSaved: 'Settings saved',
                recipientAdded: 'Recipient added',
                recipientEnabled: 'Recipient enabled',
                recipientDisabled: 'Recipient disabled',
                recipientDeleted: 'Recipient deleted',
                userAdded: 'User added',
                roleUpdated: 'Role updated',
                userDeleted: 'User deleted',
                passwordUpdated: 'Password updated',
                testSent: 'Test message sent'
            },
            confirm: {
                deleteSite: 'Delete {name}? Check history and incidents will also be deleted.',
                logoutAll: 'End all active sessions, including the current one?',
                deleteRecipient: 'Delete recipient?',
                deleteUser: 'Delete user?'
            },
            prompt: {
                incidentNote: 'Incident note:',
                newPassword: 'New password (min. 8 characters):'
            },
            error: {
                generic: 'Request failed',
                siteNotFound: 'Site not found',
                siteExists: 'Site already exists',
                privateAddress: 'URL points to a private or reserved address',
                invalidRange: 'Invalid range',
                incidentNotFound: 'Incident not found',
                recipientExists: 'Recipient already exists',
                recipientNotFound: 'Recipient not found',
                invalidUsername: 'Invalid username',
                userExists: 'User already exists',
                userNotFound: 'User not found',
                lastAdminDemote: 'Cannot demote the last admin',
                lastAdminDelete: 'Cannot delete the last admin',
                cannotDeleteSelf: 'Cannot delete yourself'
            },
            unit: {
                sec: 'sec',
                min: 'min',
                hr: 'h',
                day: 'd',
                ms: 'ms'
            },
            ago: {
                justNow: 'just now',
                suffix: ' ago'
            }
        }
    };

    // Статус-страница (отдельный синтаксис, чтобы не белить словарь панели)
    const STATUS_DICT = {
        ru: {
            titleDefault: 'Статус сервисов',
            updated: 'Обновлено {time}',
            footerAuto: 'Обновляется автоматически каждые 30 секунд',
            incidentsTitle: 'Последние инциденты',
            incidentsNone: 'За последние 7 дней инцидентов не было.',
            banner: {
                noServices: 'Публичные сервисы пока не добавлены',
                allPaused: 'Все сервисы на паузе',
                problems: 'Есть проблемы: недоступно {down} из {total}',
                awaiting: {
                    one: 'Ожидаем данные по {n} сервису',
                    few: 'Ожидаем данные по {n} сервисам',
                    many: 'Ожидаем данные по {n} сервисам',
                    other: 'Ожидаем данные по {n} сервисам'
                },
                allOk: 'Все сервисы работают нормально',
                disabled: 'Статус-страница отключена',
                disabledDesc: 'Администратор отключил публичную страницу статуса.',
                loadFailed: 'Не удалось загрузить статус. Повторная попытка...'
            },
            status: {
                up: 'Работает',
                down: 'Недоступен',
                paused: 'На паузе',
                unknown: 'Нет данных'
            },
            uptime24: '24ч: {value}',
            uptime7: '7д: {value}',
            checkedAt: 'Проверен {date}',
            incidentOngoing: 'идёт',
            incidentRecovered: 'восстановлен',
            incidentSite: 'Сайт'
        },
        en: {
            titleDefault: 'Service status',
            updated: 'Updated {time}',
            footerAuto: 'Refreshes automatically every 30 seconds',
            incidentsTitle: 'Recent incidents',
            incidentsNone: 'No incidents in the last 7 days.',
            banner: {
                noServices: 'No public services added yet',
                allPaused: 'All services are paused',
                problems: 'Some issues: {down} of {total} unreachable',
                awaiting: {
                    one: 'Waiting for data on {n} service',
                    other: 'Waiting for data on {n} services'
                },
                allOk: 'All services are operating normally',
                disabled: 'Status page is disabled',
                disabledDesc: 'The administrator has disabled the public status page.',
                loadFailed: 'Failed to load status. Retrying...'
            },
            status: {
                up: 'Operational',
                down: 'Down',
                paused: 'Paused',
                unknown: 'No data'
            },
            uptime24: '24h: {value}',
            uptime7: '7d: {value}',
            checkedAt: 'Checked {date}',
            incidentOngoing: 'ongoing',
            incidentRecovered: 'recovered',
            incidentSite: 'Site'
        }
    };

    const API_ERROR_MAP = {
        'Site not found': 'error.siteNotFound',
        'Site already exists': 'error.siteExists',
        'URL points to a private or reserved address': 'error.privateAddress',
        'Invalid range': 'error.invalidRange',
        'Incident not found': 'error.incidentNotFound',
        'Recipient already exists': 'error.recipientExists',
        'Recipient not found': 'error.recipientNotFound',
        'Invalid username': 'error.invalidUsername',
        'User already exists': 'error.userExists',
        'User not found': 'error.userNotFound',
        'Cannot demote the last admin': 'error.lastAdminDemote',
        'Cannot delete the last admin': 'error.lastAdminDelete',
        'Cannot delete yourself': 'error.cannotDeleteSelf',
        'Ошибка запроса': 'error.generic',
        'Request failed': 'error.generic'
    };

    let currentLang = 'ru';

    function normalizeLang(lang) {
        return String(lang).toLowerCase().startsWith('en') ? 'en' : 'ru';
    }

    function interpolate(text, params) {
        if (!params) return text;
        return Object.entries(params)
            .reduce((acc, [key, value]) => acc.split(`{${key}}`).join(String(value)), text);
    }

    function lookup(dict, key) {
        let entry = dict;
        for (const part of key.split('.')) {
            entry = entry ? entry[part] : undefined;
            if (entry === undefined) break;
        }
        return entry;
    }

    function t(key, params) {
        let entry = lookup(DICT[currentLang] || DICT.ru, key);
        if (entry === undefined) {
            entry = lookup(DICT.ru, key);
        }
        if (typeof entry !== 'string') return key;
        return interpolate(entry, params);
    }

    function tsp(key, params) {
        const entry = lookup(STATUS_DICT[currentLang] || STATUS_DICT.ru, key);
        if (typeof entry !== 'string') return key;
        return interpolate(entry, params);
    }

    function tPlural(n, dict, key, params) {
        const entry = lookup(dict || DICT[currentLang] || DICT.ru, key);
        if (typeof entry !== 'object' || entry === null) return String(n);
        const rules = new Intl.PluralRules(currentLang === 'ru' ? 'ru-RU' : 'en-US');
        const text = entry[rules.select(n)] ?? entry.other;
        return text ? interpolate(text, { ...params, n }) : String(n);
    }

    function tPluralPanel(n, key, params) {
        return tPlural(n, null, key, params);
    }

    function tPluralStatus(n, key, params) {
        return tPlural(n, STATUS_DICT[currentLang] || STATUS_DICT.ru, key, params);
    }

    function locale() {
        return currentLang === 'en' ? 'en-US' : 'ru-RU';
    }

    function formatDate(timestamp) {
        if (!timestamp) return '—';
        return new Date(timestamp * 1000).toLocaleString(locale(), {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function formatTime(timestamp) {
        if (!timestamp) return '—';
        return new Date(timestamp * 1000).toLocaleTimeString(locale());
    }

    function formatAgo(timestamp) {
        if (!timestamp) return '—';
        const diff = Math.max(0, Math.floor(Date.now() / 1000 - timestamp));
        const dict = DICT[currentLang] || DICT.ru;
        if (diff < 10) return dict.ago.justNow;
        if (diff < 60) return `${diff} ${dict.unit.sec}${dict.ago.suffix}`;
        if (diff < 3600) return `${Math.floor(diff / 60)} ${dict.unit.min}${dict.ago.suffix}`;
        if (diff < 86400) return `${Math.floor(diff / 3600)} ${dict.unit.hr}${dict.ago.suffix}`;
        return `${Math.floor(diff / 86400)} ${dict.unit.day}${dict.ago.suffix}`;
    }

    function formatDuration(seconds) {
        if (seconds === null || seconds === undefined) return '—';
        const total = Math.max(0, Math.floor(seconds));
        const dict = DICT[currentLang] || DICT.ru;
        if (total < 60) return `${total} ${dict.unit.sec}`;
        if (total < 3600) return `${Math.floor(total / 60)} ${dict.unit.min}`;
        if (total < 86400) return `${Math.floor(total / 3600)} ${dict.unit.hr} ${Math.floor((total % 3600) / 60)} ${dict.unit.min}`;
        return `${Math.floor(total / 86400)} ${dict.unit.day} ${Math.floor((total % 86400) / 3600)} ${dict.unit.hr}`;
    }

    function formatDurationShort(seconds) {
        if (seconds === null || seconds === undefined) return '—';
        const total = Math.max(0, Math.floor(seconds));
        const dict = DICT[currentLang] || DICT.ru;
        if (total < 60) return `${total} ${dict.unit.sec}`;
        if (total < 3600) return `${Math.floor(total / 60)} ${dict.unit.min}`;
        if (total < 86400) return `${Math.floor(total / 3600)} ${dict.unit.hr}`;
        return `${Math.floor(total / 86400)} ${dict.unit.day}`;
    }

    function errorText(error) {
        if (!error || typeof error.message !== 'string') return error?.message || '';
        const key = API_ERROR_MAP[error.message];
        return key ? t(key) : error.message;
    }

function applyI18n(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((el) => {
        el.textContent = t(el.dataset.i18n);
    });
    scope.querySelectorAll('[data-i18n-tsp]').forEach((el) => {
        el.textContent = tsp(el.dataset.i18nTsp);
    });
        scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
            el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
        });
        scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
            el.setAttribute('title', t(el.dataset.i18nTitle));
        });
        scope.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
            el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
        });
    }

    function setLanguage(lang, options) {
        currentLang = normalizeLang(lang);
        document.documentElement.lang = currentLang;
        applyI18n();
        if (options && typeof options.onChange === 'function') {
            options.onChange(currentLang);
        }
        return currentLang;
    }

    function getLanguage() {
        return currentLang;
    }

    global.I18n = {
        t,
        tsp,
        tPluralPanel,
        tPluralStatus,
        setLanguage,
        getLanguage,
        locale,
        formatDate,
        formatTime,
        formatAgo,
        formatDuration,
        formatDurationShort,
        errorText,
        applyI18n
    };

    global.I18n.setLanguage(
        document.documentElement.getAttribute('lang') || 'ru'
    );
})(window);
