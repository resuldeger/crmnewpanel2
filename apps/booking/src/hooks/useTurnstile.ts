import { useState, useEffect, useRef, useCallback } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string;
          action?: string;
          cData?: string;
          callback?: (token: string) => void;
          'error-callback'?: (errorCode: string) => void;
          'expired-callback'?: () => void;
          theme?: 'auto' | 'light' | 'dark';
          size?: 'normal' | 'compact' | 'invisible' | 'flexible';
          appearance?: 'always' | 'execute' | 'interaction-only';
          'refresh-expired'?: 'auto' | 'manual' | 'never';
          'refresh-timeout'?: 'auto' | 'manual' | 'never';
        }
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
      getResponse: (widgetId?: string) => string | undefined;
    };
  }
}

const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Loads the Turnstile script once, and only when a site key exists. */
function ensureTurnstileScript(): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector(`script[src="${TURNSTILE_SRC}"]`)) return;
  const el = document.createElement('script');
  el.src = TURNSTILE_SRC;
  el.async = true;
  el.defer = true;
  document.head.appendChild(el);
}

/**
 * @param siteKey Cloudflare Turnstile key for this studio, from
 *   /api/booking/config. Previously the key was read from a Blade-injected
 *   global with a production key hardcoded in the source as a fallback —
 *   so the bundle shipped a live credential and the widget silently used
 *   the wrong key whenever the global was missing. Pass null to disable
 *   the challenge (local development).
 */
export function useTurnstile(siteKey: string | null | undefined) {
  const [token, setToken] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const containerNodeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (siteKey) ensureTurnstileScript();
  }, [siteKey]);

  const updateToken = (newToken: string | null) => {
    tokenRef.current = newToken;
    setToken(newToken);
  };

  const renderWidget = useCallback((container: HTMLElement) => {
    if (!siteKey || !window.turnstile || widgetIdRef.current) {
      return;
    }

    try {
      const id = window.turnstile.render(container, {
        sitekey: siteKey,
        theme: 'dark',
        size: 'flexible',
        'refresh-expired': 'auto',
        'refresh-timeout': 'auto',
        callback: (newToken: string) => {
          updateToken(newToken);
        },
        'expired-callback': () => {
          updateToken(null);
          if (widgetIdRef.current && window.turnstile) {
            try {
              window.turnstile.reset(widgetIdRef.current);
            } catch {}
          }
        },
        'error-callback': (errCode) => {
          console.warn('Turnstile error:', errCode);
        },
      });
      widgetIdRef.current = id;
    } catch (e) {
      console.warn('Turnstile render failed:', e);
    }
  }, [siteKey]);

  // Callback ref so whenever the container mounts on FormStep.CONTACT, it initializes Turnstile
  const turnstileContainerRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      containerNodeRef.current = node;
      if (window.turnstile) {
        renderWidget(node);
      }
    } else {
      // Retain tokenRef across step unmounts so moving forward doesn't erase resolved token
      containerNodeRef.current = null;
    }
  }, [renderWidget]);

  // Fallback poller if the turnstile script loads after the DOM container is already rendered
  useEffect(() => {
    if (widgetIdRef.current) return;

    const checkAndRender = () => {
      if (window.turnstile && containerNodeRef.current && !widgetIdRef.current) {
        renderWidget(containerNodeRef.current);
        return true;
      }
      return false;
    };

    if (checkAndRender()) return;

    const interval = setInterval(() => {
      if (checkAndRender()) {
        clearInterval(interval);
      }
    }, 250);

    const timeout = setTimeout(() => clearInterval(interval), 10000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [renderWidget]);

  const resetTurnstile = useCallback(() => {
    updateToken(null);
    if (widgetIdRef.current && window.turnstile) {
      try {
        window.turnstile.reset(widgetIdRef.current);
      } catch {}
    }
  }, []);

  const getSafeToken = useCallback((): string | undefined => {
    if (tokenRef.current) return tokenRef.current;
    if (token) return token;
    if (widgetIdRef.current && window.turnstile?.getResponse) {
      try {
        const resp = window.turnstile.getResponse(widgetIdRef.current);
        if (resp) return resp;
      } catch {}
    }
    return undefined;
  }, [token]);

  return {
    turnstileToken: token,
    turnstileContainerRef,
    resetTurnstile,
    getSafeToken,
  };
}
