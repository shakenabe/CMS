export const IOS_HOSTED_WEB_URL = 'https://cms-sync-test.firebaseapp.com/web/';

export function isIosWebKit(navigatorLike = globalThis.navigator) {
  const userAgent = navigatorLike?.userAgent || '';
  return /iPad|iPhone|iPod/i.test(userAgent)
    || (navigatorLike?.platform === 'MacIntel' && Number(navigatorLike?.maxTouchPoints) > 1);
}

export function isFirebaseHostedWeb(locationLike = globalThis.location) {
  return locationLike?.hostname === 'cms-sync-test.firebaseapp.com'
    && (locationLike?.pathname === '/web' || locationLike?.pathname?.startsWith('/web/'));
}

export function createIosHostedLoginUrl() {
  const url = new URL(IOS_HOSTED_WEB_URL);
  url.searchParams.set('iosAuth', '1');
  return url.href;
}
