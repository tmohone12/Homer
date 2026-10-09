import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {MarkdownStore} from './store.mjs';
import {rebuildIndex} from './index.mjs';
import {fixtureRecords} from './fixture.mjs';
test('index deletion and rebuild preserves Markdown, receipts and stable IDs',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'myth-index-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const store=await new MarkdownStore(root).init();await store.seed(fixtureRecords);const before=await store.raw('house_ash');const first=await rebuildIndex(store);assert.equal(first.index.count,fixtureRecords.length);
 await store.edit({id:'house_ash',operationId:'rename',expectedHash:before.hash,patch:{name:'House River'},evidenceIds:[]},{role:'assistant'});const renamed=await rebuildIndex(store);assert.notEqual(renamed.version,first.version);
 await fs.unlink(path.join(root,'.journal/index.sqlite'));const rebuilt=await rebuildIndex(store);assert.equal(rebuilt.version,renamed.version);assert.equal(rebuilt.records.find(r=>r.id==='house_ash').name,'House River');assert.equal((await store.history()).length,1);assert.equal((await store.raw('mira')).record.data.house.birthId,'house_ash');
 await fs.writeFile(path.join(root,'.journal/index.sqlite'),'deliberately damaged fixture cache');const repaired=await rebuildIndex(store);assert.equal(repaired.version,rebuilt.version);assert.match(repaired.indexRecovery,/rebuilt/);assert.ok((await fs.readdir(path.join(root,'.journal'))).some(name=>name.startsWith('index-corrupt-')));assert.equal((await store.history()).length,1);
});
