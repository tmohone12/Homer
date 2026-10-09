import {AsyncLocalStorage} from 'node:async_hooks';
const scope=new AsyncLocalStorage();
export const withRunFence=(fence,work)=>scope.run(fence,work);
export const runFenceFor=root=>scope.getStore()?.root===root?scope.getStore():null;
