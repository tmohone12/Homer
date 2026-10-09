import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {StoreError} from './store.mjs';
// Disposable projection. Accepted Markdown and recovery receipts never depend on this database.
export async function rebuildIndex(store){
  return store.serial(async()=>{
    const projection=await store.projection();await store.checkInternal('.journal');
    const file=path.join(store.root,'.journal/index.sqlite');
    try{if((await fs.lstat(file)).isSymbolicLink())throw new StoreError('PATH_DENIED','Linked index file denied.');}catch(e){if(e.code!=='ENOENT')throw e;}
    const build=()=>{const database=new DatabaseSync(file);try{
      database.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY,type TEXT,name TEXT,revision INTEGER,hash TEXT,refs TEXT);');
      const previous=database.prepare("SELECT value FROM meta WHERE key='version'").get()?.value;
      if(previous!==projection.version){
        database.exec('BEGIN IMMEDIATE; DELETE FROM records;');
        const insert=database.prepare('INSERT INTO records VALUES (?,?,?,?,?,?)');
        for(const row of projection.records)insert.run(row.id,row.type,row.name,row.revision,row.hash,JSON.stringify(row.references));
        database.prepare("INSERT OR REPLACE INTO meta VALUES ('version',?)").run(projection.version);database.exec('COMMIT;');
      }
      return{...projection,index:{engine:'node:sqlite',authority:false,rebuildable:true,path:'.journal/index.sqlite',count:database.prepare('SELECT count(*) AS count FROM records').get().count}};
    }finally{database.close();}};
    try{return build();}catch(error){
      if(error.code!=='ERR_SQLITE_ERROR')throw error;
      await store.checkInternal('.journal');await store.checkInternal('.journal/index.sqlite');
      await fs.rename(file,path.join(store.root,'.journal',`index-corrupt-${randomUUID()}.sqlite`));
      return {...build(),indexRecovery:'Corrupt disposable index preserved and rebuilt from Markdown.'};
    }
  });
}
