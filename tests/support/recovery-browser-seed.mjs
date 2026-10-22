import assertSetup from 'node:assert/strict';
import pgSetup from 'pg';
import {readFile as readSetup} from 'node:fs/promises';
import {drizzle as drizzleSetup} from 'drizzle-orm/node-postgres';
import {migrate as migrateSetup} from 'drizzle-orm/node-postgres/migrator';
import {bootstrapDisposableDatabase as bootstrapSetup,defaultStageDeps as depsSetup} from '../../scripts/disposable-postgres-bootstrap.mjs';
assertSetup.equal(process.env.CI,'true');
const fixtureUrl='postgresql://recovery_owner@127.0.0.1:55489/sprintb_recovery_browser';
const emptyProbe=new pgSetup.Pool({connectionString:fixtureUrl});
try { assertSetup.equal((await emptyProbe.query("select count(*)::int n from pg_tables where schemaname in ('public','drizzle')")).rows[0].n,0,'Refusing existing populated fixture; create a new isolated cluster/database first'); } finally { await emptyProbe.end(); }
await bootstrapSetup({Pool:pgSetup.Pool,drizzle:drizzleSetup,migrate:migrateSetup,url:fixtureUrl,journal:JSON.parse(await readSetup('drizzle-pg/meta/_journal.json')),migrationsFolder:'drizzle-pg',...depsSetup});
/** Synthetic local recovery fixture only; no remote database configuration. */
import pg from'pg';import{randomBytes,createHash}from'node:crypto';import{writeFile}from'node:fs/promises';import{hashLegalDocument}from'../../lib/legal.ts';const p=new pg.Pool({connectionString:'postgresql://recovery_owner@127.0.0.1:55489/sprintb_recovery_browser'});const sessions={};for(const role of['super_admin','catalog_manager','viewer']){const id='blocker-'+role,token=randomBytes(32).toString('base64url');await p.query('insert into admin_users(id,external_user_id,email,role) values($1,$2,$3,$4)',[id,id,id+'@example.test',role]);await p.query("insert into admin_sessions(id,admin_user_id,token_hash,expires_at) values($1,$2,$3,now()+interval '2 hours')",[id,id,createHash('sha256').update(token).digest('hex')]);sessions[role]=token}await writeFile('.recovery-private/sessions.json',JSON.stringify(sessions),{mode:0o600});for(const id of['airy-12000-btu-h','airy-9000-btu-h','airy-18000-btu-h']){await p.query("insert into products(id,slug,name,category,price,status,sale_mode,delivery_class,capacity) values($1,$1,$2,'Duvar Tipi',10000,'published','online','shippable','12000 BTU/h')",[id,'Sentetik kabul ürünü — '+id]);await p.query("insert into inventory(id,product_id,on_hand,reserved) values($1,$1,100,0)",[id])}for(const slug of['distance-sales','pre-information','kvkk']){const title='Disposable '+slug,body='Yalnız bu disposable test ortamındaki sentetik hukuk kabul metni. Gerçek müşteri veya Production hukuk yayını değildir.';await p.query('insert into legal_documents(id,slug) values($1,$2)',['blocker-authority-'+slug,slug]);await p.query("insert into legal_document_versions(id,document_id,version,title,body,content_hash,effective_at,published_at,published_by) values($1,$2,1,$3,$4,$5,'2020-01-01','2020-01-01','owner-1')",['blocker-version-'+slug,'blocker-authority-'+slug,title,body,hashLegalDocument({title,body})])}await p.end();console.log('Synthetic fixture and private sessions created; no secrets printed');

const reviewedRecords=JSON.parse(await readSetup('data/catalog-enrichment/catalog-enrichment.v1.json')).records;
const fixturePool=new pgSetup.Pool({connectionString:fixtureUrl});
try { await fixturePool.query("insert into brands(id,name,slug) values('gree','GREE','gree')");
for (const id of ['airy-9000-btu-h','airy-12000-btu-h','airy-18000-btu-h']) {
 const record=reviewedRecords[id];
 await fixturePool.query('update products set brand_id=$1,series=$2,capacity=$3,image_url=$4,gallery=$5::jsonb,specifications=$6::jsonb,energy_class=$7 where id=$8',['gree','Airy',id.includes('9000')?'9000 BTU/h':id.includes('18000')?'18000 BTU/h':'12000 BTU/h',record.imageUrl,JSON.stringify(record.gallery),JSON.stringify(record.specifications),record.energyClass,id]);
} } finally { await fixturePool.end(); }
