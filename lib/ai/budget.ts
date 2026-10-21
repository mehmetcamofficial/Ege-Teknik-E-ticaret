import type {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {AiAdviceError,type AiConfig,type BudgetStore} from './gateway.ts';
/** Existing expiry buckets; atomic currency reservations + durable leases across instances. No schema change. */
export function createAiBudget(pool:Pool):BudgetStore{return {async reserve(c:AiConfig,cost:number,leaseMs:number){
 const client=await pool.connect(),lease='ai-b9:lease:'+randomUUID();
 try{await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='2000ms'");await client.query("SELECT pg_advisory_xact_lock(89092026)");
 const {rows:[clock]}=await client.query('SELECT clock_timestamp() as now');const now=new Date(clock.now),day=now.toISOString().slice(0,10),month=day.slice(0,7);
 const active=await client.query("SELECT count(*)::int as n FROM rate_limit_buckets WHERE key LIKE 'ai-b9:lease:%' AND count=1 AND expires_at > $1",[now]);
 if(active.rows[0].n>=c.concurrency!)throw new AiAdviceError(429,'AI_BUSY');
 for(const [key,limit,end]of [[`ai-b9:day:${day}`,c.daily!,new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1))],[`ai-b9:month:${month}`,c.monthly!,new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1))]]as const){
  const result=await client.query('INSERT INTO rate_limit_buckets(key,count,window_started_at,expires_at) SELECT $1,$2::integer,$3::timestamptz,$4::timestamptz WHERE $2::integer <= $5::integer ON CONFLICT(key) DO UPDATE SET count=rate_limit_buckets.count+EXCLUDED.count WHERE rate_limit_buckets.count+EXCLUDED.count <= $5::integer RETURNING key',[key,cost,now,end,limit]);
  if(!result.rowCount)throw new AiAdviceError(429,'AI_BUDGET_EXHAUSTED');
 }
 await client.query("INSERT INTO rate_limit_buckets(key,count,window_started_at,expires_at) VALUES($1,1,clock_timestamp(),clock_timestamp()+$2::integer*interval '1 millisecond')",[lease,leaseMs]);await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
 return async()=>{await pool.query('UPDATE rate_limit_buckets SET count=0 WHERE key=$1',[lease])};
}};}
