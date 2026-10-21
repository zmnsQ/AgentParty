import { useCallback, useEffect, useRef, useState } from 'react';
import { setBrowserToken } from './api';
import { browserAuthRequest, type BrowserSessionState } from './browserAuth';
export function useBrowserAuth(enabled: boolean, onToken: (token: string | null, account: string | null) => void) {
  const [state, setState] = useState<BrowserSessionState>({ configured: false, status: 'signed_out' });
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<unknown>(null);
  const onTokenRef = useRef(onToken); onTokenRef.current = onToken;
  const enabledRef = useRef(enabled); enabledRef.current = enabled;
  const revision = useRef(0);
  const hadSession = useRef(false);
  const flight = useRef<{ revision: number; promise: Promise<BrowserSessionState> } | null>(null);
  const lastRefresh = useRef(0);
  const refresh = useCallback((): Promise<BrowserSessionState> => {
    if (!enabledRef.current) return Promise.reject(new Error('browser_auth_disabled'));
    const rev = revision.current;
    if (flight.current?.revision === rev) return flight.current.promise;
    const promise = browserAuthRequest<BrowserSessionState>('/session').then(next => {
      if (revision.current !== rev || !enabledRef.current) return next;
      lastRefresh.current = Date.now(); setState(next); setLoading(false); setError(null);
      if (next.status === 'authenticated' && next.access_token && next.account) {
        hadSession.current = true; setBrowserToken(next.access_token); onTokenRef.current(next.access_token, next.account);
      } else if (hadSession.current || next.status === 'mfa_required') {
        hadSession.current = false; setBrowserToken(null); onTokenRef.current(null, null);
      }
      return next;
    }).catch(e => {
      if (revision.current === rev) { setLoading(false); setError(e); }
      throw e;
    }).finally(() => { if (flight.current?.promise === promise) flight.current = null; });
    flight.current = { revision: rev, promise }; return promise;
  }, []);
  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    void refresh().catch(() => {});
    const focus = () => { if (Date.now() - lastRefresh.current >= 30_000) void refresh().catch(() => {}); };
    const forced = () => { void refresh().catch(() => {}); };
    const timer = window.setInterval(forced, 8 * 60_000);
    window.addEventListener('focus', focus); window.addEventListener('commons-auth-refresh', forced);
    return () => { revision.current++; window.clearInterval(timer); window.removeEventListener('focus', focus); window.removeEventListener('commons-auth-refresh', forced); };
  }, [enabled, refresh]);
  const logout = useCallback(async () => {
    await browserAuthRequest('/logout', {});
    revision.current++; hadSession.current = false; setBrowserToken(null);
    setState(v => ({ configured: v.configured, status: 'signed_out' })); onTokenRef.current(null, null);
  }, []);
  return { ...state, loading, error, refresh, logout };
}
