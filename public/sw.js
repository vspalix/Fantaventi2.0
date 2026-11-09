self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : { title: "FantaVenti", body: "" };
  event.waitUntil(self.registration.showNotification(data.title || "FantaVenti", {
    body: data.body || "",
    data: { url: data.url || "/leghe" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/leghe";
  event.waitUntil(clients.openWindow(url));
});
