/** H5-B: regenerates docs/h5/rbac-matrix.md from lib/security-policy.ts (the code is the source of truth). */
import{writeFileSync}from'node:fs';
import{adminPermissions,adminRoles,maxGrantTtlHours,permissionForOrderStatus}from'../lib/security-policy.ts';
import{orderStatuses}from'../lib/order-domain.ts';
const labels={super_admin:'Süper Yönetici',admin:'Yönetici',owner:'Sahip (emekli, atanamaz)',operations_manager:'Operasyon Yöneticisi',catalog_manager:'Katalog Yöneticisi',support_agent:'Destek Uzmanı',finance_manager:'Finans Sorumlusu (YENİ)',viewer:'İzleyici'};
const perms=[...new Set(adminRoles.flatMap(r=>adminPermissions[r]))].sort();
const row=(r)=>`| ${labels[r]} (\`${r}\`) | ${perms.map(p=>adminPermissions[r].includes(p)?'●':'').join(' | ')} |`;
const money=['payments:record','payments:refund'];
let md=`# H5-B — İzin matrisi (koddan üretilmiştir)\n\nKaynak: \`lib/security-policy.ts\` · yeniden üretim: \`node --experimental-strip-types scripts/h5-rbac-matrix.mjs\`\n\n## Roller × izinler (● = rol kendi başına taşır)\n\n| Rol | ${perms.join(' | ')} |\n|---|${perms.map(()=>'---').join('|')}|\n${adminRoles.map(row).join('\n')}\n\n## Sipariş durumu geçişi için gereken izin\n\n| Hedef durum | Gereken izin |\n|---|---|\n${orderStatuses.map(s=>`| \`${s}\` | \`${permissionForOrderStatus(s)}\`${s==='paid'?' + defterde toplam tutarın tamamını kapsayan tahsilat':''} |`).join('\n')}\n\n## Süreli yetki tavanları (saat)\n\n| İzin | En fazla |\n|---|---|\n${money.concat(['orders:write','users:write','payments:configure']).map(p=>`| \`${p}\` | ${maxGrantTtlHours(p)===0?'verilemez':maxGrantTtlHours(p)} |`).join('\n')}\n`;
writeFileSync('docs/h5/rbac-matrix.md',md);console.log('written',perms.length,'permissions',adminRoles.length,'roles');
