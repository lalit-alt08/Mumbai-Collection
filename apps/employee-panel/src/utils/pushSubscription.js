import { getVapidPublicKey, subscribeToPush, unsubscribeFromPush } from "../services/employeeApi.js";

/**
 * Converts a URL-safe Base64 VAPID public key string into a Uint8Array
 * required by PushManager.subscribe.
 */
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Checks current push notification capability and subscription status.
 */
export const getPushSubscriptionState = async () => {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { supported: false, permission: "unsupported", subscribed: false };
  }

  const permission = "Notification" in window ? Notification.permission : "default";

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return {
      supported: true,
      permission,
      subscribed: Boolean(subscription),
      endpoint: subscription?.endpoint || null,
    };
  } catch (err) {
    return {
      supported: true,
      permission,
      subscribed: false,
      error: err?.message || String(err),
    };
  }
};

/**
 * Registers Web Push subscription for background order alerts when phone screen is locked.
 * Synchronizes with backend employee push endpoint.
 */
export const registerPushNotificationService = async () => {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { supported: false, subscribed: false, reason: "push_unsupported" };
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      const publicKey = await getVapidPublicKey();
      if (!publicKey) {
        return { supported: true, subscribed: false, reason: "missing_public_key" };
      }

      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    if (subscription) {
      await subscribeToPush(subscription.toJSON());
      return { supported: true, subscribed: true, subscription };
    }
  } catch (err) {
    return { supported: true, subscribed: false, error: err?.message || String(err) };
  }

  return { supported: true, subscribed: false };
};

/**
 * Unregisters the device push subscription on logout or account switch.
 * Informs backend to remove this device, then unsubscribes from the browser's PushManager.
 */
export const unsubscribeDevicePush = async () => {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { success: true };
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      const endpoint = subscription.endpoint;
      // Invalidate on backend
      try {
        await unsubscribeFromPush(endpoint);
      } catch (backendErr) {
        console.warn("[WebPush] Backend unsubscribe call failed; proceeding with local revocation", backendErr);
      }
      // Revoke in browser PushManager
      await subscription.unsubscribe();
    }

    return { success: true };
  } catch (err) {
    console.warn("[WebPush] Device unsubscribe encountered warning:", err);
    return { success: false, error: err?.message || String(err) };
  }
};

export const unregisterPushNotificationService = unsubscribeDevicePush;
