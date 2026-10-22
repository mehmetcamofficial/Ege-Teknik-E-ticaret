import {z} from 'zod';
import {gatewayDecision,type AiConfig,type BudgetStore} from './gateway.ts';
export const climateInput=z.object({area:z.number().min(5).max(200),people:z.number().int().min(1).max(30),height:z.number().min(2).max(6),type:z.enum(['salon','yatak','cocuk','magaza','ofis','diger']),sun:z.enum(['shade','normal','sunny','unknown']),insulation:z.enum(['normal','good','weak','unknown']),locationKnown:z.boolean(),budget:z.number().positive().max(10_000_000).optional()}).strict();
export type ClimateInput=z.infer<typeof climateInput>;
export type CatalogProduct={id:string;brandId:string|null;category:string;capacity:string;price:number;saleMode:string;name:string};
/** Same B6 reference chart and scope; regression-tested against the browser estimator. No climate coefficient inferred. */
export function climateEstimate(v:ClimateInput){
 const feet=v.area*10.7639104167,base=[[150,5000],[250,6000],[300,7000],[350,8000],[400,9000],[450,10000],[500,12000],[700,14000],[1000,18000]].find(([limit])=>feet<=limit)?.[1],sun={shade:.9,normal:1,sunny:1.1,unknown:0}[v.sun];
 const raw=base?Math.round(base*(sun||1)+Math.max(0,v.people-2)*600):null,capacity=raw?[9000,12000,18000,24000].find(n=>n>=raw)||null:null;
 const survey=feet<100||!base||v.area>60||!['salon','yatak','cocuk'].includes(v.type)||v.height>2.8||!['normal','good'].includes(v.insulation)||!sun||!v.locationKnown||!!(raw&&raw<8000)||!capacity;
 return {raw,capacity,survey};
}
export function climateCandidates(products:CatalogProduct[],v:ClimateInput){const result=climateEstimate(v);return {result,products:result.survey?[]:products.filter(p=>p.brandId==='gree'&&p.category==='Duvar Tipi'&&/btu/i.test(p.capacity)&&Number(p.capacity.replace(/\D/g,''))===result.capacity&&(!v.budget||(p.saleMode==='online'&&p.price>0&&p.price<=v.budget))).slice(0,4)}}
const reasons={capacity:'Kapasite sınıfı mevcut ön değerlendirmeyle eşleşiyor.',budget:'Belirttiğiniz bütçe filtresi gerçek katalog fiyatlarına uygulandı.',survey:'Eksik teknik koşulları profesyonel keşifle doğrulayın.'};
export async function adviseClimate(c:AiConfig,v:ClimateInput,products:CatalogProduct[],store:BudgetStore,fetcher:typeof fetch=fetch){
 const {result,products:eligible}=climateCandidates(products,v);if(result.survey||!eligible.length)return {mode:'deterministic',...result,productIds:[],reason:reasons.survey};
 // Provider receives opaque indexes and public, verified numeric facts; never PII, free text or customer budget.
 const output=await gatewayDecision(c,{task:'climate',capacity:result.capacity,budgetApplied:!!v.budget,candidates:eligible.map((_,i)=>i),allowedReasons:Object.keys(reasons)},store,fetcher);
 const parsed=z.object({indices:z.array(z.number().int().min(0).max(eligible.length-1)).min(1).max(4),reason:z.enum(['capacity','budget','survey'])}).strict().safeParse(output);
 if(!parsed.success||(!v.budget&&parsed.data.reason==='budget')||new Set(parsed.data.indices).size!==parsed.data.indices.length)throw new Error('AI_INVALID_RECOMMENDATION');
 return {mode:'assisted',...result,productIds:parsed.data.indices.map(i=>eligible[i].id),reason:reasons[parsed.data.reason]};
}
