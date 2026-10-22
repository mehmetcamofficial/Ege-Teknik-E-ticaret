/**
 * H4-C: restore safety on TWO disposable loopback PostgreSQL clusters (synthetic data only).
 *  1. restoring into a cluster that lacks the roles named in the dump's ACLs must fail ATOMICALLY (no tables left behind);
 *  2. once the roles exist, the restore succeeds and owners, ACLs, SECURITY DEFINER flags, triggers and data match the source;
 *  3. legal evidence immutability survives the restore.
 * Never opens a Production archive or key. Requires CI=true and sprintb* loopback databases.
 */
import assert from 'node:assert/strict';import pg from 'pg';import{spawnSync}from'node:child_process';import{mkdirSync,rmSync}from'node:fs';import{randomBytes}from'node:crypto';
const need=(name,port,admin=false)=>{const u=new URL(process.env[name]||'');assert.equal(process.env.CI,'true','CI=true required');assert.equal(u.hostname,'127.0.0.1',name+' must be loopback');assert.equal(u.port,String(port),name+' port');const db=u.pathname.slice(1);assert.ok(admin?db==='postgres':db.startsWith('sprintb'),name+(admin?' must be the maintenance database of a disposable cluster':' database must start with sprintb'));return u};
const src=need('H4_RESTORE_SRC_URL',55489),dst=need('H4_RESTORE_DST_URL',55490,true);
const dir='.scratch/h4/restore-'+randomBytes(3).toString('hex');mkdirSync(dir,{recursive:true});const dump=dir+'/synthetic.dump';
const env=(u,db)=>({PATH:process.env.PATH,HOME:process.env.HOME,PGHOST:u.hostname,PGPORT:u.port,PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:db});
const withDb=(u,db)=>{const x=new URL(u.href);x.pathname='/'+db;return x.href};
const meta=async pool=>({
  tables:(await pool.query("select c.relname n,pg_get_userbyid(c.relowner) o,coalesce(c.relacl::text,'') a,c.relrowsecurity rls from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname in ('public','drizzle') and c.relkind in ('r','S','v') order by 1")).rows,
  functions:(await pool.query("select p.proname n,pg_get_userbyid(p.proowner) o,coalesce(p.proacl::text,'') a,p.prosecdef d,coalesce(p.proconfig::text,'') c from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' order by 1,pg_get_function_identity_arguments(p.oid)")).rows,
  triggers:(await pool.query("select tgrelid::regclass::text t,tgname n,tgenabled e from pg_trigger where not tgisinternal order by 1,2")).rows,
  defaults:(await pool.query("select pg_get_userbyid(defaclrole) r,defaclobjtype t,defaclacl::text a from pg_default_acl order by 1,2,3")).rows,
  counts:Object.fromEntries(await Promise.all(['orders','order_items','order_legal_acceptances','inventory','legal_document_versions'].map(async t=>[t,(await pool.query(`select count(*)::int n from ${t}`)).rows[0].n]))),
});
const A=new pg.Pool({connectionString:src.href,max:2}),B=new pg.Pool({connectionString:withDb(dst,'postgres'),max:2});const made=[],madeRoles=[];let R1,R2;
try{
  const before=await meta(A);assert.ok(before.tables.length>=40,'source has the full schema');assert.ok(before.counts.orders>=1&&before.counts.order_legal_acceptances>=2,'source holds orders and legal evidence');
  const roles=(await A.query("select rolname from pg_roles where rolname like 'sprintb\\_%' and rolname<>$1 order by 1",[decodeURIComponent(src.username)])).rows.map(r=>r.rolname);assert.ok(roles.length>=1,'source ACLs reference non-owner roles: '+roles);
  const d=spawnSync('pg_dump',['--format=custom','--file='+dump],{env:env(src,decodeURIComponent(src.pathname.slice(1))),encoding:'utf8'});assert.equal(d.status,0,'pg_dump failed: '+d.stderr.slice(0,200));
  for(const r of roles)assert.equal((await B.query('select 1 from pg_roles where rolname=$1',[r])).rowCount,0,'destination cluster must start WITHOUT '+r);
  // 1. missing roles: atomic failure
  const t1='sprintb_h4_norole_'+randomBytes(2).toString('hex');await B.query('create database '+t1);made.push(t1);
  const bad=spawnSync('pg_restore',['--exit-on-error','--single-transaction','--dbname='+t1,dump],{env:env(dst,t1),encoding:'utf8'});
  assert.notEqual(bad.status,0,'restore without the referenced roles must fail');assert.match(bad.stderr,/role .* does not exist/i,'fails for the missing role, not for another reason');
  R1=new pg.Pool({connectionString:withDb(dst,t1),max:1});
  const leftover=(await R1.query("select count(*)::int n from pg_tables where schemaname in ('public','drizzle')")).rows[0].n;assert.equal(leftover,0,'failed restore left NO tables behind (single transaction rolled back)');
  const leftoverFn=(await R1.query("select count(*)::int n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public'")).rows[0].n;assert.equal(leftoverFn,0,'and no functions');
  // 2. roles present: faithful restore
  for(const r of roles){await B.query(`create role ${r} nologin nosuperuser nocreatedb nocreaterole`);madeRoles.push(r)}
  const t2='sprintb_h4_restored_'+randomBytes(2).toString('hex');await B.query('create database '+t2);made.push(t2);
  const ok=spawnSync('pg_restore',['--exit-on-error','--single-transaction','--dbname='+t2,dump],{env:env(dst,t2),encoding:'utf8'});assert.equal(ok.status,0,'restore with roles failed: '+ok.stderr.slice(0,300));
  R2=new pg.Pool({connectionString:withDb(dst,t2),max:1});const after=await meta(R2);
  for(const k of ['tables','functions','triggers','defaults','counts'])assert.deepEqual(after[k],before[k],`${k}: owners/ACLs/flags/counts identical after restore`);
  assert.ok(after.tables.every(t=>t.o===decodeURIComponent(src.username)),'every relation keeps the OWNER role');
  assert.ok(after.functions.some(f=>f.d===true),'SECURITY DEFINER functions are preserved');
  // 3. immutability survives
  await assert.rejects(R2.query('delete from order_legal_acceptances'),/immutable|evidence|not allowed|cannot/i,'legal evidence stays immutable after restore');
  console.log('[h4-restore] PASS '+JSON.stringify({roles,tables:after.tables.length,functions:after.functions.length,triggers:after.triggers.length,missingRoleRestore:'refused atomically, 0 tables left',faithfulRestore:'owners, ACLs, SECURITY DEFINER, triggers, default ACLs, row counts identical',evidenceImmutableAfterRestore:true,productionArchive:'NOT OPENED'}));
}catch(e){console.error('[h4-restore] FAIL:',e instanceof Error?e.message.slice(0,500):String(e));process.exitCode=1}
finally{await R1?.end();await R2?.end();for(const db of made){try{await B.query(`drop database if exists ${db} with (force)`)}catch{}}for(const r of madeRoles){try{await B.query(`drop role if exists ${r}`)}catch{}}await A.end();await B.end();rmSync(dir,{recursive:true,force:true})}
