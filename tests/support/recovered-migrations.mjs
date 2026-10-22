/** Only synthetic, newly-created loopback databases. Never an application migration runner. */
import assert from 'node:assert/strict';
import pg from 'pg';
import {drizzle} from 'drizzle-orm/node-postgres';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {bootstrapDisposableDatabase,defaultStageDeps} from '../../scripts/disposable-postgres-bootstrap.mjs';
const u=new URL(process.env.RECOVERY_PG_URL||'');
assert.equal(process.env.CI,'true');assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'55489');assert.equal(u.pathname,'/sprintb_recovery');
const journal=JSON.parse(await readFile('drizzle-pg/meta/_journal.json','utf8'));
assert.equal(journal.entries.length,22);
const folder='.scratch/recovery/predecessor';await mkdir(folder+'/meta',{recursive:true});
await writeFile(folder+'/meta/_journal.json',JSON.stringify({...journal,entries:journal.entries.slice(0,14)}));
const hashes=[];
for(const e of journal.entries){const file='drizzle-pg/'+e.tag+'.sql',data=await readFile(file);if(e.idx<21)assert.deepEqual(data,execFileSync('git',['show','1c51d5ac9752e76928988d80e21f402ecc1ac80a:'+file]));hashes.push({tag:e.tag,when:e.when,sha256:createHash('sha256').update(data).digest('hex')});if(e.idx<14)await copyFile(file,folder+'/'+e.tag+'.sql')}
await writeFile('docs/recovery/migration-sha256.json',JSON.stringify(hashes,null,2)+'\n');
const adminUrl=new URL(u);adminUrl.pathname='/postgres';const admin=new pg.Pool({connectionString:adminUrl.href});const results=[];
try{for(const [name,upgrade]of[['sprintb_recovery_clean',false],['sprintb_recovery_upgrade',true],['sprintb_b9_recovery',false]]){
 // Explicit refusal protects any pre-existing database, including previous test runs.
 if(name!=='sprintb_b9_recovery'){assert.equal((await admin.query('select 1 from pg_database where datname=$1',[name])).rowCount,0);await admin.query('create database '+name)}
 else {const chk=new pg.Pool({connectionString:new URL('/'+name,u).href});try{assert.equal((await chk.query("select count(*)::int n from pg_tables where schemaname='public'")).rows[0].n,0)}finally{await chk.end()}}
 const url=new URL('/'+name,u).href;
 await bootstrapDisposableDatabase({Pool:pg.Pool,drizzle,migrate,url,journal,migrationsFolder:upgrade?folder:'drizzle-pg',...defaultStageDeps});
 const pool=new pg.Pool({connectionString:url});try{
 if(upgrade){await pool.query("insert into used_products(id,slug,name,category,price,stock,status) values('synthetic-draft','synthetic-draft','Synthetic draft','Klima',12345,2,'draft'),('synthetic-published','synthetic-published','Synthetic legacy','Klima',54321,1,'published')");const before=(await pool.query('select * from used_products order by id')).rows;await migrate(drizzle(pool),{migrationsFolder:'drizzle-pg'});const after=(await pool.query('select * from used_products order by id')).rows;for(let i=0;i<before.length;i++)for(const k of Object.keys(before[i]))assert.deepEqual(after[i][k],before[i][k]);assert.ok(after.every(r=>r.inspection_date===null&&r.warranty_months===0&&r.known_defects===''))}
 const rows=(await pool.query('select hash from drizzle.__drizzle_migrations order by created_at')).rows;assert.deepEqual(rows.map(r=>r.hash),hashes.map(r=>r.sha256));await migrate(drizzle(pool),{migrationsFolder:'drizzle-pg'});assert.equal((await pool.query('select count(*)::int n from drizzle.__drizzle_migrations')).rows[0].n,22);
 results.push({scenario:name,synthetic:true,migrations:22,unchangedPriorSQL:21,idempotent:true,legacyRowsPreserved:upgrade?2:null,status:'PASS'});
 }finally{await pool.end()}}
 await writeFile('.scratch/recovery/migration-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await admin.end()}
