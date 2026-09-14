(() => {
  'use strict';
  const data = JSON.parse(document.getElementById('restaurant-data').textContent);
  const page = document.getElementById('restaurants');
  const q = selector => page.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const link = (url, text) => {
    try { if (!['https:', 'http:'].includes(new URL(url).protocol)) return escape(text); } catch (_) { return escape(text); }
    return `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(text)}</a>`;
  };
  const source = url => url ? ` · ${link(url, '來源 ↗')}` : '';
  const modeNames = {walking:'步行', driving:'駕車', transit:'公共交通'};
  const mealNames = {lunch:'午餐', dinner:'晚餐'};
  let locationId = data.locations[0].id, switchingLocation = false;
  let sortKey = '', sortDirection = 'ascending';
  const expanded = new Set();
  const locationData = () => data.locations.find(item => item.id === locationId);
  const field = name => q(`#restaurant-${name}`);
  const value = name => field(name).value;
  const numeric = n => typeof n === 'number' && Number.isFinite(n);
  const yen = n => `¥${n.toLocaleString('ja-JP')}`;
  function prices(row) {
    if (value('meal') === 'late_night' && row.late_night?.price_known === false) return [];
    const meals = value('meal') === 'late_night' ? ['dinner'] : value('meal') ? [value('meal')] : (row.meals || []);
    return meals.map(meal => row.price?.[meal]).filter(price => price && numeric(price.min) && numeric(price.max));
  }
  function priceSort(row) {
    const values = prices(row).map(price => price.min);
    return values.length ? Math.min(...values) : null;
  }
  function priceHTML(row) {
    const entries = ['lunch', 'dinner'].filter(meal => row.price?.[meal]);
    if (!entries.length) return '<p>現行餐單價格待核實</p>';
    const lateWarning = value('meal') === 'late_night' && row.late_night?.price_known === false ? '<p><span class="restaurant-badge pending">宵夜總價待核實</span><br>下列為一般時段牌價，未含深夜加價。</p>' : '';
    return lateWarning + entries.map(meal => {
      const price = row.price[meal];
      const range = numeric(price.min) && numeric(price.max) ? `${yen(price.min)}${price.max !== price.min ? '–' + yen(price.max) : ''}` : '價格待核實';
      return `<p><strong>${mealNames[meal]} ${range}</strong></p>`;
    }).join('') + '<p class="small">餐點及收費依據見詳情</p>';
  }
  function ratingHTML(row) {
    const g = row.google || {};
    if (g.verification !== 'direct' || !numeric(g.rating)) return `${link(g.url, 'Google Maps ↗')}<p class="small">評分及評論數未直接核實</p>`;
    return `${link(g.url, `★ ${g.rating.toFixed(1)}`)}<p>${Number.isInteger(g.review_count) ? g.review_count.toLocaleString() + ' 則評論' : '評論數待核實'}</p>${numeric(g.review_count) && g.review_count < 100 ? '<span class="restaurant-badge pending">樣本較少（少於 100 則）</span>' : ''}<p class="small">查閱 ${escape(g.checked_at)}</p>`;
  }
  function routeHTML(row) {
    const route = row.route || {};
    const numbers = `${numeric(route.distance_km) ? route.distance_km + ' 公里' : '路程未核實'}${numeric(route.minutes) ? ' · 約 ' + route.minutes + ' 分鐘' : ' · 時間未核實'}`;
    const status = route.verification === 'estimate' ? '估算，非已量度路線' : route.verification === 'verified' ? '已核對路線' : '路線待核實';
    return `<p><strong>${escape(modeNames[route.mode] || '交通待核實')}</strong><br>${escape(numbers)}</p><p class="small">${escape(status)}<br>起點：${escape(locationData().id === 'osaka' ? '天下茶屋駅（公開參考點）' : '本區飯店')}</p>`;
  }
  function blogHTML(row, detailed = false) {
    if (!row.blogs?.length) return '<p class="small">未找到可核實的台灣／香港食記</p>';
    return row.blogs.map(blog => `<p>${link(blog.url, detailed ? blog.title : blog.site + ' 食記 ↗')}<br><span class="small">${detailed ? escape(blog.site) + ' · ' : ''}${escape(blog.region)} · ${escape(blog.date || '日期未明')}</span>${detailed ? `<br>${escape(blog.takeaway)}<br><span class="small">${link(blog.region_source_url, '作者／網站地區依據')}</span>` : ''}</p>`).join('');
  }
  function shopLinksHTML(row) {
    const candidates = [
      ...(row.sources || []),
      {label: 'Google Maps 店舖', url: row.google?.url},
      {label: '午餐菜單／價格', url: row.price?.lunch?.source_url},
      {label: '晚餐菜單／價格', url: row.price?.dinner?.source_url},
      {label: '營業時間', url: row.hours?.source_url},
      {label: '訂位資訊', url: row.reservation?.url},
      {label: '泊車資訊', url: row.parking?.source_url},
      {label: '禁菸政策', url: row.smoking?.source_url},
      {label: '付款資訊', url: row.payment?.source_url},
      {label: '交通路線', url: row.route?.source_url}
    ];
    const grouped = new Map();
    for (const item of candidates) {
      if (!item.url) continue;
      if (!grouped.has(item.url)) grouped.set(item.url, new Set());
      grouped.get(item.url).add(item.label);
    }
    return `<ul class="restaurant-shop-links">${[...grouped].map(([url, labels]) => `<li>${link(url, [...labels].join('／') + ' ↗')}</li>`).join('')}</ul>`;
  }
  function detailHTML(row) {
    const hours = row.hours || {}, smoke = row.smoking || {}, parking = row.parking || {}, reservation = row.reservation || {}, payment = row.payment || {};
    return `<div class="restaurant-row-details"><h4>${escape(row.name)} · 用餐詳情</h4>${row.status === 'pending' ? `<p><strong>待核實：</strong>${escape((row.pending_reasons || []).join('；'))}</p>` : ''}
      <div class="restaurant-detail-grid"><div><h5>到訪星期／預定營業時間</h5><p>${escape(hours.visit_days || '')} · ${escape(hours.text || '營業時間未核實')}${source(hours.source_url)}</p><p>定休：${escape(hours.closed || '未核實')}<br>最後點餐：${escape(hours.last_order || '未核實')}</p><p class="small">${hours.date_specific ? '來源列有到訪日期資訊；訂位情況仍須向店家確認。' : '一般星期營業安排；尚未確認 2026 年到訪日期的臨時休業或座位。'}</p><h5>這一餐怎樣選</h5><p>${escape(row.meal_note || '用餐時段待核實')}</p><p>${escape(row.why)}</p></div>
      <div><h5>價格依據／不辣點餐</h5><p>${escape(row.price?.note || '稅項、飲品及額外收費未核實。')}</p>${['lunch', 'dinner'].filter(meal => row.price?.[meal]).map(meal => `<p>${mealNames[meal]}：${escape(row.price[meal].text)}${source(row.price[meal].source_url)}</p>`).join('')}<p>${escape(row.dishes)}</p><h5>訂位</h5><p>${escape(reservation.text || '訂位規則未核實')}${reservation.url ? ' · ' + link(reservation.url, '訂位資訊 ↗') : ''}</p><h5>付款</h5><p>${escape(payment.text || '付款方式未核實')}${source(payment.source_url)}</p></div>
      <div><h5>交通及停車</h5><p>${escape(row.route?.note || '實際路線待核實')}${source(row.route?.source_url)}</p><p>停車：${escape(parking.text || '未核實')}${source(parking.source_url)}</p><h5>禁煙政策</h5><p>${escape(smoke.text || '未核實；不列入主清單')}${source(smoke.source_url)}</p>${smoke.policy === 'enclosed_room' ? '<p class="small">設獨立吸煙室，並非全店禁煙；可優先選擇全店禁煙店家。</p>' : ''}<h5>台灣／香港食記</h5>${blogHTML(row, true)}</div></div>
      <h5>資料來源 · 最後查閱 ${escape(row.checked_at || '未記錄')}</h5><p class="small">${escape(row.google?.evidence || 'Google 評分尚未直接核實。')}</p><ul class="small">${(row.sources || []).map(item => `<li>${link(item.url, item.label)} · ${escape(item.checked_at || row.checked_at)}</li>`).join('')}</ul></div>`;
  }
  function sortButton(key, label, secondary = false) {
    const active = sortKey === key;
    return `<button type="button" data-sort="${key}" aria-pressed="${active}"${secondary ? ' class="restaurant-sort-secondary"' : ''} aria-label="按${label}排序${active ? (sortDirection === 'ascending' ? '，目前升序' : '，目前降序') : ''}">${label}<span aria-hidden="true">${active ? (sortDirection === 'ascending' ? '↑' : '↓') : '↕'}</span></button>`;
  }
  function sortAttribute(...keys) {
    return keys.includes(sortKey) ? ` aria-sort="${sortDirection}"` : '';
  }
  function rowHTML(row, index) {
    const open = expanded.has(row.id);
    return `<tr class="restaurant-row${index % 2 ? ' alternate' : ''}" data-restaurant-id="${escape(row.id)}"><th scope="row"><h3 lang="ja">${escape(row.name)}</h3>${row.name_en ? `<p class="restaurant-name-en" lang="en">${escape(row.name_en)}${row.name_en_note ? `<br><span class="small" lang="zh-Hant">${escape(row.name_en_note)}</span>` : ''}</p>` : ''}<p class="restaurant-address" lang="ja">${link(row.google?.url, row.address_ja || '地址待核實')}</p><span class="restaurant-badge${row.status === 'pending' ? ' pending' : ''}">${row.status === 'pending' ? '待核實' : '已核實'}</span><br><button type="button" data-details="${escape(row.id)}" aria-controls="restaurant-details-${escape(row.id)}" aria-expanded="${open}">${open ? '收起詳情 −' : '用餐詳情 ＋'}</button></th>
      <td><p><strong>${escape(row.cuisine)}</strong></p><p>${escape(row.dishes)}</p>${row.buffet?.suitable ? `<span class="restaurant-badge">食到飽</span><p>${escape(row.buffet.text)}</p>` : ''}<span class="small">${escape(row.meal_note || (row.meals || []).map(meal => mealNames[meal]).join('／'))}</span></td>
      <td>${ratingHTML(row)}</td><td>${priceHTML(row)}</td><td><p><strong>${escape(row.hours?.visit_days || '到訪星期')}</strong><br>${escape(row.hours?.text || '營業時間待核實')}</p><p class="small">最後點餐：${escape(row.hours?.last_order || '待核實')}<br>定休：${escape(row.hours?.closed || '待核實')}</p>${row.late_night?.suitable ? `<span class="restaurant-badge">宵夜可選</span><p class="small">${escape(row.late_night.text)}</p>` : ''}</td><td>${routeHTML(row)}</td><td class="restaurant-parking"><p>${escape(row.parking?.text || "泊車安排未核實")}${source(row.parking?.source_url)}</p></td><td class="restaurant-smoking"><p>${escape(row.smoking?.text || "禁菸政策未核實")}${source(row.smoking?.source_url)}</p>${row.smoking?.policy === "enclosed_room" ? '<span class="restaurant-badge pending">設獨立吸菸室</span>' : ""}</td><td class="restaurant-booking"><p>${escape(row.reservation?.text || "訂位方式待核實")}</p>${row.reservation?.url ? link(row.reservation.url, "訂位／店舖資訊 ↗") : '<p class="small">未有已核實的訂位連結</p>'}</td><td class="restaurant-shop">${shopLinksHTML(row)}</td><td>${blogHTML(row)}</td></tr>
      <tr class="restaurant-expanded" id="restaurant-details-${escape(row.id)}" ${open ? '' : 'hidden'}><td colspan="11">${detailHTML(row)}</td></tr>`;
  }
  function tableHTML(rows, title, total) {
    if (!rows.length) return `<div class="restaurant-empty"><h3>${total ? '沒有符合篩選條件的餐廳' : '主清單暫未有完整核實的餐廳'}</h3><p>${total ? '可調整條件或按「重設篩選」。' : '已查閱的候選及尚欠證據列於下方；未核實店家不會補入目標名額。'}</p></div>`;
    return `<div class="restaurant-horizontal-scroll"><input type="range" min="0" max="0" value="0" step="1" aria-label="${escape(title)}，左右捲動表格"></div><div class="restaurant-table-scroll" tabindex="0" role="region" aria-label="${escape(title)}，可捲動"><table class="restaurant-table" aria-label="${escape(title)}"><thead><tr><th scope="col"${sortAttribute('name')}>${sortButton('name', '餐廳／地址')}</th><th scope="col"${sortAttribute('cuisine')}>${sortButton('cuisine', '料理／招牌菜')}</th><th scope="col"${sortAttribute('rating', 'reviews')}>${sortButton('rating', 'Google 評分')}${sortButton('reviews', '評論數', true)}</th><th scope="col"${sortAttribute('price')}>${sortButton('price', '每人餐費')}</th><th scope="col">營業時間<br><span class="small">到訪星期／預定時間</span></th><th scope="col"${sortAttribute('distance')}>${sortButton('distance', '路程／交通')}</th><th scope="col">泊車</th><th scope="col">禁菸</th><th scope="col">如何訂位</th><th scope="col">店舖／菜單連結 ↗</th><th scope="col">台灣／香港食記</th></tr></thead><tbody>${rows.map(rowHTML).join('')}</tbody></table></div>`;
  }
  function filtered(rows) {
    const search = value('search').trim().toLocaleLowerCase();
    const budget = value('budget') ? value('budget').split('-').map(Number) : null;
    const result = rows.filter(row => (!search || [row.name, row.name_en, row.cuisine, row.dishes, row.address_ja].join(' ').toLocaleLowerCase().includes(search)) &&
      (!value('cuisine') || row.cuisine === value('cuisine')) && (!value('meal') || (value('meal') === 'late_night' ? row.late_night?.suitable : row.meals?.includes(value('meal')))) &&
      (!value('mode') || row.route?.mode === value('mode')) && (!field('buffet').checked || row.buffet?.suitable) &&
      (!budget || prices(row).some(price => [price.min, price.max].some(amount => amount >= budget[0] && amount <= budget[1]))));
    const sorter = {name: row => row.name, cuisine: row => row.cuisine, distance: row => row.route?.distance_km, price: priceSort, rating: row => row.google?.rating, reviews: row => row.google?.review_count}[sortKey];
    if (sorter) result.sort((a, b) => {
      const av = sorter(a), bv = sorter(b);
      if (['name', 'cuisine'].includes(sortKey)) return String(av || '').localeCompare(String(bv || ''), 'zh-Hant') * (sortDirection === 'ascending' ? 1 : -1);
      if (!numeric(av)) return numeric(bv) ? 1 : 0;
      if (!numeric(bv)) return -1;
      return sortDirection === 'descending' ? bv - av : av - bv;
    });
    return result;
  }
  function renderRows() {
    const rows = locationData().restaurants;
    const main = rows.filter(row => row.status === 'verified'), pending = rows.filter(row => row.status === 'pending');
    const mainShown = filtered(main), pendingShown = filtered(pending);
    field('main-list').innerHTML = tableHTML(mainShown, '已核實餐廳', main.length);
    field('pending-list').innerHTML = tableHTML(pendingShown, '待核實候選（不計入主清單）', pending.length);
    for (const list of [field('main-list'), field('pending-list')]) {
      const rail = list.querySelector('.restaurant-horizontal-scroll');
      const table = list.querySelector('.restaurant-table-scroll');
      if (!rail || !table) continue;
      const slider = rail.querySelector('input');
      slider.addEventListener('input', () => { table.scrollLeft = Number(slider.value); });
      table.addEventListener('scroll', () => { slider.value = table.scrollLeft; });
    }
    resizeScrollRails();
    field('pending').hidden = !pending.length;
    field('pending-title').textContent = `待核實候選 · 顯示 ${pendingShown.length}／${pending.length} 間`;
    field('count').textContent = `已核實：顯示 ${mainShown.length}／${main.length} 間 · 目標 ${locationData().target} 間；待核實：${pendingShown.length}／${pending.length} 間`;
  }
  function resizeScrollRails() {
    for (const rail of page.querySelectorAll('.restaurant-horizontal-scroll')) {
      const table = rail.nextElementSibling;
      const slider = rail.querySelector('input');
      slider.max = Math.max(0, table.scrollWidth - table.clientWidth);
      slider.disabled = Number(slider.max) === 0;
      slider.value = table.scrollLeft;
    }
  }
  function selectLocation(id) {
    if (!data.locations.some(location => location.id === id)) return;
    locationId = id;
    const location = locationData();
    q('.restaurant-tabs').innerHTML = data.locations.map(item => `<button type="button" role="tab" id="restaurant-tab-${item.id}" data-location="${item.id}" aria-selected="${item.id === id}" aria-controls="restaurant-panel" tabindex="${item.id === id ? 0 : -1}">${escape(item.label)}</button>`).join('');
    field('panel').setAttribute('aria-labelledby', `restaurant-tab-${id}`);
    field('origin').innerHTML = `<p class="eyebrow">${escape(location.date_label)}</p><h2>${escape(location.origin)}</h2><p lang="ja">${escape(location.address)}</p><p>${escape(location.boundary)}</p>${location.origin_note ? `<p class="origin-note">${escape(location.origin_note)}</p>` : ''}`;
    const count = location.restaurants.filter(row => row.status === 'verified').length;
    field('coverage').innerHTML = `<strong>${count}／${location.target} 間已核實${count < location.target ? ` · 尚差 ${location.target - count} 間` : ''}</strong><p>${escape(location.summary)}</p>`;
    const late = location.restaurants.filter(row => row.status === 'verified' && row.late_night?.suitable);
    field('late-recommendations').textContent = late.length ? `宵夜可選：${late.map(row => row.name).join('、')}。選擇「宵夜」時段查看，請留意表內最後點餐時間。` : '本區暫未核實 22:00 後仍可點餐的宵夜選項；晚餐營業不代表深夜仍接單。';
    switchingLocation = true;
    sortKey = '';
    field('filters').reset();
    switchingLocation = false;
    field('cuisine').innerHTML = '<option value="">所有料理</option>' + [...new Set(location.restaurants.map(row => row.cuisine))].sort().map(cuisine => `<option value="${escape(cuisine)}">${escape(cuisine)}</option>`).join('');
    field('pending').open = count === 0;
    renderRows();
  }
  function openPage(id = locationId, focus = false) {
    if (id !== locationId || !q('[data-location]')) selectLocation(id);
    document.body.classList.add('restaurants-view');
    page.hidden = false;
    resizeScrollRails();
    document.getElementById('nav-restaurants').setAttribute('aria-current', 'page');
    if (focus) q('h1').focus({preventScroll: true});
    window.scrollTo({top: 0, behavior: 'instant'});
  }
  function closePage() {
    document.body.classList.remove('restaurants-view');
    page.hidden = true;
    document.getElementById('nav-restaurants').removeAttribute('aria-current');
  }
  function hashRoute() {
    const match = /^#restaurants(?:\/(shinjuku|shimada|osaka))?$/.exec(location.hash);
    if (match) openPage(match[1] || locationId); else closePage();
  }
  document.addEventListener('click', event => {
    const anchor = event.target.closest('a[href^="#"]');
    if (!anchor) return;
    if (anchor.hash.startsWith('#restaurants')) {
      event.preventDefault();
      const id = anchor.hash.split('/')[1] || locationId;
      history.pushState(null, '', '#restaurants/' + id);
      openPage(id, true);
    } else if (document.body.classList.contains('restaurants-view')) {
      closePage();
      history.replaceState(null, '', anchor.hash || '#trip-overview');
    }
  }, true);
  page.addEventListener('click', event => {
    const sorter = event.target.closest('[data-sort]');
    if (sorter) {
      const container = sorter.closest('#restaurant-main-list, #restaurant-pending-list');
      const scrollLeft = sorter.closest('.restaurant-table-scroll').scrollLeft;
      const key = sorter.dataset.sort;
      sortDirection = sortKey === key ? (sortDirection === 'ascending' ? 'descending' : 'ascending') : (['rating', 'reviews'].includes(key) ? 'descending' : 'ascending');
      sortKey = key;
      renderRows();
      container.querySelector('.restaurant-table-scroll').scrollLeft = scrollLeft;
      container.querySelector(`[data-sort="${key}"]`).focus({preventScroll: true});
    }
    const tab = event.target.closest('[data-location]');
    if (tab) {
      selectLocation(tab.dataset.location);
      history.replaceState(null, '', '#restaurants/' + locationId);
      q(`[data-location="${locationId}"]`).focus({preventScroll: true});
    }
    const details = event.target.closest('[data-details]');
    if (details) {
      const id = details.dataset.details, show = !expanded.has(id);
      if (show) expanded.add(id); else expanded.delete(id);
      details.setAttribute('aria-expanded', String(show));
      details.textContent = show ? '收起詳情 −' : '用餐詳情 ＋';
      document.getElementById('restaurant-details-' + id).hidden = !show;
    }
  });
  q('.restaurant-tabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const list = data.locations.map(location => location.id), current = list.indexOf(event.target.dataset.location || locationId);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length;
    selectLocation(list[next]);
    history.replaceState(null, '', '#restaurants/' + locationId);
    q(`[data-location="${locationId}"]`).focus();
  });
  field('filters').addEventListener('submit', event => event.preventDefault());
  field('filters').addEventListener('input', renderRows);
  field('filters').addEventListener('change', renderRows);
  field('filters').addEventListener('reset', () => { if (!switchingLocation) { sortKey = ''; setTimeout(renderRows, 0); } });
  window.addEventListener('hashchange', hashRoute);
  window.addEventListener('popstate', hashRoute);
  window.addEventListener('resize', resizeScrollRails);
  page.addEventListener('toggle', resizeScrollRails, true);
  selectLocation(locationId);
  hashRoute();
})();
