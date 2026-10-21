// Klima Rehberi — montaj, bakım, servis ve arıza rehberleri.

export const serviceGuides = [
  {
    slug: "klima-montaji-oncesi",
    category: "montaj",
    title: "Klima Montajı Öncesi Bilinmesi Gerekenler",
    seoTitle: "Klima Montajı Öncesi Bilinmesi Gerekenler: Kontrol Listesi",
    description: "İç ve dış ünite yeri, boru mesafesi, elektrik hattı, drenaj, vakumlama ve apartman izni: klima montajından önce netleştirmeniz gereken her şey.",
    lead: "En verimli klima bile yanlış montajla beklenen performansı veremez. Montaj gününden önce birkaç konuyu netleştirmek hem süreci hızlandırır hem de sürpriz maliyetlerin önüne geçer.",
    answer: "Montajdan önce iç ve dış ünitenin yerini, aradaki boru mesafesini, elektrik hattının uygunluğunu ve yoğuşma suyunun nereye akacağını belirleyin. Apartmanlarda dış cephe kullanımı için yönetim onayı alın.",
    image: { key: "splitSistem", alt: "İç ünite, dış ünite, bakır boru hattı ve drenaj hattını gösteren split klima montaj şeması", caption: "Split klimada iç ve dış ünite bakır borular, enerji kablosu ve drenaj hattıyla bağlanır." },
    sections: [
      { id: "ic-unite", title: "İç ünitenin yeri", html: `
<ul class="g-checklist">
<li>Havayı odanın tamamına dağıtabileceği, önü açık bir duvar seçin; genellikle odanın uzun kenarı en iyi sonucu verir.</li>
<li>Soğuk havanın doğrudan yatağa, çalışma masasına veya oturma alanına üflenmemesine dikkat edin.</li>
<li>Isı kaynaklarının (fırın, radyatör, doğrudan güneş) hemen yakınına monte etmeyin.</li>
<li>Filtre bakımı için üst ve yan taraflarda kılavuzda belirtilen boşluğu bırakın.</li>
</ul>` },
      { id: "dis-unite", title: "Dış ünitenin yeri", html: `
<ul class="g-checklist">
<li>Dış ünitenin önü ve arkası hava alabilmeli; kapalı ve havasız alanlar verimi düşürür.</li>
<li>Sağlam bir konsol veya zemin üzerine, titreşimi azaltacak şekilde yerleştirilmelidir.</li>
<li>Servis ve bakım için güvenli erişim olmalıdır.</li>
<li>Sıcak havanın komşu pencerelerine veya yaya yoluna üflenmemesine dikkat edin.</li>
</ul>` },
      { id: "boru-elektrik", title: "Boru mesafesi, elektrik ve drenaj", html: `
<p>İç ve dış ünite arasındaki bakır boru hattı mümkün olduğunca kısa tutulmalıdır. Standart montaj belirli bir boru uzunluğunu kapsar; daha uzun hatlar, ek dirsekler veya kanal içinden geçiş ek malzeme ve işçilik gerektirir.</p>
<p>Klimanın beslendiği elektrik hattının kablo kesiti ve sigortası cihazın gücüne uygun olmalıdır; 18.000 BTU/h ve üzeri cihazlarda bu kontrol özellikle önemlidir. İç üniteden gelen yoğuşma suyu için eğimli bir drenaj yolu planlanmalı, su cepheye veya balkona kontrolsüz akmamalıdır.</p>
<div class="g-callout">Ege Teknik'te standart kapsam dışındaki borulama, elektrik, erişim ve yapı işleri montajdan önce size bildirilir ve onayınız olmadan ücretlendirilmez.</div>` },
      { id: "vakum", title: "Vakumlama ve test: kaliteli montajın işareti", html: `
<p>Boru bağlantıları yapıldıktan sonra hat vakum pompasıyla havasından ve neminden arındırılmalı, ardından sızdırmazlık kontrol edilmelidir. Bu adım atlanırsa sistemde kalan nem ve hava, zamanla verim kaybına ve arızalara yol açabilir. Montaj sonunda klima soğutma ve ısıtma modlarında çalıştırılarak test edilir.</p>` },
      { id: "izin", title: "Apartman ve site izni", html: `
<p>Dış cephe, çatı veya ortak alanlara dış ünite konulacaksa apartman ya da site yönetiminin kurallarını önceden öğrenin. Bazı sitelerde dış ünitelerin belirli bir bölgede toplanması istenebilir; bu da boru mesafesini etkiler.</p>
<p>Emin olmadığınız her konuda <a href="rehber/yerinde-kesif-neden-onemli.html">yerinde keşif</a> en doğru yoldur. <a href="services.html">Montaj ve servis hizmetlerimizi</a> inceleyebilir veya <a href="contact.html?subject=kesif">keşif talebi</a> oluşturabilirsiniz.</p>` },
    ],
    faq: [
      ["Klima montajı ne kadar sürer?", "Standart bir duvar tipi klimanın montajı, mekânın koşullarına bağlı olarak genellikle birkaç saat sürer. Uzun boru hattı, kanal içi geçiş veya zor erişim süreyi uzatır."],
      ["Standart montaja neler dahildir?", "Kapsam ürüne göre değişir; ürün sayfasında 'Standart montaj dahil' ibaresi bulunan modellerde standart kapsam dışındaki işler montajdan önce bildirilir ve onayınız olmadan ücretlendirilmez."],
    ],
    related: ["yerinde-kesif-neden-onemli", "klima-bakimi-ne-zaman", "multi-sistem-klima-nedir"],
    products: [
      { label: "Montaj ve servis", href: "services.html" },
      { label: "Keşif talebi", href: "contact.html?subject=kesif" },
      { label: "Duvar tipi klimalar", href: "catalog.html?category=Duvar%20Tipi" },
    ],
  },

  {
    slug: "yerinde-kesif-neden-onemli",
    category: "montaj",
    title: "Klima Satın Almadan Önce Keşif Neden Önemlidir?",
    seoTitle: "Klima Keşfi Nedir, Neden Önemlidir? Yerinde Keşif",
    description: "Yerinde keşifte mekânın ölçüleri, güneş durumu, elektrik altyapısı ve dış ünite konumu değerlendirilir. Keşif ne zaman gerekir, nasıl talep edilir?",
    lead: "Online hesaplama iyi bir başlangıçtır; ancak mekânı gören bir teknik ekip, kâğıt üzerinde görünmeyen ayrıntıları yakalar. Özellikle büyük, karmaşık veya ticari alanlarda keşif doğru kararın anahtarıdır.",
    answer: "Keşif; doğru kapasiteyi, uygun cihaz tipini, iç ve dış ünite yerini ve montajın gerçek kapsamını satın almadan önce netleştirir. Böylece yanlış ürün, beklenmedik ek iş ve maliyet riski ortadan kalkar.",
    image: { key: "kesifPlan", alt: "Güneş yönü, pencereler ve ölçülerle işaretlenmiş oda planı çizimi", caption: "Keşifte odanın ölçüleri, cepheleri ve cam yüzeyleri birlikte değerlendirilir." },
    sections: [
      { id: "ne-zaman", title: "Hangi durumlarda keşif gerekir?", html: `
<ul class="g-checklist">
<li>Alan 60 m²'yi aşıyor veya açık planlı ise</li>
<li>Mekân çok güneş alıyor ve yalıtımı zayıfsa</li>
<li>Mağaza, ofis, restoran gibi ticari bir alansa</li>
<li>Birden fazla odaya multi sistem düşünülüyorsa</li>
<li>Dış ünite için uygun yer veya boru güzergâhı belirsizse</li>
</ul>
<p>Bu koşullar <a href="selector.html">Klima Seçici</a> sonucunda da "Yerinde keşif önerilir" uyarısıyla gösterilir.</p>` },
      { id: "neler", title: "Keşifte neler değerlendirilir?", html: `
<div class="g-steps">
<div><b>Ölçüler ve cepheler</b><p>Taban alanı, tavan yüksekliği, cam yüzeyleri ve güneş alan cepheler.</p></div>
<div><b>Kullanım</b><p>Kişi sayısı, çalışma saatleri, ısı yayan cihazlar ve mekânın kullanım amacı.</p></div>
<div><b>Yerleşim</b><p>İç ve dış ünitenin konumu, boru güzergâhı ve drenaj yolu.</p></div>
<div><b>Altyapı</b><p>Elektrik hattı, sigorta ve varsa mevcut tesisatın durumu.</p></div>
</div>` },
      { id: "sonra", title: "Keşiften sonra ne olur?", html: `
<p>Keşif sonunda mekâna uygun kapasite ve cihaz tipi önerilir; montaj kapsamı ve varsa ek işler açıkça belirtilir. Online satışta olan ürünlerde karar size aittir; projelendirme gerektiren multi sistem ve ticari çözümlerde teklif hazırlanır.</p>` },
      { id: "talep", title: "Keşif nasıl talep edilir?", html: `
<p><a href="contact.html?subject=kesif">İletişim formundan</a> konu olarak "Keşif ve montaj"ı seçin; şehir ve ilçenizi, mekânın yaklaşık alanını ve varsa fotoğraf çekebileceğiniz bir iletişim bilgisini yazın. Ekibimiz uygun gün ve saat için sizinle iletişime geçer.</p>
<p>Ege Teknik; İzmir, Aydın, Muğla, Manisa, Denizli, Uşak, Afyonkarahisar, Kütahya ve Balıkesir'de keşif taleplerini planlar. <a href="regions.html">Hizmet bölgelerimize göz atın.</a></p>` },
    ],
    faq: [],
    related: ["klima-btu-hesaplama", "klima-montaji-oncesi", "mekana-gore-klima-secimi"],
    products: [
      { label: "Klima Seçici", href: "selector.html" },
      { label: "Keşif talebi", href: "contact.html?subject=kesif" },
    ],
  },

  {
    slug: "klima-bakimi-ne-zaman",
    category: "montaj",
    title: "Klima Bakımı ve Temizliği: Ne Zaman, Nasıl Yapılır?",
    seoTitle: "Klima Bakımı Ne Zaman Yapılır? Filtre Temizliği Rehberi",
    description: "Klima filtresi ne sıklıkla temizlenmeli, periyodik bakım ne zaman yapılmalı? Evde yapabileceğiniz temizliği ve servise bırakmanız gereken işleri ayırıyoruz.",
    lead: "Düzenli bakım klimanın verimini korur, kötü kokuyu ve su akıtma gibi sorunları önler, cihazın ömrünü uzatır. Bazı işleri kendiniz yapabilirsiniz; bazıları ise teknik servis gerektirir.",
    answer: "Filtreleri yoğun kullanım döneminde birkaç haftada bir kontrol edip temizleyin; kullanım kılavuzundaki aralığı esas alın. Teknik bakımı yılda en az bir kez, tercihen soğutma sezonundan önce yaptırın.",
    image: { key: "bakim", alt: "Klima filtresinin çıkarılıp temizlenmesini ve bakım takvimini gösteren çizim", caption: "Filtre temizliği evde yapılabilir; serpantin, drenaj ve gaz kontrolü servis işidir." },
    sections: [
      { id: "evde", title: "Evde yapabileceğiniz temizlik", html: `
<ol class="g-numbered">
<li>Klimayı kapatın ve fişini çekin veya sigortasını indirin.</li>
<li>İç ünitenin ön kapağını açıp filtreleri kılavuzda gösterildiği gibi çıkarın.</li>
<li>Filtreleri ılık suyla yıkayın veya elektrikli süpürgeyle tozunu alın; sert fırça ve deterjan kullanmayın.</li>
<li>Filtreleri gölgede tamamen kurutup yerine takın.</li>
<li>İç ünitenin dış yüzeyini kuru ve yumuşak bir bezle silin.</li>
</ol>
<div class="g-callout"><b>Dikkat:</b> İç ünitenin içindeki fana, serpantine ve elektronik kartlara su veya sprey uygulamayın. Bu işlemler teknik servis tarafından yapılmalıdır.</div>` },
      { id: "siklik", title: "Ne sıklıkla?", html: `
<div class="g-table-wrap"><table class="g-table"><caption>Önerilen bakım takvimi</caption><thead><tr><th scope="col">İşlem</th><th scope="col">Kim yapar?</th><th scope="col">Sıklık</th></tr></thead><tbody>
<tr><td>Filtre kontrolü ve temizliği</td><td>Kullanıcı</td><td>Yoğun kullanımda birkaç haftada bir; kılavuzdaki aralığa göre</td></tr>
<tr><td>Periyodik teknik bakım</td><td>Teknik servis</td><td>Yılda en az bir kez, sezon öncesi</td></tr>
<tr><td>Ticari ve yoğun kullanım</td><td>Teknik servis</td><td>Yılda iki kez önerilir</td></tr>
</tbody></table></div>` },
      { id: "servis", title: "Teknik bakımda neler yapılır?", html: `
<ul class="g-checklist">
<li>İç ünite serpantini ve fanının temizliği</li>
<li>Drenaj hattı ve tavasının kontrolü ve temizliği</li>
<li>Dış ünite kondenserinin temizliği ve hava akışının kontrolü</li>
<li>Çalışma basınçlarının ve gaz durumunun kontrolü</li>
<li>Elektrik bağlantılarının ve genel çalışma performansının kontrolü</li>
</ul>
<p>Periyodik bakım için <a href="contact.html?subject=bakim">bakım talebi oluşturabilirsiniz</a>. Filtre ve yedek parça ihtiyaçlarınız için <a href="catalog.html?category=Yedek%20Par%C3%A7a">yedek parça</a> bölümüne göz atın.</p>` },
      { id: "belirtiler", title: "Bakım zamanının geldiğini gösteren belirtiler", html: `
<ul class="g-list">
<li>Klima çalışınca kötü koku gelmesi</li>
<li>Soğutma performansının belirgin biçimde düşmesi (<a href="rehber/klima-neden-sogutmaz.html">klima neden soğutmaz?</a>)</li>
<li>İç üniteden su damlaması (<a href="rehber/klima-neden-su-akitir.html">klima neden su akıtır?</a>)</li>
<li>Normalden fazla ses veya titreşim</li>
</ul>` },
    ],
    faq: [
      ["Klima filtresi ne zaman temizlenir?", "Yoğun kullanım döneminde birkaç haftada bir kontrol edilip temizlenmesi önerilir. Tozlu ortamlarda ve evcil hayvan bulunan evlerde daha sık temizlik gerekebilir; kesin aralık için kullanım kılavuzunu esas alın."],
      ["Klima bakımı yılda kaç kez yapılmalı?", "Evsel kullanımda yılda en az bir kez, tercihen soğutma sezonundan önce; ticari ve yoğun kullanımda yılda iki kez teknik bakım önerilir."],
    ],
    related: ["klima-neden-sogutmaz", "klima-neden-su-akitir", "klima-montaji-oncesi"],
    products: [
      { label: "Filtre ve yedek parça", href: "catalog.html?category=Yedek%20Par%C3%A7a" },
      { label: "Bakım talebi", href: "contact.html?subject=bakim" },
    ],
  },

  {
    slug: "klima-neden-sogutmaz",
    category: "ariza",
    title: "Klima Neden Soğutmaz? Kontrol Edilecek 7 Nokta",
    seoTitle: "Klima Neden Soğutmaz? Servisi Aramadan Önce 7 Kontrol",
    description: "Klimanız yeterince soğutmuyorsa önce ayarları, filtreyi ve dış üniteyi kontrol edin. Evde yapabileceğiniz kontrolleri ve servis gerektiren durumları anlatıyoruz.",
    lead: "Klimanın soğutmaması her zaman ciddi bir arıza anlamına gelmez. Servisi aramadan önce birkaç basit kontrolle sorunun kaynağını daraltabilirsiniz.",
    answer: "En sık nedenler yanlış mod veya sıcaklık ayarı, tıkalı filtre, havası kesilen veya kirli dış ünite ve odaya göre yetersiz kapasitedir. Bu kontrollerden sonra sorun sürüyorsa gaz kaçağı veya elektronik bir arıza olabilir; bu durumda servis gerekir.",
    image: { key: "sogutmaKontrol", alt: "Kumanda ayarı, filtre ve dış ünite kontrollerini gösteren arıza kontrol çizimi", caption: "Kontrollere en basitinden başlayın: ayar, filtre, dış ünite." },
    sections: [
      { id: "kontroller", title: "Evde yapabileceğiniz kontroller", html: `
<ol class="g-numbered">
<li><b>Mod ve sıcaklık:</b> Kumandanın soğutma (kar tanesi) modunda olduğundan ve ayarlanan sıcaklığın oda sıcaklığından düşük olduğundan emin olun.</li>
<li><b>Filtre:</b> Tıkalı filtre hava akışını azaltır ve soğutmayı zayıflatır. Filtreleri temizleyin (<a href="rehber/klima-bakimi-ne-zaman.html">nasıl yapılır?</a>).</li>
<li><b>Dış ünite:</b> Dış ünitenin önü kapalı mı, üzeri örtülü mü, doğrudan ve uzun süre güneş altında mı? Havası kesilen dış ünite ısıyı atamaz.</li>
<li><b>Kapı ve pencereler:</b> Açık kalan kapı, pencere veya sürekli açılıp kapanan bir giriş klimanın yükünü artırır.</li>
<li><b>Kapasite:</b> Klima odaya göre küçük seçilmişse en sıcak saatlerde yetersiz kalabilir (<a href="rehber/klima-btu-hesaplama.html">kapasite nasıl hesaplanır?</a>).</li>
<li><b>Bekleme süresi:</b> İlk çalıştırmada ve mod değişikliklerinde kompresörün devreye girmesi birkaç dakika sürebilir.</li>
<li><b>Hata kodu:</b> İç ünitenin ekranında bir kod görünüyorsa not alın; kullanım kılavuzunda anlamı yer alır ve servise bildirmeniz tanıyı hızlandırır.</li>
</ol>` },
      { id: "servis", title: "Servis gerektiren durumlar", html: `
<ul class="g-checklist">
<li>İç ünite çalıştığı hâlde dış ünitenin hiç çalışmaması</li>
<li>Bakır boru bağlantılarında buzlanma veya yağlanma</li>
<li>Filtre temizliğine rağmen soğutmanın zamanla giderek azalması (olası gaz kaçağı)</li>
<li>Sigortanın attırması, yanık kokusu veya olağandışı ses</li>
</ul>
<div class="g-callout"><b>Önemli:</b> Gaz eklemek kalıcı bir çözüm değildir; önce kaçağın yeri bulunup giderilmelidir. Soğutucu akışkanla ilgili işlemleri yalnız yetkili teknik servis yapmalıdır.</div>
<p>Arıza bildirimi için <a href="contact.html?subject=ariza">servis talebi oluşturabilir</a> veya bizi arayabilirsiniz.</p>` },
    ],
    faq: [
      ["Klima çalışıyor ama soğuk hava vermiyor, neden?", "En sık nedenler yanlış mod ayarı, tıkalı filtre ve dış ünitenin havasının kesilmesidir. Bunlar yolundaysa gaz kaçağı veya kompresör ile ilgili bir sorun olabilir; bu durumda servis gerekir."],
      ["Klimanın gazı biter mi?", "Sızdırmaz bir sistemde soğutucu akışkan tükenmez. Gaz azalıyorsa bir kaçak vardır ve önce kaçağın giderilmesi gerekir."],
    ],
    related: ["klima-bakimi-ne-zaman", "klima-neden-su-akitir", "klima-btu-hesaplama"],
    products: [
      { label: "Arıza ve servis talebi", href: "contact.html?subject=ariza" },
      { label: "Montaj ve servis", href: "services.html" },
    ],
  },

  {
    slug: "klima-neden-su-akitir",
    category: "ariza",
    title: "Klima Neden Su Akıtır?",
    seoTitle: "Klima Neden Su Akıtır? İç ve Dış Ünite Su Damlatma",
    description: "İç üniteden su damlaması çoğunlukla tıkalı drenaj, kirli filtre veya montaj eğiminden kaynaklanır; dış ünitenin su akıtması ise genellikle normaldir.",
    lead: "Klima soğuturken havadaki nemi yoğuşturur; bu su normalde drenaj hortumuyla dışarı atılır. Su iç üniteden odaya damlıyorsa bu yol bir yerde aksıyor demektir.",
    answer: "İç üniteden su akmasının en sık nedenleri tıkalı veya kırılmış drenaj hattı, kirli filtre nedeniyle buzlanan serpantin ve iç ünitenin yanlış eğimle monte edilmesidir. Dış ünitenin su damlatması ise soğutma ve ısıtma sırasında normaldir.",
    image: { key: "drenaj", alt: "İç üniteden çıkan yoğuşma suyunun eğimli drenaj hortumuyla dışarı akışını gösteren çizim", caption: "Yoğuşma suyu, sürekli aşağı eğimli bir drenaj hattıyla dışarı atılmalıdır." },
    sections: [
      { id: "ic-unite", title: "İç üniteden su akıyorsa", html: `
<ul class="g-list">
<li><b>Tıkalı drenaj hattı:</b> Toz, küf ve kir drenaj tavasını veya hortumu tıkayabilir. Özellikle uzun süre kullanılmayan ve bakımsız klimalarda sık görülür.</li>
<li><b>Hortumun ezilmesi veya eğim bozukluğu:</b> Drenaj hortumu kıvrılmış, ezilmiş ya da bir noktada yukarı doğru eğim alıyorsa su geri döner.</li>
<li><b>Kirli filtre:</b> Hava akışı azalınca serpantin buzlanabilir; buz çözüldüğünde tava taşar.</li>
<li><b>İç ünite eğimi:</b> İç ünite drenaj tarafına doğru hafif eğimli olmalıdır. Montaj eğimi ters ise su tavadan taşar.</li>
<li><b>Düşük gaz:</b> Gaz eksikliği de serpantinde buzlanmaya ve ardından su taşmasına yol açabilir.</li>
</ul>` },
      { id: "ne-yapmali", title: "Ne yapmalısınız?", html: `
<ol class="g-numbered">
<li>Klimayı kapatın ve suyun eşyalara zarar vermemesi için altına bir kap veya havlu yerleştirin.</li>
<li>Filtreleri kontrol edip temizleyin.</li>
<li>Dışarıdaki drenaj hortumunun ucunun açık olduğunu ve ezilmediğini kontrol edin.</li>
<li>Sorun sürüyorsa drenaj temizliği ve eğim kontrolü için servis isteyin.</li>
</ol>
<p>Düzenli <a href="rehber/klima-bakimi-ne-zaman.html">bakım</a> drenaj kaynaklı sorunların büyük bölümünü önler. Servis için <a href="contact.html?subject=ariza">arıza talebi oluşturabilirsiniz</a>.</p>` },
      { id: "dis-unite", title: "Dış ünitenin su damlatması normal mi?", html: `
<p>Evet, çoğu durumda normaldir. Isıtma modunda dış ünite serpantininde oluşan buz, cihazın otomatik defrost (buz çözme) döngüsünde erir ve dış üniteden su akar. Soğutma sırasında da bağlantı noktalarında bir miktar yoğuşma görülebilir. Suyun balkona veya cepheye kontrolsüz akmaması için montajda uygun bir tahliye yolu planlanmalıdır.</p>` },
    ],
    faq: [
      ["Klimadan su damlaması tehlikeli mi?", "Doğrudan tehlikeli değildir ancak su elektrik prizlerine, mobilyalara veya zemine zarar verebilir. Klimayı kapatıp kaynağını tespit ettirmek gerekir."],
      ["Dış ünitenin su akıtması arıza mıdır?", "Genellikle hayır. Isıtma modunda defrost sırasında ve soğutmada yoğuşma nedeniyle dış üniteden su akması normaldir."],
    ],
    related: ["klima-bakimi-ne-zaman", "klima-neden-sogutmaz", "klima-montaji-oncesi"],
    products: [
      { label: "Arıza ve servis talebi", href: "contact.html?subject=ariza" },
      { label: "Bakım talebi", href: "contact.html?subject=bakim" },
      { label: "Montaj ve servis", href: "services.html" },
    ],
  },
];
