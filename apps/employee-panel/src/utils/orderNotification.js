// Web Audio API & Notification Alert Controller for Counter Phone / Tablet
let audioCtx = null;
const unacknowledgedOrderIds = new Set();
const notifiedOrderIds = new Set();
let alarmIntervalId = null;
const subscribers = new Set();

const notifySubscribers = () => {
  const state = {
    unacknowledgedOrders: Array.from(unacknowledgedOrderIds),
    isAlarming: unacknowledgedOrderIds.size > 0,
    isArmed: isAudioArmed(),
  };
  for (const sub of subscribers) {
    try {
      sub(state);
    } catch (_) {}
  }
};

/**
 * Checks if the AudioContext is initialized and in running state.
 */
export const isAudioArmed = () => {
  return Boolean(audioCtx && audioCtx.state === "running");
};

/**
 * Shared AudioContext accessor.
 */
const getAudioContext = () => {
  if (typeof window === "undefined") return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioCtx) {
    audioCtx = new AudioContextClass();
  }
  return audioCtx;
};

/**
 * Explicit user-gesture arming for mobile browsers (iOS Safari, Android Chrome).
 * Resumes or creates the shared AudioContext, plays a silent 1-sample buffer to satisfy
 * mobile autoplay policy, and requests Notification permission from the same gesture.
 */
export const armOrderAlarm = async () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return { armed: false, state: "unsupported" };

    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    // Play an imperceptible 1-sample silent buffer to unlock the audio pipeline
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);

    // Request notification permission during the same user interaction
    let notificationPermission = "unsupported";
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        notificationPermission = await Notification.requestPermission();
      } else {
        notificationPermission = Notification.permission;
      }

      // If granted, seamlessly register for background Web Push alerts
      if (notificationPermission === "granted") {
        import("./pushSubscription.js")
          .then(({ registerPushNotificationService }) => {
            registerPushNotificationService().catch(() => {});
          })
          .catch(() => {});
      }
    }

    try {
      localStorage.setItem("mumbai_audio_alerts_armed", "true");
    } catch (_) {}

    notifySubscribers();
    return {
      armed: ctx.state === "running",
      state: ctx.state,
      permission: notificationPermission,
    };
  } catch (err) {
    return { armed: false, error: err?.message || String(err) };
  }
};

/**
 * Synthesizes a loud, crisp, urgent 2-tone alarm chime (880 Hz -> 1174 Hz)
 * purely via Web Audio API without requiring external audio assets.
 */
export const playOrderAlertChime = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx || ctx.state !== "running") return;

    const now = ctx.currentTime;

    // Tone 1: 880 Hz (A5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(880, now);
    gain1.gain.setValueAtTime(0.45, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.28);

    // Tone 2: 1174.66 Hz (D6)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(1174.66, now + 0.14);
    gain2.gain.setValueAtTime(0.55, now + 0.14);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.14);
    osc2.stop(now + 0.55);
  } catch {
    // Autoplay or audio graph error gracefully caught
  }
};

/**
 * Triggers alert for a newly received order.
 * Maintains session-level deduplication and starts the repeating alarm loop.
 *
 * @param {Object} params
 * @param {number|string} params.orderId
 */
export const triggerNewOrderNotification = ({ orderId } = {}) => {
  const cleanId = Number(orderId);
  if (!cleanId) return;

  // Session-level deduplication: avoid re-sounding for an already notified order
  if (notifiedOrderIds.has(cleanId)) return;

  notifiedOrderIds.add(cleanId);
  unacknowledgedOrderIds.add(cleanId);

  // Play immediate audio chime
  playOrderAlertChime();

  // Start continuous siren loop every 2.5s if not already running
  if (!alarmIntervalId) {
    alarmIntervalId = setInterval(() => {
      if (unacknowledgedOrderIds.size > 0) {
        playOrderAlertChime();
      } else {
        clearInterval(alarmIntervalId);
        alarmIntervalId = null;
      }
    }, 2500);
  }

  // System notification if permission is granted
  try {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      new Notification(`🚨 New Order #${cleanId} Received!`, {
        body: "New store order requires fulfillment. Tap to view and pack.",
        icon: "/favicon.svg",
        tag: `new-order-${cleanId}`,
        requireInteraction: true,
      });
    }
  } catch (_) {}

  notifySubscribers();
};

/**
 * Acknowledges a specific order, removing it from unacknowledged set.
 * If all orders are acknowledged, stops the siren loop.
 */
export const acknowledgeOrderAlarm = (orderId) => {
  const cleanId = Number(orderId);
  if (cleanId) {
    unacknowledgedOrderIds.delete(cleanId);
  }

  if (unacknowledgedOrderIds.size === 0 && alarmIntervalId) {
    clearInterval(alarmIntervalId);
    alarmIntervalId = null;
  }

  notifySubscribers();
};

/**
 * Restores an order alarm when backend acknowledgement fails.
 * Re-adds the order to the unacknowledged set and resumes the audible siren.
 */
export const restoreOrderAlarm = (orderId) => {
  const cleanId = Number(orderId);
  if (cleanId) {
    unacknowledgedOrderIds.add(cleanId);
  }

  if (!alarmIntervalId && unacknowledgedOrderIds.size > 0) {
    playOrderAlertChime();
    alarmIntervalId = setInterval(() => {
      if (unacknowledgedOrderIds.size > 0) {
        playOrderAlertChime();
      } else {
        clearInterval(alarmIntervalId);
        alarmIntervalId = null;
      }
    }, 2500);
  }

  notifySubscribers();
};

/**
 * Restores multiple order alarms in batch on acknowledgement failure.
 */
export const restoreOrderAlarms = (orderIds = []) => {
  for (const id of orderIds) {
    const cleanId = Number(id);
    if (cleanId) {
      unacknowledgedOrderIds.add(cleanId);
    }
  }

  if (!alarmIntervalId && unacknowledgedOrderIds.size > 0) {
    playOrderAlertChime();
    alarmIntervalId = setInterval(() => {
      if (unacknowledgedOrderIds.size > 0) {
        playOrderAlertChime();
      } else {
        clearInterval(alarmIntervalId);
        alarmIntervalId = null;
      }
    }, 2500);
  }

  notifySubscribers();
};

/**
 * Mutes all active order alarms and stops the siren.
 */
export const muteAllOrderAlarms = () => {
  unacknowledgedOrderIds.clear();
  if (alarmIntervalId) {
    clearInterval(alarmIntervalId);
    alarmIntervalId = null;
  }
  notifySubscribers();
};

/**
 * Returns array of currently unacknowledged order IDs.
 */
export const getUnacknowledgedOrders = () => Array.from(unacknowledgedOrderIds);

/**
 * Subscribe a React component or hook to alarm state changes.
 */
export const subscribeToAlarmState = (callback) => {
  subscribers.add(callback);
  callback({
    unacknowledgedOrders: Array.from(unacknowledgedOrderIds),
    isAlarming: unacknowledgedOrderIds.size > 0,
    isArmed: isAudioArmed(),
  });
  return () => {
    subscribers.delete(callback);
  };
};

/**
 * Legacy compatibility alias for existing callers.
 */
export const requestNotificationPermission = async () => {
  return (await armOrderAlarm()).permission;
};
