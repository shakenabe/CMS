/* Shared, side-effect-free rules. Media identities and legacy payloads remain unchanged. */
(function (root) {
    const clamp = (value, fallback = 50) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : fallback;
    const migrateSettings = settings => {
        const next = { ...settings };
        if (next.settingsSchemaVersion !== 2) {
            if (Object.hasOwn(next, 'pocketPanelOpacity')) next.pocketPanelOpacity = 100 - clamp(next.pocketPanelOpacity, 72);
            next.settingsSchemaVersion = 2;
        }
        return next;
    };
    const mergeSettings = (defaults, local, incoming, restore = false) => {
        // All current webSettings keys describe this browser/device. Library and folder
        // metadata are synchronized independently. Only explicit restore imports them.
        return { ...defaults, ...local, ...(restore ? migrateSettings(incoming || {}) : {}) };
    };
    const sameMedia = (a, b) => Boolean(a && b && (a === b || (a.id && b.id ? a.id === b.id : a.url && a.url === b.url)));
    const activeIndex = (items, current, context, viewedFolder) => context && context.folderId === viewedFolder ? items.findIndex(item => sameMedia(item, current)) : -1;
    root.CmsStatePolicy = { clamp, migrateSettings, mergeSettings, sameMedia, activeIndex };
})(typeof window === 'object' ? window : globalThis);
