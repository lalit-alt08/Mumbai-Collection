import { useState, useEffect, useRef, useCallback } from "react";
import { armOrderAlarm } from "../utils/orderNotification.js";

/**
 * Screen Wake Lock Hook for Shop Counter Mode.
 * Keeps the screen awake when staff is actively working at the counter.
 * Automatically re-acquires the lock when returning to foreground.
 */
export function useWakeLock() {
  const isSupported = typeof navigator !== "undefined" && "wakeLock" in navigator;

  const [isEnabled, setIsEnabled] = useState(() => {
    try {
      return localStorage.getItem("mumbai_counter_mode") === "true";
    } catch {
      return false;
    }
  });

  const [isLocked, setIsLocked] = useState(false);
  const sentinelRef = useRef(null);
  const requestRef = useRef(null);
  const enabledRef = useRef(isEnabled);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);

  const requestLock = useCallback(async () => {
    if (!isSupported || !enabledRef.current || sentinelRef.current) return;
    if (requestRef.current) return requestRef.current;
    const generation = generationRef.current;
    const request = (async () => {
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (!mountedRef.current || !enabledRef.current || generation !== generationRef.current) {
          await sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
        setIsLocked(true);
        sentinel.addEventListener("release", () => {
          if (sentinelRef.current !== sentinel) return;
          sentinelRef.current = null;
          if (mountedRef.current) setIsLocked(false);
        });
      } catch (_) {
        if (mountedRef.current && generation === generationRef.current) setIsLocked(false);
      }
    })();
    requestRef.current = request;
    try { await request; } finally {
      if (requestRef.current === request) requestRef.current = null;
    }
    if (mountedRef.current && enabledRef.current && generation !== generationRef.current && !sentinelRef.current) {
      await requestLock();
    }
  }, [isSupported]);

  const releaseLock = useCallback(async () => {
    generationRef.current += 1;
    const sentinel = sentinelRef.current;
    sentinelRef.current = null;
    if (sentinel) {
      try {
        await sentinel.release();
      } catch (_) {}
    }
    if (mountedRef.current) setIsLocked(false);
  }, []);

  // Synchronize lock state with isEnabled
  useEffect(() => {
    enabledRef.current = isEnabled;
    if (isEnabled) {
      requestLock();
    } else {
      releaseLock();
    }
  }, [isEnabled, requestLock, releaseLock]);

  // Re-acquire lock when phone screen/tab returns to foreground
  useEffect(() => {
    if (!isSupported) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && isEnabled && !sentinelRef.current) {
        requestLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isSupported, isEnabled, requestLock]);

  // Clean up on component unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      if (sentinelRef.current) {
        sentinelRef.current.release().catch(() => {});
        sentinelRef.current = null;
      }
    };
  }, []);

  const toggleCounterMode = useCallback(async () => {
    const nextState = !isEnabled;
    enabledRef.current = nextState;
    setIsEnabled(nextState);

    try {
      localStorage.setItem("mumbai_counter_mode", String(nextState));
    } catch (_) {}

    if (nextState) {
      // User gesture: silently arm the audio alert pipeline without unprompted sound
      await armOrderAlarm({ playTestSound: false });
      await requestLock();
    } else {
      await releaseLock();
    }
  }, [isEnabled, requestLock, releaseLock]);

  return {
    isSupported,
    isEnabled,
    isLocked,
    toggleCounterMode,
    requestLock,
    releaseLock,
  };
}
