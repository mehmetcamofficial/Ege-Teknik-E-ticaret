import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
const {Pool}=pg;
const url=process.env.DATABASE_URL_UNPOOLED,target=process.env.MIGRATION_TARGET_ENV,branch=process.env.NEON_BRANCH_ID;
if(!url||!target||!branch)throw new Error("DATABASE_URL_UNPOOLED, MIGRATION_TARGET_ENV and NEON_BRANCH_ID are required.");
if(!["development","preview","production"].includes(target))throw new Error("Invalid MIGRATION_TARGET_ENV.");
if(target==="production"&&process.env.ALLOW_PRODUCTION_MIGRATION!=="I_UNDERSTAND_PRODUCTION")throw new Error("Production migration is blocked.");
const expected=process.env[`EXPECTED_NEON_${target.toUpperCase()}_BRANCH_ID`];
if(!expected||expected!==branch)throw new Error("Migration target does not match the expected Neon branch.");
const pool=new Pool({connectionString:url,max:1,ssl:{rejectUnauthorized:true}});
try{await migrate(drizzle(pool),{migrationsFolder:"drizzle-pg"});console.log(`Migration completed for ${target} (${branch}).`)}finally{await pool.end()}
