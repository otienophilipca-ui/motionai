const CACHE='dreammotion-shell-v1';
const SHELL=['/','/manifest.json','/icons/icon-192.svg','/icons/icon-512.svg'];
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{const cache=await caches.open(CACHE);await cache.addAll(SHELL);await self.skipWaiting();})());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));await self.clients.claim();})());
});
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET'||new URL(request.url).origin!==self.location.origin||request.url.includes('/api/'))return;
  if(request.mode==='navigate'){event.respondWith(fetch(request).catch(()=>caches.match('/')));return;}
  event.respondWith((async()=>{try{const response=await fetch(request);if(response.ok){const cache=await caches.open(CACHE);cache.put(request,response.clone());}return response;}catch{return caches.match(request);}})());
});