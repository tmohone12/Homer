export const DIRECTOR_RETIRED=true;
export const isRetiredDirectorJob=type=>type==='plan_plot_brain';
export const directorRetirementReceipt=()=>({status:'retired',reason:'agentic_overhaul',forecastCount:0,eventCount:0,providerCalls:0});
