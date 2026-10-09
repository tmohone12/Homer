import type {Handle} from '@sveltejs/kit';
export const handle:Handle=async({event,resolve})=>{
  if(process.env.MYTHENGINE_OVERHAUL_FIXTURE!=='1')return new Response('Overhaul fixture launcher required.',{status:503});
  if(!['127.0.0.1','localhost','[::1]'].includes(event.url.hostname))return new Response('Loopback only.',{status:403});
  const publicAsset=['/manifest.webmanifest','/offline.html','/service-worker.js','/_app/version.json','/icons/homer-sigil.svg','/icons/homer-apple-touch-icon.png','/icons/homer-192.png','/icons/homer-512.png','/icons/homer-maskable-512.png'].includes(event.url.pathname)||event.url.pathname.startsWith('/_app/immutable/');
  if(!publicAsset&&event.url.pathname!=='/'&&event.url.pathname!=='/api/overhaul'&&event.url.pathname!=='/api/turn')return new Response('Legacy runtime and production endpoints are disabled in this working copy.',{status:403});
  if(!['GET','HEAD'].includes(event.request.method)&&event.request.headers.get('origin')!==event.url.origin)return new Response('Same-origin author request required.',{status:403});
  const response=await resolve(event);
  response.headers.set('Content-Security-Policy',"default-src 'self'; connect-src 'self' ws://127.0.0.1:5277; img-src 'self' data:; media-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'");
  response.headers.set('Cache-Control','no-store');return response;
};
