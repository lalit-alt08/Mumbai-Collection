// Web Audio API & Notification Service for Employee Counter Tablet
let audioCtx = null;

const getAudioContext = () => {
  if (typeof window === "undefined") return null;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
};

/**
 * Play a crisp, pleasant 2-tone alert chime (D5 -> A5)
 * Synthesized purely via Web Audio API without requiring external audio assets.
 */
export const playOrderAlertChime = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // Tone 1: 587.33 Hz (D5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.25, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.25);

    // Tone 2: 880 Hz (A5)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(880, now + 0.12);
    gain2.gain.setValueAtTime(0.3, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.45);
  } catch {
    // Autoplay policy or unsupported audio gracefully ignored
  }
};

/**
 * Request notification permissions from the counter tablet / browser
 */
export const requestNotificationPermission = async () => {
  try {
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        return await Notification.requestPermission();
      }
      return Notification.permission;
    }
  } catch {
    // Ignore error
  }
  return "denied";
};

/**
 * Trigger sound chime and optional system notification for new incoming order(s)
 */
export const triggerNewOrderNotification = ({ orderId, count = 1 } = {}) => {
  playOrderAlertChime();
  try {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      const title = count > 1 ? `🔔 ${count} New Orders Received!` : `🔔 New Order #${orderId || ""} Received!`;
      new Notification(title, {
        body: "A new order requires packing / dispatch. Check the employee panel.",
        icon: "/favicon.ico",
      });
    }
  } catch {
    // Ignore notification error
  }
};
