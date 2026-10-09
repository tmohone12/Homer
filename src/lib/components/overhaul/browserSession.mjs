const key='mythengine:overhaul:browser-session',valid=value=>typeof value==='string'&&/^[a-z][a-z0-9_-]{0,60}$/.test(value);
/** One durable session per active tab. Web Locks detects duplicated tabs whose
 * sessionStorage was cloned by the browser; it never changes host settings. */
export async function acquireBrowserSession({local,tab,locks,randomId}){
 if(typeof locks?.request!=='function')throw Error('This browser cannot isolate concurrent campaign tabs: Web Locks is unavailable.');
 const localId=local.getItem(key),tabId=tab.getItem(key);let candidate=valid(tabId)?tabId:valid(localId)?localId:randomId();
 if(!valid(candidate))throw Error('Invalid browser session identity.');
 if(!valid(localId))local.setItem(key,candidate);
 for(let attempt=0;attempt<5;attempt++){
  let release,resolveAcquired,rejectAcquired;const lifetime=new Promise(resolve=>release=resolve),acquired=new Promise((resolve,reject)=>{resolveAcquired=resolve;rejectAcquired=reject;});
  Promise.resolve(locks.request('mythengine:overhaul:tab:'+candidate,{ifAvailable:true},lock=>{if(!lock){resolveAcquired(false);return;}resolveAcquired(true);return lifetime;})).catch(rejectAcquired);
  if(await acquired){try{tab.setItem(key,candidate);}catch(error){release();throw error;}return {id:candidate,release};}
  candidate=randomId();if(!valid(candidate))throw Error('Invalid browser session identity.');
 }
 throw Error('Could not claim an independent campaign tab.');
}
