import { getAdminUser } from "@/lib/admin-auth";
import { secondHandProducts } from "@/db/schema";
import { auditedMutation } from "@/lib/admin-audited";
import { readJson } from "@/lib/http-security";
import { secondHandPublishBlockers } from "@/lib/second-hand-policy";
import { secondHandSchema } from "./schema";

export async function POST(request:Request){
  const user=await getAdminUser("catalog:write"); if(!user)return Response.json({error:"Yetkisiz erişim"},{status:403});
  const parsed=secondHandSchema.safeParse(await readJson(request)); if(!parsed.success)return Response.json({error:"İkinci el ürün alanlarını kontrol edin."},{status:400});
  // P3-LEGAL-USED-01: tam ürün üzerinde yayın kapısı (taslak eksik bilgiyle kaydedilebilir).
  const blockers=secondHandPublishBlockers(parsed.data);
  if(blockers.length)return Response.json({error:blockers[0],blockers},{status:422});
  const id=crypto.randomUUID(); await auditedMutation(user,{action:"create",entityType:"second_hand_product",entityId:id,payload:parsed.data},async(tx)=>{await tx.insert(secondHandProducts).values({id,...parsed.data})});
  return Response.json({ok:true,id},{status:201});
}
