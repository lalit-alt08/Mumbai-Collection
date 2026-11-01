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

// Automatically renew push subscription if browser rotates or resets it
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.registration.pushManager
      .subscribe(event.oldSubscription ? event.oldSubscription.options : { userVisibleOnly: true })
      .then((newSubscription) => {
        return fetch("/api/employee/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ subscription: newSubscription.toJSON() }),
        }).then((response) => {
          if (!response.ok) {
            throw new Error(`Push renewal backend responded with HTTP ${response.status}`);
          }
          return response;
        });
      })
      .catch((err) => {
        console.warn("[SW] pushsubscriptionchange renewal failed:", err);
      })
  );
});
