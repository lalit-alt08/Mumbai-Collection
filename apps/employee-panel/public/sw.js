self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle incoming background push notifications on locked phone / sleeping tab
self.addEventListener("push", (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (_) {
      data = { title: "🚨 New Mumbai Collection Order!", body: event.data.text() };
    }
  }

  const title = data.title || "🚨 New Mumbai Collection Order!";
  const options = {
    body: data.body || "New order received. Tap to view and pack.",
    icon: data.icon || "/icon-192.png",
    badge: data.badge || "/icon-192.png",
    tag: data.tag || "mumbai-order-alert",
    renotify: true,
    requireInteraction: true,
    vibrate: [300, 150, 300, 150, 450],
    data: data.data || { url: "/orders" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Focus and navigate employee panel to /orders when notification is tapped
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetPath = event.notification.data?.url || "/orders";
  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // 1. If an open same-origin window already exists, navigate it to /orders and focus
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          if ("navigate" in client && client.url !== targetUrl) {
            return client.navigate(targetUrl).then((c) => (c ? c.focus() : client.focus()));
          }
          return client.focus();
        }
      }

      // 2. Otherwise open a new window pointing directly to the target URL
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// Native IndexedDB helper for durable push renewal retry
const openSWDb = () => {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    const request = indexedDB.open("mumbai_sw_store", 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("pending_renewals")) {
        db.createObjectStore("pending_renewals", { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const storePendingRenewal = async (subscriptionJson) => {
  try {
    const db = await openSWDb();
    if (!db) return;
    const tx = db.transaction("pending_renewals", "readwrite");
    tx.objectStore("pending_renewals").put({
      id: "latest",
      subscription: subscriptionJson,
      savedAt: Date.now(),
    });
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = reject;
    });
  } catch (err) {
    console.warn("[SW] Failed saving pending renewal to IndexedDB:", err);
  }
};

const drainPendingRenewals = async () => {
  const db = await openSWDb();
  if (!db) return;
  const tx = db.transaction("pending_renewals", "readwrite");
  const store = tx.objectStore("pending_renewals");
  const getReq = store.get("latest");
  const item = await new Promise((resolve, reject) => {
    getReq.onsuccess = () => resolve(getReq.result);
    getReq.onerror = reject;
  });

  if (!item?.subscription) return;

  let response;
  try {
    response = await fetch("/api/employee/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ subscription: item.subscription }),
    });
  } catch (netErr) {
    // Network failure: ensure Background Sync is scheduled and rethrow so browser sync engine retries
    if (self.registration && "sync" in self.registration) {
      await self.registration.sync.register("mumbai-renew-push-subscription").catch(() => {});
    }
    throw netErr;
  }

  // Permanent failure: remove item so it doesn't linger indefinitely
  if ([400, 401, 403, 404, 410].includes(response.status)) {
    const delTx = db.transaction("pending_renewals", "readwrite");
    delTx.objectStore("pending_renewals").delete("latest");
    console.warn(`[SW] Pending renewal dropped due to permanent HTTP ${response.status}`);
    return;
  }

  if (response.ok) {
    const delTx = db.transaction("pending_renewals", "readwrite");
    delTx.objectStore("pending_renewals").delete("latest");
    console.log("[SW] Drained pending push renewal from IndexedDB");
    return;
  }

  // Server error (5xx, 429): re-register sync and throw to signal failure to sync event
  if (self.registration && "sync" in self.registration) {
    await self.registration.sync.register("mumbai-renew-push-subscription").catch(() => {});
  }
  throw new Error(`[SW] Pending renewal failed with HTTP ${response.status}`);
};

// Renews subscription on backend with exponential backoff and durable fallback
const renewSubscriptionWithRetry = async (newSubscription, maxAttempts = 3) => {
  const subJson = newSubscription.toJSON();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch("/api/employee/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ subscription: subJson }),
      });

      // Do not retry permanent client rejections (400, 401, 403, 404, 410)
      if ([400, 401, 403, 404, 410].includes(response.status)) {
        console.warn(`[SW] Push renewal rejected permanently with HTTP ${response.status}; aborting retry`);
        return response;
      }

      if (!response.ok) {
        throw new Error(`Push renewal backend responded with HTTP ${response.status}`);
      }
      return response;
    } catch (err) {
      if (attempt === maxAttempts) {
        // Immediate retries exhausted: persist to IndexedDB and register background sync
        await storePendingRenewal(subJson);
        try {
          if (self.registration && "sync" in self.registration) {
            await self.registration.sync.register("mumbai-renew-push-subscription");
          }
        } catch (_) {}

        // Notify active employee panel tabs to trigger resync on next focus
        const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const client of clients) {
          client.postMessage({ type: "PUSH_RENEWAL_PENDING", subscription: subJson });
        }
        throw err;
      }

      // Exponential backoff with random jitter: ~2s, ~4s, ~8s
      const delayMs = Math.pow(2, attempt) * 1000 + Math.floor(Math.random() * 500);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
};

// Background sync handler for offline recovery
self.addEventListener("sync", (event) => {
  if (event.tag === "mumbai-renew-push-subscription") {
    event.waitUntil(drainPendingRenewals());
  }
});

// Client tab ping handler
self.addEventListener("message", (event) => {
  if (event.data?.type === "CHECK_PENDING_PUSH_RENEWAL") {
    event.waitUntil(drainPendingRenewals());
  }
});

// Automatically renew push subscription if browser rotates or resets it
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.registration.pushManager
      .subscribe(event.oldSubscription ? event.oldSubscription.options : { userVisibleOnly: true })
      .then((newSubscription) => renewSubscriptionWithRetry(newSubscription))
      .catch((err) => {
        console.warn("[SW] pushsubscriptionchange renewal failed after retries:", err);
      })
  );
});
