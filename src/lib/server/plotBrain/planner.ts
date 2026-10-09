import type {StrategicWorldBrainInput} from '$lib/services/ai/context/strategicWorldBrainInput';
import type {StrategicWorldFrame} from '$lib/types';
export class StrategicPlannerOutputError extends Error {}
/** Historical import compatibility only: forecasting is retired before any DB/provider access. */
export async function planStrategicWorldFrameWithTerminal(_input:StrategicWorldBrainInput):Promise<StrategicWorldFrame>{throw new StrategicPlannerOutputError('Plot Director is retired in the agentic campaign runtime.');}
