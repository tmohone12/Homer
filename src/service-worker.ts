/// <reference lib="webworker" />
import {build,version} from '$service-worker';
declare const self:ServiceWorkerGlobalScope;
const CACHE=`homer-static-${version}`,STATIC=[...build,'/offline.html','/manifest.webmanifest','/icons/homer-sigil.svg','/icons/homer-apple-touch-icon.png','/icons/homer-192.png','/icons/homer-512.png','/icons/homer-maskable-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(STATIC)));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('homer-static-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
// Only an explicit author update choice replaces an existing active shell.
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')void self.skipWaiting();});
self.addEventListener('fetch',event=>{const request=event.request,url=new URL(request.url);if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;if(request.mode==='navigate'){event.respondWith(fetch(request).catch(async()=>await caches.match('/offline.html')||Response.error()));return;}if(!STATIC.includes(url.pathname)||url.search)return;event.respondWith(caches.open(CACHE).then(async cache=>await cache.match(request)||fetch(request)));});
