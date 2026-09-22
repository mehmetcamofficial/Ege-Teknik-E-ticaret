import { getPool } from "@/db";
export const dynamic="force-dynamic";
export async function GET(){try{await getPool().query("select 1");return Response.json({ok:true,environment:process.env.APP_ENV,branchId:process.env.NEON_BRANCH_ID},{headers:{"cache-control":"no-store"}})}catch(error){console.error("health_check_failed",{name:error instanceof Error?error.name:"unknown"});return Response.json({ok:false},{status:503,headers:{"cache-control":"no-store"}})}}
