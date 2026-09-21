import { env } from "cloudflare:workers";
import { getAdminUser } from "@/lib/admin-auth";
const allowed=new Set(["image/jpeg","image/png","image/webp","image/avif"]);
export async function POST(request:Request){if(!await getAdminUser())return Response.json({error:"Yetkisiz erişim"},{status:403});const form=await request.formData(),file=form.get("file");if(!(file instanceof File)||!allowed.has(file.type)||file.size>5_000_000)return Response.json({error:"JPG, PNG, WebP veya AVIF; en fazla 5 MB yükleyin."},{status:400});const ext=file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg",key=`catalog/${crypto.randomUUID()}.${ext}`;await env.MEDIA.put(key,await file.arrayBuffer(),{httpMetadata:{contentType:file.type}});return Response.json({ok:true,url:`/api/media/${key}`})}
