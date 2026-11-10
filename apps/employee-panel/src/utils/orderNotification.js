// Web Audio API & In-Memory Voice Alert Controller for Counter Phone / Tablet
import { ORDER_ALERT_BASE64, ORDER_ALERT_DATA_URI } from "./orderAlertAudioData.js";

let audioCtx = null;
let voiceAudioBuffer = null;
let isDecodingVoice = false;
let customAudio = null;
let isVoiceArmed = false;
let voiceArmError = null;

// Playback generation token & active node tracking
let currentPlaybackToken = 0;
let activeBufferSourceNodes = [];
let activeOscillators = [];

const unacknowledgedOrderIds = new Set();
const notifiedOrderIds = new Set();
let alarmIntervalId = null;
const subscribers = new Set();

// Counter alarms are quiet overnight in the store's fixed operating window.
// Keep orders unacknowledged so they resume sounding when the store opens.
export const isOrderAlarmQuietHours = (now = new Date()) => {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const minutes = Number(values.hour) * 60 + Number(values.minute);
    return minutes >= 23 * 60 + 30 || minutes < 10 * 60;
  } catch (_) {
    return false;
  }
};

/**
 * Converts a base64 string into an ArrayBuffer for Web Audio decoding.
 */
const base64ToArrayBuffer = (base64) => {
  if (typeof window === "undefined") return new ArrayBuffer(0);
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
};

/**
 * Returns structured arming status detailing voice vs Web Audio chime availability.
 */
export const getAudioArmStatus = () => ({
  armed: Boolean(isVoiceArmed || voiceAudioBuffer || (audioCtx && audioCtx.state === "running")),
  voiceArmed: Boolean(isVoiceArmed || voiceAudioBuffer),
  chimeArmed: Boolean(audioCtx && audioCtx.state === "running"),
  voiceError: voiceArmError,
  audioCtxState: audioCtx ? audioCtx.state : "uninitialized",
});

/**
 * Checks if voice playback specifically is verified armed.
 */
export const isVoiceArmedStatus = () => Boolean(isVoiceArmed || voiceAudioBuffer);

/**
 * Checks if either voice or Web Audio synthesizer is ready.
 */
export const isAudioArmed = () => {
  return Boolean(isVoiceArmed || voiceAudioBuffer || (audioCtx && audioCtx.state === "running"));
};

const notifySubscribers = () => {
  const armStatus = getAudioArmStatus();
  const state = {
    unacknowledgedOrders: Array.from(unacknowledgedOrderIds),
    isAlarming: unacknowledgedOrderIds.size > 0,
    isArmed: armStatus.armed,
    voiceArmed: armStatus.voiceArmed,
    chimeArmed: armStatus.chimeArmed,
  };
  for (const sub of subscribers) {
    try {
      sub(state);
    } catch (_) {}
  }
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
    // Preload voice buffer in memory immediately
    getVoiceBuffer(audioCtx).catch(() => {});
  }
  return audioCtx;
};

// Seamless auto-unlock on first user interaction anywhere on the document
if (typeof window !== "undefined") {
  const autoUnlock = () => {
    const ctx = getAudioContext();
    if (ctx && ctx.state === "suspended") {
      ctx.resume().then(() => {
        getVoiceBuffer(ctx);
        notifySubscribers();
      }).catch(() => {});
    }
  };
  window.addEventListener("pointerdown", autoUnlock, { once: true, passive: true });
  window.addEventListener("touchstart", autoUnlock, { once: true, passive: true });
  window.addEventListener("keydown", autoUnlock, { once: true, passive: true });
}

/**
 * Pre-decodes the 19.2 KB custom voice MP3 directly into an AudioBuffer.
 * This guarantees instant playback without network delays, MIME type failures, or HTML5 media bugs.
 */
const getVoiceBuffer = async (ctx) => {
  if (voiceAudioBuffer) return voiceAudioBuffer;
  if (!ctx || isDecodingVoice) return null;
  isDecodingVoice = true;
  try {
    const arrayBuffer = base64ToArrayBuffer(ORDER_ALERT_BASE64);
    const decoded = await new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(arrayBuffer, resolve, reject);
      if (p && typeof p.then === "function") {
        p.then(resolve).catch(reject);
      }
    });
    voiceAudioBuffer = decoded;
    isVoiceArmed = true;
    voiceArmError = null;
    return voiceAudioBuffer;
  } catch (err) {
    voiceArmError = err?.message || String(err);
    console.warn("Failed to decode custom voice buffer:", err);
    return null;
  } finally {
    isDecodingVoice = false;
  }
};

/**
 * Accessor for the HTML5 audio element fallback using embedded data URI.
 */
const getCustomAudio = () => {
  if (typeof window === "undefined") return null;
  if (!customAudio) {
    try {
      customAudio = new Audio(ORDER_ALERT_DATA_URI);
      customAudio.preload = "auto";
      customAudio.volume = 1.0;
    } catch (_) {
      try {
        customAudio = new Audio("/order-alert.mp3");
        customAudio.preload = "auto";
        customAudio.volume = 1.0;
      } catch (_) {}
    }
  }
  return customAudio;
};

/**
 * Stops any playing sound or repeating interval, cancels pending playbacks,
 * and disconnects active voice buffer and synthesizer nodes.
 */
const stopAlarmAudio = () => {
  currentPlaybackToken++; // Invalidate any pending playback promise callbacks
  if (customAudio) {
    try {
      customAudio.pause();
      customAudio.currentTime = 0;
    } catch (_) {}
  }
  for (const s of activeBufferSourceNodes) {
    try {
      s.stop();
      s.disconnect();
    } catch (_) {}
  }
  activeBufferSourceNodes = [];
  for (const osc of activeOscillators) {
    try {
      osc.stop();
      osc.disconnect();
    } catch (_) {}
  }
  activeOscillators = [];
};

/**
 * Legacy alias for stopAlarmAudio.
 */
const stopCustomAudio = stopAlarmAudio;

/**
 * Synthesizes a loud, crisp, urgent 2-tone alarm chime (880 Hz -> 1174 Hz)
 * purely via Web Audio API without requiring external audio assets.
 */
export const playOrderAlertChime = () => {
  if (isOrderAlarmQuietHours()) {
    stopAlarmAudio();
    return;
  }
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;

    // Tone 1: 880 Hz (A5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(880, now);
    gain1.gain.setValueAtTime(0.5, now);
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
    gain2.gain.setValueAtTime(0.6, now + 0.14);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.14);
    osc2.stop(now + 0.55);

    const cleanup = () => {
      activeOscillators = activeOscillators.filter((o) => o !== osc1 && o !== osc2);
    };
    osc1.onended = cleanup;
    osc2.onended = cleanup;
    activeOscillators.push(osc1, osc2);
  } catch {
    // Autoplay or audio graph error gracefully caught
  }
};

/**
 * Plays the preloaded voice buffer via Web Audio API.
 * Returns true if playback started successfully.
 */
const playVoiceBuffer = (ctx) => {
  if (!ctx || !voiceAudioBuffer) return false;
  try {
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    const source = ctx.createBufferSource();
    const gainNode = ctx.createGain();
    source.buffer = voiceAudioBuffer;
    gainNode.gain.setValueAtTime(1.0, ctx.currentTime);
    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    const cleanup = () => {
      activeBufferSourceNodes = activeBufferSourceNodes.filter((s) => s !== source);
    };
    source.onended = cleanup;
    activeBufferSourceNodes.push(source);
    source.start(0);
    return true;
  } catch (err) {
    console.warn("Error playing custom voice buffer:", err);
    return false;
  }
};

/**
 * Plays the custom voice audio message with triple-layer redundancy:
 * 1. In-memory Web Audio Buffer (instant, sample-accurate, zero network delay)
 * 2. Embedded Data-URI HTML5 Audio Element
 * 3. Web Audio Synthesized Chime Fallback
 */
export const playOrderAlertSound = () => {
  if (isOrderAlarmQuietHours()) {
    stopAlarmAudio();
    return;
  }
  currentPlaybackToken++;
  const token = currentPlaybackToken;

  // Layer 1: In-memory Web Audio buffer of your custom voice
  const ctx = getAudioContext();
  if (ctx && voiceAudioBuffer) {
    const started = playVoiceBuffer(ctx);
    if (started) {
      isVoiceArmed = true;
      return;
    }
  }

  // If buffer is still decoding, trigger decode and play upon completion
  if (ctx && !voiceAudioBuffer) {
    getVoiceBuffer(ctx).then((buf) => {
      if (buf && token === currentPlaybackToken) {
        playVoiceBuffer(ctx);
      }
    }).catch(() => {});
  }

  // Layer 2: Embedded Data-URI HTML5 Audio fallback
  const audio = getCustomAudio();
  if (audio) {
    try {
      audio.currentTime = 0;
      audio.volume = 1.0;
      audio.muted = false;
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            isVoiceArmed = true;
          })
          .catch((err) => {
            if (token !== currentPlaybackToken) return;
            // Voice blocked; fall back to Web Audio chime
            isVoiceArmed = false;
            playOrderAlertChime();
          });
        return;
      }
    } catch (_) {
      if (token !== currentPlaybackToken) return;
      playOrderAlertChime();
      return;
    }
  }

  // Layer 3: Web Audio synthesized chime fallback
  if (token === currentPlaybackToken) {
    playOrderAlertChime();
  }
};

/**
 * Explicit user-gesture arming for mobile browsers (iOS Safari, Android Chrome).
 * Unlocks Web Audio, decodes the voice message in memory, and optionally plays
 * an audible confirmation sound so staff immediately knows sound is working.
 */
export const armOrderAlarm = async ({ playTestSound = false } = {}) => {
  const quietHours = isOrderAlarmQuietHours();
  let webAudioOk = false;
  let voiceOk = false;
  let voiceErr = null;

  try {
    const ctx = getAudioContext();
    if (ctx) {
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      const buf = await getVoiceBuffer(ctx);
      if (buf) {
        voiceOk = true;
        isVoiceArmed = true;
      }
      webAudioOk = ctx.state === "running";
    }
  } catch (err) {
    voiceErr = err?.message || String(err);
    console.warn("Web Audio priming failed:", err);
  }

  // Also prime HTML5 Audio element
  const audio = getCustomAudio();
  if (audio) {
    try {
      audio.volume = quietHours ? 0 : 1.0;
      audio.muted = false;
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        await playPromise;
        if (!playTestSound || quietHours) {
          audio.pause();
          audio.currentTime = 0;
        }
        audio.volume = 1.0;
        voiceOk = true;
        isVoiceArmed = true;
      }
    } catch (err) {
      if (!voiceOk && err?.name !== "AbortError") {
        voiceErr = err?.message || String(err);
      }
    }
  }

  // Play test sound out loud so staff gets immediate audible proof!
  if (playTestSound && !quietHours) {
    playOrderAlertSound();
  }

  // Request notification permission during the same user interaction
  let notificationPermission = "unsupported";
  if (typeof window !== "undefined" && "Notification" in window) {
    try {
      if (Notification.permission === "default") {
        notificationPermission = await Notification.requestPermission();
      } else {
        notificationPermission = Notification.permission;
      }

      if (notificationPermission === "granted") {
        import("./pushSubscription.js")
          .then(({ registerPushNotificationService }) => {
            registerPushNotificationService().catch(() => {});
          })
          .catch(() => {});
      }
    } catch (_) {}
  }

  try {
    localStorage.setItem("mumbai_audio_alerts_armed", "true");
  } catch (_) {}

  notifySubscribers();
  return {
    armed: webAudioOk || voiceOk,
    voiceArmed: voiceOk,
    chimeArmed: webAudioOk,
    state: audioCtx ? audioCtx.state : "unsupported",
    permission: notificationPermission,
    error: voiceErr,
  };
};

/**
 * Direct function to test the order alert sound out loud.
 */
export const testOrderAlertSound = async () => {
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch (_) {}
  }
  playOrderAlertSound();
};

/**
 * One-shot announcement for batch order count changes (e.g. from Dashboard overview polling)
 * without generating fake order IDs or locking in persistent unacknowledged alarms.
 */
export const announceOrderCountChange = (count) => {
  const numericCount = Number(count);
  if (!numericCount || numericCount <= 0) return;

  playOrderAlertSound();

  try {
    if (!isOrderAlarmQuietHours() && typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      new Notification(`🚨 ${numericCount} New Order${numericCount > 1 ? "s" : ""} Received!`, {
        body: "Store orders require packing and fulfillment.",
        icon: "/icon-192-v2.png",
        tag: `order-count-alert-${Date.now()}`,
        requireInteraction: false,
      });
    }
  } catch (_) {}
};

/**
 * Triggers alert for a newly received order with real order ID.
 * Plays custom voice announcement and starts the repeating alarm loop.
 */
export const triggerNewOrderNotification = ({ orderId, count } = {}) => {
  const cleanId = Number(orderId);
  if (cleanId) {
    // Session-level deduplication: avoid re-sounding for an already notified order
    if (notifiedOrderIds.has(cleanId)) return;
    notifiedOrderIds.add(cleanId);
    unacknowledgedOrderIds.add(cleanId);
  } else if (Number(count) > 0) {
    announceOrderCountChange(count);
    return;
  } else {
    return;
  }

  // Play immediate custom voice alert
  playOrderAlertSound();

  // Start continuous alarm loop every 3.5s while unacknowledged orders exist
  if (!alarmIntervalId) {
    alarmIntervalId = setInterval(() => {
      if (unacknowledgedOrderIds.size > 0) {
        playOrderAlertSound();
      } else {
        clearInterval(alarmIntervalId);
        alarmIntervalId = null;
        stopAlarmAudio();
      }
    }, 3500);
  }

  // System notification if permission is granted
  try {
    if (!isOrderAlarmQuietHours() && typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      new Notification(`🚨 New Order #${cleanId} Received!`, {
        body: "New store order requires fulfillment. Tap to view and pack.",
        icon: "/icon-192-v2.png",
        tag: `new-order-${cleanId}`,
        requireInteraction: true,
      });
    }
  } catch (_) {}

  notifySubscribers();
};

/**
 * Acknowledges a specific order, removing it from unacknowledged set.
 * If all orders are acknowledged, stops the repeating voice alarm.
 */
export const acknowledgeOrderAlarm = (orderId) => {
  const cleanId = Number(orderId);
  if (cleanId) {
    unacknowledgedOrderIds.delete(cleanId);
  }

  if (unacknowledgedOrderIds.size === 0 && alarmIntervalId) {
    clearInterval(alarmIntervalId);
    alarmIntervalId = null;
    stopAlarmAudio();
  }

  notifySubscribers();
};

/**
 * Restores an order alarm when backend acknowledgement fails.
 * Re-adds the order to the unacknowledged set and resumes the audible voice alarm.
 */
export const restoreOrderAlarm = (orderId) => {
  const cleanId = Number(orderId);
  if (cleanId) {
    unacknowledgedOrderIds.add(cleanId);
  }

  if (!alarmIntervalId && unacknowledgedOrderIds.size > 0) {
    playOrderAlertSound();
    alarmIntervalId = setInterval(() => {
      if (unacknowledgedOrderIds.size > 0) {
        playOrderAlertSound();
      } else {
        clearInterval(alarmIntervalId);
        alarmIntervalId = null;
        stopAlarmAudio();
      }
    }, 3500);
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
    playOrderAlertSound();
    alarmIntervalId = setInterval(() => {
      if (unacknowledgedOrderIds.size > 0) {
        playOrderAlertSound();
      } else {
        clearInterval(alarmIntervalId);
        alarmIntervalId = null;
        stopAlarmAudio();
      }
    }, 3500);
  }

  notifySubscribers();
};

/**
 * Mutes all active order alarms and immediately stops audio/sirens.
 */
export const muteAllOrderAlarms = () => {
  unacknowledgedOrderIds.clear();
  if (alarmIntervalId) {
    clearInterval(alarmIntervalId);
    alarmIntervalId = null;
  }
  stopAlarmAudio();
  notifySubscribers();
};

/**
 * Fully resets notification controller state.
 * Stops any playing sound or repeating interval, clears all order sets, and notifies subscribers.
 * Must be called on employee logout or session expiration.
 */
export const resetNotificationController = () => {
  unacknowledgedOrderIds.clear();
  notifiedOrderIds.clear();
  if (alarmIntervalId) {
    clearInterval(alarmIntervalId);
    alarmIntervalId = null;
  }
  stopAlarmAudio();
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
  const armStatus = getAudioArmStatus();
  callback({
    unacknowledgedOrders: Array.from(unacknowledgedOrderIds),
    isAlarming: unacknowledgedOrderIds.size > 0,
    isArmed: armStatus.armed,
    voiceArmed: armStatus.voiceArmed,
    chimeArmed: armStatus.chimeArmed,
  });
  return () => {
    subscribers.delete(callback);
  };
};

/**
 * Legacy compatibility alias for existing callers.
 */
export const requestNotificationPermission = async () => {
  return (await armOrderAlarm({ playTestSound: false })).permission;
};
