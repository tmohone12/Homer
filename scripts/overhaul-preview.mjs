import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Only a fixture flag reaches this runtime; no private environment file or provider proxy is loaded.
for(const key of Object.keys(process.env))if(/(?:API_KEY|TOKEN|SECRET|DATABASE_URL|MYTHENGINE_|QDRANT|OLLAMA)/i.test(key))delete process.env[key];
process.env.HOMER_PROVIDER_DISPATCH='disabled';process.env.MYTHENGINE_OVERHAUL_FIXTURE='1';
process.chdir(root);
const server=await createServer({root,configFile:path.join(root,'vite.overhaul.config.mjs'),configLoader:'native'});
await server.listen();console.log('Homer isolated synthetic preview: http://127.0.0.1:5277 · providers and legacy runtime disabled');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();process.exit(0);});
