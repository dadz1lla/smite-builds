// Guarda a app no telemóvel. Abre logo a partir da cópia guardada (sem esperar pela internet);
// quando há versão nova, descarrega-a em segundo plano e passa a usá-la na abertura seguinte.
const V="smite-builds-202611141627", FILES=["./","index.html","builds.json","manifest.webmanifest","icon-192.png","icon-512.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(FILES.map(f=>new Request(f,{cache:"reload"})))));self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;const u=new URL(e.request.url);
  const proprio=u.origin===location.origin, fontes=/fonts\.(googleapis|gstatic)\.com$/.test(u.hostname);if(!proprio&&!fontes)return;
  e.respondWith(caches.open(V).then(c=>c.match(e.request,{ignoreSearch:proprio}).then(m=>m||fetch(e.request).then(r=>{if(r.ok||r.type==="opaque")c.put(e.request,r.clone());return r}).catch(()=>c.match("index.html")))))});
