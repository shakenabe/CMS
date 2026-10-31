/* CMS Recommendation Engine v1. Pure calculation; never writes CMS data. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CMSRecommendationEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';
  const VERSION = '1.1.0';
  const BUCKETS = ['core', 'rediscovery', 'discovery'];
  const ALL_BUCKETS = BUCKETS.concat('overflow');
  const DEFAULT_CONFIG = deepFreeze({
    engineVersion: VERSION, configVersion: 'v1-unified-2', rngVersion: 'mulberry32-v1',
    defaultMode: 'smartRandom', defaultProfile: 'standard', defaultQueueLength: 20,
    maxQueueLength: 200, recommendationSectionLimit: 10,
    profiles: {
      standard: { core: 14, rediscovery: 4, discovery: 2 },
      stable: { core: 16, rediscovery: 3, discovery: 1 },
      explore: { core: 11, rediscovery: 4, discovery: 5 },
      rediscover: { core: 10, rediscovery: 8, discovery: 2 }
    },
    buckets: { coreMinEvidence: 11, coreMinManualRecent30: 3, rediscoveryMinEvidence: 10,
      rediscoveryFavoriteEligible: true, rediscoveryMinDays: 60, discoveryMaxObservedCount: 2 },
    score: { base: 8, favoriteBonus: 12, countLogScale: 2, countBonusCap: 20,
      manualRecentScale: 2, manualRecentBonusCap: 6, rediscoveryBonusBase: 6,
      rediscoveryBonusCap: 12, rediscoveryExtraDayStep: 30, recentPenalty: 6, minimumWeight: 1 },
    recency: { avoidDays: 2, sessionAvoidLast: 5 },
    sequence: { enabled: false, acceptedDiagnosticMultiplier: 0.8 },
    diversity: { avoidConfirmedFamilyAdjacent: true },
    diagnostics: { retainLatestQueues: 10 }, fallbackTimezone: 'Asia/Tokyo'
  });
  function deepFreeze(value) {
    Object.values(value).forEach(v => { if (v && typeof v === 'object') deepFreeze(v); });
    return Object.freeze(value);
  }
  const clone = value => JSON.parse(JSON.stringify(value));
  const compare = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  const validCount = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  function merge(base, patch) {
    const out = clone(base);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return out;
    Object.keys(patch).forEach(key => {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new TypeError('Unsafe setting key');
      out[key] = patch[key] && typeof patch[key] === 'object' && !Array.isArray(patch[key]) &&
        base[key] && typeof base[key] === 'object' ? merge(base[key], patch[key]) : patch[key];
    });
    return out;
  }
  function validateConfig(patch) {
    const c = merge(DEFAULT_CONFIG, patch);
    function integer(n, min, max) { return Number.isSafeInteger(n) && n >= min && n <= max; }
    if (c.engineVersion !== VERSION || c.rngVersion !== 'mulberry32-v1' ||
        typeof c.configVersion !== 'string' || !c.configVersion) throw new RangeError('Unsupported engine/config version');
    if (!['smartRandom', 'uniformRandom'].includes(c.defaultMode) ||
        !c.profiles[c.defaultProfile]) throw new RangeError('Invalid default mode/profile');
    if (!integer(c.maxQueueLength, 1, 200) || !integer(c.defaultQueueLength, 1, c.maxQueueLength) ||
        !integer(c.recommendationSectionLimit, 1, 200) ||
        !integer(c.recency.avoidDays, 0, 36500) || !integer(c.recency.sessionAvoidLast, 0, 200) ||
        !integer(c.diagnostics.retainLatestQueues, 0, 10000)) throw new RangeError('Invalid length/recency');
    Object.values(c.profiles).forEach(profile => {
      if (!profile || BUCKETS.some(k => !integer(profile[k], 0, 20)) ||
          BUCKETS.reduce((n, k) => n + profile[k], 0) !== 20) throw new RangeError('Profile quota must total 20');
    });
    Object.entries(c.buckets).forEach(([key, n]) => {
      if (key === 'rediscoveryFavoriteEligible') {
        if (typeof n !== 'boolean') throw new RangeError('Invalid favorite eligibility');
      } else if (!integer(n, 0, Number.MAX_SAFE_INTEGER)) throw new RangeError('Invalid bucket threshold');
    });
    Object.values(c.score).forEach(n => {
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) throw new RangeError('Invalid score');
    });
    if (c.score.minimumWeight < 1e-6 || c.score.rediscoveryExtraDayStep <= 0 ||
        !Number.isFinite(c.sequence.acceptedDiagnosticMultiplier) ||
        c.sequence.acceptedDiagnosticMultiplier < 0 || c.sequence.acceptedDiagnosticMultiplier > 1 ||
        typeof c.sequence.enabled !== 'boolean' ||
        typeof c.diversity.avoidConfirmedFamilyAdjacent !== 'boolean') throw new RangeError('Invalid weight/flag');
    try { new Intl.DateTimeFormat('en', { timeZone: c.fallbackTimezone }); }
    catch (_) { throw new RangeError('Invalid timezone'); }
    return c;
  }
  function normalizeContentKey(value) {
    const raw = typeof value === 'string' ? value : value && value.url;
    if (typeof raw !== 'string') return null;
    let u;
    try { u = new URL(raw); } catch (_) { return null; }
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return null;
    const host = u.hostname.toLowerCase();
    const p = u.pathname.split('/').filter(Boolean);
    let id = null;
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) {
      if (p.length === 1 && p[0] === 'watch') id = u.searchParams.get('v');
      else if (p.length === 2 && ['shorts', 'embed', 'live'].includes(p[0])) id = p[1];
    } else if (host === 'youtu.be' && p.length === 1) id = p[0];
    if (id !== null) return /^[A-Za-z0-9_-]{11}$/.test(id) ? 'youtube:' + id : null;
    if (['nicovideo.jp', 'www.nicovideo.jp'].includes(host) && p.length === 2 && p[0] === 'watch') id = p[1];
    else if (host === 'nico.ms' && p.length === 1) id = p[0];
    else return null;
    return /^(?:sm|nm|so)\d+$/.test(id) || /^\d+$/.test(id) ? 'niconico:' + id : null;
  }
  function validKey(key) {
    return typeof key === 'string' && /^(?:youtube:[A-Za-z0-9_-]{11}|niconico:(?:(?:sm|nm|so)?\d+))$/.test(key);
  }
  // Exact tag matching, independent of casing and full-width variants; never title matching.
  function normalizeExcludedTags(value) {
    const entries = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    return [...new Set(entries.filter(entry => typeof entry === 'string')
      .flatMap(entry => entry.split(/[,、，\r\n]+/u))
      .map(entry => entry.normalize('NFKC').trim().toLowerCase().slice(0, 120)).filter(Boolean))]
      .sort(compare).slice(0, 100);
  }
  // Folder names are exact library identifiers: do not lowercase, trim or split punctuation.
  function normalizeExcludedFolders(value) {
    return [...new Set((Array.isArray(value) ? value : []).filter(name => typeof name === 'string' && name.length > 0))]
      .sort(compare);
  }
  function dayIndex(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [y, m, d] = value.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return Math.floor(dt.getTime() / 86400000);
  }
  function civilDay(value, timezone) {
    if (!value) return null;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return dayIndex(value) === null ? null : value;
    }
    const dt = new Date(value);
    if (!Number.isFinite(dt.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(dt);
    const find = t => parts.find(p => p.type === t).value;
    return find('year') + '-' + find('month') + '-' + find('day');
  }
  function preferenceMap(value) {
    if (value instanceof Map) return value;
    if (Array.isArray(value)) return new Map(value.map(v => [v.contentKey, v]));
    return new Map(Object.entries(value || {}));
  }
  const getId = r => r.id !== undefined ? r.id : r.mediaId !== undefined ? r.mediaId : r.videoRef;
  function inScope(record, scope) {
    if (!scope || scope.type === 'library') return true;
    if (scope.type === 'records') return (scope.recordIds || []).some(id => String(id) === String(getId(record)));
    if (scope.type === 'folder') {
      const name = scope.folderName || scope.name;
      return record.folder === name || (record.folders || []).includes(name);
    }
    if (scope.type === 'site') return record.site === scope.site;
    if (scope.type === 'contentKeys') return (scope.contentKeys || []).includes(normalizeContentKey(record));
    throw new RangeError('Unsupported scope');
  }
  function playable(record) {
    return !record.deleted && !record.deletedAt && !record.isSystem &&
      record.site !== 'system' && record.available !== false && record.unavailable !== true &&
      !['unavailable', 'deleted', 'private'].includes(record.availability);
  }
  function classifyCandidate(v, config) {
    const b = config.buckets;
    if (((b.rediscoveryFavoriteEligible && v.favorite) || v.preferenceEvidenceCount >= b.rediscoveryMinEvidence) &&
        v.daysSinceLastPlay !== null && v.daysSinceLastPlay >= b.rediscoveryMinDays && v.retainedHistoryCount === 0) return 'rediscovery';
    if (v.favorite || v.preferenceEvidenceCount >= b.coreMinEvidence ||
        v.manualRecent30 >= b.coreMinManualRecent30) return 'core';
    if (v.observedPlayCount <= b.discoveryMaxObservedCount) return 'discovery';
    return 'overflow';
  }
  function scoreCandidate(v, bucket, config) {
    const s = config.score;
    const total = Math.min(s.countBonusCap, s.countLogScale * Math.log2(1 + v.preferenceEvidenceCount));
    const legacy = Math.min(s.countBonusCap, s.countLogScale * Math.log2(1 + v.playCountBaseline));
    const breakdown = {
      base: s.base, legacy: legacy * v.sequenceConfidenceMultiplier,
      manual: Math.max(0, total - legacy),
      recentManual: Math.min(s.manualRecentBonusCap, s.manualRecentScale * v.manualRecent30),
      favorite: v.favorite ? s.favoriteBonus : 0,
      rediscovery: bucket === 'rediscovery' ? Math.min(s.rediscoveryBonusCap,
        s.rediscoveryBonusBase + Math.floor((v.daysSinceLastPlay - config.buckets.rediscoveryMinDays) / s.rediscoveryExtraDayStep)) : 0,
      recentPenalty: v.daysSinceLastPlay !== null && v.daysSinceLastPlay < config.recency.avoidDays ? -s.recentPenalty : 0,
      sequenceAdjustment: legacy * (v.sequenceConfidenceMultiplier - 1)
    };
    const raw = Math.max(s.minimumWeight, breakdown.base + breakdown.legacy + breakdown.manual +
      breakdown.recentManual + breakdown.favorite + breakdown.rediscovery + breakdown.recentPenalty);
    const weight = Math.floor(raw * 1e6 + 0.5) / 1e6;
    if (!(weight > 0) || !Number.isFinite(weight)) throw new RangeError('Nonpositive rounded weight');
    const codes = [], reasons = [];
    const add = (code, text) => { codes.push(code); reasons.push(text); };
    if (v.favorite) add('favorite', '★登録済み');
    if (v.playCountBaseline >= config.buckets.coreMinEvidence) add('recordedEvidence', '移行時の再生実績が多い');
    if (v.manualPlayCountAfterBaseline > 0) add('manualEvidence', '自分で選んだ再生記録があります');
    if (v.manualRecent30 >= config.buckets.coreMinManualRecent30 && v.manualRecent30 > 0)
      add('recentManual', '保持履歴の直近30日で自分から' + v.manualRecent30 + '回選択');
    if (bucket === 'rediscovery') add('rediscovery', '最後の記録は' + v.daysSinceLastPlay + '日前');
    if (v.observedPlayCount <= config.buckets.discoveryMaxObservedCount)
      add('lowObservedCount', 'CMSの再生記録は' + v.observedPlayCount + '回');
    if (v.observedPlayCount === 0 && v.effectiveLastPlayedDate === null && v.retainedHistoryCount === 0)
      add('neverRecorded', 'CMSでは未再生です');
    return { weight, breakdown, reasonCodes: codes, reasons };
  }
  function prepareCandidates(input, patch) {
    if (!input || typeof input !== 'object') throw new TypeError('Candidate input required');
    const config = validateConfig(patch);
    const timezone = input.timezone || config.fallbackTimezone;
    try { new Intl.DateTimeFormat('en', { timeZone: timezone }); }
    catch (_) { throw new RangeError('Invalid timezone'); }
    const ref = new Date(input.referenceTime);
    if (!input.referenceTime || !Number.isFinite(ref.getTime())) throw new RangeError('referenceTime required');
    const referenceTime = ref.toISOString(), asOfDate = civilDay(ref, timezone), refDay = dayIndex(asOfDate);
    const diagnostics = [], groups = new Map(), ids = new Map(), prefs = preferenceMap(input.preferences);
    const excluded = new Set(input.excludedContentKeys || []);
    const excludedTags = normalizeExcludedTags(input.excludedTags);
    const excludedTagSet = new Set(excludedTags);
    const excludedFolders = normalizeExcludedFolders(input.excludedFolders);
    const excludedFolderSet = new Set(excludedFolders);
    const diag = (code, contentKey, detail) => diagnostics.push({ code, contentKey: contentKey || null, detail: detail || null });
    (input.records || []).forEach(record => {
      const key = normalizeContentKey(record);
      if (!key) { diag('invalidOrUnsupportedUrl', null, String(getId(record) || '')); return; }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(record);
      if (getId(record) !== undefined) ids.set(String(getId(record)), key);
    });
    const histories = new Map(), seenEvents = new Set(), observedDates = [];
    let validHistoryCount = 0;
    (input.history || []).forEach(e => {
      if (e.countedAsPlay === false || ['technicalError', 'skipped', 'cancelled'].includes(e.outcome)) return;
      if (e.eventId) {
        if (seenEvents.has(String(e.eventId))) return;
        seenEvents.add(String(e.eventId));
      }
      const key = validKey(e.contentKey) ? e.contentKey :
        ids.get(String(e.mediaId !== undefined ? e.mediaId : e.recordId !== undefined ? e.recordId : e.videoRef)) ||
        normalizeContentKey(e.url);
      if (!key || !groups.has(key)) { diag('unmatchedHistory', key); return; }
      const rawDate = e.playedAt || e.playedDate;
      const day = civilDay(rawDate, timezone);
      if (!day || dayIndex(day) > refDay ||
          (e.playedAt && new Date(e.playedAt).getTime() > ref.getTime())) { diag('invalidOrFutureHistory', key); return; }
      if (!histories.has(key)) histories.set(key, []);
      histories.get(key).push({ event: e, day, index: dayIndex(day) });
      validHistoryCount++; observedDates.push(day);
    });
    const familyMap = new Map();
    const relations = Array.isArray(input.relations) ? input.relations : Object.values(input.relations || {});
    relations.forEach(r => {
      if (r.status !== 'confirmed' || !r.familyId ||
          !['sameSong', 'songFamily', 'remix', 'MAD', 'soundEffectRemix'].includes(r.type)) return;
      [r.fromContentKey, r.toContentKey].concat(r.contentKeys || r.members || []).filter(validKey).forEach(key => {
        if (!familyMap.has(key)) familyMap.set(key, new Set());
        familyMap.get(key).add(String(r.familyId));
      });
    });
    const candidates = [];
    Array.from(groups.keys()).sort(compare).forEach(key => {
      const records = groups.get(key), pref = prefs.get(key) || {};
      const eligible = records.filter(r => playable(r) && inScope(r, input.scope))
        .sort((a, b) => compare(getId(a), getId(b)));
      if (!eligible.length || pref.excludedFromRecommendations === true || excluded.has(key) ||
          input.currentContentKey === key) return;
      // Deny any membership across all registrations of the same URL, before ranking or quotas.
      const matchingFolder = records.flatMap(record => normalizeExcludedFolders([
        ...(Array.isArray(record.folders) ? record.folders : []), record.folder
      ])).find(name => excludedFolderSet.has(name));
      if (matchingFolder) { diag('excludedFolder', key, matchingFolder); return; }
      // A duplicate URL must not bypass an excluded tag by choosing its untagged registration.
      const matchingTag = records.flatMap(record => normalizeExcludedTags([
        ...(Array.isArray(record.tags) ? record.tags : typeof record.tags === 'string' ? [record.tags] : []),
        ...(Array.isArray(record.confirmedTags) ? record.confirmedTags : [])
      ])).find(tag => excludedTagSet.has(tag));
      if (matchingTag) { diag('excludedTag', key, matchingTag); return; }
      const counts = records.map(r => {
        if (validCount(r.playCount)) return r.playCount;
        if (r.playCount !== undefined) diag('invalidPlayCount', key);
        return 0;
      });
      const observedPlayCount = Math.max(0, ...counts);
      const evidence = pref.legacyEvidence;
      let baseline;
      if (evidence && validCount(evidence.playCountBaseline)) baseline = evidence.playCountBaseline;
      else if (input.allowLegacyBaseline === true) baseline = observedPlayCount;
      else { diag('baselinePending', key); return; }
      const manual = validCount(pref.manualPlayCountAfterBaseline) ? pref.manualPlayCountAfterBaseline : 0;
      const history = histories.get(key) || [];
      const dates = history.map(h => h.day);
      records.forEach(r => {
        [r.lastPlayedAt, r.lastPlayedDate].filter(Boolean).forEach(raw => {
          const day = civilDay(raw, timezone);
          if (day && dayIndex(day) <= refDay &&
              (/^\d{4}-\d{2}-\d{2}$/.test(String(raw)) || new Date(raw).getTime() <= ref.getTime())) dates.push(day);
          else diag('invalidOrFutureLastDate', key);
        });
      });
      dates.sort(compare);
      const last = dates.length ? dates[dates.length - 1] : null;
      const capture = evidence && evidence.capturedAt ? new Date(evidence.capturedAt).getTime() : null;
      const recent = n => history.filter(h => h.index >= refDay - n + 1);
      const manualRecent30 = recent(30).filter(h => h.event.playContext &&
        h.event.playContext.source === 'manual' &&
        (capture === null || Number.isFinite(capture) && h.event.playedAt &&
         new Date(h.event.playedAt).getTime() > capture)).length;
      const diagnosis = pref.sequenceDiagnostic;
      const q = config.sequence.enabled && diagnosis && diagnosis.status === 'accepted' ?
        (Number.isFinite(diagnosis.multiplier) && diagnosis.multiplier >= 0 && diagnosis.multiplier <= 1 ?
          diagnosis.multiplier : config.sequence.acceptedDiagnosticMultiplier) : 1;
      const representative = eligible[0];
      const v = { contentKey: key, recordId: getId(representative),
        recordIds: records.map(getId).sort(compare), playbackRecordIds: eligible.map(getId),
        title: String(representative.title || ''), url: representative.url, site: key.split(':')[0],
        favorite: pref.favorite === true, observedPlayCount, playCountBaseline: baseline,
        legacyEvidence: evidence ? clone(evidence) : { playCountBaseline: baseline },
        manualPlayCountAfterBaseline: manual, preferenceEvidenceCount: baseline + manual,
        retainedHistoryCount: history.length, history1000: history.length,
        recent7: recent(7).length, recent30: recent(30).length, manualRecent30,
        effectiveLastPlayedDate: last, daysSinceLastPlay: last === null ? null : refDay - dayIndex(last),
        sequenceConfidenceMultiplier: q,
        confirmedFamilyIds: Array.from(familyMap.get(key) || []).sort(compare),
        confirmedTags: Array.from(new Set([].concat(...records.map(r =>
          Array.isArray(r.confirmedTags) ? r.confirmedTags : [])))).sort(compare) };
      if (v.observedPlayCount === 0 && (last !== null || history.length)) diag('zeroCountWithRecords', key);
      v.bucket = classifyCandidate(v, config);
      Object.assign(v, scoreCandidate(v, v.bucket, config));
      candidates.push(v);
    });
    observedDates.sort(compare);
    diagnostics.sort((a, b) => compare(a.code, b.code) || compare(a.contentKey, b.contentKey) || compare(a.detail, b.detail));
    return { candidates, diagnostics, referenceTime, timezone, asOfDate,
      request: { scope: clone(input.scope || { type: 'library' }),
        currentContentKey: input.currentContentKey || null,
        excludedContentKeys: Array.from(excluded).sort(compare),
        excludedTags,
        excludedFolders,
        sessionRecentContentKeys: config.recency.sessionAvoidLast ? (input.sessionRecentContentKeys || []).slice(-config.recency.sessionAvoidLast) : [] },
      observation: { retainedCount: (input.history || []).length, validCount: validHistoryCount,
        retentionLimit: input.historyLimit || null, oldestDate: observedDates[0] || null,
        newestDate: observedDates[observedDates.length - 1] || null, completeness: 'unknown',
        leftTruncated7: !observedDates.length || dayIndex(observedDates[0]) > refDay - 6,
        leftTruncated30: !observedDates.length || dayIndex(observedDates[0]) > refDay - 29 } };
  }
  function allowed(v, level, config, session) {
    if (level === 0 && session.has(v.contentKey)) return false;
    if (v.daysSinceLastPlay === null || config.recency.avoidDays === 0) return true;
    if (level < 2) return v.daysSinceLastPlay >= config.recency.avoidDays;
    if (level === 2) return v.daysSinceLastPlay > 0;
    return true;
  }
  function buildRecommendationSections(prepared, request, patch) {
    const config = validateConfig(patch), limit = config.recommendationSectionLimit;
    const session = new Set(prepared.request.sessionRecentContentKeys || []);
    const sections = { core: [], rediscovery: [], discovery: [], recent: [],
      observation: clone(prepared.observation), diagnostics: clone(prepared.diagnostics) };
    const candidates = prepared.candidates.slice();
    BUCKETS.forEach(k => {
      sections[k] = candidates.filter(v => v.bucket === k && allowed(v, 0, config, session))
        .sort((a, b) => b.weight - a.weight || compare(a.contentKey, b.contentKey)).slice(0, limit).map(clone);
    });
    sections.recent = candidates.filter(v => v.recent7 > 0)
      .sort((a, b) => b.recent7 - a.recent7 || compare(a.contentKey, b.contentKey)).slice(0, limit).map(v => {
        const item = clone(v);
        item.reasonCodes = ['recentObserved'];
        item.reasons = ['保持履歴の直近7日で' + v.recent7 + '回'];
        return item;
      });
    return sections;
  }
  function rng(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6D2B79F5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), state | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (t ^ (t >>> 14)) >>> 0;
    };
  }
  function allocateQuota(length, profile) {
    const quota = {}, remainders = [];
    BUCKETS.forEach((k, i) => {
      const raw = profile[k] * length / 20;
      quota[k] = Math.floor(raw); remainders.push({ k, rem: raw - quota[k], i });
    });
    remainders.sort((a, b) => b.rem - a.rem || a.i - b.i);
    let n = length - BUCKETS.reduce((sum, k) => sum + quota[k], 0);
    for (let i = 0; i < n; i++) quota[remainders[i].k]++;
    return quota;
  }
  function buildQueue(prepared, request, patch) {
    const config = validateConfig(patch);
    request = request || {};
    const mode = request.mode || config.defaultMode, profile = mode === 'uniformRandom' ? null : request.profile || config.defaultProfile;
    const length = request.length !== undefined ? request.length :
      request.requestedLength !== undefined ? request.requestedLength : config.defaultQueueLength;
    if (!['smartRandom', 'uniformRandom'].includes(mode) || mode === 'smartRandom' && !config.profiles[profile])
      throw new RangeError('Invalid queue mode/profile');
    if (!Number.isSafeInteger(length) || length < 1 || length > config.maxQueueLength) throw new RangeError('Invalid queue length');
    if (!Number.isInteger(request.seed) || request.seed < 0 || request.seed > 0xffffffff) throw new RangeError('uint32 seed required');
    const operation = request.operation || 'replace', base = request.baseQueue;
    if (!['replace', 'append'].includes(operation)) throw new RangeError('Invalid queue operation');
    if (operation === 'append' && (!base || base.mode !== mode ||
        !Array.isArray(base.items) || base.items.length + length > config.maxQueueLength))
      throw new RangeError('Append requires same-mode queue within configured limit');
    const baseKeys = new Set(operation === 'append' ? base.items.map(v => v.contentKey) : []);
    const remaining = prepared.candidates.filter(v => !baseKeys.has(v.contentKey))
      .map(v => Object.assign({}, clone(v), { weight: mode === 'uniformRandom' ? 1 : v.weight }))
      .sort((a, b) => compare(a.contentKey, b.contentKey));
    const requestedQuota = mode === 'smartRandom' ? allocateQuota(length, config.profiles[profile]) : null;
    const filled = { core: 0, rediscovery: 0, discovery: 0 }, picked = [];
    const session = new Set(config.recency.sessionAvoidLast ? prepared.request.sessionRecentContentKeys : []);
    const random = rng(request.seed), diagnostics = clone(prepared.diagnostics);
    function draw(list, target, level) {
      if (!list.length) return false;
      const total = list.reduce((sum, v) => sum + v.weight, 0), unit = random() / 4294967296, r = unit * total;
      let sum = 0, chosen = null;
      for (const v of list) { sum += v.weight; if (sum > r) { chosen = v; break; } }
      if (!chosen) { chosen = list[list.length - 1]; diagnostics.push({ code: 'weightEndpointFallback' }); }
      remaining.splice(remaining.findIndex(v => v.contentKey === chosen.contentKey), 1);
      picked.push(Object.assign(chosen, { originBucket: chosen.bucket, requestedBucket: target,
        drawIndex: picked.length, relaxationLevel: level, totalWeight: total, randomValue: unit }));
      if (target) filled[target]++;
      return true;
    }
    function pool(bucket, level) {
      return remaining.filter(v => (!bucket || v.bucket === bucket) && allowed(v, level, config, session));
    }
    for (let level = 0; level < 4 && picked.length < length; level++) {
      if (mode === 'uniformRandom') {
        let list = pool(null, level);
        while (picked.length < length && draw(list, null, level)) list = pool(null, level);
      } else {
        for (const k of BUCKETS) {
          while (filled[k] < requestedQuota[k] && draw(pool(k, level), k, level)) {}
        }
        for (const target of BUCKETS) {
          for (const origin of ALL_BUCKETS) {
            while (filled[target] < requestedQuota[target] && draw(pool(origin, level), target, level)) {}
          }
        }
      }
    }
    if (picked.some(v => v.relaxationLevel > 0)) diagnostics.push({ code: 'recentAvoidanceRelaxed',
      level: Math.max(...picked.map(v => v.relaxationLevel)) });
    if (picked.some(v => v.requestedBucket && v.requestedBucket !== v.originBucket)) diagnostics.push({ code: 'quotaAdjusted' });
    if (picked.length < length) diagnostics.push({ code: 'insufficientCandidates', requested: length, actual: picked.length });
    const orderingRng = rng((request.seed ^ 0x9E3779B9) >>> 0);
    const ordering = picked.slice().sort((a, b) => compare(a.contentKey, b.contentKey))
      .map(v => Object.assign(v, { orderingKey: orderingRng() }))
      .sort((a, b) => a.orderingKey - b.orderingKey || compare(a.contentKey, b.contentKey));
    const items = [], boundary = operation === 'append' && base.items.length ? base.items[base.items.length - 1] : null;
    let previous = boundary;
    while (ordering.length) {
      let i = 0;
      if (config.diversity.avoidConfirmedFamilyAdjacent && previous) {
        i = ordering.findIndex(v => !(v.confirmedFamilyIds || []).some(id => (previous.confirmedFamilyIds || []).includes(id)));
        if (i < 0) { i = 0; diagnostics.push({ code: 'familyAdjacencyRelaxed', index: items.length }); }
      }
      const v = ordering.splice(i, 1)[0];
      Object.assign(v, { orderIndex: items.length, originQueueId: request.queueId || null, originMode: mode,
        originProfile: profile, originEngineVersion: VERSION, originConfigVersion: config.configVersion });
      if (v.requestedBucket && v.requestedBucket !== v.originBucket) {
        v.reasonCodes.push('quotaFill'); v.reasons.push('候補不足のため別枠から補充');
      }
      items.push(v); previous = v;
    }
    const actualCounts = { core: 0, rediscovery: 0, discovery: 0, overflow: 0 };
    items.forEach(v => actualCounts[v.originBucket]++);
    const inputSnapshot = {
      candidates: prepared.candidates.slice().sort((a, b) => compare(a.contentKey, b.contentKey)),
      observation: prepared.observation, request: prepared.request,
      referenceTime: prepared.referenceTime, timezone: prepared.timezone, mode, profile,
      requestedLength: length, operation, config,
      append: operation === 'append' ? { queueId: base.queueId, queueRevision: base.queueRevision,
        contentKeys: Array.from(baseKeys).sort(compare), boundary: boundary ? {
          contentKey: boundary.contentKey, confirmedFamilyIds: boundary.confirmedFamilyIds || [] } : null } : null
    };
    return { schemaVersion: 1, queueId: request.queueId || null, queueRevision: 1,
      engineVersion: VERSION, configVersion: config.configVersion, rngVersion: config.rngVersion,
      mode, profile, referenceTime: prepared.referenceTime, timezone: prepared.timezone, seed: request.seed,
      operation, scope: clone(prepared.request.scope), excludedTags: clone(prepared.request.excludedTags || []),
      excludedFolders: clone(prepared.request.excludedFolders || []), requestedLength: length, actualLength: items.length,
      requestedQuota, actualCounts, items, configSnapshot: config, observation: clone(prepared.observation),
      inputSnapshotHash: sha256(stableStringify(inputSnapshot)), inputSnapshot,
      emptyReason: !items.length ? '条件に合う動画がありません' : null, diagnostics };
  }
  function stableStringify(value) {
    if (value === undefined) return 'null';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    return '{' + Object.keys(value).filter(k => value[k] !== undefined).sort(compare)
      .map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
  }
  // SHA-256 over UTF-8, synchronous so the calculation API works in MV3 workers and Node.
  function sha256(text) {
    const bytes = new TextEncoder().encode(text), length = bytes.length;
    const paddedLength = Math.ceil((length + 9) / 64) * 64, data = new Uint8Array(paddedLength);
    data.set(bytes); data[length] = 0x80;
    const view = new DataView(data.buffer), bitLength = length * 8;
    view.setUint32(paddedLength - 8, Math.floor(bitLength / 4294967296), false);
    view.setUint32(paddedLength - 4, bitLength >>> 0, false);
    const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const w = new Uint32Array(64), rotate = (n, count) => (n >>> count) | (n << (32 - count));
    for (let offset = 0; offset < paddedLength; offset += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const s0 = rotate(w[i-15],7) ^ rotate(w[i-15],18) ^ (w[i-15] >>> 3);
        const s1 = rotate(w[i-2],17) ^ rotate(w[i-2],19) ^ (w[i-2] >>> 10);
        w[i] = (w[i-16] + s0 + w[i-7] + s1) >>> 0;
      }
      let [a,b,c,d,e,f,g,j] = h;
      for (let i = 0; i < 64; i++) {
        const s1 = rotate(e,6) ^ rotate(e,11) ^ rotate(e,25), ch = (e & f) ^ (~e & g);
        const t1 = (j + s1 + ch + k[i] + w[i]) >>> 0;
        const s0 = rotate(a,2) ^ rotate(a,13) ^ rotate(a,22), maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (s0 + maj) >>> 0;
        j=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
      }
      [a,b,c,d,e,f,g,j].forEach((v,i) => { h[i] = (h[i] + v) >>> 0; });
    }
    return h.map(v => v.toString(16).padStart(8,'0')).join('');
  }
  return Object.freeze({ VERSION, DEFAULT_CONFIG, normalizeContentKey, normalizeExcludedTags, normalizeExcludedFolders, validateConfig, prepareCandidates,
    classifyCandidate: (v, c) => classifyCandidate(v, validateConfig(c)),
    scoreCandidate: (v, bucket, c) => scoreCandidate(v, bucket, validateConfig(c)),
    buildRecommendationSections, buildQueue, allocateQuota, stableStringify, sha256 });
});

