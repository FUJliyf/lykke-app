/* ================================================================
 * lykke-enhance.js  —— 壳层体验增强（无业务前端源码条件下的安全注入层）
 * 设计原则（底线：不出 bug）：
 *  1) IIFE + 幂等守卫，整脚本任何模块异常都被 try/catch 隔离，不影响原站；
 *  2) 优先只读/样式/资源替换；写操作仅由用户主动触发，先反查记录 id，
 *     反查不到则安全退出（绝不误删）；写成功后由原站刷新，失败只提示不改 DOM；
 *  3) 全程 ES5 风格语法（var/function/字符串拼接），兼容旧版 Android WebView；
 *  4) 不劫持原站单击行为，不直接改 React 渲染节点；不直接操作 Leaflet 闭包实例。
 * ================================================================ */
(function () {
  if (window.__lykkeEnhance) return;
  window.__lykkeEnhance = true;

  var WRITE_ENABLED = true;
  var LONG_PRESS_MS = 550;

  /* ---- 配置位 ---- */
  var AMAP_WEB_KEY = '196ec02f48bd98050b6786ce71a7d767';
  var SUPABASE_URL = 'https://qmazhqfceoptyfzzuavi.supabase.co';
  var SUPABASE_ANON = 'sb_publishable_SvciO0FzeFzcHBWR5a4ndw_WZ0engZR';

  /* ---- 农历公历对照表 ---- */
  var QIXI_TABLE = {
    '2024': '2024-08-10', '2025': '2025-08-29', '2026': '2026-08-19',
    '2027': '2027-08-08', '2028': '2028-08-26', '2029': '2029-08-16',
    '2030': '2030-08-05', '2031': '2031-08-24', '2032': '2032-08-12'
  };
  var DADA_TABLE = {
    '2024': '2024-05-17', '2025': '2025-05-07', '2026': '2026-05-26',
    '2027': '2027-05-15', '2028': '2028-05-04', '2029': '2029-05-22',
    '2030': '2030-05-11', '2031': '2031-05-30', '2032': '2032-05-18'
  };
  var XIAOXIAO_MONTH = 6, XIAOXIAO_DAY = 29;
  var TOGETHER_MONTH = 3, TOGETHER_DAY = 19;

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

  function safe(name, fn) { try { fn(); } catch (e) { try { console.warn('[lykke] ' + name + ': ' + e); } catch (_) {} } }
  function $all(root, sel) { try { return Array.prototype.slice.call(root.querySelectorAll(sel)); } catch (e) { return []; } }
  function textOf(el) { try { return (el.innerText || el.textContent || '').trim(); } catch (e) { return ''; } }
  function routePath() { try { return (location.hash || '').replace(/^#/, ''); } catch (e) { return ''; } }
  function apiPrefix() { try { var m = location.pathname.match(/^(\/app\/app_[a-z0-9]+)/i); return m ? m[1] : '/app/app_17gvdfy0dyn'; } catch (e) { return '/app/app_17gvdfy0dyn'; } }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function pDate(y, m, d) { return new Date(y, m - 1, d); }
  function daysBetween(target) { var now = new Date(); var a = pDate(now.getFullYear(), now.getMonth() + 1, now.getDate()).getTime(); return Math.round((target.getTime() - a) / 86400000); }
  function nextFromMap(table) {
    var today = new Date(), best = null;
    for (var y in table) {
      if (!table.hasOwnProperty(y)) continue;
      var p = table[y].split('-'), d = pDate(parseInt(p[0],10), parseInt(p[1],10), parseInt(p[2],10));
      if (d.getTime() >= today.getTime() - 86400000 && (!best || d.getTime() < best.date.getTime())) best = { date: d, iso: table[y] };
    }
    return best;
  }
  function nextFixedMonthDay(mo, dy) {
    var now = new Date(), y = now.getFullYear(), d = pDate(y, mo, dy);
    if (d.getTime() < now.getTime() - 86400000) d = pDate(y + 1, mo, dy);
    return { date: d, iso: d.getFullYear() + '-' + pad2(mo) + '-' + pad2(dy) };
  }

  /* ---- API helpers ---- */
  function getToken() { try { return localStorage.getItem('couple_session_token') || ''; } catch (e) { return ''; } }
  function csrfCookie() { try { var m = document.cookie.match(/suda-csrf-token=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; } catch (e) { return ''; } }
  function apiCall(method, path, body) {
    return fetch(apiPrefix() + path, {
      method: method, credentials: 'include',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json;charset=utf-8', 'X-Suda-Csrf-Token': csrfCookie(), 'X-Couple-Token': getToken() },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.text().then(function (raw) { var data=null; try{data=JSON.parse(raw);}catch(e){} return {status:r.status, data:data, raw:raw}; }); });
  }
  function recordsOf(payload) {
    var d = payload && payload.data !== undefined ? payload.data : payload;
    if (Array.isArray(d)) return d;
    if (d && typeof d === 'object') { var keys=['items','list','records','rows']; for(var i=0;i<keys.length;i++){ if(Array.isArray(d[keys[i]])) return d[keys[i]]; } }
    return [];
  }
  function okOf(res) { if(!res) return false; if(res.data&&res.data.success===false) return false; return res.status>=200&&res.status<300; }
  function msgOf(res) { try{ return res.data.error.message||res.data.message||res.raw.slice(0,80); }catch(e){ return '未知错误'; } }

  /* ---- Supabase helpers ---- */
  function supabaseHeaders() { return { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + SUPABASE_ANON, 'Content-Type': 'application/json' }; }

  /* ================= M1：节日卡裁切修复 ================= */
  function fixFestivalClip() {
    var anchors = $all(document, '[aria-label^="点击切换纪念日"]');
    anchors.forEach(function (root) {
      var card = null;
      $all(root, 'div').forEach(function (d) { if(!card && /(^|\s)overflow-hidden(\s|$)/.test(d.className||'')) card=d; });
      if (card) { card.classList.remove('overflow-hidden'); card.style.overflow='visible'; card.style.borderRadius='1.75rem'; }
      var badge = root.querySelector('.w-7.h-7.rounded-full') || root.querySelector('div[class*="rounded-full"]');
      if (badge) { badge.style.zIndex='20'; badge.style.transform='translateX(-50%)'; }
    });
  }

  /* ================= M2：地图瓦片换源 ================= */
  var AMAP_SUBS = ['webrd01','webrd02','webrd03','webrd04'];
  function amapUrl(z,x,y){ var s=AMAP_SUBS[((z+x+y)%4+4)%4]; return 'https://'+s+'.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x='+x+'&y='+y+'&z='+z; }
  function convertTile(img){
    if(!img||img.__lykkeTileDone) return;
    var src=''; try{ src=img.getAttribute('src')||''; }catch(e){ return; }
    if(!/map-tile|feishucdn/i.test(src)) return;
    var m=src.match(/\/(?:vec|cva)\/(\d+)\/(\d+)\/(\d+)/); if(!m) return;
    img.__lykkeTileDone=true;
    try{ img.onerror=function(){}; img.src=amapUrl(parseInt(m[1],10),parseInt(m[2],10),parseInt(m[3],10)); }catch(e){}
  }
  function scanTiles(){ $all(document,'.leaflet-container img, .leaflet-tile-pane img').forEach(convertTile); }

  /* ================= 主题样式 ================= */
  function injectThemeStyle() {
    if (document.getElementById('__lykke_theme_style')) return;
    var s=document.createElement('style'); s.id='__lykke_theme_style';
    s.textContent='@keyframes lykkeBreathe{0%{transform:scale(1)}50%{transform:scale(1.06)}100%{transform:scale(1)}}'+
      '.__lykke_breathe{animation:lykkeBreathe 2.8s ease-in-out infinite;}'+
      '@keyframes lykkeSlideDown{0%{transform:translateY(-100%);opacity:0}100%{transform:translateY(0);opacity:1}}'+
      '.__lykke_banner{animation:lykkeSlideDown .4s ease-out;}';
    try{ (document.head||document.documentElement).appendChild(s); }catch(e){}
  }

  /* ================= M3：七夕卡（并入节日轮播位置） ================= */
  function ensureQixiCard() {
    injectThemeStyle();
    var host = document.querySelector('[aria-label^="点击切换纪念日"]');
    if (!host || !host.parentNode) return;
    var card = document.getElementById('__lykke_qixi_card');
    if (!card) {
      card = document.createElement('div');
      card.id = '__lykke_qixi_card';
      card.style.cssText = 'width:100%;margin-top:0.6rem;padding:1.1rem 1.25rem;border-radius:1.75rem;background:rgba(255,255,255,0.9);box-shadow:0 6px 18px rgba(214,120,160,0.15);border:1px solid rgba(244,180,205,0.5);display:flex;flex-direction:column;align-items:center;gap:0.35rem;box-sizing:border-box;';
      host.parentNode.appendChild(card);
    }
    if (!card.__built) {
      card.innerHTML='';
      var badge=document.createElement('div');
      badge.className='__lykke_breathe';
      badge.style.cssText='width:2.2rem;height:2.2rem;border-radius:9999px;background:linear-gradient(135deg,#fbe3ef,#e9d6f5);display:flex;align-items:center;justify-content:center;font-size:1.1rem;';
      badge.textContent='\ud83d\udc26';
      var title=document.createElement('div');
      title.style.cssText='font-size:0.95rem;font-weight:700;color:#c2437c;'; title.textContent='七夕节';
      var sub=document.createElement('div');
      sub.style.cssText='font-size:0.72rem;color:#9a7d8c;'; sub.id='__lykke_qixi_sub';
      card.appendChild(badge); card.appendChild(title); card.appendChild(sub);
      card.__built=true;
    }
    var sub=document.getElementById('__lykke_qixi_sub');
    if(!sub) return;
    var n=nextFromMap(QIXI_TABLE); if(!n){ sub.textContent='七夕节 · 鹊桥相会'; return; }
    var left=daysBetween(n.date);
    sub.textContent = left<=0 ? '今天是七夕节 \u2661' : ('距七夕节还有 '+left+' 天 · '+n.iso);
  }

  /* ================= M9：纪念日顶部横幅提醒 ================= */
  function getAnniversaries() {
    var list = [];
    list.push({ name:'在一起纪念日', date: nextFixedMonthDay(TOGETHER_MONTH, TOGETHER_DAY) });
    var d = nextFromMap(DADA_TABLE); if(d) list.push({ name:'大大凡生日', date:d });
    list.push({ name:'小小凡生日', date: nextFixedMonthDay(XIAOXIAO_MONTH, XIAOXIAO_DAY) });
    var q = nextFromMap(QIXI_TABLE); if(q) list.push({ name:'七夕节', date:q });
    list.push({ name:'情人节', date: nextFixedMonthDay(2, 14) });
    list.push({ name:'圣诞节', date: nextFixedMonthDay(12, 25) });
    return list;
  }
  function showAnniversaryBanner() {
    injectThemeStyle();
    if (routePath() !== '' && routePath().indexOf('home') === -1) return;
    if (document.getElementById('__lykke_anniv_banner')) return;
    var today = new Date();
    today = pDate(today.getFullYear(), today.getMonth()+1, today.getDate());
    var hits = [];
    var list = getAnniversaries();
    for (var i = 0; i < list.length; i++) {
      var diff = daysBetween(list[i].date);
      if (diff === 0) hits.push('今天是' + list[i].name + '！');
      else if (diff === 1) hits.push('明天是' + list[i].name + '，记得准备惊喜哦');
    }
    if (!hits.length) return;
    var b = document.createElement('div');
    b.id = '__lykke_anniv_banner';
    b.className = '__lykke_banner';
    b.style.cssText = 'position:sticky;top:0;z-index:9997;padding:0.6rem 2.2rem 0.6rem 1rem;margin-bottom:0.5rem;' +
      'background:linear-gradient(135deg,#fce4ee,#f8d4e8);border-radius:1rem;color:#a3356b;' +
      'font-size:0.8rem;line-height:1.4;box-shadow:0 2px 8px rgba(200,100,150,0.15);display:flex;align-items:center;justify-content:space-between;';
    var txt = document.createElement('div'); txt.textContent = '\u2764 ' + hits.join('  |  ');
    var close = document.createElement('div');
    close.textContent = '\u2715'; close.style.cssText='cursor:pointer;margin-left:0.8rem;font-size:0.9rem;color:#c2437c;';
    close.addEventListener('click', function(){ b.remove(); });
    b.appendChild(txt); b.appendChild(close);
    var top = document.querySelector('[aria-label^="点击切换纪念日"]');
    if (top && top.parentNode) top.parentNode.insertBefore(b, top);
    else document.body.insertBefore(b, document.body.firstChild);
  }

  /* ================= M4：视频别名云端同步 ================= */
  function readAliasMap(){ try{ var s=localStorage.getItem('lykke_video_alias'); return s?JSON.parse(s):{}; }catch(e){ return {}; } }
  function getAlias(id){ var m=readAliasMap(); return m[id]||''; }
  function setAlias(id,name){ var m=readAliasMap(); m[id]=name; try{ localStorage.setItem('lykke_video_alias',JSON.stringify(m)); }catch(e){} }
  function mergeCloudAliases(){
    if(!SUPABASE_URL||!SUPABASE_ANON) return;
    fetch(SUPABASE_URL+'/rest/v1/video_alias?select=video_id,alias',{headers:supabaseHeaders()})
      .then(function(r){return r.json();}).then(function(rows){
        if(!rows||!rows.length) return;
        var local=readAliasMap(), changed=false;
        for(var i=0;i<rows.length;i++){ if(rows[i].video_id&&local[rows[i].video_id]!==rows[i].alias){ local[rows[i].video_id]=rows[i].alias; changed=true; } }
        if(changed) try{ localStorage.setItem('lykke_video_alias',JSON.stringify(local)); }catch(e){}
      }).catch(function(){});
  }
  function syncAliasToCloud(recId, alias){
    if(!SUPABASE_URL||!SUPABASE_ANON||!recId) return;
    var h=supabaseHeaders(); h['Prefer']='resolution=merge-duplicates';
    fetch(SUPABASE_URL+'/rest/v1/video_alias',{method:'POST',headers:h,body:JSON.stringify({video_id:recId,alias:alias,updated_at:new Date().toISOString()})}).catch(function(){});
  }
  function listVideos(){ return apiCall('GET','/api/videos').then(function(res){ return recordsOf(res.data); }); }
  function listPhotos(){ return apiCall('GET','/api/photos?page=1&pageSize=50').then(function(res){ return recordsOf(res.data); }); }
  function matchByIdUrl(list,imgUrl){ if(!imgUrl) return null; for(var i=0;i<list.length;i++){ var rec=list[i]; var c=[rec.url,rec.thumbnail]; for(var j=0;j<c.length;j++){ if(c[j]&&imgUrl.indexOf(c[j])!==-1) return rec; } } return null; }
  function firstImgSrc(el){ var im=el.querySelector('img'); if(im&&im.src) return im.src; var vd=el.querySelector('video'); if(vd&&vd.src) return vd.src; return ''; }
  function applyVideoAliases(){
    if(routePath().indexOf('/videos')===-1) return;
    listVideos().then(function(list){
      $all(document,'div[class*="aspect-video"]').forEach(function(el){
        var rec=matchByIdUrl(list,firstImgSrc(el)); if(!rec||!rec.id) return;
        var al=getAlias(rec.id); if(!al) return;
        $all(el,'div,span,p').forEach(function(n){ if(n.children.length===0&&n.textContent&&rec.title&&n.textContent.trim()===String(rec.title).trim()) n.textContent=al; });
      });
    }).catch(function(){});
  }

  /* ================= 长按绑定 ================= */
  function longPressHandler(el, buildMenu){
    var timer=null,startX=0,startY=0,fired=false;
    function clear(){ if(timer){clearTimeout(timer);timer=null;} }
    el.addEventListener('touchstart',function(ev){ fired=false; var t=ev.touches&&ev.touches[0]; startX=t?t.clientX:0; startY=t?t.clientY:0; clear(); timer=setTimeout(function(){fired=true; try{buildMenu();}catch(e){}},LONG_PRESS_MS); },{passive:true});
    el.addEventListener('touchmove',function(ev){ var t=ev.touches&&ev.touches[0]; if(t&&(Math.abs(t.clientX-startX)>10||Math.abs(t.clientY-startY)>10)) clear(); },{passive:true});
    el.addEventListener('touchend',clear,{passive:true});
    el.addEventListener('mousedown',function(ev){ fired=false; startX=ev.clientX; startY=ev.clientY; clear(); timer=setTimeout(function(){fired=true; try{buildMenu();}catch(e){}},LONG_PRESS_MS); });
    el.addEventListener('mousemove',function(ev){ if(Math.abs(ev.clientX-startX)>10||Math.abs(ev.clientY-startY)>10) clear(); });
    el.addEventListener('mouseup',clear); el.addEventListener('mouseleave',clear);
    el.addEventListener('contextmenu',function(ev){ if(fired){ev.preventDefault(); fired=false;} });
  }

  function bindPhotoLongPress(){
    if(routePath().indexOf('/photos')===-1) return;
    $all(document,'div[class*="aspect-square"], div[class*="grid-cols-2"] > div, div[class*="grid-cols-3"] > div').forEach(function(el){
      if(el.__lykkeBound) return; if(!el.querySelector('img')) return; el.__lykkeBound=true;
      longPressHandler(el,function(){
        if(!WRITE_ENABLED) return;
        var src=firstImgSrc(el);
        listPhotos().then(function(list){
          var rec=matchByIdUrl(list,src); if(!rec||!rec.id){ alert('未识别到当前照片记录'); return; }
          var nn=window.prompt('修改照片名称（留空取消改名进入删除确认）：',rec.title||'');
          if(nn===null) return;
          if(nn.trim()!==''){ apiCall('PATCH','/api/photos/'+encodeURIComponent(rec.id),{title:nn.trim()}).then(function(res){ if(okOf(res)){alert('已保存，刷新中');location.reload();} else alert('保存失败：'+msgOf(res)); }).catch(function(){alert('网络异常');}); return; }
          if(window.confirm('删除这张照片？')){ apiCall('DELETE','/api/photos/'+encodeURIComponent(rec.id)).then(function(res){ if(okOf(res)){alert('已删除');location.reload();} else alert('删除失败：'+msgOf(res)); }).catch(function(){alert('网络异常');}); }
        }).catch(function(){ alert('照片读取失败'); });
      });
    });
  }
  function bindVideoLongPress(){
    if(routePath().indexOf('/videos')===-1) return;
    $all(document,'div[class*="aspect-video"]').forEach(function(el){
      if(el.__lykkeBound) return; el.__lykkeBound=true;
      longPressHandler(el,function(){
        if(!WRITE_ENABLED) return;
        var src=firstImgSrc(el);
        listVideos().then(function(list){
          var rec=matchByIdUrl(list,src); if(!rec||!rec.id){ alert('未识别到视频'); return; }
          var alias=window.prompt('修改视频显示名称：',getAlias(rec.id)||rec.title||'');
          if(alias!==null&&alias.trim()!==''){ setAlias(rec.id,alias.trim()); syncAliasToCloud(rec.id,alias.trim()); applyVideoAliases(); alert('已设置显示名'); return; }
          if(window.confirm('删除这段视频？')){ apiCall('DELETE','/api/videos/'+encodeURIComponent(rec.id)).then(function(res){ if(okOf(res)){alert('已删除');location.reload();} else alert('删除失败：'+msgOf(res)); }).catch(function(){alert('网络异常');}); }
        }).catch(function(){ alert('视频读取失败'); });
      });
    });
  }

  /* ================= M5：和好记录（撤回隐藏 + 删除按钮） ================= */
  function listRecons(){ return apiCall('GET','/api/reconciliations').then(function(res){ return recordsOf(res.data); }); }

  function getHiddenReconIds(cb){
    if(!SUPABASE_URL||!SUPABASE_ANON){ cb({}); return; }
    fetch(SUPABASE_URL+'/rest/v1/reconciliation_hidden?select=recon_id',{headers:supabaseHeaders()})
      .then(function(r){return r.json();}).then(function(rows){
        var m={}; if(rows&&rows.length){ for(var i=0;i<rows.length;i++) m[rows[i].recon_id]=1; }
        cb(m);
      }).catch(function(){ cb({}); });
  }
  function hideReconOnCloud(reconId){
    if(!SUPABASE_URL||!SUPABASE_ANON||!reconId) return;
    var h=supabaseHeaders(); h['Prefer']='resolution=merge-duplicates';
    fetch(SUPABASE_URL+'/rest/v1/reconciliation_hidden',{method:'POST',headers:h,body:JSON.stringify({recon_id:reconId,hidden_at:new Date().toISOString()})}).catch(function(){});
  }

  function hideWithdrawnRecons(){
    if(routePath().indexOf('/reconciliation')===-1) return;
    listRecons().then(function(list){
      getHiddenReconIds(function(hidden){
        var withdrawn={};
        list.forEach(function(r){
          if((r.status==='withdrawn'||hidden[r.id])&&r.lastMessage) withdrawn[r.lastMessage]=1;
        });
        $all(document,'div[class*="rounded-2xl"],div[class*="rounded-3xl"]').forEach(function(el){
          if(el.__lykkeHidden) return;
          var t=textOf(el); if(t.length>220) return;
          for(var msg in withdrawn){ if(withdrawn.hasOwnProperty(msg)&&t.indexOf(msg)!==-1){ el.style.display='none'; el.__lykkeHidden=true; break; } }
        });
      });
    }).catch(function(){});
  }

  /* 和好卡片右下角红色删除按钮 */
  function injectReconDeleteButtons(){
    if(routePath().indexOf('/reconciliation')===-1) return;
    listRecons().then(function(list){
      $all(document,'div[class*="rounded-2xl"],div[class*="rounded-3xl"]').forEach(function(el){
        if(el.__lykkeDelBound) return;
        var t=textOf(el); if(t.indexOf('和好')===-1||t.length>220) return;
        el.__lykkeDelBound=true;
        var rec=null;
        for(var i=0;i<list.length;i++){
          var r=list[i];
          if(r.lastMessage&&t.indexOf(r.lastMessage)!==-1){ rec=r; break; }
        }
        if(!rec||!rec.id) return;
        el.style.position='relative';
        var del=document.createElement('div');
        del.innerHTML='\ud83d\uddd1';
        del.style.cssText='position:absolute;right:0.6rem;bottom:0.5rem;cursor:pointer;font-size:1.1rem;opacity:0.6;padding:0.2rem;';
        del.addEventListener('click',function(e){
          e.stopPropagation();
          if(!WRITE_ENABLED) return;
          if(!window.confirm('删除这条和好记录？\n内容：'+(rec.lastMessage||'')+'\n（两边手机都不再显示）')) return;
          hideReconOnCloud(rec.id);
          el.style.display='none';
          setTimeout(function(){ location.reload(); },500);
        });
        try{ el.appendChild(del); }catch(e){}
      });
    }).catch(function(){});
  }

  /* ================= M7：地图添加地点表单（接管原站按钮） ================= */
  function mapRouteHit(){
    var p=routePath().toLowerCase(), h=location.pathname.toLowerCase();
    if(p.indexOf('travel')>=0||p.indexOf('map')>=0||h.indexOf('travel')>=0||h.indexOf('map')>=0) return true;
    try{ return document.querySelector('.leaflet-container')!==null; }catch(e){ return false; }
  }
  function coordOfCity(name){ var key=name.replace(/\s+/g,''); if(CITY_TABLE[key]) return {lat:CITY_TABLE[key][0],lng:CITY_TABLE[key][1]}; return null; }
  function geocodeCity(name,cb){
    if(!AMAP_WEB_KEY){ cb(null); return; }
    fetch('https://restapi.amap.com/v3/geocode/geo?key='+encodeURIComponent(AMAP_WEB_KEY)+'&address='+encodeURIComponent(name),{credentials:'omit'})
      .then(function(r){return r.json();}).then(function(d){
        if(d&&d.status==='1'&&d.geocodes&&d.geocodes[0]&&d.geocodes[0].location){
          var loc=String(d.geocodes[0].location).split(',');
          cb({lng:parseFloat(loc[0]),lat:parseFloat(loc[1])});
        } else cb(null);
      }).catch(function(){ cb(null); });
  }

  var __pendingPhotoFile = null;

  function openAddSpotModal(){
    if(document.getElementById('__lykke_add_spot_modal')) return;
    var mask=document.createElement('div');
    mask.id='__lykke_add_spot_modal';
    mask.style.cssText='position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;padding:1rem;';
    var box=document.createElement('div');
    box.style.cssText='background:#fff;border-radius:1.2rem;padding:1.5rem;width:100%;max-width:22rem;max-height:90vh;overflow-y:auto;box-shadow:0 10px 40px rgba(0,0,0,0.2);';
    box.innerHTML=
      '<div style="font-size:1.1rem;font-weight:700;color:#c2437c;margin-bottom:1rem;">\u2764 添加打卡地点</div>'+
      '<div style="font-size:0.8rem;color:#666;margin-bottom:0.3rem;">地点名称 *</div>'+
      '<input id="__ly_spot_name" placeholder="如：厦门" style="width:100%;padding:0.6rem;border:1px solid #f4b4cd;border-radius:0.6rem;font-size:0.9rem;box-sizing:border-box;margin-bottom:0.8rem;outline:none;">'+
      '<div id="__ly_spot_coord" style="font-size:0.7rem;color:#999;margin-bottom:0.8rem;"></div>'+
      '<div style="font-size:0.8rem;color:#666;margin-bottom:0.3rem;">到访日期</div>'+
      '<input id="__ly_spot_date" type="date" style="width:100%;padding:0.6rem;border:1px solid #f4b4cd;border-radius:0.6rem;font-size:0.9rem;box-sizing:border-box;margin-bottom:0.8rem;outline:none;">'+
      '<div style="font-size:0.8rem;color:#666;margin-bottom:0.3rem;">备注</div>'+
      '<textarea id="__ly_spot_note" placeholder="记录一下这段旅行的小故事..." style="width:100%;padding:0.6rem;border:1px solid #f4b4cd;border-radius:0.6rem;font-size:0.85rem;box-sizing:border-box;margin-bottom:0.8rem;min-height:4rem;outline:none;resize:vertical;"></textarea>'+
      '<div style="font-size:0.8rem;color:#666;margin-bottom:0.3rem;">关联照片（可选）</div>'+
      '<input id="__ly_spot_photo" type="file" accept="image/*" style="margin-bottom:1rem;font-size:0.8rem;color:#999;">'+
      '<div style="display:flex;gap:0.6rem;margin-top:0.5rem;">'+
        '<button id="__ly_spot_cancel" style="flex:1;padding:0.7rem;border:none;border-radius:9999px;background:#f5f0f2;color:#888;font-size:0.9rem;cursor:pointer;">取消</button>'+
        '<button id="__ly_spot_submit" style="flex:2;padding:0.7rem;border:none;border-radius:9999px;background:linear-gradient(135deg,#f48fb1,#ec407a);color:#fff;font-size:0.9rem;font-weight:600;cursor:pointer;">添加</button>'+
      '</div>';
    mask.appendChild(box);
    document.body.appendChild(mask);

    var nameInput=box.querySelector('#__ly_spot_name');
    var coordLabel=box.querySelector('#__ly_spot_coord');
    var resolvedCoord=null;
    var geoTimer=null;
    nameInput.addEventListener('input',function(){
      var nm=nameInput.value.trim();
      if(!nm){ resolvedCoord=null; coordLabel.textContent=''; return; }
      if(geoTimer) clearTimeout(geoTimer);
      geoTimer=setTimeout(function(){
        var c=coordOfCity(nm);
        if(c){ resolvedCoord=c; coordLabel.textContent='\u2713 已定位：'+c.lat.toFixed(4)+', '+c.lng.toFixed(4); return; }
        geocodeCity(nm,function(g){
          if(g){ resolvedCoord=g; coordLabel.textContent='\u2713 已定位：'+g.lat.toFixed(4)+', '+g.lng.toFixed(4); }
          else coordLabel.textContent='\u26a0 未找到该城市，请检查名称';
        });
      },600);
    });

    box.querySelector('#__ly_spot_photo').addEventListener('change',function(e){
      if(e.target.files&&e.target.files[0]) __pendingPhotoFile=e.target.files[0];
    });

    box.querySelector('#__ly_spot_cancel').addEventListener('click',function(){ mask.remove(); __pendingPhotoFile=null; });
    mask.addEventListener('click',function(e){ if(e.target===mask){ mask.remove(); __pendingPhotoFile=null; } });

    box.querySelector('#__ly_spot_submit').addEventListener('click',function(){
      var nm=nameInput.value.trim();
      if(!nm){ alert('请输入地点名称'); return; }
      if(!resolvedCoord){ alert('正在定位城市，请稍候再提交，或检查城市名称'); return; }
      var note=box.querySelector('#__ly_spot_note').value.trim();
      var visitedAt=box.querySelector('#__ly_spot_date').value;
      var btn=box.querySelector('#__ly_spot_submit');
      btn.textContent='添加中...'; btn.disabled=true;
      var body={name:nm,lat:resolvedCoord.lat,lng:resolvedCoord.lng};
      if(note) body.note=note;
      if(visitedAt) body.visitedAt=visitedAt;
      apiCall('POST','/api/travel-spots',body).then(function(res){
        if(!okOf(res)){ alert('提交失败：'+msgOf(res)); btn.textContent='添加'; btn.disabled=false; return; }
        var spotId=res.data&&(res.data.id||(res.data.data&&res.data.data.id));
        if(spotId&&__pendingPhotoFile){
          uploadPhotoAndLink(spotId,nm,function(){ location.reload(); });
        } else { location.reload(); }
      }).catch(function(){ alert('网络异常'); btn.textContent='添加'; btn.disabled=false; });
    });
  }

  function uploadPhotoAndLink(spotId,title,cb){
    var fd=new FormData();
    fd.append('file',__pendingPhotoFile);
    fetch(apiPrefix()+'/api/photos',{method:'POST',credentials:'include',headers:{'X-Suda-Csrf-Token':csrfCookie(),'X-Couple-Token':getToken()},body:fd})
      .then(function(r){return r.json();}).then(function(d){
        var photoUrl=d.url||(d.data&&(d.data.url||d.data.path))||(d.data&&d.data.data&&d.data.data.url);
        if(!photoUrl){ cb(); return; }
        return apiCall('POST','/api/travel-spots/'+encodeURIComponent(spotId)+'/photos',{photoUrl:photoUrl,title:title});
      }).then(function(){ cb(); }).catch(function(){ cb(); });
  }

  /* 拦截原站"添加地点"按钮 */
  function interceptAddSpotButtons(){
    if(!mapRouteHit()) return;
    $all(document,'button,div[role="button"],a').forEach(function(el){
      if(el.__lykkeIntercepted) return;
      var t=textOf(el);
      if(t.indexOf('添加地点')===-1) return;
      el.__lykkeIntercepted=true;
      el.addEventListener('click',function(e){
        e.preventDefault(); e.stopPropagation();
        openAddSpotModal();
      },true);
    });
  }

  /* ================= M8：检查更新列表项（回收站样式） ================= */
  function ensureUpdateEntry(){
    if(typeof window.lykkeApp==='undefined'||!window.lykkeApp) return;
    var route=routePath().toLowerCase();
    if(route.indexOf('more')===-1&&route.indexOf('me')===-1&&route.indexOf('setting')===-1&&route.indexOf('profile')===-1) return;
    if(document.getElementById('__lykke_check_update')) return;
    /* 找回收站那一行 */
    var recycleRow=null;
    $all(document,'div,button').forEach(function(el){
      if(recycleRow) return;
      if(textOf(el).indexOf('回收站')!==-1&&textOf(el).indexOf('30')!==-1){
        if(el.querySelector('svg,img,[class*="icon"]')||el.children.length<=5) recycleRow=el;
      }
    });
    if(!recycleRow||!recycleRow.parentNode) return;
    var row=document.createElement('div');
    row.id='__lykke_check_update';
    row.style.cssText='display:flex;align-items:center;gap:0.75rem;padding:0.85rem 1rem;background:#fff;border-radius:1rem;margin-top:0.5rem;cursor:pointer;';
    row.innerHTML=
      '<div style="width:2.4rem;height:2.4rem;border-radius:0.6rem;background:#f3e8ec;display:flex;align-items:center;justify-content:center;font-size:1.1rem;">\ud83d\udd04</div>'+
      '<div style="flex:1;">'+
        '<div style="font-size:0.9rem;font-weight:600;color:#333;">检查更新</div>'+
        '<div style="font-size:0.72rem;color:#999;margin-top:0.15rem;">检查是否有新版本</div>'+
      '</div>'+
      '<div style="color:#ccc;font-size:1.1rem;">\u203a</div>';
    row.addEventListener('click',function(){ try{ window.lykkeApp.checkUpdateNow(); }catch(e){} });
    recycleRow.parentNode.insertBefore(row, recycleRow.nextSibling);
  }

  function selfCheck(){ try{ console.info('[lykke] modules ok'); }catch(e){} }

  function bindAll(){
    safe('photo-longpress',bindPhotoLongPress);
    safe('video-longpress',bindVideoLongPress);
    safe('recon-delete',injectReconDeleteButtons);
  }

  function cycle(){
    safe('M1-clip',fixFestivalClip);
    safe('M2-tiles',scanTiles);
    safe('M3-qixi',ensureQixiCard);
    safe('M5-hide',hideWithdrawnRecons);
    safe('M4-alias-merge',mergeCloudAliases);
    safe('M4-alias-apply',applyVideoAliases);
    safe('M7-intercept',interceptAddSpotButtons);
    safe('M8-update',ensureUpdateEntry);
    safe('M9-anniv',showAnniversaryBanner);
    safe('selfcheck',selfCheck);
    bindAll();
  }
  function schedule(){
    cycle();
    setInterval(cycle,1800);
    try{
      var pending=false;
      var mo=new MutationObserver(function(){ if(pending) return; pending=true; setTimeout(function(){pending=false;cycle();},600); });
      mo.observe(document.documentElement,{childList:true,subtree:true});
    }catch(e){}
    document.addEventListener('visibilitychange',function(){ if(!document.hidden) setTimeout(cycle,400); });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',schedule);
  else schedule();
  window.addEventListener('load',cycle);
})();
