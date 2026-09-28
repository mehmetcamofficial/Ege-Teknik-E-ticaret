// Klima Rehberi — seçim ve kapasite rehberleri.
// Ürün özellikleri yalnız GREE Türkiye ürün sayfalarından doğrulanmış katalog verisine
// (data/catalog-enrichment) dayanır; fiyat hiçbir rehberde yazılmaz, katalogdan okunur.

export const selectionGuides = [
  {
    slug: "klima-secimi-rehberi",
    category: "secim",
    title: "Klima Seçerken Nelere Dikkat Edilmeli?",
    seoTitle: "Klima Seçerken Nelere Dikkat Edilmeli? 7 Adımlı Rehber",
    description: "Kapasite, enerji sınıfı, inverter, Wi-Fi, montaj ve servis: klima alırken karar vermeniz gereken yedi başlığı sade bir kontrol listesiyle anlatıyoruz.",
    lead: "Doğru klima; en pahalı ya da en güçlü olan değil, mekânınıza, kullanım alışkanlığınıza ve bütçenize uyan klimadır. Karar verirken şu yedi başlığı sırayla ele alın.",
    answer: "Önce mekânın ihtiyacı olan kapasiteyi (BTU/h) belirleyin, sonra enerji sınıfını, özellikleri ve montaj koşullarını karşılaştırın. Kapasite doğru değilse diğer özelliklerin hiçbiri beklediğiniz konforu vermez.",
    image: { key: "airyBeyaz", alt: "Beyaz GREE Airy duvar tipi inverter klima", caption: "Duvar tipi split klimalar ev ve küçük ofislerde en yaygın tercihtir." },
    sections: [
      { id: "kapasite", title: "1. Kapasiteyi mekâna göre belirleyin", html: `
<p>Klimanın gücü BTU/h ile ifade edilir. Küçük kalan bir klima sürekli tam güçte çalışır ve odayı yine de yeterince soğutamaz; gereğinden büyük bir klima ise kısa aralıklarla devreye girip çıkar, nemi yeterince alamaz ve boşuna pahalıdır.</p>
<p>Kapasiteyi yalnız metrekareye bakarak seçmeyin. Güneş alan cephe, cam yüzeyi, yalıtım, tavan yüksekliği ve odada bulunan kişi sayısı sonucu değiştirir. <a href="rehber/klima-btu-hesaplama.html">BTU hesaplama rehberimiz</a> bu etkenleri tek tek açıklıyor.</p>` },
      { id: "tip", title: "2. Klima tipini seçin", html: `
<ul class="g-list">
<li><b>Duvar tipi split:</b> Yatak odası, oturma odası ve küçük ofisler için standart çözüm. <a href="catalog.html?category=Duvar%20Tipi">Duvar tipi klimalar</a></li>
<li><b>Salon tipi:</b> Geniş ve yüksek tavanlı salonlarda, duvarda yer olmayan alanlarda. <a href="rehber/salon-tipi-klima.html">Ne zaman tercih edilir?</a></li>
<li><b>Multi sistem:</b> Tek dış üniteye birden fazla iç ünite bağlanır; cephede tek cihaz görünür. <a href="rehber/multi-sistem-klima-nedir.html">Multi sistem nedir?</a></li>
<li><b>Ticari tipler:</b> Kaset ve yer/tavan tipi; mağaza, restoran ve ofis gibi geniş alanlar için. <a href="catalog.html?category=Ticari%20Klima">Ticari klimalar</a></li>
</ul>` },
      { id: "enerji", title: "3. Enerji sınıfını ve SEER/SCOP değerini karşılaştırın", html: `
<p>Enerji etiketi, klimanın sezon boyunca ne kadar verimli çalıştığını gösterir. Soğutma için SEER, ısıtma için SCOP değeri ne kadar yüksekse aynı iş için o kadar az elektrik harcanır. Yaz boyunca uzun saatler çalışan bir klimada bu fark faturaya doğrudan yansır.</p>
<p>Etiketi nasıl okuyacağınızı <a href="rehber/enerji-sinifi-seer-scop.html">enerji sınıfı ve SEER/SCOP rehberinde</a> anlattık.</p>` },
      { id: "ozellikler", title: "4. İhtiyacınız olan özellikleri ayırın", html: `
<p>Inverter teknolojisi bugün duvar tipi klimaların neredeyse tamamında standarttır ve kompresör hızını ihtiyaca göre ayarlayarak enerji tasarrufu sağlar (<a href="rehber/inverter-klima-nedir.html">inverter nasıl çalışır?</a>). Bunun dışında şu sorular seçiminizi daraltır:</p>
<ul class="g-checklist">
<li>Klimayı eve gelmeden açmak veya uzaktan kontrol etmek ister misiniz? Wi-Fi özelliğine bakın.</li>
<li>Toz ve evcil hayvan tüyü sizin için önemli mi? Filtre donanımını karşılaştırın.</li>
<li>Yatak odasında mı kullanılacak? Ürün sayfasındaki iç ünite ses değerini kontrol edin.</li>
<li>Kış aylarında ısıtmada da kullanacak mısınız? SCOP değerine bakın.</li>
</ul>` },
      { id: "montaj", title: "5. Montaj koşullarını baştan netleştirin", html: `
<p>Klimanın performansı büyük ölçüde montaja bağlıdır. Dış ünitenin yeri, iç ve dış ünite arasındaki boru mesafesi, elektrik hattı ve drenaj yolu satın almadan önce düşünülmelidir. Apartmanlarda dış cephe kullanımı için yönetim onayı gerekebilir.</p>
<p>Ayrıntılar için <a href="rehber/klima-montaji-oncesi.html">montaj öncesi bilinmesi gerekenler</a> rehberine göz atın. Emin olmadığınız durumlarda <a href="contact.html?subject=kesif">yerinde keşif isteyin</a>.</p>` },
      { id: "servis", title: "6. Servis ve garanti erişimini sorun", html: `
<p>Klima yıllarca kullanılan bir cihazdır. Bulunduğunuz ilde bir servis organizasyonunun bulunması, periyodik bakımın ve olası bir arızanın hızlı çözülmesini sağlar. Ege Teknik; İzmir, Aydın, Muğla, Manisa, Denizli, Uşak, Afyonkarahisar, Kütahya ve Balıkesir'de satış, montaj ve servis taleplerini planlar. <a href="regions.html">Hizmet bölgelerimizi görün.</a></p>` },
      { id: "butce", title: "7. Toplam maliyeti düşünün", html: `
<p>Karşılaştırmayı yalnız etiket fiyatıyla yapmayın. Montaj kapsamı, ek boru veya elektrik işi gerekip gerekmediği ve yıllık enerji tüketimi toplam maliyeti belirler. Verimli bir model başlangıçta biraz daha pahalı olsa da yoğun kullanımda farkı zamanla telafi edebilir.</p>
<p>Güncel fiyatları ve stok durumunu <a href="catalog.html">ürün kataloğumuzda</a> görebilir, serileri <a href="rehber/gree-serileri-karsilastirma.html">GREE seri karşılaştırmasında</a> yan yana inceleyebilirsiniz.</p>` },
    ],
    faq: [
      ["Klima seçerken en önemli kriter nedir?", "Kapasitenin (BTU/h) mekâna uygun olmasıdır. Kapasite doğru seçilmezse enerji sınıfı veya ek özellikler beklenen konforu sağlamaz."],
      ["Online kapasite hesabı yeterli mi?", "Ön fikir için yeterlidir. Çok güneş alan, geniş camlı, yüksek tavanlı veya ticari mekânlarda kesin kapasite yerinde keşifle belirlenmelidir."],
    ],
    related: ["klima-btu-hesaplama", "gree-serileri-karsilastirma", "yerinde-kesif-neden-onemli"],
    products: [
      { label: "Duvar tipi klimalar", href: "catalog.html?category=Duvar%20Tipi" },
      { label: "Salon tipi klimalar", href: "catalog.html?category=Salon%20Tipi" },
      { label: "Ticari klimalar", href: "catalog.html?category=Ticari%20Klima" },
    ],
  },

  {
    slug: "klima-btu-hesaplama",
    category: "secim",
    title: "BTU Nedir? Odaya Göre Klima Kapasitesi Nasıl Hesaplanır?",
    seoTitle: "BTU Nedir, Klima Kapasitesi Nasıl Hesaplanır?",
    description: "BTU/h ne demek, kaç m² için kaç BTU gerekir? Güneş, yalıtım ve kişi sayısının kapasiteye etkisini örnek hesaplarla anlatıyoruz.",
    lead: "Klima kataloglarında gördüğünüz 9.000, 12.000 veya 24.000 rakamları cihazın soğutma gücünü BTU/h cinsinden gösterir. Doğru kapasiteyi bulmak için alanın yanında birkaç etkeni daha hesaba katmak gerekir.",
    answer: "Ortalama güneş ve yalıtım koşullarında metrekare başına yaklaşık 500 BTU/h ile başlanır; güneş alan cephe, zayıf yalıtım ve kalabalık kullanım bu değeri artırır. Sonuç en yakın üst standart kapasiteye yuvarlanır.",
    image: { key: "btuOlcek", alt: "9.000, 12.000, 18.000 ve 24.000 BTU/h kapasitelerin oda büyüklüğüyle ilişkisini gösteren çizim", caption: "Kapasite arttıkça klimanın ortalama koşullarda karşılayabildiği alan büyür." },
    sections: [
      { id: "btu-nedir", title: "BTU ve BTU/h ne demek?", html: `
<p>BTU (British Thermal Unit) bir ısı enerjisi birimidir; yaklaşık 1,055 kilojoule'e karşılık gelir. Klimalarda kullanılan <b>BTU/h</b> ise cihazın bir saatte ortamdan uzaklaştırabildiği ısı miktarını, yani soğutma gücünü anlatır.</p>
<p>Kilowatt ile karşılaştırmak isterseniz 12.000 BTU/h yaklaşık 3,5 kW soğutma gücüne eşittir. Bu değer, cihazın çektiği elektrik gücü değildir; klimanın ürettiği soğutma kapasitesidir.</p>
<div class="g-table-wrap"><table class="g-table"><caption>Standart kapasitelerin yaklaşık kW karşılığı</caption><thead><tr><th scope="col">Kapasite</th><th scope="col">Yaklaşık soğutma gücü</th></tr></thead><tbody>
<tr><td>9.000 BTU/h</td><td>2,6 kW</td></tr><tr><td>12.000 BTU/h</td><td>3,5 kW</td></tr><tr><td>18.000 BTU/h</td><td>5,3 kW</td></tr><tr><td>24.000 BTU/h</td><td>7,0 kW</td></tr></tbody></table></div>` },
      { id: "hesaplama", title: "Kapasite nasıl hesaplanır?", html: `
<p>Ege Teknik <a href="selector.html">Klima Seçici</a> aracı, ortalama bir oda için metrekare başına yaklaşık 500 BTU/h ile başlar ve sonucu şu etkenlerle düzeltir:</p>
<ul class="g-list">
<li><b>Güneş durumu:</b> Kuzey cephede ihtiyaç yaklaşık %10 azalır; güney veya batı cephede ya da geniş cam yüzeylerde %20 artar.</li>
<li><b>Yalıtım:</b> İyi yalıtım ve çift cam ihtiyacı yaklaşık %10 azaltır; yalıtımsız veya eski yapılarda %20 artar.</li>
<li><b>Kişi sayısı:</b> İki kişinin üzerindeki her kişi için yaklaşık 500 BTU/h eklenir.</li>
</ul>
<p>Hesaplanan değer en yakın üst standart kapasiteye (9.000, 12.000, 18.000 veya 24.000 BTU/h) yuvarlanır. Sonuç iki kapasitenin sınırına çok yakınsa iki seçenek birlikte değerlendirilir.</p>` },
      { id: "ornekler", title: "Örnek hesaplar", html: `
<div class="g-table-wrap"><table class="g-table"><caption>Aynı formülle üç farklı oda</caption><thead><tr><th scope="col">Oda</th><th scope="col">Hesap</th><th scope="col">Sonuç</th></tr></thead><tbody>
<tr><td>16 m² kuzey cepheli yatak odası, iyi yalıtım, 2 kişi</td><td>16 × 500 × 0,9 × 0,9 ≈ 6.480</td><td>9.000 BTU/h</td></tr>
<tr><td>22 m² oturma odası, normal güneş ve yalıtım, 3 kişi</td><td>22 × 500 + 500 = 11.500</td><td>12.000 BTU/h (sınıra yakın)</td></tr>
<tr><td>30 m² batı cepheli salon, orta yalıtım, 4 kişi</td><td>30 × 500 × 1,2 + 1.000 = 19.000</td><td>24.000 BTU/h</td></tr>
</tbody></table></div>
<p>İkinci örnekte sonuç 12.000 BTU/h sınırına çok yakın olduğu için Klima Seçici 12.000–18.000 aralığını gösterir ve yerinde değerlendirme önerir.</p>` },
      { id: "dikkat", title: "Hesabın yetmediği durumlar", html: `
<p>Formül tipik konut odaları içindir. Şu durumlarda sonucu mutlaka yerinde doğrulatın:</p>
<ul class="g-checklist">
<li>Tavan yüksekliği 3 metreyi aşıyorsa veya mekân çift katlı (galerili) ise</li>
<li>Mutfakla birleşik, açık planlı ve birden fazla odaya yayılan alanlarda</li>
<li>Mağaza, ofis, restoran gibi cihaz ve insan yükü yüksek ticari mekânlarda</li>
<li>Çatı katı veya tamamen cam cepheli mekânlarda</li>
</ul>
<p>Bu tür alanlar için <a href="rehber/yerinde-kesif-neden-onemli.html">yerinde keşfin neden önemli olduğunu</a> anlattığımız rehbere göz atın.</p>` },
    ],
    faq: [
      ["20 m² oda için kaç BTU klima gerekir?", "Ortalama güneş ve yalıtım koşullarında yaklaşık 10.000 BTU/h ihtiyaç çıkar; bu da 12.000 BTU/h kapasiteye karşılık gelir. Kuzey cepheli ve iyi yalıtımlı bir odada 9.000 BTU/h yeterli olabilir."],
      ["Büyük kapasite almak zarar verir mi?", "Gereğinden büyük klima odayı hızla soğutup sık sık durur; bu da nem alma performansını düşürür ve konforu azaltır. İlk yatırım maliyeti de gereksiz yere artar."],
      ["BTU/h değeri elektrik tüketimi midir?", "Hayır. BTU/h klimanın soğutma kapasitesidir. Elektrik tüketimi ürün sayfasındaki güç tüketimi (W) ve SEER değeriyle değerlendirilir."],
    ],
    related: ["btu-kapasite-farklari", "enerji-sinifi-seer-scop", "yerinde-kesif-neden-onemli"],
    products: [
      { label: "9.000 BTU/h modeller", href: "catalog.html?btu=9000" },
      { label: "12.000 BTU/h modeller", href: "catalog.html?btu=12000" },
      { label: "18.000 BTU/h modeller", href: "catalog.html?btu=18000" },
      { label: "24.000 BTU/h modeller", href: "catalog.html?btu=24000" },
    ],
  },

  {
    slug: "btu-kapasite-farklari",
    category: "secim",
    title: "9.000, 12.000, 18.000 ve 24.000 BTU Klima Farkları",
    seoTitle: "9000, 12000, 18000, 24000 BTU Klima Kaç m²'ye Uygun?",
    description: "9.000, 12.000, 18.000 ve 24.000 BTU/h klimalar kaç m² için uygun? Ortalama koşullarda karşıladıkları alanları tek tabloda karşılaştırın.",
    lead: "Duvar tipi klimalar genellikle dört standart kapasitede üretilir. Aralarındaki fark yalnız güç değil; hangi mekâna uygun oldukları, iç ünite boyutu ve elektrik tüketimi de değişir.",
    answer: "Ortalama koşullarda 9.000 BTU/h yaklaşık 18 m²'ye, 12.000 BTU/h 24 m²'ye, 18.000 BTU/h 36 m²'ye ve 24.000 BTU/h 48 m²'ye kadar olan alanlar için uygundur. Güneş ve yalıtım bu değerleri belirgin biçimde değiştirir.",
    image: { key: "fairy", alt: "Beyaz GREE Fairy duvar tipi inverter klima", caption: "GREE Fairy serisi 9.000'den 24.000 BTU/h'ye kadar dört kapasitede sunulur." },
    sections: [
      { id: "tablo", title: "Kapasiteye göre uygun alanlar", html: `
<p>Aşağıdaki değerler, Klima Seçici'de kullandığımız metrekare başına yaklaşık 500 BTU/h yaklaşımıyla hesaplanmıştır. Parantez içindeki aralık, çok güneş alan ve zayıf yalıtımlı bir oda ile kuzey cepheli, iyi yalıtımlı bir oda arasındaki farkı gösterir.</p>
<div class="g-table-wrap"><table class="g-table"><caption>Ortalama koşullarda kapasite ve alan</caption><thead><tr><th scope="col">Kapasite</th><th scope="col">Ortalama koşullarda</th><th scope="col">Tipik kullanım</th></tr></thead><tbody>
<tr id="btu-9000"><td><b>9.000 BTU/h</b></td><td>≈ 18 m² (12–22 m²)</td><td>Yatak odası, çocuk odası, çalışma odası</td></tr>
<tr id="btu-12000"><td><b>12.000 BTU/h</b></td><td>≈ 24 m² (17–30 m²)</td><td>Oturma odası, geniş yatak odası, küçük salon</td></tr>
<tr id="btu-18000"><td><b>18.000 BTU/h</b></td><td>≈ 36 m² (25–44 m²)</td><td>Salon, mutfakla birleşik oturma alanı</td></tr>
<tr id="btu-24000"><td><b>24.000 BTU/h</b></td><td>≈ 48 m² (33–59 m²)</td><td>Geniş ve açık plan salon, güneş alan cephe</td></tr>
</tbody></table></div>
<p>Kendi odanız için sonucu <a href="selector.html">Klima Seçici</a> ile birkaç saniyede hesaplayabilirsiniz.</p>` },
      { id: "9000", title: "9.000 BTU/h: küçük odalar için", html: `
<p>Yatak odası ve çalışma odası gibi 20 m² civarı ve altındaki alanlar için yeterlidir. Kompakt iç ünitesi ve düşük güç tüketimiyle gece kullanımında da tercih edilir. Güneye bakan, geniş camlı küçük odalarda 12.000 BTU/h daha doğru olabilir.</p>
<p><a class="g-inline-cta" href="catalog.html?btu=9000">9.000 BTU/h modelleri görün</a></p>` },
      { id: "12000", title: "12.000 BTU/h: en çok tercih edilen kapasite", html: `
<p>Oturma odaları ve 25 m² civarındaki alanlar için en yaygın seçimdir. Aynı serinin 9.000 ve 12.000 BTU/h modelleri çoğunlukla aynı iç ünite gövdesini paylaşır; bu yüzden görünüm açısından fark çok azdır.</p>
<p><a class="g-inline-cta" href="catalog.html?btu=12000">12.000 BTU/h modelleri görün</a></p>` },
      { id: "18000", title: "18.000 BTU/h: salonlar için", html: `
<p>Salon ve mutfakla birleşik oturma alanları için uygundur. İç ünite belirgin biçimde büyür ve daha güçlü bir elektrik hattı gerektirebilir; montaj öncesinde sigorta ve kablo kesiti kontrol edilmelidir.</p>
<p><a class="g-inline-cta" href="catalog.html?btu=18000">18.000 BTU/h modelleri görün</a></p>` },
      { id: "24000", title: "24.000 BTU/h: geniş ve açık plan alanlar", html: `
<p>Açık plan salonlar, güneş alan büyük mekânlar ve küçük işyerleri için tercih edilir. Bu kapasitenin de yetmediği durumlarda tek duvar tipi cihaz yerine <a href="rehber/salon-tipi-klima.html">salon tipi</a>, ticari veya <a href="rehber/multi-sistem-klima-nedir.html">multi sistem</a> çözümler değerlendirilmelidir.</p>
<p><a class="g-inline-cta" href="catalog.html?btu=24000">24.000 BTU/h modelleri görün</a></p>` },
    ],
    faq: [
      ["9.000 BTU klima kaç metrekareyi soğutur?", "Ortalama güneş ve yalıtım koşullarında yaklaşık 18 m²'ye kadar olan odalar için uygundur. Kuzey cepheli ve iyi yalıtımlı bir odada bu alan biraz daha büyüyebilir."],
      ["12.000 BTU klima kaç metrekareye uygundur?", "Ortalama koşullarda yaklaşık 24 m²'ye kadar olan alanlar için uygundur. Güneş alan, zayıf yalıtımlı odalarda karşıladığı alan 17 m² civarına düşebilir."],
      ["18.000 BTU klima kaç metrekareye uygundur?", "Ortalama koşullarda yaklaşık 36 m²'ye kadar olan salonlar için uygundur."],
      ["24.000 BTU klima nerelerde kullanılır?", "Ortalama koşullarda yaklaşık 48 m²'ye kadar olan geniş ve açık plan salonlar, güneş alan büyük odalar ve küçük işyerlerinde kullanılır."],
    ],
    related: ["klima-btu-hesaplama", "mekana-gore-klima-secimi", "salon-tipi-klima"],
    products: [
      { label: "Tüm duvar tipi klimalar", href: "catalog.html?category=Duvar%20Tipi" },
      { label: "Klima Seçici", href: "selector.html" },
    ],
  },

  {
    slug: "mekana-gore-klima-secimi",
    category: "secim",
    title: "Yazlık, Salon, Ofis ve Mağaza İçin Klima Seçimi",
    seoTitle: "Yazlık, Salon, Ofis ve Mağaza İçin Klima Seçimi",
    description: "Yazlık evde nem ve uzun süre kapalı kalma, salonda açık plan, ofiste yoğun cihaz yükü, mağazada sürekli açılan kapı: mekâna göre klima seçerken nelere bakmalı?",
    lead: "Aynı metrekareye sahip iki mekân, kullanım biçimine göre çok farklı klima ihtiyacı doğurabilir. Kıyı nemi, yazlık kullanım ve ticari yük Ege'de seçimi en çok etkileyen etkenlerdir.",
    answer: "Yazlıkta nem alma ve kolay bakım, salonda doğru kapasite ve hava dağılımı, ofiste cihaz ve kişi yükü, mağazada ise kapı açılıp kapanmasıyla oluşan ısı kaybı öne çıkar. Ticari mekânlarda kapasite mutlaka keşifle belirlenmelidir.",
    image: { key: "mekanTurleri", alt: "Yazlık ev, salon, ofis ve mağaza için klima kullanımını gösteren çizim", caption: "Kullanım biçimi, aynı alan için gereken kapasiteyi değiştirir." },
    sections: [
      { id: "yazlik", title: "Yazlık evler ve Ege kıyısı", html: `
<p>Kuşadası, Didim, Çeşme veya Bodrum gibi kıyı bölgelerinde yaz boyunca hem sıcaklık hem de nem yüksektir. Klimanın nem alma (dry) modu, özellikle gece konforunu belirgin biçimde artırır.</p>
<ul class="g-checklist">
<li>Sezon başında, uzun süre kapalı kalan klimanın filtresini temizletin ve drenajını kontrol ettirin.</li>
<li>Dış üniteyi doğrudan deniz rüzgârı ve tuzlu su serpintisi alan noktalardan mümkün olduğunca koruyun.</li>
<li>Evde değilken klimayı açıp kapatmak veya sıcaklığı kontrol etmek istiyorsanız <a href="rehber/wifi-klima-ne-ise-yarar.html">Wi-Fi özelliği</a> kullanışlıdır.</li>
<li>Kış aylarında kısa süreli ısıtma kullanacaksanız ürünün SCOP değerine bakın.</li>
</ul>` },
      { id: "salon", title: "Salon ve açık plan yaşam alanları", html: `
<p>Mutfakla birleşik, geniş camlı salonlarda ihtiyaç çoğunlukla 18.000 veya 24.000 BTU/h'dir. İç ünitenin yeri, havanın odanın tamamına ulaşıp ulaşmayacağını belirler; üniteyi uzun kenara ve oturma alanına doğrudan üflemeyecek biçimde konumlamak gerekir.</p>
<p>Duvarda uygun yer yoksa veya alan tek duvar tipi cihaz için büyükse <a href="rehber/salon-tipi-klima.html">salon tipi klima</a> iyi bir alternatiftir.</p>` },
      { id: "ofis", title: "Ofisler", html: `
<p>Bilgisayarlar, yazıcılar ve aynı anda çalışan birçok kişi ofiste ciddi bir ısı yükü oluşturur. Bu yüzden bir ofis, aynı büyüklükteki bir odadan daha fazla kapasite ister. Birden fazla bölmeden oluşan ofislerde her odaya ayrı iç ünite bağlanan <a href="rehber/multi-sistem-klima-nedir.html">multi sistem</a> hem cephede tek dış ünite hem de odaya göre ayrı kontrol sağlar.</p>` },
      { id: "magaza", title: "Mağaza ve işyerleri", html: `
<p>Sürekli açılıp kapanan kapı, vitrin camları, aydınlatma ve müşteri yoğunluğu mağazalarda kapasiteyi konut hesabının çok üzerine çıkarır. Tavan yapısı uygunsa kaset tipi, yüksek tavanlı alanlarda yer/tavan tipi cihazlar havayı daha dengeli dağıtır.</p>
<p>Ticari mekânlarda kapasite ve cihaz tipi yerinde keşifle belirlenmelidir. <a href="contact.html?subject=kesif">Keşif talebi oluşturabilir</a> veya <a href="catalog.html?category=Ticari%20Klima">ticari klimaları</a> inceleyebilirsiniz.</p>` },
    ],
    faq: [
      ["Yazlık evde klima nasıl korunur?", "Sezon sonunda filtreler temizlenip klima birkaç saat fan modunda çalıştırılarak iç ünitenin kuruması sağlanabilir. Sezon başında ise bakım yaptırmak, uzun süre kapalı kalmanın yol açtığı koku ve drenaj sorunlarını önler."],
      ["Mağaza için duvar tipi klima yeterli olur mu?", "Küçük ve kapısı sık açılmayan işyerlerinde yeterli olabilir. Vitrinli, kalabalık veya yüksek tavanlı mağazalarda kaset ya da yer/tavan tipi cihazlar genellikle daha doğru sonuç verir."],
    ],
    related: ["salon-tipi-klima", "multi-sistem-klima-nedir", "yerinde-kesif-neden-onemli"],
    products: [
      { label: "Duvar tipi klimalar", href: "catalog.html?category=Duvar%20Tipi" },
      { label: "Salon tipi klimalar", href: "catalog.html?category=Salon%20Tipi" },
      { label: "Ticari klimalar", href: "catalog.html?category=Ticari%20Klima" },
      { label: "Multi sistem", href: "catalog.html?category=Multi%20Sistem" },
    ],
  },

  {
    slug: "salon-tipi-klima",
    category: "secim",
    title: "Salon Tipi Klima Ne Zaman Tercih Edilir?",
    seoTitle: "Salon Tipi Klima Ne Zaman Tercih Edilir? Avantajları",
    description: "Salon tipi (dolap tipi) klima hangi mekânlar için uygun, duvar tipinden farkı ne? Kapasite, yerleşim ve montaj açısından salon tipi klimayı anlatıyoruz.",
    lead: "Salon tipi klimalar, zemine yerleştirilen dikey iç üniteleriyle geniş alanlarda güçlü ve dengeli hava dağılımı sağlar. Doğru mekânda duvar tipi cihazlardan daha iyi bir çözümdür.",
    answer: "Alan bir duvar tipi cihazın karşılayabileceğinden büyükse, tavan yüksekse veya duvarda iç ünite için uygun yer yoksa salon tipi klima tercih edilir. Kataloğumuzdaki GREE salon tipi modeller 24.000 ve 48.000 BTU/h kapasitededir.",
    image: { key: "salonTipi", alt: "GREE salon tipi inverter klima iç ünitesi", caption: "Salon tipi iç ünite zemine yerleştirilir ve havayı yüksekten, geniş bir açıyla üfler.", portrait: true },
    sections: [
      { id: "fark", title: "Duvar tipinden farkı nedir?", html: `
<p>Salon tipi klimada iç ünite duvara asılmaz; dolap gibi zemine yerleştirilir. Daha büyük fanı ve hava çıkışı sayesinde havayı uzağa ve geniş bir alana taşır. Dış ünite yapısı ve montaj mantığı split klimalarla aynıdır.</p>
<div class="g-table-wrap"><table class="g-table"><caption>Duvar tipi ile salon tipi karşılaştırması</caption><thead><tr><th scope="col"></th><th scope="col">Duvar tipi</th><th scope="col">Salon tipi</th></tr></thead><tbody>
<tr><th scope="row">Kapasite</th><td>9.000–24.000 BTU/h</td><td>24.000 BTU/h ve üzeri</td></tr>
<tr><th scope="row">Yerleşim</th><td>Duvarın üst kısmı</td><td>Zemin, köşe veya duvar dibi</td></tr>
<tr><th scope="row">Uygun alan</th><td>Oda ve orta büyüklükte salon</td><td>Geniş salon, yüksek tavan, işyeri</td></tr>
<tr><th scope="row">Kapladığı yer</th><td>Zeminde yer kaplamaz</td><td>Zeminde yaklaşık bir dolap kadar yer kaplar</td></tr>
</tbody></table></div>` },
      { id: "ne-zaman", title: "Hangi durumlarda salon tipi seçilmeli?", html: `
<ul class="g-checklist">
<li>Alan geniş, açık planlı ve 24.000 BTU/h duvar tipi cihazın sınırına yakın veya üstündeyse</li>
<li>Tavan yüksek, galerili veya çift katlı bir salon varsa</li>
<li>Duvarlar camlı, dolaplı veya iç ünite asmaya uygun değilse</li>
<li>Restoran, kafe, mağaza veya bekleme salonu gibi kalabalık alanlarda</li>
</ul>
<p>Kapasite ihtiyacının 24.000 BTU/h'yi aştığı alanlarda <a href="selector.html">Klima Seçici</a> sonucu doğrudan salon tipi ve ticari ürünlere yönlendirir.</p>` },
      { id: "montaj", title: "Montajda nelere dikkat edilir?", html: `
<p>İç ünitenin önü açık olmalı, hava akışını mobilya veya perdeler engellememelidir. Yüksek kapasite nedeniyle elektrik hattının kesiti ve sigortası, cihazın kullanım kılavuzunda belirtilen elektrik gereksinimine göre kontrol edilmelidir. İç ve dış ünite arasındaki boru güzergâhı da duvar tipine göre daha uzun olabilir.</p>
<p>Bu nedenlerle salon tipi bir klima satın almadan önce yerinde keşif yaptırmanızı öneririz. <a href="contact.html?subject=kesif">Keşif talebi oluşturun.</a></p>` },
    ],
    faq: [
      ["Salon tipi klima evde kullanılır mı?", "Evet. Özellikle geniş ve açık plan salonlarda veya duvara iç ünite asılamayan mekânlarda evde de kullanılır."],
      ["Salon tipi klima daha çok elektrik harcar mı?", "Kapasitesi daha yüksek olduğu için saatlik tüketimi de yüksektir. Karşılaştırmayı aynı alanı soğutan çözümler arasında ve SEER değerine bakarak yapmak gerekir."],
    ],
    related: ["btu-kapasite-farklari", "mekana-gore-klima-secimi", "yerinde-kesif-neden-onemli"],
    products: [
      { label: "Salon tipi klimalar", href: "catalog.html?category=Salon%20Tipi" },
      { label: "Ticari klimalar", href: "catalog.html?category=Ticari%20Klima" },
    ],
  },

  {
    slug: "multi-sistem-klima-nedir",
    category: "secim",
    title: "Multi Sistem Klima Nedir? Kimler İçin Uygundur?",
    seoTitle: "Multi Sistem Klima Nedir? Avantajları ve Dikkat Edilecekler",
    description: "Multi sistem (multi split) klimada tek dış üniteye birden fazla iç ünite bağlanır. Nasıl çalıştığını, avantajlarını ve dış ünite seçimini anlatıyoruz.",
    lead: "Birden fazla odayı klimalandırmak istiyor ama cephede birden çok dış ünite görmek istemiyorsanız multi sistem klima sizin için doğru çözüm olabilir.",
    answer: "Multi sistem klimada tek bir dış ünite, farklı odalardaki birden fazla iç üniteyi besler. Her oda ayrı kumanda edilir; cephede tek dış ünite bulunur. Dış ünitenin kapasitesi ve bağlanabilecek iç ünite sayısı sistemin sınırlarını belirler.",
    image: { key: "multiSistem", alt: "Bir dış üniteye bağlı üç farklı odadaki iç üniteyi gösteren multi sistem şeması", caption: "Multi sistemde her iç ünite kendi odasının sıcaklığını ayrı ayarlar." },
    sections: [
      { id: "nasil", title: "Multi sistem nasıl çalışır?", html: `
<p>Klasik split klimada bir iç ünite ile bir dış ünite eşleşir. Multi sistemde ise dış ünite, her biri ayrı bir bakır boru hattıyla bağlanan birden fazla iç üniteye soğutucu akışkan gönderir. İç üniteler aynı anda veya ayrı ayrı çalışabilir.</p>
<p>Örneğin kataloğumuzdaki 28.000 BTU/h GREE multi dış ünitesine üretici kataloğuna göre en fazla dört iç ünite bağlanabilir. Dış ünite seçenekleri 18.000'den 48.000 BTU/h'ye kadar uzanır.</p>` },
      { id: "ic-uniteler", title: "Hangi iç üniteler kullanılabilir?", html: `
<p>Aynı sistemde farklı tip iç üniteler birlikte kullanılabilir. Kataloğumuzda duvar tipi (Amber, Fairy, Lomo ve Pular), tek yön ve dört yön kaset tipi ile kanallı tip multi iç üniteler bulunur. Böylece yatak odasına duvar tipi, asma tavanlı salona kaset tipi bir iç ünite bağlanabilir.</p>
<figure class="g-figure g-figure-photo"><img src="/assets/home/multi-480.webp" width="480" height="439" alt="GREE multi sistem iç ve dış ünite" loading="lazy" decoding="async"><figcaption>Multi sistemlerde iç ünite tipi odaya göre seçilebilir.</figcaption></figure>` },
      { id: "avantaj", title: "Avantajları ve dikkat edilmesi gerekenler", html: `
<div class="g-proscons">
<div><h3>Avantajları</h3><ul class="g-list"><li>Cephede ve balkonda tek dış ünite</li><li>Her oda için ayrı sıcaklık ve kumanda</li><li>Farklı tip iç ünitelerin tek sistemde kullanılması</li></ul></div>
<div><h3>Dikkat edilmesi gerekenler</h3><ul class="g-list"><li>Dış ünite arızalanırsa bağlı tüm odalar etkilenir</li><li>Boru hatlarının uzunluğu ve güzergâhı dikkatle planlanmalıdır</li><li>İlk kurulum, projelendirme gerektirdiği için tek split klimalardan daha kapsamlıdır</li></ul></div>
</div>` },
      { id: "secim", title: "Doğru sistem nasıl seçilir?", html: `
<p>Önce her odanın kapasite ihtiyacı ayrı ayrı belirlenir, ardından iç ünitelerin toplamına ve eşzamanlı kullanım senaryosuna göre dış ünite seçilir. Bağlanabilecek iç ünite sayısı ve kapasite oranları üreticinin tablolarına göre kontrol edilmelidir. Bu nedenle multi sistemler Ege Teknik'te projelendirme ve teklif ile satılır.</p>
<p><a href="contact.html?subject=kesif">Multi sistem için keşif isteyin</a> veya <a href="catalog.html?category=Multi%20Sistem">multi sistem ürünlerini inceleyin</a>.</p>` },
    ],
    faq: [
      ["Multi sistemde her oda ayrı çalışır mı?", "Evet. Her iç ünitenin kendi kumandası vardır; odalar birbirinden bağımsız açılıp kapatılabilir ve farklı sıcaklıklara ayarlanabilir."],
      ["Mevcut bir split klimaya multi iç ünite eklenebilir mi?", "Hayır. Multi iç üniteler, multi sistem dış ünitesiyle çalışacak şekilde tasarlanmıştır; mevcut tekli split dış üniteye ikinci bir iç ünite bağlanamaz."],
    ],
    related: ["mekana-gore-klima-secimi", "klima-montaji-oncesi", "yerinde-kesif-neden-onemli"],
    products: [
      { label: "Multi sistem ürünleri", href: "catalog.html?category=Multi%20Sistem" },
    ],
  },

  {
    slug: "ikinci-el-klima-alinir-mi",
    category: "secim",
    title: "İkinci El Klima Alınır mı? Kontrol Listesi",
    seoTitle: "İkinci El Klima Alınır mı? Almadan Önce Kontrol Listesi",
    description: "İkinci el veya spot klima alırken kompresör, gaz, iç ünite hijyeni, uzaktan kumanda ve montaj maliyeti gibi hangi noktaları kontrol etmelisiniz?",
    lead: "Uygun fiyatlı bir ikinci el klima mantıklı bir seçim olabilir; ancak cihazın geçmişi bilinmiyorsa ilk yaz ciddi bir masrafa dönüşebilir. Almadan önce şu noktaları mutlaka kontrol edin.",
    answer: "Çalışır durumda test edilmiş, kondisyonu açıkça belirtilmiş, iç ünitesi temiz ve uzaktan kumandası olan ikinci el klimalar alınabilir. Söküm ve yeniden montaj maliyetini de fiyata ekleyerek karar verin.",
    image: { key: "ikinciEl", alt: "İkinci el klima alırken kontrol edilmesi gerekenleri gösteren kontrol listesi çizimi", caption: "Test edilmemiş bir klima, uygun fiyatına rağmen pahalıya mal olabilir." },
    sections: [
      { id: "kontrol", title: "Almadan önce kontrol listesi", html: `
<ul class="g-checklist">
<li><b>Çalışma testi:</b> Klimayı soğutma modunda en az 15–20 dakika çalıştırın; iç üniteden çıkan havanın belirgin biçimde soğuduğunu kontrol edin.</li>
<li><b>Kompresör sesi:</b> Dış ünitede vuruntu, sürtünme veya düzensiz ses olmamalıdır.</li>
<li><b>Gaz durumu:</b> Gazın ne zaman ve neden eklendiğini sorun. Sık gaz eklenmesi kaçağa işaret eder.</li>
<li><b>Hijyen:</b> İç ünite serpantini, filtre ve fan küflü veya kötü kokulu olmamalıdır.</li>
<li><b>Kumanda ve etiket:</b> Uzaktan kumanda çalışmalı; model etiketi okunabilir olmalıdır.</li>
<li><b>Yaş ve soğutucu akışkan:</b> Model yılı ve kullanılan akışkan (ör. R32, R410A) servis ve parça bulunabilirliğini etkiler.</li>
</ul>` },
      { id: "maliyet", title: "Toplam maliyeti hesaplayın", html: `
<p>İkinci el klimanın fiyatına söküm, taşıma, yeni montaj, gerekirse yeni bakır boru ve gaz tamamlama maliyetlerini ekleyin. Toplam tutar yeni ve verimli bir cihaza yaklaşıyorsa, yeni ürün garantisi ve enerji tasarrufu nedeniyle genellikle daha iyi bir seçimdir.</p>` },
      { id: "spot", title: "Ege Teknik Spot Ürünler", html: `
<p>Ege Teknik <a href="second-hand.html">Spot Ürünler</a> bölümünde yalnız kontrol edilmiş, kondisyonu ve test notları açıkça belirtilen tekil stoklu ürünler listelenir. İlgilendiğiniz ürün için <a href="contact.html?subject=ikinci-el">bilgi isteyebilirsiniz</a>.</p>` },
    ],
    faq: [
      ["İkinci el klimada gaz eksikliği nasıl anlaşılır?", "Klima çalıştığı hâlde yeterince soğutmuyorsa, dış ünite bağlantılarında buzlanma veya yağlanma varsa gaz eksikliğinden şüphelenilir. Kesin tespit servis tarafından basınç ölçümüyle yapılır."],
    ],
    related: ["klima-neden-sogutmaz", "klima-bakimi-ne-zaman", "klima-secimi-rehberi"],
    products: [
      { label: "Spot Ürünler", href: "second-hand.html" },
      { label: "Yeni duvar tipi klimalar", href: "catalog.html?category=Duvar%20Tipi" },
    ],
  },
];
