import {Agent} from '@earendil-works/pi-agent-core';
/** One Pi loop constructor for GM and configured children. World authority stays
 * in the caller's scoped tools; this helper cannot grant it. */
export function createSharedAgent({initialState,streamFn,prepareRequest,beforeToolCall,finishTurn,transformContext}){
 return new Agent({initialState,toolExecution:'sequential',streamFn,prepareRequest,beforeToolCall,finishTurn,transformContext});
}
