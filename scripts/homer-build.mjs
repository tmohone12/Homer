import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');process.chdir(root);
for(const key of Object.keys(process.env))if(/(?:API_KEY|TOKEN|SECRET|DATABASE_URL|MYTHENGINE_|QDRANT|OLLAMA)/i.test(key))delete process.env[key];
process.env.HOMER_PROVIDER_DISPATCH='disabled';process.env.HOMER_ISOLATED_RELEASE='1';process.env.MYTHENGINE_OVERHAUL_FIXTURE='1';
const {build}=await import('vite');await build({root,configFile:path.join(root,'vite.overhaul.config.mjs'),configLoader:'native',envDir:false});
console.log('Homer isolated release built under fixture-data/homer-release-build/server. No deployment.');
