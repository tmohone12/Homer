import {sveltekit} from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
export default {envDir:false,plugins:[tailwindcss(),sveltekit()],server:{host:'127.0.0.1',port:5277,strictPort:true,allowedHosts:['127.0.0.1','localhost'],proxy:{},fs:{strict:true},watch:{ignored:['**/fixture-data/**','**/overhaul-evidence/**','**/resources/**','**/homer.config.yaml']}},preview:{host:'127.0.0.1',port:5277,strictPort:true}};
