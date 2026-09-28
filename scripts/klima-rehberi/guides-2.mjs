// Klima Rehberi — teknoloji ve verimlilik rehberleri.
// Seri ve model değerleri data/catalog-enrichment içindeki doğrulanmış GREE Türkiye verisinden alınmıştır.

export const technologyGuides = [
  {
    slug: "inverter-klima-nedir",
    category: "teknoloji",
    title: "Inverter Klima Nedir? Nasıl Tasarruf Sağlar?",
    seoTitle: "Inverter Klima Nedir, Nasıl Çalışır? Avantajları",
    description: "Inverter klima kompresör hızını ihtiyaca göre ayarlar. Klasik (on/off) klimadan farkını, enerji tasarrufunu ve konfora etkisini gerçek model verisiyle anlatıyoruz.",
    lead: "Bugün satılan duvar tipi klimaların neredeyse tamamı inverter teknolojisiyle çalışır. Peki inverter tam olarak neyi değiştirir ve neden daha az enerji harcar?",
    answer: "Inverter klima, kompresörün hızını odanın ihtiyacına göre sürekli ayarlar. İstenen sıcaklığa ulaşıldığında durmak yerine düşük devirde çalışmaya devam eder; bu sayede sıcaklık daha dengeli kalır ve sık dur-kalk kaynaklı enerji kaybı azalır.",
    image: { key: "inverter", alt: "Klasik klimanın dur-kalk çalışması ile inverter klimanın dengeli çalışmasını karşılaştıran grafik", caption: "Klasik klima tam güçle çalışıp durur; inverter klima hızını azaltarak dengede kalır." },
    sections: [
      { id: "klasik", title: "Klasik (on/off) klima nasıl çalışır?", html: `
<p>Inverter olmayan klimalarda kompresör ya tam güçte çalışır ya da tamamen durur. Oda istenen sıcaklığa ulaşınca kompresör kapanır, sıcaklık yükselince yeniden tam güçte devreye girer. Bu döngü hem sıcaklıkta dalgalanmaya hem de her kalkışta yüksek akım çekilmesine neden olur.</p>` },
      { id: "inverter", title: "Inverter ne yapar?", html: `
<p>Inverter, kompresör motorunun hızını elektronik olarak değiştiren bir sürücüdür. Klima ilk çalıştığında yüksek devirle odayı hızla soğutur; hedef sıcaklığa yaklaştıkça devrini düşürür ve odanın ısı kazancını karşılayacak kadar çalışmaya devam eder.</p>
<p>Bu esnekliği teknik özellik tablosunda görebilirsiniz. Örneğin GREE Airy 12.000 BTU/h modelinin soğutma kapasitesi üretici verisinde <b>2.900 ~ 11.942 ~ 15.354 BTU/h</b> olarak verilir: cihaz gerektiğinde nominal değerin çok altında, gerektiğinde üstünde çalışabilir.</p>` },
      { id: "avantaj", title: "Inverter klimanın avantajları", html: `
<ul class="g-checklist">
<li><b>Daha az enerji:</b> Sık dur-kalk yapılmadığı için sezonluk verimlilik (SEER/SCOP) daha yüksektir.</li>
<li><b>Daha dengeli sıcaklık:</b> Oda sıcaklığı hedef değerin çevresinde küçük aralıkta kalır.</li>
<li><b>Daha sessiz çalışma:</b> Düşük devirde hem iç hem dış ünite daha az ses çıkarır.</li>
<li><b>Daha iyi ısıtma:</b> Soğuk havada da kapasitesini daha iyi korur.</li>
</ul>` },
      { id: "kullanim", title: "Inverter klimayı verimli kullanmak", html: `
<p>Inverter klimalar uzun süre sabit bir sıcaklıkta çalıştırıldığında en verimli sonucu verir. Klimayı çok düşük bir değere ayarlayıp sık sık kapatmak yerine yazın 24–26 °C gibi makul bir sıcaklıkta açık bırakmak genellikle daha ekonomiktir. Filtrelerin temiz tutulması da verimliliği doğrudan etkiler (<a href="rehber/klima-bakimi-ne-zaman.html">bakım rehberi</a>).</p>` },
    ],
    faq: [
      ["Inverter klima sürekli açık kalırsa çok elektrik yakar mı?", "Hayır. Hedef sıcaklığa ulaştıktan sonra düşük devirde çalıştığı için tüketimi de düşer. Sık aç-kapa yapmak yerine makul bir sıcaklıkta çalıştırmak çoğu zaman daha ekonomiktir."],
      ["Tüm GREE duvar tipi klimalar inverter mı?", "Kataloğumuzdaki GREE Airy, Fairy, Pular ve Aphro duvar tipi modellerin tamamı inverter teknolojiyle çalışır."],
    ],
    related: ["enerji-sinifi-seer-scop", "gree-serileri-karsilastirma", "klima-btu-hesaplama"],
    products: [
      { label: "Inverter duvar tipi klimalar", href: "catalog.html?category=Duvar%20Tipi" },
    ],
  },

  {
    slug: "enerji-sinifi-seer-scop",
    category: "teknoloji",
    title: "Enerji Sınıfı, SEER ve SCOP Ne Anlama Gelir?",
    seoTitle: "Klima Enerji Sınıfı, SEER ve SCOP Nedir? Elektrik Tüketimi",
    description: "A++ ile A+++ arasındaki fark ne? SEER ve SCOP değerleri nasıl okunur, klima ne kadar elektrik harcar? Enerji etiketini gerçek model örnekleriyle açıklıyoruz.",
    lead: "Enerji etiketi, klimanın bir sezon boyunca ne kadar verimli çalıştığını tek bakışta gösterir. Etiketi doğru okumak, yıllarca ödeyeceğiniz elektrik faturasını doğrudan etkiler.",
    answer: "SEER soğutmada, SCOP ısıtmada sezonluk verimliliği gösterir; değer ne kadar yüksekse aynı iş için o kadar az elektrik harcanır. Enerji sınıfı (A+++, A++ …) bu değerlerin belirli aralıklara göre harfle ifadesidir.",
    image: { key: "enerjiEtiketi", alt: "A+++ ile D arasındaki enerji sınıfı basamaklarını ve SEER, SCOP değerlerini gösteren etiket çizimi", caption: "Etiketin üst basamakları daha yüksek SEER ve SCOP değerlerine karşılık gelir." },
    sections: [
      { id: "seer-scop", title: "SEER ve SCOP nedir?", html: `
<p><b>SEER</b> (Seasonal Energy Efficiency Ratio), klimanın soğutma sezonu boyunca ürettiği toplam soğutmanın harcadığı toplam elektriğe oranıdır. <b>SCOP</b> (Seasonal Coefficient of Performance) aynı hesabı ısıtma sezonu için yapar.</p>
<p>Örneğin SEER değeri 8,5 olan bir klima, sezon boyunca harcadığı her 1 kWh elektrik karşılığında ortalama 8,5 kWh soğutma üretir. Sezonluk değerler, farklı dış sıcaklıklardaki ve kısmi yükteki çalışmayı da hesaba kattığı için tek bir anlık ölçümden daha gerçekçidir.</p>` },
      { id: "siniflar", title: "Enerji sınıfları hangi değerlere karşılık gelir?", html: `
<p>Avrupa Birliği'nin klimalar için enerji etiketi düzenlemesinde (626/2011) 12 kW'a kadar split klimalar için sınıf aralıkları şöyledir:</p>
<div class="g-table-wrap"><table class="g-table"><caption>Soğutma (SEER) ve ısıtma (SCOP, ortalama iklim) sınıfları</caption><thead><tr><th scope="col">Sınıf</th><th scope="col">SEER (soğutma)</th><th scope="col">SCOP (ısıtma)</th></tr></thead><tbody>
<tr><td><b>A+++</b></td><td>8,50 ve üzeri</td><td>5,10 ve üzeri</td></tr>
<tr><td><b>A++</b></td><td>6,10 – 8,50</td><td>4,60 – 5,10</td></tr>
<tr><td><b>A+</b></td><td>5,60 – 6,10</td><td>4,00 – 4,60</td></tr>
<tr><td><b>A</b></td><td>5,10 – 5,60</td><td>3,40 – 4,00</td></tr>
</tbody></table></div>
<p>Aynı enerji sınıfı içinde de fark olabilir. Bu nedenle iki ürünü karşılaştırırken yalnız harfe değil, etiketteki SEER ve SCOP değerine bakın.</p>` },
      { id: "ornek", title: "Gerçek örnek: aynı kapasite, farklı verim", html: `
<p>12.000 BTU/h GREE modellerinin enerji etiketlerindeki SEER değerleri:</p>
<div class="g-table-wrap"><table class="g-table"><caption>12.000 BTU/h duvar tipi GREE modelleri</caption><thead><tr><th scope="col">Seri</th><th scope="col">Soğutma / ısıtma sınıfı</th><th scope="col">SEER (etiket)</th></tr></thead><tbody>
<tr><td><a href="catalog.html?category=Duvar%20Tipi&amp;series=Airy">Airy</a></td><td>A+++ / A++</td><td>8,5</td></tr>
<tr><td><a href="catalog.html?category=Duvar%20Tipi&amp;series=Fairy">Fairy</a></td><td>A++ / A+</td><td>7,1</td></tr>
<tr><td><a href="catalog.html?category=Duvar%20Tipi&amp;series=Pular">Pular</a></td><td>A++ / A+</td><td>6,1</td></tr>
<tr><td><a href="catalog.html?category=Duvar%20Tipi&amp;series=Aphro">Aphro</a></td><td>A++ / A+</td><td>6,1</td></tr>
</tbody></table></div>
<p>Aynı soğutma işini yapmak için SEER değeri 8,5 olan bir klima, SEER değeri 6,1 olan bir klimaya göre sezon boyunca yaklaşık %28 daha az elektrik harcar (6,1 ÷ 8,5 ≈ 0,72). Klimayı ne kadar uzun kullanıyorsanız bu fark o kadar önemli hâle gelir.</p>` },
      { id: "tuketim", title: "Klima ne kadar elektrik harcar?", html: `
<p>Kabaca bir tahmin için ürün sayfasındaki soğutma güç tüketimini (W) kullanabilirsiniz. Örneğin GREE Airy 12.000 BTU/h modelinin nominal soğutma güç tüketimi 875 W'tır; bu, nominal güçte bir saat çalışmanın yaklaşık 0,875 kWh elektrik harcadığı anlamına gelir.</p>
<p>Gerçek tüketim genellikle bundan düşüktür: inverter klima hedef sıcaklığa ulaştıktan sonra nominal gücün altında çalışır. Tüketimi etkileyen başlıca etkenler şunlardır:</p>
<ul class="g-list">
<li>Ayarlanan sıcaklık ile dış sıcaklık arasındaki fark</li>
<li>Odanın yalıtımı ve güneş alma durumu</li>
<li>Klimanın kapasitesinin odaya uygun olması</li>
<li>Filtrelerin ve dış ünitenin temizliği</li>
</ul>
<p>Aylık maliyeti hesaplamak için tahmini kWh değerini faturanızdaki güncel birim fiyatla çarpabilirsiniz.</p>` },
    ],
    faq: [
      ["A++ ile A+++ arasındaki fark nedir?", "A+++ sınıfı soğutmada SEER değerinin 8,5 ve üzerinde olduğunu, A++ ise 6,1 ile 8,5 arasında olduğunu gösterir. Örneğin SEER 8,5 olan bir klima, SEER 6,1 olan bir klimaya göre aynı soğutma için yaklaşık %28 daha az elektrik harcar."],
      ["Enerji etiketinde iki ayrı sınıf neden var?", "Klimalar hem soğutma hem ısıtma yaptığı için etikette soğutma (SEER) ve ısıtma (SCOP) için ayrı sınıflar gösterilir. Ürün sayfalarımızda bu iki değer 'A+++ / A++' biçiminde birlikte yazılır."],
    ],
    related: ["inverter-klima-nedir", "gree-serileri-karsilastirma", "klima-bakimi-ne-zaman"],
    products: [
      { label: "Airy serisi (A+++)", href: "catalog.html?category=Duvar%20Tipi&series=Airy" },
      { label: "Tüm duvar tipi klimalar", href: "catalog.html?category=Duvar%20Tipi" },
    ],
  },

  {
    slug: "wifi-klima-ne-ise-yarar",
    category: "teknoloji",
    title: "Wi-Fi Klima Ne İşe Yarar?",
    seoTitle: "Wi-Fi Klima Ne İşe Yarar? Uzaktan Kontrol ve Kurulum",
    description: "Wi-Fi özellikli klima ile telefonunuzdan açma-kapama, sıcaklık ve zamanlama yapabilirsiniz. Hangi GREE serilerinde Wi-Fi var, kurulum nasıl yapılır?",
    lead: "Wi-Fi özellikli bir klimayı evdeki kablosuz ağa bağladığınızda, uzaktan kumandanın yaptığı her şeyi telefonunuzdan, evde olmasanız bile yapabilirsiniz.",
    answer: "Wi-Fi, klimayı internet üzerinden telefonla kontrol etmenizi sağlar: eve gelmeden açabilir, unuttuğunuz klimayı kapatabilir, sıcaklığı ve zamanlamayı değiştirebilirsiniz. GREE Airy, Fairy ve Pular modellerinde Wi-Fi bulunur; Aphro'da opsiyoneldir.",
    image: { key: "wifi", alt: "Telefon uygulamasıyla Wi-Fi üzerinden kontrol edilen duvar tipi klima çizimi", caption: "Klima ev ağına bağlandığında telefon uygulamasıyla her yerden yönetilebilir." },
    sections: [
      { id: "neler", title: "Wi-Fi ile neler yapılabilir?", html: `
<ul class="g-checklist">
<li>Eve varmadan klimayı açıp odayı önceden serinletmek veya ısıtmak</li>
<li>Açık unutulan klimayı uzaktan kapatmak</li>
<li>Mod, sıcaklık ve fan hızını telefondan değiştirmek</li>
<li>Haftalık zamanlama kurmak</li>
<li>Yazlık veya işyeri gibi sürekli bulunmadığınız mekânları uzaktan yönetmek</li>
</ul>` },
      { id: "seriler", title: "Hangi GREE serilerinde Wi-Fi var?", html: `
<div class="g-table-wrap"><table class="g-table"><caption>Duvar tipi GREE serilerinde Wi-Fi</caption><thead><tr><th scope="col">Seri</th><th scope="col">Wi-Fi kontrol</th></tr></thead><tbody>
<tr><td><a href="catalog.html?category=Duvar%20Tipi&amp;series=Airy">Airy</a></td><td>Var</td></tr>
<tr><td><a href="catalog.html?category=Duvar%20Tipi&amp;series=Fairy">Fairy</a></td><td>Var</td></tr>
<tr><td><a href="catalog.html?category=Duvar%20Tipi&amp;series=Pular">Pular</a></td><td>Var</td></tr>
<tr><td><a href="catalog.html?category=Duvar%20Tipi&amp;series=Aphro">Aphro</a></td><td>Opsiyonel</td></tr>
</tbody></table></div>
<p>Her modelin Wi-Fi bilgisi ürün sayfasındaki teknik özelliklerde yer alır. Wi-Fi kitleri <a href="catalog.html?category=Yedek%20Par%C3%A7a">yedek parça</a> bölümünde listelenir; opsiyonel modeller için uygun kiti <a href="contact.html?subject=yedek">bize sorabilirsiniz</a>.</p>` },
      { id: "kurulum", title: "Kurulum nasıl yapılır?", html: `
<p>Kurulum genellikle birkaç dakika sürer: telefona üreticinin uygulaması yüklenir, klima eşleştirme moduna alınır ve evdeki 2,4 GHz kablosuz ağ bilgileri girilir. Adımlar modele göre küçük farklılıklar gösterebilir; ayrıntılar üreticinin <a href="https://tlcklima.com/wp-content/uploads/2025/10/GREE%20Klima%20Wifi%20Kurulum.pdf" target="_blank" rel="noopener noreferrer">GREE klima Wi-Fi kurulum kılavuzunda<span class="sr-only"> (PDF, yeni sekmede açılır)</span></a> yer alır.</p>
<div class="g-callout"><b>İpucu:</b> İç ünitenin bulunduğu odada kablosuz sinyal zayıfsa bağlantı kopabilir. Modem ile klima arasındaki mesafeyi kurulum öncesinde kontrol edin.</div>` },
    ],
    faq: [
      ["Wi-Fi klima internet kesilince çalışır mı?", "Evet. İnternet bağlantısı yalnız uzaktan kontrol için gereklidir; klima uzaktan kumandayla normal şekilde çalışmaya devam eder."],
    ],
    related: ["gree-serileri-karsilastirma", "inverter-klima-nedir", "mekana-gore-klima-secimi"],
    products: [
      { label: "Wi-Fi özellikli duvar tipi klimalar", href: "catalog.html?category=Duvar%20Tipi" },
      { label: "Yedek parça ve Wi-Fi kiti", href: "catalog.html?category=Yedek%20Par%C3%A7a" },
    ],
  },

  {
    slug: "gree-serileri-karsilastirma",
    category: "teknoloji",
    title: "GREE Airy, Fairy, Pular ve Aphro Karşılaştırması",
    seoTitle: "GREE Airy, Fairy, Pular, Aphro Karşılaştırma: Hangisi?",
    description: "GREE duvar tipi serilerini enerji sınıfı, SEER, kapasite, Wi-Fi, filtre ve renk seçenekleriyle yan yana karşılaştırın; ihtiyacınıza uygun seriyi bulun.",
    lead: "Dört GREE duvar tipi seri de inverter teknolojili ve R32 soğutucu akışkanlıdır. Aralarındaki fark verimlilik, donanım, renk seçenekleri ve fiyat seviyesinde ortaya çıkar.",
    answer: "En yüksek verimlilik ve iki renk seçeneği için Airy; geniş kapasite aralığı ve çok fonksiyonlu filtre için Fairy; Wi-Fi'lı ve kompakt bir model için Pular; en uygun başlangıç fiyatı için Aphro öne çıkar.",
    image: { key: "airySiyah", alt: "Siyah GREE Airy duvar tipi inverter klima", caption: "GREE Airy, beyaz ve siyah renk seçenekleriyle sunulur." },
    sections: [
      { id: "tablo", title: "Seriler yan yana", html: `
<div class="g-table-wrap"><table class="g-table g-compare"><caption>GREE duvar tipi seriler (doğrulanmış üretici verisi)</caption><thead><tr><th scope="col">Özellik</th><th scope="col">Airy</th><th scope="col">Fairy</th><th scope="col">Pular</th><th scope="col">Aphro</th></tr></thead><tbody>
<tr><th scope="row">Kapasiteler (BTU/h)</th><td>9.000 · 12.000 · 18.000</td><td>9.000 · 12.000 · 18.000 · 24.000</td><td>9.000 · 12.000 · 18.000 · 24.000</td><td>9.000 · 12.000</td></tr>
<tr><th scope="row">Enerji sınıfı (soğutma / ısıtma)</th><td>A+++ / A++</td><td>A++ / A+</td><td>A++ / A+</td><td>A++ / A+</td></tr>
<tr><th scope="row">SEER (etiket)</th><td>8,5 – 9,0</td><td>7,0 – 7,5</td><td>6,1 – 6,6</td><td>6,1 – 6,6</td></tr>
<tr><th scope="row">Wi-Fi kontrol</th><td>Var</td><td>Var</td><td>Var</td><td>Opsiyonel</td></tr>
<tr><th scope="row">Çok fonksiyonlu filtre</th><td>Var</td><td>Var</td><td>—</td><td>—</td></tr>
<tr><th scope="row">Renk</th><td>Beyaz, siyah</td><td>Beyaz, siyah</td><td>Mat beyaz</td><td>Beyaz</td></tr>
<tr><th scope="row">Güncel başlangıç fiyatı</th><td data-series-card="Airy"><span data-series-field="from">—</span></td><td data-series-card="Fairy"><span data-series-field="from">—</span></td><td data-series-card="Pular"><span data-series-field="from">—</span></td><td data-series-card="Aphro"><span data-series-field="from">—</span></td></tr>
</tbody></table></div>
<p class="g-note">Teknik değerler GREE Türkiye ürün sayfalarından alınmıştır; SEER aralığı kapasiteye göre değişir. Başlangıç fiyatları sayfayı açtığınız anda ürün kataloğumuzdan okunur.</p>` },
      { id: "airy", title: "Airy: en yüksek verimlilik", html: `
<figure class="g-figure g-figure-photo"><img src="/assets/home/airy-beyaz-880.webp" width="822" height="515" alt="Beyaz GREE Airy duvar tipi klima" loading="lazy" decoding="async"></figure>
<p>Soğutmada A+++ sınıfı ve 8,5–9,0 SEER değeriyle serinin en verimli üyesidir. Beyaz ve siyah renk seçeneği, Wi-Fi ve çok fonksiyonlu filtre sunar. Uzun saatler çalışacak klimalar ve tasarıma önem verenler için uygundur.</p>
<p><a class="g-inline-cta" href="catalog.html?category=Duvar%20Tipi&amp;series=Airy">Airy modellerini görün</a></p>` },
      { id: "fairy", title: "Fairy: dört kapasite, dengeli donanım", html: `
<figure class="g-figure g-figure-photo"><img src="/assets/home/fairy-720.webp" width="720" height="273" alt="Beyaz GREE Fairy duvar tipi klima" loading="lazy" decoding="async"></figure>
<p>9.000'den 24.000 BTU/h'ye kadar dört kapasitesi sayesinde evin tüm odalarında aynı seriyi kullanmak isteyenler için pratik bir seçimdir. Wi-Fi ve çok fonksiyonlu filtre standarttır.</p>
<p><a class="g-inline-cta" href="catalog.html?category=Duvar%20Tipi&amp;series=Fairy">Fairy modellerini görün</a></p>` },
      { id: "pular", title: "Pular: Wi-Fi'lı ve kompakt", html: `
<figure class="g-figure g-figure-photo"><img src="/assets/home/pular-720.webp" width="720" height="392" alt="Mat beyaz GREE Pular duvar tipi klima" loading="lazy" decoding="async"></figure>
<p>Mat beyaz gövdesi ve kompakt iç ünitesiyle sade bir görünüm sunar; Wi-Fi kontrol standarttır. 12.000 BTU/h modelinin iç ünite genişliği 779 mm'dir (Fairy 12.000'de 889 mm).</p>
<p><a class="g-inline-cta" href="catalog.html?category=Duvar%20Tipi&amp;series=Pular">Pular modellerini görün</a></p>` },
      { id: "aphro", title: "Aphro: uygun başlangıç", html: `
<figure class="g-figure g-figure-photo"><img src="/assets/home/aphro-720.webp" width="720" height="325" alt="Beyaz GREE Aphro duvar tipi klima" loading="lazy" decoding="async"></figure>
<p>9.000 ve 12.000 BTU/h kapasiteleriyle küçük ve orta büyüklükteki odalar için bütçe dostu seçenektir. Wi-Fi opsiyoneldir; modelinize uygun Wi-Fi kiti için bizimle iletişime geçebilirsiniz.</p>
<p><a class="g-inline-cta" href="catalog.html?category=Duvar%20Tipi&amp;series=Aphro">Aphro modellerini görün</a></p>` },
    ],
    faq: [
      ["GREE'nin en verimli duvar tipi serisi hangisi?", "Kataloğumuzdaki seriler arasında Airy, soğutmada A+++ sınıfı ve 8,5–9,0 SEER değeriyle en verimli seridir."],
      ["Hangi GREE serisinde 24.000 BTU seçeneği var?", "Duvar tipi serilerden Fairy ve Pular 24.000 BTU/h kapasitede sunulur."],
    ],
    related: ["enerji-sinifi-seer-scop", "wifi-klima-ne-ise-yarar", "btu-kapasite-farklari"],
    products: [
      { label: "Airy", href: "catalog.html?category=Duvar%20Tipi&series=Airy" },
      { label: "Fairy", href: "catalog.html?category=Duvar%20Tipi&series=Fairy" },
      { label: "Pular", href: "catalog.html?category=Duvar%20Tipi&series=Pular" },
      { label: "Aphro", href: "catalog.html?category=Duvar%20Tipi&series=Aphro" },
    ],
  },
];
