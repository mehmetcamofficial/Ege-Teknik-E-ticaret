import test from 'node:test';import assert from 'node:assert/strict';import pg from 'pg';
import {createAiBudget} from '../lib/ai/budget.ts';import type {AiConfig} from '../lib/ai/gateway.ts';
const url=process.env.B9_TEST_DATABASE_URL;
test('B9 PostgreSQL atomic daily/monthly budget, lease concurrency and fail-closed storage',{skip:!url},async()=>{
 const target=new URL(url!);assert.ok(['127.0.0.1','localhost','[::1]'].includes(target.hostname),'loopback only');assert.notEqual(target.port,'55432','never the recovery cluster');assert.ok(target.pathname.startsWith('/sprintb_b9'));
 const pool=new pg.Pool({connectionString:url}),store=createAiBudget(pool),c:AiConfig={enabled:true,daily:300,monthly:1000,concurrency:2};
 const reset=()=>pool.query("DELETE FROM rate_limit_buckets WHERE key LIKE 'ai-b9:%'");
 try{await reset();const results=await Promise.allSettled(Array.from({length:10},()=>store.reserve(c,100,10000)));const allowed=results.filter((r):r is PromiseFulfilledResult<()=>Promise<void>>=>r.status==='fulfilled');assert.equal(allowed.length,2);await Promise.all(allowed.map(r=>r.value()));const release=await store.reserve(c,100,10000);await release();await assert.rejects(store.reserve(c,1,10000),/AI_BUDGET_EXHAUSTED/);
 const day=await pool.query("SELECT count FROM rate_limit_buckets WHERE key LIKE 'ai-b9:day:%'");assert.equal(day.rows[0].count,300);
 await reset();const m={...c,daily:1000,monthly:100};await(await store.reserve(m,100,10000))();await assert.rejects(store.reserve(m,1,10000),/AI_BUDGET_EXHAUSTED/);const rollback=await pool.query("SELECT count FROM rate_limit_buckets WHERE key LIKE 'ai-b9:day:%'");assert.equal(rollback.rows[0].count,100,'monthly failure rolls daily claim back');
 await reset();await store.reserve({...c,concurrency:1},50,10000);await assert.rejects(store.reserve({...c,concurrency:1},50,10000),/AI_BUSY/);await pool.query("UPDATE rate_limit_buckets SET expires_at=now()-interval '1 second' WHERE key LIKE 'ai-b9:lease:%'");await(await store.reserve({...c,concurrency:1},50,10000))();
 }finally{await reset();await pool.end()}
 await assert.rejects(store.reserve(c,1,10000));
});
