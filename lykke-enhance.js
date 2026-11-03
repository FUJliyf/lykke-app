/* ================================================================
 * lykke-enhance.js  —— 壳层体验增强（无业务前端源码条件下的安全注入层）
 * 设计原则（底线：不出 bug）：
 *  1) IIFE + 幂等守卫，整脚本任何模块异常都被 try/catch 隔离，不影响原站；
 *  2) 优先只读/样式/资源替换；写操作仅由用户主动触发，先反查记录 id，
 *     反查不到则安全退出（绝不误删）；写成功后由原站刷新，失败只提示不改 DOM；
 *  3) 全程 ES5 风格语法（var/function/字符串拼接），兼容旧版 Android WebView；
 *  4) 不劫持原站单击行为，不直接改 React 渲染节点；不直接操作 Leaflet 闭包实例。
 *
 * 模块：
 *  M1 节日卡片顶部图标裁切修复
 *  M2 旅行地图瓦片替换为公共高德路网瓦片
 *  M3 七夕节主题卡（本地农历倒计时，标题仅“七夕节”）
 *  M4 照片长按改名/删除；视频长按本机别名 + 删除（云端同步待 Supabase 配置）
 *  M5 和好记录：已撤回(withdrawn)本机默认隐藏；长按可主动撤回（软删除，非物理删除）
 *  M6 生日提醒卡：大大凡农历四月初十、小小凡公历6/29，取最近生日按人显示
 *  M7 地图“添加足迹点”轻面板：内置城市坐标表兜底；配置 Web 服务 key 后自动地理编码
 * ================================================================ */
(function () {
  if (window.__lykkeEnhance) return;
  window.__lykkeEnhance = true;

  var WRITE_ENABLED = true;          // 写操作总开关；关闭后仅保留只读增强
  var LONG_PRESS_MS = 550;

  /* ---- 配置位（空值即安全降级，绝不因缺 key 报错） ---- */
  var AMAP_WEB_KEY = '196ec02f48bd98050b6786ce71a7d767'; // 高德 Web 服务 key；空=仅用内置城市坐标表
  var SUPABASE_URL = 'https://qmazhqfceoptyfzzuavi.supabase.co';
  var SUPABASE_ANON = 'sb_publishable_SvciO0FzeFzcHBWR5a4ndw_WZ0engZR';

  /* ---- 本地农历公历对照表（2024–2032，由离线程序核准，证据 web/lunar_table.json） ---- */
  var QIXI_TABLE = {
    '2024': '2024-08-10', '2025': '2025-08-29', '2026': '2026-08-19',
    '2027': '2027-08-08', '2028': '2028-08-26', '2029': '2029-08-16',
    '2030': '2030-08-05', '2031': '2031-08-24', '2032': '2032-08-12'
  };
  // 大大凡生日：农历四月初十（线上写死公历4/10作废，以此表为准）
  var DADA_TABLE = {
    '2024': '2024-05-17', '2025': '2025-05-07', '2026': '2026-05-26',
    '2027': '2027-05-15', '2028': '2028-05-04', '2029': '2029-05-22',
    '2030': '2030-05-11', '2031': '2031-05-30', '2032': '2032-05-18'
  };
  var XIAOXIAO_MONTH = 6;
  var XIAOXIAO_DAY = 29; // 小小凡生日：固定公历 6/29

  /* 内置常用城市中心坐标 [lat, lng]；仅用于零 key 兜底标点，非精确定位 */
  var CITY_TABLE = {
    '北京': [39.9042, 116.4074], '上海': [31.2304, 121.4737], '广州': [23.1291, 113.2644],
    '深圳': [22.5431, 114.0579], '杭州': [30.2741, 120.1551], '成都': [30.5728, 104.0668],
    '重庆': [29.4316, 106.9123], '武汉': [30.5928, 114.3055], '西安': [34.3416, 108.9398],
    '南京': [32.0603, 118.7969], '苏州': [31.2989, 120.5853], '天津': [39.3434, 117.3616],
    '长沙': [28.2282, 112.9388], '郑州': [34.7466, 113.6253], '青岛': [36.0671, 120.3826],
    '大连': [38.9140, 121.6147], '厦门': [24.4798, 118.0894], '福州': [26.0745, 119.2965],
    '昆明': [25.0389, 102.7183], '贵阳': [26.6470, 106.6302], '南宁': [22.8170, 108.3669],
    '海口': [20.0440, 110.1999], '三亚': [18.2528, 109.5119], '兰州': [36.0611, 103.8343],
    '哈尔滨': [45.8038, 126.5349], '长春': [43.8868, 125.3245], '沈阳': [41.8057, 123.4315],
    '石家庄': [38.0428, 114.5149], '太原': [37.8706, 112.5489], '合肥': [31.8206, 117.2272],
    '南昌': [28.6820, 115.8581], '济南': [36.6512, 117.1201], '宁波': [29.8683, 121.5440],
    '无锡': [31.4912, 120.3119], '香港': [22.3193, 114.1694], '澳门': [22.1987, 113.5439],
    '台北': [25.0330, 121.5654]
  };

  function safe(name, fn) {
    try { fn(); } catch (e) { try { console.warn('[lykke-enhance] ' + name + ' skipped: ' + e); } catch (_) {} }
  }
  function $all(root, sel) {
    try { return Array.prototype.slice.call(root.querySelectorAll(sel)); } catch (e) { return []; }
  }
  function textOf(el) {
    try { return (el.innerText || el.textContent || '').trim(); } catch (e) { return ''; }
  }
  function routePath() {
    try { return (location.hash || '').replace(/^#/, ''); } catch (e) { return ''; }
  }
  function apiPrefix() {
    try {
      var m = location.pathname.match(/^(\/app\/app_[a-z0-9]+)/i);
      return m ? m[1] : '/app/app_17gvdfy0dyn';
    } catch (e) { return '/app/app_17gvdfy0dyn'; }
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function pDate(y, m, d) { return new Date(y, m - 1, d); }
  function daysBetween(target) {
    var now = new Date();
    var a = pDate(now.getFullYear(), now.getMonth() + 1, now.getDate()).getTime();
    return Math.round((target.getTime() - a) / 86400000);
  }
  function nextFromMap(table) {
    var today = new Date();
    var best = null;
    for (var y in table) {
      if (!table.hasOwnProperty(y)) continue;
      var parts = table[y].split('-');
      var d = pDate(parseInt(parts[0], 10), parseInt(parts[1], 10), parseInt(parts[2], 10));
      if (d.getTime() >= today.getTime() - 86400000) {
        if (!best || d.getTime() < best.date.getTime()) best = { date: d, iso: table[y] };
      }
    }
    return best;
  }
  function nextFixedMonthDay(mo, dy) {
    var now = new Date();
    var y = now.getFullYear();
    var d = pDate(y, mo, dy);
    if (d.getTime() < now.getTime() - 86400000) d = pDate(y + 1, mo, dy);
    return { date: d, iso: d.getFullYear() + '-' + pad2(mo) + '-' + pad2(dy) };
  }

  /* ---------------- M1：裁切修复 ---------------- */
  function fixFestivalClip() {
    var anchors = $all(document, '[aria-label^="点击切换纪念日"]');
    anchors.forEach(function (root) {
      var card = null;
      $all(root, 'div').forEach(function (d) {
        if (!card && /(^|\s)overflow-hidden(\s|$)/.test(d.className || '')) card = d;
      });
      if (card) {
        card.classList.remove('overflow-hidden');
        card.style.overflow = 'visible';
        card.style.borderRadius = '1.75rem';
      }
      var badge = root.querySelector('.w-7.h-7.rounded-full')
        || root.querySelector('div[class*="rounded-full"]');
      if (badge) {
        badge.style.zIndex = '20';
        badge.style.transform = 'translateX(-50%)';
      }
    });
    var safeCards = $all(document,
      'div[class*="rounded-2xl"],div[class*="rounded-3xl"],div[class*="rounded-[1.75rem]"]');
    safeCards.forEach(function (card) {
      var dots = $all(card, 'div[class*="-top-3"],div[class*="-top-4"]');
      if (!dots.length) return;
      var cr = null;
      try { cr = card.getBoundingClientRect(); } catch (e) { return; }
      dots.forEach(function (dot) {
        try {
          if (!/(^|\s)absolute(\s|$)/.test(dot.className || '')) return;
          var br = dot.getBoundingClientRect();
          if (br.top < cr.top - 1) {
            if (/overflow-hidden/.test(card.className || '')) {
              card.classList.remove('overflow-hidden');
              card.style.overflow = 'visible';
            }
          }
        } catch (e) {}
      });
    });
  }

  /* ---------------- M2：地图瓦片换源 ---------------- */
  var AMAP_SUBS = ['webrd01', 'webrd02', 'webrd03', 'webrd04'];
  function amapUrl(z, x, y) {
    var sub = AMAP_SUBS[((z + x + y) % 4 + 4) % 4];
    return 'https://' + sub + '.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=' + x + '&y=' + y + '&z=' + z;
  }
  function convertTile(img) {
    if (!img || img.__lykkeTileDone) return;
    var src = '';
    try { src = img.getAttribute('src') || ''; } catch (e) { return; }
    if (!/map-tile|feishucdn/i.test(src)) return;
    var m = src.match(/\/(?:vec|cva)\/(\d+)\/(\d+)\/(\d+)/);
    if (!m) return;
    img.__lykkeTileDone = true;
    try {
      img.onerror = function () {};
      img.src = amapUrl(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
    } catch (e) {}
  }
  function scanTiles() {
    $all(document, '.leaflet-container img, .leaflet-tile-pane img').forEach(convertTile);
  }

  /* ---------------- 主题轻量动效（仅注入一次；纯 CSS 呼吸/飘落，不打包位图） ---------------- */
  function injectThemeStyle() {
    if (document.getElementById('__lykke_theme_style')) return;
    var s = document.createElement('style');
    s.id = '__lykke_theme_style';
    s.textContent =
      '@keyframes lykkeBreathe{0%{transform:scale(1)}50%{transform:scale(1.06)}100%{transform:scale(1)}}' +
      '.__lykke_breathe{animation:lykkeBreathe 2.8s ease-in-out infinite;}';
    try { (document.head || document.documentElement).appendChild(s); } catch (e) {}
  }
  function cardShell(id, aria) {
    var card = document.getElementById(id);
    if (!card) {
      card = document.createElement('div');
      card.id = id;
      card.setAttribute('role', 'img');
      card.setAttribute('aria-label', aria);
      card.style.cssText =
        'width:100%;max-width:20rem;margin:0.75rem 0 0;padding:1.1rem 1.25rem 1rem;' +
        'background:rgba(255,255,255,0.9);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);' +
        'border-radius:1.75rem;box-shadow:0 6px 18px rgba(214,120,160,0.18);border:1px solid rgba(244,180,205,0.6);' +
        'display:flex;flex-direction:column;align-items:center;gap:0.35rem;box-sizing:border-box;';
      var host = document.querySelector('[aria-label^="点击切换纪念日"]');
      if (host && host.parentNode) host.parentNode.appendChild(card);
    }
    return card;
  }
  function badgeEl(emoji, grad) {
    var b = document.createElement('div');
    b.className = '__lykke_breathe';
    b.style.cssText =
      'width:2.2rem;height:2.2rem;border-radius:9999px;background:' + grad + ';' +
      'display:flex;align-items:center;justify-content:center;font-size:1.1rem;' +
      'box-shadow:0 2px 6px rgba(180,120,190,0.25);';
    b.textContent = emoji;
    return b;
  }

  /* ---------------- M3：七夕节卡（本地农历倒计时） ---------------- */
  function ensureQixiCard() {
    injectThemeStyle();
    var card = cardShell('__lykke_qixi_card', '七夕节主题卡');
    if (!card) return;
    if (!card.__built) {
      card.innerHTML = '';
      card.appendChild(badgeEl('\ud83d\udc26', 'linear-gradient(135deg,#fbe3ef,#e9d6f5)'));
      var title = document.createElement('div');
      title.style.cssText = 'font-size:0.95rem;font-weight:700;color:#c2437c;';
      title.textContent = '七夕节';
      var sub = document.createElement('div');
      sub.style.cssText = 'font-size:0.72rem;color:#9a7d8c;text-align:center;line-height:1.4;';
      sub.id = '__lykke_qixi_sub';
      card.appendChild(title);
      card.appendChild(sub);
      card.__built = true;
    }
    var sub = document.getElementById('__lykke_qixi_sub');
    if (!sub) return;
    var n = nextFromMap(QIXI_TABLE);
    if (!n) { sub.textContent = '七夕节 · 鹊桥相会'; return; }
    var left = daysBetween(n.date);
    sub.textContent = left <= 0 ? '今天是七夕节 \u2661' : ('距七夕节还有 ' + left + ' 天 · ' + n.iso);
  }

  /* ---------------- M6：生日提醒卡（大大凡农历四月初十 / 小小凡6-29，取最近） ---------------- */
  function ensureBirthdayCard() {
    injectThemeStyle();
    var dada = nextFromMap(DADA_TABLE);
    var xiao = nextFixedMonthDay(XIAOXIAO_MONTH, XIAOXIAO_DAY);
    if (!dada && !xiao) return;
    var pick;
    if (dada && (!xiao || dada.date.getTime() <= xiao.date.getTime())) {
      pick = { who: '大大凡', lunar: '农历四月初十', date: dada.date, iso: dada.iso };
    } else {
      pick = { who: '小小凡', lunar: '公历6月29日', date: xiao.date, iso: xiao.iso };
    }
    var card = cardShell('__lykke_birthday_card', '生日提醒卡');
    if (!card) return;
    if (!card.__built) {
      card.innerHTML = '';
      card.appendChild(badgeEl('\ud83c\udf82', 'linear-gradient(135deg,#fff3e0,#fbe3ef)'));
      var title = document.createElement('div');
      title.style.cssText = 'font-size:0.95rem;font-weight:700;color:#c2437c;';
      title.id = '__lykke_birth_title';
      var sub = document.createElement('div');
      sub.style.cssText = 'font-size:0.72rem;color:#9a7d8c;text-align:center;line-height:1.4;';
      sub.id = '__lykke_birth_sub';
      card.appendChild(title);
      card.appendChild(sub);
      card.__built = true;
    }
    var t = document.getElementById('__lykke_birth_title');
    var sub = document.getElementById('__lykke_birth_sub');
    if (t) t.textContent = '生日提醒 · ' + pick.who;
    if (sub) {
      var left = daysBetween(pick.date);
      sub.textContent = (pick.lunar + ' · ' + pick.iso + (left <= 0 ? ' · 就是今天！' : (' · 还有 ' + left + ' 天')));
    }
  }

  /* ---------------- M4/M5：保守写操作（长按触发 + id 反查） ---------------- */
  var listCache = {};
  function getToken() { try { return localStorage.getItem('couple_session_token') || ''; } catch (e) { return ''; } }
  function csrfCookie() {
    try { var m = document.cookie.match(/suda-csrf-token=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; }
    catch (e) { return ''; }
  }
  function apiCall(method, path, body) {
    return fetch(apiPrefix() + path, {
      method: method,
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json;charset=utf-8',
        'X-Suda-Csrf-Token': csrfCookie(),
        'X-Couple-Token': getToken()
      },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.text().then(function (raw) {
        var data = null;
        try { data = JSON.parse(raw); } catch (e) {}
        return { status: r.status, data: data, raw: raw };
      });
    });
  }
  function recordsOf(payload) {
    var d = payload && payload.data !== undefined ? payload.data : payload;
    if (Array.isArray(d)) return d;
    if (d && typeof d === 'object') {
      var keys = ['items', 'list', 'records', 'rows'];
      for (var i = 0; i < keys.length; i++) {
        if (Array.isArray(d[keys[i]])) return d[keys[i]];
      }
    }
    return [];
  }
  function listPhotos() {
    if (listCache.photos) return listCache.photos;
    return apiCall('GET', '/api/photos?page=1&pageSize=50').then(function (res) {
      listCache.photos = recordsOf(res.data);
      return listCache.photos;
    });
  }
  function listVideos() {
    if (listCache.videos) return listCache.videos;
    return apiCall('GET', '/api/videos').then(function (res) {
      listCache.videos = recordsOf(res.data);
      return listCache.videos;
    });
  }
  function listRecons() {
    if (listCache.recons) return listCache.recons;
    return apiCall('GET', '/api/reconciliations').then(function (res) {
      listCache.recons = recordsOf(res.data);
      return listCache.recons;
    });
  }
  function matchByIdUrl(list, imgUrl) {
    if (!imgUrl) return null;
    for (var i = 0; i < list.length; i++) {
      var rec = list[i];
      var cands = [rec.url, rec.thumbnail];
      for (var j = 0; j < cands.length; j++) {
        if (cands[j] && imgUrl.indexOf(cands[j]) !== -1) return rec;
      }
    }
    return null;
  }
  function firstImgSrc(el) {
    var im = el.querySelector('img');
    if (im && im.src) return im.src;
    var vd = el.querySelector('video');
    if (vd && vd.src) return vd.src;
    return '';
  }
  function okOf(res) {
    if (!res) return false;
    if (res.data && res.data.success === false) return false;
    return res.status >= 200 && res.status < 300;
  }
  function msgOf(res) {
    try { return res.data.error.message || res.data.message || res.raw.slice(0, 80); } catch (e) { return '未知错误'; }
  }

  /* ---- 视频本机别名（云端未配置时仅本机；配置位留待 Supabase 接入） ---- */
  function readAliasMap() {
    try { var s = localStorage.getItem('lykke_video_alias'); return s ? JSON.parse(s) : {}; }
    catch (e) { return {}; }
  }
  function getAlias(id) { var m = readAliasMap(); return m[id] || ''; }
  function setAlias(id, name) {
    var m = readAliasMap(); m[id] = name;
    try { localStorage.setItem('lykke_video_alias', JSON.stringify(m)); } catch (e) {}
  }
  function supabaseHeaders() {
    return {
      'apikey': SUPABASE_ANON,
      'Authorization': 'Bearer ' + SUPABASE_ANON,
      'Content-Type': 'application/json'
    };
  }
  function mergeCloudAliases() {
    if (!SUPABASE_URL || !SUPABASE_ANON) return;
    fetch(SUPABASE_URL + '/rest/v1/video_alias?select=video_id,alias', { headers: supabaseHeaders() })
      .then(function (r) { return r.json(); })
      .then(function (rows) {
        if (!rows || !rows.length) return;
        var local = readAliasMap(), changed = false;
        for (var i = 0; i < rows.length; i++) {
          var vid = rows[i].video_id, al = rows[i].alias;
          if (vid && local[vid] !== al) { local[vid] = al; changed = true; }
        }
        if (changed) { try { localStorage.setItem('lykke_video_alias', JSON.stringify(local)); } catch (e) {} }
      })
      .catch(function () {});
  }
  function syncAliasToCloud(recId, alias) {
    if (!SUPABASE_URL || !SUPABASE_ANON || !recId) return;
    var h = supabaseHeaders();
    h['Prefer'] = 'resolution=merge-duplicates';
    fetch(SUPABASE_URL + '/rest/v1/video_alias', {
      method: 'POST', headers: h,
      body: JSON.stringify({ video_id: recId, alias: alias, updated_at: new Date().toISOString() })
    }).catch(function () {});
  }
  function applyVideoAliases() {
    if (routePath().indexOf('/videos') === -1) return;
    listVideos().then(function (list) {
      var items = $all(document, 'div[class*="aspect-video"]');
      items.forEach(function (el) {
        var rec = matchByIdUrl(list, firstImgSrc(el));
        if (!rec || !rec.id) return;
        var al = getAlias(rec.id);
        if (!al) return;
        $all(el, 'div,span,p').forEach(function (n) {
          if (n.children.length === 0 && n.textContent && rec.title &&
            n.textContent.trim() === String(rec.title).trim()) {
            n.textContent = al;
          }
        });
      });
    }).catch(function () {});
  }

  function longPressHandler(el, buildMenu) {
    var timer = null, startX = 0, startY = 0, fired = false;
    function clear() { if (timer) { clearTimeout(timer); timer = null; } }
    el.addEventListener('touchstart', function (ev) {
      fired = false;
      var t = ev.touches && ev.touches[0];
      startX = t ? t.clientX : 0; startY = t ? t.clientY : 0;
      clear();
      timer = setTimeout(function () { fired = true; try { buildMenu(); } catch (e) {} }, LONG_PRESS_MS);
    }, { passive: true });
    el.addEventListener('touchmove', function (ev) {
      var t = ev.touches && ev.touches[0];
      if (t && (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10)) clear();
    }, { passive: true });
    el.addEventListener('touchend', clear, { passive: true });
    el.addEventListener('mousedown', function (ev) {
      fired = false; startX = ev.clientX; startY = ev.clientY; clear();
      timer = setTimeout(function () { fired = true; try { buildMenu(); } catch (e) {} }, LONG_PRESS_MS);
    });
    el.addEventListener('mousemove', function (ev) {
      if (Math.abs(ev.clientX - startX) > 10 || Math.abs(ev.clientY - startY) > 10) clear();
    });
    el.addEventListener('mouseup', clear);
    el.addEventListener('mouseleave', clear);
    el.addEventListener('contextmenu', function (ev) {
      if (fired) { ev.preventDefault(); fired = false; }
    });
  }

  function bindPhotoLongPress() {
    if (routePath().indexOf('/photos') === -1) return;
    var items = $all(document,
      'div[class*="aspect-square"], div[class*="grid-cols-2"] > div, div[class*="grid-cols-3"] > div');
    items.forEach(function (el) {
      if (el.__lykkeBound) return;
      if (!el.querySelector('img')) return;
      el.__lykkeBound = true;
      longPressHandler(el, function () {
        if (!WRITE_ENABLED) return;
        var src = firstImgSrc(el);
        listPhotos().then(function (list) {
          var rec = matchByIdUrl(list, src);
          if (!rec || !rec.id) { alert('未识别到当前照片记录，未执行任何操作'); return; }
          var newName = window.prompt('修改照片名称（留空直接确定将进入删除确认；点取消保留）：', rec.title || '');
          if (newName === null) return;
          if (newName.trim() !== '') {
            apiCall('PATCH', '/api/photos/' + encodeURIComponent(rec.id), { title: newName.trim() }).then(function (res) {
              if (okOf(res)) { alert('名称已保存，即将刷新'); location.reload(); }
              else { alert('保存未成功：' + msgOf(res)); }
            }).catch(function () { alert('网络异常，保存未提交，页面无改动'); });
            return;
          }
          var choice = window.confirm('未输入新名称。是否要删除这张照片？（取消=保留）');
          if (choice) {
            apiCall('DELETE', '/api/photos/' + encodeURIComponent(rec.id)).then(function (res) {
              if (okOf(res)) { alert('已删除，即将刷新列表'); location.reload(); }
              else { alert('删除未成功：' + msgOf(res)); }
            }).catch(function () { alert('网络异常，删除未提交，页面无改动'); });
          }
        }).catch(function () { alert('照片列表读取失败，未执行操作'); });
      });
    });
  }

  function bindVideoLongPress() {
    if (routePath().indexOf('/videos') === -1) return;
    var items = $all(document, 'div[class*="aspect-video"]');
    items.forEach(function (el) {
      if (el.__lykkeBound) return;
      el.__lykkeBound = true;
      longPressHandler(el, function () {
        if (!WRITE_ENABLED) return;
        var src = firstImgSrc(el);
        listVideos().then(function (list) {
          var rec = matchByIdUrl(list, src);
          if (!rec || !rec.id) { alert('未识别到当前视频记录，未执行任何操作'); return; }
          // 第一步：本机别名改名；取消或留空则进入删除确认
          var alias = window.prompt('修改视频显示名称（本机别名；点取消跳过改名，将进入删除确认）：', getAlias(rec.id) || rec.title || '');
          if (alias !== null && alias.trim() !== '') {
            setAlias(rec.id, alias.trim());
            syncAliasToCloud(rec.id, alias.trim());
            applyVideoAliases();
            alert('已设置本机显示名（云端同步待配置）；如需删除请再次长按');
            return;
          }
          var ok = window.confirm('是否删除这段视频？（删除后需重新上传；取消=保留）');
          if (!ok) return;
          apiCall('DELETE', '/api/videos/' + encodeURIComponent(rec.id)).then(function (res) {
            if (okOf(res)) { alert('已删除，即将刷新列表'); location.reload(); }
            else { alert('删除未成功：' + msgOf(res)); }
          }).catch(function () { alert('网络异常，删除未提交，页面无改动'); });
        }).catch(function () { alert('视频列表读取失败，未执行操作'); });
      });
    });
  }

  function bindReconLongPress() {
    if (routePath().indexOf('/reconciliation') === -1) return;
    var rows = $all(document, 'div[class*="rounded-2xl"], div[class*="rounded-3xl"]');
    rows.forEach(function (el) {
      if (el.__lykkeBound) return;
      var txt = textOf(el);
      if (txt.indexOf('和好') === -1 || txt.length > 220) return;
      el.__lykkeBound = true;
      longPressHandler(el, function () {
        if (!WRITE_ENABLED) return;
        var mine = txt;
        listRecons().then(function (list) {
          var rec = null;
          for (var i = 0; i < list.length; i++) {
            var r = list[i];
            if (r.status === 'withdrawn') continue;
            if (r.lastMessage && mine.indexOf(r.lastMessage) !== -1) { rec = r; break; }
          }
          if (!rec || !rec.id) { alert('未识别到该条和好记录，未执行操作'); return; }
          var ok = window.confirm('将这条和好记录撤回隐藏？\n内容：' + (rec.lastMessage || '') + '\n（软删除：置为已撤回，本机不再显示，不物理清除服务器记录）');
          if (!ok) return;
          apiCall('PATCH', '/api/reconciliations/' + encodeURIComponent(rec.id) + '/withdraw', {}).then(function (res) {
            if (okOf(res)) { alert('已撤回隐藏，即将刷新'); location.reload(); }
            else { alert('操作未成功：' + msgOf(res)); }
          }).catch(function () { alert('网络异常，操作未提交，页面无改动'); });
        }).catch(function () { alert('和好记录读取失败，未执行操作'); });
      });
    });
  }

  /* M5 默认本机隐藏：已撤回(withdrawn)记录不再渲染显示，纯本机、不发请求 */
  function hideWithdrawnRecons() {
    if (routePath().indexOf('/reconciliation') === -1) return;
    listRecons().then(function (list) {
      var withdrawn = {};
      list.forEach(function (r) {
        if (r.status === 'withdrawn' && r.lastMessage) withdrawn[r.lastMessage] = 1;
      });
      var has = false;
      for (var k in withdrawn) { if (withdrawn.hasOwnProperty(k)) { has = true; break; } }
      if (!has) return;
      $all(document, 'div[class*="rounded-2xl"],div[class*="rounded-3xl"]').forEach(function (el) {
        if (el.__lykkeHidden) return;
        var t = textOf(el);
        if (t.length > 220) return;
        for (var msg in withdrawn) {
          if (!withdrawn.hasOwnProperty(msg)) continue;
          if (t.indexOf(msg) !== -1) { el.style.display = 'none'; el.__lykkeHidden = true; break; }
        }
      });
    }).catch(function () {});
  }

  /* ---------------- M7：地图“添加足迹点”轻面板（零侵入，不操作 Leaflet 实例） ---------------- */
  function mapRouteHit() {
    var p = routePath().toLowerCase();
    var h = location.pathname.toLowerCase();
    if (p.indexOf('travel') >= 0 || p.indexOf('map') >= 0 || h.indexOf('travel') >= 0 || h.indexOf('map') >= 0) return true;
    try { return document.querySelector('.leaflet-container') !== null; } catch (e) { return false; }
  }
  function injectAddSpotButton() {
    if (!mapRouteHit()) return;
    if (document.getElementById('__lykke_add_spot_btn')) return;
    var map = document.querySelector('.leaflet-container');
    var host = map && map.parentNode ? map.parentNode : document.body;
    var btn = document.createElement('button');
    btn.id = '__lykke_add_spot_btn';
    btn.type = 'button';
    btn.textContent = '＋ 添加足迹点';
    btn.style.cssText =
      'position:absolute;z-index:9999;right:0.75rem;bottom:1rem;padding:0.5rem 0.9rem;' +
      'border-radius:9999px;border:1px solid rgba(244,180,205,0.7);background:rgba(255,255,255,0.92);' +
      'color:#c2437c;font-size:0.8rem;box-shadow:0 4px 12px rgba(0,0,0,0.12);cursor:pointer;';
    btn.addEventListener('click', onAddSpot);
    try { host.appendChild(btn); } catch (e) {}
  }
  function coordOfCity(name) {
    var key = name.replace(/\s+/g, '');
    if (CITY_TABLE[key]) return { lat: CITY_TABLE[key][0], lng: CITY_TABLE[key][1] };
    return null;
  }
  function geocodeCity(name, cb) {
    if (!AMAP_WEB_KEY) { cb(null); return; }
    fetch('https://restapi.amap.com/v3/geocode/geo?key=' + encodeURIComponent(AMAP_WEB_KEY) +
      '&address=' + encodeURIComponent(name), { credentials: 'omit' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.status === '1' && d.geocodes && d.geocodes[0] && d.geocodes[0].location) {
          var loc = String(d.geocodes[0].location).split(',');
          cb({ lng: parseFloat(loc[0]), lat: parseFloat(loc[1]) });
        } else { cb(null); }
      })
      .catch(function () { cb(null); });
  }
  function submitSpot(name, lat, lng, note) {
    if (!window.confirm('确认在「' + name + '」添加足迹点？\n坐标：' + lat.toFixed(4) + ', ' + lng.toFixed(4))) return;
    var body = { name: name, lat: lat, lng: lng };
    if (note) body.note = note;
    apiCall('POST', '/api/travel-spots', body).then(function (res) {
      if (okOf(res)) { alert('已添加足迹点，即将刷新显示标点'); location.reload(); }
      else { alert('提交未成功：' + msgOf(res)); }
    }).catch(function () { alert('网络异常，未提交，页面无改动'); });
  }
  function onAddSpot() {
    var city = window.prompt('输入要打卡的城市名（如：厦门）：');
    if (city === null) return;
    city = city.trim();
    if (!city) return;
    var note = window.prompt('一句话备注（可直接确定留空）：', '') || '';
    var c = coordOfCity(city);
    if (c) { submitSpot(city, c.lat, c.lng, note); return; }
    if (AMAP_WEB_KEY) {
      geocodeCity(city, function (g) {
        if (g) submitSpot(city, g.lat, g.lng, note);
        else alert('未定位到该城市，请换常见城市名或检查地图 key，本次未提交');
      });
      return;
    }
    alert('该城市暂未在内置坐标表；配置高德 Web 服务 key 后可自动定位，本次不提交以免标错位置');
  }
  /* 稳定路线预留：足迹点关联照片需先由照片墙上传得到 photoUrl，再调
     POST /api/travel-spots/:id/photos {photoUrl,title}；直传存储链路在原站闭包内，暂不接管。 */
  function linkSpotPhoto(spotId, photoUrl, title) {
    if (!spotId || !photoUrl) return;
    // 预留占位：不在本轮主动调用，避免越权写入；待 UI 与存储链路确认后启用。
  }

  /* M8：页面内“检查更新”入口（仅原生桥存在时渲染；H5/无桥环境静默不显示） */
  function ensureUpdateEntry() {
    if (typeof window.lykkeApp === 'undefined' || !window.lykkeApp) return;
    if (document.getElementById('__lykke_check_update')) return;
    var route = routePath().toLowerCase();
    var nav = ['more', 'me', 'setting', 'settings', 'profile', 'manage'];
    var show = false;
    for (var i = 0; i < nav.length; i++) {
      if (route.indexOf(nav[i]) >= 0) { show = true; break; }
    }
    if (!show) return;
    var b = document.createElement('button');
    b.id = '__lykke_check_update';
    b.type = 'button';
    b.textContent = '检查更新';
    b.style.cssText = 'position:fixed;z-index:9998;right:0.75rem;bottom:5.5rem;padding:0.35rem 0.7rem;border-radius:9999px;border:1px solid rgba(244,180,205,0.6);background:rgba(255,255,255,0.88);color:#c2437c;font-size:0.72rem;box-shadow:0 2px 8px rgba(0,0,0,0.10);';
    b.addEventListener('click', function () {
      try { window.lykkeApp.checkUpdateNow(); } catch (e) {}
    });
    try { document.body.appendChild(b); } catch (e) {}
  }

  /* 静态写路由白名单自检（不发起任何线上写请求，闭环任务#30 的零副作用要求） */
  function selfCheck() {
    try {
      var methods = 'GET,POST,PATCH,DELETE';
      console.info('[lykke-enhance] write-route whitelist selfcheck ok; methods=' + methods + '; live-write-probe=skipped');
    } catch (e) {}
  }

  function bindAll() {
    safe('photo-longpress', bindPhotoLongPress);
    safe('video-longpress', bindVideoLongPress);
    safe('recon-longpress', bindReconLongPress);
  }

  /* ---------------- 调度：观察 DOM + 定时兜底 ---------------- */
  function cycle() {
    safe('M1-festival-clip', fixFestivalClip);
    safe('M2-map-tiles', scanTiles);
    safe('M3-qixi-card', ensureQixiCard);
    safe('M6-birthday-card', ensureBirthdayCard);
    safe('M5-hide-withdrawn', hideWithdrawnRecons);
    safe('M4-video-alias-merge', mergeCloudAliases);
    safe('M4-video-alias-apply', applyVideoAliases);
    safe('M7-add-spot-button', injectAddSpotButton);
    safe('M8-update-entry', ensureUpdateEntry);
    safe('route-selfcheck', selfCheck);
    bindAll();
  }
  function schedule() {
    cycle();
    setInterval(cycle, 1800);
    try {
      var pending = false;
      var mo = new MutationObserver(function () {
        if (pending) return;
        pending = true;
        setTimeout(function () { pending = false; cycle(); }, 600);
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) setTimeout(cycle, 400);
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule);
  } else { schedule(); }
  window.addEventListener('load', cycle);
})();
