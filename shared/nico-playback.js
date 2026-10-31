/* Pure helpers shared by the player and regression tests. */
(function (root) {
  'use strict';
  function videoId(value) {
    try {
      const url = new URL(String(value));
      if (!['https:', 'http:'].includes(url.protocol)) return '';
      if (!['nicovideo.jp', 'www.nicovideo.jp', 'embed.nicovideo.jp', 'nico.ms'].includes(url.hostname)) return '';
      return url.pathname.split('/').filter(Boolean).find(part => /^(?:sm|nm|so)\d+$/.test(part)) || '';
    } catch (_) { return /^(?:sm|nm|so)\d+$/.test(String(value)) ? String(value) : ''; }
  }
  function messageMatches(event, frame) {
    return Boolean(frame?.contentWindow && event.source === frame.contentWindow && event.origin === 'https://embed.nicovideo.jp'
      && event.data && typeof event.data === 'object' && typeof event.data.eventName === 'string'
      && (event.data.playerId == null || String(event.data.playerId) === '1'));
  }
  function errorDetails(value) {
    // Do not share raw provider responses, request URLs or arbitrary payload fields.
    if (typeof value === 'string') return { code: '', message: value.slice(0, 400) };
    if (!value || typeof value !== 'object') return { code: '', message: '' };
    return {
      code: ['string', 'number'].includes(typeof value.code) ? String(value.code).slice(0, 80) : '',
      message: typeof value.message === 'string' ? value.message.slice(0, 320) : ''
    };
  }
  function errorText(value) {
    const details = errorDetails(value);
    return [details.code, details.message].filter(Boolean).join('：').slice(0, 400) || '詳しいエラー情報はありません';
  }
  const api = Object.freeze({ videoId, messageMatches, errorDetails, errorText });
  if (typeof module !== 'undefined') module.exports = api;
  root.CmsNicoPlayback = api;
})(typeof window === 'undefined' ? globalThis : window);
