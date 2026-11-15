export const MAX_VIDEO_RETRIES = 3;

/**
 * Calculates exponential backoff delay (ms) for banner video retries.
 * 3000ms -> 4500ms -> 6750ms -> capped at 12000ms.
 */
export const getRetryBackoffMs = (attemptNumber) => {
  const attempt = Math.max(1, Number(attemptNumber) || 1);
  return Math.min(3000 * Math.pow(1.5, attempt - 1), 12000);
};

/**
 * Pure state & timer manager for mobile banner video retries and error deduplication.
 * Protects against:
 * 1. Dangling timeout references when banners change or device reconnects
 * 2. Double-incrementing retry counters from simultaneous onError + .play().catch()
 * 3. Late errors from older/superseded video attempts corrupting current attempt state
 */
export function createBannerVideoRetryManager({ onScheduleRetry, onResetState } = {}) {
  let retryCount = 0;
  let retryTimeoutId = null;
  let playbackEpoch = 0;

  return {
    getRetryCount: () => retryCount,
    getTimeoutId: () => retryTimeoutId,
    getPlaybackEpoch: () => playbackEpoch,

    /**
     * Advances epoch and clears any pending retry timers cleanly.
     * Invoked when banner media changes, online reconnects, or unmounting.
     */
    reset: () => {
      playbackEpoch += 1;
      retryCount = 0;
      if (retryTimeoutId !== null) {
        clearTimeout(retryTimeoutId);
        retryTimeoutId = null;
      }
      if (typeof onResetState === "function") {
        onResetState();
      }
    },

    /**
     * Marks playback as successful; clears timers and resets failure counter.
     */
    handleSuccess: () => {
      retryCount = 0;
      if (retryTimeoutId !== null) {
        clearTimeout(retryTimeoutId);
        retryTimeoutId = null;
      }
    },

    /**
     * Evaluates a playback or media error and schedules an exponential retry if within budget.
     * Deduplicates near-simultaneous errors from the same attempt and discards late errors.
     *
     * @param {Object} options
     * @param {string} [options.reason]
     * @param {number} [options.epoch] - Epoch when the attempt was initiated
     * @returns {boolean} Whether a new retry was scheduled
     */
    handleFailure: ({ reason = "error", epoch = undefined } = {}) => {
      // Discard errors from superseded attempts or older banners
      if (epoch !== undefined && epoch !== playbackEpoch) {
        return false;
      }

      // If a retry is already in flight for this failure cycle, do NOT double-increment
      if (retryTimeoutId !== null) {
        return false;
      }

      // If retry budget exhausted, give up and remain in poster fallback
      if (retryCount >= MAX_VIDEO_RETRIES) {
        return false;
      }

      retryCount += 1;
      const delayMs = getRetryBackoffMs(retryCount);

      retryTimeoutId = setTimeout(() => {
        retryTimeoutId = null;
        playbackEpoch += 1;
        if (typeof onScheduleRetry === "function") {
          onScheduleRetry();
        }
      }, delayMs);

      return true;
    },

    /**
     * Cleanup on unmount
     */
    dispose: () => {
      if (retryTimeoutId !== null) {
        clearTimeout(retryTimeoutId);
        retryTimeoutId = null;
      }
    },
  };
}

export default {
  MAX_VIDEO_RETRIES,
  getRetryBackoffMs,
  createBannerVideoRetryManager,
};
