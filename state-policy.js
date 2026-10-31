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
    const sameQueueItem = (a, b) => Boolean(a?._cmsQueueId && a._cmsQueueItemId && b?._cmsQueueId
        && a._cmsQueueId === b._cmsQueueId && a._cmsQueueItemId === b._cmsQueueItemId);
    const activeIndex = (items, current, context, viewedFolder) => {
        if (!context || context.folderId !== viewedFolder) return -1;
        if (items.some(item => item?._cmsQueueItemId)) return items.findIndex(item => sameQueueItem(item, current));
        // A regular library view has no queue occurrence fields. It may highlight
        // one unambiguous record only within its own playback context.
        const matches = items.reduce((result, item, index) => { if (sameMedia(item, current)) result.push(index); return result; }, []);
        return matches.length === 1 ? matches[0] : -1;
    };
    const createQueueItems = (items, queueId) => items.map((item, index) => ({ ...item,
        _cmsQueueId: queueId, _cmsQueueItemId: `${queueId}:item:${index}` }));
    const createIdentity = (prefix = 'queue') => `${prefix}:${root.crypto?.randomUUID?.() || `${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`}`;
    const resolveQueueSelection = (items, context, args) => {
        if (!args.queueItemId || args.queueId !== context?.queueId || args.queueRevision !== context?.queueRevision) return -1;
        return items.findIndex(item => item._cmsQueueId === args.queueId && item._cmsQueueItemId === args.queueItemId);
    };
    root.CmsStatePolicy = { clamp, migrateSettings, mergeSettings, sameMedia, sameQueueItem, activeIndex, createQueueItems, createIdentity, resolveQueueSelection };
})(typeof window === 'object' ? window : globalThis);
