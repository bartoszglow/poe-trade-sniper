import { useCallback, useEffect, useRef, useState } from 'react';
import { translateStatic } from '../i18n/i18n';
import { ApiError, apiGet, apiSend } from '../lib/api';

interface CaptureStatus {
  state: string;
  detail: string | null;
}

const STATUS_POLL_MS = 3_000;

/** Drives the in-app PoE login (Settings card + the login overlay). */
export function useLoginCapture(onFinished: () => void) {
  const [loginState, setLoginState] = useState('idle');
  const [loginDetail, setLoginDetail] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const start = useCallback(() => {
    // Guard a fast double-click: clear any in-flight poll so we never orphan an
    // interval (the button only disables after the POST resolves) (REL-7).
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    void apiSend<CaptureStatus>('POST', '/api/session/login/start')
      .then((started) => {
        setLoginState(started.state);
        setLoginDetail(started.detail);
        pollRef.current = setInterval(() => {
          void apiGet<CaptureStatus>('/api/session/login')
            .then((current) => {
              setLoginState(current.state);
              setLoginDetail(current.detail);
              if (current.state !== 'waiting-login' && pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
                onFinished();
              }
            })
            .catch(() => {
              if (pollRef.current) clearInterval(pollRef.current);
              pollRef.current = null;
            });
        }, STATUS_POLL_MS);
      })
      .catch((error: unknown) => {
        setLoginDetail(
          error instanceof ApiError && error.userFacing
            ? error.message
            : translateStatic('login.failedToStart'),
        );
      });
  }, [onFinished]);

  const cancel = useCallback(() => {
    void apiSend('POST', '/api/session/login/cancel').then(() => setLoginState('idle'));
  }, []);

  return { loginState, loginDetail, start, cancel };
}
