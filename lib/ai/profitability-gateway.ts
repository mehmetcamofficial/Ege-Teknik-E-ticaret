/** Existing super-admin API contract, with shared fail-closed budget controls. */
import {gatewayDecision,type AiConfig,type BudgetStore} from './gateway.ts';
export {aiConfig,aiReady,AiAdviceError} from './gateway.ts';
export type {AiConfig} from './gateway.ts';
export type AdviceInput={question:string};
const advice={costs:'Net kâr için doğrulanmış alış, montaj, kargo, KDV ve komisyon maliyetleri gerekir. Eksik maliyetlerle net kâr hesaplanamaz.',cashflow:'Sipariş tutarı tahsilat değildir. Kayıtlı tahsilat, iade ve bekleyen bakiye ayrımını finans ekranında kontrol edin.',operations:'Stok ve servis kayıtlarını yetkili operasyon ekranında doğrulayın. Bu öneri hiçbir kaydı değiştirmez.'};
export async function generateProfitAdvice(config:AiConfig,question:string,fetcher:typeof fetch=fetch,budget?:BudgetStore):Promise<string>{
 if(!question.trim()||question.length>1000)throw new Error('Geçersiz soru.');
 if(!budget)throw new Error('AI_DISABLED');
 const topic=/stok|servis|sipariş/i.test(question)?'operations':/tahsil|iade|nakit/i.test(question)?'cashflow':'costs';
 // No free question, financial rows or identifiers leave this server.
 const output=await gatewayDecision(config,{task:'admin',topic,allowedFocus:Object.keys(advice),costsVerified:false},budget,fetcher);
 if(!output||typeof output!=='object'||Array.isArray(output)||Object.keys(output).length!==1||!('focus'in output)||typeof output.focus!=='string'||!Object.hasOwn(advice,output.focus))throw new Error('AI_INVALID_OUTPUT');
 return advice[output.focus as keyof typeof advice];
}
