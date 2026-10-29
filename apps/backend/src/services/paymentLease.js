import { randomUUID } from 'node:crypto';
import paymentIntentService from './paymentIntentService.js';

// Renew the shared database lease while upstream calls are in progress.
export async function acquirePaymentLease(key, prefix = 'payment', waitMs = 4000) {
  const owner = `${prefix}_${randomUUID()}`;
  if (!await paymentIntentService.acquireLock(key, owner, waitMs)) return null;
  let lost = false;
  let renewing = false;
  const refresh = async () => {
    if (lost) throw new Error('Payment processing lease was lost');
    if (!await paymentIntentService.acquireLock(key, owner, 1000)) {
      lost = true;
      throw new Error('Payment processing lease was lost');
    }
  };
  const timer = setInterval(async () => {
    if (renewing) return;
    renewing = true;
    try { await refresh(); } catch { lost = true; } finally { renewing = false; }
  }, 15000);
  timer.unref?.();
  return {
    refresh,
    async release() {
      clearInterval(timer);
      await paymentIntentService.releaseLock(key, owner);
    },
  };
}
