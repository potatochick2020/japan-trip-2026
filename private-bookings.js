/* Public-site enhancement: private files stay in this browser. No network I/O. */
(() => {
  'use strict';
  const toolbar = document.getElementById('private-bookings');
  if (!toolbar) return;
  const input = document.getElementById('import-bookings');
  const importButton = document.getElementById('choose-bookings');
  const exportButton = document.getElementById('export-bookings');
  const clearButton = document.getElementById('clear-bookings');
  const status = document.getElementById('private-bookings-status');
  const DB_NAME = 'japan-trip-2026-private-bookings';
  const STORE = 'bundles';
  const MAX_FILE_BYTES = 80 * 1024 * 1024;
  const MAX_IMAGE_CHARS = 24 * 1024 * 1024;
  const baseline = JSON.parse(JSON.stringify({
    attachments: D.attachments, hotels: D.hotels, cards: D.cards,
    map_metadata: D.map_metadata
  }));
  const baselineAssets = {...ASSETS};
  const known = Object.fromEntries(['attachments', 'hotels', 'cards'].map(key =>
    [key, new Set(baseline[key].map(item => item.id))]));
  const mapIds = new Set(baseline.map_metadata.maps.map(map => map.id));
  const dates = new Set(D.days.map(day => day.date));
  let current = null;
  let busy = false;
  let hasStoredData = false;
  const originalShowBooking = window.showBooking;
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  input.accept = '.json,application/json';

  function say(message, isError = false) {
    status.textContent = message;
    status.classList.toggle('private-error', isError);
  }
  function controls(working) {
    busy = working;
    importButton.disabled = working;
    exportButton.disabled = working || !current;
    clearButton.disabled = working || !(current || hasStoredData);
    toolbar.setAttribute('aria-busy', String(working));
  }
  function fail(message) { throw new Error(message); }
  function object(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 格式不正確。`);
  }
  function string(value, label, max = 50000) {
    if (typeof value !== 'string' || value.length > max) fail(`${label} 必須是有效文字。`);
  }
  function safeURL(value, label) {
    string(value, label, 5000);
    if (!value) return;
    if (/[\s<>"'`]/.test(value)) fail(`${label} 含不安全的網址字元。`);
    let url;
    try { url = new URL(value); } catch (_) { fail(`${label} 不是有效網址。`); }
    if (url.protocol !== 'https:' || url.username || url.password) fail(`${label} 必須是 HTTPS 網址。`);
  }
  function fileKey(value) {
    return typeof value === 'string' && !value.includes('..') &&
      /^(?:originals|assets\/(?:maps|bookings))\/[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(?:png|jpe?g|webp)$/i.test(value);
  }
  function checkDates(value, label) {
    if (!Array.isArray(value) || value.length > dates.size || value.some(date => !dates.has(date))) fail(`${label} 的日期不屬於此旅程。`);
  }
  function imageData(value) {
    if (typeof value !== 'string' || value.length > MAX_IMAGE_CHARS) fail('圖片過大或格式不正確。');
    const prefix = /^data:image\/(png|jpeg|webp);base64,/.exec(value);
    if (!prefix) fail('私人圖片必須是內嵌的 PNG、JPEG 或 WebP；不接受網絡圖片網址。');
    const data = value.slice(prefix[0].length);
    if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) fail('圖片的 Base64 資料不完整。');
    let bytes;
    try { bytes = atob(data.slice(0, Math.min(64, data.length))); } catch (_) { fail('圖片資料無法解碼。'); }
    const png = bytes.startsWith('\x89PNG\r\n\x1a\n');
    const jpeg = bytes.startsWith('\xff\xd8\xff');
    const webp = bytes.startsWith('RIFF') && bytes.slice(8,12) === 'WEBP';
    if (!(prefix[1] === 'png' && png || prefix[1] === 'jpeg' && jpeg || prefix[1] === 'webp' && webp)) fail('圖片內容與宣告格式不符。');
  }
  function validate(bundle) {
    object(bundle, 'JSON');
    if (bundle.schema_version !== 1 || bundle.trip_id !== 'japan-trip-2026') fail('這不是此旅程支援的 bookings.json。');
    string(bundle.issued_at, '匯出時間', 100);
    if (!Number.isFinite(Date.parse(bundle.issued_at))) fail('匯出時間格式不正確。');
    // Block prototype keys and unreasonable structures before merging anything.
    let nodes = 0;
    function walk(value, depth = 0) {
      if (++nodes > 300000 || depth > 24) fail('JSON 結構過大或過深。');
      if (value && typeof value === 'object') {
        for (const key of Object.keys(value)) {
          if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('JSON 含不支援的欄位。');
          walk(value[key], depth + 1);
        }
      } else if (typeof value === 'number' && !Number.isFinite(value)) fail('JSON 含無效數值。');
    }
    walk(bundle);
    for (const key of ['attachments', 'hotels', 'cards']) {
      if (!Array.isArray(bundle[key]) || bundle[key].length !== known[key].size) fail(`${key} 項目數與此版本旅程不同。`);
      const seen = new Set();
      for (const item of bundle[key]) {
        object(item, key);
        if (!known[key].has(item.id) || seen.has(item.id) || !/^[a-zA-Z0-9_-]+$/.test(item.id)) fail(`${key} 含未知或重複項目。`);
        seen.add(item.id);
      }
    }
    const referenced = new Set();
    const requireFile = file => {
      if (file == null || file === '') return;
      if (!fileKey(file)) fail('附件或地圖檔名不正確。');
      referenced.add(file);
    };
    for (const a of bundle.attachments) {
      for (const key of ['name', 'type', 'status', 'number', 'summary', 'source', 'qr']) string(a[key], `附件 ${key}`);
      checkDates(a.dates, '附件');
      requireFile(a.file);
    }
    for (const hotel of bundle.hotels) {
      for (const key of ['name', 'address', 'japanese_address', 'stay', 'checkin', 'checkout', 'entry', 'owner']) string(hotel[key], `住宿 ${key}`);
      if (hotel.map_url) safeURL(hotel.map_url, '住宿地圖');
    }
    for (const card of bundle.cards) {
      for (const key of ['title', 'status', 'jp', 'zh', 'details']) string(card[key], `出示卡 ${key}`);
      if (card.address != null) string(card.address, '出示卡地址');
      checkDates(card.dates, '出示卡');
      requireFile(card.map);
      if (card.attachment && !known.attachments.has(card.attachment)) fail('出示卡引用未知附件。');
      if (card.url) safeURL(card.url, '出示卡網址');
    }
    object(bundle.map_metadata, '地圖資料');
    if (!Array.isArray(bundle.map_metadata.maps) || bundle.map_metadata.maps.length > mapIds.size) fail('地圖清單格式不正確。');
    const seenMaps = new Set();
    for (const map of bundle.map_metadata.maps) {
      object(map, '地圖');
      if (!mapIds.has(map.id) || seenMaps.has(map.id)) fail('包含未知或重複地圖。');
      seenMaps.add(map.id);
      requireFile(map.file);
      for (const key of ['title', 'disclaimer', 'attribution']) string(map[key], `地圖 ${key}`);
      safeURL(map.source, '底圖來源');
      if (!Array.isArray(map.markers) || map.markers.length > 100) fail('地圖標記格式不正確。');
      for (const marker of map.markers) {
        object(marker, '地圖標記');
        if (!/^[A-Za-z0-9 /→.-]{1,20}$/.test(String(marker.n))) fail('地圖標記編號不正確。');
        string(marker.label, '地圖標記名稱', 1000);
        safeURL(marker.google_maps, '地圖標記網址');
      }
    }
    if (bundle.map_metadata.daily_views != null) {
      object(bundle.map_metadata.daily_views, '每日地圖');
      for (const [date, view] of Object.entries(bundle.map_metadata.daily_views)) {
        if (!dates.has(date)) fail('每日地圖日期不正確。');
        object(view, '每日地圖');
        for (const key of ['overview', 'primary']) if (view[key] && !mapIds.has(view[key])) fail('每日地圖引用未知項目。');
        for (const key of ['details', 'tab_order']) if (view[key] && (!Array.isArray(view[key]) || view[key].some(id => !mapIds.has(id)))) fail('每日地圖次序不正確。');
      }
    }
    object(bundle.assets, '圖片資產');
    if (Object.keys(bundle.assets).length > 100) fail('圖片項目過多。');
    for (const [file, data] of Object.entries(bundle.assets)) {
      if (!fileKey(file) || !referenced.has(file)) fail('JSON 包含未引用或不支援的圖片檔名。');
      imageData(data);
    }
    for (const file of referenced) if (!bundle.assets[file] && !baselineAssets[file]) fail(`缺少內嵌圖片：${file}`);
    return bundle;
  }

  function database(action, value) {
    return new Promise((resolve, reject) => {
      let open, db, transaction, done = false;
      const finish = (error, result) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (error && transaction) { try { transaction.abort(); } catch (_) {} }
        if (db) db.close();
        if (error) reject(error); else resolve(result);
      };
      const timer = setTimeout(() => finish(new Error('瀏覽器儲存回應逾時。')), 5000);
      try {
        if (!window.indexedDB) throw new Error('瀏覽器不提供 IndexedDB。');
        open = indexedDB.open(DB_NAME, 1);
      } catch (error) { finish(error); return; }
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE);
      };
      open.onerror = () => finish(open.error || new Error('無法開啟瀏覽器儲存。'));
      open.onblocked = () => finish(new Error('另一個分頁正在使用瀏覽器儲存。'));
      open.onsuccess = () => {
        db = open.result;
        if (done) { db.close(); return; }
        db.onversionchange = () => db.close();
        let request, result;
        try {
          transaction = db.transaction(STORE, action === 'get' ? 'readonly' : 'readwrite');
          const store = transaction.objectStore(STORE);
          request = action === 'get' ? store.get('current') : store.put(value, 'current');
          request.onsuccess = () => { result = request.result; };
          transaction.oncomplete = () => finish(null, result);
          transaction.onerror = () => finish(transaction.error || request.error || new Error('瀏覽器儲存失敗。'));
          transaction.onabort = () => finish(transaction.error || new Error('瀏覽器儲存已中止。'));
        } catch (error) { finish(error); }
      };
    });
  }
  function deleteDatabase() {
    return new Promise((resolve, reject) => {
      let request;
      try { request = indexedDB.deleteDatabase(DB_NAME); } catch (error) { reject(error); return; }
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('刪除失敗。'));
      request.onblocked = () => reject(new Error('請先關閉此網站的其他分頁，再刪除。'));
    });
  }
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }
  function button(text, action) {
    const element = node('button', 'button', text);
    element.type = 'button';
    element.addEventListener('click', action);
    return element;
  }
  function anchor(text, url) {
    const element = node('a', 'button', text);
    element.href = url;
    element.target = '_blank';
    element.rel = 'noopener';
    return element;
  }
  function refreshBookings() {
    const grid = document.querySelector('.booking-grid');
    if (!grid) return;
    grid.replaceChildren();
    for (const a of D.attachments) {
      const card = node('div', 'booking-card card');
      card.id = `booking-${a.id}`;
      card.dataset.dates = a.dates.join(' ');
      card.dataset.type = a.type;
      card.append(node('p', 'eyebrow', `${a.type} / BOOKING`), node('h3', '', a.name),
        node('span', a.status === '待提供' ? 'status missing' : 'status', a.status),
        node('p', '', a.dates.map(date => date.slice(5).replace('-', '/')).join(' · ')),
        node('p', '', a.summary), node('p', 'small', `${a.number} · ${a.qr}`));
      const actions = node('div', 'actions');
      actions.append(button('查看原件／狀態', () => window.showBooking(a.id)),
        button('向職員出示', () => window.openStaff(`booking-${a.id}`)));
      card.append(actions);
      if (a.file && ASSETS[a.file]) {
        const preview = button('', () => window.openImage(a.file, a.name));
        preview.className = 'private-booking-preview';
        preview.setAttribute('aria-label', `放大 ${a.name}`);
        const picture = node('img');
        picture.dataset.asset = a.file;
        picture.src = ASSETS[a.file];
        picture.alt = a.name;
        preview.append(picture);
        card.append(preview);
      }
      grid.append(card);
    }
    const typeFilter = document.getElementById('booking-type');
    if (typeFilter) {
      const selectedType = typeFilter.value;
      typeFilter.replaceChildren(node('option', '', '所有類型'));
      typeFilter.firstChild.value = '';
      for (const type of new Set(D.attachments.map(a => a.type))) {
        const option = node('option', '', type); option.value = type; typeFilter.append(option);
      }
      typeFilter.value = [...typeFilter.options].some(option => option.value === selectedType) ? selectedType : '';
    }
    if (typeof filterBookings === 'function') filterBookings();
  }
  function refreshHotels() {
    document.querySelectorAll('[data-hotel-id]').forEach(card => {
      const hotel = D.hotels.find(item => item.id === card.dataset.hotelId);
      if (!hotel) return;
      card.replaceChildren(node('p', 'eyebrow', '今晚住宿 / STAY'), node('h3', '', hotel.name),
        node('p', 'address', hotel.japanese_address || hotel.address),
        node('p', '', `${hotel.stay} · 日期 TBC`),
        node('p', '', `Check-in ${hotel.checkin} · Check-out ${hotel.checkout}`),
        node('p', 'small', `${hotel.entry} · ${hotel.owner}`));
      const actions = node('div', 'actions');
      if (hotel.id !== 'ito' && (hotel.map_url || hotel.japanese_address || hotel.address))
        actions.append(anchor('住宿地圖 ↗ · 需網絡', hotelMap(hotel)));
      actions.append(button('入住出示', () => window.openStaff(`hotel-${hotel.id}`)),
        button('地址出示', () => window.openStaff(`taxi-${hotel.id}`)),
        button('Booking', () => window.showBooking(hotel.id)));
      card.append(actions);
    });
  }
  function refreshMaps(privateMaps) {
    for (const map of privateMaps) {
      const publicFile = baseline.map_metadata.maps.find(item => item.id === map.id)?.file;
      document.querySelectorAll('figure.map-wrap').forEach(figure => {
        const picture = figure.querySelector('img[data-asset]');
        if (!picture || ![map.file, publicFile].includes(picture.dataset.asset)) return;
        picture.dataset.asset = map.file;
        picture.alt = map.title;
        const caption = figure.querySelector('figcaption');
        if (caption) {
          const source = anchor('底圖來源', map.source); source.className = '';
          caption.replaceChildren(document.createTextNode(`${map.disclaimer} ${map.attribution} · `), source);
        }
        const links = figure.querySelector('.map-links');
        if (links) {
          links.replaceChildren();
          map.markers.forEach((marker, index) => {
            if (index) links.append(document.createTextNode(' · '));
            const link = anchor(`${marker.n} ${marker.label}`, marker.google_maps); link.className = '';
            links.append(link);
          });
          links.append(document.createTextNode('（需網絡）'));
        }
      });
    }
    document.querySelectorAll('.map-primary[data-current-map]').forEach(panel => {
      const date = panel.id.replace('map-primary-', '');
      if (dates.has(date)) switchMap(date, panel.dataset.currentMap);
    });
  }
  function apply(bundle) {
    D.attachments = bundle.attachments;
    D.hotels = bundle.hotels;
    D.cards = bundle.cards;
    const replacements = new Map(bundle.map_metadata.maps.map(map => [map.id, map]));
    D.map_metadata = {...baseline.map_metadata,
      maps: baseline.map_metadata.maps.map(map => replacements.get(map.id) || map),
      daily_views: Object.fromEntries(Object.entries(baseline.map_metadata.daily_views).map(([date, view]) =>
        [date, {...view, ...((bundle.map_metadata.daily_views || {})[date] || {})}]))};
    for (const key of Object.keys(ASSETS)) if (!(key in baselineAssets)) delete ASSETS[key];
    Object.assign(ASSETS, baselineAssets, bundle.assets);
    current = bundle;
    refreshBookings();
    refreshHotels();
    refreshMaps(bundle.map_metadata.maps);
    hydrate();
    choose(selected);
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  }
  importButton.addEventListener('click', () => { if (!busy) input.click(); });
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file || busy) return;
    controls(true);
    say('正在讀取私人 JSON；檔案只會在此瀏覽器處理。');
    try {
      if (file.size > MAX_FILE_BYTES) fail('JSON 超過 80 MB，請使用此旅程匯出的 bookings.json。');
      let bundle;
      try { bundle = JSON.parse(await file.text()); } catch (_) { fail('檔案不是有效 JSON。'); }
      validate(bundle);
      apply(bundle);
      try {
        await database('put', bundle);
        hasStoredData = true;
        say('私人訂單已匯入並儲存在此瀏覽器；重新開啟仍可使用，沒有上傳。');
      } catch (_) {
        say('已匯入本次頁面；瀏覽器未能保存，重新開啟後請再次匯入。JSON 沒有上傳。', true);
      }
    } catch (error) { say(`未匯入：${error.message}`, true); }
    finally { input.value = ''; controls(false); }
  });
  exportButton.addEventListener('click', () => {
    if (!current || busy) return;
    const blob = new Blob([JSON.stringify(current, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const link = node('a');
    link.href = url; link.download = 'bookings.json';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say('已匯出 bookings.json，內含目前私人訂單及圖片；沒有上傳。');
  });
  clearButton.addEventListener('click', async () => {
    if (!(current || hasStoredData) || busy) return;
    controls(true);
    try {
      await deleteDatabase();
      current = null;
      hasStoredData = false;
      location.reload();
    } catch (error) {
      say(`未能刪除：${error.message} 私人資料仍在本次頁面；請重試或清除此網站的瀏覽器資料。`, true);
      controls(false);
    }
  });
  window.showBooking = function(id) {
    if (!current) {
      toolbar.scrollIntoView({behavior: 'smooth', block: 'center'});
      say('請先匯入私人 bookings.json，才可查看私人訂單原件。檔案不會上傳。');
      importButton.focus();
      return;
    }
    originalShowBooking(id);
  };
  (async () => {
    controls(true);
    say('正在讀取此瀏覽器已保存的私人訂單…');
    try {
      const saved = await database('get');
      hasStoredData = !!saved;
      if (saved) { apply(validate(saved)); say('已載入此瀏覽器保存的私人訂單；沒有上傳。'); }
      else say('尚未匯入私人訂單。匯入後只儲存在此瀏覽器，不會上傳。');
    } catch (_) {
      say(hasStoredData ? '已保存的私人資料格式無效；請重新匯入，或按刪除清除。' : '此瀏覽器未能讀取私人儲存；仍可匯入供本次頁面使用，沒有上傳。');
    } finally { controls(false); }
  })();
})();
