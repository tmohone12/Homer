import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadHomerConfig} from '../src/lib/server/overhaul/resources.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2);if(args.some(a=>a!=='--enable-provider')||args.length>1)throw Error('Usage: node scripts/homer-run.mjs [--enable-provider]');
process.chdir(root);const config=await loadHomerConfig(root),enabled=args.includes('--enable-provider');if(enabled&&(!config.providerDispatch||config.runtimeMode!=='provider'))throw Error('Host config must explicitly select provider mode and dispatch before enabling it.');
// No private .env or inherited application configuration is loaded.
for(const key of Object.keys(process.env))if(/(?:API_KEY|DATABASE_URL|MYTHENGINE_|QDRANT|OLLAMA|ORIGIN|HOST|PORT)/i.test(key)||/(?:TOKEN|SECRET)/i.test(key)&&!key.startsWith('HOMER_CREDENTIAL_'))delete process.env[key];
process.env.HOMER_PROVIDER_DISPATCH=enabled?'explicit-local-launch':'disabled';process.env.HOMER_ISOLATED_RELEASE='1';process.env.MYTHENGINE_OVERHAUL_FIXTURE='1';process.env.HOST='127.0.0.1';process.env.PORT='5278';process.env.ORIGIN='http://127.0.0.1:5278';
await import(pathToFileURL(path.join(root,'fixture-data/homer-release-build/server/index.js')).href);
console.log('Homer loopback runtime: '+config.runtimeMode+'; provider grant '+(enabled?'enabled explicitly':'absent')+'.');
