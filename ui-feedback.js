(function (global) {
    'use strict';

    const dialogState = new WeakMap();
    const FOCUSABLE = [
        'a[href]', 'button:not([disabled])', 'input:not([disabled])',
        'select:not([disabled])', 'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])'
    ].join(',');

    function ensureRegions() {
        let toastRegion = document.getElementById('cms-ui-toast-region');
        if (!toastRegion) {
            toastRegion = document.createElement('div');
            toastRegion.id = 'cms-ui-toast-region';
            toastRegion.className = 'cms-ui-toast-region';
            toastRegion.setAttribute('aria-live', 'polite');
            toastRegion.setAttribute('aria-atomic', 'false');
            document.body.appendChild(toastRegion);
        }
        let noticeRegion = document.getElementById('cms-ui-notice-region');
        if (!noticeRegion) {
            noticeRegion = document.createElement('div');
            noticeRegion.id = 'cms-ui-notice-region';
            noticeRegion.className = 'cms-ui-notice-region';
            noticeRegion.setAttribute('aria-live', 'assertive');
            document.body.appendChild(noticeRegion);
        }
        let liveRegion = document.getElementById('cms-ui-live-region');
        if (!liveRegion) {
            liveRegion = document.createElement('div');
            liveRegion.id = 'cms-ui-live-region';
            liveRegion.className = 'cms-ui-sr-only';
            liveRegion.setAttribute('aria-live', 'polite');
            liveRegion.setAttribute('aria-atomic', 'true');
            document.body.appendChild(liveRegion);
        }
        return { toastRegion, noticeRegion, liveRegion };
    }

    function announce(message) {
        const { liveRegion } = ensureRegions();
        liveRegion.textContent = '';
        requestAnimationFrame(() => { liveRegion.textContent = String(message || ''); });
    }

    function notify(message, options = {}) {
        const {
            type = 'info', title = '', detail = '', persistent = false,
            duration = type === 'success' ? 3200 : 5200,
            actionLabel = '', onAction = null
        } = options;
        const { toastRegion, noticeRegion } = ensureRegions();
        const region = persistent ? noticeRegion : toastRegion;
        const item = document.createElement('section');
        item.className = `cms-ui-notice cms-ui-notice-${type}${persistent ? ' is-persistent' : ''}`;
        item.setAttribute('role', persistent || type === 'danger' ? 'alert' : 'status');

        const body = document.createElement('div');
        body.className = 'cms-ui-notice-body';
        if (title) {
            const heading = document.createElement('strong');
            heading.className = 'cms-ui-notice-title';
            heading.textContent = title;
            body.appendChild(heading);
        }
        const text = document.createElement('span');
        text.className = 'cms-ui-notice-message';
        text.textContent = String(message || '');
        body.appendChild(text);
        if (detail) {
            const details = document.createElement('details');
            details.className = 'cms-ui-notice-details';
            const summary = document.createElement('summary');
            summary.textContent = '詳細を表示';
            const pre = document.createElement('pre');
            pre.textContent = String(detail);
            details.append(summary, pre);
            body.appendChild(details);
        }
        item.appendChild(body);

        if (actionLabel && typeof onAction === 'function') {
            const action = document.createElement('button');
            action.type = 'button';
            action.className = 'cms-ui-notice-action';
            action.textContent = actionLabel;
            action.addEventListener('click', () => onAction(item));
            item.appendChild(action);
        }
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'cms-ui-notice-close';
        close.setAttribute('aria-label', '通知を閉じる');
        close.textContent = '×';
        close.addEventListener('click', () => item.remove());
        item.appendChild(close);
        region.appendChild(item);
        if (!persistent) setTimeout(() => item.remove(), Math.max(1200, Number(duration) || 0));
        return item;
    }

    function friendlyError(error, context = '') {
        const code = String(error?.code || '').replace(/^FirebaseError:\s*/i, '');
        const detail = String(error?.stack || error?.message || error || '不明なエラー');
        const key = code || detail;
        let message = '処理を完了できませんでした。もう一度お試しください。';
        if (/failed-precondition|requires an index/i.test(key)) message = '再生履歴の集計準備が完了していません。現在のライブラリ情報で表示します。';
        else if (/permission-denied|forbidden|403/i.test(key)) message = 'この操作を実行する権限を確認できませんでした。ログイン状態を確認してください。';
        else if (/network-request-failed|unavailable|ERR_NAME_NOT_RESOLVED|network/i.test(key)) message = 'ネットワークへ接続できませんでした。接続を確認して再試行してください。';
        else if (/already-exists|duplicate|すでに/i.test(key)) message = '同じデータがすでに登録されています。';
        else if (/timeout|timed out/i.test(key)) message = '処理が時間内に完了しませんでした。しばらく待って再試行してください。';
        return { message: context ? `${context}：${message}` : message, detail, code };
    }

    function setButtonLabel(button, label, options = {}) {
        if (!button) return;
        button.setAttribute('aria-label', label);
        button.title = options.title || label;
        if (typeof options.pressed === 'boolean') button.setAttribute('aria-pressed', String(options.pressed));
        else button.removeAttribute('aria-pressed');
    }

    function makeInteractive(element, options = {}) {
        if (!element) return;
        element.tabIndex = options.tabIndex ?? 0;
        element.setAttribute('role', options.role || 'button');
        if (options.label) element.setAttribute('aria-label', options.label);
        if (typeof options.selected === 'boolean') element.setAttribute('aria-selected', String(options.selected));
        if (options.current) element.setAttribute('aria-current', options.current === true ? 'true' : options.current);
        element.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            if (event.target !== element && /^(INPUT|BUTTON|SELECT|TEXTAREA|A)$/.test(event.target.tagName)) return;
            event.preventDefault();
            if (typeof options.onActivate === 'function') options.onActivate(event);
            else element.click();
        });
    }

    function openDialog(overlay, options = {}) {
        if (!overlay) return;
        const panel = options.panel || overlay.querySelector('[role="dialog"], .settings-window, .url-add-dialog, .history-modal-content, section, div');
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        overlay.setAttribute('role', overlay.getAttribute('role') || 'presentation');
        if (panel) {
            panel.setAttribute('role', 'dialog');
            panel.setAttribute('aria-modal', 'true');
            if (options.labelledBy) panel.setAttribute('aria-labelledby', options.labelledBy);
            else if (options.label) panel.setAttribute('aria-label', options.label);
        }
        const keydown = event => {
            if (event.key === 'Escape' && options.escape !== false) {
                event.preventDefault();
                if (typeof options.onEscape === 'function') options.onEscape();
                else closeDialog(overlay);
                return;
            }
            if (event.key !== 'Tab' || !panel) return;
            const focusable = [...panel.querySelectorAll(FOCUSABLE)].filter(el => !el.hidden && el.getClientRects().length);
            if (!focusable.length) { event.preventDefault(); panel.tabIndex = -1; panel.focus(); return; }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        };
        overlay.addEventListener('keydown', keydown);
        dialogState.set(overlay, { previous, keydown });
        overlay.classList.remove('hidden');
        const initial = options.initialFocus || panel?.querySelector('[autofocus]') || panel?.querySelector(FOCUSABLE) || panel;
        setTimeout(() => {
            if (initial instanceof HTMLElement) {
                if (initial === panel && !initial.hasAttribute('tabindex')) initial.tabIndex = -1;
                initial.focus();
            }
        }, 0);
    }

    function closeDialog(overlay) {
        if (!overlay) return;
        const state = dialogState.get(overlay);
        if (state?.keydown) overlay.removeEventListener('keydown', state.keydown);
        overlay.classList.add('hidden');
        if (state?.previous?.isConnected) setTimeout(() => state.previous.focus(), 0);
        dialogState.delete(overlay);
    }

    function renderEmptyState(container, options = {}) {
        if (!container) return null;
        const empty = document.createElement('div');
        empty.className = 'cms-ui-empty-state';
        const title = document.createElement('strong');
        title.textContent = options.title || 'データがありません';
        const description = document.createElement('span');
        description.textContent = options.description || '条件を変更してもう一度お試しください。';
        empty.append(title, description);
        if (Array.isArray(options.actions) && options.actions.length) {
            const actions = document.createElement('div');
            actions.className = 'cms-ui-empty-actions';
            options.actions.forEach(actionOptions => {
                const action = document.createElement('button');
                action.type = 'button';
                action.textContent = actionOptions.label;
                action.addEventListener('click', actionOptions.onClick);
                actions.appendChild(action);
            });
            empty.appendChild(actions);
        }
        container.replaceChildren(empty);
        return empty;
    }

    function installAlertBridge() {
        if (global.alert?.__cmsUiBridge) return;
        const bridgedAlert = message => {
            const text = String(message || '');
            const isError = /失敗|エラー|できません|不正|権限|未入力/.test(text);
            const isWarning = !isError && /確認|選択|入力|必要|ありません/.test(text);
            notify(text, {
                type: isError ? 'danger' : isWarning ? 'warning' : 'success',
                persistent: isError,
                title: isError ? '処理を完了できませんでした' : ''
            });
        };
        bridgedAlert.__cmsUiBridge = true;
        global.alert = bridgedAlert;
    }

    function init() {
        ensureRegions();
        document.querySelectorAll('button[title]:not([aria-label])').forEach(button => button.setAttribute('aria-label', button.title));
    }

    global.CmsUI = Object.freeze({
        init, announce, notify, friendlyError, setButtonLabel,
        makeInteractive, openDialog, closeDialog, renderEmptyState, installAlertBridge
    });
})(window);
