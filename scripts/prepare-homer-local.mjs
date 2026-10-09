import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

// Only this isolated checkout and its existing dependencies are admitted.
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const suffix=process.argv[2]||'20261008';if(!/^20261008(?:-r[2-9])?$/.test(suffix)||process.argv.length>3)throw Error('Use a distinct 20261008 release suffix.');
const destination=path.resolve(source,'../Homer-local-'+suffix);
const revision=execFileSync('git',['-c','safe.directory='+source,'rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();
if(execFileSync('git',['-c','safe.directory='+source,'status','--porcelain'],{cwd:source,encoding:'utf8'}).trim())throw Error('Seal source before preparing an installation.');
try{await fs.lstat(destination);throw Error('Installation already exists; never overwrite a working copy.');}catch(e){if(e.code!=='ENOENT')throw e;}
const artifact=path.join(destination,'releases',revision),server=path.join(artifact,'server');
await fs.mkdir(artifact,{recursive:true});
const rejectLinks=async name=>{if((await fs.lstat(name)).isSymbolicLink())throw Error('Linked input denied: '+path.basename(name));return true;};
await fs.cp(path.join(source,'fixture-data/homer-release-build/server'),server,{recursive:true,filter:rejectLinks});
await fs.cp(path.join(source,'resources'),path.join(destination,'resources'),{recursive:true,filter:rejectLinks});
await fs.writeFile(path.join(destination,'package.json'),JSON.stringify({name:'homer-local',private:true,type:'module'},null,2));
await fs.writeFile(path.join(destination,'homer.config.yaml'),'version: 1\nruntimeMode: provider\nproviderDispatch: true\nresourceManifest: resources/manifest.json\ndataRoot: fixture-data\ncredentialRefs: []\n');
// Preserve the installed package closure without npm, credential files or links.
const packages=new Set(),queue=['@earendil-works/pi-agent-core','@earendil-works/pi-ai','gpt-tokenizer','zod'];
while(queue.length){const name=queue.shift();if(packages.has(name))continue;const original=path.join(source,'node_modules',name);let manifest;try{manifest=JSON.parse(await fs.readFile(path.join(original,'package.json'),'utf8'));}catch(e){if(e.code==='ENOENT')continue;throw e;}packages.add(name);await fs.cp(original,path.join(artifact,'node_modules',name),{recursive:true,filter:async name=>{await rejectLinks(name);return !/(?:^|[\\/])(?:\.env(?:\..*)?|\.npmrc|\.netrc|credentials|\.aws)(?:[\\/]|$)/i.test(name);}});for(const dependency of Object.keys({...manifest.dependencies,...manifest.optionalDependencies}))queue.push(dependency);}
const hashes=[];async function collect(dir){for(const row of await fs.readdir(dir,{withFileTypes:true})){const target=path.join(dir,row.name);if(row.isDirectory())await collect(target);else hashes.push({path:path.relative(artifact,target).replaceAll('\\','/'),sha256:createHash('sha256').update(await fs.readFile(target)).digest('hex')});}}
await collect(artifact);hashes.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
const digest=createHash('sha256').update(hashes.map(r=>r.path+'\t'+r.sha256+'\n').join('')).digest('hex');
const xmlRuntime=JSON.parse(execFileSync('python',['-X','utf8','-I','-c',"import json,sys,lxml.etree;print(json.dumps({'pythonExecutable':sys.executable,'lxmlVersion':list(lxml.etree.LXML_VERSION)}))"],{encoding:'utf8'}));xmlRuntime.workerSha256=createHash('sha256').update(await fs.readFile(path.join(destination,'resources/projection/character_xml.py'))).digest('hex');
const identity={xmlRuntime,product:'Homer',sourceRevision:revision,artifactSha256:digest,releaseDirectory:'releases/'+revision,port:5280,host:'127.0.0.1',cultureProjection:'additive typed Markdown; reviewed XSD; exact gpt-4o tokenizer; other tokenizers unavailable',memory:'canonical fallback; native MemWeave disabled',credentialStorage:'server memory only',packages:[...packages].sort(),files:hashes};
await fs.writeFile(path.join(destination,'release.json'),JSON.stringify(identity,null,2));
await fs.writeFile(path.join(destination,'launch.mjs'),`import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import fs from 'node:fs/promises';
const root=path.dirname(fileURLToPath(import.meta.url));process.chdir(root);const identity=JSON.parse(await fs.readFile(path.join(root,'release.json'),'utf8'));
if(identity.host!=='127.0.0.1'||identity.port!==5280||!/^releases\\/[a-f0-9]{40}$/.test(identity.releaseDirectory))throw Error('Invalid isolated release identity.');
for(const key of Object.keys(process.env))if(/API_KEY|TOKEN|SECRET|CREDENTIAL|DATABASE|MYTHENGINE|QDRANT|OLLAMA|ORIGIN|HOST|PORT|HOMER|NODE_OPTIONS|NODE_PATH/i.test(key))delete process.env[key];
process.env.HOMER_LOCAL_INSTALL='1';process.env.HOMER_ISOLATED_RELEASE='1';process.env.MYTHENGINE_OVERHAUL_FIXTURE='1';process.env.HOMER_PROVIDER_DISPATCH='explicit-local-launch';process.env.HOMER_XML_PYTHON=identity.xmlRuntime.pythonExecutable;process.env.HOMER_XML_WORKER_SHA256=identity.xmlRuntime.workerSha256;process.env.HOMER_RELEASE_ID=identity.sourceRevision;process.env.HOMER_ARTIFACT_SHA256=identity.artifactSha256;process.env.HOST='127.0.0.1';process.env.PORT='5280';process.env.ORIGIN='http://127.0.0.1:5280';
await import(pathToFileURL(path.join(root,identity.releaseDirectory,'server/index.js')).href);
`);
console.log(JSON.stringify({destination,revision,artifactSha256:digest,files:hashes.length,packages:packages.size,launched:false}));
