const LOCAL_CONFIG_ENDPOINT = '/remote-api/local-firebase-config';
const LOCAL_ORIGINS = new Set(['http://127.0.0.1:17865', 'http://localhost:17865']);
const API_KEY_FORMAT = /^AIza[A-Za-z0-9_-]{35}$/;

export function isLocalFirebaseOrigin(locationLike = globalThis.location) {
  return LOCAL_ORIGINS.has(locationLike?.origin);
}

export function validateLocalFirebaseConfig(candidate, defaults) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  if (candidate.projectId !== defaults.projectId || candidate.appId !== defaults.appId) return null;
  if (candidate.authDomain !== undefined && candidate.authDomain !== defaults.authDomain) return null;
  if (typeof candidate.apiKey !== 'string' || candidate.apiKey.length !== 39 || !API_KEY_FORMAT.test(candidate.apiKey)) return null;
  // A local override may replace only the key, never the project, app, or data destination.
  return Object.freeze({ ...defaults, apiKey: candidate.apiKey });
}

export async function resolveFirebaseConfig(defaults, {
  locationLike = globalThis.location,
  fetchImpl = globalThis.fetch,
  timeoutMs = 3000
} = {}) {
  if (!isLocalFirebaseOrigin(locationLike)) return { config: defaults, local: false, status: 'public' };
  const fallback = status => ({ config: defaults, local: true, status });
  if (typeof fetchImpl !== 'function') return fallback('unavailable');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(LOCAL_CONFIG_ENDPOINT, {
      method: 'GET', cache: 'no-store', credentials: 'same-origin',
      mode: 'same-origin', redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    if (response.status === 404 || response.status === 503) return fallback('missing');
    if (!response.ok) return fallback('unavailable');
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') || '')) return fallback('invalid');
    const candidate = await response.json();
    if (candidate?.configured === false) return fallback('missing');
    const config = validateLocalFirebaseConfig(candidate, defaults);
    return config ? { config, local: true, status: 'ready' } : fallback('invalid');
  } catch (_) {
    return fallback('unavailable');
  } finally {
    clearTimeout(timer);
  }
}

export function localFirebaseReadinessError(state) {
  if (!state?.local || state.status === 'ready') return null;
  const error = new Error('ローカル専用Firebase設定を確認してください。');
  error.code = state.status === 'invalid' ? 'auth/local-config-invalid' : 'auth/local-config-missing';
  return error;
}

export function firebaseAuthErrorMessage(error, locationLike = globalThis.location) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (code === 'auth/local-config-missing') {
    return 'Firebase: 未接続（ローカル専用の接続設定が未準備です）。PCのローカルFirebase設定を保存して、画面を再読み込みしてください。';
  }
  if (code === 'auth/local-config-invalid') {
    return 'Firebase設定エラー: ローカル専用設定が既存CMSと一致しません。同じFirebaseプロジェクトとWebアプリの設定を確認して、画面を再読み込みしてください。';
  }
  const refererBlocked = /^auth\/requests-from-referer-/i.test(code)
    || /Requests from referer .{0,2048} are blocked/i.test(String(error?.message || '').slice(0,4096));
  if (!refererBlocked) return '';
  if (isLocalFirebaseOrigin(locationLike)) {
    return 'Firebase認証エラー: ローカルURLがAPIキーの参照元制限で拒否されました。ローカル専用キーで http://127.0.0.1:17865/* と http://localhost:17865/* を許可し、PC設定を保存して画面を再読み込みしてください。';
  }
  return 'Firebase認証エラー: このサイトがAPIキーの参照元制限で拒否されました。Google CloudのWeb用APIキーで、このサイトのHTTP参照元設定を確認してください。';
}

export function safeFirebaseErrorLabel(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  return /^(?:auth\/)?[a-z][a-z0-9-]{0,79}$/.test(code) ? code : '接続に失敗しました。もう一度お試しください。';
}
