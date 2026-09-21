export type CatalogDefault = {
  id: string; slug: string; name: string; category: string; series: string;
  capacity: string; energyClass: string; wifi: string; price: number; stock: number;
  saleMode: "online" | "quote"; status: "published"; description: string;
};

const product = (id:string, series:string, name:string, category:string, capacity:string, price:number, stock:number, energyClass:string, wifi:string):CatalogDefault => ({
  id, slug:id, name, category, series, capacity, energyClass, wifi, price, stock,
  saleMode: price > 0 ? "online" : "quote", status:"published",
  description:`${name}; Ege Teknik satış, keşif, montaj ve satış sonrası destek hizmetleriyle sunulur.`,
});

export const catalogDefaults:CatalogDefault[] = [
  product("aphro-09","Aphro","GREE Aphro 9.000 BTU","Duvar Tipi","9.000 BTU",32999,4,"A++","Opsiyonel"),
  product("aphro-12","Aphro","GREE Aphro 12.000 BTU","Duvar Tipi","12.000 BTU",34999,6,"A++","Opsiyonel"),
  product("aphro-18","Aphro","GREE Aphro 18.000 BTU","Duvar Tipi","18.000 BTU",50999,2,"A++","Opsiyonel"),
  product("aphro-24","Aphro","GREE Aphro 24.000 BTU","Duvar Tipi","24.000 BTU",61999,1,"A++","Opsiyonel"),
  product("pular-09","Pular","GREE Pular 9.000 BTU","Duvar Tipi","9.000 BTU",35550,5,"A++","Dahili"),
  product("pular-12","Pular","GREE Pular 12.000 BTU","Duvar Tipi","12.000 BTU",39800,8,"A++","Dahili"),
  product("pular-18","Pular","GREE Pular 18.000 BTU","Duvar Tipi","18.000 BTU",58000,3,"A++","Dahili"),
  product("pular-24","Pular","GREE Pular 24.000 BTU","Duvar Tipi","24.000 BTU",70750,2,"A++","Dahili"),
  product("fairy-12w","Fairy","GREE Fairy 12.000 BTU Beyaz","Duvar Tipi","12.000 BTU",46300,3,"A+++","Dahili"),
  product("fairy-18w","Fairy","GREE Fairy 18.000 BTU Beyaz","Duvar Tipi","18.000 BTU",67990,2,"A+++","Dahili"),
  product("airy-12w","Airy","GREE Airy 12.000 BTU Beyaz","Duvar Tipi","12.000 BTU",58400,2,"A+++","Dahili"),
  product("airy-18b","Airy","GREE Airy 18.000 BTU Siyah","Duvar Tipi","18.000 BTU",87400,1,"A+++","Dahili"),
  product("salon-24","Salon Tipi","GREE Salon Tipi 24.000 BTU","Salon Tipi","24.000 BTU",0,0,"A+","-"),
  product("salon-48","Salon Tipi","GREE Salon Tipi 48.000 BTU","Salon Tipi","48.000 BTU",0,0,"A+","-"),
  product("ishine-24","I-Shine","GREE I-Shine 24.000 BTU","Salon Tipi","24.000 BTU",0,0,"A++","Dahili"),
  product("multi-18","Free Match","GREE Multi Dış Ünite 18.000 BTU","Multi Sistem","18.000 BTU",0,0,"A++","-"),
  product("multi-24","Free Match","GREE Multi Dış Ünite 24.000 BTU","Multi Sistem","24.000 BTU",0,0,"A++","-"),
  product("cassette-48","Kaset Tipi","GREE Kaset Tipi Ticari Klima 48.000 BTU","Ticari Klima","48.000 BTU",0,0,"A+","-"),
  product("duct-48","Kanal Tipi","GREE Kanal Tipi Ticari Klima 48.000 BTU","Ticari Klima","48.000 BTU",0,0,"A+","-"),
  product("versati-8","Versati III","GREE Versati III Split 8 kW","Isı Pompası","8 kW",0,0,"A+++","Dahili"),
  product("versati-16","Versati IV","GREE Versati IV Monoblok 16 kW","Isı Pompası","16 kW",0,0,"A+++","Dahili"),
  product("wifi-aphro","Aksesuar","GREE Aphro Wi-Fi Kiti","Yedek Parça","Aphro uyumlu",0,0,"-","-"),
  product("filter-air","Filtre","GREE Hava Temizleme Cihazı Filtresi","Yedek Parça","Filtre",0,0,"-","-"),
  product("filter-multi","Filtre","GREE Multi Fonksiyonel Filtre","Yedek Parça","Filtre",0,0,"-","-"),
];
