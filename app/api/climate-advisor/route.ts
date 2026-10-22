import {getDb} from '@/db';
import {products} from '@/db/schema';
import {eq} from 'drizzle-orm';
import {isCustomerVisibleProduct} from '@/lib/catalog-visibility';
import {readJson,assertSameOrigin,rateLimit,publicRoute} from '@/lib/http-security';
import {aiConfig,aiReady,AiAdviceError} from '@/lib/ai/gateway';
import {aiBudget} from '@/lib/ai/budget-db';
import {climateInput,adviseClimate} from '@/lib/ai/climate-advisor';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'cache-control':'private, no-store'};
export async function GET(){return Response.json({enabled:aiReady(aiConfig()),mode:aiReady(aiConfig())?'available':'AI_DISABLED'},{headers})}
export const POST=publicRoute(async(request:Request)=>{
 assertSameOrigin(request);
 const config=aiConfig();if(!aiReady(config))return Response.json({mode:'AI_DISABLED',error:'AI kapalı; mevcut ön değerlendirmeyi kullanabilirsiniz.'},{status:503,headers});
 const parsed=climateInput.safeParse(await readJson(request,2000));if(!parsed.success)return Response.json({error:'Geçersiz ön değerlendirme bilgisi.'},{status:400,headers});
 await rateLimit(request,'climate-ai',6,60_000);
 try{
  const catalog=(await getDb().select({id:products.id,name:products.name,brandId:products.brandId,category:products.category,capacity:products.capacity,price:products.price,saleMode:products.saleMode}).from(products).where(eq(products.status,'published'))).filter(p=>isCustomerVisibleProduct(p.id));
  return Response.json(await adviseClimate(config,parsed.data,catalog,aiBudget),{headers});
 }catch(e){return Response.json({mode:'fallback',error:'AI önerisi alınamadı. Mevcut ön değerlendirme geçerlidir.'},{status:e instanceof AiAdviceError?e.status:502,headers})}
});
