(() => {
    'use strict';

    const ICONS = {
        library: '<path d="M4 5.5h5v13H4zM10.5 4h4v14.5h-4zM16 6.5h4v12h-4z"/>',
        channel: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="m8 3 4 3 4-3M9.5 10l6 3-6 3z"/>',
        stats: '<path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7M3 20h18"/>',
        recent: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2M5.6 5.6 3.5 3.5"/>',
        settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M18.5 5.5l-1.4 1.4M6.9 17.1l-1.4 1.4"/>',
        back: '<path d="m14.5 5-7 7 7 7M8 12h11"/>',
        trash: '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 10v6M14 10v6"/>',
        refresh: '<path d="M19 8a8 8 0 1 0 1 7M19 3v5h-5"/>',
        sort: '<path d="M8 4v16M5 7l3-3 3 3M16 20V4M13 17l3 3 3-3"/>',
        select: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="m7.5 12 3 3 6-7"/>',
        moon: '<path d="M19.5 15.2A8 8 0 0 1 8.8 4.5 8.2 8.2 0 1 0 19.5 15.2z"/>',
        sun: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
        order: '<path d="M9 6h11M9 12h11M9 18h11M4 5h1v3M4 11h2l-2 3h2M4 17c2-1 2 2 0 1 2-1 2 2 0 1"/>',
        newest: '<path d="M12 4v15M7 14l5 5 5-5M5 5h4"/>',
        oldest: '<path d="M12 20V5M7 10l5-5 5 5M5 19h4"/>',
        alpha: '<path d="m4 19 4-14 4 14M5.5 14h5M14 6h6l-6 12h6"/>',
        play: '<path d="m8 5 11 7-11 7z"/>',
        home: '<path d="m3 11 9-8 9 8M5.5 10v10h13V10M10 20v-6h4v6"/>',
        cloud: '<path d="M7 18h11a4 4 0 0 0 .7-7.9A6.5 6.5 0 0 0 6.2 8.7 4.7 4.7 0 0 0 7 18z"/>',
        movie: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M7 6l2-3M13 6l2-3M19 6l2-3"/>',
        tools: '<path d="M14.5 5.5a4 4 0 0 0-5 5L3.8 16.2a2 2 0 1 0 2.8 2.8l5.7-5.7a4 4 0 0 0 5-5l-2.5 2.5-2-2z"/>',
        firebase: '<path d="m5 20 2-16 4 4 2-6 6 18-7 2zM7 4l5 18"/>',
        palette: '<path d="M12 3a9 9 0 0 0 0 18h1.5a2 2 0 0 0 0-4H12a2 2 0 0 1 0-4h4a5 5 0 0 0 5-5c0-3-4-5-9-5z"/><path d="M7 9h.01M9 6h.01M14 6h.01M17 9h.01"/>',
        general: '<path d="M4 6h6M14 6h6M4 12h10M18 12h2M4 18h3M11 18h9"/><circle cx="12" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="9" cy="18" r="2"/>',
        folder: '<path d="M3 6h7l2 2h9v11H3z"/>',
        rocket: '<path d="M9 15 5 19v-4l3-3M15 9l4-4c-4-1-8 1-11 5l6 6c4-3 6-7 5-11M14 16l-3 3h-4l4-4"/><circle cx="14.5" cy="9.5" r="1.5"/>',
        infinity: '<path d="M8.5 8.5c-4.5-4-8 3-4 6s6-1 7.5-2.5 3.5-5.5 7.5-2.5-1 10-5 6"/>',
        page: '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6"/>',
        save: '<path d="M4 3h14l2 2v16H4zM8 3v6h8V3M8 21v-7h8v7"/>',
        focus: '<path d="M8 4H4v4M16 4h4v4M20 16v4h-4M4 16v4h4"/><circle cx="12" cy="12" r="3"/>',
        backup: '<path d="M5 7h14v13H5zM8 3h8v4M8 12h8M8 16h5"/>',
        warning: '<path d="M12 3 2.8 20h18.4zM12 9v5M12 17h.01"/>',
        close: '<path d="m5 5 14 14M19 5 5 19"/>',
        edit: '<path d="m4 20 4.5-1 10-10-3.5-3.5-10 10zM13.8 6.7l3.5 3.5M4 20h6"/>',
        data: '<path d="M4 6h16M4 12h12M4 18h8M18 15v6M15 18l3 3 3-3"/>',
        performance: '<path d="m13 2-8 12h7l-1 8 8-12h-7z"/>',
        music: '<path d="M9 18V6l10-2v12M9 10l10-2"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
        image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="2"/><path d="m4 18 5-5 3 3 3-4 5 6"/>',
        clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
        desktop: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
        mobile: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M10 5h4M11 18.5h2"/>',
        window: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 8h18M7 6h.01M10 6h.01"/>',
        lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
        hourglass: '<path d="M6 3h12M6 21h12M8 3c0 5 2 6 4 9-2 3-4 4-4 9M16 3c0 5-2 6-4 9 2 3 4 4 4 9"/>',
        previous: '<path d="M6 5v14M18 5 8 12l10 7z"/>',
        pause: '<path d="M8 5v14M16 5v14"/>',
        next: '<path d="M18 5v14M6 5l10 7-10 7z"/>',
        stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
        pin: '<path d="m8 3 8 8-2 2 3 3-1 1-4-4-3 3-1-1 3-3-5-5zM8 16l-4 4"/>',
        memo: '<path d="M5 3h14v18H5zM8 8h8M8 12h8M8 16h5"/>',
        menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
        download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
        grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
        list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1"/>'
    };

    class CmsIconElement extends HTMLElement {
        static get observedAttributes() { return ['name', 'label']; }
        connectedCallback() { this.render(); }
        attributeChangedCallback() { if (this.isConnected) this.render(); }
        render() {
            const name = this.getAttribute('name') || 'library';
            const drawing = ICONS[name] || ICONS.library;
            const label = this.getAttribute('label');
            this.innerHTML = `<svg viewBox="0 0 24 24" focusable="false">${drawing}</svg>`;
            if (label) {
                this.setAttribute('role', 'img');
                this.setAttribute('aria-label', label);
                this.removeAttribute('aria-hidden');
            } else {
                this.setAttribute('aria-hidden', 'true');
            }
        }
    }

    if (!customElements.get('cms-icon')) customElements.define('cms-icon', CmsIconElement);

    const html = (name, className = '') =>
        `<cms-icon name="${name}"${className ? ` class="${className}"` : ''} aria-hidden="true"></cms-icon>`;
    const create = (name, className = '') => {
        const icon = document.createElement('cms-icon');
        icon.setAttribute('name', name);
        if (className) icon.className = className;
        return icon;
    };
    const set = (element, name, text = '') => {
        if (!element) return;
        element.replaceChildren(create(name));
        if (text) element.append(document.createTextNode(` ${text}`));
    };

    globalThis.CmsIcons = Object.freeze({ html, create, set, names: Object.freeze(Object.keys(ICONS)) });
})();
