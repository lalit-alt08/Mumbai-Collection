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

  const requestLock = useCallback(async () => {
    if (!isSupported || sentinelRef.current) return;

    try {
      const sentinel = await navigator.wakeLock.request("screen");
      sentinelRef.current = sentinel;
      setIsLocked(true);

      sentinel.addEventListener("release", () => {
        sentinelRef.current = null;
        setIsLocked(false);
      });
    } catch (err) {
      // System or device policy prevented wake lock
      sentinelRef.current = null;
      setIsLocked(false);
    }
  }, [isSupported]);

  const releaseLock = useCallback(async () => {
    if (sentinelRef.current) {
      try {
        await sentinelRef.current.release();
      } catch (_) {}
      sentinelRef.current = null;
    }
    setIsLocked(false);
  }, []);

  // Synchronize lock state with isEnabled
  useEffect(() => {
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
    return () => {
      if (sentinelRef.current) {
        sentinelRef.current.release().catch(() => {});
        sentinelRef.current = null;
      }
    };
  }, []);

  const toggleCounterMode = useCallback(async () => {
    const nextState = !isEnabled;
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
