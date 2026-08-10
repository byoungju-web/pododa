/* 포도다 서비스워커 — 새 주문 백그라운드 푸시
   pododa.html 과 같은 폴더에 그대로 올리면 됩니다. (경로가 곧 scope 입니다) */
var PD_SW_VERSION = "pododa-sw-1";

self.addEventListener("install", function(e){ self.skipWaiting(); });
self.addEventListener("activate", function(e){ e.waitUntil(self.clients.claim()); });

self.addEventListener("push", function(e){
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { try { data = { body: e.data.text() }; } catch (e2) {} }

  var title = data.title || "🧾 새 주문";
  var opts = {
    body: data.body || "주문이 들어왔어요",
    tag: data.tag || ("order-" + (data.no || Date.now())),
    renotify: true,
    requireInteraction: !!data.important,
    data: { url: data.url || "/#/admin", no: data.no || "" }
  };
  e.waitUntil(
    self.registration.showNotification(title, opts).then(function(){
      if (typeof data.badge === "number" && self.registration.setAppBadge) {
        try { self.registration.setAppBadge(data.badge); } catch (err) {}
      }
    })
  );
});

self.addEventListener("notificationclick", function(e){
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || "/#/admin";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(list){
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url.indexOf(self.registration.scope) === 0 && "focus" in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

/* 구독이 만료되면 서버에 새 구독을 다시 등록 */
self.addEventListener("pushsubscriptionchange", function(e){
  e.waitUntil(
    self.registration.pushManager.subscribe(e.oldSubscription ? e.oldSubscription.options : { userVisibleOnly: true })
      .then(function(sub){
        return fetch("/push/resubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ old: e.oldSubscription && e.oldSubscription.endpoint, sub: sub.toJSON() })
        }).catch(function(){});
      }).catch(function(){})
  );
});
