import { getAdminUser } from "@/lib/admin-auth";
export async function POST(){if(!await getAdminUser("catalog:write"))return Response.json({error:"Yetkisiz erişim"},{status:403});return Response.json({error:"Dosya yükleme depolama sağlayıcısı FAZ 3'te yapılandırılacak. Bu aşamada güvenilir bir HTTPS görsel URL'si kullanın."},{status:501})}
