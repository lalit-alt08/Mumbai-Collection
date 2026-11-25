import { safeSessionStorage } from "./safeStorage.js";

let sharedAudioCtx = null;
const playedOrderIds = new Set();

const getSuccessAudioContext = () => {
  if (typeof window === "undefined") return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new AudioContextClass();
  }
  return sharedAudioCtx;
};

/**
 * Unlocks the shared Web Audio context inside a user gesture (e.g. clicking "Place Order")
 * so the confirmation chime can play automatically when navigating to OrderSuccess.
 */
export const unlockSuccessSound = () => {
  try {
    const ctx = getSuccessAudioContext();
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
  } catch {
    // Non-blocking fallback
  }
};

/**
 * Plays a warm, crisp Paytm/GPay-inspired ascending major confirmation chime once per order.
 */
export const playOrderSuccessSound = async (orderId) => {
  if (typeof window === "undefined") return false;
  const key = orderId ? String(orderId) : "latest";
  const storageKey = `mumbai_order_success_chime_${key}`;

  if (playedOrderIds.has(key) || safeSessionStorage.getItem(storageKey) === "1") {
    return false;
  }

  const ctx = getSuccessAudioContext();
  if (!ctx) return false;

  try {
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    if (ctx.state !== "running") {
      return false;
    }

    playedOrderIds.add(key);
    safeSessionStorage.setItem(storageKey, "1");

    const now = ctx.currentTime + 0.02;
    // Ascending C-major sparkle chime (C5 -> E5 -> G5 -> C6)
    const notes = [
      { freq: 523.25, delay: 0.0, duration: 0.22, gain: 0.16, type: "sine" },
      { freq: 659.25, delay: 0.085, duration: 0.24, gain: 0.17, type: "sine" },
      { freq: 783.99, delay: 0.17, duration: 0.28, gain: 0.17, type: "sine" },
      { freq: 1046.5, delay: 0.26, duration: 0.55, gain: 0.2, type: "triangle" },
      // Subtle harmonic shimmer on final C6
      { freq: 1567.98, delay: 0.265, duration: 0.35, gain: 0.05, type: "sine" },
    ];

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      const start = now + note.delay;
      const end = start + note.duration;

      osc.type = note.type;
      osc.frequency.setValueAtTime(note.freq, start);

      gainNode.gain.setValueAtTime(0.0001, start);
      gainNode.gain.exponentialRampToValueAtTime(note.gain, start + 0.018);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, end);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    }

    return true;
  } catch {
    return false;
  }
};
